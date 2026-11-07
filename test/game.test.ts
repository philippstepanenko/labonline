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
    energy: 1,
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
  startEnergy?: number;
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
    startEnergy: options.startEnergy,
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

describe('Game: ходы, стены и энергия', () => {
  it('не тратит ход и энергию при попытке войти в стену', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [3, 3]], exits: [[3, 1]] });

    game.move('p1', 'up');

    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(playerState(game, 'p1').energy).toBe(1);
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

  it('перемещает игрока, тратит энергию и передаёт ход дальше', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [3, 3]], exits: [[3, 1]] });

    game.move('p1', 'right');

    expect(playerState(game, 'p1').pos).toEqual({ x: 2, y: 1 });
    expect(playerState(game, 'p1').energy).toBe(0);
    expect(game.currentPlayerId).toBe('p2');
  });

  it('начисляет +1 энергии всем игрокам в начале нового круга', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [3, 3]], exits: [[3, 1]] });

    game.move('p1', 'right');
    game.move('p2', 'left');

    expect(playerState(game, 'p1').energy).toBe(1);
    expect(playerState(game, 'p2').energy).toBe(1);
    expect(game.currentPlayerId).toBe('p1');
  });

  it('отклоняет ход при энергии меньше 1', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [3, 3]],
      exits: [[3, 1]],
      startEnergy: 0,
    });

    game.move('p1', 'right');

    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'moveRejected' && message.reason === 'noEnergy',
      ),
    ).toBe(true);
  });
});

describe('Game: обмен и бой', () => {
  it('при столкновении предлагает выбор и не передаёт ход', () => {
    const sent: SentMessage[] = [];
    const game = createGame({ sent, starts: [[1, 1], [2, 1]], exits: [[3, 3]] });

    game.move('p1', 'right');

    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p1').energy).toBe(1);
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

  it('победитель-атакующий тратит 1 энергию, защитник — 3', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.1,
      startEnergy: 4,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    const p1 = playerState(game, 'p1');
    const p2 = playerState(game, 'p2');

    expect(p1.pos).toEqual({ x: 1, y: 1 });
    expect(p2.pos).toEqual({ x: 2, y: 1 });
    expect(p1.energy).toBe(3);
    expect(p2.energy).toBe(1);
    expect(game.currentPlayerId).toBe('p2');
    expect(
      hasMessage(
        sent,
        (message) => message.type === 'event' && message.kind === 'battle',
      ),
    ).toBe(true);
  });

  it('победитель-защитник тратит 1 энергию, атакующий — 3', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.9,
      startEnergy: 4,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    expect(playerState(game, 'p1').energy).toBe(1);
    expect(playerState(game, 'p2').energy).toBe(3);
    expect(game.currentPlayerId).toBe('p2');
  });

  it('проигравший пропускает ходы, пока энергия меньше 1', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.9,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    expect(playerState(game, 'p1').energy).toBe(-1);
    expect(playerState(game, 'p2').energy).toBe(1);
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

    game.move('p2', 'down');
    expect(game.currentPlayerId).toBe('p2');
    expect(playerState(game, 'p1').energy).toBe(0);

    game.move('p2', 'down');
    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p1').energy).toBe(1);
  });

  it('принятый обмен тратит по 1 энергии у обоих и меняет позиции', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      startEnergy: 4,
    });

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
    expect(playerState(game, 'p1').energy).toBe(3);
    expect(playerState(game, 'p2').energy).toBe(3);
    expect(game.currentPlayerId).toBe('p2');
  });

  it('отказ от обмена запускает бой со стандартными списаниями', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.1,
      startEnergy: 4,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'swap');
    game.respondSwap('p2', false);

    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(playerState(game, 'p2').pos).toEqual({ x: 2, y: 1 });
    expect(playerState(game, 'p1').energy).toBe(3);
    expect(playerState(game, 'p2').energy).toBe(1);
    expect(
      hasMessage(
        sent,
        (message) => message.type === 'event' && message.kind === 'battle',
      ),
    ).toBe(true);
  });

  it('позволяет войти на клетку игрока с энергией меньше 1 и совмещает фигуры', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1]],
      exits: [[3, 3]],
      rng: () => 0.9,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    expect(playerState(game, 'p1').energy).toBe(-1);
    expect(playerState(game, 'p2').energy).toBe(1);
    expect(game.currentPlayerId).toBe('p2');

    game.move('p2', 'left');

    expect(game.debug().pending).toBeNull();
    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(playerState(game, 'p2').pos).toEqual({ x: 1, y: 1 });
    expect(playerState(game, 'p1').active).toBe(true);
    expect(playerState(game, 'p2').active).toBe(true);
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
    expect(otherFromFirst?.energy).toBe(1);
    expect(otherFromSecond?.energy).toBe(1);
    expect(first.you.energy).toBe(1);
    expect(second.you.energy).toBe(1);
    expect(otherFromFirst).not.toHaveProperty('skipNext');
    expect(otherFromSecond).not.toHaveProperty('skipNext');
    expect(first.visible.exits).toEqual([]);
    expect(second.visible.exits).toEqual([]);
    expect(first.you.pos).toEqual({ x: 1, y: 1 });
    expect(second.you.pos).toEqual({ x: 5, y: 5 });
  });
});
