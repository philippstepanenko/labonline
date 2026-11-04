import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, type Config } from '../shared/config';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { Room } from './room';
import { createStaticHandler } from './static';

export interface RunningServer {
  server: http.Server;
  room: Room;
  config: Config;
  close: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'join':
      return typeof value.name === 'string';
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
  const room = new Room(config);
  const server = http.createServer(createStaticHandler(publicDir));
  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket) => {
    const id = randomUUID();
    let joined = false;

    const send = (message: ServerMessage): void => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

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
        if (parsed.type !== 'join') {
          send({
            type: 'error',
            code: 'join_required',
            message: 'Сначала представьтесь',
          });
          return;
        }

        const result = room.addPlayer(id, parsed.name, send);
        if (!result.ok) {
          send({ type: 'error', code: result.code, message: result.message });
          return;
        }
        joined = true;
        return;
      }

      if (parsed.type === 'join') {
        send({
          type: 'error',
          code: 'already_joined',
          message: 'Вы уже в комнате',
        });
        return;
      }

      room.handleMessage(id, parsed);
    });

    socket.on('close', () => {
      if (joined) room.removePlayer(id);
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

  return { server, room, config, close };
}

export function start(): void {
  const config = loadConfig();
  const { server } = createServer(config);
  server.listen(config.port, () => {
    console.log(`Сервер запущен: http://localhost:${config.port}`);
  });
}
