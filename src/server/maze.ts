import type { Point } from '../shared/protocol';

export type RNG = () => number;

export interface Maze {
  width: number;
  height: number;
  walls: boolean[][];
  exits: Set<string>;
  starts: Point[];
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

function inBounds(x: number, y: number, width: number, height: number): boolean {
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

function makeOdd(value: number, min: number): number {
  const clamped = Math.max(min, Math.floor(value));
  return clamped % 2 === 0 ? clamped + 1 : clamped;
}

function carveMaze(width: number, height: number, rng: RNG): boolean[][] {
  const walls: boolean[][] = Array.from({ length: height }, () =>
    Array<boolean>(width).fill(true),
  );

  const startX = 1;
  const startY = 1;
  walls[startY][startX] = false;

  const stack: Point[] = [{ x: startX, y: startY }];
  const steps: ReadonlyArray<readonly [number, number]> = [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = steps
      .map(([dx, dy]) => ({ x: current.x + dx, y: current.y + dy }))
      .filter(
        (p) =>
          inBounds(p.x, p.y, width, height) && walls[p.y][p.x],
      );

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const next = options[Math.floor(rng() * options.length)];
    const betweenX = (current.x + next.x) / 2;
    const betweenY = (current.y + next.y) / 2;
    walls[betweenY][betweenX] = false;
    walls[next.y][next.x] = false;
    stack.push(next);
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

export function generateMaze(
  playerCount: number,
  widthInput = 21,
  heightInput = 21,
  rng: RNG = Math.random,
): Maze {
  if (playerCount < 2) {
    throw new Error('Для игры нужно минимум 2 игрока');
  }

  const width = makeOdd(widthInput, 7);
  const height = makeOdd(heightInput, 7);
  const walls = carveMaze(width, height, rng);
  const floors = collectFloors(walls);

  if (floors.length < playerCount * 2 - 1) {
    throw new Error(
      'Лабиринт слишком мал для такого числа игроков: увеличьте размеры',
    );
  }

  const exitCount = playerCount - 1;
  const dead = deadEnds(walls, floors);
  const exitCandidates = dead.length >= exitCount ? dead : floors;
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
  };
}
