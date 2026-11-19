import { pointKey, hueForPlayer, state } from './state.js';
import { BOARD_BACKGROUND, tileColor, WALL_EDGE } from './palette.js';
import { fitTileSize, measureBoardArea } from './layout.js';

const MIN_TILE = 10;

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize() {
    this.draw();
  }

  reset() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose() {
    this.reset();
  }

  draw(current = state) {
    const { width, height } = current;
    if (!width || !height) return;

    const { width: availableWidth, height: availableHeight } =
      measureBoardArea(this.canvas);

    const tile = fitTileSize({
      availableWidth,
      availableHeight,
      columns: width,
      rows: height,
      minTile: MIN_TILE,
    });

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
    ctx.fillStyle = BOARD_BACKGROUND;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = pointKey(x, y);
        const cell = current.known.get(key);
        const visible = current.visibleNow.has(key);

        const isExit = cell === 'exit' || cell === 'exitUsed';
        const fill = isExit
          ? tileColor('floor', visible)
          : cell
            ? tileColor(cell, visible)
            : BOARD_BACKGROUND;

        ctx.fillStyle = fill;
        ctx.fillRect(x * tile, y * tile, tile, tile);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.strokeRect(x * tile + 0.5, y * tile + 0.5, tile - 1, tile - 1);

        if (cell === 'wall') {
          ctx.lineWidth = 1;
          ctx.strokeStyle = WALL_EDGE;
          ctx.strokeRect(x * tile + 1, y * tile + 1, tile - 2, tile - 2);
        }

        if (isExit) {
          const size = tile * 0.55;
          ctx.fillStyle = tileColor(cell, visible);
          ctx.fillRect(
            x * tile + (tile - size) / 2,
            y * tile + (tile - size) / 2,
            size,
            size,
          );
        }
      }
    }

    const groups = new Map();
    for (const player of current.players) {
      if (!player.pos || player.escaped) continue;
      const key = pointKey(player.pos.x, player.pos.y);
      const group = groups.get(key);
      if (group) {
        group.push(player);
      } else {
        groups.set(key, [player]);
      }
    }

    for (const group of groups.values()) {
      const count = group.length;
      const base = group[0].pos;
      const spacing = tile * 0.22;
      const radius = count > 1 ? tile * 0.24 : tile * 0.32;

      group.forEach((player, index) => {
        const offset = (index - (count - 1) / 2) * spacing;
        const centerX = base.x * tile + tile / 2 + offset;
        const centerY = base.y * tile + tile / 2;
        const hue = hueForPlayer(player);

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${hue} 70% 52%)`;
        ctx.fill();

        if (player.id === current.youId) {
          ctx.lineWidth = Math.max(2, tile * 0.11);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + tile * 0.11, 0, Math.PI * 2);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.stroke();
        }

        if (current.watchedId && player.id === current.watchedId) {
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + tile * 0.17, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(1.5, tile * 0.08);
          ctx.strokeStyle = '#33ccff';
          ctx.stroke();
        }

        const initial = (player.name || '?').trim().charAt(0).toUpperCase();
        ctx.fillStyle = '#08111a';
        ctx.font = `bold ${Math.max(8, Math.round(radius * 1.3))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial, centerX, centerY + 1);

        if (player.defeated && player.energy < 1) {
          ctx.beginPath();
          ctx.arc(
            centerX + radius,
            centerY - radius,
            Math.max(2, tile * 0.09),
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = '#ff6b6b';
          ctx.fill();
        }
      });
    }
  }
}
