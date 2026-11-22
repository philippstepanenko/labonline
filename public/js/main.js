import { createConnection } from './net.js';
import { state, resetForStart, applyState, canMove } from './state.js';
import { ViewManager } from './view.js';
import { attachSwipeControls } from './swipe.js';
import * as ui from './ui.js';

const mobileQuery = window.matchMedia('(max-width: 560px)');
if (mobileQuery.matches) {
  state.playersCollapsed = true;
  state.eventsCollapsed = true;
}
mobileQuery.addEventListener('change', () => {
  if (state.screen === 'game') ui.renderGame();
  scheduleBackToLobbyOffset();
});

const view = new ViewManager({
  canvas2d: document.querySelector('#board'),
  canvas3d: document.querySelector('#board3d'),
  toggleRoot: document.querySelector('#view-toggle'),
});
view.attach();

const gameSidebar = document.querySelector('.sidebar');
const backToLobbyButton = document.querySelector('#back-to-lobby-button');
let backButtonOffsetFrame = 0;

function updateBackToLobbyOffset() {
  if (!backToLobbyButton) return;

  if (!mobileQuery.matches || backToLobbyButton.hidden || !gameSidebar) {
    backToLobbyButton.style.removeProperty('--back-button-offset');
    return;
  }

  const sidebarTop = gameSidebar.getBoundingClientRect().top;
  const maxOffset = Math.max(
    0,
    window.innerHeight - backToLobbyButton.offsetHeight - 24,
  );
  const offset = Math.min(
    maxOffset,
    Math.max(0, window.innerHeight - sidebarTop),
  );

  backToLobbyButton.style.setProperty('--back-button-offset', `${offset}px`);
}

function scheduleBackToLobbyOffset() {
  if (backButtonOffsetFrame) return;
  backButtonOffsetFrame = window.requestAnimationFrame(() => {
    backButtonOffsetFrame = 0;
    updateBackToLobbyOffset();
  });
}

if (typeof ResizeObserver !== 'undefined' && gameSidebar) {
  new ResizeObserver(scheduleBackToLobbyOffset).observe(gameSidebar);
}

window.addEventListener(
  'scroll',
  () => {
    if (backToLobbyButton && !backToLobbyButton.hidden) {
      scheduleBackToLobbyOffset();
    }
  },
  { passive: true },
);

const joinButton = document.querySelector('#join-form button[type="submit"]');
const createButton = document.querySelector(
  '#create-room-form button[type="submit"]',
);
let connection = null;

function ensureConnection() {
  if (connection) return connection;
  connection = createConnection({
    onMessage: handleMessage,
    onClose: () => ui.showConnectionLost(),
    onStale: () =>
      ui.toast('Соединение нестабильно, ждём ответа сервера…'),
  });
  return connection;
}

function handleMessage(message) {
  switch (message.type) {
    case 'welcome':
      state.youId = message.youId;
      state.name = message.name;
      state.maxPlayers = message.maxPlayers;
      state.roomId = message.roomId;
      joinButton.disabled = false;
      ui.clearJoinError();
      ui.clearRoomsError();
      break;

    case 'rooms':
      state.rooms = message.rooms;
      createButton.disabled = false;
      if (state.screen === 'rooms') {
        ui.renderRooms(message.rooms);
      }
      break;

    case 'lobby':
      state.phase = 'lobby';
      state.roomId = message.roomId;
      state.ownerId = message.ownerId;
      state.mazeWidth = message.mazeWidth;
      state.mazeHeight = message.mazeHeight;
      state.over = null;
      state.busy = false;
      state.turn = null;
      state.you = null;
      state.players = [];
      state.log = [];
      ui.closeModal();
      ui.hideBackToLobby();
      ui.setScreen('lobby');
      ui.renderLobby(message);
      break;

    case 'start':
      resetForStart(message);
      ui.closeModal();
      ui.hideBackToLobby();
      ui.setScreen('game');
      ui.renderGame();
      view.reset();
      view.draw();
      break;

    case 'state': {
      const wasSpectator = Boolean(state.spectate);
      applyState(message);
      if (state.you) state.youId = state.you.id;
      if (!wasSpectator && state.spectate) {
        ui.toast('Вы сбежали! Теперь можно наблюдать за другими игроками.');
      }
      ui.renderGame();
      view.draw();
      break;
    }

    case 'chooseAction':
      state.busy = true;
      ui.showChoiceModal(message, (action) => {
        state.busy = true;
        connection.send({ type: 'chooseAction', action });
      });
      break;

    case 'swapOffer':
      state.busy = true;
      ui.showSwapModal(message, (accept) => {
        state.busy = true;
        ui.closeModal();
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
      if (message.reason === 'noEnergy') ui.toast('Не хватает энергии');
      break;

    case 'gameOver':
      state.phase = 'over';
      state.over = message;
      state.busy = false;
      ui.renderGame();
      view.draw();
      ui.showGameOver(
        message,
        () => {
          ui.closeModal();
          ui.showBackToLobby();
          updateBackToLobbyOffset();
        },
        () => {
          connection.send({ type: 'backToLobby' });
        },
      );
      break;

    case 'error':
      if (!state.roomId) {
        joinButton.disabled = false;
        createButton.disabled = false;
        if (state.screen === 'rooms') {
          ui.showRoomsError(message.message);
          ui.renderRooms(state.rooms);
        } else {
          ui.showJoinError(message.message);
        }
      } else {
        ui.toast(message.message);
        if (state.lobby) ui.renderLobby(state.lobby);
      }
      break;

    default:
      break;
  }
}

function sendMove(dir) {
  if (!canMove()) return;
  state.busy = true;
  ensureConnection().send({ type: 'move', dir });
}

document.querySelector('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.youId) return;

  const input = document.querySelector('#name-input');
  const name = input.value.trim();
  if (!name) return;

  state.name = name;
  ui.clearJoinError();
  ui.clearRoomsError();
  ui.setScreen('rooms');
  ui.renderRooms(state.rooms);
  ensureConnection().send({ type: 'listRooms' });
});

document.querySelector('#rooms-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-room-id]');
  if (!button || button.disabled) return;
  if (!state.name) {
    ui.setScreen('join');
    return;
  }

  button.disabled = true;
  ensureConnection().send({
    type: 'joinRoom',
    name: state.name,
    roomId: button.dataset.roomId,
  });
});

document.querySelector('#create-room-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.name) {
    ui.setScreen('join');
    return;
  }

  const width = Number(document.querySelector('#create-width').value);
  const height = Number(document.querySelector('#create-height').value);

  createButton.disabled = true;
  ui.clearRoomsError();
  ensureConnection().send({
    type: 'createRoom',
    name: state.name,
    width,
    height,
  });
});

document.querySelector('#maze-size-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const width = Number(document.querySelector('#maze-width').value);
  const height = Number(document.querySelector('#maze-height').value);
  ensureConnection().send({ type: 'setMazeSize', width, height });
});

document.querySelector('#color-options').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-hue]');
  if (!button || button.disabled) return;
  ensureConnection().send({ type: 'setColor', hue: Number(button.dataset.hue) });
});

document.querySelector('#add-bot-button').addEventListener('click', () => {
  ensureConnection().send({ type: 'addBot' });
});

document.querySelector('#lobby-players').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-bot-id]');
  if (!button) return;
  ensureConnection().send({ type: 'removeBot', botId: button.dataset.botId });
});

document.querySelector('#ready-button').addEventListener('click', () => {
  const me = state.lobby
    ? state.lobby.players.find((player) => player.id === state.youId)
    : null;
  ensureConnection().send({ type: 'ready', value: !(me && me.ready) });
});

document.querySelector('#leave-room-button').addEventListener('click', () => {
  state.lobby = null;
  state.roomId = null;
  state.ownerId = null;
  ui.setScreen('rooms');
  ensureConnection().send({ type: 'leaveRoom' });
});

document.querySelector('#log-toggle').addEventListener('click', () => {
  state.logExpanded = !state.logExpanded;
  ui.renderLog();
  view.scheduleResize(true);
});

document.querySelector('#players-toggle').addEventListener('click', () => {
  state.playersCollapsed = !state.playersCollapsed;
  ui.renderGame();
  view.scheduleResize(true);
});

document.querySelector('#events-toggle').addEventListener('click', () => {
  state.eventsCollapsed = !state.eventsCollapsed;
  if (state.eventsCollapsed) state.logExpanded = false;
  ui.renderGame();
  view.scheduleResize(true);
});

document.querySelector('#info-button').addEventListener('click', () => {
  ui.showInfoModal();
});

attachSwipeControls(document.querySelector('.board-wrap'), (dir) => {
  if (state.screen !== 'game') return;
  sendMove(dir);
});

document.querySelector('#spectate-options').addEventListener('click', (event) => {
  const auto = event.target.closest('button[data-spectate="auto"]');
  if (auto) {
    ensureConnection().send({ type: 'spectate', mode: 'auto' });
    return;
  }

  const player = event.target.closest('button[data-spectate-player]');
  if (!player) return;
  ensureConnection().send({
    type: 'spectate',
    mode: 'player',
    targetId: player.dataset.spectatePlayer,
  });
});

document
  .querySelector('#back-to-lobby-button')
  .addEventListener('click', () => {
    const others = state.players.filter(
      (player) => player.connected && player.id !== state.youId,
    ).length;
    ui.showWaitingForLobby(others);
    updateBackToLobbyOffset();
    ensureConnection().send({ type: 'backToLobby' });
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
    view.scheduleResize(true);
    ui.renderLog();
  }
  scheduleBackToLobbyOffset();
});
