import { randomInt, randomUUID } from 'node:crypto';
import {
  DEFAULT_CORRIDOR_WIDTH,
  DEFAULT_MAZE_ALGORITHM,
  MAZE_ALGORITHMS,
  normalizeMazeSettings,
  type Config,
} from '../shared/config';
import { isPlayerHue, pickFreeHue, pickRandomFreeHue } from '../shared/colors';
import type {
  ClientMessage,
  CorridorWidth,
  Dir,
  LobbyPlayer,
  MazeAlgorithm,
  MazeAlgorithmChoice,
  SendFn,
  ServerMessage,
} from '../shared/protocol';
import { BOT_ACTION_DELAY_MS, nextBotId, performBotAction } from './bot';
import { Game, type GamePlayer } from './game';
import {
  generateMaze,
  type GeneratedMaze,
  type RNG,
} from './maze';

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface RoomOptions {
  id: string;
  mazeWidth: number;
  mazeHeight: number;
  algorithm?: MazeAlgorithmChoice;
  corridorWidth?: CorridorWidth;
  algorithmPool?: MazeAlgorithm[];
}

export interface MazeOptions {
  width: number;
  height: number;
  algorithm: MazeAlgorithmChoice;
  corridorWidth: CorridorWidth;
  algorithmPool?: MazeAlgorithm[];
}

export interface RoomHooks {
  onChange?: () => void;
  onEmpty?: () => void;
}

interface RoomPlayer extends GamePlayer {
  ready: boolean;
  bot: boolean;
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
  private mazeAlgorithm: MazeAlgorithmChoice;
  private corridorWidth: CorridorWidth;
  private algorithmPool: MazeAlgorithm[];
  private botTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.mazeAlgorithm = options.algorithm ?? DEFAULT_MAZE_ALGORITHM;
    this.corridorWidth =
      options.corridorWidth ?? DEFAULT_CORRIDOR_WIDTH;
    this.algorithmPool = options.algorithmPool
      ? [...options.algorithmPool]
      : [...MAZE_ALGORITHMS];
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

  get currentMazeAlgorithm(): MazeAlgorithmChoice {
    return this.mazeAlgorithm;
  }

  get currentCorridorWidth(): CorridorWidth {
    return this.corridorWidth;
  }

  get currentAlgorithmPool(): MazeAlgorithm[] {
    return [...this.algorithmPool];
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
      hue: pickFreeHue([...this.players.values()].map((existing) => existing.hue)),
      send,
      connected: true,
      active: false,
      escaped: false,
      energy: 0,
      defeated: false,
      ready: false,
      bot: false,
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

  addBot(ownerId: string): RoomActionResult {
    if (this.phase !== 'lobby') {
      return {
        ok: false,
        code: 'game_running',
        message: 'Ботов можно добавлять только до начала игры',
      };
    }
    if (ownerId !== this.ownerId) {
      return {
        ok: false,
        code: 'not_owner',
        message: 'Добавлять ботов может только создатель комнаты',
      };
    }
    if (this.players.size >= this.config.maxPlayers) {
      return {
        ok: false,
        code: 'room_full',
        message: 'Комната заполнена',
      };
    }

    const player: RoomPlayer = {
      id: `bot-${randomUUID()}`,
      name: this.nextBotName(),
      hue: pickRandomFreeHue(
        [...this.players.values()].map((existing) => existing.hue),
      ),
      send: () => {},
      connected: true,
      active: false,
      escaped: false,
      energy: 0,
      defeated: false,
      ready: true,
      bot: true,
      pos: { x: 0, y: 0 },
    };

    this.players.set(player.id, player);
    this.broadcastLobby();
    this.tryStart();
    return { ok: true };
  }

  removeBot(ownerId: string, botId: string): RoomActionResult {
    if (this.phase !== 'lobby') {
      return {
        ok: false,
        code: 'game_running',
        message: 'Удалять ботов можно только до начала игры',
      };
    }
    if (ownerId !== this.ownerId) {
      return {
        ok: false,
        code: 'not_owner',
        message: 'Удалять ботов может только создатель комнаты',
      };
    }

    const bot = this.players.get(botId);
    if (!bot || !bot.bot) {
      return {
        ok: false,
        code: 'bot_not_found',
        message: 'Бот не найден',
      };
    }

    this.players.delete(botId);
    this.broadcastLobby();
    return { ok: true };
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player || player.bot) return;

    if (this.phase === 'lobby') {
      this.players.delete(id);
      if (!this.hasConnectedHumans()) {
        this.removeAllBots();
        this.ownerId = null;
        this.hooks.onEmpty?.();
        return;
      }
      this.ensureOwner();
      this.broadcastLobby();
      return;
    }

    player.connected = false;

    if (!this.hasConnectedHumans()) {
      this.clearBotTimer();
      this.removeAllBots();
      this.players.clear();
      this.ownerId = null;
      this.game = null;
      this.phase = 'lobby';
      this.overAcks.clear();
      this.hooks.onEmpty?.();
      return;
    }

    this.ensureOwner();

    if (this.phase === 'playing' && this.game) {
      this.game.disconnect(id);
      this.scheduleBot();
    }

    this.checkOverAcks();
    this.hooks.onChange?.();
  }

  setMazeOptions(id: string, options: MazeOptions): RoomActionResult {
    if (this.phase !== 'lobby') {
      return {
        ok: false,
        code: 'game_running',
        message: 'Настройки можно менять только до начала игры',
      };
    }
    if (id !== this.ownerId) {
      return {
        ok: false,
        code: 'not_owner',
        message: 'Менять настройки лабиринта может только создатель комнаты',
      };
    }

    const normalized = normalizeMazeSettings(options);
    if (!normalized.ok) {
      return {
        ok: false,
        code: normalized.code,
        message: normalized.message,
      };
    }

    const settings = normalized.value;
    this.mazeWidth = settings.width;
    this.mazeHeight = settings.height;
    this.mazeAlgorithm = settings.algorithm;
    this.corridorWidth = settings.corridorWidth;
    this.algorithmPool = settings.algorithmPool;
    this.broadcastLobby();
    return { ok: true };
  }

  setMazeSize(id: string, width: number, height: number): RoomActionResult {
    return this.setMazeOptions(id, {
      width,
      height,
      algorithm: this.mazeAlgorithm,
      corridorWidth: this.corridorWidth,
      algorithmPool: this.algorithmPool,
    });
  }

  setColor(id: string, hue: number): RoomActionResult {
    if (this.phase !== 'lobby') {
      return {
        ok: false,
        code: 'game_running',
        message: 'Цвет можно менять только в лобби',
      };
    }

    const player = this.players.get(id);
    if (!player) {
      return {
        ok: false,
        code: 'not_in_room',
        message: 'Игрок не найден в комнате',
      };
    }

    if (!isPlayerHue(hue)) {
      return {
        ok: false,
        code: 'bad_color',
        message: 'Такой цвет недоступен',
      };
    }

    if (player.hue === hue) return { ok: true };

    if (player.ready) {
      return {
        ok: false,
        code: 'already_ready',
        message: 'Сначала отмените готовность',
      };
    }

    for (const other of this.players.values()) {
      if (other.id !== id && other.connected && other.hue === hue) {
        return {
          ok: false,
          code: 'color_taken',
          message: 'Этот цвет уже выбрал другой игрок',
        };
      }
    }

    player.hue = hue;
    this.broadcastLobby();
    return { ok: true };
  }

  handleMessage(id: string, message: ClientMessage): void {
    const player = this.players.get(id);
    if (!player) return;

    switch (message.type) {
      case 'setMazeOptions': {
        const result = this.setMazeOptions(id, {
          width: message.width,
          height: message.height,
          algorithm: message.algorithm,
          corridorWidth: message.corridorWidth,
          algorithmPool: message.algorithmPool,
        });
        if (!result.ok) {
          this.sendTo(player, {
            type: 'error',
            code: result.code,
            message: result.message,
          });
        }
        return;
      }

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

      case 'setColor': {
        const result = this.setColor(id, message.hue);
        if (!result.ok) {
          this.sendTo(player, {
            type: 'error',
            code: result.code,
            message: result.message,
          });
        }
        return;
      }

      case 'addBot': {
        const result = this.addBot(id);
        if (!result.ok) {
          this.sendTo(player, {
            type: 'error',
            code: result.code,
            message: result.message,
          });
        }
        return;
      }

      case 'removeBot': {
        const result = this.removeBot(id, message.botId);
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
            this.scheduleBot();
          }
        }
        return;

      case 'chooseAction':
        if (this.phase === 'playing' && this.game) {
          if (message.action === 'swap' || message.action === 'fight') {
            this.game.chooseAction(id, message.action);
            this.scheduleBot();
          }
        }
        return;

      case 'respondSwap':
        if (this.phase === 'playing' && this.game) {
          this.game.respondSwap(id, Boolean(message.accept));
          this.scheduleBot();
        }
        return;

      case 'spectate':
        if (this.phase === 'playing' && this.game) {
          this.game.setSpectate(id, message);
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

    let maze: GeneratedMaze;
    try {
      maze = generateMaze(
        connected.length,
        this.mazeWidth,
        this.mazeHeight,
        this.rng,
        {
          algorithm: this.mazeAlgorithm,
          corridorWidth: this.corridorWidth,
          algorithmPool: this.algorithmPool,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось создать лабиринт';
      for (const player of connected) {
        player.ready = player.bot;
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
      algorithm: maze.algorithm,
      corridorWidth: maze.corridorWidth,
      rng: this.rng,
      onOver: () => {
        this.clearBotTimer();
        this.phase = 'over';
        this.overAcks.clear();
        this.hooks.onChange?.();
      },
    });
    this.hooks.onChange?.();
    this.scheduleBot();
  }

  private ackOver(id: string): void {
    if (this.phase !== 'over') return;
    this.overAcks.add(id);
    this.checkOverAcks();
  }

  private checkOverAcks(): void {
    if (this.phase !== 'over') return;

    const connected = [...this.players.values()].filter(
      (player) => player.connected && !player.bot,
    );
    if (
      connected.length === 0 ||
      connected.every((player) => this.overAcks.has(player.id))
    ) {
      this.resetToLobby();
    }
  }

  private resetToLobby(): void {
    this.clearBotTimer();
    this.phase = 'lobby';
    this.game = null;
    this.overAcks.clear();

    for (const player of [...this.players.values()]) {
      if (!player.connected) {
        this.players.delete(player.id);
        continue;
      }
      player.ready = player.bot;
      player.active = false;
      player.escaped = false;
      player.energy = 0;
      player.defeated = false;
      player.pos = { x: 0, y: 0 };
    }

    if (!this.hasConnectedHumans()) {
      this.removeAllBots();
      this.players.clear();
      this.ownerId = null;
      this.hooks.onEmpty?.();
      return;
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
    if (current && current.connected && !current.bot) return;

    const next = [...this.players.values()].find(
      (player) => player.connected && !player.bot,
    );
    this.ownerId = next ? next.id : null;
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.players.values()]
      .filter((player) => player.connected)
      .map((player) => ({
        id: player.id,
        name: player.name,
        hue: player.hue,
        ready: player.ready,
        connected: player.connected,
        bot: player.bot,
      }));

    const canStart =
      this.phase === 'lobby' &&
      players.length >= this.config.minPlayers &&
      players.every((player) => player.ready);

    for (const player of this.players.values()) {
      if (!player.connected || player.bot) continue;
      this.sendTo(player, {
        type: 'lobby',
        roomId: this.id,
        ownerId: this.ownerId,
        mazeWidth: this.mazeWidth,
        mazeHeight: this.mazeHeight,
        algorithm: this.mazeAlgorithm,
        corridorWidth: this.corridorWidth,
        algorithmPool: [...this.algorithmPool],
        players,
        maxPlayers: this.config.maxPlayers,
        minPlayers: this.config.minPlayers,
        canStart,
      });
    }

    this.hooks.onChange?.();
  }

  private hasConnectedHumans(): boolean {
    return [...this.players.values()].some(
      (player) => player.connected && !player.bot,
    );
  }

  private removeAllBots(): void {
    for (const player of [...this.players.values()]) {
      if (player.bot) this.players.delete(player.id);
    }
  }

  private nextBotName(): string {
    let index = 1;
    while (
      [...this.players.values()].some(
        (player) => player.name === `Бот ${index}`,
      )
    ) {
      index += 1;
    }
    return `Бот ${index}`;
  }

  private botIds(): Set<string> {
    const ids = new Set<string>();
    for (const player of this.players.values()) {
      if (player.bot && player.connected) ids.add(player.id);
    }
    return ids;
  }

  private clearBotTimer(): void {
    if (!this.botTimer) return;
    clearTimeout(this.botTimer);
    this.botTimer = null;
  }

  private scheduleBot(): void {
    this.clearBotTimer();
    if (this.phase !== 'playing' || !this.game) return;

    const botId = nextBotId(this.game, this.botIds());
    if (!botId) return;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.phase !== 'playing' || !this.game) return;
      const acted = performBotAction(this.game, botId, this.rng);
      if (acted) this.scheduleBot();
    }, BOT_ACTION_DELAY_MS);
    this.botTimer.unref?.();
  }

  private sendTo(player: RoomPlayer, message: ServerMessage): void {
    try {
      player.send(message);
    } catch {
      player.connected = false;
    }
  }
}
