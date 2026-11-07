import * as THREE from '../vendor/three.module.min.js';
import { BOARD_BACKGROUND, TILE_COLORS } from './palette.js';
import { collectTiles, groupPlayers, tileToWorld } from './render3d-model.js';
import { hueForId } from './state.js';

const WALL_HEIGHT = 0.5;
const FLOOR_THICKNESS = 0.08;
const PLAYER_RADIUS = 0.22;
const PLAYER_LENGTH = 0.32;
const CAMERA_DISTANCE = 60;

function hslColor(hue) {
  return new THREE.Color().setHSL(hue / 360, 0.7, 0.52);
}

export class ThreeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setClearColor(BOARD_BACKGROUND, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BOARD_BACKGROUND);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x223044, 1.4);
    const directional = new THREE.DirectionalLight(0xffffff, 2.2);
    directional.position.set(6, 12, 8);
    this.scene.add(hemisphere, directional);

    this.tileGroup = new THREE.Group();
    this.playerGroup = new THREE.Group();
    this.scene.add(this.tileGroup, this.playerGroup);

    this.floorGeometry = new THREE.BoxGeometry(1, FLOOR_THICKNESS, 1);
    this.wallGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT, 1);
    this.exitGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 24);
    this.playerGeometry = new THREE.CapsuleGeometry(
      PLAYER_RADIUS,
      PLAYER_LENGTH,
      4,
      12,
    );
    this.ringGeometry = new THREE.TorusGeometry(0.32, 0.04, 8, 24);
    this.defeatedGeometry = new THREE.SphereGeometry(0.07, 10, 10);

    this.tileMaterials = {
      floor: {
        remembered: new THREE.MeshLambertMaterial({
          color: TILE_COLORS.floor.remembered,
        }),
        visible: new THREE.MeshLambertMaterial({
          color: TILE_COLORS.floor.visible,
        }),
      },
      wall: {
        remembered: new THREE.MeshLambertMaterial({
          color: TILE_COLORS.wall.remembered,
        }),
        visible: new THREE.MeshLambertMaterial({
          color: TILE_COLORS.wall.visible,
        }),
      },
      exit: {
        remembered: new THREE.MeshLambertMaterial({
          color: TILE_COLORS.exit.remembered,
          emissive: TILE_COLORS.exit.remembered,
          emissiveIntensity: 0.25,
        }),
        visible: new THREE.MeshLambertMaterial({
          color: TILE_COLORS.exit.visible,
          emissive: TILE_COLORS.exit.visible,
          emissiveIntensity: 0.6,
        }),
      },
    };

    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.defeatedMaterial = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
    this.playerMaterials = new Map();

    this.tileMeshes = new Map();
    this.lastState = null;
  }

  resize() {
    if (this.lastState) this.draw(this.lastState);
  }

  reset() {
    for (const entry of this.tileMeshes.values()) {
      this.tileGroup.remove(entry.mesh);
    }
    this.tileMeshes.clear();
    this.playerGroup.clear();
    this.lastState = null;
  }

  dispose() {
    this.reset();
    this.floorGeometry.dispose();
    this.wallGeometry.dispose();
    this.exitGeometry.dispose();
    this.playerGeometry.dispose();
    this.ringGeometry.dispose();
    this.defeatedGeometry.dispose();
    this.ringMaterial.dispose();
    this.defeatedMaterial.dispose();

    for (const materials of Object.values(this.tileMaterials)) {
      materials.remembered.dispose();
      materials.visible.dispose();
    }
    for (const material of this.playerMaterials.values()) {
      material.dispose();
    }
    this.playerMaterials.clear();

    this.renderer.dispose();
  }

  draw(current) {
    if (!current.width || !current.height) return;
    this.lastState = current;

    this.updateViewport(current.width, current.height);
    this.updateTiles(current);
    this.updatePlayers(current);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  playerMaterial(hue) {
    let material = this.playerMaterials.get(hue);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color: hslColor(hue) });
      this.playerMaterials.set(hue, material);
    }
    return material;
  }

  updateViewport(width, height) {
    const wrapper = this.canvas.parentElement;
    const cssWidth = Math.max(
      240,
      wrapper && wrapper.clientWidth > 0
        ? wrapper.clientWidth
        : window.innerWidth - 48,
    );
    const cssHeight = Math.max(240, window.innerHeight - 300);
    const aspect = cssWidth / cssHeight;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(cssWidth, cssHeight, true);

    const span = Math.max(width, height) * 1.45 + 2;
    let viewHeight = span;
    let viewWidth = span;
    if (viewWidth / viewHeight < aspect) {
      viewWidth = viewHeight * aspect;
    } else {
      viewHeight = viewWidth / aspect;
    }

    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const target = new THREE.Vector3(0, 0, 0);
    const offset = new THREE.Vector3(1, 1.4, 1)
      .normalize()
      .multiplyScalar(CAMERA_DISTANCE);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }

  updateTiles(current) {
    const tileData = collectTiles(current);
    const { width, height } = current;

    for (const tile of tileData) {
      const key = `${tile.x},${tile.y}`;
      let entry = this.tileMeshes.get(key);

      if (entry && entry.type !== tile.type) {
        this.tileGroup.remove(entry.mesh);
        this.tileMeshes.delete(key);
        entry = undefined;
      }

      if (!entry) {
        const mesh = this.createTileMesh(tile.type);
        const world = tileToWorld(tile.x, tile.y, width, height);
        mesh.position.set(world.x, mesh.userData.baseY, world.z);
        this.tileGroup.add(mesh);
        entry = { mesh, type: tile.type };
        this.tileMeshes.set(key, entry);
      }

      const materials = this.tileMaterials[tile.type];
      entry.mesh.material = tile.visible
        ? materials.visible
        : materials.remembered;
    }
  }

  createTileMesh(type) {
    if (type === 'wall') {
      const mesh = new THREE.Mesh(
        this.wallGeometry,
        this.tileMaterials.wall.remembered,
      );
      mesh.userData.baseY = WALL_HEIGHT / 2;
      return mesh;
    }

    if (type === 'exit') {
      const mesh = new THREE.Mesh(
        this.exitGeometry,
        this.tileMaterials.exit.remembered,
      );
      mesh.userData.baseY = 0.04;
      return mesh;
    }

    const mesh = new THREE.Mesh(
      this.floorGeometry,
      this.tileMaterials.floor.remembered,
    );
    mesh.userData.baseY = -FLOOR_THICKNESS / 2;
    return mesh;
  }

  updatePlayers(current) {
    this.playerGroup.clear();
    const { width, height } = current;
    const entries = groupPlayers(current.players, current.youId);

    for (const entry of entries) {
      const { player, offsetX, isYou } = entry;
      const world = tileToWorld(player.pos.x, player.pos.y, width, height);
      const hue = hueForId(player.id);
      const group = new THREE.Group();
      group.position.set(world.x + offsetX, 0, world.z);

      const body = new THREE.Mesh(
        this.playerGeometry,
        this.playerMaterial(hue),
      );
      body.position.y = (PLAYER_LENGTH + PLAYER_RADIUS * 2) / 2;
      group.add(body);

      if (isYou) {
        const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);
      }

      if (player.defeated && player.energy < 1) {
        const badge = new THREE.Mesh(
          this.defeatedGeometry,
          this.defeatedMaterial,
        );
        badge.position.y = PLAYER_LENGTH + PLAYER_RADIUS * 2 + 0.18;
        group.add(badge);
      }

      this.playerGroup.add(group);
    }
  }
}
