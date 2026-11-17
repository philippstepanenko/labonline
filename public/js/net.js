const STALE_AFTER_MS = 75000;
const STALE_CHECK_MS = 10000;

export function createConnection({ onMessage, onClose, onStale }) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}`);

  let opened = false;
  const queue = [];
  let lastMessageAt = Date.now();
  let staleNotified = false;

  const staleTimer = window.setInterval(() => {
    if (staleNotified || document.visibilityState !== 'visible') return;
    if (Date.now() - lastMessageAt < STALE_AFTER_MS) return;
    staleNotified = true;
    onStale?.();
  }, STALE_CHECK_MS);

  socket.addEventListener('open', () => {
    opened = true;
    while (queue.length > 0) {
      socket.send(queue.shift());
    }
  });

  socket.addEventListener('message', (event) => {
    lastMessageAt = Date.now();
    staleNotified = false;

    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message && message.type === 'ping') {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
      return;
    }

    onMessage(message);
  });

  socket.addEventListener('close', () => {
    window.clearInterval(staleTimer);
    onClose();
  });

  socket.addEventListener('error', () => {
    // Закрытие сокета придёт отдельным событием.
  });

  return {
    send(message) {
      const data = JSON.stringify(message);
      if (opened && socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      } else {
        queue.push(data);
      }
    },
  };
}
