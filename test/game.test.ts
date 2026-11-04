import { describe, expect, it } from 'vitest';
import { Game, type GamePlayer } from '../src/server/game';
import type { Maze } from '../src/server/maze';
import type { ServerMessage } from '../src/shared/protocol';

interface SentMessage {
  id: string;
  message: ServerMessage;
}

function makePlayers(ids: string[], sent: SentMessage[]): GamePlayer[] {
  return ids.map((id) => ({
    id,
    name: id.toUpperCase(),
    send: (message) => sent.push({ id, message }),
    connected: true,
    active: false,
    escaped: false,
    skipNext: false,
    pos: { x: 0, y: 0 },
  }));
}

function openMaze(
  width: number,
  height: number,
  starts: Array<[number, number]>,
  exits: Array<[number, number]>,
): Maze {
  const walls = Array.from({ length: height }, (_, y) =>
    Array.from(
      { length: width },
      (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1,
    ),
  );

  return {
    width,
    height,
    walls,
    exits: new Set(exits.map(([x, y]) => `${x},${y}`)),
    starts: starts.map(([x, y]) => ({ x, y })),
  };
}

function createGame(options: {
  sent: SentMessage[];
  starts: Array<[number, number]>;
  exits: Array<[number, number]>;
  order?: string[];
  rng?: () => number;
  width?: number;
  height?: number;
}): Game {
  const order = options.order ?? ['p1', 'p2'];
  const players = makePlayers(order, options.sent);
  const width = options.width ?? 5;
  const height = options.height ?? 5;

  return new Game({
    players,
    order,
    maze: openMaze(width, height, options.starts, options.exits),
    rng: options.rng ?? (() => 0.1),
  });
}

function playerState(game: Game, id: string) {
  const found = game.debug().players.find((player) => player.id === id);
  if (!found) throw new Error(`Нет игрока ${id}`);
  return found;
}

function hasMessage(
  sent: SentMessage[],
  predicate: (message: ServerMessage) => boolean,
): boolean {
  return sent.some((entry) => predicate(entry.message));
}

describe('Game: ходы и стены', () => {
  it('не тратит ход при попытке войти в стену', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [3, 3]], exits: [[3, 1]] });

    game.move('p1', 'up');

    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'moveRejected' && message.reason === 'wall',
      ),
    ).toBe(true);
  });

  it('отклоняет ход не в свою очередь', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [3, 3]], exits: [[3, 1]] });

    game.move('p2', 'left');

    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p2').pos).toEqual({ x: 3, y: 3 });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'moveRejected' && message.reason === 'notTurn',
      ),
    ).toBe(true);
  });

  it('перемещает игрока и передаёт ход дальше', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [3, 3]], exits: [[3, 1]] });

    game.move('p1', 'right');

    expect(playerState(game, 'p1').pos).toEqual({ x: 2, y: 1 });
    expect(game.currentPlayerId).toBe('p2');
  });
});

describe('Game: обмен и бой', () => {
  it('при столкновении предлагает выбор и не передаёт ход', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [2, 1]], exits: [[3, 3]] });

    game.move('p1', 'right');

    expect(game.currentPlayerId).toBe('p1');
    expect(game.debug().pending).toMatchObject({
      initiatorId: 'p1',
      targetId: 'p2',
      stage: 'choose',
    });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'chooseAction' && message.targetId === 'p2',
      ),
    ).toBe(true);
  });

  it('бой не меняет позиции, проигравший пропускает свой ход', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.9,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    const p1 = playerState(game, 'p1');
    const p2 = playerState(game, 'p2');

    expect(p1.pos).toEqual({ x: 1, y: 1 });
    expect(p2.pos).toEqual({ x: 2, y: 1 });
    expect(p1.skipNext).toBe(true);
    expect(p2.skipNext).toBe(false);
    expect(game.currentPlayerId).toBe('p2');
    expect(
      hasMessage(sent, (message) => message.type === 'event' && message.kind === 'battle'),
    ).toBe(true);
  });

  it('пропуск срабатывает, когда до проигравшего доходит очередь', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.9,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');
    expect(game.currentPlayerId).toBe('p2');

    game.move('p2', 'down');

    expect(playerState(game, 'p1').skipNext).toBe(false);
    expect(game.currentPlayerId).toBe('p2');
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'event' &&
          message.kind === 'skip' &&
          message.message.includes('P1'),
      ),
    ).toBe(true);
  });

  it('принятый обмен меняет позиции игроков', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [2, 1]], exits: [[3, 3]] });

    game.move('p1', 'right');
    game.chooseAction('p1', 'swap');

    expect(
      hasMessage(
        sent,
        (message) => message.type === 'swapOffer' && message.fromId === 'p1',
      ),
    ).toBe(true);

    game.respondSwap('p2', true);

    expect(playerState(game, 'p1').pos).toEqual({ x: 2, y: 1 });
    expect(playerState(game, 'p2').pos).toEqual({ x: 1, y: 1 });
    expect(game.currentPlayerId).toBe('p2');
  });

  it('отказ от обмена запускает бой', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.1,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'swap');
    game.respondSwap('p2', false);

    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(playerState(game, 'p2').pos).toEqual({ x: 2, y: 1 });
    expect(
      hasMessage(sent, (message) => message.type === 'event' && message.kind === 'battle'),
    ).toBe(true);
  });
});

describe('Game: выходы и конец игры', () => {
  it('игрок на выходе сбегает, игра завершается при K−1 сбежавших', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 2], [3, 3]],
      exits: [[2, 2]],
    });

    game.move('p1', 'right');

    expect(game.phase).toBe('over');
    expect(playerState(game, 'p1').escaped).toBe(true);
    expect(playerState(game, 'p1').active).toBe(false);
    expect(game.exitsRemaining).toBe(0);

    const over = sent.find((entry) => entry.message.type === 'gameOver');
    expect(over?.message).toMatchObject({
      escaped: ['P1'],
      losers: ['P2'],
    });
  });

  it('не завершает игру, пока последний активный игрок не сбежал', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [3, 1], [5, 5]],
      exits: [[1, 3], [3, 3]],
      order: ['p1', 'p2', 'p3'],
      width: 7,
      height: 7,
    });

    game.disconnect('p2');
    game.disconnect('p3');

    expect(game.phase).toBe('playing');
    expect(game.currentPlayerId).toBe('p1');

    game.move('p1', 'down');
    game.move('p1', 'down');

    expect(game.phase).toBe('over');
    const over = sent.find((entry) => entry.message.type === 'gameOver');
    expect(over?.message).toMatchObject({
      escaped: ['P1'],
      losers: ['P2', 'P3'],
    });
  });
});

describe('Game: отключения', () => {
  it('отмена обмена при отключении цели не вешает игру', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1], [3, 3]],
      exits: [[1, 3], [3, 1]],
      order: ['p1', 'p2', 'p3'],
    });

    game.move('p1', 'right');
    expect(game.debug().pending).not.toBeNull();

    game.disconnect('p2');

    expect(game.debug().pending).toBeNull();
    expect(game.phase).toBe('playing');
    expect(playerState(game, 'p2').active).toBe(false);
    expect(playerState(game, 'p2').connected).toBe(false);
    expect(game.currentPlayerId).toBe('p3');
  });
});

describe('Game: туман войны', () => {
  it('не раскрывает чужие позиции и выходы вне радиуса', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [5, 5]],
      exits: [[3, 3]],
      width: 7,
      height: 7,
    });

    const first = game.snapshotFor('p1');
    const second = game.snapshotFor('p2');

    const otherFromFirst = first.players.find((player) => player.id === 'p2');
    const otherFromSecond = second.players.find((player) => player.id === 'p1');

    expect(otherFromFirst?.pos).toBeUndefined();
    expect(otherFromSecond?.pos).toBeUndefined();
    expect(first.visible.exits).toEqual([]);
    expect(second.visible.exits).toEqual([]);
    expect(first.you.pos).toEqual({ x: 1, y: 1 });
    expect(second.you.pos).toEqual({ x: 5, y: 5 });
  });
});
