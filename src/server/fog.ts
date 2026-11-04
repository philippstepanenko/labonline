import type { Point, VisibleArea } from '../shared/protocol';
import { cellKey } from './maze';

export const SIGHT_RADIUS = 1;

export interface VisibleWorld {
  width: number;
  height: number;
  walls: boolean[][];
  exits: Set<string>;
}

export function isWithinSight(center: Point, target: Point): boolean {
  return (
    Math.abs(center.x - target.x) <= SIGHT_RADIUS &&
    Math.abs(center.y - target.y) <= SIGHT_RADIUS
  );
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
      if (world.exits.has(cellKey(x, y))) {
        row.push('E');
        exits.push([x, y]);
      } else {
        row.push(world.walls[y][x] ? '#' : '.');
      }
    }
    cells.push(row);
  }

  return {
    origin: { x: originX, y: originY },
    cells,
    exits,
  };
}
