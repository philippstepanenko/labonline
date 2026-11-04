import type {
  Dir,
  EventKind,
  NamedPlayer,
  PendingRole,
  Point,
  SendFn,
  ServerMessage,
  StateMessage,
  StatePlayer,
} from '../shared/protocol';
import { computeVisible, isWithinSight } from './fog';
import { cellKey, type Maze, type RNG } from './maze';

const DELTAS: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const MAX_LOG_ENTRIES = 50;

export interface GamePlayer {
  id: string;
  name: string;
  send: SendFn;
  connected: boolean;
  active: boolean;
  escaped: boolean;
  skipNext: boolean;
  pos: Point;
}

type PendingInteraction = {
  initiatorId: string;
  targetId: string;
  dir: Dir;
  stage: 'choose' | 'awaitSwap';
};

export interface GameOptions {
  players: GamePlayer[];
  order: string[];
  maze: Maze;
  rng?: RNG;
  onOver?: (escaped: string[], losers: string[]) => void;
}

export interface DebugPlayer {
  id: string;
  name: string;
  pos: Point;
  active: boolean;
  escaped: boolean;
  connected: boolean;
  skipNext: boolean;
}

export interface DebugState {
  phase: 'playing' | 'over';
  turnId: string | null;
  pending: PendingInteraction | null;
  players: DebugPlayer[];
  exitsRemaining: number;
}

export class Game {
  readonly width: number;
  readonly height: number;
  readonly startCount: number;

  private readonly walls: boolean[][];
  private readonly exits: Set<string>;
  private readonly players: GamePlayer[];
  private readonly byId = new Map<string, GamePlayer>();
  private readonly order: string[];
  private readonly rng: RNG;
  private readonly onOver?: (escaped: string[], losers: string[]) => void;

  private turnIndex = 0;
  private pending: PendingInteraction | null = null;
  private currentPhase: 'playing' | 'over' = 'playing';
  private log: string[] = [];

  constructor(options: GameOptions) {
    this.width = options.maze.width;
    this.height = options.maze.height;
    this.walls = options.maze.walls;
    this.exits = new Set(options.maze.exits);
    this.players = options.players;
    this.order = [...options.order];
    this.rng = options.rng ?? Math.random;
    this.onOver = options.onOver;
    this.startCount = this.order.length;

    for (const player of this.players) {
      this.byId.set(player.id, player);
      player.active = true;
      player.escaped = false;
      player.skipNext = false;
    }

    this.order.forEach((id, index) => {
      const player = this.byId.get(id);
      if (!player) throw new Error(`Неизвестный игрок в порядке хода: ${id}`);
      player.pos = { ...options.maze.starts[index] };
    });

    this.broadcastStart();
    this.broadcastState();
  }

  get phase(): 'playing' | 'over' {
    return this.currentPhase;
  }

  get currentPlayerId(): string | null {
    return this.currentPhase === 'playing'
      ? (this.order[this.turnIndex] ?? null)
      : null;
  }

  get exitsRemaining(): number {
    return this.exits.size;
  }

  move(playerId: string, dir: Dir): void {
    if (this.currentPhase !== 'playing') return;

    const player = this.byId.get(playerId);
    if (!player) return;

    if (this.order[this.turnIndex] !== playerId) {
      this.sendTo(player, { type: 'moveRejected', reason: 'notTurn' });
      return;
    }

    if (this.pending) {
      this.sendTo(player, { type: 'moveRejected', reason: 'pending' });
      return;
    }

    const delta = DELTAS[dir];
    if (!delta) return;

    const target = { x: player.pos.x + delta.x, y: player.pos.y + delta.y };
    if (
      target.x < 0 ||
      target.y < 0 ||
      target.x >= this.width ||
      target.y >= this.height ||
      this.walls[target.y][target.x]
    ) {
      this.sendTo(player, { type: 'moveRejected', reason: 'wall' });
      return;
    }

    const occupant = this.playerAt(target.x, target.y);
    if (occupant) {
      this.pending = {
        initiatorId: player.id,
        targetId: occupant.id,
        dir,
        stage: 'choose',
      };
      this.sendTo(player, {
        type: 'chooseAction',
        targetId: occupant.id,
        targetName: occupant.name,
        options: ['swap', 'fight'],
      });
      return;
    }

    player.pos = target;

    if (this.exits.has(cellKey(target.x, target.y))) {
      this.escape(player);
    }

    this.finishTurn();
  }

  chooseAction(playerId: string, action: 'swap' | 'fight'): void {
    if (this.currentPhase !== 'playing' || !this.pending) return;
    if (this.pending.stage !== 'choose') return;
    if (this.pending.initiatorId !== playerId) return;

    const initiator = this.byId.get(this.pending.initiatorId);
    const target = this.byId.get(this.pending.targetId);
    if (!initiator || !target) {
      this.pending = null;
      this.finishTurn();
      return;
    }

    if (action === 'fight') {
      this.resolveBattle(initiator, target);
      return;
    }

    if (action === 'swap') {
      this.pending.stage = 'awaitSwap';
      this.broadcastState();
      this.sendTo(target, {
        type: 'swapOffer',
        fromId: initiator.id,
        fromName: initiator.name,
      });
    }
  }

  respondSwap(playerId: string, accept: boolean): void {
    if (this.currentPhase !== 'playing' || !this.pending) return;
    if (this.pending.stage !== 'awaitSwap') return;
    if (this.pending.targetId !== playerId) return;

    const initiator = this.byId.get(this.pending.initiatorId);
    const target = this.byId.get(this.pending.targetId);
    if (!initiator || !target) {
      this.pending = null;
      this.finishTurn();
      return;
    }

    if (!accept) {
      this.resolveBattle(initiator, target);
      return;
    }

    const initiatorPos = initiator.pos;
    initiator.pos = target.pos;
    target.pos = initiatorPos;
    this.pending = null;

    this.logMessage(
      'swap',
      `${initiator.name} и ${target.name} поменялись клетками`,
    );
    this.finishTurn();
  }

  disconnect(playerId: string): void {
    const player = this.byId.get(playerId);
    if (!player) return;

    player.connected = false;
    const wasActive = player.active;
    player.active = false;

    if (this.currentPhase !== 'playing') {
      this.broadcastState();
      return;
    }

    const pendingInvolvesPlayer =
      this.pending !== null &&
      (this.pending.initiatorId === playerId ||
        this.pending.targetId === playerId);

    if (pendingInvolvesPlayer) {
      this.pending = null;
      if (wasActive) {
        this.logMessage(
          'disconnect',
          `${player.name} отключился, взаимодействие отменено`,
        );
      }
      this.finishTurn();
      return;
    }

    if (wasActive) {
      this.logMessage('disconnect', `${player.name} отключился`);
    }

    if (this.currentPlayerId === playerId) {
      this.finishTurn();
      return;
    }

    if (this.checkEnd()) {
      this.broadcastState();
      return;
    }

    this.broadcastState();
  }

  snapshotFor(playerId: string): StateMessage {
    const player = this.byId.get(playerId);
    if (!player) throw new Error(`Неизвестный игрок: ${playerId}`);

    const visible = computeVisible(
      {
        width: this.width,
        height: this.height,
        walls: this.walls,
        exits: this.exits,
      },
      player.pos,
    );

    const visiblePlayers: StatePlayer[] = this.players.map((other) => {
      const showPosition =
        other.id === player.id ||
        (other.active && isWithinSight(player.pos, other.pos));

      return {
        id: other.id,
        name: other.name,
        escaped: other.escaped,
        active: other.active,
        connected: other.connected,
        skipNext: other.skipNext,
        isTurn: this.currentPlayerId === other.id,
        ...(showPosition ? { pos: { ...other.pos } } : {}),
      };
    });

    const turnPlayer = this.currentPlayer();
    const turn: NamedPlayer | null = turnPlayer
      ? { id: turnPlayer.id, name: turnPlayer.name }
      : null;

    return {
      type: 'state',
      phase: this.currentPhase,
      width: this.width,
      height: this.height,
      turn,
      you: {
        id: player.id,
        name: player.name,
        pos: { ...player.pos },
        skipNext: player.skipNext,
        pending: this.pendingRoleFor(player),
      },
      visible,
      players: visiblePlayers,
      exitsRemaining: this.exits.size,
      log: [...this.log],
    };
  }

  debug(): DebugState {
    return {
      phase: this.currentPhase,
      turnId: this.currentPlayerId,
      pending: this.pending ? { ...this.pending } : null,
      players: this.players.map((player) => ({
        id: player.id,
        name: player.name,
        pos: { ...player.pos },
        active: player.active,
        escaped: player.escaped,
        connected: player.connected,
        skipNext: player.skipNext,
      })),
      exitsRemaining: this.exits.size,
    };
  }

  private currentPlayer(): GamePlayer | null {
    if (this.currentPhase !== 'playing') return null;
    const id = this.order[this.turnIndex];
    return id ? (this.byId.get(id) ?? null) : null;
  }

  private playerAt(x: number, y: number): GamePlayer | null {
    return (
      this.players.find(
        (player) =>
          player.active && player.pos.x === x && player.pos.y === y,
      ) ?? null
    );
  }

  private escape(player: GamePlayer): void {
    player.escaped = true;
    player.active = false;
    this.exits.delete(cellKey(player.pos.x, player.pos.y));
    this.logMessage('escape', `${player.name} нашёл выход и сбежал!`);
  }

  private finishTurn(): void {
    if (this.checkEnd()) {
      this.broadcastState();
      return;
    }
    this.advanceTurn();
    this.broadcastState();
  }

  private advanceTurn(): void {
    const count = this.order.length;

    for (let step = 1; step <= count; step++) {
      const index = (this.turnIndex + step) % count;
      const player = this.byId.get(this.order[index]);
      if (!player || !player.active) continue;

      if (player.skipNext) {
        player.skipNext = false;
        this.logMessage('skip', `${player.name} пропускает ход`);
        continue;
      }

      this.turnIndex = index;
      return;
    }

    for (let step = 1; step <= count; step++) {
      const index = (this.turnIndex + step) % count;
      const player = this.byId.get(this.order[index]);
      if (player && player.active) {
        this.turnIndex = index;
        return;
      }
    }
  }

  private checkEnd(): boolean {
    if (this.currentPhase !== 'playing') return true;

    const escapedPlayers = this.players.filter((player) => player.escaped);
    const activePlayers = this.players.filter((player) => player.active);

    if (
      escapedPlayers.length < this.startCount - 1 &&
      activePlayers.length > 0
    ) {
      return false;
    }

    this.currentPhase = 'over';
    this.pending = null;

    const escaped = escapedPlayers.map((player) => player.name);
    const losers = this.players
      .filter((player) => !player.escaped)
      .map((player) => player.name);

    this.logMessage(
      'info',
      `Игра окончена. Сбежали: ${escaped.length > 0 ? escaped.join(', ') : 'никто'}. Не сбежали: ${losers.join(', ')}`,
    );

    for (const player of this.players) {
      if (player.connected) {
        this.sendTo(player, { type: 'gameOver', escaped, losers });
      }
    }

    this.onOver?.(escaped, losers);
    return true;
  }

  private resolveBattle(attacker: GamePlayer, defender: GamePlayer): void {
    this.pending = null;

    const winner = this.rng() < 0.5 ? attacker : defender;
    const loser = winner.id === attacker.id ? defender : attacker;
    loser.skipNext = true;

    this.logMessage(
      'battle',
      `${attacker.name} и ${defender.name} вступили в бой. Победил ${winner.name}, ${loser.name} пропускает ход`,
    );

    this.finishTurn();
  }

  private pendingRoleFor(player: GamePlayer): PendingRole {
    if (!this.pending) return null;

    if (this.pending.stage === 'choose') {
      return this.pending.initiatorId === player.id ? 'choose' : null;
    }

    if (this.pending.initiatorId === player.id) return 'wait';
    if (this.pending.targetId === player.id) return 'respond';
    return null;
  }

  private broadcastStart(): void {
    const named: NamedPlayer[] = this.order.map((id) => {
      const player = this.byId.get(id);
      return { id, name: player ? player.name : id };
    });

    for (const player of this.players) {
      if (!player.connected) continue;
      this.sendTo(player, {
        type: 'start',
        youId: player.id,
        width: this.width,
        height: this.height,
        order: named,
        players: named,
      });
    }
  }

  private broadcastState(): void {
    for (const player of this.players) {
      if (!player.connected) continue;
      this.sendTo(player, this.snapshotFor(player.id));
    }
  }

  private logMessage(kind: EventKind, message: string): void {
    this.log.push(message);
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(this.log.length - MAX_LOG_ENTRIES);
    }
    for (const player of this.players) {
      if (!player.connected) continue;
      this.sendTo(player, { type: 'event', kind, message });
    }
  }

  private sendTo(player: GamePlayer, message: ServerMessage): void {
    player.send(message);
  }
}
