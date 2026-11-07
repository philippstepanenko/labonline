import { state } from './state.js';
import { BoardRenderer } from './render.js';
import { toast } from './ui.js';

const STORAGE_KEY = 'labout.view-mode';
const DEFAULT_MODE = '2d';

function readMode() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === '3d' ? '3d' : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function storeMode(mode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Хранилище может быть недоступно в приватном режиме.
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export class ViewManager {
  constructor({ canvas2d, canvas3d, toggleRoot }) {
    this.canvas2d = canvas2d;
    this.canvas3d = canvas3d;
    this.toggleRoot = toggleRoot;
    this.renderer2d = new BoardRenderer(canvas2d);
    this.renderer3d = null;
    this.mode = DEFAULT_MODE;
    this.lastState = null;
    this.unsupported = false;
    this.loading3d = false;
  }

  attach() {
    if (this.toggleRoot) {
      this.toggleRoot.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-view]');
        if (!button || button.disabled) return;
        this.setMode(button.dataset.view);
      });
    }

    this.mode = readMode();
    this.applyMode();
  }

  async setMode(mode) {
    if (mode !== '2d' && mode !== '3d') return;
    if (mode === '3d' && this.unsupported) return;

    this.mode = mode;
    storeMode(mode);
    this.applyMode();

    if (mode === '3d') {
      await this.ensure3d();
      this.applyMode();
    }

    this.draw(this.lastState ?? state);
  }

  applyMode() {
    const show3d = this.mode === '3d' && Boolean(this.renderer3d);
    this.canvas2d.hidden = show3d;
    this.canvas3d.hidden = !show3d;

    if (!this.toggleRoot) return;
    for (const button of this.toggleRoot.querySelectorAll('button[data-view]')) {
      const active = button.dataset.view === this.mode;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (button.dataset.view === '3d') {
        button.disabled = this.unsupported;
      }
    }
  }

  activeRenderer() {
    return this.mode === '3d' ? this.renderer3d : this.renderer2d;
  }

  draw(current = state) {
    this.lastState = current;

    if (this.mode !== '3d') {
      this.renderer2d.draw(current);
      return;
    }

    if (!this.renderer3d) {
      this.renderer2d.draw(current);
      this.ensure3d().then(() => {
        this.applyMode();
        if (this.renderer3d && this.lastState) {
          this.renderer3d.draw(this.lastState);
        }
      });
      return;
    }

    this.renderer3d.draw(current);
  }

  resize() {
    const renderer = this.activeRenderer();
    if (renderer) renderer.resize();
  }

  reset() {
    this.renderer2d.reset();
    if (this.renderer3d) this.renderer3d.reset();
  }

  dispose() {
    this.renderer2d.dispose();
    if (this.renderer3d) {
      this.renderer3d.dispose();
      this.renderer3d = null;
    }
  }

  async ensure3d() {
    if (this.renderer3d || this.unsupported || this.loading3d) {
      return this.renderer3d;
    }

    if (!supportsWebGL()) {
      this.fallbackTo2d();
      return null;
    }

    this.loading3d = true;
    try {
      const { ThreeRenderer } = await import('./render3d.js');
      this.renderer3d = new ThreeRenderer(this.canvas3d);
      this.applyMode();
      return this.renderer3d;
    } catch (error) {
      console.error('Не удалось включить 3D-режим', error);
      this.fallbackTo2d();
      return null;
    } finally {
      this.loading3d = false;
    }
  }

  fallbackTo2d() {
    this.unsupported = true;
    this.mode = '2d';
    storeMode('2d');
    this.applyMode();
    toast('3D недоступен на этом устройстве, включён 2D.');
    this.renderer2d.draw(this.lastState ?? state);
  }
}
