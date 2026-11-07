import { state, canMove, hueForId } from './state.js';

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

function $(selector) {
  return document.querySelector(selector);
}

export function setScreen(name) {
  state.screen = name;
  for (const element of document.querySelectorAll('.screen')) {
    element.hidden = element.id !== `${name}-screen`;
  }
}

export function showJoinError(message) {
  const element = $('#join-error');
  element.textContent = message;
  element.hidden = false;
}

export function clearJoinError() {
  const element = $('#join-error');
  element.textContent = '';
  element.hidden = true;
}

export function showRoomsError(message) {
  const element = $('#rooms-error');
  element.textContent = message;
  element.hidden = false;
}

export function clearRoomsError() {
  const element = $('#rooms-error');
  element.textContent = '';
  element.hidden = true;
}

export function renderRooms(rooms) {
  state.rooms = rooms;

  const list = $('#rooms-list');
  const hint = $('#rooms-hint');

  if (rooms.length === 0) {
    list.innerHTML = '';
    hint.textContent = 'Комнат пока нет — создайте первую.';
    return;
  }

  hint.textContent = '';

  list.innerHTML = rooms
    .map((room) => {
      const full = room.playerCount >= room.maxPlayers;
      const joinable = room.phase === 'lobby' && !full;
      const owner = room.ownerName ? escapeHtml(room.ownerName) : 'без владельца';
      const status =
        room.phase === 'lobby'
          ? full
            ? 'полная'
            : 'ждёт игроков'
          : room.phase === 'playing'
            ? 'игра идёт'
            : 'игра окончена';
      const label = joinable
        ? 'Вступить'
        : full
          ? 'Полная'
          : room.phase === 'playing'
            ? 'Игра идёт'
            : 'Недоступна';

      return `<li class="room-item">
        <div class="room-info">
          <span class="room-code">${escapeHtml(room.id)}</span>
          <span class="player-name">${owner}</span>
          <span class="tags">${room.playerCount}/${room.maxPlayers} · ${room.mazeWidth}×${room.mazeHeight} · ${status}</span>
        </div>
        <button type="button" data-room-id="${escapeHtml(room.id)}" ${joinable ? '' : 'disabled'}>${label}</button>
      </li>`;
    })
    .join('');
}

export function renderLobby(message) {
  state.lobby = message;
  state.roomId = message.roomId;
  state.ownerId = message.ownerId;
  state.mazeWidth = message.mazeWidth;
  state.mazeHeight = message.mazeHeight;

  $('#room-code').textContent = message.roomId;
  $('#lobby-owner').textContent =
    message.players.find((player) => player.id === message.ownerId)?.name ??
    '—';
  $('#maze-size').textContent = `${message.mazeWidth}×${message.mazeHeight}`;
  $('#lobby-count').textContent = `${message.players.length} / ${message.maxPlayers}`;

  const list = $('#lobby-players');
  list.innerHTML = message.players
    .map((player) => {
      const isYou = player.id === state.youId;
      const isOwner = player.id === message.ownerId;
      return `<li class="${player.ready ? 'ready' : ''}">
        <span class="player-name">${escapeHtml(player.name)}${isYou ? ' <span class="you-tag">вы</span>' : ''}${isOwner ? ' <span class="you-tag">владелец</span>' : ''}</span>
        <span class="badge ${player.ready ? 'badge-ready' : ''}">${player.ready ? 'готов' : 'ждём'}</span>
      </li>`;
    })
    .join('');

  const me = message.players.find((player) => player.id === state.youId);
  const ready = Boolean(me && me.ready);
  const button = $('#ready-button');
  button.textContent = ready ? 'Отменить готовность' : 'Готов';
  button.disabled = false;

  const sizeForm = $('#maze-size-form');
  const isOwner = message.ownerId === state.youId;
  sizeForm.hidden = !isOwner;
  $('#maze-width').value = String(message.mazeWidth);
  $('#maze-height').value = String(message.mazeHeight);

  const hint = $('#lobby-hint');
  if (message.canStart) {
    hint.textContent = 'Все готовы — игра начинается!';
  } else if (!ready) {
    hint.textContent = `Нужно минимум ${message.minPlayers} игроков. Нажмите «Готов», когда будете готовы.`;
  } else {
    hint.textContent = 'Ждём остальных игроков…';
  }
}

export function renderGame() {
  const turn = state.turn;
  $('#turn-info').textContent = turn
    ? `${turn.name}${turn.id === state.youId ? ' (вы)' : ''}`
    : '—';
  $('#exits-info').textContent = String(state.exitsRemaining);
  $('#energy-info').textContent = state.you ? String(state.you.energy) : '—';

  const you = state.you;
  let youText = you ? you.name : '—';
  if (you) {
    if (you.pending === 'choose') {
      youText += ' — выберите действие';
    } else if (you.pending === 'wait') {
      youText += ' — ждём ответа';
    } else if (you.pending === 'respond') {
      youText += ' — вам предложили обмен';
    } else if (you.defeated && you.energy < 1) {
      youText += ' — повержен, ход пропускается';
    } else if (you.energy < 1) {
      youText += ' — нет энергии, ход пропускается';
    } else if (you.pos && state.phase === 'over') {
      youText += ' — игра окончена';
    }
  }
  $('#you-info').textContent = youText;

  renderPlayers();
  renderLog();
  renderControls();
}

function renderPlayers() {
  const list = $('#players-panel');
  list.innerHTML = state.players
    .map((player) => {
      const tags = [`энергия: ${player.energy}`];
      if (player.id === state.youId) tags.push('вы');
      if (player.isTurn && state.phase === 'playing') tags.push('ходит');
      if (player.escaped) tags.push('сбежал');
      else if (!player.connected) tags.push('отключён');
      else if (player.defeated && player.energy < 1) tags.push('повержен');
      else if (player.energy < 1) tags.push('нет энергии');

      const classes = [
        player.isTurn && state.phase === 'playing' ? 'current' : '',
        player.escaped ? 'escaped' : '',
        !player.connected ? 'offline' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<li class="${classes}">
        <span class="dot" style="--hue: ${hueForId(player.id)}"></span>
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="tags">${tags.join(' · ')}</span>
      </li>`;
    })
    .join('');
}

function renderLog() {
  const log = $('#log-panel');
  const entries = state.log.slice(-20);
  log.innerHTML = entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');
  log.scrollTop = log.scrollHeight;
}

export function renderControls() {
  const enabled = canMove();
  for (const button of document.querySelectorAll('#controls button')) {
    button.disabled = !enabled;
  }
}

export function closeModal() {
  $('#modal-root').innerHTML = '';
}

export function showChoiceModal(message, onChoose) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay">
    <div class="card modal" role="dialog" aria-modal="true">
      <h2>На пути игрок ${escapeHtml(message.targetName)}</h2>
      <p class="muted">Соперник занимает клетку. Что делаем?</p>
      <p class="muted">
        Обмен: по 1 энергии каждому. Бой: победитель тратит 1 энергию,
        проигравший — 3.
      </p>
      <div class="modal-actions">
        <button type="button" data-action="swap">Поменяться клетками</button>
        <button type="button" data-action="fight" class="danger">Вступить в бой</button>
      </div>
    </div>
  </div>`;

  root.querySelector('[data-action="swap"]').addEventListener('click', () => {
    closeModal();
    onChoose('swap');
  });
  root.querySelector('[data-action="fight"]').addEventListener('click', () => {
    closeModal();
    onChoose('fight');
  });
}

export function showSwapModal(message, onRespond) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay">
    <div class="card modal" role="dialog" aria-modal="true">
      <h2>${escapeHtml(message.fromName)} предлагает обмен</h2>
      <p class="muted">
        Обмен стоит по 1 энергии каждому. Если отказаться, начнётся бой:
        победитель тратит 1 энергию, проигравший — 3.
      </p>
      <div class="modal-actions">
        <button type="button" data-action="accept">Принять обмен</button>
        <button type="button" data-action="decline" class="danger">Отказаться (бой)</button>
      </div>
    </div>
  </div>`;

  root.querySelector('[data-action="accept"]').addEventListener('click', () => {
    onRespond(true);
  });
  root.querySelector('[data-action="decline"]').addEventListener('click', () => {
    onRespond(false);
  });
}

export function showGameOver(message, onAck) {
  const escaped =
    message.escaped.length > 0
      ? message.escaped.map(escapeHtml).join(', ')
      : 'никто';
  const losers =
    message.losers.length > 0 ? message.losers.map(escapeHtml).join(', ') : '—';

  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay">
    <div class="card modal" role="dialog" aria-modal="true">
      <h2>Игра окончена</h2>
      <p><span class="label">Сбежали:</span> ${escaped}</p>
      <p><span class="label">Не сбежали:</span> ${losers}</p>
      <div class="modal-actions">
        <button type="button" data-action="back">В лобби</button>
      </div>
    </div>
  </div>`;

  const button = root.querySelector('[data-action="back"]');
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Ждём остальных…';
    onAck();
  });
}

export function toast(message) {
  const root = $('#toast-root');
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  root.append(element);

  while (root.children.length > 3) {
    root.firstElementChild.remove();
  }

  window.setTimeout(() => {
    element.classList.add('toast-out');
    window.setTimeout(() => element.remove(), 250);
  }, 4000);
}

export function showConnectionLost() {
  const overlay = $('#connection-overlay');
  overlay.hidden = false;
}
