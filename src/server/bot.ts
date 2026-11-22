import type { CellChar, Dir, Point } from '../shared/protocol';
import type { Game } from './game';
import { cellKey, type RNG } from './maze';

export const BOT_ACTION_DELAY_MS = 450;

const DIRS: ReadonlyArray<{ dir: Dir; dx: number; dy: number }> = [
  { dir: 'up', dx: 0, dy: -1 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'left', dx: -1, dy: 0 },
  { dir: 'right', dx: 1, dy: 0 },
];

interface QueueEntry {
  x: number;
  y: number;
  first: Dir | null;
}

function inBounds(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function isWalkable(
  known: Map<string, CellChar>,
  x: number,
  y: number,
): boolean {
  const cell = known.get(cellKey(x, y));
  return cell !== undefined && cell !== '#';
}

function hasUnknownNeighbour(
  known: Map<string, CellChar>,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return DIRS.some(({ dx, dy }) => {
    const nx = x + dx;
    const ny = y + dy;
    return (
      inBounds(nx, ny, width, height) &&
      !known.has(cellKey(nx, ny))
    );
  });
}

function bfsFirstStep(
  pos: Point,
  known: Map<string, CellChar>,
  width: number,
  height: number,
  target: (x: number, y: number) => boolean,
): Dir | null {
  const queue: QueueEntry[] = [{ x: pos.x, y: pos.y, first: null }];
  const visited = new Set([cellKey(pos.x, pos.y)]);

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];

    if (current.first && target(current.x, current.y)) {
      return current.first;
    }

    for (const { dir, dx, dy } of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!inBounds(nx, ny, width, height)) continue;
      if (!isWalkable(known, nx, ny)) continue;

      const key = cellKey(nx, ny);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({
        x: nx,
        y: ny,
        first: current.first ?? dir,
      });
    }
  }

  return null;
}

export function chooseExploreDir(
  pos: Point,
  knownInput: Map<string, CellChar>,
  width: number,
  height: number,
  rng: RNG,
): Dir | null {
  const known = new Map(knownInput);
  const startKey = cellKey(pos.x, pos.y);
  if (!known.has(startKey)) known.set(startKey, '.');

  const toExit = bfsFirstStep(
    pos,
    known,
    width,
    height,
    (x, y) => known.get(cellKey(x, y)) === 'E',
  );
  if (toExit) return toExit;

  const toFrontier = bfsFirstStep(
    pos,
    known,
    width,
    height,
    (x, y) => hasUnknownNeighbour(known, x, y, width, height),
  );
  if (toFrontier) return toFrontier;

  const neighbours: Dir[] = [];
  for (const { dir, dx, dy } of DIRS) {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (inBounds(nx, ny, width, height) && isWalkable(known, nx, ny)) {
      neighbours.push(dir);
    }
  }

  if (neighbours.length === 0) return null;
  return neighbours[Math.floor(rng() * neighbours.length)];
}

export function chooseBotAction(rng: RNG): 'fight' | 'swap' {
  return rng() < 0.5 ? 'fight' : 'swap';
}

export function chooseBotSwapResponse(rng: RNG): boolean {
  return rng() < 0.5;
}

export function nextBotId(
  game: Game,
  botIds: ReadonlySet<string>,
): string | null {
  const debug = game.debug();

  if (debug.pending) {
    if (debug.pending.stage === 'choose') {
      return botIds.has(debug.pending.initiatorId)
        ? debug.pending.initiatorId
        : null;
    }
    return botIds.has(debug.pending.targetId)
      ? debug.pending.targetId
      : null;
  }

  const current = game.currentPlayerId;
  return current && botIds.has(current) ? current : null;
}

export function performBotAction(
  game: Game,
  botId: string,
  rng: RNG,
): boolean {
  const debug = game.debug();
  const bot = debug.players.find((player) => player.id === botId);
  if (!bot || !bot.active || bot.escaped) return false;

  if (debug.pending) {
    if (debug.pending.stage === 'choose') {
      if (debug.pending.initiatorId !== botId) return false;
      game.chooseAction(botId, chooseBotAction(rng));
      return true;
    }

    if (debug.pending.targetId !== botId) return false;
    game.respondSwap(botId, chooseBotSwapResponse(rng));
    return true;
  }

  if (game.currentPlayerId !== botId) return false;
  if (bot.energy < 1) return false;

  const dir = chooseExploreDir(
    bot.pos,
    game.knownFor(botId),
    game.width,
    game.height,
    rng,
  );
  if (!dir) return false;

  game.move(botId, dir);
  return true;
}
