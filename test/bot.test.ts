import { describe, expect, it } from 'vitest';
import {
  chooseBotAction,
  chooseBotSwapResponse,
  chooseExploreDir,
  nextBotId,
  performBotAction,
} from '../src/server/bot';
import { Game, type GamePlayer } from '../src/server/game';
import type { Maze } from '../src/server/maze';
import type { CellChar, ServerMessage } from '../src/shared/protocol';

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

function known(cells: Array<[number, number, CellChar]>): Map<string, CellChar> {
  return new Map(cells.map(([x, y, cell]) => [`${x},${y}`, cell]));
}

describe('ИИ ботов', () => {
  it('идёт к известному выходу, даже если есть неизвестные клетки', () => {
    const map = known([
      [1, 1, '.'],
      [0, 1, '#'],
      [1, 0, '#'],
      [1, 2, '.'],
      [2, 1, 'E'],
    ]);

    expect(chooseExploreDir({ x: 1, y: 1 }, map, 5, 5, () => 0)).toBe('right');
  });

  it('идёт к ближайшей границе известной карты', () => {
    const map = known([
      [1, 1, '.'],
      [0, 1, '#'],
      [2, 1, '#'],
      [1, 0, '#'],
      [1, 2, '.'],
      [0, 2, '#'],
      [2, 2, '#'],
      [1, 3, '.'],
      [0, 3, '#'],
      [1, 4, '#'],
    ]);

    expect(chooseExploreDir({ x: 1, y: 1 }, map, 5, 5, () => 0)).toBe('down');
  });

  it('делает случайный шаг, когда исследовать больше нечего', () => {
    const map = known([
      [1, 1, '.'],
      [2, 1, '.'],
      [0, 1, '#'],
      [3, 1, '#'],
      [1, 0, '#'],
      [2, 0, '#'],
      [1, 2, '#'],
      [2, 2, '#'],
    ]);

    expect(chooseExploreDir({ x: 1, y: 1 }, map, 5, 5, () => 0)).toBe('right');
  });

  it('случайно выбирает бой или обмен и ответ на обмен', () => {
    expect(chooseBotAction(() => 0.1)).toBe('fight');
    expect(chooseBotAction(() => 0.9)).toBe('swap');
    expect(chooseBotSwapResponse(() => 0.1)).toBe(true);
    expect(chooseBotSwapResponse(() => 0.9)).toBe(false);
  });

  it('двигает бота и передаёт ход дальше', () => {
    const sent: SentMessage[] = [];
    const players = makePlayers(['bot', 'human'], sent);
    players[0].bot = true;

    const game = new Game({
      players,
      order: ['bot', 'human'],
      maze: openMaze(5, 5, [[1, 1], [3, 3]], [[3, 1]]),
      rng: () => 0.1,
    });

    const before = game.debug().players.find((player) => player.id === 'bot')!;
    expect(nextBotId(game, new Set(['bot']))).toBe('bot');
    expect(performBotAction(game, 'bot', () => 0.1)).toBe(true);

    const after = game.debug().players.find((player) => player.id === 'bot')!;
    expect(after.pos).not.toEqual(before.pos);
    expect(game.currentPlayerId).toBe('human');
    expect(nextBotId(game, new Set(['bot']))).toBeNull();
  });

  it('выбирает обмен и ждёт ответа другого игрока', () => {
    const sent: SentMessage[] = [];
    const players = makePlayers(['bot', 'human'], sent);
    players[0].bot = true;

    const game = new Game({
      players,
      order: ['bot', 'human'],
      maze: openMaze(5, 5, [[1, 1], [2, 1]], [[3, 3]]),
      rng: () => 0.1,
    });

    game.move('bot', 'right');
    expect(game.debug().pending?.stage).toBe('choose');
    expect(nextBotId(game, new Set(['bot']))).toBe('bot');

    expect(performBotAction(game, 'bot', () => 0.9)).toBe(true);
    expect(game.debug().pending?.stage).toBe('awaitSwap');
    expect(nextBotId(game, new Set(['bot']))).toBeNull();
  });
});
