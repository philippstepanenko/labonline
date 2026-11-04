import { describe, expect, it } from 'vitest';
import {
  cellKey,
  generateMaze,
  parseKey,
  type Maze,
} from '../src/server/maze';

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

  it('приводит размеры к нечётным', () => {
    const maze = generateMaze(3, 20, 10, mulberry32(1));
    expect(maze.width % 2).toBe(1);
    expect(maze.height % 2).toBe(1);
    expect(maze.width).toBeGreaterThanOrEqual(21);
    expect(maze.height).toBeGreaterThanOrEqual(11);
  });

  it('бросает ошибку, если лабиринт слишком мал для числа игроков', () => {
    expect(() => generateMaze(16, 7, 7, mulberry32(1))).toThrow();
  });
});
