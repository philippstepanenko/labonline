import type { CellChar, Point, VisibleArea } from '../shared/protocol';
import { cellKey } from './maze';

export const SIGHT_RADIUS = 1;

export interface VisibleWorld {
  width: number;
  height: number;
  walls: boolean[][];
  exits: Set<string>;
  usedExits: Set<string>;
}

export function isWithinSight(center: Point, target: Point): boolean {
  return (
    Math.abs(center.x - target.x) <= SIGHT_RADIUS &&
    Math.abs(center.y - target.y) <= SIGHT_RADIUS
  );
}

function cellAt(world: VisibleWorld, x: number, y: number): CellChar {
  if (world.exits.has(cellKey(x, y))) return 'E';
  if (world.usedExits.has(cellKey(x, y))) return 'X';
  return world.walls[y][x] ? '#' : '.';
}

export function computeFullMap(world: VisibleWorld): VisibleArea {
  const cells: VisibleArea['cells'] = [];
  const exits: [number, number][] = [];

  for (let y = 0; y < world.height; y++) {
    const row: VisibleArea['cells'][number] = [];
    for (let x = 0; x < world.width; x++) {
      const cell = cellAt(world, x, y);
      row.push(cell);
      if (cell === 'E') exits.push([x, y]);
    }
    cells.push(row);
  }

  return {
    origin: { x: 0, y: 0 },
    cells,
    exits,
  };
}

export function computeVisible(world: VisibleWorld, pos: Point): VisibleArea {
  const originX = Math.max(0, pos.x - SIGHT_RADIUS);
  const originY = Math.max(0, pos.y - SIGHT_RADIUS);
  const maxX = Math.min(world.width - 1, pos.x + SIGHT_RADIUS);
  const maxY = Math.min(world.height - 1, pos.y + SIGHT_RADIUS);

  const cells: VisibleArea['cells'] = [];
  const exits: [number, number][] = [];

  for (let y = originY; y <= maxY; y++) {
    const row: VisibleArea['cells'][number] = [];
    for (let x = originX; x <= maxX; x++) {
      const cell = cellAt(world, x, y);
      row.push(cell);
      if (cell === 'E') exits.push([x, y]);
    }
    cells.push(row);
  }

  return {
    origin: { x: originX, y: originY },
    cells,
    exits,
  };
}
