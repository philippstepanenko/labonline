# Побег из лабиринта

Сетевая пошаговая игра на Node.js + WebSocket. Клиент — vanilla JS без сборщика.

## Запуск

```bash
npm install
npm run dev
```

## 2D / 3D

В игровом экране есть переключатель вида. По умолчанию включён 2D; 3D — изометрический режим на Three.js. Выбор запоминается в `localStorage`, при недоступном WebGL игра остаётся в 2D.

Three.js вендорится локально в `public/vendor/three.module.min.js`. Чтобы обновить версию:

```bash
npm install --save-dev three@<версия>
npm run vendor:three
```
