// Снаряды по прямой (Skillshot): попадания по всему пройденному отрезку, предел дальности,
// порядок попаданий, сквозные выстрелы. Сначала настоящий класс на неподвижных целях при разных шагах
// времени, затем настоящие умения в матче. Запуск: npm run test:projectile
import { openGame, check, run } from './harness.mjs';

const DTS = [1 / 120, 1 / 60, 1 / 30, 0.05, 0.15];

async function boot(test) {
  const t = await openGame({ start: test.start ?? null, settings: { hero: test.hero ?? 'pyro', mode: '1v1' } });
  // Выстрел настоящего Skillshot по неподвижным целям. targets: [{ x, z, r, kind?, killNext? }].
  // Возвращает порядок попаданий (индексы целей), точки касания, где снаряд остановился и остаток дальности.
  t.shot = (opts, targets, dt, extra = {}) => t.page.evaluate(async ({ opts, targets, dt, extra }) => {
    const THREE = await import('three');
    const { Skillshot } = await import('./src/units.js');
    const units = targets.map((tg, i) => ({
      i, pos: { x: tg.x, z: tg.z ?? 0 }, radius: tg.r ?? 0.2, kind: tg.kind ?? 'creep', isStructure: false, alive: true,
      canBeHitBy() { return this.alive; },
    }));
    if (extra.reverse) units.reverse();
    const game = { units, scene: new THREE.Scene() };
    const owner = { team: 0, pos: { x: 0, z: 0 } };
    const hits = [];
    const s = new Skillshot(game, owner, { x: 1, z: 0 }, {
      speed: 30, width: 0.1, range: 8, pierce: false, color: 0xffffff, ...opts,
      onHit: (u, shot) => {
        hits.push({ i: u.i, x: +shot.pos.x.toFixed(4), z: +shot.pos.z.toFixed(4) });
        // попадание может убить следующую цель (как смертельный урон по цепочке)
        if (targets[u.i].killNext) units.find((v) => v.i === u.i + 1).alive = false;
      },
    });
    let steps = 0;
    if (extra.zeroFirst) { s.update(0); s.update(0); }
    while (!s.done && steps < 10000) { s.update(dt); steps++; }
    return { hits, end: +s.pos.x.toFixed(4), left: +s.left.toFixed(4), steps };
  }, { opts, targets, dt, extra });
  return t;
}

const tests = [];
const test = (name, fn, extra) => tests.push({ name, fn, ...extra });
const ids = (r) => r.hits.map((h) => h.i).join(',');

test('сквозной выстрел: три цели при любом шаге времени (было: 3 / 2 / 0)', async (t) => {
  const targets = [{ x: 1.5 }, { x: 2.5 }, { x: 4 }];
  for (const dt of DTS) {
    const r = await t.shot({ pierce: true }, targets, dt);
    console.log("      · " + `сквозной, цели 1.5/2.5/4, dt=${dt.toFixed(4)}: попадания [${ids(r)}], касания ${r.hits.map((h) => h.x).join('/')}`);
    check(ids(r) === '0,1,2', `dt=${dt}`, r);
    // касание: центр цели минус (радиус + ширина) = x − 0.3
    check(r.hits.every((h, k) => Math.abs(h.x - (targets[k].x - 0.3)) < 1e-6), `точка касания, dt=${dt}`, r);
  }
});

test('дальность 1: цель за пределом не задета ни при каком шаге (было: попадание при dt=0.08)', async (t) => {
  for (const dt of [...DTS, 0.08]) {
    const r = await t.shot({ range: 1, pierce: true }, [{ x: 3.2 }], dt);
    console.log("      · " + `дальность 1, цель 3.2, dt=${dt.toFixed(4)}: попадания [${ids(r)}], остановился на ${r.end}`);
    check(r.hits.length === 0 && Math.abs(r.end - 1.8) < 1e-6, `dt=${dt}`, r);
  }
});

test('граница дальности: касание на краю — попадание, чуть дальше — промах', async (t) => {
  // старт 0,8, дальность 1 → конец пути 1,8; досягаемость центра цели 1,8 + 0,3 = 2,1
  for (const dt of DTS) {
    const edge = await t.shot({ range: 1 }, [{ x: 2.1 }], dt);
    const past = await t.shot({ range: 1 }, [{ x: 2.11 }], dt);
    check(ids(edge) === '0' && Math.abs(edge.hits[0].x - 1.8) < 1e-6, `край, dt=${dt}`, edge);
    check(past.hits.length === 0, `за краем, dt=${dt}`, past);
  }
});

test('одиночный выстрел бьёт ближайшую по пути цель при любом порядке в списке', async (t) => {
  for (const dt of DTS) for (const reverse of [false, true]) {
    const r = await t.shot({}, [{ x: 2 }, { x: 4 }], dt, { reverse });
    check(ids(r) === '0' && Math.abs(r.hits[0].x - 1.7) < 1e-6 && r.end === r.hits[0].x, `dt=${dt} reverse=${reverse}`, r);
  }
});

test('сквозной выстрел: крупная цель на нескольких шагах — одно попадание', async (t) => {
  for (const dt of DTS) {
    const r = await t.shot({ pierce: true }, [{ x: 3, r: 2 }], dt);
    check(ids(r) === '0', `dt=${dt}`, r);
  }
});

test('мимо пути и касание сбоку', async (t) => {
  for (const dt of DTS) {
    const miss = await t.shot({ pierce: true }, [{ x: 3, z: 0.31 }, { x: -2 }], dt);
    const touch = await t.shot({ pierce: true }, [{ x: 3, z: 0.3 }], dt);
    check(miss.hits.length === 0, `мимо, dt=${dt}`, miss);
    check(ids(touch) === '0', `касание сбоку, dt=${dt}`, touch);
  }
});

test('цель в точке появления и пустые шаги', async (t) => {
  for (const dt of DTS) {
    const r = await t.shot({ pierce: true }, [{ x: 0.8 }, { x: 3 }], dt, { zeroFirst: true });
    check(ids(r) === '0,1' && r.hits[0].x === 0.8, `dt=${dt}`, r);
  }
  // шаг нулевой длины не двигает снаряд и не бьёт дальнюю цель
  const z = await t.page.evaluate(async () => {
    const THREE = await import('three');
    const { Skillshot } = await import('./src/units.js');
    const u = { pos: { x: 3, z: 0 }, radius: 0.2, kind: 'creep', isStructure: false, canBeHitBy: () => true };
    let n = 0;
    const s = new Skillshot({ units: [u], scene: new THREE.Scene() }, { team: 0, pos: { x: 0, z: 0 } }, { x: 1, z: 0 }, { speed: 30, width: 0.1, range: 8, onHit: () => n++ });
    for (let i = 0; i < 5; i++) s.update(0);
    return { n, x: s.pos.x, left: s.left, done: s.done };
  });
  check(z.n === 0 && z.x === 0.8 && z.left === 8 && !z.done, 'пустые шаги', z);
});

test('попадание, убившее следующую цель, не даёт удара по ней', async (t) => {
  for (const dt of DTS) {
    const r = await t.shot({ pierce: true }, [{ x: 1.5, killNext: true }, { x: 1.9 }, { x: 4 }], dt);
    check(ids(r) === '0,2', `dt=${dt}`, r);
  }
});

// --- настоящие умения в матче, долгий кадр -----------------------------------------------
async function matchSetup(page) {
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player;
    g.brains = []; g.spawnWave = () => {};
    for (const u of g.units) if (u.isStructure) u.update = () => {};
    for (const h of g.allHeroes) { h.intent.attack = false; h.atkTimer = 99; }
    p.pos.x = -6; p.pos.z = 0; p.facing = Math.PI / 2;
    window.fxKinds = [];
    const fx = window.dota3.impacts, orig = fx.spawn.bind(fx);
    fx.spawn = (slot, kind, ...rest) => { window.fxKinds.push(kind); return orig(slot, kind, ...rest); };
    // игру ведёт проверка: кадры страницы её не двигают
    window.step = g.update.bind(g);
    g.update = () => {};
  });
}

for (const [hero, key, ability] of [['pyro', 'Q', 'fireball'], ['lira', 'Q', 'volley'], ['lira', 'R', 'harpoon']]) {
  test(`${ability}: на долгом кадре (0,15 с) попадает, урон, эффект и отклик как задумано`, async (t) => {
    const { page } = t;
    await matchSetup(page);
    const r = await page.evaluate(([key, ability]) => {
      const g = window.dota3.game, p = g.player, e = g.heroes[1][0];
      e.pos.x = p.pos.x + 2.6; e.pos.z = 0; e.update = () => {}; e.hp = e.maxHp; e.shield = 0;
      g.computeVision();
      p.level = 6; p.ranks[key] = 1; p.mana = p.maxMana;
      const hp0 = e.hp;
      const dmg = [];
      g.on('damage', (d) => { if (d.source === p) dmg.push({ target: d.target === e, ability: d.ability }); });
      p.cast(key, { dir: { x: 1, z: 0 } });
      for (let i = 0; i < 20; i++) window.step(0.15);
      return { hits: dmg.length, ability: dmg[0]?.ability, lost: hp0 - e.hp, slowed: e.slowed, stunned: e.stunUntil > g.time - 3, fx: window.fxKinds.slice() };
    }, [key, ability]);
    check(r.hits === 1 && r.lost > 0, 'одно попадание с уроном', r);
    if (ability === 'volley') check(r.slowed && r.ability === 'volley' && r.fx.join() === 'pierce', 'замедление и отклик Залпа', r);
    if (ability === 'fireball') check(r.ability === 'fireball' && r.fx.join() === 'ember', 'отклик шара', r);
    if (ability === 'harpoon') check(r.stunned, 'оглушение гарпуна', r);
  }, { start: 'playBtn', hero });
}

test('гарпун (только герои) пролетает сквозь крипа к герою; шар бьёт первого — крипа', async (t) => {
  const { page } = t;
  await matchSetup(page);
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, e = g.heroes[1][0];
    Object.getPrototypeOf(g).spawnWave.call(g);
    const c = g.units.find((u) => u.kind === 'creep' && u.team !== p.team);
    c.pos.x = p.pos.x + 2; c.pos.z = 0; c.update = () => {};
    e.pos.x = p.pos.x + 5; e.pos.z = 0; e.update = () => {};
    g.computeVision();
    p.level = 6; p.ranks.R = 1; p.mana = p.maxMana;
    const got = [];
    g.on('damage', (d) => { if (d.source === p) got.push(d.target === e ? 'hero' : d.target === c ? 'creep' : 'other'); });
    p.cast('R', { dir: { x: 1, z: 0 } });
    for (let i = 0; i < 20; i++) window.step(0.15);
    return got;
  });
  check(r.join() === 'hero', 'гарпун должен пройти мимо крипа', r);
}, { start: 'playBtn', hero: 'lira' });

test('Огненный шар: из двух на пути бьёт ближнего, даже если он позже в списке юнитов', async (t) => {
  const { page } = t;
  await matchSetup(page);
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, e = g.heroes[1][0];
    Object.getPrototypeOf(g).spawnWave.call(g);
    const c = g.units.find((u) => u.kind === 'creep' && u.team !== p.team);
    e.pos.x = p.pos.x + 4; e.pos.z = 0; e.update = () => {};
    c.pos.x = p.pos.x + 2; c.pos.z = 0; c.update = () => {};
    // крип — в конце списка, герой — раньше
    g.units = [...g.units.filter((u) => u !== c), c];
    g.computeVision();
    p.ranks.Q = 1; p.mana = p.maxMana;
    const got = [];
    g.on('damage', (d) => { if (d.source === p) got.push(d.target === c ? 'creep' : d.target === e ? 'hero' : 'other'); });
    p.cast('Q', { dir: { x: 1, z: 0 } });
    for (let i = 0; i < 20; i++) window.step(0.15);
    return got;
  });
  check(r.join() === 'creep', 'шар должен ударить ближнего крипа', r);
}, { start: 'playBtn', hero: 'pyro' });

await run(tests, boot);
