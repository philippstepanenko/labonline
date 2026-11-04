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

function oddAtLeast(value: number, min: number): number {
  const clamped = Math.max(min, value);
  return clamped % 2 === 0 ? clamped + 1 : clamped;
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
    mazeWidth: oddAtLeast(overrides.mazeWidth ?? readInt('MAZE_WIDTH', 9), 7),
    mazeHeight: oddAtLeast(
      overrides.mazeHeight ?? readInt('MAZE_HEIGHT', 9),
      7,
    ),
  };
}
