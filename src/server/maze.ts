import {
  DEFAULT_CORRIDOR_WIDTH,
  DEFAULT_MAZE_ALGORITHM,
  MAX_MAZE_SIZE,
  MIN_MAZE_SIZE,
  isMazeAlgorithm,
} from '../shared/config';
import type {
  CorridorWidth,
  MazeAlgorithm,
  MazeAlgorithmChoice,
  Point,
} from '../shared/protocol';

export type RNG = () => number;

export interface Maze {
  width: number;
  height: number;
  walls: boolean[][];
  exits: Set<string>;
  starts: Point[];
}

export interface GeneratedMaze extends Maze {
  algorithm: MazeAlgorithm;
  corridorWidth: CorridorWidth;
}

export interface MazeGenerationOptions {
  algorithm?: MazeAlgorithmChoice;
  corridorWidth?: number;
  algorithmPool?: MazeAlgorithm[];
}

interface LogicalGrid {
  cols: number;
  rows: number;
  right: boolean[][];
  down: boolean[][];
}

const DIRS4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseKey(key: string): Point {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function inBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function shuffle<T>(items: T[], rng: RNG): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return MIN_MAZE_SIZE;
  const clamped = Math.min(
    MAX_MAZE_SIZE,
    Math.max(MIN_MAZE_SIZE, Math.floor(value)),
  );
  return clamped;
}

function normalizeCorridorWidth(value: number | undefined): CorridorWidth {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CORRIDOR_WIDTH;
  }
  const clamped = Math.min(3, Math.max(1, Math.round(value)));
  return clamped as CorridorWidth;
}

function resolveAlgorithm(
  choice: MazeAlgorithmChoice,
  pool: MazeAlgorithm[] | undefined,
  rng: RNG,
): MazeAlgorithm {
  if (choice !== 'random') return choice;

  const candidates =
    pool && pool.length > 0 ? pool.filter(isMazeAlgorithm) : [];
  if (candidates.length === 0) return DEFAULT_MAZE_ALGORITHM;

  return candidates[Math.floor(rng() * candidates.length)];
}

function emptyLogicalGrid(cols: number, rows: number): LogicalGrid {
  return {
    cols,
    rows,
    right: Array.from({ length: cols }, () =>
      Array<boolean>(rows).fill(false),
    ),
    down: Array.from({ length: cols }, () =>
      Array<boolean>(rows).fill(false),
    ),
  };
}

function openBetween(grid: LogicalGrid, a: Point, b: Point): void {
  if (a.x === b.x) {
    const y = Math.min(a.y, b.y);
    grid.down[a.x][y] = true;
    return;
  }

  const x = Math.min(a.x, b.x);
  grid.right[x][a.y] = true;
}

function cellNeighbours(
  cols: number,
  rows: number,
  cell: Point,
): Point[] {
  const result: Point[] = [];
  for (const [dx, dy] of DIRS4) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (inBounds(x, y, cols, rows)) result.push({ x, y });
  }
  return result;
}

function degree(grid: LogicalGrid, cell: Point): number {
  let result = 0;
  const { x, y } = cell;
  if (x > 0 && grid.right[x - 1][y]) result += 1;
  if (x < grid.cols - 1 && grid.right[x][y]) result += 1;
  if (y > 0 && grid.down[x][y - 1]) result += 1;
  if (y < grid.rows - 1 && grid.down[x][y]) result += 1;
  return result;
}

function isOpenBetween(grid: LogicalGrid, a: Point, b: Point): boolean {
  if (a.x === b.x) {
    return grid.down[a.x][Math.min(a.y, b.y)];
  }
  return grid.right[Math.min(a.x, b.x)][a.y];
}

function carveClassic(cols: number, rows: number, rng: RNG): LogicalGrid {
  const grid = emptyLogicalGrid(cols, rows);
  const visited = Array.from({ length: cols }, () =>
    Array<boolean>(rows).fill(false),
  );

  const start = {
    x: Math.floor(rng() * cols),
    y: Math.floor(rng() * rows),
  };
  visited[start.x][start.y] = true;
  const stack: Point[] = [start];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = cellNeighbours(cols, rows, current).filter(
      (next) => !visited[next.x][next.y],
    );

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const next = options[Math.floor(rng() * options.length)];
    openBetween(grid, current, next);
    visited[next.x][next.y] = true;
    stack.push(next);
  }

  return grid;
}

function carvePrim(cols: number, rows: number, rng: RNG): LogicalGrid {
  const grid = emptyLogicalGrid(cols, rows);
  const visited = Array.from({ length: cols }, () =>
    Array<boolean>(rows).fill(false),
  );

  const start = {
    x: Math.floor(rng() * cols),
    y: Math.floor(rng() * rows),
  };
  visited[start.x][start.y] = true;

  const frontier: Array<{ from: Point; to: Point }> = [];

  const addFrontier = (cell: Point): void => {
    for (const next of cellNeighbours(cols, rows, cell)) {
      if (visited[next.x][next.y]) continue;
      frontier.push({ from: cell, to: next });
    }
  };

  addFrontier(start);

  while (frontier.length > 0) {
    const index = Math.floor(rng() * frontier.length);
    const edge = frontier[index];
    frontier[index] = frontier[frontier.length - 1];
    frontier.pop();

    if (visited[edge.to.x][edge.to.y]) continue;

    openBetween(grid, edge.from, edge.to);
    visited[edge.to.x][edge.to.y] = true;
    addFrontier(edge.to);
  }

  return grid;
}

function braidDeadEnds(grid: LogicalGrid, rng: RNG): void {
  const deadEnds: Point[] = [];
  for (let x = 0; x < grid.cols; x++) {
    for (let y = 0; y < grid.rows; y++) {
      if (degree(grid, { x, y }) === 1) deadEnds.push({ x, y });
    }
  }

  for (const deadEnd of deadEnds) {
    if (degree(grid, deadEnd) !== 1) continue;

    const candidates = cellNeighbours(
      grid.cols,
      grid.rows,
      deadEnd,
    ).filter((neighbour) => !isOpenBetween(grid, deadEnd, neighbour));
    if (candidates.length === 0) continue;

    const target = candidates[Math.floor(rng() * candidates.length)];
    openBetween(grid, deadEnd, target);
  }
}

function mergeRooms(grid: LogicalGrid, rng: RNG, ratio: number): void {
  const walls: Array<{ a: Point; b: Point }> = [];

  for (let x = 0; x < grid.cols; x++) {
    for (let y = 0; y < grid.rows; y++) {
      if (x < grid.cols - 1 && !grid.right[x][y]) {
        walls.push({ a: { x, y }, b: { x: x + 1, y } });
      }
      if (y < grid.rows - 1 && !grid.down[x][y]) {
        walls.push({ a: { x, y }, b: { x, y: y + 1 } });
      }
    }
  }

  const shuffled = shuffle(walls, rng);
  const count = Math.floor(shuffled.length * ratio);
  for (let index = 0; index < count; index++) {
    const wall = shuffled[index];
    openBetween(grid, wall.a, wall.b);
  }
}

function generateLogicalMaze(
  cols: number,
  rows: number,
  algorithm: MazeAlgorithm,
  rng: RNG,
): LogicalGrid {
  switch (algorithm) {
    case 'classic':
      return carveClassic(cols, rows, rng);
    case 'braided': {
      const grid = carvePrim(cols, rows, rng);
      braidDeadEnds(grid, rng);
      return grid;
    }
    case 'wide': {
      const grid = carvePrim(cols, rows, rng);
      mergeRooms(grid, rng, 0.2);
      return grid;
    }
    case 'prim':
    default:
      return carvePrim(cols, rows, rng);
  }
}

function expandToPhysical(
  grid: LogicalGrid,
  cellSize: number,
  openingWidth: number,
  width: number,
  height: number,
): boolean[][] {
  const walls: boolean[][] = Array.from({ length: height }, () =>
    Array<boolean>(width).fill(true),
  );

  const usedWidth = grid.cols * (cellSize + 1) + 1;
  const usedHeight = grid.rows * (cellSize + 1) + 1;
  const offsetX = Math.max(0, Math.floor((width - usedWidth) / 2));
  const offsetY = Math.max(0, Math.floor((height - usedHeight) / 2));

  const cellOriginX = (cx: number): number =>
    offsetX + 1 + cx * (cellSize + 1);
  const cellOriginY = (cy: number): number =>
    offsetY + 1 + cy * (cellSize + 1);

  for (let cx = 0; cx < grid.cols; cx++) {
    for (let cy = 0; cy < grid.rows; cy++) {
      const px = cellOriginX(cx);
      const py = cellOriginY(cy);
      for (let y = py; y < py + cellSize; y++) {
        for (let x = px; x < px + cellSize; x++) {
          walls[y][x] = false;
        }
      }
    }
  }

  const openingOffset = Math.floor((cellSize - openingWidth) / 2);

  for (let cx = 0; cx < grid.cols - 1; cx++) {
    for (let cy = 0; cy < grid.rows; cy++) {
      if (!grid.right[cx][cy]) continue;

      const wx = offsetX + cellSize + 1 + cx * (cellSize + 1);
      const py = cellOriginY(cy) + openingOffset;
      for (let y = py; y < py + openingWidth; y++) {
        walls[y][wx] = false;
      }
    }
  }

  for (let cx = 0; cx < grid.cols; cx++) {
    for (let cy = 0; cy < grid.rows - 1; cy++) {
      if (!grid.down[cx][cy]) continue;

      const wy = offsetY + cellSize + 1 + cy * (cellSize + 1);
      const px = cellOriginX(cx) + openingOffset;
      for (let x = px; x < px + openingWidth; x++) {
        walls[wy][x] = false;
      }
    }
  }

  return walls;
}

function collectFloors(walls: boolean[][]): Point[] {
  const floors: Point[] = [];
  for (let y = 0; y < walls.length; y++) {
    for (let x = 0; x < walls[y].length; x++) {
      if (!walls[y][x]) floors.push({ x, y });
    }
  }
  return floors;
}

function floorNeighbours(walls: boolean[][], p: Point): Point[] {
  const height = walls.length;
  const width = walls[0].length;
  const result: Point[] = [];
  for (const [dx, dy] of DIRS4) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (inBounds(x, y, width, height) && !walls[y][x]) {
      result.push({ x, y });
    }
  }
  return result;
}

function deadEnds(walls: boolean[][], floors: Point[]): Point[] {
  return floors.filter((p) => floorNeighbours(walls, p).length === 1);
}

function bfsDistances(walls: boolean[][], sources: Point[]): number[][] {
  const height = walls.length;
  const width = walls[0].length;
  const dist: number[][] = Array.from({ length: height }, () =>
    Array<number>(width).fill(-1),
  );
  const queue: Point[] = [];

  for (const source of sources) {
    if (
      inBounds(source.x, source.y, width, height) &&
      !walls[source.y][source.x] &&
      dist[source.y][source.x] === -1
    ) {
      dist[source.y][source.x] = 0;
      queue.push(source);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const nextDistance = dist[current.y][current.x] + 1;
    for (const [dx, dy] of DIRS4) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (!inBounds(x, y, width, height)) continue;
      if (walls[y][x]) continue;
      if (dist[y][x] !== -1) continue;
      dist[y][x] = nextDistance;
      queue.push({ x, y });
    }
  }

  return dist;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function pickSpread(
  candidates: Point[],
  count: number,
  seeds: Point[],
  walls: boolean[][],
  rng: RNG,
): Point[] {
  const available = candidates.filter(
    (candidate) => !seeds.some((seed) => samePoint(seed, candidate)),
  );
  const chosen: Point[] = [];
  const sources = [...seeds];

  if (sources.length === 0 && count > 0 && available.length > 0) {
    const firstIndex = Math.floor(rng() * available.length);
    const first = available.splice(firstIndex, 1)[0];
    chosen.push(first);
    sources.push(first);
  }

  while (chosen.length < count && available.length > 0) {
    const dist = bfsDistances(walls, sources);

    let bestIndex = -1;
    let bestDistance = -1;
    for (let i = 0; i < available.length; i++) {
      const distance = dist[available[i].y][available[i].x];
      if (distance < 0) continue;
      if (distance > bestDistance || (distance === bestDistance && rng() < 0.5)) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      bestIndex = Math.floor(rng() * available.length);
    }

    const [picked] = available.splice(bestIndex, 1);
    chosen.push(picked);
    sources.push(picked);
  }

  return chosen;
}

function cellSizeFor(
  algorithm: MazeAlgorithm,
  corridorWidth: CorridorWidth,
): number {
  if (algorithm === 'wide') return Math.max(3, corridorWidth);
  return corridorWidth;
}

export function generateMaze(
  playerCount: number,
  widthInput = 21,
  heightInput = 21,
  rng: RNG = Math.random,
  options: MazeGenerationOptions = {},
): GeneratedMaze {
  if (playerCount < 2) {
    throw new Error('Для игры нужно минимум 2 игрока');
  }

  const width = normalizeDimension(widthInput);
  const height = normalizeDimension(heightInput);
  const corridorWidth = normalizeCorridorWidth(options.corridorWidth);
  const algorithm = resolveAlgorithm(
    options.algorithm ?? DEFAULT_MAZE_ALGORITHM,
    options.algorithmPool,
    rng,
  );
  const cellSize = cellSizeFor(algorithm, corridorWidth);

  const cols = Math.max(2, Math.floor((width - 1) / (cellSize + 1)));
  const rows = Math.max(2, Math.floor((height - 1) / (cellSize + 1)));

  const logical = generateLogicalMaze(cols, rows, algorithm, rng);
  const walls = expandToPhysical(
    logical,
    cellSize,
    corridorWidth,
    width,
    height,
  );
  const floors = collectFloors(walls);

  if (floors.length < playerCount * 2 - 1) {
    throw new Error(
      'Лабиринт слишком мал для такого числа игроков: увеличьте размеры',
    );
  }

  const exitCount = playerCount - 1;
  const dead = deadEnds(walls, floors);
  const deadKeys = new Set(dead.map((point) => cellKey(point.x, point.y)));
  let exitCandidates = floors.filter(
    (floor) => !deadKeys.has(cellKey(floor.x, floor.y)),
  );
  if (exitCandidates.length < exitCount) exitCandidates = floors;

  const exits = pickSpread(exitCandidates, exitCount, [], walls, rng);

  const startCandidates = floors.filter(
    (floor) => !exits.some((exit) => samePoint(exit, floor)),
  );
  const starts = pickSpread(startCandidates, playerCount, exits, walls, rng);

  if (starts.length < playerCount) {
    throw new Error('Не удалось расставить стартовые позиции');
  }

  return {
    width,
    height,
    walls,
    exits: new Set(exits.map((exit) => cellKey(exit.x, exit.y))),
    starts,
    algorithm,
    corridorWidth,
  };
}
