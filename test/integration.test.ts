import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, type RunningServer } from '../src/server/server';
import type { ServerMessage } from '../src/shared/protocol';

class TestClient {
  readonly messages: ServerMessage[] = [];
  private cursor = 0;

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      this.messages.push(JSON.parse(raw.toString()) as ServerMessage);
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeout = 3000,
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();

      const check = () => {
        for (let index = this.cursor; index < this.messages.length; index++) {
          const message = this.messages[index];
          if (predicate(message)) {
            this.cursor = index + 1;
            resolve(message);
            return;
          }
        }

        if (Date.now() - startedAt > timeout) {
          reject(
            new Error(
              `Таймаут ожидания сообщения. Получено: ${JSON.stringify(this.messages)}`,
            ),
          );
          return;
        }

        setTimeout(check, 10);
      };

      check();
    });
  }
}

function connect(url: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const client = new TestClient(socket);
    socket.once('open', () => resolve(client));
    socket.once('error', reject);
  });
}

describe('WebSocket-сервер', () => {
  let running: RunningServer | null = null;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const client of clients) {
      client.socket.terminate();
    }
    clients.length = 0;
    if (running) {
      await running.close();
      running = null;
    }
  });

  async function startServer(): Promise<string> {
    running = createServer({
      maxPlayers: 2,
      minPlayers: 2,
      mazeWidth: 7,
      mazeHeight: 7,
    });

    await new Promise<void>((resolve) => {
      running!.server.listen(0, '127.0.0.1', resolve);
    });

    const address = running.server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  it('проводит игроков через лобби, старт и первый ход', async () => {
    const url = await startServer();

    const first = await connect(url);
    const second = await connect(url);
    clients.push(first, second);

    first.send({ type: 'join', name: 'Аня' });
    const welcome = await first.waitFor((message) => message.type === 'welcome');
    if (welcome.type !== 'welcome') throw new Error('Ожидался welcome');
    expect(welcome.name).toBe('Аня');

    second.send({ type: 'join', name: 'Боря' });
    await second.waitFor((message) => message.type === 'welcome');
    await first.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );
    const lobby = await second.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );
    if (lobby.type !== 'lobby') throw new Error('Ожидался lobby');
    expect(lobby.players.map((player) => player.name)).toEqual(['Аня', 'Боря']);

    first.send({ type: 'ready', value: true });
    second.send({ type: 'ready', value: true });

    const start = await first.waitFor((message) => message.type === 'start');
    if (start.type !== 'start') throw new Error('Ожидался start');
    expect(start.width).toBe(7);
    expect(start.height).toBe(7);
    expect(start.order).toHaveLength(2);

    const firstState = await first.waitFor(
      (message) => message.type === 'state',
    );
    const secondState = await second.waitFor(
      (message) => message.type === 'state',
    );
    if (firstState.type !== 'state' || secondState.type !== 'state') {
      throw new Error('Ожидался state');
    }
    expect(firstState.phase).toBe('playing');
    expect(secondState.phase).toBe('playing');

    const turnId = firstState.turn?.id;
    expect(turnId).toBeTruthy();
    const mover = turnId === welcome.youId ? first : second;

    mover.send({ type: 'move', dir: 'up' });
    const response = await mover.waitFor(
      (message) =>
        message.type === 'state' ||
        message.type === 'moveRejected' ||
        message.type === 'chooseAction',
    );
    expect(['state', 'moveRejected', 'chooseAction']).toContain(response.type);
  });

  it('отклоняет повторяющееся имя и подключение во время игры', async () => {
    const url = await startServer();

    const first = await connect(url);
    const second = await connect(url);
    clients.push(first, second);

    first.send({ type: 'join', name: 'Аня' });
    await first.waitFor((message) => message.type === 'welcome');

    second.send({ type: 'join', name: 'Аня' });
    const duplicate = await second.waitFor(
      (message) => message.type === 'error',
    );
    if (duplicate.type !== 'error') throw new Error('Ожидался error');
    expect(duplicate.code).toBe('name_taken');

    second.send({ type: 'join', name: 'Боря' });
    await second.waitFor((message) => message.type === 'welcome');
    await first.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );

    first.send({ type: 'ready', value: true });
    second.send({ type: 'ready', value: true });
    await first.waitFor((message) => message.type === 'start');
    await second.waitFor((message) => message.type === 'start');

    const third = await connect(url);
    clients.push(third);
    third.send({ type: 'join', name: 'Вика' });
    const rejected = await third.waitFor(
      (message) => message.type === 'error',
    );
    if (rejected.type !== 'error') throw new Error('Ожидался error');
    expect(rejected.code).toBe('game_running');
  });
});
