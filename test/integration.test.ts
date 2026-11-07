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

async function createRoom(
  client: TestClient,
  name: string,
  width = 9,
  height = 9,
) {
  client.send({ type: 'createRoom', name, width, height });

  const welcome = await client.waitFor((message) => message.type === 'welcome');
  if (welcome.type !== 'welcome') throw new Error('Ожидался welcome');

  const lobby = await client.waitFor((message) => message.type === 'lobby');
  if (lobby.type !== 'lobby') throw new Error('Ожидался lobby');

  return { welcome, lobby };
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
      mazeWidth: 9,
      mazeHeight: 9,
    });

    await new Promise<void>((resolve) => {
      running!.server.listen(0, '127.0.0.1', resolve);
    });

    const address = running.server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  it('создаёт комнату, принимает игрока и стартует с выбранным размером', async () => {
    const url = await startServer();

    const first = await connect(url);
    const second = await connect(url);
    clients.push(first, second);

    const { welcome, lobby } = await createRoom(first, 'Аня', 9, 11);
    expect(lobby.ownerId).toBe(welcome.youId);
    expect(lobby.mazeWidth).toBe(9);
    expect(lobby.mazeHeight).toBe(11);

    second.send({ type: 'listRooms' });
    const rooms = await second.waitFor(
      (message) => message.type === 'rooms' && message.rooms.length === 1,
    );
    if (rooms.type !== 'rooms') throw new Error('Ожидался rooms');
    expect(rooms.rooms[0].id).toBe(welcome.roomId);
    expect(rooms.rooms[0].ownerName).toBe('Аня');
    expect(rooms.rooms[0].playerCount).toBe(1);
    expect(rooms.rooms[0].mazeWidth).toBe(9);
    expect(rooms.rooms[0].mazeHeight).toBe(11);

    second.send({ type: 'joinRoom', name: 'Боря', roomId: welcome.roomId });
    const secondWelcome = await second.waitFor(
      (message) => message.type === 'welcome',
    );
    if (secondWelcome.type !== 'welcome') throw new Error('Ожидался welcome');
    expect(secondWelcome.roomId).toBe(welcome.roomId);

    await first.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );
    const joinedLobby = await second.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );
    if (joinedLobby.type !== 'lobby') throw new Error('Ожидался lobby');
    expect(joinedLobby.players.map((player) => player.name)).toEqual([
      'Аня',
      'Боря',
    ]);

    first.send({ type: 'setMazeSize', width: 13, height: 15 });
    const resizedFirst = await first.waitFor(
      (message) =>
        message.type === 'lobby' &&
        message.mazeWidth === 13 &&
        message.mazeHeight === 15,
    );
    const resizedSecond = await second.waitFor(
      (message) =>
        message.type === 'lobby' &&
        message.mazeWidth === 13 &&
        message.mazeHeight === 15,
    );
    if (resizedFirst.type !== 'lobby' || resizedSecond.type !== 'lobby') {
      throw new Error('Ожидался lobby');
    }

    first.send({ type: 'ready', value: true });
    second.send({ type: 'ready', value: true });

    const start = await first.waitFor((message) => message.type === 'start');
    if (start.type !== 'start') throw new Error('Ожидался start');
    expect(start.width).toBe(13);
    expect(start.height).toBe(15);
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
    expect(firstState.you.energy).toBe(1);
    expect(secondState.you.energy).toBe(1);
    expect(firstState.you.defeated).toBe(false);
    expect(secondState.you.defeated).toBe(false);
    expect(firstState.players.every((player) => typeof player.energy === 'number')).toBe(true);
    expect(secondState.players.every((player) => typeof player.energy === 'number')).toBe(true);
    expect(firstState.players.every((player) => player.defeated === false)).toBe(true);
    expect(secondState.players.every((player) => player.defeated === false)).toBe(true);

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

  it('проверяет права владельца, размеры и уникальность имени', async () => {
    const url = await startServer();

    const first = await connect(url);
    const second = await connect(url);
    const third = await connect(url);
    clients.push(first, second, third);

    const { welcome } = await createRoom(first, 'Аня', 9, 9);

    second.send({ type: 'joinRoom', name: 'Аня', roomId: welcome.roomId });
    const duplicate = await second.waitFor(
      (message) => message.type === 'error',
    );
    if (duplicate.type !== 'error') throw new Error('Ожидался error');
    expect(duplicate.code).toBe('name_taken');

    second.send({ type: 'joinRoom', name: 'Боря', roomId: welcome.roomId });
    await second.waitFor((message) => message.type === 'welcome');

    second.send({ type: 'setMazeSize', width: 11, height: 11 });
    const notOwner = await second.waitFor(
      (message) => message.type === 'error',
    );
    if (notOwner.type !== 'error') throw new Error('Ожидался error');
    expect(notOwner.code).toBe('not_owner');

    first.send({ type: 'setMazeSize', width: 25, height: 11 });
    const badSize = await first.waitFor(
      (message) => message.type === 'error',
    );
    if (badSize.type !== 'error') throw new Error('Ожидался error');
    expect(badSize.code).toBe('bad_size');

    third.send({ type: 'createRoom', name: 'Аня', width: 8, height: 9 });
    const badCreateSize = await third.waitFor(
      (message) => message.type === 'error',
    );
    if (badCreateSize.type !== 'error') throw new Error('Ожидался error');
    expect(badCreateSize.code).toBe('bad_size');

    third.send({ type: 'createRoom', name: 'Аня', width: 9, height: 9 });
    const thirdWelcome = await third.waitFor(
      (message) => message.type === 'welcome',
    );
    if (thirdWelcome.type !== 'welcome') throw new Error('Ожидался welcome');
    expect(thirdWelcome.roomId).not.toBe(welcome.roomId);

    const fourth = await connect(url);
    clients.push(fourth);
    fourth.send({ type: 'joinRoom', name: 'Вика', roomId: welcome.roomId });
    const full = await fourth.waitFor((message) => message.type === 'error');
    if (full.type !== 'error') throw new Error('Ожидался error');
    expect(full.code).toBe('room_full');

    fourth.send({ type: 'joinRoom', name: 'Вика', roomId: 'НЕТУ' });
    const missing = await fourth.waitFor(
      (message) => message.type === 'error',
    );
    if (missing.type !== 'error') throw new Error('Ожидался error');
    expect(missing.code).toBe('room_not_found');
  });

  it('передаёт владение при выходе и удаляет пустую комнату', async () => {
    const url = await startServer();

    const first = await connect(url);
    const second = await connect(url);
    clients.push(first, second);

    const { welcome } = await createRoom(first, 'Аня', 9, 9);

    second.send({ type: 'joinRoom', name: 'Боря', roomId: welcome.roomId });
    const secondWelcome = await second.waitFor(
      (message) => message.type === 'welcome',
    );
    if (secondWelcome.type !== 'welcome') throw new Error('Ожидался welcome');
    await second.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );

    first.socket.close();
    const lobby = await second.waitFor(
      (message) =>
        message.type === 'lobby' &&
        message.players.length === 1 &&
        message.ownerId === secondWelcome.youId,
    );
    if (lobby.type !== 'lobby') throw new Error('Ожидался lobby');

    second.send({ type: 'leaveRoom' });
    const rooms = await second.waitFor(
      (message) => message.type === 'rooms' && message.rooms.length === 0,
    );
    if (rooms.type !== 'rooms') throw new Error('Ожидался rooms');
    expect(rooms.rooms).toEqual([]);
  });

  it('запрещает входить в комнату во время игры', async () => {
    const url = await startServer();

    const first = await connect(url);
    const second = await connect(url);
    const third = await connect(url);
    clients.push(first, second, third);

    const { welcome } = await createRoom(first, 'Аня', 9, 9);
    second.send({ type: 'joinRoom', name: 'Боря', roomId: welcome.roomId });
    await second.waitFor((message) => message.type === 'welcome');
    await second.waitFor(
      (message) => message.type === 'lobby' && message.players.length === 2,
    );

    first.send({ type: 'ready', value: true });
    second.send({ type: 'ready', value: true });
    await first.waitFor((message) => message.type === 'start');

    third.send({ type: 'joinRoom', name: 'Вика', roomId: welcome.roomId });
    const rejected = await third.waitFor(
      (message) => message.type === 'error',
    );
    if (rejected.type !== 'error') throw new Error('Ожидался error');
    expect(rejected.code).toBe('game_running');
  });
});
