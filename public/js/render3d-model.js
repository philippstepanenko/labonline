export const TILE_SIZE = 1;
export const PLAYER_SPACING = 0.22;

export function tileKey(x, y) {
  return `${x},${y}`;
}

export function tileToWorld(x, y, width, height) {
  return {
    x: (x - width / 2 + 0.5) * TILE_SIZE,
    y: 0,
    z: (y - height / 2 + 0.5) * TILE_SIZE,
  };
}

export function collectTiles(current) {
  const tiles = [];
  for (const [key, type] of current.known) {
    const [x, y] = key.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    tiles.push({
      x,
      y,
      type,
      visible: current.visibleNow.has(key),
    });
  }
  return tiles;
}

export function groupPlayers(players, youId) {
  const groups = new Map();
  for (const player of players) {
    if (!player.pos || player.escaped) continue;
    const key = tileKey(player.pos.x, player.pos.y);
    const group = groups.get(key);
    if (group) {
      group.push(player);
    } else {
      groups.set(key, [player]);
    }
  }

  const result = [];
  for (const group of groups.values()) {
    const count = group.length;
    group.forEach((player, index) => {
      result.push({
        player,
        offsetX: (index - (count - 1) / 2) * PLAYER_SPACING,
        offsetZ: 0,
        count,
        isYou: player.id === youId,
      });
    });
  }
  return result;
}
