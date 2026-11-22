export const PLAYER_HUES: readonly number[] = [
  0, 23, 45, 90, 180, 225, 270, 293,
];

export function isPlayerHue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    PLAYER_HUES.includes(value)
  );
}

export function pickFreeHue(used: Iterable<number>): number {
  const taken = new Set(used);
  return PLAYER_HUES.find((hue) => !taken.has(hue)) ?? PLAYER_HUES[0];
}

export function pickRandomFreeHue(used: Iterable<number>): number {
  const free = PLAYER_HUES.filter((hue) => !new Set(used).has(hue));
  return free.length ? free[Math.floor(Math.random() * free.length)] : PLAYER_HUES[0];
}