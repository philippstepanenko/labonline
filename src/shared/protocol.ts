export type Dir = 'up' | 'down' | 'left' | 'right';
export type CellChar = '#' | '.' | 'E' | 'X';
export type GamePhase = 'lobby' | 'playing' | 'over';
export type PendingRole = 'choose' | 'wait' | 'respond' | null;
export type MazeAlgorithm = 'classic' | 'prim' | 'braided' | 'wide';
export type MazeAlgorithmChoice = MazeAlgorithm | 'random';
export type CorridorWidth = 1 | 2 | 3;

export interface Point {
  x: number;
  y: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  hue: number;
  ready: boolean;
  connected: boolean;
  bot: boolean;
}

export interface RoomSummary {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  playerCount: number;
  maxPlayers: number;
  minPlayers: number;
  mazeWidth: number;
  mazeHeight: number;
  algorithm: MazeAlgorithmChoice;
  corridorWidth: CorridorWidth;
  phase: GamePhase;
}

export interface NamedPlayer {
  id: string;
  name: string;
}

export interface StatePlayer {
  id: string;
  name: string;
  hue: number;
  escaped: boolean;
  active: boolean;
  connected: boolean;
  bot: boolean;
  energy: number;
  defeated: boolean;
  isTurn: boolean;
  pos?: Point;
}

export interface VisibleArea {
  origin: Point;
  cells: CellChar[][];
  exits: [number, number][];
}

export interface SpectateState {
  mode: 'auto' | 'player';
  targetId: string;
  targetName: string;
  known: Array<[number, number, CellChar]>;
}

export interface StateMessage {
  type: 'state';
  phase: 'playing' | 'over';
  width: number;
  height: number;
  turn: NamedPlayer | null;
  nextTurn: NamedPlayer | null;
  you: {
    id: string;
    name: string;
    pos: Point;
    energy: number;
    defeated: boolean;
    pending: PendingRole;
  };
  visible: VisibleArea;
  players: StatePlayer[];
  exitsRemaining: number;
  usedExits: [number, number][];
  log: string[];
  spectate?: SpectateState;
}

export type EventKind =
  | 'battle'
  | 'swap'
  | 'skip'
  | 'escape'
  | 'disconnect'
  | 'info';

export type ClientMessage =
  | { type: 'listRooms' }
  | {
      type: 'createRoom';
      name: string;
      width: number;
      height: number;
      algorithm?: MazeAlgorithmChoice;
      corridorWidth?: CorridorWidth;
      algorithmPool?: MazeAlgorithm[];
    }
  | { type: 'joinRoom'; name: string; roomId: string }
  | { type: 'leaveRoom' }
  | { type: 'addBot' }
  | { type: 'removeBot'; botId: string }
  | {
      type: 'setMazeOptions';
      width: number;
      height: number;
      algorithm: MazeAlgorithmChoice;
      corridorWidth: CorridorWidth;
      algorithmPool?: MazeAlgorithm[];
    }
  | { type: 'setMazeSize'; width: number; height: number }
  | { type: 'setColor'; hue: number }
  | { type: 'ready'; value: boolean }
  | { type: 'move'; dir: Dir }
  | { type: 'chooseAction'; action: 'swap' | 'fight' }
  | { type: 'respondSwap'; accept: boolean }
  | { type: 'spectate'; mode: 'auto' }
  | { type: 'spectate'; mode: 'player'; targetId: string }
  | { type: 'pong' }
  | { type: 'backToLobby' };

export type ServerMessage =
  | {
      type: 'welcome';
      youId: string;
      name: string;
      maxPlayers: number;
      roomId: string;
    }
  | { type: 'rooms'; rooms: RoomSummary[] }
  | {
      type: 'lobby';
      roomId: string;
      ownerId: string | null;
      mazeWidth: number;
      mazeHeight: number;
      algorithm: MazeAlgorithmChoice;
      corridorWidth: CorridorWidth;
      algorithmPool: MazeAlgorithm[];
      players: LobbyPlayer[];
      maxPlayers: number;
      minPlayers: number;
      canStart: boolean;
    }
  | {
      type: 'start';
      youId: string;
      width: number;
      height: number;
      algorithm: MazeAlgorithm;
      corridorWidth: CorridorWidth;
      order: NamedPlayer[];
      players: NamedPlayer[];
    }
  | StateMessage
  | {
      type: 'chooseAction';
      targetId: string;
      targetName: string;
      options: ['swap', 'fight'];
    }
  | { type: 'swapOffer'; fromId: string; fromName: string }
  | { type: 'event'; kind: EventKind; message: string }
  | {
      type: 'moveRejected';
      reason: 'wall' | 'notTurn' | 'pending' | 'noEnergy';
    }
  | { type: 'gameOver'; escaped: string[]; losers: string[] }
  | { type: 'ping' }
  | { type: 'error'; code: string; message: string };

export type SendFn = (message: ServerMessage) => void;
