import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../public/js/palette.js';
import { PLAYER_HUES } from '../src/shared/colors';

describe('Палитра игроков', () => {
  it('совпадает на клиенте и сервере', () => {
    expect(PLAYER_COLORS.map((color: { hue: number }) => color.hue)).toEqual([
      ...PLAYER_HUES,
    ]);
  });
});
