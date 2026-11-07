import { describe, expect, it } from 'vitest';
import {
  collectTiles,
  groupPlayers,
  tileToWorld,
} from '../public/js/render3d-model.js';

describe('tileToWorld', () => {
  it('центрирует карту нечётного размера', () => {
    expect(tileToWorld(0, 0, 9, 9)).toEqual({ x: -4, y: 0, z: -4 });
    expect(tileToWorld(8, 8, 9, 9)).toEqual({ x: 4, y: 0, z: 4 });
    expect(tileToWorld(4, 4, 9, 9)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('центрирует карту с разными сторонами', () => {
    expect(tileToWorld(0, 0, 15, 9)).toEqual({ x: -7, y: 0, z: -4 });
    expect(tileToWorld(14, 8, 15, 9)).toEqual({ x: 7, y: 0, z: 4 });
  });
});

describe('collectTiles', () => {
  it('возвращает известные клетки с признаком видимости', () => {
    const current = {
      known: new Map([
        ['0,0', 'wall'],
        ['1,0', 'floor'],
        ['2,0', 'exit'],
      ]),
      visibleNow: new Set(['1,0', '2,0']),
    };

    expect(collectTiles(current)).toEqual([
      { x: 0, y: 0, type: 'wall', visible: false },
      { x: 1, y: 0, type: 'floor', visible: true },
      { x: 2, y: 0, type: 'exit', visible: true },
    ]);
  });

  it('игнорирует некорректные ключи', () => {
    const current = {
      known: new Map([['bad', 'floor']]),
      visibleNow: new Set(),
    };

    expect(collectTiles(current)).toEqual([]);
  });
});

describe('groupPlayers', () => {
  it('пропускает сбежавших и игроков без позиции', () => {
    const players = [
      { id: 'a', pos: { x: 1, y: 1 }, escaped: false },
      { id: 'b', escaped: false },
      { id: 'c', pos: { x: 2, y: 2 }, escaped: true },
    ];

    expect(groupPlayers(players, 'a')).toEqual([
      {
        player: players[0],
        offsetX: 0,
        offsetZ: 0,
        count: 1,
        isYou: true,
      },
    ]);
  });

  it('симметрично раскладывает игроков на одной клетке', () => {
    const players = [
      { id: 'a', pos: { x: 3, y: 4 }, escaped: false },
      { id: 'b', pos: { x: 3, y: 4 }, escaped: false },
      { id: 'c', pos: { x: 3, y: 4 }, escaped: false },
    ];

    const entries = groupPlayers(players, 'b');

    expect(entries).toHaveLength(3);
    expect(entries.map((entry: { offsetX: number }) => entry.offsetX)).toEqual([
      -0.22, 0, 0.22,
    ]);
    expect(entries.every((entry: { count: number }) => entry.count === 3)).toBe(
      true,
    );
    expect(
      entries.map((entry: { isYou: boolean }) => entry.isYou),
    ).toEqual([false, true, false]);
  });
});
