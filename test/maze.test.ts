import { describe, expect, it } from 'vitest';
import {
  cellKey,
  generateMaze,
  parseKey,
  type Maze,
} from '../src/server/maze';
import type {
  CorridorWidth,
  MazeAlgorithm,
} from '../src/shared/protocol';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allFloors(maze: Maze): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if (!maze.walls[y][x]) result.push({ x, y });
    }
  }
  return result;
}

function floorNeighbours(
  maze: Maze,
  point: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = point.x + dx;
    const y = point.y + dy;
    if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) continue;
    if (!maze.walls[y][x]) result.push({ x, y });
  }
  return result;
}

function deadEnds(maze: Maze): Array<{ x: number; y: number }> {
  return allFloors(maze).filter(
    (floor) => floorNeighbours(maze, floor).length === 1,
  );
}

function bfs(
  maze: Maze,
  start: { x: number; y: number },
): number[][] {
  const distance = Array.from({ length: maze.height }, () =>
    Array<number>(maze.width).fill(-1),
  );
  const queue = [start];
  distance[start.y][start.x] = 0;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) continue;
      if (maze.walls[y][x]) continue;
      if (distance[y][x] !== -1) continue;
      distance[y][x] = distance[current.y][current.x] + 1;
      queue.push({ x, y });
    }
  }

  return distance;
}

function belongsToFloorSquare(
  maze: Maze,
  point: { x: number; y: number },
  size: number,
): boolean {
  for (let offsetY = 0; offsetY < size; offsetY++) {
    for (let offsetX = 0; offsetX < size; offsetX++) {
      const startX = point.x - offsetX;
      const startY = point.y - offsetY;
      if (
        startX < 0 ||
        startY < 0 ||
        startX + size > maze.width ||
        startY + size > maze.height
      ) {
        continue;
      }

      let allFloor = true;
      for (let dy = 0; dy < size && allFloor; dy++) {
        for (let dx = 0; dx < size; dx++) {
          if (maze.walls[startY + dy][startX + dx]) {
            allFloor = false;
            break;
          }
        }
      }

      if (allFloor) return true;
    }
  }

  return false;
}

const ALGORITHMS: MazeAlgorithm[] = [
  'classic',
  'prim',
  'braided',
  'wide',
];

describe('generateMaze', () => {
  it('генерирует связный лабиринт с K−1 выходами и K стартами', () => {
    const maze = generateMaze(5, 21, 21, mulberry32(42));

    expect(maze.width).toBe(21);
    expect(maze.height).toBe(21);
    expect(maze.exits.size).toBe(4);
    expect(maze.starts).toHaveLength(5);

    const startKeys = new Set(maze.starts.map((p) => cellKey(p.x, p.y)));
    expect(startKeys.size).toBe(5);
    for (const key of startKeys) {
      expect(maze.exits.has(key)).toBe(false);
    }

    const floors = allFloors(maze);
    expect(floors.length).toBeGreaterThan(0);

    const reachableFromFirst = bfs(maze, floors[0]);
    for (const floor of floors) {
      expect(reachableFromFirst[floor.y][floor.x]).toBeGreaterThanOrEqual(0);
    }

    for (const start of maze.starts) {
      const distance = bfs(maze, start);
      for (const exitKey of maze.exits) {
        const exit = parseKey(exitKey);
        expect(distance[exit.y][exit.x]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('детерминирован при одинаковом seed', () => {
    const first = generateMaze(4, 15, 15, mulberry32(7));
    const second = generateMaze(4, 15, 15, mulberry32(7));

    expect(first.walls).toEqual(second.walls);
    expect([...first.exits].sort()).toEqual([...second.exits].sort());
    expect(first.starts).toEqual(second.starts);
  });

  it('принимает чётные размеры и сохраняет их', () => {
    const maze = generateMaze(3, 20, 10, mulberry32(1), {
      algorithm: 'classic',
      corridorWidth: 1,
    });
    expect(maze.width).toBe(20);
    expect(maze.height).toBe(10);
  });

  it('бросает ошибку, если лабиринт слишком мал для числа игроков', () => {
    expect(() =>
      generateMaze(16, 9, 9, mulberry32(1), { corridorWidth: 2 }),
    ).toThrow();
  });

  it('поддерживает все алгоритмы и ширины коридора', () => {
    for (const algorithm of ALGORITHMS) {
      for (const corridorWidth of [1, 2, 3] as CorridorWidth[]) {
        const maze = generateMaze(
          4,
          21,
          21,
          mulberry32(100 + corridorWidth),
          { algorithm, corridorWidth },
        );

        expect(maze.algorithm).toBe(algorithm);
        expect(maze.corridorWidth).toBe(corridorWidth);
        expect(maze.exits.size).toBe(3);
        expect(maze.starts).toHaveLength(4);

        const floors = allFloors(maze);
        const reachable = bfs(maze, floors[0]);
        for (const floor of floors) {
          expect(reachable[floor.y][floor.x]).toBeGreaterThanOrEqual(0);
          expect(
            belongsToFloorSquare(maze, floor, corridorWidth),
          ).toBe(true);
        }
      }
    }
  });

  it('ставит выходы не в тупиках', () => {
    for (const algorithm of ALGORITHMS) {
      const maze = generateMaze(6, 21, 21, mulberry32(321), {
        algorithm,
        corridorWidth: 1,
      });
      const dead = new Set(
        deadEnds(maze).map((point) => cellKey(point.x, point.y)),
      );

      for (const exitKey of maze.exits) {
        expect(dead.has(exitKey)).toBe(false);
      }
    }
  });

  it('braided не оставляет тупиков при любой ширине коридора', () => {
    for (const corridorWidth of [1, 2, 3] as CorridorWidth[]) {
      const maze = generateMaze(5, 21, 21, mulberry32(99), {
        algorithm: 'braided',
        corridorWidth,
      });
      expect(deadEnds(maze)).toHaveLength(0);
    }
  });

  it('random выбирает алгоритм только из пула', () => {
    const pool: MazeAlgorithm[] = ['classic', 'wide'];
    for (let seed = 1; seed <= 10; seed++) {
      const maze = generateMaze(4, 15, 15, mulberry32(seed), {
        algorithm: 'random',
        algorithmPool: pool,
      });
      expect(pool).toContain(maze.algorithm);
    }
  });

  it('random с пустым пулом выбирает из всех алгоритмов', () => {
    const maze = generateMaze(4, 15, 15, mulberry32(5), {
      algorithm: 'random',
      algorithmPool: [],
    });
    expect(ALGORITHMS).toContain(maze.algorithm);
  });
});
