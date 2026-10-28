// Массовая симуляция матчей 3 на 3 ботами — без отрисовки, на настоящей логике игры (src/game.js).
//
//   node tools/sim.mjs --seeds 1-24 --out results/base.json [--cap 1800] [--dt 0.0333] [--trace 3,7]
//
// Сид задаёт всё случайное в матче: состав, таланты, решения ботов, криты. Math.random подменяется
// детерминированным генератором только в этом процессе — игровой код не меняется.
// По сиду: герой «игрока» (им тоже играет бот) — pyro/grok/lira по кругу, сложность — easy/normal/hard.
// Матч, не закончившийся к --cap секундам игры, — НЕ законченный (capped), а не ничья и не победа.
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

register(new URL('./three-loader.mjs', import.meta.url).href);
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { dist } = await import('../src/units.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const parseSeeds = (s) => s.split(',').flatMap((p) => { const [a, b] = p.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
const seeds = parseSeeds(args.seeds ?? '1-24');
const CAP = +(args.cap ?? 1800);
const DT = +(args.dt ?? 1 / 30);
const traceSeeds = new Set(args.trace ? parseSeeds(args.trace) : []);
const HEROES = ['pyro', 'grok', 'lira'];
const DIFFS = ['easy', 'normal', 'hard'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runMatch(seed, { cap = CAP, dt = DT, trace = false } = {}) {
  const realRandom = Math.random;
  Math.random = mulberry32(seed * 7919 + 17);
  try {
    const heroId = HEROES[seed % 3], difficulty = DIFFS[Math.floor(seed / 3) % 3];
    const g = new Game(new THREE.Scene(), { difficulty, mode: '3v3', heroId, autoplay: true });
    const m = {
      seed, heroId, difficulty, blue: g.heroes[0].map((h) => h.heroId), red: g.heroes[1].map((h) => h.heroId),
      events: [], structures: [], dragons: [], kills: [], traces: [],
    };
    const brainOf = new Map(g.brains.map((b) => [b.hero, b]));
    const hs = g.allHeroes.map((h) => ({
      h, id: `${h.team ? 'R' : 'B'}-${h.heroId}`, role: brainOf.get(h)?.role,
      stuck: 0, stuckLong: 0, idle: 0, idleLong: 0, retreat: 0, reversals: 0, modeSwitches: 0, moveSamples: 0,
      towerHits: 0, towerDeaths: 0, recalls: 0, baseTrips: 0, pointlessTrips: 0,
      last: null, lastMode: null, lastDir: null, run: { stuck: 0, idle: 0 }, inBase: true, trip: null,
    }));
    const byHero = new Map(hs.map((x) => [x.h, x]));
    // события
    g.on('structure', (u) => m.structures.push({ t: g.time, kind: u.kind, team: u.team, order: u.order }));
    g.on('monster', ({ monster, hero }) => { if (monster.monsterKind === 'dragon') m.dragons.push({ t: g.time, team: hero?.team ?? null }); });
    g.on('herokill', ({ victim, killer }) => {
      const towerKill = victim.lastHitBy && victim.lastHitBy.kind === 'tower';
      if (towerKill) byHero.get(victim).towerDeaths++;
      const near = (team) => g.heroes[team].filter((o) => o.alive && o !== victim && dist(o.pos, victim.pos) < 10).length;
      const vx = byHero.get(victim);
      m.kills.push({
        t: g.time, victimTeam: victim.team, victim: vx.id, tower: towerKill, x: victim.pos.x,
        // обстоятельства: решение бота за секунду до смерти и расклад рядом
        mode: vx.modeBefore, hpBefore: vx.hpBefore, allies: near(victim.team), enemies: near(1 - victim.team),
        retreatFor: vx.retreatSince != null ? +(g.time - vx.retreatSince).toFixed(1) : null,
        retreatHp: vx.retreatHp ?? null,
        ownTower: +Math.min(99, ...g.units.filter((u) => u.alive && u.kind === 'tower' && u.team === victim.team).map((u) => dist(u.pos, victim.pos))).toFixed(1),
      });
    });
    const structDmg = [[], []]; // кто (команда) и когда бил здания
    g.on('damage', ({ source, target }) => {
      if (!source) return;
      if (source.kind === 'tower' && target.kind === 'hero') byHero.get(target).towerHits++;
      if (target.isStructure && source.kind === 'hero') structDmg[source.team].push(g.time);
    });
    g.on('recalled', (h) => { if (byHero.get(h)) byHero.get(h).recalls++; });
    let nexusOpen = [null, null]; // когда нексус команды стал уязвим
    let nextSample = 0, nextTrace = 0;
    while (!g.over && g.time < cap) {
      g.update(dt);
      if (g.time >= nextSample) {
        nextSample += 0.5;
        for (const x of hs) sample(g, x, brainOf.get(x.h));
        for (const team of [0, 1]) {
          const nx = g.units.find((u) => u.kind === 'nexus' && u.team === team);
          if (nx && !nexusOpen[team] && !g.structureProtected(nx)) nexusOpen[team] = g.time;
        }
      }
      if (trace && g.time >= nextTrace) {
        nextTrace += 1;
        m.traces.push({ t: Math.round(g.time), heroes: hs.map((x) => ({ id: x.id, x: +x.h.pos.x.toFixed(1), z: +x.h.pos.z.toFixed(1), hp: +(x.h.hp / x.h.maxHp).toFixed(2), alive: x.h.alive, mode: brainOf.get(x.h)?.mode, lvl: x.h.level, gold: Math.round(x.h.gold) })) });
      }
    }
    m.duration = +g.time.toFixed(1);
    m.capped = !g.over;
    m.winner = g.over ? g.winner : null;
    m.nexusOpen = nexusOpen.map((t) => (t ? +t.toFixed(1) : null));
    // выигранная драка: команда убила ≥2 героев за 15 с, потеряв не больше одного. Удалось ли
    // за следующие 45 с бить здания врага (герои этой команды)?
    m.fightWins = [];
    const ks = m.kills;
    let lastEnd = -99;
    for (const k of ks) {
      const team = 1 - k.victimTeam;
      if (k.t < lastEnd) continue;
      const win = ks.filter((x) => x.t >= k.t && x.t <= k.t + 15);
      const got = win.filter((x) => x.victimTeam !== team).length, lost = win.filter((x) => x.victimTeam === team).length;
      if (got >= 2 && lost <= 1) {
        const end = Math.max(...win.map((x) => x.t));
        const pushed = structDmg[team].some((t) => t > end && t < end + 45);
        m.fightWins.push({ t: +end.toFixed(1), team, pushed });
        lastEnd = end + 15;
      }
    }
    m.heroes = hs.map((x) => ({
      id: x.id, role: x.role, level: x.h.level, deaths: x.h.deaths, kills: x.h.kills, items: x.h.items.length, gold: Math.round(x.h.gold), cs: x.h.cs,
      stuck: +x.stuck.toFixed(1), stuckLong: x.stuckLong, idle: +x.idle.toFixed(1), idleLong: x.idleLong, retreat: +x.retreat.toFixed(1),
      reversalsPerMin: +(x.reversals / (g.time / 60)).toFixed(2), modeSwitchesPerMin: +(x.modeSwitches / (g.time / 60)).toFixed(2),
      towerHits: x.towerHits, towerDeaths: x.towerDeaths, recalls: x.recalls, baseTrips: x.baseTrips, pointlessTrips: x.pointlessTrips,
    }));
    m.structures = m.structures.map((s) => ({ ...s, t: +s.t.toFixed(1) }));
    m.dragons = m.dragons.map((d) => ({ ...d, t: +d.t.toFixed(1) }));
    m.kills = m.kills.map((k) => ({ ...k, t: +k.t.toFixed(1), x: +k.x.toFixed(1) }));
    if (!trace) delete m.traces;
    return m;
  } finally {
    Math.random = realRandom;
  }
}

// Опрос героя раз в 0,5 с игры: застревание, простой, развороты, смены решения, отступление, походы на базу
function sample(g, x, brain) {
  const h = x.h;
  const mode = brain?.mode ?? null;
  // погиб: возрождение на базе — не поход домой
  if (!h.alive) { x.last = null; x.run.stuck = x.run.idle = 0; x.lastDir = null; x.inBase = true; x.trip = null; return; }
  const it = h.intent;
  const moving = Math.hypot(it.mx, it.mz) > 0.1;
  const busy = h.recall || h.dash || it.attack || h.stunned;
  if (x.last) {
    const d = Math.hypot(h.pos.x - x.last.x, h.pos.z - x.last.z);
    // застрял: хочет идти, но почти не сдвинулся
    if (moving && !busy && d < 0.15) { x.run.stuck += 0.5; x.stuck += 0.5; } else { if (x.run.stuck >= 2) x.stuckLong++; x.run.stuck = 0; }
    // простаивает: не идёт, не бьёт, не возвращается и не лечится на базе
    if (!moving && !busy && !h.inBase && mode !== 'heal') { x.run.idle += 0.5; x.idle += 0.5; } else { if (x.run.idle >= 3) x.idleLong++; x.run.idle = 0; }
  }
  if (moving) {
    x.moveSamples++;
    const dir = { x: it.mx, z: it.mz };
    if (x.lastDir && dir.x * x.lastDir.x + dir.z * x.lastDir.z < -0.5) x.reversals++;
    x.lastDir = dir;
  }
  x.modeBefore = mode; x.hpBefore = +(h.hp / h.maxHp).toFixed(2);
  if (mode === 'retreat' && x.lastMode !== 'retreat') { x.retreatSince = g.time; x.retreatHp = x.hpBefore; }
  if (mode !== 'retreat') x.retreatSince = null;
  if (mode !== x.lastMode && x.lastMode !== null) x.modeSwitches++;
  x.lastMode = mode;
  if (mode === 'retreat' || mode === 'heal' || h.recall) x.retreat += 0.5;
  // походы на базу: вход с карты (не возрождение)
  if (h.inBase && !x.inBase) { x.baseTrips++; x.trip = { hp: h.hp / h.maxHp, items: h.items.length, gold: h.gold }; }
  if (!h.inBase && x.inBase && x.trip) {
    if (x.trip.hp > 0.85 && h.items.length === x.trip.items && h.gold >= x.trip.gold - 1) x.pointlessTrips++;
    x.trip = null;
  }
  x.inBase = h.inBase;
  x.last = { x: h.pos.x, z: h.pos.z };
}

// Каждый матч — в своём потоке со свежими модулями: three.js берёт Math.random для UUID объектов,
// а кэш материалов живёт в модуле, поэтому второй матч в том же процессе получил бы другой поток
// случайных чисел. Отдельный поток делает сид полностью воспроизводимым и даёт параллельность.
if (!isMainThread && workerData?.seed != null) {
  parentPort.postMessage(runMatch(workerData.seed, workerData.opts));
} else if (isMainThread && process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const t0 = Date.now();
  const jobs = Math.max(1, Math.min(+(args.jobs ?? os.cpus().length), seeds.length));
  const results = new Map();
  let next = 0;
  const one = () => {
    if (next >= seeds.length) return Promise.resolve();
    const s = seeds[next++];
    return new Promise((ok, fail) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { seed: s, opts: { cap: CAP, dt: DT, trace: traceSeeds.has(s) } }, argv: [] });
      w.once('message', (m) => {
        results.set(s, m);
        process.stderr.write(`сид ${s}: ${m.capped ? 'НЕ ЗАКОНЧЕН' : `победа ${m.winner ? 'красных' : 'синих'}`} за ${m.duration} с (${m.difficulty}, ${m.blue.join('/')} против ${m.red.join('/')})\n`);
        w.terminate().then(ok);
      });
      w.once('error', fail);
    }).then(one);
  };
  await Promise.all(Array.from({ length: jobs }, one));
  const out = seeds.map((s) => results.get(s));
  if (args.out) { fs.mkdirSync(path.dirname(args.out), { recursive: true }); fs.writeFileSync(args.out, JSON.stringify({ cap: CAP, dt: DT, seeds, matches: out }, null, 1)); }
  process.stderr.write(`готово: ${out.length} матчей за ${((Date.now() - t0) / 1000).toFixed(0)} с\n`);
}
