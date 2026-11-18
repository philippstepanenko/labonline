export const state = {
  screen: 'join',
  youId: null,
  name: '',
  maxPlayers: 8,
  minPlayers: 2,
  rooms: [],
  roomId: null,
  ownerId: null,
  mazeWidth: 0,
  mazeHeight: 0,
  lobby: null,
  phase: 'lobby',
  width: 0,
  height: 0,
  known: new Map(),
  visibleNow: new Set(),
  turn: null,
  you: null,
  players: [],
  exitsRemaining: 0,
  log: [],
  over: null,
  spectate: null,
  watchedId: null,
  busy: false,
};

export function pointKey(x, y) {
  return `${x},${y}`;
}

export function cellType(cell) {
  if (cell === 'E') return 'exit';
  if (cell === 'X') return 'exitUsed';
  if (cell === '#') return 'wall';
  return 'floor';
}

export function hueForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function hueForPlayer(player) {
  if (player && Number.isFinite(player.hue)) return player.hue;
  return hueForId(player && player.id ? player.id : '');
}

export function resetForStart(message) {
  state.youId = message.youId;
  state.phase = 'playing';
  state.over = null;
  state.busy = false;
  state.lobby = null;
  state.width = message.width;
  state.height = message.height;
  state.known = new Map();
  state.visibleNow = new Set();
  state.turn = null;
  state.you = null;
  state.players = [];
  state.log = [];
  state.exitsRemaining = 0;
  state.spectate = null;
  state.watchedId = null;
}

export function applyState(message) {
  state.phase = message.phase;
  state.width = message.width;
  state.height = message.height;
  state.turn = message.turn;
  state.you = message.you;
  state.players = message.players;
  state.exitsRemaining = message.exitsRemaining;
  state.log = message.log;
  state.busy = false;
  state.spectate = message.spectate ?? null;
  state.watchedId = message.spectate?.targetId ?? null;
  state.visibleNow = new Set();

  if (message.spectate) {
    state.known = new Map();
    for (const [x, y, cell] of message.spectate.known) {
      state.known.set(pointKey(x, y), cellType(cell));
    }
  }

  const { origin, cells } = message.visible;
  for (let dy = 0; dy < cells.length; dy++) {
    const row = cells[dy];
    for (let dx = 0; dx < row.length; dx++) {
      const x = origin.x + dx;
      const y = origin.y + dy;
      const cell = row[dx];
      state.known.set(pointKey(x, y), cellType(cell));
      state.visibleNow.add(pointKey(x, y));
    }
  }
}

export function canMove() {
  return Boolean(
    state.phase === 'playing' &&
      !state.over &&
      state.you &&
      state.you.energy >= 1 &&
      state.turn &&
      state.turn.id === state.you.id &&
      !state.you.pending &&
      !state.busy,
  );
}
