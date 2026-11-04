import { createConnection } from './net.js';
import { state, resetForStart, applyState, canMove } from './state.js';
import { BoardRenderer } from './render.js';
import * as ui from './ui.js';

const renderer = new BoardRenderer(document.querySelector('#board'));
const joinButton = document.querySelector('#join-form button[type="submit"]');
let connection = null;
let joining = false;

function ensureConnection() {
  if (connection) return connection;
  connection = createConnection({
    onMessage: handleMessage,
    onClose: () => ui.showConnectionLost(),
  });
  return connection;
}

function handleMessage(message) {
  switch (message.type) {
    case 'welcome':
      state.youId = message.youId;
      state.name = message.name;
      state.maxPlayers = message.maxPlayers;
      joining = false;
      joinButton.disabled = false;
      ui.clearJoinError();
      break;

    case 'lobby':
      joining = false;
      joinButton.disabled = false;
      state.phase = 'lobby';
      state.over = null;
      state.busy = false;
      state.turn = null;
      state.you = null;
      state.players = [];
      state.log = [];
      ui.closeModal();
      ui.setScreen('lobby');
      ui.renderLobby(message);
      break;

    case 'start':
      resetForStart(message);
      ui.closeModal();
      ui.setScreen('game');
      ui.renderGame();
      renderer.draw();
      break;

    case 'state':
      applyState(message);
      if (state.you) state.youId = state.you.id;
      ui.renderGame();
      renderer.draw();
      break;

    case 'chooseAction':
      state.busy = true;
      ui.renderControls();
      ui.showChoiceModal(message, (action) => {
        state.busy = true;
        ui.renderControls();
        connection.send({ type: 'chooseAction', action });
      });
      break;

    case 'swapOffer':
      state.busy = true;
      ui.renderControls();
      ui.showSwapModal(message, (accept) => {
        state.busy = true;
        ui.closeModal();
        ui.renderControls();
        connection.send({ type: 'respondSwap', accept });
      });
      break;

    case 'event':
      ui.toast(message.message);
      break;

    case 'moveRejected':
      state.busy = false;
      if (message.reason === 'wall') ui.toast('Туда нельзя: стена');
      if (message.reason === 'notTurn') ui.toast('Сейчас не ваш ход');
      ui.renderControls();
      break;

    case 'gameOver':
      state.phase = 'over';
      state.over = message;
      state.busy = false;
      ui.renderGame();
      renderer.draw();
      ui.showGameOver(message, () => {
        connection.send({ type: 'backToLobby' });
      });
      break;

    case 'error':
      if (!state.youId) {
        joining = false;
        joinButton.disabled = false;
        ui.showJoinError(message.message);
      } else {
        ui.toast(message.message);
      }
      break;

    default:
      break;
  }
}

function sendMove(dir) {
  if (!canMove()) return;
  state.busy = true;
  ui.renderControls();
  ensureConnection().send({ type: 'move', dir });
}

document.querySelector('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (joining || state.youId) return;

  const input = document.querySelector('#name-input');
  const name = input.value.trim();
  if (!name) return;

  joining = true;
  joinButton.disabled = true;
  ui.clearJoinError();
  ensureConnection().send({ type: 'join', name });
});

document.querySelector('#ready-button').addEventListener('click', () => {
  const me = state.lobby
    ? state.lobby.players.find((player) => player.id === state.youId)
    : null;
  ensureConnection().send({ type: 'ready', value: !(me && me.ready) });
});

document.querySelector('#controls').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-dir]');
  if (!button) return;
  sendMove(button.dataset.dir);
});

const KEY_TO_DIR = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  ц: 'up',
  ы: 'down',
  ф: 'left',
  в: 'right',
};

window.addEventListener('keydown', (event) => {
  if (state.screen !== 'game') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const dir = KEY_TO_DIR[key];
  if (!dir) return;

  event.preventDefault();
  sendMove(dir);
});

window.addEventListener('resize', () => {
  if (state.screen === 'game') {
    renderer.draw();
  }
});
