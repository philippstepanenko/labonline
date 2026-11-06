export const MIN_MAZE_SIZE = 9;
export const MAX_MAZE_SIZE = 21;

export interface Config {
  port: number;
  maxPlayers: number;
  minPlayers: number;
  mazeWidth: number;
  mazeHeight: number;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeMazeSize(value: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value < MIN_MAZE_SIZE || value > MAX_MAZE_SIZE) return null;

  return value % 2 === 0 ? value + 1 : value;
}

function mazeSizeOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;

  const clamped = clamp(Math.floor(value), MIN_MAZE_SIZE, MAX_MAZE_SIZE);
  return clamped % 2 === 0 ? Math.min(clamped + 1, MAX_MAZE_SIZE) : clamped;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const maxPlayers = clamp(
    overrides.maxPlayers ?? readInt('MAX_PLAYERS', 8),
    2,
    16,
  );
  const minPlayers = clamp(
    overrides.minPlayers ?? readInt('MIN_PLAYERS', 2),
    2,
    maxPlayers,
  );

  return {
    port: overrides.port ?? readInt('PORT', 8080),
    maxPlayers,
    minPlayers,
    mazeWidth: mazeSizeOrDefault(
      overrides.mazeWidth ?? readInt('MAZE_WIDTH', 9),
      MIN_MAZE_SIZE,
    ),
    mazeHeight: mazeSizeOrDefault(
      overrides.mazeHeight ?? readInt('MAZE_HEIGHT', 9),
      MIN_MAZE_SIZE,
    ),
  };
}
