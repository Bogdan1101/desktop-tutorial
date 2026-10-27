// Точка входа: рендер, камера, меню, профиль и главный цикл.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Game } from './game.js';
import { Hud, scoreTable } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { FogOverlay, AimIndicator, TargetMarker } from './overlays.js';
import { loadSettings, saveSettings } from './settings.js';
import { loadRobot, disposeObject } from './models.js';
import { Tutorial } from './tutorial.js';
import { ImpactFx } from './impacts.js';
import {
  loadProfile, recordMatch, claimQuest, questDef, finishTutorial, buySkin, equipSkin, ownsSkin, equippedSkin, TUTORIAL_REWARD,
} from './profile.js';
import { MAP, TEAM_NAME, HEROES, ABILITIES, TALENTS, SPELLS, SKINS, HERO } from './config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has('auto') || location.hash === '#auto';
const SPEED = Number(params.get('speed')) || 1;

const settings = loadSettings();
const profile = loadProfile();
const sound = new Sound();
sound.setVolumes(settings.sfx, settings.music);

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.type = THREE.PCFShadowMap;

const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 220);
const CAM_OFFSET = new THREE.Vector3(0, 26, 15);
const camTarget = new THREE.Vector3(-MAP.fountainX + 6, 0, 0);

let scene, world, game, hud, fog, aim, marker, impacts, tutorial = null;
const input = new Input();
let state = 'menu'; // menu | play | pause | end

// Все переходы между экранами идут через setState: ввод принимается только в матче,
// а при любом переходе незавершённые жесты и нажатия отменяются.
function setState(next) {
  state = next;
  input.setEnabled(next === 'play');
  hud?.clearCastFeedback();
}

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

// Старый матч: каждый владелец освобождает своё ровно один раз
function disposeScene(s) {
  game?.dispose();   // скелеты и анимации героев
  fog?.dispose();    // текстура тумана
  marker?.dispose(); // маркер цели: освобождает себя и уходит со сцены
  impacts?.dispose(); // пул откликов на попадание
  disposeObject(s);  // остальное в сцене; общие ресурсы помечены shared и остаются
}

// Короткая вибрация (на телефонах с Android; где не поддерживается — молчит)
function vibrate(pattern) {
  if (!settings.vibration) return;
  try { navigator.vibrate?.(pattern); } catch { /* недоступно */ }
}

// --- меню -------------------------------------------------------------------------
function radio(name, value, text, checked) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.id = `${name}-${value}`;
  input.checked = checked;
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return label;
}

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
  const talents = $('talents');
  for (const [id, t] of Object.entries(TALENTS)) talents.append(radio('talent', id, t.name, settings.talent === id));
  const showTalent = () => { $('talentDesc').textContent = TALENTS[document.querySelector('input[name="talent"]:checked')?.value]?.desc ?? ''; };
  talents.addEventListener('change', showTalent);
  showTalent();
  const spells = $('spellPick');
  const chosen = [...settings.spells];
  for (const [id, sp] of Object.entries(SPELLS)) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = id;
    box.id = `spell-${id}`;
    box.checked = chosen.includes(id);
    box.addEventListener('change', () => {
      // ровно два заклинания: при выборе третьего снимается самое старое
      if (box.checked) { chosen.push(id); if (chosen.length > 2) { const old = chosen.shift(); $(`spell-${old}`).checked = false; } }
      else if (chosen.length <= 2) { box.checked = true; return; }
      settings.spells = [...chosen];
      saveSettings(settings);
    });
    const span = document.createElement('span');
    span.textContent = sp.name;
    span.title = sp.desc;
    label.append(box, span);
    spells.append(label);
  }
  const check = (name, value) => { const el = document.querySelector(`input[name="${name}"][value="${value}"]`); if (el) el.checked = true; };
  check('mode', settings.mode);
  check('diff', settings.difficulty);
  $('matchSetup').addEventListener('change', updateSetupSummary);
  updateSetupSummary();
  check('quality', settings.quality);
  $('setSfx').value = settings.sfx;
  $('setMusic').value = settings.music;
  $('setButtons').value = settings.buttons;
  $('setVibro').checked = settings.vibration;
  updateGems();
}

function updateGems() {
  $('menuGems').textContent = profile.crystals;
  $('profGems').textContent = profile.crystals;
  // новичку обучение предлагается заметно и с наградой; дальше это обычная кнопка
  $('tutorialBtn').classList.toggle('recommended', !profile.tutorialDone);
  $('tutorialReward').hidden = profile.tutorialDone;
  $('tutorialReward').textContent = `+${TUTORIAL_REWARD} кристаллов`;
}

// Краткая строка выбранной настройки матча: видно, с чем начнётся игра, не раскрывая блок
function updateSetupSummary() {
  const talent = document.querySelector('input[name="talent"]:checked')?.value;
  const diff = document.querySelector('input[name="diff"]:checked');
  const spells = settings.spells.map((id) => SPELLS[id]?.name).filter(Boolean).join(' + ');
  $('setupSummary').textContent = [TALENTS[talent]?.name, spells, diff?.nextElementSibling.textContent].filter(Boolean).join(' · ');
}

function bindSettings() {
  const save = () => { saveSettings(settings); };
  $('setSfx').addEventListener('input', (e) => { settings.sfx = +e.target.value; sound.setVolumes(settings.sfx, settings.music); save(); });
  $('setMusic').addEventListener('input', (e) => { settings.music = +e.target.value; sound.setVolumes(settings.sfx, settings.music); save(); });
  $('setButtons').addEventListener('input', (e) => { settings.buttons = +e.target.value; applyQuality(); save(); });
  $('setVibro').addEventListener('change', (e) => { settings.vibration = e.target.checked; save(); vibrate(30); });
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
  settings.talent = document.querySelector('input[name="talent"]:checked')?.value ?? 'onslaught';
  saveSettings(settings);
}

// --- профиль ----------------------------------------------------------------------
function renderProfile() {
  updateGems();
  const st = $('profStats');
  st.textContent = '';
  const winRate = profile.games ? Math.round((profile.wins / profile.games) * 100) : 0;
  const cells = [
    ['Матчей', profile.games], ['Побед', `${profile.wins} (${winRate}%)`], ['У / С / П', `${profile.kills} / ${profile.deaths} / ${profile.assists}`],
    ['Крипов', profile.cs],
    ...Object.entries(HEROES).map(([id, h]) => [h.name, `${profile.heroes[id]?.wins ?? 0} из ${profile.heroes[id]?.games ?? 0}`]),
  ];
  for (const [k, v] of cells) {
    const d = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = v;
    const s = document.createElement('small');
    s.textContent = k;
    d.append(b, s);
    st.append(d);
  }
  const ql = $('profQuests');
  ql.textContent = '';
  for (const q of profile.quests) {
    const def = questDef(q.id);
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${def.text} · ${q.progress} / ${def.goal}`;
    const btn = document.createElement('button');
    btn.textContent = q.claimed ? 'Получено' : `+${def.reward}`;
    btn.disabled = q.claimed || q.progress < def.goal;
    btn.addEventListener('click', () => { if (claimQuest(profile, q.id)) { sound.play('coin'); renderProfile(); } });
    const bar = document.createElement('span');
    bar.className = 'qbar';
    const fill = document.createElement('i');
    fill.style.width = `${(q.progress / def.goal) * 100}%`;
    bar.append(fill);
    li.append(text, btn, bar);
    ql.append(li);
  }
  if (!profile.tutorialDone) {
    const li = document.createElement('li');
    li.textContent = `Пройдите обучение · +${TUTORIAL_REWARD}`;
    ql.append(li);
  }
  const sk = $('profSkins');
  sk.textContent = '';
  for (const [heroId, list] of Object.entries(SKINS)) {
    const box = document.createElement('div');
    box.className = 'skin-hero';
    const name = document.createElement('b');
    name.textContent = HEROES[heroId].name;
    box.append(name);
    for (const skin of list) {
      const row = document.createElement('div');
      row.className = 'skin-row';
      const sw = document.createElement('i');
      sw.style.background = skin.main ? `#${skin.main.toString(16).padStart(6, '0')}` : 'linear-gradient(90deg,#3d8bff 50%,#ff4a3d 50%)';
      const label = document.createElement('span');
      label.textContent = skin.name;
      const btn = document.createElement('button');
      const owned = ownsSkin(profile, heroId, skin.id);
      const on = equippedSkin(profile, heroId) === skin.id;
      btn.textContent = on ? 'Надет' : owned ? 'Надеть' : `${skin.cost} крист.`;
      btn.classList.toggle('on', on);
      btn.disabled = on || (!owned && profile.crystals < skin.cost);
      btn.addEventListener('click', () => {
        if (owned ? equipSkin(profile, heroId, skin.id) : buySkin(profile, heroId, skin.id)) { sound.play('coin'); renderProfile(); }
      });
      row.append(sw, label, btn);
      box.append(row);
    }
    sk.append(box);
  }
}

// --- матч -------------------------------------------------------------------------
function newMatch(opts = {}) {
  // обучение старого матча: снять подсветку, метки и обработчики до освобождения сцены
  tutorial?.dispose();
  tutorial = null;
  if (scene) disposeScene(scene);
  if (hud) hud.dispose();
  scene = new THREE.Scene();
  world = buildWorld(scene, settings.quality);
  const heroId = opts.heroId ?? settings.hero;
  game = new Game(scene, {
    difficulty: settings.difficulty, mode: opts.mode ?? settings.mode, heroId, autoplay: AUTOPLAY,
    talent: settings.talent, spells: opts.spells ?? settings.spells, skin: equippedSkin(profile, heroId),
  });
  fog = new FogOverlay(scene);
  aim = new AimIndicator(scene);
  marker = new TargetMarker(scene);
  impacts = new ImpactFx(scene, game, camera, { quality: settings.quality, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches });
  hud = new Hud(game, camera);
  input.reset();
  const p = game.player;
  input.setAimModes({
    ...Object.fromEntries('QWER'.split('').map((k) => [k, p.ability(k).aim])),
    S1: p.spells[0] === 'flash' ? 'line' : 'self',
    S2: p.spells[1] === 'flash' ? 'line' : 'self',
  });
  bindEvents(game);
  game.on('gameover', (winner) => setTimeout(() => showEnd(winner), 2200));
  camTarget.set(p.pos.x + 6, 0, p.pos.z);
  $('practicePanel').hidden = game.mode !== 'practice' || !!opts.tutorial;
  // для автотестов: состояние матча, ввода и экрана
  window.dota3 = { game, simulate, input, hud, marker, impacts, renderer, sound, get state() { return state; }, get tutorial() { return tutorial; } };
}

function bindEvents(g) {
  const p = g.player;
  // Звуки с места события — только если игроку видно это место (туман, кусты); иначе звук выдал бы
  // скрытый бой. Общие объявления (смерть героя своей команды, дракон, здания, серии) звучат всегда.
  const heard = (at) => g.shown(at);
  g.on('attack', (u) => { if (u.kind === 'hero' && heard(u)) sound.play(u.heroId === 'lira' ? 'arrow' : u.ranged ? 'shoot' : 'hit', u.pos); });
  g.on('towershot', (t) => sound.play('tower', t.pos));
  g.on('damage', ({ source, target, crit, amount, dot }) => {
    if (dot) return;
    if (source === p || target === p) sound.play(crit ? 'crit' : 'hit');
    if (target === p && amount > p.maxHp * 0.08) vibrate(25);
  });
  g.on('cast', ({ hero, id }) => {
    const map = { fireball: 'fireball', frost: 'frost', shield: 'shield', stoneSkin: 'shield', frenzy: 'buff', shieldBash: 'dash', roll: 'dash', volley: 'arrow', harpoon: 'arrow', meteor: 'fireball' };
    if (map[id] && heard(hero)) sound.play(map[id], hero.pos);
  });
  g.on('spell', ({ hero, id }) => { if (heard(hero)) sound.play(id === 'flash' ? 'dash' : id === 'ignite' ? 'fireball' : 'shield', hero.pos); });
  g.on('boom', ({ x, z, big, r, at }) => { if (heard(at ?? { x, z, r })) sound.play(big ? 'boom' : 'smallboom', { x, z }); });
  g.on('herokill', ({ victim, killer }) => {
    if (victim.team === p.team || heard(victim)) sound.play('death', victim.pos);
    if (victim === p) { sound.play('bad'); vibrate(250); } else if (killer && killer.team === p.team) { sound.play('kill'); if (killer === p) vibrate([40, 60, 40]); }
  });
  g.on('structure', (t) => sound.play('structure', t.pos));
  g.on('levelup', (h) => { if (h === p) { sound.play('levelup'); vibrate(30); } });
  g.on('bought', ({ hero }) => { if (hero === p) sound.play('coin'); });
  g.on('monster', ({ monster, hero }) => { if (monster.monsterKind === 'dragon') sound.play('roar'); else if (hero === p) sound.play('buff'); });
  g.on('dragonspawn', () => sound.play('roar'));
  g.on('active', ({ hero }) => { if (heard(hero)) sound.play('shield', hero.pos); });
  g.on('plant', ({ hero }) => { if (hero === p) sound.play('buff'); });
  g.on('multikill', ({ hero }) => { if (hero.team === p.team) sound.play('kill'); });
}

function showEnd(winner) {
  setState('end');
  const p = game.player;
  const win = winner === p.team;
  $('endTitle').textContent = win ? 'Победа' : 'Поражение';
  const t = Math.floor(game.time);
  $('endStats').textContent = `${TEAM_NAME[winner]} разрушили нексус за ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}.`;
  $('endScore').replaceChildren(scoreTable(game));
  let questText = '';
  if (game.mode !== 'practice' && !AUTOPLAY) {
    const done = recordMatch(profile, {
      won: win, heroId: p.heroId, kills: p.kills, deaths: p.deaths, assists: p.assists, cs: p.cs,
      dragons: game.teamStats[p.team].dragons, towers: game.teamStats[p.team].towers,
    });
    if (done.length) questText = `Задания выполнены: ${done.map((q) => q.text).join(', ')}. Награду заберите в профиле.`;
  }
  $('endQuests').textContent = questText;
  $('endQuests').hidden = !questText;
  $('end').hidden = false;
  $('hud').hidden = true;
  sound.stopMusic();
  updateGems();
}

function startGame(opts = {}) {
  readMenu();
  sound.init();
  sound.setVolumes(settings.sfx, settings.music);
  sound.play('click');
  newMatch(opts);
  if (opts.tutorial) {
    tutorial = new Tutorial(game, $('tutorialBox'), { scene, camera }, () => {
      // награда — один раз на профиль; сообщение о ней в окне завершения, без отдельного баннера
      const first = finishTutorial(profile);
      sound.play('levelup');
      updateGems();
      return first ? `Обучение пройдено: +${TUTORIAL_REWARD} кристаллов` : 'Обучение пройдено';
    }, {
      // первый матч тем же героем; сохранённый режим (например, 3 на 3) не меняется
      onMatch: () => startGame({ mode: '1v1' }),
      onStay: () => { $('practicePanel').hidden = false; },
    });
  }
  $('menu').hidden = true;
  $('end').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  setState('play');
  sound.startMusic();
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* нет полноэкранного режима */ }
  try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* нельзя зафиксировать поворот */ }
  try { navigator.wakeLock?.request('screen')?.catch(() => {}); } catch { /* экран может гаснуть */ }
}

function pause(on) {
  if (on && state === 'play') {
    setState('pause');
    $('pauseTitle').textContent = 'Пауза';
    $('resumeBtn').textContent = 'Продолжить';
    $('quitBtn').hidden = false;
    $('pause').hidden = false;
    sound.suspend();
  } else if (!on && state === 'pause') {
    setState('play');
    $('pause').hidden = true;
    sound.resume();
  }
}

function toMenu() {
  setState('menu');
  for (const id of ['pause', 'end', 'hud', 'profile']) $(id).hidden = true;
  $('menu').hidden = false;
  sound.stopMusic();
  sound.resume();
  updateGems();
  newMatch({ mode: '1v1' });
}

buildMenu();
bindSettings();
applyQuality();
$('playBtn').addEventListener('click', () => startGame());
$('practiceBtn').addEventListener('click', () => startGame({ mode: 'practice' }));
$('tutorialBtn').addEventListener('click', () => startGame({ mode: 'practice', tutorial: true, spells: ['flash', 'ignite'] }));
$('profileBtn').addEventListener('click', () => { renderProfile(); $('menu').hidden = true; $('profile').hidden = false; });
$('profileBack').addEventListener('click', () => { $('profile').hidden = true; $('menu').hidden = false; updateGems(); });
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

// Модель робота грузится в фоне; до загрузки герои рисуются из простых фигур
loadRobot(window.ROBOT_URL ?? 'assets/robot.glb')
  .then(() => { if (state === 'menu') newMatch({ mode: '1v1' }); })
  .catch(() => { /* остаются простые модели */ });

// Превращает жест прицела в цель для умения или заклинания
function manualAim(hero, key, m) {
  const dir = { x: m.dx, z: m.dz };
  if (key[0] === 'S') return { dir };
  const def = hero.ability(key);
  if (def.aim === 'circle') {
    const d = Math.max(0.15, m.mag) * def.range;
    return { point: { x: hero.pos.x + dir.x * d, z: hero.pos.z + dir.z * d } };
  }
  return { dir };
}

function practiceAction(type) {
  const p = game.player, pr = game.practice;
  if (!pr) return;
  if (type === 'pr-level' && p.level < HERO.maxLevel) p.gainXp(HERO.xpToLevel(p.level) - p.xp);
  if (type === 'pr-gold') p.gold += 1000;
  if (type === 'pr-cd') { pr.noCooldowns = !pr.noCooldowns; $('prCd').classList.toggle('on', pr.noCooldowns); }
  if (type === 'pr-waves') { pr.waves = !pr.waves; $('prWaves').classList.toggle('on', pr.waves); }
}

function applyPlayerInput() {
  const p = game.player;
  while (input.actions.length) {
    const a = input.actions.shift();
    if (a.type === 'pause') { pause(true); return; }
    if (a.type === 'score') hud.toggleScore();
    if (a.type === 'shop') hud.toggleShop();
    if (a.type.startsWith('pr-')) practiceAction(a.type);
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
  if (input.casts.length && !p.intent.cast && !p.intent.spell) {
    const c = input.casts.shift();
    const aimed = c.manual ? manualAim(p, c.key, c.manual) : null;
    if (c.key[0] === 'S') {
      p.intent.spell = { id: p.spells[+c.key[1] - 1], aim: aimed };
    } else {
      if (p.ranks[c.key] === 0 && p.canRankUp(c.key)) p.rankUp(c.key); // нажали на неизученное умение — сразу изучаем
      p.intent.cast = { key: c.key, aim: aimed };
      if (aimed && p.abilityReady(c.key)) game.emit('manualcast', c.key);
    }
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
  if (!game) newMatch({ mode: '1v1' });
  if (state === 'play') {
    applyPlayerInput();
    if (state === 'play') game.update(dt);
    tutorial?.update(dt);
  }
  game.syncMeshes(state === 'pause' ? 0 : dt);
  const p = game.player;
  if (state === 'play' || state === 'pause') {
    hud.update(state === 'play' ? dt : 0);
    fog.update(game, p.team, dt);
    aim.update(p, input.aiming, input.cancelHover);
    hud.setTip(state === 'play' ? input.tipKey : null);
  }
  // маркер цели атаки: только в идущем матче и только на видимую цель
  marker.update(state === 'play' && !game.over ? p.attackTarget : null, dt);
  impacts.update(state === 'pause' ? 0 : dt); // на паузе отклики замирают вместе с игрой
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

if (AUTOPLAY) setTimeout(() => startGame(), 50);

// Офлайн-режим и установка на главный экран (внутри встроенного просмотра не работает — это нормально)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
