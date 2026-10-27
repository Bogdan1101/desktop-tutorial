// Отклик на попадание (src/impacts.js): обычные атаки и Q трёх героев.
// Запуск: npm run test:hits   (нужны пакет playwright и браузер Chromium)
import { openGame, check, run } from './harness.mjs';

// Матч 1 на 1 выбранным героем; боты не думают, крипы не выходят — бой ведёт проверка
async function boot(test) {
  const t = await openGame({
    start: 'playBtn',
    settings: { hero: test.hero ?? 'pyro', mode: test.mode ?? '1v1', quality: test.quality ?? 'low' },
    contextOptions: test.reduced ? { reducedMotion: 'reduce' } : {},
  });
  const { page } = t;
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player;
    g.brains = []; g.spawnWave = () => {};
    for (const h of g.allHeroes) { h.intent.attack = false; h.atkTimer = 99; }
    for (const u of g.units) if (u.isStructure) u.update = () => {}; // башни не стреляют
    // журнал появлений: в проверках время идёт ×3, и отклик (0,2–0,3 с) гаснет быстрее опроса
    window.spawned = [];
    const fx = window.dota3.impacts, orig = fx.spawn.bind(fx);
    fx.spawn = (slot, kind, ...rest) => { window.spawned.push(kind); return orig(slot, kind, ...rest); };
    p.pos.x = -20; p.pos.z = 0;
    window.dmg = [];
    g.on('damage', (e) => e.source === p && window.dmg.push({ src: e.source?.id, tgt: e.target.id, ability: e.ability, basic: e.basic, absorbed: e.absorbed, lost: e.lost, dot: e.dot }));
  });
  // что сейчас на экране и сколько показано всего
  t.fx = () => page.evaluate(() => {
    const fx = window.dota3.impacts;
    return { shown: fx.shown, kinds: window.spawned.slice(), active: fx.slots.filter((s) => s.root.visible).map((s) => s.kind) };
  });
  // поставить врага-героя перед игроком
  t.enemyAt = (dx, dz = 0.3) => page.evaluate(([dx, dz]) => {
    const g = window.dota3.game, p = g.player, e = g.heroes[1][0];
    e.pos.x = p.pos.x + dx; e.pos.z = p.pos.z + dz; p.face(e); e.hp = e.maxHp; e.shield = 0;
    g.computeVision(); // туман пересчитывается в кадре игры; здесь — сразу, чтобы враг был виден
    return e.id;
  }, [dx, dz]);
  return t;
}

const tests = [];
const test = (name, fn, extra) => tests.push({ name, fn, ...extra });

for (const [hero, kind, range] of [['pyro', 'ember', 4.5], ['grok', 'strike', 1.6], ['lira', 'pierce', 5]]) {
  test(`${hero}: обычная атака — один отклик «${kind}» в момент урона, не при выстреле`, async (t) => {
    const { page } = t;
    await t.enemyAt(range);
    await t.frames(0.2);
    const before = await t.fx();
    await page.evaluate(() => { const g = window.dota3.game; g.player.basicAttack(g.heroes[1][0]); });
    const atOnce = await t.fx();
    if (hero !== 'grok') check(atOnce.shown === before.shown && !(await page.evaluate(() => window.dmg.length)), 'у снаряда отклик до попадания', atOnce);
    await page.waitForFunction(() => window.dmg.length >= 1, null, { timeout: 10000 });
    const hit = await t.fx();
    check(hit.shown === before.shown + 1 && hit.kinds.join() === kind, 'один отклик нужной формы', { hit, before });
    await t.frames(0.6);
    check((await t.fx()).active.length === 0, 'отклик должен угаснуть');
  }, { hero });
}

test('Огненный шар: попадание — «ember», промах — без отклика; отказ — без отклика', async (t) => {
  const { page } = t;
  // промах: врага нет на линии
  await t.enemyAt(-6, 6);
  await page.evaluate(() => { const g = window.dota3.game, p = g.player; p.ranks.Q = 1; p.mana = p.maxMana; p.cast('Q', { dir: { x: 1, z: 0 } }); });
  await t.frames(1.2);
  check((await t.fx()).shown === 0 && !(await page.evaluate(() => window.dmg.length)), 'промах дал отклик');
  // отказ: перезарядка
  await page.evaluate(() => { window.dota3.game.player.intent.cast = { key: 'Q', aim: { dir: { x: 1, z: 0 } } }; });
  await t.frames(0.3);
  check((await t.fx()).shown === 0, 'отказ дал отклик');
  // попадание
  await t.enemyAt(5, 0);
  await page.evaluate(() => { const p = window.dota3.game.player; p.cd.Q = 0; p.mana = p.maxMana; p.cast('Q', { dir: { x: 1, z: 0 } }); });
  await page.waitForFunction(() => window.dmg.some((d) => d.ability === 'fireball'), null, { timeout: 10000 });
  const f = await t.fx();
  check(f.shown === 1 && f.kinds.join() === 'ember', 'попадание шара', f);
}, { hero: 'pyro' });

test('Удар щитом: одно попадание — «strike»; урон и оглушение как прежде', async (t) => {
  const { page } = t;
  await t.enemyAt(3, 0);
  await page.evaluate(() => { const p = window.dota3.game.player; p.ranks.Q = 1; p.mana = p.maxMana; p.cast('Q', { dir: { x: 1, z: 0 } }); });
  await page.waitForFunction(() => window.dmg.some((d) => d.ability === 'shieldBash'), null, { timeout: 10000 });
  const r = await page.evaluate(() => ({ stunned: window.dota3.game.heroes[1][0].stunned }));
  const f = await t.fx();
  check(f.shown === 1 && f.kinds.join() === 'strike' && r.stunned, 'удар щитом', { f, r });
}, { hero: 'grok' });

test('Залп по толпе: урон всем пятерым, откликов не больше трёх', async (t) => {
  const { page } = t;
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player;
    // пять крипов врага на линии выстрела
    g.spawnWave = Object.getPrototypeOf(g).spawnWave; g.spawnWave.call(g);
    const enemies = g.units.filter((u) => u.kind === 'creep' && u.team !== p.team).slice(0, 5);
    enemies.forEach((u, i) => { u.pos.x = p.pos.x + 2 + i * 1.1; u.pos.z = p.pos.z; u.update = () => {}; });
    g.units = g.units.filter((u) => u.kind !== 'creep' || enemies.includes(u));
    g.isVisible = () => true;
    window.five = enemies.map((u) => u.id);
    p.ranks.Q = 1; p.mana = p.maxMana; p.cast('Q', { dir: { x: 1, z: 0 } });
    // длинными кадрами по 0,15 с: снаряд проверяет попадания по всему пройденному отрезку
    for (let i = 0; i < 5; i++) g.update(0.15);
  });
  const hitIds = await page.evaluate(() => [...new Set(window.dmg.filter((d) => d.ability === 'volley').map((d) => d.tgt))]);
  const five = await page.evaluate(() => window.five);
  const f = await t.fx();
  check(five.length >= 4 && hitIds.length === five.length, 'залп должен задеть всех крипов на линии', { hitIds, five });
  check(f.shown === 3, 'откликов должно быть три', f);
}, { hero: 'lira' });

test('удар целиком в щит — голубой «shield», здоровье не тронуто, число голубое', async (t) => {
  const { page } = t;
  // враг бьёт игрока, у игрока большой щит
  await page.evaluate(() => { const g = window.dota3.game, p = g.player, e = g.heroes[1][0]; e.pos.x = p.pos.x + 1.6; e.pos.z = p.pos.z; p.shield = 5000; p.shieldUntil = g.time + 30; window.hp0 = p.hp; });
  const enemyHero = await page.evaluate(() => window.dota3.game.heroes[1][0].heroId);
  await page.evaluate(() => {
    const g = window.dota3.game;
    window.taken = [];
    g.on('damage', (e) => { if (e.target === g.player) window.taken.push({ absorbed: e.absorbed, lost: e.lost }); });
    g.heroes[1][0].basicAttack(g.player);
  });
  await page.waitForFunction(() => window.taken.length >= 1, null, { timeout: 10000 });
  const r = await page.evaluate(() => ({ hp: window.dota3.game.player.hp, hp0: window.hp0, d: window.taken[0], float: [...document.querySelectorAll('.float')].map((f) => f.className) }));
  const f = await t.fx();
  check(r.hp === r.hp0 && r.d.absorbed > 0 && r.d.lost === 0, 'урон ушёл в щит', { r, enemyHero });
  check(f.kinds.join() === 'shield', 'отклик щита', f);
  check(r.float.some((c) => c.includes('absorb')), 'число урона по щиту — голубое', r.float);
});

test('смертельный удар даёт отклик; урон по времени — нет', async (t) => {
  const { page } = t;
  await t.enemyAt(4.5);
  await page.evaluate(() => { const g = window.dota3.game, e = g.heroes[1][0]; e.hp = 1; g.player.basicAttack(e); });
  await page.waitForFunction(() => !window.dota3.game.heroes[1][0].alive, null, { timeout: 10000 });
  check((await t.fx()).shown === 1, 'смертельный удар без отклика');
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, e = g.heroes[1][0];
    window.dots = 0; g.on('damage', (d) => { if (d.dot) window.dots++; });
    e.alive = true; e.hp = e.maxHp; e.pos.x = p.pos.x + 4; e.burn(40, 3, p); // игрок поджёг врага
  });
  await t.frames(2.5);
  const dots = await page.evaluate(() => window.dots);
  check(dots >= 3 && (await t.fx()).shown === 1, 'поджог дал отклики', { dots, fx: await t.fx() });
});

test('удар по цели в тумане не показывается', async (t) => {
  const { page } = t;
  // враг бьёт крипа своей команды-противника далеко от игрока, в тумане
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, e = g.heroes[1][0];
    // лесной монстр на стороне врага, далеко от игрока; враг бьёт его — для игрока это туман
    for (const c of g.camps) c.timer = 0;
    g.update(0.01);
    const camp = g.camps.filter((c) => c.x > 20 && c.kind !== 'dragon')[0];
    const m = camp.monster; m.update = () => {};
    p.pos.x = -40; p.pos.z = 0;
    e.pos.x = m.pos.x - 1.6; e.pos.z = m.pos.z;
    g.computeVision();
    window.fogged = !g.isVisible(p.team, e) && !g.isVisible(p.team, m);
    window.hits = 0; g.on('damage', (d) => { if (d.target === m) window.hits++; });
    e.basicAttack(m);
  });
  await page.waitForFunction(() => window.hits >= 1, null, { timeout: 10000 });
  check(await page.evaluate(() => window.fogged), 'враг и монстр должны быть в тумане');
  check((await t.fx()).shown === 0, 'отклик выдал место удара в тумане');
});

test('пул ограничен: 60 ударов подряд — не больше 14 фигур, ресурсы не растут; пауза и меню', async (t) => {
  const { page } = t;
  await t.enemyAt(1.6);
  // первая серия — прогрев: всё, что рисуется впервые, попадает на видеокарту; вторая серия не должна добавить ничего
  const batch = () => page.evaluate(() => {
    const g = window.dota3.game, e = g.heroes[1][0], fx = window.dota3.impacts;
    for (let i = 0; i < 60; i++) { e.hp = e.maxHp; g.player.basicAttack(e); }
    return { active: fx.slots.filter((s) => s.root.visible).length, shown: fx.shown };
  });
  const geo = () => page.evaluate(() => { const i = window.dota3.renderer.info.memory; return i.geometries + '/' + i.textures; });
  await batch();
  await t.frames(0.6);
  const geo0 = await geo();
  const f = await batch();
  await t.frames(0.6);
  const geo1 = await geo();
  check(f.active <= 14 && f.active >= 8 && f.shown >= 28, 'пул', f);
  check(geo1 === geo0, 'геометрия или текстуры выросли от откликов', { geo0, geo1 });
  // пауза: отклики замирают, после продолжения — гаснут
  await t.frames(0.6);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.dota3.state === 'pause');
  await page.evaluate(() => { const g = window.dota3.game; g.player.basicAttack(g.heroes[1][0]); });
  const t0 = await page.evaluate(() => window.dota3.impacts.slots.find((s) => s.root.visible)?.t);
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => window.dota3.impacts.slots.find((s) => s.root.visible)?.t);
  check(t0 !== undefined && t0 === t1, 'на паузе отклик не должен идти', { t0, t1 });
  // выход в меню: пул старого матча снят со сцены и освобождён
  await page.evaluate(() => { window.oldFx = window.dota3.impacts; });
  await page.evaluate(() => document.getElementById('quitBtn').click());
  await page.waitForFunction(() => window.dota3.state === 'menu');
  const r = await page.evaluate(() => ({ attached: !!window.oldFx.group.parent, disposed: window.oldFx.disposed, fresh: window.dota3.impacts !== window.oldFx, inScene: window.dota3.game.scene.children.filter((c) => c.name === 'impactFx').length }));
  check(!r.attached && r.disposed && r.fresh && r.inScene === 1, 'старый пул не убран', r);
}, { hero: 'grok' });

test('низкое качество и «меньше движения»: простая фигура без искр и без роста', async (t) => {
  const { page } = t;
  await t.enemyAt(1.6);
  // всё в одном вызове: удар, снимок, шаг откликов на 0,08 с, снимок (без участия кадров страницы)
  const { a, b } = await page.evaluate(() => {
    const g = window.dota3.game, fx = window.dota3.impacts;
    g.player.basicAttack(g.heroes[1][0]);
    const s = fx.slots.find((x) => x.root.visible);
    const a = { kind: s.kind, sc: s.shapes.star.scale.x, sparks: s.sparks.some((m) => m.visible) };
    fx.update(0.08);
    return { a, b: { sc: s.shapes.star.scale.x, op: s.shapes.star.material.opacity } };
  });
  check(a.kind === 'strike' && !a.sparks, 'без искр', a);
  check(b && Math.abs(b.sc - a.sc) < 1e-6 && b.op < 1, 'без роста, только затухание', { a, b });
}, { hero: 'grok', quality: 'medium', reduced: true });

test('низкое качество: фигура есть, искр нет', async (t) => {
  const { page } = t;
  await t.enemyAt(4.5);
  await page.evaluate(() => { const g = window.dota3.game; g.player.basicAttack(g.heroes[1][0]); });
  const sp = await page.evaluate(() => new Promise((ok) => {
    const fx = window.dota3.impacts, orig = fx.spawn;
    fx.spawn = (slot, ...rest) => { const r = orig(slot, ...rest); ok({ kind: slot.kind, ring: slot.shapes.ring.visible, sparks: slot.sparks.some((m) => m.visible) }); return r; };
  }));
  check(sp.kind === 'ember' && sp.ring && !sp.sparks, 'низкое качество', sp);
}, { hero: 'pyro', quality: 'low' });

await run(tests, boot);
