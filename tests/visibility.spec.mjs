// Эффекты и туман войны: что видит игрок. Сценарии на настоящих правилах видимости игры
// (computeVision, кусты), без ручного скрытия моделей. Запуск: npm run test:visibility
import { openGame, check, run } from './harness.mjs';

// Матч 3 на 3 (в каждой команде все три героя). Боты не думают, крипы не выходят, башни не стреляют.
// Игру двигает проверка: window.step(dt) — один шаг игры, затем пересчёт тумана и отрисовка эффектов.
async function boot(test) {
  const t = await openGame({ start: 'playBtn', settings: { hero: 'pyro', mode: '3v3' } });
  const { page } = t;
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player;
    g.brains = []; g.spawnWave = () => {};
    for (const u of g.units) if (u.isStructure) u.update = () => {};
    for (const h of g.allHeroes) { h.intent.attack = false; h.atkTimer = 99; h.update = () => {}; }
    // все остальные герои далеко на своих базах, игрок на линии
    for (const h of g.allHeroes) { h.pos.x = h.team ? 66 : -66; h.pos.z = (h.slot - 1) * 2; }
    p.pos.x = -6; p.pos.z = 0;
    const upd = g.update.bind(g);
    g.update = () => {};
    window.step = (dt = 0.05) => { upd(dt); g.computeVision(); g.syncMeshes(0); window.dota3.impacts.update(dt); };
    window.step(0.01);
    // звуки: какие пытались проиграть
    window.sounds = [];
    const play = window.dota3.sound.play.bind(window.dota3.sound);
    window.dota3.sound.play = (name, pos) => { window.sounds.push(name); return play(name, pos); };
    window.red = (id) => g.heroes[1].find((h) => h.heroId === id);
    window.blue = (id) => g.heroes[0].find((h) => h.heroId === id);
  });
  return t;
}

const tests = [];
const test = (name, fn, extra) => tests.push({ name, fn, ...extra });

test('скрытый враг бьёт скрытого лесного монстра: ничего не видно и не слышно, урон идёт', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, lira = window.red('lira'), grok = window.red('grok');
    for (const c of g.camps) c.timer = 0;
    window.step(0.01);
    const m = g.camps.filter((c) => c.x > 20 && c.kind !== 'dragon')[0].monster;
    m.update = () => {};
    lira.pos.x = m.pos.x - 5; lira.pos.z = m.pos.z;
    grok.pos.x = m.pos.x - 1.6; grok.pos.z = m.pos.z + 0.5;
    window.step(0.01);
    const hp0 = m.hp;
    window.sounds.length = 0;
    lira.basicAttack(m); grok.basicAttack(m);
    g.hitSpark(m, 0xffffff); // старая вспышка крипов и монстров — та же привязка к цели
    const pr = g.projectiles.at(-1);
    window.step(0.05);
    const midProjectile = pr.mesh.visible;
    for (let i = 0; i < 20; i++) window.step(0.05);
    return {
      hidden: !g.isVisible(p.team, lira) && !g.isVisible(p.team, grok) && !g.isVisible(p.team, m),
      lost: hp0 - m.hp, midProjectile,
      impacts: window.dota3.impacts.slots.filter((s) => s.target === m).map((s) => s.root.visible),
      sparks: g.effects.filter((e) => e.at === m).map((e) => e.mesh.visible),
      sounds: window.sounds.slice(), floats: document.querySelectorAll('.float').length,
    };
  });
  check(r.hidden, 'все трое должны быть в тумане', r);
  check(r.lost > 0, 'урон по монстру должен пройти', r);
  check(!r.midProjectile && r.impacts.every((v) => !v) && r.sparks.every((v) => !v), 'ничего не должно быть видно', r);
  check(!r.sounds.length && !r.floats, 'ни звуков, ни чисел', r);
});

test('снаряд из тумана в видимую местность и обратно: виден ровно там, где видно', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Skillshot } = await import('./src/units.js');
    const g = window.dota3.game, p = g.player, lira = window.red('lira');
    // поперёк линии: из леса на севере через игрока в лес на юге (башни и база отсюда не видны)
    lira.pos.x = p.pos.x; lira.pos.z = -24;
    window.step(0.01);
    const s = new Skillshot(g, lira, { x: 0, z: 1 }, { range: 46, speed: 20, width: 0.1, pierce: true, color: 0xffffff, onHit: () => {} });
    g.addProjectile(s);
    const track = [];
    for (let i = 0; i < 60 && !s.done; i++) {
      window.step(0.05);
      track.push({ z: +s.pos.z.toFixed(1), shown: s.mesh.visible, seen: g.seesSpot(p.team, s.pos.x, s.pos.z) });
    }
    return { track, caster: g.isVisible(p.team, lira) };
  });
  const states = r.track.map((x) => (x.shown ? 1 : 0)).join('').replace(/(.)\1+/g, '$1');
  check(!r.caster, 'стрелок в тумане', r.caster);
  check(states === '010', 'снаряд: скрыт → виден → скрыт', { states, track: r.track.filter((_, i) => i % 6 === 0) });
  check(r.track.every((x) => x.shown === x.seen), 'видимость снаряда = видимость местности под ним', r.track);
});

test('скрытый в кусте стрелок бьёт видимого игрока: выстрел, удар и число видны, стрелок — нет', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, lira = window.red('lira');
    p.pos.x = -33; p.pos.z = 1.5;
    lira.pos.x = -33; lira.pos.z = 5.5; // в кусте у края линии; своих в кусте нет
    window.step(0.01);
    const hiddenBefore = !g.isVisible(p.team, lira);
    window.sounds.length = 0;
    lira.basicAttack(p);
    const pr = g.projectiles.at(-1);
    const seenWhileInBush = [];
    let hit = false;
    g.on('damage', (d) => { if (d.target === p) hit = true; });
    for (let i = 0; i < 20 && !hit; i++) { window.step(0.02); seenWhileInBush.push(pr.mesh.visible); }
    const slot = window.dota3.impacts.slots.find((s) => s.active && s.target === p);
    return {
      hiddenBefore, hit, projectile: seenWhileInBush, impact: slot?.root.visible, floats: [...document.querySelectorAll('.float')].map((f) => f.className),
      sounds: window.sounds.slice(),
    };
  });
  check(r.hiddenBefore, 'стрелок в кусте должен быть скрыт', r);
  check(r.hit, 'выстрел должен попасть', r);
  check(r.projectile[0] === false && r.projectile.includes(true), 'стрела не видна в кусте и видна снаружи', r.projectile);
  check(r.impact === true && r.floats.some((c) => c.includes('taken')), 'удар по игроку виден, число полученного урона есть', r);
  check(!r.sounds.includes('arrow') && r.sounds.includes('hit'), 'звук выстрела скрытого стрелка не играет, звук попадания по игроку — да', r.sounds);
});

test('цель уходит в куст: отклик на ней скрывается, но живёт и гаснет', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, grok = window.red('grok');
    p.pos.x = -33; p.pos.z = 1.5;
    grok.pos.x = -31; grok.pos.z = 2.5;
    window.step(0.01);
    p.basicAttack(grok);
    const pr = g.projectiles.at(-1);
    let hit = false;
    g.on('damage', (d) => { if (d.target === grok) hit = true; });
    for (let i = 0; i < 20 && !hit; i++) window.step(0.02);
    const slot = window.dota3.impacts.slots.find((s) => s.active && s.target === grok);
    const before = slot.root.visible;
    const floatsBefore = document.querySelectorAll('.float').length;
    grok.pos.z = 5.5; // в куст
    window.step(0.01);
    const after = { visible: slot.root.visible, active: slot.active };
    p.basicAttack(grok); // второй выстрел уже в скрытую цель: числа над ней нет
    for (let i = 0; i < 30; i++) window.step(0.02);
    return { hit, before, after, gone: !slot.active, floatsBefore, floatsAfter: document.querySelectorAll('.float').length, seen: g.isVisible(p.team, grok), projectileGone: pr.done };
  });
  check(r.hit && r.before === true, 'отклик сначала виден', r);
  check(r.after.visible === false && r.after.active === true, 'в кусте — скрыт, но жив', r);
  check(r.gone, 'отклик должен погаснуть по времени', r);
  check(!r.seen && r.floatsAfter <= r.floatsBefore, 'урон по скрытой цели не подписан', r);
});

test('зона удара на границе обзора: видна целиком; полностью в тумане — нет; взрыв, звук и тряска так же', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { AreaStrike } = await import('./src/units.js');
    const g = window.dota3.game, p = g.player, pyro = window.red('pyro');
    pyro.pos.x = 30; pyro.pos.z = 0; // кастер далеко в тумане
    window.step(0.01);
    const R = 4.5, vis = 11; // обзор героя игрока — 11 м
    const mk = (x) => { const a = new AreaStrike(g, pyro, x, 0, { radius: R, delay: 0.3, color: 0xff5a2a, falling: true, onHit: () => {} }); g.addProjectile(a); return a; };
    const out = {};
    for (const [name, x] of [['straddle', p.pos.x + vis + 2], ['hidden', p.pos.x + vis + R + 2]]) {
      window.sounds.length = 0;
      g.shakeAmount = 0;
      const a = mk(x);
      window.step(0.05);
      out[name] = { center: g.seesSpot(p.team, x, 0), ring: a.ring.visible, disc: a.disc.visible, rock: a.rock.visible };
      const old = new Set(g.effects);
      for (let i = 0; i < 8; i++) window.step(0.05);
      const boom = g.effects.find((e) => !old.has(e) && e.size > R);
      out[name].burst = boom ? boom.mesh.visible : null;
      out[name].sound = window.sounds.includes('boom');
      out[name].shake = g.shakeAmount > 0;
    }
    return { ...out, caster: g.isVisible(p.team, pyro) };
  });
  check(!r.caster, 'кастер в тумане', r);
  check(!r.straddle.center && r.straddle.ring && r.straddle.disc && r.straddle.rock, 'зона на границе: предупреждение видно', r.straddle);
  check(r.straddle.burst === true && r.straddle.sound && r.straddle.shake, 'зона на границе: взрыв, звук, тряска', r.straddle);
  check(!r.hidden.ring && !r.hidden.disc && !r.hidden.rock && r.hidden.burst === false && !r.hidden.sound && !r.hidden.shake, 'зона в тумане скрыта', r.hidden);
});

test('смерти: в тумане не видны и не слышны, на виду — видны; смерть союзника слышна всегда', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, grok = window.red('grok'), ally = window.blue('lira');
    Object.getPrototypeOf(g).spawnWave.call(g);
    const creeps = g.units.filter((u) => u.kind === 'creep' && u.team !== p.team);
    const [near, far] = creeps;
    for (const c of creeps) c.update = () => {};
    near.pos.x = p.pos.x + 3; near.pos.z = 0; far.pos.x = 30; far.pos.z = 0;
    grok.pos.x = 40; grok.pos.z = 0; ally.pos.x = -60; ally.pos.z = 2; // союзник далеко: не даёт обзор у Грока
    window.step(0.01);
    const kills0 = [...g.kills];
    window.sounds.length = 0;
    near.takeDamage(1e6, 'true', p); far.takeDamage(1e6, 'true', null);
    grok.takeDamage(1e6, 'true', null);
    const enemySounds = window.sounds.slice();
    ally.pos.x = 50; window.step(0.01); // союзник погибает в тумане далеко от игрока
    ally.takeDamage(1e6, 'true', null);
    const allySounds = window.sounds.slice(enemySounds.length);
    window.step(0.05);
    return {
      near: near.model.group.visible, far: far.model.group.visible, grok: grok.model.group.visible,
      enemySounds, allySounds, kills: [g.kills[0] - kills0[0], g.kills[1] - kills0[1]], alive: [grok.alive, ally.alive],
    };
  });
  check(r.near === true && r.far === false && r.grok === false, 'видна только смерть на виду', r);
  check(!r.enemySounds.includes('death') && r.allySounds.includes('death'), 'звук смерти: скрытый враг — нет, союзник — да', r);
  check(r.kills[0] === 1 && r.kills[1] === 1 && !r.alive[0] && !r.alive[1], 'счёт убийств и смерти — как в игре', r);
});

test('видимость меняется, пока эффект жив: вспышка в тумане проявляется, когда туда приходит игрок', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player;
    const x = p.pos.x + 16;
    g.burst(x, 0, 0xffffff, 1.5);
    const b = g.effects.at(-1);
    b.life = 5; // долгая, чтобы успеть сменить обзор
    window.step(0.05);
    const before = b.mesh.visible;
    p.pos.x = x - 3;
    window.step(0.05);
    const after = b.mesh.visible;
    p.pos.x = x - 30;
    window.step(0.05);
    return { before, after, again: b.mesh.visible };
  });
  check(r.before === false && r.after === true && r.again === false, 'вспышка: скрыта → видна → скрыта', r);
});

test('союзные эффекты видны в любой точке; общие объявления звучат', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game, p = g.player, ally = window.blue('grok');
    ally.pos.x = 50; ally.pos.z = 3; // далеко, но свой
    window.step(0.01);
    g.burst(ally.pos.x, ally.pos.z, 0xffffff, 1.5, ally);
    g.trail(ally);
    window.step(0.02);
    const allyFx = g.effects.slice(-2).map((e) => e.mesh.visible);
    window.sounds.length = 0;
    g.emit('dragonspawn', {});
    g.emit('multikill', { hero: ally, text: 'Двойное убийство' });
    g.shakeAmount = 0;
    g.shake(1); // общее событие (нексус, башня) — без привязки
    return { allyFx, sounds: window.sounds.slice(), shake: g.shakeAmount };
  });
  check(r.allyFx.every(Boolean), 'эффекты союзника видны', r);
  check(r.sounds.includes('roar') && r.sounds.includes('kill') && r.shake === 1, 'общие объявления и тряска', r);
});

test('скрытые эффекты живут и освобождаются как обычно; ресурсы не растут', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.dota3.game;
    const geo = () => window.dota3.renderer.info.memory.geometries;
    const run = () => { for (let i = 0; i < 50; i++) g.burst(40, (i % 10) - 5, 0xffffff, 1, { x: 40, z: 0 }); for (let i = 0; i < 20; i++) window.step(0.05); };
    run();
    const g0 = geo(), n0 = g.effects.length;
    run();
    return { g0, g1: geo(), n0, n1: g.effects.length };
  });
  check(r.n0 === 0 && r.n1 === 0, 'скрытые вспышки должны угаснуть и уйти', r);
  check(r.g1 === r.g0, 'геометрия не растёт', r);
});

await run(tests, boot);
