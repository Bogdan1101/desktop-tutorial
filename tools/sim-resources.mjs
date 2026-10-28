// Ресурсы в длинном и в повторных матчах ботов (без отрисовки): не растут ли списки юнитов, снарядов,
// эффектов, объектов сцены, память ботов и куча JS.
//   node --expose-gc tools/sim-resources.mjs [--minutes 45] [--repeat 8]
// Длинный матч: нексусы не получают урона (только в этом процессе), чтобы игра шла дольше обычного.
import { register } from 'node:module';

register(new URL('./three-loader.mjs', import.meta.url).href);
const THREE = await import('three');
const { Game } = await import('../src/game.js');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const MINUTES = +(args.minutes ?? 45);
const REPEAT = +(args.repeat ?? 8);
const DT = 1 / 30;
const gc = () => globalThis.gc?.();
const mb = () => +(process.memoryUsage().heapUsed / 1048576).toFixed(1);

function snapshot(g, scene) {
  return {
    units: g.units.length,
    projectiles: g.projectiles.length,
    effects: g.effects.length,
    scene: scene.children.length,
    hpLog: Math.max(...g.brains.map((b) => b.hpLog?.length ?? 0)),
    path: Math.max(...g.brains.map((b) => b.path?.length ?? 0)),
  };
}

// 1. Длинный матч
{
  const scene = new THREE.Scene();
  const g = new Game(scene, { difficulty: 'normal', mode: '3v3', heroId: 'grok', autoplay: true });
  for (const u of g.units) if (u.kind === 'nexus') u.takeDamage = () => 0;
  const rows = [];
  const peak = {};
  for (let t = 0, next = 0; t < MINUTES * 60; t += DT) {
    g.update(DT);
    const s = snapshot(g, scene);
    for (const [k, v] of Object.entries(s)) peak[k] = Math.max(peak[k] ?? 0, v);
    if (t >= next) { gc(); rows.push({ min: Math.round(t / 60), ...s, heapMB: mb() }); next += 300; }
  }
  console.log(`Длинный матч: ${MINUTES} мин игры (нексусы неуязвимы только здесь), снимок раз в 5 мин`);
  console.table(rows);
  console.log('максимумы за матч:', peak);
}

// 2. Повторные матчи в одном процессе
{
  const rows = [];
  for (let i = 0; i < REPEAT; i++) {
    const scene = new THREE.Scene();
    const g = new Game(scene, { difficulty: ['easy', 'normal', 'hard'][i % 3], mode: '3v3', heroId: ['pyro', 'grok', 'lira'][i % 3], autoplay: true });
    let t = 0;
    while (!g.over && t < 1800) { g.update(DT); t += DT; }
    const s = snapshot(g, scene);
    gc();
    rows.push({ match: i + 1, over: g.over, gameMin: +(t / 60).toFixed(1), ...s, heapMB: mb() });
  }
  console.log(`Повторные матчи: ${REPEAT} подряд в одном процессе, куча после сборки мусора`);
  console.table(rows);
}
