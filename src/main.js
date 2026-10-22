// Точка входа: рендер, камера, меню и главный цикл.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { MAP, TEAM_NAME } from './config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has('auto') || location.hash === '#auto';
const SPEED = Number(params.get('speed')) || 1;

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 200);
const CAM_OFFSET = new THREE.Vector3(0, 26, 15);
const camTarget = new THREE.Vector3(-MAP.fountainX + 6, 0, 0);

let scene, world, game, hud;
const input = new Input();
let state = 'menu';

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // на узких экранах камера чуть дальше, чтобы видеть линию
  camera.fov = w / h < 1.4 ? 48 : 36;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function disposeScene(s) {
  s.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

function newMatch(difficulty) {
  if (scene) disposeScene(scene);
  if (hud) hud.clear();
  scene = new THREE.Scene();
  world = buildWorld(scene);
  game = new Game(scene, { difficulty, autoplay: AUTOPLAY });
  hud = new Hud(game, camera);
  input.reset();
  game.on('gameover', (winner) => setTimeout(() => showEnd(winner), 1800));
  camTarget.set(game.player.pos.x + 6, 0, 0);
  window.dota3 = { game, simulate };
}

function showEnd(winner) {
  state = 'end';
  const win = winner === game.player.team;
  $('endTitle').textContent = win ? 'Победа' : 'Поражение';
  const p = game.player;
  const t = Math.floor(game.time);
  $('endStats').textContent = `${TEAM_NAME[winner]} разрушили нексус за ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}. `
    + `Ваш счёт: ${p.kills} / ${p.deaths}, уровень ${p.level}.`;
  $('end').hidden = false;
  $('hud').hidden = true;
}

function startGame() {
  const diff = document.querySelector('input[name="diff"]:checked')?.value ?? 'normal';
  newMatch(diff);
  $('menu').hidden = true;
  $('end').hidden = true;
  $('hud').hidden = false;
  state = 'play';
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* нет полноэкранного режима */ }
  try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* нельзя зафиксировать поворот */ }
  try { navigator.wakeLock?.request('screen')?.catch(() => {}); } catch { /* экран может гаснуть */ }
}

$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', () => { $('end').hidden = true; $('menu').hidden = false; state = 'menu'; });

function applyPlayerInput() {
  const p = game.player;
  if (AUTOPLAY) return;
  const r = input.read();
  p.intent.mx = r.x;
  p.intent.mz = r.z;
  p.intent.attack = r.attack;
  p.intent.target = null;
  // по одному умению за кадр, чтобы быстрые нажатия не терялись
  if (input.casts.length && !p.intent.cast) p.intent.cast = input.casts.shift();
  while (input.actions.length) {
    const a = input.actions.shift();
    if (a === 'recall') p.intent.recall = true;
    if (a === 'shop') hud.toggleShop();
  }
}

// Прокрутка матча без отрисовки (для тестов)
function simulate(seconds, step = 1 / 30) {
  for (let t = 0; t < seconds && !game.over; t += step) game.update(step);
  return { time: game.time, over: game.over, winner: game.winner, kills: game.kills };
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  if (!game) {
    // фон меню: пустая карта без матча
    newMatch('normal');
  }
  if (state === 'play') {
    applyPlayerInput();
    game.update(dt);
  }
  game.syncMeshes(dt);
  if (state === 'play') hud.update(dt);

  const p = game.player;
  const follow = state === 'menu' ? { x: Math.sin(now / 6000) * 30, z: 0 } : p.pos;
  camTarget.x += (follow.x - camTarget.x) * Math.min(1, dt * 6);
  camTarget.z += (follow.z * 0.6 - camTarget.z) * Math.min(1, dt * 6);
  camera.position.copy(camTarget).add(CAM_OFFSET);
  if (game.shakeAmount > 0) {
    camera.position.x += (Math.random() - 0.5) * game.shakeAmount;
    camera.position.y += (Math.random() - 0.5) * game.shakeAmount;
  }
  camera.lookAt(camTarget.x, 0, camTarget.z - 1.5);
  world.sun.position.set(camTarget.x - 20, 40, camTarget.z + 18);
  world.sun.target.position.set(camTarget.x, 0, camTarget.z);

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

if (AUTOPLAY) setTimeout(startGame, 50);

// Офлайн-режим и установка на главный экран (не работает внутри встроенного просмотра — это нормально)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
