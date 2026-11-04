import { randomInt } from 'node:crypto';
import type { Config } from '../shared/config';
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

interface RoomPlayer extends GamePlayer {
  ready: boolean;
}

export type AddPlayerResult =
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

  private readonly players = new Map<string, RoomPlayer>();
  private readonly rng: RNG;
  private phase: RoomPhase = 'lobby';
  private game: Game | null = null;
  private overAcks = new Set<string>();

  constructor(config: Config, rng: RNG = cryptoRng) {
    this.config = config;
    this.rng = rng;
  }

  get currentPhase(): RoomPhase {
    return this.phase;
  }

  get playerCount(): number {
    return this.players.size;
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
          message: 'Это имя уже занято',
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
    this.sendTo(player, {
      type: 'welcome',
      youId: id,
      name: player.name,
      maxPlayers: this.config.maxPlayers,
    });
    this.broadcastLobby();
    return { ok: true };
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;

    if (this.phase === 'lobby') {
      this.players.delete(id);
      this.broadcastLobby();
      return;
    }

    player.connected = false;

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
  }

  handleMessage(id: string, message: ClientMessage): void {
    const player = this.players.get(id);
    if (!player) return;

    switch (message.type) {
      case 'join':
        this.sendTo(player, {
          type: 'error',
          code: 'already_joined',
          message: 'Вы уже в комнате',
        });
        return;

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
        this.config.mazeWidth,
        this.config.mazeHeight,
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
      },
    });
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

    this.broadcastLobby();
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
        players,
        maxPlayers: this.config.maxPlayers,
        minPlayers: this.config.minPlayers,
        canStart,
      });
    }
  }

  private sendTo(player: RoomPlayer, message: ServerMessage): void {
    try {
      player.send(message);
    } catch {
      player.connected = false;
    }
  }
}
