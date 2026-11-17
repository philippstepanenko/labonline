import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/three/build/three.module.min.js');
const target = resolve(root, 'public/vendor/three.module.min.js');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log('Three.js скопирован в public/vendor');
