// Точка входа: рендер, камера, меню и главный цикл.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { Hud, scoreTable } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { FogOverlay, AimIndicator } from './overlays.js';
import { loadSettings, saveSettings } from './settings.js';
import { MAP, TEAM_NAME, HEROES, ABILITIES } from './config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has('auto') || location.hash === '#auto';
const SPEED = Number(params.get('speed')) || 1;

const settings = loadSettings();
const sound = new Sound();
sound.setVolumes(settings.sfx, settings.music);

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.type = THREE.PCFShadowMap;

const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 220);
const CAM_OFFSET = new THREE.Vector3(0, 26, 15);
const camTarget = new THREE.Vector3(-MAP.fountainX + 6, 0, 0);

let scene, world, game, hud, fog, aim;
const input = new Input();
let state = 'menu'; // menu | play | pause | end

function applyQuality() {
  const q = settings.quality;
  renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = q !== 'low';
  document.documentElement.style.setProperty('--btn-scale', settings.buttons);
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1.4 ? 48 : 36;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function disposeScene(s) {
  s.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  fog?.dispose();
}

// --- меню -------------------------------------------------------------------------
function buildMenu() {
  const wrap = $('heroCards');
  wrap.textContent = '';
  for (const [id, h] of Object.entries(HEROES)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'hero';
    input.value = id;
    input.id = `hero-${id}`;
    input.checked = settings.hero === id;
    const card = document.createElement('span');
    card.className = 'hero-card';
    const name = document.createElement('b');
    name.textContent = h.name;
    const role = document.createElement('i');
    role.textContent = h.role;
    const desc = document.createElement('small');
    desc.textContent = h.desc;
    const list = document.createElement('ul');
    h.abilities.forEach((a, i) => {
      const li = document.createElement('li');
      li.textContent = `${'QWER'[i]}: ${ABILITIES[a].name}`;
      list.append(li);
    });
    card.append(name, role, desc, list);
    label.append(input, card);
    wrap.append(label);
  }
  const check = (name, value) => { const el = document.querySelector(`input[name="${name}"][value="${value}"]`); if (el) el.checked = true; };
  check('mode', settings.mode);
  check('diff', settings.difficulty);
  check('quality', settings.quality);
  $('setSfx').value = settings.sfx;
  $('setMusic').value = settings.music;
  $('setButtons').value = settings.buttons;
}

function bindSettings() {
  const save = () => { saveSettings(settings); };
  $('setSfx').addEventListener('input', (e) => { settings.sfx = +e.target.value; sound.setVolumes(settings.sfx, settings.music); save(); });
  $('setMusic').addEventListener('input', (e) => { settings.music = +e.target.value; sound.setVolumes(settings.sfx, settings.music); save(); });
  $('setButtons').addEventListener('input', (e) => { settings.buttons = +e.target.value; applyQuality(); save(); });
  for (const r of document.querySelectorAll('input[name="quality"]')) {
    r.addEventListener('change', () => {
      settings.quality = r.value;
      applyQuality();
      save();
      if (state !== 'play' && state !== 'pause') newMatch();
    });
  }
}

function readMenu() {
  settings.hero = document.querySelector('input[name="hero"]:checked')?.value ?? 'pyro';
  settings.mode = document.querySelector('input[name="mode"]:checked')?.value ?? '3v3';
  settings.difficulty = document.querySelector('input[name="diff"]:checked')?.value ?? 'normal';
  saveSettings(settings);
}

// --- матч -------------------------------------------------------------------------
function newMatch(opts = {}) {
  if (scene) disposeScene(scene);
  if (hud) hud.clear();
  scene = new THREE.Scene();
  world = buildWorld(scene, settings.quality);
  game = new Game(scene, {
    difficulty: settings.difficulty, mode: opts.mode ?? settings.mode, heroId: opts.heroId ?? settings.hero, autoplay: AUTOPLAY,
  });
  fog = new FogOverlay(scene);
  aim = new AimIndicator(scene);
  hud = new Hud(game, camera);
  input.reset();
  input.setAimModes(Object.fromEntries('QWER'.split('').map((k) => [k, game.player.ability(k).aim])));
  bindSounds(game);
  game.on('gameover', (winner) => setTimeout(() => showEnd(winner), 1800));
  camTarget.set(game.player.pos.x + 6, 0, game.player.pos.z);
  window.dota3 = { game, simulate };
}

function bindSounds(g) {
  const p = g.player;
  const near = (u) => u.pos;
  g.on('attack', (u) => { if (u.kind === 'hero') sound.play(u.heroId === 'lira' ? 'arrow' : u.ranged ? 'shoot' : 'hit', near(u)); });
  g.on('towershot', (t) => sound.play('tower', t.pos));
  g.on('damage', ({ source, target, crit }) => { if (source === p || target === p) sound.play(crit ? 'crit' : 'hit'); });
  g.on('cast', ({ hero, id }) => {
    const map = { fireball: 'fireball', frost: 'frost', shield: 'shield', stoneSkin: 'shield', frenzy: 'buff', shieldBash: 'dash', roll: 'dash', volley: 'arrow', harpoon: 'arrow', meteor: 'fireball' };
    if (map[id]) sound.play(map[id], hero.pos);
  });
  g.on('boom', ({ x, z, big }) => sound.play(big ? 'boom' : 'smallboom', { x, z }));
  g.on('herokill', ({ victim, killer }) => {
    sound.play('death', victim.pos);
    if (victim === p) sound.play('bad');
    else if (killer && killer.team === p.team) sound.play('kill');
  });
  g.on('structure', (t) => sound.play('structure', t.pos));
  g.on('levelup', (h) => { if (h === p) sound.play('levelup'); });
  g.on('bought', ({ hero }) => { if (hero === p) sound.play('coin'); });
  g.on('monster', ({ monster, hero }) => { if (monster.monsterKind === 'dragon') sound.play('roar'); else if (hero === p) sound.play('buff'); });
  g.on('dragonspawn', () => sound.play('roar'));
  g.on('active', ({ hero }) => sound.play('shield', hero.pos));
}

function showEnd(winner) {
  state = 'end';
  const win = winner === game.player.team;
  $('endTitle').textContent = win ? 'Победа' : 'Поражение';
  const t = Math.floor(game.time);
  $('endStats').textContent = `${TEAM_NAME[winner]} разрушили нексус за ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}.`;
  $('endScore').replaceChildren(scoreTable(game));
  $('end').hidden = false;
  $('hud').hidden = true;
  sound.stopMusic();
}

function startGame() {
  readMenu();
  sound.init();
  sound.setVolumes(settings.sfx, settings.music);
  sound.play('click');
  newMatch();
  $('menu').hidden = true;
  $('end').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  state = 'play';
  sound.startMusic();
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* нет полноэкранного режима */ }
  try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* нельзя зафиксировать поворот */ }
  try { navigator.wakeLock?.request('screen')?.catch(() => {}); } catch { /* экран может гаснуть */ }
}

function pause(on) {
  if (on && state === 'play') {
    state = 'pause';
    $('pauseTitle').textContent = 'Пауза';
    $('resumeBtn').textContent = 'Продолжить';
    $('quitBtn').hidden = false;
    $('pause').hidden = false;
    input.reset();
    sound.suspend();
  } else if (!on && state === 'pause') {
    state = 'play';
    $('pause').hidden = true;
    sound.resume();
  }
}

function toMenu() {
  state = 'menu';
  $('pause').hidden = true;
  $('end').hidden = true;
  $('hud').hidden = true;
  $('menu').hidden = false;
  sound.stopMusic();
  sound.resume();
  newMatch();
}

buildMenu();
bindSettings();
applyQuality();
$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', toMenu);
$('resumeBtn').addEventListener('click', () => {
  if (state === 'pause') pause(false);
  else { $('pause').hidden = true; $('menu').hidden = false; }
});
$('quitBtn').addEventListener('click', toMenu);
$('settingsBtn').addEventListener('click', () => {
  $('pauseTitle').textContent = 'Настройки';
  $('resumeBtn').textContent = 'Готово';
  $('quitBtn').hidden = true;
  $('menu').hidden = true;
  $('pause').hidden = false;
});
// Свернули игру — пауза
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

// Превращает жест прицела в цель для умения
function manualAim(hero, key, m) {
  const def = hero.ability(key);
  const dir = { x: m.dx, z: m.dz };
  if (def.aim === 'circle') {
    const d = Math.max(0.15, m.mag) * def.range;
    return { point: { x: hero.pos.x + dir.x * d, z: hero.pos.z + dir.z * d } };
  }
  return { dir };
}

function applyPlayerInput() {
  const p = game.player;
  while (input.actions.length) {
    const a = input.actions.shift();
    if (a.type === 'pause') { pause(true); return; }
    if (a.type === 'score') hud.toggleScore();
    if (a.type === 'shop') hud.toggleShop();
    if (AUTOPLAY) continue;
    if (a.type === 'recall') p.intent.recall = true;
    if (a.type === 'rank') { if (p.rankUp(a.key)) sound.play('click'); }
    if (a.type === 'active') p.intent.active = true;
    if (a.type === 'quickbuy') { const s = game.nextBuildStep(p); if (s) game.buy(p, s.id); }
  }
  if (AUTOPLAY) return;
  const r = input.read();
  p.intent.mx = r.x;
  p.intent.mz = r.z;
  p.intent.attack = r.attack;
  p.intent.filter = r.filter;
  p.intent.target = null;
  if (input.casts.length && !p.intent.cast) {
    const c = input.casts.shift();
    p.intent.cast = { key: c.key, aim: c.manual ? manualAim(p, c.key, c.manual) : null };
    if (p.ranks[c.key] === 0 && p.canRankUp(c.key)) p.rankUp(c.key); // нажали на неизученное умение — сразу изучаем
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
  if (!game) newMatch();
  if (state === 'play') {
    applyPlayerInput();
    if (state === 'play') game.update(dt);
  }
  game.syncMeshes();
  const p = game.player;
  if (state === 'play' || state === 'pause') {
    hud.update(state === 'play' ? dt : 0);
    fog.update(game, p.team, dt);
    aim.update(p, input.aiming, input.cancelHover);
  }
  sound.listener = p.pos;

  const follow = state === 'menu' ? { x: Math.sin(now / 7000) * 34, z: Math.cos(now / 9000) * 6 } : p.pos;
  const k = Math.min(1, dt * 6) || 0.1;
  camTarget.x += (follow.x - camTarget.x) * k;
  camTarget.z += (follow.z * 0.75 - camTarget.z) * k;
  camera.position.copy(camTarget).add(CAM_OFFSET);
  if (game.shakeAmount > 0 && state === 'play') {
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

// Офлайн-режим и установка на главный экран (внутри встроенного просмотра не работает — это нормально)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

