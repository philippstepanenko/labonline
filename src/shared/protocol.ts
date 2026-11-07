export type Dir = 'up' | 'down' | 'left' | 'right';
export type CellChar = '#' | '.' | 'E';
export type GamePhase = 'lobby' | 'playing' | 'over';
export type PendingRole = 'choose' | 'wait' | 'respond' | null;

export interface Point {
  x: number;
  y: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
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
  phase: GamePhase;
}

export interface NamedPlayer {
  id: string;
  name: string;
}

export interface StatePlayer {
  id: string;
  name: string;
  escaped: boolean;
  active: boolean;
  connected: boolean;
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

export interface StateMessage {
  type: 'state';
  phase: 'playing' | 'over';
  width: number;
  height: number;
  turn: NamedPlayer | null;
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
  log: string[];
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
  | { type: 'createRoom'; name: string; width: number; height: number }
  | { type: 'joinRoom'; name: string; roomId: string }
  | { type: 'leaveRoom' }
  | { type: 'setMazeSize'; width: number; height: number }
  | { type: 'ready'; value: boolean }
  | { type: 'move'; dir: Dir }
  | { type: 'chooseAction'; action: 'swap' | 'fight' }
  | { type: 'respondSwap'; accept: boolean }
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
  | { type: 'error'; code: string; message: string };

export type SendFn = (message: ServerMessage) => void;
