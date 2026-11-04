import { pointKey, hueForId, state } from './state.js';

const MAX_TILE = 30;
const MIN_TILE = 10;

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(current = state) {
    const { width, height } = current;
    if (!width || !height) return;

    const wrapper = this.canvas.parentElement;
    const availableWidth =
      wrapper && wrapper.clientWidth > 0
        ? wrapper.clientWidth
        : window.innerWidth - 48;
    const availableHeight = Math.max(220, window.innerHeight - 300);

    const tile = Math.max(
      MIN_TILE,
      Math.min(
        MAX_TILE,
        Math.floor(Math.min(availableWidth / width, availableHeight / height)),
      ),
    );

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = width * tile;
    const cssHeight = height * tile;
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = pointKey(x, y);
        const cell = current.known.get(key);
        const visible = current.visibleNow.has(key);

        let fill = '#070a10';
        if (cell === 'wall') {
          fill = visible ? '#3a465e' : '#202839';
        } else if (cell === 'floor') {
          fill = visible ? '#20293a' : '#111722';
        } else if (cell === 'exit') {
          fill = visible ? '#33cc7a' : '#1d6b42';
        }

        ctx.fillStyle = fill;
        ctx.fillRect(x * tile, y * tile, tile, tile);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);

        if (cell === 'exit') {
          ctx.fillStyle = 'rgba(7, 10, 16, 0.42)';
          ctx.fillRect(
            x * tile + tile * 0.3,
            y * tile + tile * 0.3,
            tile * 0.4,
            tile * 0.4,
          );
        }
      }
    }

    for (const player of current.players) {
      if (!player.pos || player.escaped) continue;

      const centerX = player.pos.x * tile + tile / 2;
      const centerY = player.pos.y * tile + tile / 2;
      const hue = hueForId(player.id);

      ctx.beginPath();
      ctx.arc(centerX, centerY, tile * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${hue} 70% 52%)`;
      ctx.fill();

      if (player.id === current.youId) {
        ctx.lineWidth = Math.max(2, tile * 0.11);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, tile * 0.43, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.stroke();
      }

      const initial = (player.name || '?').trim().charAt(0).toUpperCase();
      ctx.fillStyle = '#08111a';
      ctx.font = `bold ${Math.max(9, Math.round(tile * 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, centerX, centerY + 1);

      if (player.skipNext) {
        ctx.beginPath();
        ctx.arc(
          centerX + tile * 0.3,
          centerY - tile * 0.3,
          Math.max(2, tile * 0.09),
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = '#ffd166';
        ctx.fill();
      }
    }
  }
}
