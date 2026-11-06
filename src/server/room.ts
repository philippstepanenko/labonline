import { randomInt } from 'node:crypto';
import { normalizeMazeSize, type Config } from '../shared/config';
import type {
  ClientMessage,
  Dir,
  LobbyPlayer,
  SendFn,
  ServerMessage,
} from '../shared/protocol';
import { Game, type GamePlayer } from './game';
import { generateMaze, type RNG } from './maze';

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface RoomOptions {
  id: string;
  mazeWidth: number;
  mazeHeight: number;
}

export interface RoomHooks {
  onChange?: () => void;
  onEmpty?: () => void;
}

interface RoomPlayer extends GamePlayer {
  ready: boolean;
}

export type AddPlayerResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type RoomActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const VALID_DIRS: ReadonlySet<string> = new Set<Dir>([
  'up',
  'down',
  'left',
  'right',
]);

export const cryptoRng: RNG = () => randomInt(0, 2 ** 32) / 2 ** 32;

function shuffle<T>(items: T[], rng: RNG): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export class Room {
  readonly config: Config;
  readonly id: string;

  private readonly players = new Map<string, RoomPlayer>();
  private readonly rng: RNG;
  private readonly hooks: RoomHooks;
  private phase: RoomPhase = 'lobby';
  private game: Game | null = null;
  private overAcks = new Set<string>();
  private ownerId: string | null = null;
  private mazeWidth: number;
  private mazeHeight: number;

  constructor(
    config: Config,
    options: RoomOptions,
    hooks: RoomHooks = {},
    rng: RNG = cryptoRng,
  ) {
    this.config = config;
    this.id = options.id;
    this.mazeWidth = options.mazeWidth;
    this.mazeHeight = options.mazeHeight;
    this.hooks = hooks;
    this.rng = rng;
  }

  get currentPhase(): RoomPhase {
    return this.phase;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get currentOwnerId(): string | null {
    return this.ownerId;
  }

  get ownerName(): string | null {
    if (!this.ownerId) return null;
    return this.players.get(this.ownerId)?.name ?? null;
  }

  get currentMazeWidth(): number {
    return this.mazeWidth;
  }

  get currentMazeHeight(): number {
    return this.mazeHeight;
  }

  addPlayer(id: string, name: string, send: SendFn): AddPlayerResult {
    if (this.phase !== 'lobby') {
      return {
        ok: false,
        code: 'game_running',
        message: 'Игра уже идёт, подключиться нельзя',
      };
    }
    if (this.players.size >= this.config.maxPlayers) {
      return {
        ok: false,
        code: 'room_full',
        message: 'Комната заполнена',
      };
    }

    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 20) {
      return {
        ok: false,
        code: 'name_invalid',
        message: 'Имя должно быть от 1 до 20 символов',
      };
    }

    const normalized = trimmed.toLowerCase();
    for (const existing of this.players.values()) {
      if (existing.name.toLowerCase() === normalized) {
        return {
          ok: false,
          code: 'name_taken',
          message: 'Это имя уже занято в этой комнате',
        };
      }
    }

    const player: RoomPlayer = {
      id,
      name: trimmed,
      send,
      connected: true,
      active: false,
      escaped: false,
      skipNext: false,
      ready: false,
      pos: { x: 0, y: 0 },
    };

    this.players.set(id, player);
    if (!this.ownerId) this.ownerId = id;

    this.sendTo(player, {
      type: 'welcome',
      youId: id,
      name: player.name,
      maxPlayers: this.config.maxPlayers,
      roomId: this.id,
    });
    this.broadcastLobby();
    return { ok: true };
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;

    if (this.phase === 'lobby') {
      this.players.delete(id);
      this.ensureOwner();
      if (this.players.size === 0) {
        this.hooks.onEmpty?.();
        return;
      }
      this.broadcastLobby();
      return;
    }

    player.connected = false;
    this.ensureOwner();

    if (this.phase === 'playing' && this.game) {
      this.game.disconnect(id);
    }

    if (this.phase === 'over') {
      const anyConnected = [...this.players.values()].some(
        (candidate) => candidate.connected,
      );
      if (!anyConnected) {
        this.resetToLobby();
        return;
      }
    }

    this.checkOverAcks();
    this.hooks.onChange?.();
  }

  setMazeSize(id: string, width: number, height: number): RoomActionResult {
    if (this.phase !== 'lobby') {
      return {
        ok: false,
        code: 'game_running',
        message: 'Размер можно менять только до начала игры',
      };
    }
    if (id !== this.ownerId) {
      return {
        ok: false,
        code: 'not_owner',
        message: 'Менять размер лабиринта может только создатель комнаты',
      };
    }

    const nextWidth = normalizeMazeSize(width);
    const nextHeight = normalizeMazeSize(height);
    if (nextWidth === null || nextHeight === null) {
      return {
        ok: false,
        code: 'bad_size',
        message: 'Размер должен быть целым числом от 9 до 21',
      };
    }

    this.mazeWidth = nextWidth;
    this.mazeHeight = nextHeight;
    this.broadcastLobby();
    return { ok: true };
  }

  handleMessage(id: string, message: ClientMessage): void {
    const player = this.players.get(id);
    if (!player) return;

    switch (message.type) {
      case 'setMazeSize': {
        const result = this.setMazeSize(id, message.width, message.height);
        if (!result.ok) {
          this.sendTo(player, {
            type: 'error',
            code: result.code,
            message: result.message,
          });
        }
        return;
      }

      case 'ready':
        this.setReady(id, message.value);
        return;

      case 'move':
        if (this.phase === 'playing' && this.game) {
          if (VALID_DIRS.has(message.dir)) {
            this.game.move(id, message.dir);
          }
        }
        return;

      case 'chooseAction':
        if (this.phase === 'playing' && this.game) {
          if (message.action === 'swap' || message.action === 'fight') {
            this.game.chooseAction(id, message.action);
          }
        }
        return;

      case 'respondSwap':
        if (this.phase === 'playing' && this.game) {
          this.game.respondSwap(id, Boolean(message.accept));
        }
        return;

      case 'backToLobby':
        this.ackOver(id);
        return;

      case 'listRooms':
      case 'createRoom':
      case 'joinRoom':
      case 'leaveRoom':
        return;

      default:
        this.sendTo(player, {
          type: 'error',
          code: 'unknown_message',
          message: 'Неизвестная команда',
        });
    }
  }

  private setReady(id: string, value: boolean): void {
    if (this.phase !== 'lobby') return;
    const player = this.players.get(id);
    if (!player) return;

    player.ready = Boolean(value);
    this.broadcastLobby();
    this.tryStart();
  }

  private tryStart(): void {
    if (this.phase !== 'lobby') return;

    const connected = [...this.players.values()].filter((p) => p.connected);
    if (connected.length < this.config.minPlayers) return;
    if (!connected.every((player) => player.ready)) return;

    let maze;
    try {
      maze = generateMaze(
        connected.length,
        this.mazeWidth,
        this.mazeHeight,
        this.rng,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось создать лабиринт';
      for (const player of connected) {
        player.ready = false;
        this.sendTo(player, {
          type: 'error',
          code: 'maze_failed',
          message,
        });
      }
      this.broadcastLobby();
      return;
    }

    this.phase = 'playing';
    this.overAcks.clear();
    const order = shuffle(
      connected.map((player) => player.id),
      this.rng,
    );

    this.game = new Game({
      players: connected,
      order,
      maze,
      rng: this.rng,
      onOver: () => {
        this.phase = 'over';
        this.overAcks.clear();
        this.hooks.onChange?.();
      },
    });
    this.hooks.onChange?.();
  }

  private ackOver(id: string): void {
    if (this.phase !== 'over') return;
    this.overAcks.add(id);
    this.checkOverAcks();
  }

  private checkOverAcks(): void {
    if (this.phase !== 'over') return;

    const connected = [...this.players.values()].filter(
      (player) => player.connected,
    );
    if (
      connected.length === 0 ||
      connected.every((player) => this.overAcks.has(player.id))
    ) {
      this.resetToLobby();
    }
  }

  private resetToLobby(): void {
    this.phase = 'lobby';
    this.game = null;
    this.overAcks.clear();

    for (const player of [...this.players.values()]) {
      if (!player.connected) {
        this.players.delete(player.id);
        continue;
      }
      player.ready = false;
      player.active = false;
      player.escaped = false;
      player.skipNext = false;
      player.pos = { x: 0, y: 0 };
    }

    this.ensureOwner();

    if (this.players.size === 0) {
      this.hooks.onEmpty?.();
      return;
    }

    this.broadcastLobby();
  }

  private ensureOwner(): void {
    const current = this.ownerId ? this.players.get(this.ownerId) : undefined;
    if (current && current.connected) return;

    const next = [...this.players.values()].find((player) => player.connected);
    this.ownerId = next ? next.id : null;
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.players.values()]
      .filter((player) => player.connected)
      .map((player) => ({
        id: player.id,
        name: player.name,
        ready: player.ready,
        connected: player.connected,
      }));

    const canStart =
      this.phase === 'lobby' &&
      players.length >= this.config.minPlayers &&
      players.every((player) => player.ready);

    for (const player of this.players.values()) {
      if (!player.connected) continue;
      this.sendTo(player, {
        type: 'lobby',
        roomId: this.id,
        ownerId: this.ownerId,
        mazeWidth: this.mazeWidth,
        mazeHeight: this.mazeHeight,
        players,
        maxPlayers: this.config.maxPlayers,
        minPlayers: this.config.minPlayers,
        canStart,
      });
    }

    this.hooks.onChange?.();
  }

  private sendTo(player: RoomPlayer, message: ServerMessage): void {
    try {
      player.send(message);
    } catch {
      player.connected = false;
    }
  }
}
