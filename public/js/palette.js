export const BOARD_BACKGROUND = '#070a10';

export const PLAYER_COLORS = [
  { hue: 0, name: 'Красный' },
  { hue: 23, name: 'Оранжевый' },
  { hue: 45, name: 'Янтарный' },
  { hue: 68, name: 'Лаймовый' },
  { hue: 90, name: 'Зелёный' },
  { hue: 113, name: 'Изумрудный' },
  { hue: 135, name: 'Бирюзовый' },
  { hue: 158, name: 'Морской' },
  { hue: 180, name: 'Циан' },
  { hue: 203, name: 'Лазурный' },
  { hue: 225, name: 'Синий' },
  { hue: 248, name: 'Индиго' },
  { hue: 270, name: 'Фиолетовый' },
  { hue: 293, name: 'Пурпурный' },
  { hue: 315, name: 'Маджента' },
  { hue: 338, name: 'Розовый' },
];

export function playerColor(hue) {
  return `hsl(${hue} 70% 52%)`;
}

export function playerColorName(hue) {
  return PLAYER_COLORS.find((color) => color.hue === hue)?.name ?? 'Цвет';
}

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
  exitUsed: {
    remembered: '#5c1a1a',
    visible: '#ff4d4d',
  },
};

export function tileColor(type, visible) {
  const entry = TILE_COLORS[type];
  if (!entry) return BOARD_BACKGROUND;
  return visible ? entry.visible : entry.remembered;
}
