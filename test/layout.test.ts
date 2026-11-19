import { describe, expect, it } from 'vitest';
import { fitTileSize } from '../public/js/layout.js';

describe('fitTileSize', () => {
  it('масштабирует карту под доступную область без лимита 30px', () => {
    expect(
      fitTileSize({
        availableWidth: 800,
        availableHeight: 600,
        columns: 15,
        rows: 15,
        minTile: 10,
      }),
    ).toBe(40);
  });

  it('учитывает прямоугольную карту', () => {
    expect(
      fitTileSize({
        availableWidth: 800,
        availableHeight: 600,
        columns: 20,
        rows: 10,
        minTile: 10,
      }),
    ).toBe(40);
  });

  it('не уменьшает клетку ниже минимума', () => {
    expect(
      fitTileSize({
        availableWidth: 50,
        availableHeight: 50,
        columns: 20,
        rows: 20,
        minTile: 10,
      }),
    ).toBe(10);
  });

  it('возвращает минимум при нулевых или некорректных размерах', () => {
    const fallback = {
      availableWidth: 0,
      availableHeight: 0,
      columns: 15,
      rows: 15,
      minTile: 10,
    };

    expect(fitTileSize(fallback)).toBe(10);
    expect(
      fitTileSize({
        ...fallback,
        availableWidth: Number.NaN,
        availableHeight: Number.POSITIVE_INFINITY,
      }),
    ).toBe(10);
  });
});
