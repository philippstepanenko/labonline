import { describe, expect, it } from 'vitest';
import { Game, type GamePlayer } from '../src/server/game';
import type { Maze } from '../src/server/maze';
import type { ServerMessage } from '../src/shared/protocol';

interface SentMessage {
  id: string;
  message: ServerMessage;
}

function makePlayers(ids: string[], sent: SentMessage[]): GamePlayer[] {
  return ids.map((id, index) => ({
    id,
    name: id.toUpperCase(),
    hue: index * 20,
    send: (message) => sent.push({ id, message }),
    connected: true,
    active: false,
    escaped: false,
    energy: 1,
    defeated: false,
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
      starts: [[1, 1], [2, 1], [3, 3]],
      exits: [[3, 1]],
      order: ['p1', 'p2', 'p3'],
      rng: () => 0.1,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    const p1 = playerState(game, 'p1');
    const p2 = playerState(game, 'p2');

    expect(p1.pos).toEqual({ x: 1, y: 1 });
    expect(p2.pos).toEqual({ x: 2, y: 1 });
    expect(p1.energy).toBe(0);
    expect(p2.energy).toBe(-2);
    expect(p1.defeated).toBe(false);
    expect(p2.defeated).toBe(true);
    expect(game.currentPlayerId).toBe('p3');
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
      starts: [[1, 1], [2, 1], [3, 3]],
      exits: [[3, 1]],
      order: ['p1', 'p2', 'p3'],
      rng: () => 0.9,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'fight');

    expect(playerState(game, 'p1').energy).toBe(-2);
    expect(playerState(game, 'p2').energy).toBe(0);
    expect(playerState(game, 'p1').defeated).toBe(true);
    expect(playerState(game, 'p2').defeated).toBe(false);
    expect(game.currentPlayerId).toBe('p3');
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
    expect(playerState(game, 'p1').defeated).toBe(true);
    expect(playerState(game, 'p2').defeated).toBe(false);
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
    expect(playerState(game, 'p1').defeated).toBe(true);

    game.move('p2', 'down');
    expect(game.currentPlayerId).toBe('p1');
    expect(playerState(game, 'p1').energy).toBe(1);
    expect(playerState(game, 'p1').defeated).toBe(false);
  });

  it('принятый обмен тратит по 1 энергии у обоих и меняет позиции', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1], [3, 3]],
      exits: [[3, 1]],
      order: ['p1', 'p2', 'p3'],
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
    expect(playerState(game, 'p1').energy).toBe(0);
    expect(playerState(game, 'p2').energy).toBe(0);
    expect(playerState(game, 'p1').defeated).toBe(false);
    expect(playerState(game, 'p2').defeated).toBe(false);
    expect(game.currentPlayerId).toBe('p3');
  });

  it('принятый обмен работает и при нулевой энергии цели, уводя её в минус', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 2], [4, 4]],
      exits: [[4, 0]],
      order: ['p2', 'p1', 'p3'],
    });

    game.move('p2', 'right');
    expect(playerState(game, 'p2').energy).toBe(0);
    expect(game.currentPlayerId).toBe('p1');

    game.move('p1', 'up');
    game.chooseAction('p1', 'swap');
    game.respondSwap('p2', true);

    expect(playerState(game, 'p1').pos).toEqual({ x: 2, y: 1 });
    expect(playerState(game, 'p2').pos).toEqual({ x: 2, y: 2 });
    expect(playerState(game, 'p1').energy).toBe(0);
    expect(playerState(game, 'p2').energy).toBe(-1);
    expect(
      hasMessage(
        sent,
        (message) => message.type === 'event' && message.kind === 'battle',
      ),
    ).toBe(false);
    expect(
      hasMessage(
        sent,
        (message) => message.type === 'event' && message.kind === 'swap',
      ),
    ).toBe(true);
  });

  it('отказ от обмена запускает бой со стандартными списаниями', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [2, 1], [3, 3]],
      exits: [[3, 1]],
      order: ['p1', 'p2', 'p3'],
      rng: () => 0.1,
    });

    game.move('p1', 'right');
    game.chooseAction('p1', 'swap');
    game.respondSwap('p2', false);

    expect(playerState(game, 'p1').pos).toEqual({ x: 1, y: 1 });
    expect(playerState(game, 'p2').pos).toEqual({ x: 2, y: 1 });
    expect(playerState(game, 'p1').energy).toBe(0);
    expect(playerState(game, 'p2').energy).toBe(-2);
    expect(playerState(game, 'p2').defeated).toBe(true);
    expect(
      hasMessage(
        sent,
        (message) => message.type === 'event' && message.kind === 'battle',
      ),
    ).toBe(true);
  });

  it('не позволяет войти на клетку обычного соперника с нулевой энергией', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [1, 3], [3, 3]],
      exits: [[3, 1]],
      order: ['p1', 'p2', 'p3'],
    });

    game.move('p1', 'down');

    expect(playerState(game, 'p1').energy).toBe(0);
    expect(playerState(game, 'p1').defeated).toBe(false);
    expect(game.currentPlayerId).toBe('p2');

    game.move('p2', 'up');

    expect(game.currentPlayerId).toBe('p2');
    expect(playerState(game, 'p2').pos).toEqual({ x: 1, y: 3 });
    expect(game.debug().pending).toMatchObject({
      initiatorId: 'p2',
      targetId: 'p1',
      stage: 'choose',
    });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'chooseAction' && message.targetId === 'p1',
      ),
    ).toBe(true);
  });

  it('позволяет войти на клетку поверженного игрока и совмещает фигуры', () => {
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
    expect(playerState(game, 'p1').defeated).toBe(true);
    expect(playerState(game, 'p2').defeated).toBe(false);
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

  it('показывает использованный выход другому игроку красной клеткой', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 2], [1, 1]],
      exits: [[2, 2]],
    });

    game.move('p1', 'right');

    const snapshot = game.snapshotFor('p2');
    expect(snapshot.visible.cells[2][2]).toBe('X');
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

describe('Game: наблюдение после побега', () => {
  function spectateGame(sent: SentMessage[]): Game {
    return createGame({
      sent,
      starts: [[1, 1], [3, 1], [5, 5]],
      exits: [[2, 1]],
      order: ['p1', 'p2', 'p3'],
      width: 7,
      height: 7,
    });
  }

  it('по умолчанию следит за текущим ходящим игроком', () => {
    const sent: SentMessage[] = [];
    const game = spectateGame(sent);

    game.move('p1', 'right');

    expect(playerState(game, 'p1').escaped).toBe(true);
    expect(game.phase).toBe('playing');

    const snapshot = game.snapshotFor('p1');
    expect(snapshot.spectate).toMatchObject({
      mode: 'auto',
      targetId: 'p2',
      targetName: 'P2',
    });

    const target = snapshot.players.find((player) => player.id === 'p2');
    const farPlayer = snapshot.players.find((player) => player.id === 'p3');
    expect(target?.pos).toEqual({ x: 3, y: 1 });
    expect(farPlayer?.pos).toBeUndefined();
  });

  it('переключается на выбранного игрока и отдаёт его разведанную карту', () => {
    const sent: SentMessage[] = [];
    const game = spectateGame(sent);

    game.move('p1', 'right');
    game.setSpectate('p1', { mode: 'player', targetId: 'p3' });

    const snapshot = game.snapshotFor('p1');
    expect(snapshot.spectate).toMatchObject({
      mode: 'player',
      targetId: 'p3',
      targetName: 'P3',
    });

    const known = new Map(
      (snapshot.spectate?.known ?? []).map(([x, y, cell]) => [
        `${x},${y}`,
        cell,
      ]),
    );
    expect(known.get('5,5')).toBe('.');
    expect(known.has('1,1')).toBe(false);
    expect(snapshot.visible.origin).toEqual({ x: 4, y: 4 });
  });

  it('запрещает наблюдение обычному игроку и неверной цели', () => {
    const sent: SentMessage[] = [];
    const game = spectateGame(sent);

    game.setSpectate('p2', { mode: 'auto' });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'error' && message.code === 'not_spectator',
      ),
    ).toBe(true);

    game.move('p1', 'right');
    game.setSpectate('p1', { mode: 'player', targetId: 'p1' });
    expect(
      hasMessage(
        sent,
        (message) =>
          message.type === 'error' && message.code === 'bad_spectate_target',
      ),
    ).toBe(true);

    game.setSpectate('p1', { mode: 'player', targetId: 'nope' });
    const errors = sent.filter(
      (entry) =>
        entry.message.type === 'error' &&
        entry.message.code === 'bad_spectate_target',
    );
    expect(errors).toHaveLength(2);
  });

  it('возвращается к авто-наблюдению, если цель выбыла', () => {
    const sent: SentMessage[] = [];
    const game = spectateGame(sent);

    game.move('p1', 'right');
    game.setSpectate('p1', { mode: 'player', targetId: 'p2' });
    game.disconnect('p2');

    const snapshot = game.snapshotFor('p1');
    expect(snapshot.spectate).toMatchObject({
      mode: 'auto',
      targetId: 'p3',
    });
  });

  it('в конце игры показывает всем полную карту без режима наблюдателя', () => {
    const sent: SentMessage[] = [];
    const game = createGame({
      sent,
      starts: [[1, 1], [3, 3]],
      exits: [[2, 1]],
    });

    game.move('p1', 'right');
    expect(game.phase).toBe('over');

    for (const id of ['p1', 'p2']) {
      const snapshot = game.snapshotFor(id);
      expect(snapshot.spectate).toBeUndefined();
      expect(snapshot.visible.origin).toEqual({ x: 0, y: 0 });
      expect(snapshot.visible.cells).toHaveLength(5);
      expect(snapshot.visible.cells[0]).toHaveLength(5);
      expect(snapshot.players.every((player) => player.pos)).toBe(true);
    }
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
    expect(otherFromFirst?.hue).toBe(20);
    expect(otherFromSecond?.hue).toBe(0);
    expect(otherFromFirst?.energy).toBe(1);
    expect(otherFromSecond?.energy).toBe(1);
    expect(otherFromFirst?.defeated).toBe(false);
    expect(otherFromSecond?.defeated).toBe(false);
    expect(first.you.energy).toBe(1);
    expect(second.you.energy).toBe(1);
    expect(first.you.defeated).toBe(false);
    expect(second.you.defeated).toBe(false);
    expect(otherFromFirst).not.toHaveProperty('skipNext');
    expect(otherFromSecond).not.toHaveProperty('skipNext');
    expect(first.visible.exits).toEqual([]);
    expect(second.visible.exits).toEqual([]);
    expect(first.you.pos).toEqual({ x: 1, y: 1 });
    expect(second.you.pos).toEqual({ x: 5, y: 5 });
  });
});
