import { randomBytes } from 'node:crypto';
import { normalizeMazeSize, type Config } from '../shared/config';
import type { RoomSummary, SendFn } from '../shared/protocol';
import { Room, cryptoRng } from './room';
import type { RNG } from './maze';

export type RoomManagerResult =
  | { ok: true; room: Room }
  | { ok: false; code: string; message: string };

export interface CreateRoomOptions {
  playerId: string;
  name: string;
  send: SendFn;
  width: number;
  height: number;
}

export interface JoinRoomOptions {
  playerId: string;
  name: string;
  send: SendFn;
}

export class RoomManager {
  readonly config: Config;

  private readonly rooms = new Map<string, Room>();
  private readonly createdAt = new Map<string, number>();
  private readonly onChange: () => void;
  private readonly rng: RNG;

  constructor(
    config: Config,
    onChange: () => void = () => {},
    rng: RNG = cryptoRng,
  ) {
    this.config = config;
    this.onChange = onChange;
    this.rng = rng;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .sort(
        (a, b) =>
          (this.createdAt.get(a.id) ?? 0) - (this.createdAt.get(b.id) ?? 0),
      )
      .map((room) => ({
        id: room.id,
        ownerId: room.currentOwnerId,
        ownerName: room.ownerName,
        playerCount: room.playerCount,
        maxPlayers: this.config.maxPlayers,
        minPlayers: this.config.minPlayers,
        mazeWidth: room.currentMazeWidth,
        mazeHeight: room.currentMazeHeight,
        phase: room.currentPhase,
      }));
  }

  createRoom(options: CreateRoomOptions): RoomManagerResult {
    const width = normalizeMazeSize(options.width);
    const height = normalizeMazeSize(options.height);
    if (width === null || height === null) {
      return {
        ok: false,
        code: 'bad_size',
        message: 'Размер должен быть целым числом от 9 до 21',
      };
    }

    const id = this.generateId();
    const room: Room = new Room(
      this.config,
      { id, mazeWidth: width, mazeHeight: height },
      {
        onChange: () => this.onChange(),
        onEmpty: () => this.removeRoom(id),
      },
      this.rng,
    );

    this.rooms.set(id, room);
    this.createdAt.set(id, Date.now());

    const result = room.addPlayer(options.playerId, options.name, options.send);
    if (!result.ok) {
      this.removeRoom(id);
      return result;
    }

    this.onChange();
    return { ok: true, room };
  }

  joinRoom(roomId: string, options: JoinRoomOptions): RoomManagerResult {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        ok: false,
        code: 'room_not_found',
        message: 'Комната не найдена',
      };
    }

    const result = room.addPlayer(options.playerId, options.name, options.send);
    if (!result.ok) return result;

    this.onChange();
    return { ok: true, room };
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  removeRoom(id: string): void {
    if (!this.rooms.delete(id)) return;
    this.createdAt.delete(id);
    this.onChange();
  }

  private generateId(): string {
    let id = '';
    do {
      id = randomBytes(3).toString('hex').toUpperCase();
    } while (this.rooms.has(id));
    return id;
  }
}
