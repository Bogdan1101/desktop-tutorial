// Проверки читаемости боя: маркер цели обычной атаки и подсказки об отказе в применении умения.
// Запуск: npm run test:combat   (нужны пакет playwright и браузер Chromium)
import { openGame, check, run } from './harness.mjs';

// Тренировка: рядом с героем манекены; журнал применений и отказов игрока
async function boot(start = 'practiceBtn') {
  const t = await openGame({ start });
  const { page } = t;
  await page.evaluate(() => {
    const g = window.dota3.game, p = g.player;
    window.castLog = {};
    window.rejects = [];
    window.botCasts = 0;
    g.on('cast', ({ hero, key }) => {
      if (hero === p) window.castLog[key] = (window.castLog[key] ?? 0) + 1; else window.botCasts++;
    });
    g.on('castrejected', (e) => window.rejects.push({ key: e.key, reason: e.reason, player: e.hero === p }));
    if (g.mode === 'practice') { p.pos.x = -9; p.pos.z = 0.5; }
  });
  t.atk = await t.center('#atkBtn');
  t.q = await t.center('#abQ');
  t.w = await t.center('#abW');
  t.r = await t.center('#abR');
  t.mark = () => page.evaluate(() => {
    const m = window.dota3.marker, p = window.dota3.game.player;
    return {
      visible: m.group.visible, x: m.group.position.x, z: m.group.position.z, target: m.target?.id ?? null,
      pTarget: p.target?.id ?? null, tx: p.target?.pos.x, tz: p.target?.pos.z, kind: p.target?.kind ?? null,
    };
  });
  t.hero = () => page.evaluate(() => {
    const p = window.dota3.game.player, el = document.getElementById('castFail');
    return {
      mana: p.mana, cdQ: p.cd.Q, cdW: p.cd.W, ranks: { ...p.ranks }, points: p.points,
      casted: { ...window.castLog }, rejects: window.rejects.slice(),
      fail: el.hidden ? null : el.textContent, failNodes: document.querySelectorAll('#castFail').length,
      failShown: window.dota3.hud.failShown, rejectedBtns: [...document.querySelectorAll('.ab.rejected')].map((b) => b.id),
    };
  });
  t.tap = (pt) => t.burst([['touchStart', [{ ...pt, id: 9 }]], ['touchEnd', []]]);
  return t;
}

const tests = [];
const test = (name, fn, start) => tests.push({ name, fn, start });

// --- маркер цели обычной атаки --------------------------------------------------------
async function attackUntilTarget(t) {
  await t.touch('touchStart', [{ ...t.atk, id: 1 }]);
  await t.page.waitForFunction(() => window.dota3.marker.group.visible, null, { timeout: 15000 });
  return t.mark();
}

test('маркер стоит на цели, выбранной логикой боя', async (t) => {
  const m = await attackUntilTarget(t);
  check(m.visible && m.target === m.pTarget && m.kind === 'dummy', 'маркер не на цели атаки', m);
  check(Math.abs(m.x - m.tx) < 1e-6 && Math.abs(m.z - m.tz) < 1e-6, 'маркер не под целью', m);
  await t.touch('touchEnd', []);
});

test('маркер переходит на новую цель, когда старая погибает', async (t) => {
  const first = await attackUntilTarget(t);
  const sameFrame = await t.page.evaluate(() => {
    const p = window.dota3.game.player, tg = p.target;
    tg.hp = 0; tg.die(p); // цель погибает
    return p.attackTarget;
  });
  check(sameFrame === null, 'погибшая цель всё ещё считается целью атаки');
  await t.page.waitForFunction((id) => {
    const m = window.dota3.marker;
    return m.group.visible && m.target && m.target.id !== id;
  }, first.target, { timeout: 15000 });
  const m = await t.mark();
  check(m.target === m.pTarget && m.target !== first.target && Math.abs(m.x - m.tx) < 1e-6, 'маркер не перешёл на новую цель', m);
  await t.touch('touchEnd', []);
});

test('отпускание атаки сразу прячет маркер', async (t) => {
  await attackUntilTarget(t);
  await t.touch('touchEnd', []);
  await t.frames(0.1);
  const m = await t.mark();
  check(!m.visible && m.target === null, 'маркер остался после отпускания', m);
});

test('смерть игрока прячет маркер', async (t) => {
  await attackUntilTarget(t);
  await t.page.evaluate(() => { const p = window.dota3.game.player; p.hp = 0; p.die(null); });
  await t.frames(0.2);
  const m = await t.mark();
  check(!m.visible, 'маркер виден у погибшего героя', m);
  await t.touch('touchEnd', []);
});

test('цель в тумане не подсвечивается', async (t) => {
  await attackUntilTarget(t);
  await t.page.evaluate(() => {
    const g = window.dota3.game, orig = g.isVisible.bind(g);
    g.isVisible = (team, u) => (u.kind === 'dummy' ? false : orig(team, u)); // все манекены «ушли в туман»
    g.visionTimer = 99;
  });
  await t.frames(0.1);
  const m = await t.mark();
  check(!m.visible && m.target === null, 'маркер выдал цель в тумане', m);
  await t.touch('touchEnd', []);
});

test('смена матча убирает маркер и не оставляет старый', async (t) => {
  await attackUntilTarget(t);
  await t.touch('touchEnd', []);
  await t.page.evaluate(() => { window.oldMarker = window.dota3.marker; document.querySelector('.pause-btn').click(); });
  await t.page.waitForFunction(() => window.dota3.state === 'pause');
  await t.page.evaluate(() => document.getElementById('quitBtn').click());
  await t.page.waitForFunction(() => window.dota3.state === 'menu');
  await t.page.evaluate(() => document.getElementById('playBtn').click());
  await t.page.waitForFunction(() => window.dota3.state === 'play');
  await t.frames(0.2);
  const r = await t.page.evaluate(() => ({
    oldDetached: window.oldMarker.group.parent === null, replaced: window.oldMarker !== window.dota3.marker,
    newVisible: window.dota3.marker.group.visible,
  }));
  check(r.oldDetached && r.replaced && !r.newVisible, 'старый маркер остался или новый виден без атаки', r);
});

test('маркер не создаёт геометрию и материалы в каждом кадре', async (t) => {
  await attackUntilTarget(t);
  const ids = () => t.page.evaluate(() => {
    const out = [];
    window.dota3.marker.group.traverse((o) => { if (o.isMesh) out.push(o.geometry.uuid + ':' + o.material.uuid); });
    return out.join(',');
  });
  const a = await ids();
  const count = () => t.page.evaluate(() => window.dota3.game.scene.children.length);
  const c1 = await count();
  await t.frames(1);
  check(a === await ids() && c1 === await count(), 'маркер пересоздаёт объекты');
  await t.touch('touchEnd', []);
});

// --- отказ в применении умения ---------------------------------------------------------
test('неизученное умение без очков: отказ, мана и перезарядка не тронуты', async (t) => {
  await t.page.evaluate(() => { window.dota3.game.player.points = 0; });
  const before = await t.hero();
  await t.tap(t.w);
  await t.frames();
  const s = await t.hero();
  check(s.rejects.at(-1)?.reason === 'unlearned' && /Не изучено/.test(s.fail) && s.rejectedBtns.includes('abW'), 'нет отказа «не изучено»', s);
  check(s.mana >= before.mana && s.cdW === 0 && s.ranks.W === 0 && !s.casted.W, 'отказ потратил ресурсы', s);
});

test('ульта до 5 уровня: отказ, очко не тратится', async (t) => {
  await t.tap(t.r);
  await t.frames();
  const s = await t.hero();
  check(s.rejects.at(-1)?.reason === 'unlearned' && /5 уровне/.test(s.fail) && s.points === 1, 'нет отказа для закрытой ульты', s);
});

test('перезарядка: отказ без повторной траты маны и без перезапуска перезарядки', async (t) => {
  await t.tap(t.q); // автоизучение и бросок
  await t.frames();
  const a = await t.hero();
  check(a.casted.Q === 1 && a.cdQ > 0, 'первый бросок не прошёл', a);
  await t.tap(t.q);
  await t.frames(0.1);
  const s = await t.hero();
  check(s.rejects.at(-1)?.reason === 'cooldown' && /Перезарядка/.test(s.fail), 'нет отказа «перезарядка»', s);
  check(s.casted.Q === 1 && s.mana >= a.mana && s.cdQ <= a.cdQ, 'отказ потратил ману или перезапустил перезарядку', { a, s });
});

test('мало маны: отказ, мана и перезарядка не тронуты', async (t) => {
  await t.page.evaluate(() => { const p = window.dota3.game.player; p.rankUp('Q'); p.mana = 10; });
  await t.tap(t.q);
  await t.frames(0.1);
  const s = await t.hero();
  check(s.rejects.at(-1)?.reason === 'mana' && /маны/.test(s.fail), 'нет отказа «мало маны»', s);
  check(s.mana >= 10 && s.cdQ === 0 && !s.casted.Q, 'отказ потратил ресурсы', s);
});

test('оглушение: отказ, мана и перезарядка не тронуты', async (t) => {
  await t.page.evaluate(() => { const p = window.dota3.game.player; p.rankUp('Q'); p.stun(30); });
  const before = await t.hero();
  await t.tap(t.q);
  await t.frames(0.1);
  const s = await t.hero();
  check(s.rejects.at(-1)?.reason === 'control' && /Оглушение/.test(s.fail), 'нет отказа «оглушение»', s);
  check(s.mana >= before.mana && s.cdQ === 0 && !s.casted.Q, 'отказ потратил ресурсы', s);
});

test('погибший герой: отказ, и бросок не срабатывает после возрождения', async (t) => {
  await t.page.evaluate(() => { const p = window.dota3.game.player; p.rankUp('Q'); p.hp = 0; p.die(null); p.respawnTimer = 0.6; });
  await t.tap(t.q);
  await t.frames(0.2);
  const s = await t.hero();
  check(s.rejects.at(-1)?.reason === 'dead' && /погиб/.test(s.fail), 'нет отказа «герой погиб»', s);
  await t.page.waitForFunction(() => window.dota3.game.player.alive, null, { timeout: 15000 });
  await t.frames(0.3);
  const after = await t.hero();
  check(!after.casted.Q && after.cdQ === 0, 'бросок сработал после возрождения', after);
});

test('успешный бросок и автоизучение без подсказки', async (t) => {
  await t.tap(t.q);
  await t.frames();
  const s = await t.hero();
  check(s.ranks.Q === 1 && s.casted.Q === 1 && s.cdQ > 0, 'автоизучение или бросок сломались', s);
  check(s.rejects.length === 0 && s.fail === null && s.rejectedBtns.length === 0, 'успешный бросок дал подсказку об отказе', s);
});

test('бросок без попадания — не отказ', async (t) => {
  // героя уводят от манекенов: огненному шару некуда попасть
  await t.page.evaluate(() => { const p = window.dota3.game.player; p.pos.x = -40; p.pos.z = 0; p.facing = -Math.PI / 2; });
  await t.tap(t.q);
  await t.frames();
  const s = await t.hero();
  check(s.casted.Q === 1 && s.rejects.length === 0 && s.fail === null, 'промах посчитан отказом', s);
});

test('отменённый жест и описание по удержанию — без подсказки об отказе', async (t) => {
  await t.page.evaluate(() => { window.dota3.game.player.rankUp('Q'); });
  await t.burst([['touchStart', [{ ...t.q, id: 1 }]], ['touchMove', [{ x: t.q.x - 40, y: t.q.y, id: 1 }]]]);
  const c = await t.center('#aimCancel');
  await t.touch('touchMove', [{ ...c, id: 1 }]);
  await t.touch('touchEnd', []);
  await t.touch('touchStart', [{ ...t.q, id: 2 }]);
  await t.page.waitForTimeout(800);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.hero();
  check(!s.casted.Q && s.rejects.length === 0 && s.fail === null, 'отменённый жест дал бросок или отказ', s);
});

test('повторные отказы не засоряют экран', async (t) => {
  await t.page.evaluate(() => { window.dota3.game.player.points = 0; });
  const steps = [];
  for (let i = 0; i < 6; i++) steps.push(['touchStart', [{ ...t.w, id: 20 + i }]], ['touchEnd', []]);
  await t.burst(steps);
  for (let i = 0; i < 5; i++) await t.page.keyboard.press('KeyF'); // W с клавиатуры
  await t.page.keyboard.down('KeyF'); await t.page.keyboard.down('KeyF'); await t.page.keyboard.up('KeyF'); // автоповтор
  // игра берёт из очереди одно нажатие за кадр — ждём, пока очередь опустеет
  await t.page.waitForFunction(() => window.dota3.input.casts.length === 0 && !window.dota3.game.player.intent.cast, null, { timeout: 30000 });
  await t.frames(0.1);
  const s = await t.hero();
  check(s.rejects.filter((r) => r.player).length >= 6, `до игры дошло отказов: ${s.rejects.length}`, { fail: s.fail, shown: s.failShown });
  check(s.failNodes === 1 && s.failShown === 1 && /Не изучено/.test(s.fail), 'одинаковые отказы перезапускали подсказку', s);
  await t.tap(t.r); // другой отказ заменяет строку, а не добавляет новую
  await t.frames(0.2);
  const r = await t.hero();
  check(r.failNodes === 1 && r.failShown === 2 && /5 уровне/.test(r.fail) && r.rejectedBtns.join() === 'abR', 'новый отказ не заменил старый', r);
});

test('пауза и возвращение очищают подсказку', async (t) => {
  await t.page.evaluate(() => { window.dota3.game.player.points = 0; });
  await t.tap(t.w);
  await t.frames(0.1);
  check((await t.hero()).fail !== null, 'подсказка не появилась');
  await t.page.evaluate(() => document.querySelector('.pause-btn').click());
  await t.page.waitForFunction(() => window.dota3.state === 'pause');
  const p = await t.hero();
  check(p.fail === null && p.rejectedBtns.length === 0, 'подсказка осталась на паузе', p);
  await t.page.evaluate(() => document.getElementById('resumeBtn').click());
  await t.frames(0.1);
  check((await t.hero()).fail === null, 'подсказка вернулась после паузы');
});

test('боты не вызывают подсказок игрока', async (t) => {
  await t.page.evaluate(() => {
    const g = window.dota3.game, p = g.player, e = g.heroes[1][0], brain = g.brains.find((b) => b.hero === e);
    // бот рядом с игроком применяет умения своей обычной логикой
    e.pos.x = p.pos.x + 3; e.pos.z = p.pos.z;
    e.points = 3;
    brain.levelUp();
    for (let i = 0; i < 3; i++) { brain.useAbilities(p); e.cd.Q = e.cd.W = e.cd.E = 0; e.mana = e.maxMana; }
    // и заведомо неудачные попытки бота: неизученная ульта и повтор на перезарядке
    e.cast('R');
    e.cast('Q'); e.cast('Q');
  });
  await t.frames(0.2);
  const s = await t.hero();
  const botCasts = await t.page.evaluate(() => window.botCasts);
  check(botCasts > 0, 'бот не применял умений — проверка ничего не доказывает', { botCasts });
  check(s.fail === null && s.failShown === 0 && s.rejects.every((r) => r.player), 'бот вызвал подсказку', { s, botCasts });
}, 'playBtn');

await run(tests, (test) => boot(test.start ?? 'practiceBtn'));
