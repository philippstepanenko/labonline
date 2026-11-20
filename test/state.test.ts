import { beforeEach, describe, expect, it } from 'vitest';
import { applyState, resetForStart, state } from '../public/js/state.js';

function stateMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'state',
    phase: 'playing',
    width: 5,
    height: 5,
    turn: null,
    nextTurn: null,
    you: {
      id: 'p1',
      name: 'P1',
      pos: { x: 1, y: 1 },
      energy: 1,
      defeated: false,
      pending: null,
    },
    visible: {
      origin: { x: 1, y: 1 },
      cells: [['.', '.']],
      exits: [],
    },
    players: [],
    exitsRemaining: 1,
    usedExits: [],
    log: [],
    ...overrides,
  };
}

describe('applyState: карта и использованные выходы', () => {
  beforeEach(() => {
    resetForStart({ youId: 'p1', width: 5, height: 5 });
  });

  it('сбрасывает раскрытие журнала при старте', () => {
    state.logExpanded = true;
    resetForStart({ youId: 'p1', width: 5, height: 5 });
    expect(state.logExpanded).toBe(false);
  });

  it('сохраняет следующего игрока и сбрасывает его при старте', () => {
    applyState(
      stateMessage({
        nextTurn: { id: 'p2', name: 'P2' },
      }) as never,
    );
    expect(state.nextTurn).toEqual({ id: 'p2', name: 'P2' });

    resetForStart({ youId: 'p1', width: 5, height: 5 });
    expect(state.nextTurn).toBeNull();
  });

  it('сразу перекрашивает известный выход после использования', () => {
    applyState(
      stateMessage({
        visible: {
          origin: { x: 2, y: 1 },
          cells: [['E', '#']],
          exits: [[2, 1]],
        },
      }) as never,
    );
    expect(state.known.get('2,1')).toBe('exit');

    applyState(
      stateMessage({
        visible: {
          origin: { x: 4, y: 4 },
          cells: [['.']],
          exits: [],
        },
        exitsRemaining: 0,
        usedExits: [[2, 1]],
      }) as never,
    );

    expect(state.known.get('2,1')).toBe('exitUsed');
  });

  it('в режиме наблюдения заменяет карту картой выбранного игрока', () => {
    state.known.set('9,9', 'exit');

    applyState(
      stateMessage({
        spectate: {
          mode: 'auto',
          targetId: 'p2',
          targetName: 'P2',
          known: [[2, 1, 'X']],
        },
        visible: {
          origin: { x: 4, y: 4 },
          cells: [['.']],
          exits: [],
        },
      }) as never,
    );

    expect(state.known.has('9,9')).toBe(false);
    expect(state.known.get('2,1')).toBe('exitUsed');
    expect(state.watchedId).toBe('p2');
  });
});
