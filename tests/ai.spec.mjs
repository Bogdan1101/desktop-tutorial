// Решения ботов: сценарии на настоящей логике игры (src/game.js, src/ai.js) без браузера и отрисовки.
// Каждое исправленное решение проверяется в обе стороны: когда бот должен так поступить и когда не должен.
// Запуск: npm run test:ai
import { register } from 'node:module';

register(new URL('../tools/three-loader.mjs', import.meta.url).href);
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { dist } = await import('../src/units.js');

// Матч 3 на 3: волн нет, все герои стоят у своих фонтанов, бот «думает» только по вызову.
function setup({ autoplay = false, difficulty = 'normal' } = {}) {
  const g = new Game(new THREE.Scene(), { difficulty, mode: '3v3', heroId: 'pyro', autoplay });
  g.spawnWave = () => {};
  g.time = 5; // revealUntil героев в начале равен 0: при time = 0 все считались бы подсвеченными
  for (const h of g.allHeroes) { h.pos.x = h.team ? 66 : -66; h.pos.z = (h.slot - 1) * 2; }
  const brainOf = (h) => g.brains.find((b) => b.hero === h);
  const blue = (id) => g.heroes[0].find((h) => h.heroId === id);
  const red = (id) => g.heroes[1].find((h) => h.heroId === id);
  const place = (h, x, z, hp = 1) => { h.pos.x = x; h.pos.z = z; h.hp = h.maxHp * hp; };
  const kill = (h) => { h.alive = false; h.respawnTimer = 999; };
  const think = (b) => { g.computeVision(); b.think(); return b; };
  return { g, brainOf, blue, red, place, kill, think };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const check = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- Выживание ---------------------------------------------------------------------------------

test('отступает от видимой тройной угрозы до того, как здоровье упадёт до порога', () => {
  const { g, blue, red, place, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  place(lira, -4, 0, 0.55);
  place(red('pyro'), -1.5, 0.5); place(red('grok'), -2.5, -1); place(red('lira'), -1, -1.5);
  for (const e of g.heroes[1]) { e.gainXp(900); e.target = lira; }
  think(b);
  check(b.mode === 'retreat', `режим ${b.mode}, ожидалось retreat`);
  check(b.goal && b.goal.x < lira.pos.x, 'цель отступления должна быть в сторону своей базы');
});

test('не отступает от одного слабого крипа при том же здоровье', () => {
  const { g, blue, place, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  place(lira, -4, 0, 0.55);
  think(b);
  check(b.mode !== 'retreat', `режим ${b.mode}: без угрозы отступать не нужно`);
});

test('враги в кусте, которых не видно, не вызывают отступления (нет подглядывания)', () => {
  const { g, blue, red, place, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  place(lira, -11, 1.5, 0.55);
  // куст [-14..-8] × [3.8..7]: изнутри видно наружу, снаружи внутрь — нет
  place(red('pyro'), -11, 5); place(red('grok'), -12.5, 5.5); place(red('lira'), -9.5, 5.5);
  g.computeVision();
  check(g.heroes[1].every((e) => !g.isVisible(0, e)), 'враги должны быть скрыты кустом');
  think(b);
  check(b.mode !== 'retreat' && b.mode !== 'fight', `режим ${b.mode}: скрытые враги не должны влиять на решение`);
});

test('добивает почти мёртвую цель, вместо того чтобы бежать от неё', () => {
  const { g, blue, red, place, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira), e = red('pyro');
  place(lira, -4, 0, 0.5);
  place(e, -1, 0, 0.03);
  e.target = lira;
  b.target = e;
  think(b);
  check(b.mode === 'fight' && b.target === e, `режим ${b.mode}: цель умрёт раньше, бежать не нужно`);
});

// --- Натиск после перевеса и добивание нексуса --------------------------------------------------

test('после выигранной драки (двое врагов мертвы) идёт к следующему зданию', () => {
  const { g, blue, red, place, kill, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  place(lira, 4, 0);
  kill(red('pyro')); kill(red('grok'));
  think(b);
  const tower = g.units.find((u) => u.kind === 'tower' && u.team === 1 && u.order === 0);
  check(b.mode === 'siege', `режим ${b.mode}, ожидался siege`);
  check(b.goal && dist(b.goal, tower.pos) < lira.range + tower.radius + 1.5, 'цель — встать в досягаемости внешней башни');
});

test('при равенстве и без своей волны на башню в одиночку не идёт', () => {
  const { g, blue, place, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  place(lira, 4, 0);
  think(b);
  check(b.mode !== 'siege', `режим ${b.mode}: перевеса нет`);
});

test('открытый нексус важнее восстановившегося ингибитора', () => {
  const { g, blue, red, place, kill, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  for (const u of g.units) if (u.team === 1 && (u.kind === 'tower' || u.kind === 'inhib')) { u.everDestroyed = true; if (u.kind === 'tower') u.alive = false; }
  kill(red('pyro'));
  place(lira, 42, 2);
  think(b);
  const nexus = g.units.find((u) => u.kind === 'nexus' && u.team === 1);
  check(b.mode === 'siege', `режим ${b.mode}, ожидался siege`);
  check(b.nextEnemyStructure() === nexus, 'следующая цель — нексус');
  check(b.goal && dist(b.goal, nexus.pos) <= lira.range + nexus.radius + lira.radius, 'встаёт в досягаемости нексуса');
});

test('под башней, которая бьёт его, при натиске уходит, если здоровья мало', () => {
  const { g, blue, red, place, kill, brainOf, think } = setup();
  const lira = blue('lira'), b = brainOf(lira);
  const tower = g.units.find((u) => u.kind === 'tower' && u.team === 1 && u.order === 0);
  kill(red('pyro')); kill(red('grok'));
  place(lira, tower.pos.x - 6, 0, 0.5);
  tower.target = lira;
  think(b);
  check(b.mode !== 'siege' && b.goal && b.goal.x < lira.pos.x, `режим ${b.mode}: с половиной здоровья под огнём башни надо выйти`);
});

// --- Дракон -------------------------------------------------------------------------------------

function dragonSetup() {
  const s = setup();
  const camp = s.g.camps.find((c) => c.kind === 'dragon');
  camp.timer = 0;
  s.g.update(0.01); // появляется дракон
  for (const h of s.g.allHeroes) { h.pos.x = h.team ? 66 : -66; h.pos.z = (h.slot - 1) * 2; }
  const grok = s.blue('grok');
  for (let i = 0; i < 5; i++) grok.gainXp?.(1000);
  if (grok.level < 6) grok.level = 6;
  return { ...s, dragon: camp.monster, grok, b: s.brainOf(grok) };
}

test('лесник с союзником рядом и без видимых врагов идёт на дракона', () => {
  const { dragon, grok, b, blue, place, think } = dragonSetup();
  check(b.role === 'jungle', 'grok — лесник синих');
  place(grok, dragon.pos.x - 6, dragon.pos.z + 4);
  place(blue('lira'), dragon.pos.x + 4, dragon.pos.z + 10);
  think(b);
  check(b.mode === 'dragon' && b.target === dragon, `режим ${b.mode}, ожидался dragon`);
});

test('союзник рядом с логовом присоединяется к дракону', () => {
  const { dragon, grok, b, blue, place, brainOf, think } = dragonSetup();
  place(grok, dragon.pos.x - 4, dragon.pos.z + 3);
  const lira = blue('lira');
  place(lira, dragon.pos.x + 4, dragon.pos.z + 12);
  think(b);
  const lb = think(brainOf(lira));
  check(lb.mode === 'dragon', `режим союзника ${lb.mode}, ожидался dragon`);
});

test('один лесник 6 уровня дракона не начинает', () => {
  const { dragon, grok, b, place, think } = dragonSetup();
  place(grok, dragon.pos.x - 6, dragon.pos.z + 4);
  think(b);
  check(b.mode !== 'dragon', `режим ${b.mode}: в одиночку дракона не взять`);
});

test('видимый враг у логова — на дракона не идёт', () => {
  const { dragon, grok, b, blue, red, place, think } = dragonSetup();
  place(grok, dragon.pos.x - 6, dragon.pos.z + 4);
  place(blue('lira'), dragon.pos.x + 4, dragon.pos.z + 10);
  place(red('pyro'), dragon.pos.x + 9, dragon.pos.z + 6);
  think(b);
  check(b.mode !== 'dragon', `режим ${b.mode}: у логова враг`);
});

// --- Движение и управление игрока ---------------------------------------------------------------

test('два бота лоб в лоб не стоят на месте: обходят друг друга', () => {
  const { g, blue, place, brainOf } = setup();
  const a = blue('lira'), c = blue('grok');
  const ba = brainOf(a), bc = brainOf(c);
  place(a, -30, 0); place(c, -29, 0);
  // цели заданы жёстко, думать боты не будут
  ba.think = () => { ba.goal = { x: -18, z: 0 }; ba.target = null; };
  bc.think = () => { bc.goal = { x: -42, z: 0 }; bc.target = null; };
  g.brains = [ba, bc];
  g.player.pos.x = -66;
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  check(a.pos.x > -26 && c.pos.x < -33, `за 3 с должны разойтись: ${a.pos.x.toFixed(1)}, ${c.pos.x.toFixed(1)}`);
});

test('без автоигры у героя игрока нет бота, его управление не трогается', () => {
  const { g } = setup();
  const p = g.player;
  check(!g.brains.some((b) => b.hero === p), 'у героя игрока не должно быть бота');
  p.pos.x = -10; p.pos.z = 0;
  p.intent.mx = 0.6; p.intent.mz = 0.8;
  g.update(1 / 30);
  check(p.intent.mx === 0.6 && p.intent.mz === 0.8, 'намерение игрока не должно меняться ботами');
});

test('с автоигрой у героя игрока бот есть', () => {
  const { g } = setup({ autoplay: true });
  check(g.brains.some((b) => b.hero === g.player), 'при автоигре героем управляет бот');
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok   ${t.name}`); }
  catch (e) { failed++; console.log(`FAIL ${t.name}\n     ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} пройдено`);
process.exit(failed ? 1 : 0);
