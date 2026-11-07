export const BOARD_BACKGROUND = '#070a10';

export const TILE_COLORS = {
  wall: {
    remembered: '#202839',
    visible: '#3a465e',
  },
  floor: {
    remembered: '#111722',
    visible: '#20293a',
  },
  exit: {
    remembered: '#1d6b42',
    visible: '#33cc7a',
  },
};

export function tileColor(type, visible) {
  const entry = TILE_COLORS[type];
  if (!entry) return BOARD_BACKGROUND;
  return visible ? entry.visible : entry.remembered;
}
