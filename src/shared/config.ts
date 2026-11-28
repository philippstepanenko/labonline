import type {
  CorridorWidth,
  MazeAlgorithm,
  MazeAlgorithmChoice,
} from './protocol';

export const MIN_MAZE_SIZE = 9;
export const MAX_MAZE_SIZE = 21;
export const MIN_CORRIDOR_WIDTH = 1;
export const MAX_CORRIDOR_WIDTH = 3;
export const DEFAULT_MAZE_ALGORITHM: MazeAlgorithm = 'prim';
export const DEFAULT_CORRIDOR_WIDTH: CorridorWidth = 1;
export const MAZE_ALGORITHMS: readonly MazeAlgorithm[] = [
  'classic',
  'prim',
  'braided',
  'wide',
];

export interface MazeSettings {
  width: number;
  height: number;
  algorithm: MazeAlgorithmChoice;
  corridorWidth: CorridorWidth;
  algorithmPool: MazeAlgorithm[];
}

export type MazeSettingsResult =
  | { ok: true; value: MazeSettings }
  | { ok: false; code: string; message: string };

export interface Config {
  port: number;
  maxPlayers: number;
  minPlayers: number;
  mazeWidth: number;
  mazeHeight: number;
  heartbeatIntervalMs: number;
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

  return value;
}

function mazeSizeOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;

  return clamp(Math.floor(value), MIN_MAZE_SIZE, MAX_MAZE_SIZE);
}

export function isMazeAlgorithm(value: unknown): value is MazeAlgorithm {
  return (
    typeof value === 'string' &&
    (MAZE_ALGORITHMS as readonly string[]).includes(value)
  );
}

export function isMazeAlgorithmChoice(
  value: unknown,
): value is MazeAlgorithmChoice {
  return value === 'random' || isMazeAlgorithm(value);
}

export function isCorridorWidth(value: unknown): value is CorridorWidth {
  return value === 1 || value === 2 || value === 3;
}

function normalizeAlgorithmPool(
  algorithm: MazeAlgorithmChoice,
  pool: unknown,
): MazeAlgorithm[] {
  if (algorithm !== 'random') return [];

  const values = Array.isArray(pool) ? pool : [];
  const result: MazeAlgorithm[] = [];
  for (const value of values) {
    if (isMazeAlgorithm(value) && !result.includes(value)) {
      result.push(value);
    }
  }

  return result.length > 0 ? result : [...MAZE_ALGORITHMS];
}

export function normalizeMazeSettings(input: {
  width: unknown;
  height: unknown;
  algorithm?: unknown;
  corridorWidth?: unknown;
  algorithmPool?: unknown;
}): MazeSettingsResult {
  if (typeof input.width !== 'number' || typeof input.height !== 'number') {
    return {
      ok: false,
      code: 'bad_size',
      message: 'Размер должен быть целым числом от 9 до 21',
    };
  }

  const width = normalizeMazeSize(input.width);
  const height = normalizeMazeSize(input.height);
  if (width === null || height === null) {
    return {
      ok: false,
      code: 'bad_size',
      message: 'Размер должен быть целым числом от 9 до 21',
    };
  }

  const algorithm =
    input.algorithm === undefined ? DEFAULT_MAZE_ALGORITHM : input.algorithm;
  if (!isMazeAlgorithmChoice(algorithm)) {
    return {
      ok: false,
      code: 'bad_algorithm',
      message: 'Неизвестный алгоритм генерации лабиринта',
    };
  }

  const corridorWidth =
    input.corridorWidth === undefined
      ? DEFAULT_CORRIDOR_WIDTH
      : input.corridorWidth;
  if (!isCorridorWidth(corridorWidth)) {
    return {
      ok: false,
      code: 'bad_corridor',
      message: 'Ширина коридора должна быть от 1 до 3 клеток',
    };
  }

  return {
    ok: true,
    value: {
      width,
      height,
      algorithm,
      corridorWidth,
      algorithmPool: normalizeAlgorithmPool(algorithm, input.algorithmPool),
    },
  };
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
    heartbeatIntervalMs:
      overrides.heartbeatIntervalMs ??
      Math.max(1000, readInt('HEARTBEAT_INTERVAL_MS', 25000)),
  };
}
