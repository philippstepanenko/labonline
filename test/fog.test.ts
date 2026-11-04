import { describe, expect, it } from 'vitest';
import { computeVisible, isWithinSight } from '../src/server/fog';

const walls = Array.from({ length: 5 }, (_, y) =>
  Array.from({ length: 5 }, (_, x) => x === 0 || y === 0 || x === 4 || y === 4),
);

const world = {
  width: 5,
  height: 5,
  walls,
  exits: new Set(['2,1', '4,4']),
};

describe('computeVisible', () => {
  it('обрезает область по краю карты', () => {
    const visible = computeVisible(world, { x: 0, y: 0 });

    expect(visible.origin).toEqual({ x: 0, y: 0 });
    expect(visible.cells).toHaveLength(2);
    expect(visible.cells.every((row) => row.length === 2)).toBe(true);
    expect(visible.exits).toEqual([]);
  });

  it('возвращает квадрат 3×3 и видимые выходы', () => {
    const visible = computeVisible(world, { x: 2, y: 2 });

    expect(visible.origin).toEqual({ x: 1, y: 1 });
    expect(visible.cells).toHaveLength(3);
    expect(visible.cells.every((row) => row.length === 3)).toBe(true);
    expect(visible.cells[0][1]).toBe('E');
    expect(visible.exits).toEqual([[2, 1]]);
  });

  it('не показывает выход за пределами радиуса', () => {
    const visible = computeVisible(world, { x: 3, y: 3 });
    expect(visible.exits).toEqual([[4, 4]]);
    expect(visible.exits).not.toContainEqual([2, 1]);
  });
});

describe('isWithinSight', () => {
  it('видит 8 соседних клеток и себя', () => {
    expect(isWithinSight({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(true);
    expect(isWithinSight({ x: 2, y: 2 }, { x: 1, y: 1 })).toBe(true);
    expect(isWithinSight({ x: 2, y: 2 }, { x: 3, y: 3 })).toBe(true);
  });

  it('не видит дальше одной клетки', () => {
    expect(isWithinSight({ x: 2, y: 2 }, { x: 4, y: 2 })).toBe(false);
    expect(isWithinSight({ x: 2, y: 2 }, { x: 2, y: 0 })).toBe(false);
  });
});
