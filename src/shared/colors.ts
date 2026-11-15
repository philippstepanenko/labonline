export const PLAYER_HUES: readonly number[] = [
  0, 23, 45, 68, 90, 113, 135, 158, 180, 203, 225, 248, 270, 293, 315, 338,
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
