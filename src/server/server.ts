import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, type Config } from '../shared/config';
import type { ClientMessage, SendFn, ServerMessage } from '../shared/protocol';
import type { Room } from './room';
import { RoomManager } from './rooms';
import { createStaticHandler } from './static';

export interface RunningServer {
  server: http.Server;
  rooms: RoomManager;
  config: Config;
  close: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'listRooms':
      return true;
    case 'createRoom':
      return (
        typeof value.name === 'string' &&
        typeof value.width === 'number' &&
        typeof value.height === 'number'
      );
    case 'joinRoom':
      return typeof value.name === 'string' && typeof value.roomId === 'string';
    case 'leaveRoom':
      return true;
    case 'setMazeSize':
      return typeof value.width === 'number' && typeof value.height === 'number';
    case 'ready':
      return typeof value.value === 'boolean';
    case 'move':
      return (
        value.dir === 'up' ||
        value.dir === 'down' ||
        value.dir === 'left' ||
        value.dir === 'right'
      );
    case 'chooseAction':
      return value.action === 'swap' || value.action === 'fight';
    case 'respondSwap':
      return typeof value.accept === 'boolean';
    case 'backToLobby':
      return true;
    default:
      return false;
  }
}

export function createServer(
  overrides: Partial<Config> = {},
  publicDir = path.resolve(process.cwd(), 'public'),
): RunningServer {
  const config = loadConfig(overrides);
  const unjoined = new Map<string, SendFn>();

  function broadcastRooms(): void {
    const message: ServerMessage = {
      type: 'rooms',
      rooms: manager.list(),
    };
    for (const send of unjoined.values()) {
      send(message);
    }
  }

  const manager = new RoomManager(config, broadcastRooms);
  const server = http.createServer(createStaticHandler(publicDir));
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket) => {
    const id = randomUUID();
    let joined = false;
    let currentRoom: Room | null = null;

    const send: SendFn = (message) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    unjoined.set(id, send);
    send({ type: 'rooms', rooms: manager.list() });

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send({
          type: 'error',
          code: 'bad_json',
          message: 'Некорректный формат сообщения',
        });
        return;
      }

      if (!isClientMessage(parsed)) {
        send({
          type: 'error',
          code: 'bad_message',
          message: 'Неизвестная команда',
        });
        return;
      }

      if (!joined) {
        switch (parsed.type) {
          case 'listRooms':
            send({ type: 'rooms', rooms: manager.list() });
            return;

          case 'createRoom': {
            unjoined.delete(id);
            const result = manager.createRoom({
              playerId: id,
              name: parsed.name,
              send,
              width: parsed.width,
              height: parsed.height,
            });
            if (!result.ok) {
              unjoined.set(id, send);
              send({
                type: 'error',
                code: result.code,
                message: result.message,
              });
              send({ type: 'rooms', rooms: manager.list() });
              return;
            }
            currentRoom = result.room;
            joined = true;
            return;
          }

          case 'joinRoom': {
            unjoined.delete(id);
            const result = manager.joinRoom(parsed.roomId, {
              playerId: id,
              name: parsed.name,
              send,
            });
            if (!result.ok) {
              unjoined.set(id, send);
              send({
                type: 'error',
                code: result.code,
                message: result.message,
              });
              send({ type: 'rooms', rooms: manager.list() });
              return;
            }
            currentRoom = result.room;
            joined = true;
            return;
          }

          default:
            send({
              type: 'error',
              code: 'join_required',
              message: 'Сначала создайте комнату или вступите в неё',
            });
            return;
        }
      }

      if (parsed.type === 'leaveRoom') {
        currentRoom?.removePlayer(id);
        currentRoom = null;
        joined = false;
        unjoined.set(id, send);
        send({ type: 'rooms', rooms: manager.list() });
        return;
      }

      if (
        parsed.type === 'listRooms' ||
        parsed.type === 'createRoom' ||
        parsed.type === 'joinRoom'
      ) {
        send({
          type: 'error',
          code: 'already_in_room',
          message: 'Сначала выйдите из текущей комнаты',
        });
        return;
      }

      currentRoom?.handleMessage(id, parsed);
    });

    socket.on('close', () => {
      unjoined.delete(id);
      if (joined) currentRoom?.removePlayer(id);
    });

    socket.on('error', () => {
      // Ошибка сокета приводит к событию close, там и убираем игрока.
    });
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close(() => {
        server.close(() => resolve());
      });
    });

  return { server, rooms: manager, config, close };
}

export function start(): void {
  const config = loadConfig();
  const { server } = createServer(config);
  server.listen(config.port, () => {
    console.log(`Сервер запущен: http://localhost:${config.port}`);
  });
}
