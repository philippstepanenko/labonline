import { describe, expect, it } from 'vitest';
import { TILE_COLORS } from '../public/js/palette.js';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = channel((value >> 16) & 0xff);
  const green = channel((value >> 8) & 0xff);
  const blue = channel(value & 0xff);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

describe('Палитра клеток', () => {
  it('делает видимый пол ярче запомненного', () => {
    expect(luminance(TILE_COLORS.floor.visible)).toBeGreaterThan(
      luminance(TILE_COLORS.floor.remembered),
    );
  });

  it('делает запомненную стену заметно ярче видимого пола', () => {
    expect(luminance(TILE_COLORS.wall.remembered)).toBeGreaterThan(
      luminance(TILE_COLORS.floor.visible) * 1.4,
    );
  });

  it('делает видимую стену заметно ярче запомненной', () => {
    expect(luminance(TILE_COLORS.wall.visible)).toBeGreaterThan(
      luminance(TILE_COLORS.wall.remembered) * 1.8,
    );
  });

  it('делает видимый использованный выход ярче запомненного', () => {
    expect(luminance(TILE_COLORS.exitUsed.visible)).toBeGreaterThan(
      luminance(TILE_COLORS.exitUsed.remembered),
    );
  });
});
