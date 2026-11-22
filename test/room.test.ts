import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_ACTION_DELAY_MS } from '../src/server/bot';
import { Room } from '../src/server/room';
import { loadConfig } from '../src/shared/config';
import type { ServerMessage } from '../src/shared/protocol';

type Lobby = Extract<ServerMessage, { type: 'lobby' }>;

function makeRoom(onEmpty?: () => void): Room {
  const config = loadConfig({
    maxPlayers: 4,
    minPlayers: 2,
    mazeWidth: 9,
    mazeHeight: 9,
  });

  return new Room(
    config,
    { id: 'room-1', mazeWidth: 9, mazeHeight: 9 },
    { onEmpty },
    () => 0,
  );
}

function collect(): {
  sent: Map<string, ServerMessage[]>;
  sendFor: (id: string) => (message: ServerMessage) => void;
} {
  const sent = new Map<string, ServerMessage[]>();

  return {
    sent,
    sendFor: (id) => (message) => {
      const list = sent.get(id) ?? [];
      list.push(message);
      sent.set(id, list);
    },
  };
}

function lastLobby(sent: Map<string, ServerMessage[]>, id: string): Lobby {
  const messages = sent.get(id) ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.type === 'lobby') return message;
  }
  throw new Error('Лобби не найдено');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Боты в комнате', () => {
  it('владелец добавляет и удаляет готового бота', () => {
    const { sent, sendFor } = collect();
    const room = makeRoom();

    room.addPlayer('owner', 'Owner', sendFor('owner'));
    room.addPlayer('guest', 'Guest', sendFor('guest'));

    expect(room.addBot('owner')).toEqual({ ok: true });
    const lobby = lastLobby(sent, 'owner');
    const bot = lobby.players.find((player) => player.bot);

    expect(bot).toMatchObject({
      name: 'Бот 1',
      ready: true,
      connected: true,
    });
    expect(room.currentOwnerId).toBe('owner');
    expect(room.playerCount).toBe(3);

    expect(room.addBot('guest')).toMatchObject({
      ok: false,
      code: 'not_owner',
    });
    expect(room.removeBot('guest', bot!.id)).toMatchObject({
      ok: false,
      code: 'not_owner',
    });

    expect(room.removeBot('owner', bot!.id)).toEqual({ ok: true });
    expect(room.playerCount).toBe(2);
  });

  it('бот ходит после задержки и передаёт ход человеку', () => {
    vi.useFakeTimers();
    const { sent, sendFor } = collect();
    const room = makeRoom();

    room.addPlayer('owner', 'Owner', sendFor('owner'));
    room.addBot('owner');
    room.setReady('owner', true);

    expect(room.currentPhase).toBe('playing');

    const statesBefore = (sent.get('owner') ?? []).filter(
      (message) => message.type === 'state',
    ).length;

    vi.advanceTimersByTime(BOT_ACTION_DELAY_MS);

    const states = (sent.get('owner') ?? []).filter(
      (message): message is Extract<ServerMessage, { type: 'state' }> =>
        message.type === 'state',
    );

    expect(states.length).toBeGreaterThan(statesBefore);
    expect(states.at(-1)?.turn?.id).toBe('owner');
  });

  it('удаляет ботов и комнату, когда не остаётся людей', () => {
    vi.useFakeTimers();
    const onEmpty = vi.fn();
    const { sendFor } = collect();
    const room = makeRoom(onEmpty);

    room.addPlayer('owner', 'Owner', sendFor('owner'));
    room.addBot('owner');
    room.setReady('owner', true);

    expect(room.currentPhase).toBe('playing');

    room.removePlayer('owner');

    expect(room.currentPhase).toBe('lobby');
    expect(room.playerCount).toBe(0);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
