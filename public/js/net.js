export function createConnection({ onMessage, onClose }) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}`);

  let opened = false;
  const queue = [];

  socket.addEventListener('open', () => {
    opened = true;
    while (queue.length > 0) {
      socket.send(queue.shift());
    }
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    onMessage(message);
  });

  socket.addEventListener('close', () => {
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
