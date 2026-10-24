// Проверки интерфейса на телефонных экранах: строка отказа умения помещается и ничего не закрывает,
// описание умения важнее строки отказа, сбой необязательных веб-шрифтов не считается ошибкой игры.
// Запуск: npm run test:ui   (нужны пакет playwright и браузер Chromium)
import { openGame, check, run } from './harness.mjs';

const FONTS = /fonts\.(googleapis|gstatic)\.com/;
// Шрифты Google не грузятся: проверяем на системных шрифтах. Отказ приходит с задержкой,
// чтобы обработчик ошибок на странице точно успел его увидеть.
const blockFonts = (ctx) => ctx.route(FONTS, async (r) => { await new Promise((ok) => setTimeout(ok, 300)); await r.abort(); });

const VIEWPORTS = [[667, 375], [844, 390], [915, 412]];
const SCALES = [0.8, 1, 1.3]; // все крайние значения ползунка «Размер кнопок»
// Самые длинные причины отказа
const REASONS = [
  { key: 'R', reason: 'control', control: 'stasis' },
  { key: 'E', reason: 'control', control: 'knock' },
  { key: 'W', reason: 'mana' },
  { key: 'Q', reason: 'cooldown' },
  { key: 'R', reason: 'unlearned' },
];

async function boot(test) {
  const t = await openGame({
    start: test.start === undefined ? 'practiceBtn' : test.start,
    viewport: test.viewport,
    settings: test.settings,
    setup: async (ctx) => {
      if (test.fonts !== 'ok') await blockFonts(ctx);
      if (test.init) await ctx.addInitScript(test.init);
    },
  });
  t.tap = (pt) => t.burst([['touchStart', [{ ...pt, id: 9 }]], ['touchEnd', []]]);
  t.fail = () => t.page.evaluate(() => {
    const el = document.getElementById('castFail');
    return { text: el.hidden ? null : el.textContent, rejected: [...document.querySelectorAll('.ab.rejected')].map((b) => b.id),
      tip: !document.getElementById('skillTip').hidden };
  });
  return t;
}

const tests = [];
const test = (name, fn, extra) => tests.push({ name, fn, ...extra });

// Строка отказа: текст внутри рамки, рамка в окне, не задевает миникарту, верхнюю панель и кнопки
const measure = (page) => page.evaluate(() => {
  const el = document.getElementById('castFail');
  const r = el.getBoundingClientRect();
  const hits = [...document.querySelectorAll('#hud .top > *, #actions .act, #actions .rank, #hud .utility, #practicePanel')]
    .filter((e) => !e.hidden && e.offsetParent)
    .filter((e) => { const o = e.getBoundingClientRect(); return o.left < r.right && r.left < o.right && o.top < r.bottom && r.top < o.bottom; })
    .map((e) => e.id || e.className);
  return { hidden: el.hidden, text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
    l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, hits };
});

test('длинные отказы помещаются на всех экранах и размерах кнопок', async ({ page }) => {
  await page.evaluate(() => { window.dota3.hud.fail = null; });
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const scale of SCALES) {
      // ползунок из настроек: тот же путь, что у игрока
      await page.evaluate((s) => { const r = document.getElementById('setButtons'); r.value = s; r.dispatchEvent(new Event('input')); }, scale);
      for (const e of REASONS) {
        await page.evaluate((e) => {
          const { hud, game } = window.dota3;
          hud.clearCastFeedback();
          game.emit('castrejected', { hero: game.player, ...e });
        }, e);
        const m = await measure(page);
        const where = `${width}x${height} кнопки ${scale}: «${m.text}»`;
        check(!m.hidden, `строка не показана ${where}`);
        check(m.sw <= m.cw && m.sh <= m.ch, `текст выходит за рамку ${where}`, m);
        check(m.l >= 0 && m.t >= 0 && m.r <= m.vw && m.b <= m.vh, `рамка за краем экрана ${where}`, m);
        check(!m.hits.length, `строка закрывает ${m.hits.join(', ')} ${where}`, m);
      }
    }
  }
});

test('строка отказа переносится, а не обрезается', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.evaluate(() => { const { game } = window.dota3; game.emit('castrejected', { hero: game.player, key: 'R', reason: 'control', control: 'stasis' }); });
  const m = await page.evaluate(() => {
    const el = document.getElementById('castFail'), cs = getComputedStyle(el);
    return { ws: cs.whiteSpace, lines: Math.round((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight)) };
  });
  check(m.ws !== 'nowrap', 'перенос строк выключен', m);
  check(m.lines >= 2, 'длинная причина должна занять несколько строк', m);
});

test('описание умения убирает строку отказа и не возвращает её', async (t) => {
  const { page } = t;
  await page.evaluate(() => { window.dota3.game.player.points = 0; });
  const w = await t.center('#abW'), q = await t.center('#abQ');
  await t.tap(w); // W не изучено: настоящий отказ
  await page.waitForFunction(() => !document.getElementById('castFail').hidden);
  let f = await t.fail();
  check(f.rejected.includes('abW'), 'кнопка W должна быть подсвечена', f);
  // удержание Q открывает описание
  await t.touch('touchStart', [{ ...q, id: 1 }]);
  await page.waitForFunction(() => !document.getElementById('skillTip').hidden);
  f = await t.fail();
  check(f.tip && f.text === null && !f.rejected.length, 'описание должно убрать строку отказа и подсветку', f);
  // отказ с клавиатуры, пока описание открыто, его не перекрывает
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.dota3.input.casts.length === 0 && !window.dota3.game.player.intent.cast);
  f = await t.fail();
  check(f.tip && f.text === null && !f.rejected.length, 'пока открыто описание, строка отказа не появляется', f);
  await t.touch('touchEnd', []);
  await page.waitForFunction(() => document.getElementById('skillTip').hidden);
  await t.frames(0.3);
  f = await t.fail();
  check(f.text === null && !f.rejected.length, 'после описания старая строка не возвращается', f);
  // новая попытка снова показывает причину
  await t.tap(w);
  await page.waitForFunction(() => !document.getElementById('castFail').hidden);
  f = await t.fail();
  check(f.text.includes('Не изучено') && f.rejected.includes('abW'), 'новый отказ после описания должен показаться', f);
});

test('сбой веб-шрифтов не показывает ошибку, игра идёт', async ({ page }) => {
  const s = await page.evaluate(() => ({
    err: document.getElementById('err').hidden ? null : document.getElementById('err').textContent,
    fontLoaded: [...document.fonts].some((f) => f.family.includes('Rubik') && f.status === 'loaded'),
    font: getComputedStyle(document.body).fontFamily,
    state: window.dota3.state,
  }));
  check(!s.fontLoaded, 'шрифт не должен был загрузиться', s);
  check(s.err === null, 'сбой шрифта не должен показывать ошибку', s);
  check(s.state === 'play', 'игра должна идти', s);
});

test('сбой шрифтов виден в обработчике, но игнорируется только для data-optional', async ({ page }) => {
  // Тот же сбой у обычной таблицы стилей — ошибка
  await page.evaluate(() => new Promise((ok) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Nope';
    l.onerror = () => setTimeout(ok, 50);
    document.head.append(l);
  }));
  const err = await page.evaluate(() => document.getElementById('err').textContent);
  check(err.includes('не загрузился https://fonts.googleapis.com/css2?family=Nope'), 'обязательная таблица стилей должна давать ошибку', err);
});

test('настоящие ошибки по-прежнему показываются', async (t) => {
  const { page } = t;
  await page.evaluate(() => new Promise((ok) => {
    setTimeout(() => { throw new Error('проверка: сбой в игре'); });
    Promise.reject(new Error('проверка: отклонённое обещание'));
    const s = document.createElement('script');
    s.src = 'missing-required.js';
    s.onerror = () => setTimeout(ok, 50);
    document.head.append(s);
  }));
  await page.evaluate(() => new Promise((ok) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'missing-required.css';
    l.onerror = () => setTimeout(ok, 50);
    document.head.append(l);
  }));
  const err = await page.evaluate(() => { const e = document.getElementById('err'); return e.hidden ? null : e.textContent; });
  for (const part of ['проверка: сбой в игре', 'проверка: отклонённое обещание', 'missing-required.js', 'missing-required.css']) {
    check(err && err.includes(part), `ошибка «${part}» должна быть на экране`, err);
  }
  t.errors.length = 0; // эти ошибки вызваны нарочно
});

test('со шрифтами Google без ошибок', async ({ page }) => {
  // Без перехвата: если сеть до Google есть, шрифт грузится; если нет — всё равно без баннера
  const err = await page.evaluate(() => document.getElementById('err').hidden ? null : document.getElementById('err').textContent);
  check(err === null, 'ошибок быть не должно', err);
}, { fonts: 'ok' });

// Обработчики resize на окне: сколько сейчас подписано (считаем до загрузки игры)
function countResize() {
  const live = new Set();
  const add = window.addEventListener, remove = window.removeEventListener;
  window.addEventListener = function (type, fn, ...rest) { if (this === window && type === 'resize') live.add(fn); return add.call(this, type, fn, ...rest); };
  window.removeEventListener = function (type, fn, ...rest) { if (this === window && type === 'resize') live.delete(fn); return remove.call(this, type, fn, ...rest); };
  window.resizeListeners = () => live.size;
}

test('смена матчей не копит обработчики интерфейса', async ({ page }) => {
  const before = await page.evaluate(() => window.resizeListeners());
  for (let i = 0; i < 4; i++) {
    // пауза → выйти в меню → снова тренировка: каждый раз новый матч и новый интерфейс
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.dota3.state === 'pause');
    await page.evaluate(() => document.getElementById('quitBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'menu');
    await page.evaluate(() => document.getElementById('practiceBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'play');
  }
  const after = await page.evaluate(() => window.resizeListeners());
  check(after === before, `обработчиков resize стало ${after}, было ${before}`);
  // строка отказа в новом интерфейсе по-прежнему пересчитывает место при повороте экрана
  await page.evaluate(() => { const { game } = window.dota3; game.emit('castrejected', { hero: game.player, key: 'R', reason: 'control', control: 'stasis' }); });
  await page.setViewportSize({ width: 667, height: 375 });
  const m = await measure(page);
  check(!m.hidden && !m.hits.length && m.r <= m.vw, 'после смены матчей строка отказа должна вставать на место', m);
}, { init: countResize });

// --- модели героев -------------------------------------------------------------------
test('оружие героев не уходит в землю в покое, беге и атаке', async ({ page }) => {
  await page.waitForFunction(() => window.dota3.game.player.model.mixer, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const THREE = await import('three');
    const { heroModel } = await import('./src/models.js');
    const out = [];
    for (const id of ['pyro', 'grok', 'lira']) {
      const m = heroModel(0, id);
      const box = new THREE.Box3();
      for (const [pose, steps] of [['Idle', 10], ['Running', 20], ['Punch', 12]]) {
        m.play(pose, 1);
        for (let i = 0; i < steps; i++) {
          m.mixer.update(0.05);
          m.update();
          m.group.updateMatrixWorld(true);
          // всё, что держит герой, — дети группы, кроме самого скелета и подсветки (m.weapon)
          for (const held of m.group.children.filter((c, k) => k > 0 && c !== m.weapon)) {
            box.setFromObject(held);
            out.push({ id, pose, bottom: box.min.y, top: box.max.y });
          }
        }
      }
    }
    return out;
  });
  const low = r.filter((x) => x.bottom < -0.05);
  check(new Set(r.map((x) => x.id)).size === 3, 'не у всех героев нашлось оружие в руках', r.slice(0, 3));
  check(!low.length, 'оружие ушло под землю', low.slice(0, 3));
});

test('запасные модели собираются без robot.glb', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { heroModel } = await import('./src/models.js?fallback');
    return ['pyro', 'grok', 'lira'].map((id) => { const m = heroModel(1, id); return { id, skeletal: !!m.mixer, parts: m.group.children.length, orb: !!m.orb, weapon: !!m.weapon }; });
  });
  for (const x of r) check(!x.skeletal && x.parts >= 8 && x.orb && x.weapon, 'запасная модель неполная', x);
});

// --- ресурсы GPU между матчами ---------------------------------------------------------
const frames = (page, n) => page.evaluate((n) => new Promise((ok) => { let k = 0; const f = () => (++k > n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const gpu = (page) => page.evaluate(() => { const r = window.dota3.renderer.info; return { tex: r.memory.textures, geo: r.memory.geometries }; });
async function toMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.dota3.state === 'pause');
  await page.evaluate(() => document.getElementById('quitBtn').click());
  await page.waitForFunction(() => window.dota3.state === 'menu');
}
// скины игрока для всех трёх героев
function equipSkins() {
  localStorage.setItem('dota3-profile', JSON.stringify({ owned: { pyro: ['ice'], grok: ['gold'], lira: ['forest'] }, equipped: { pyro: 'ice', grok: 'gold', lira: 'forest' } }));
}

test('ресурсы GPU не растут от матча к матчу (3 на 3, все герои, скины, смерть)', async ({ page }) => {
  await toMenu(page);
  await page.waitForFunction(() => window.dota3.game.player.model.mixer, null, { timeout: 30000 });
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const hero = ['pyro', 'grok', 'lira'][i % 3];
    await page.evaluate((h) => { document.getElementById(`hero-${h}`).checked = true; document.getElementById('playBtn').click(); }, hero);
    await page.waitForFunction(() => window.dota3.state === 'play');
    await page.evaluate(() => {
      const g = window.dota3.game;
      g.isVisible = () => true; // все шестеро рисуются: ленивые текстуры костей создаются в каждом матче
      g.heroes[1][0].takeDamage(1e6, 'true', null); // смерть и возрождение
    });
    for (let k = 0; k < 16; k++) { await page.evaluate(() => window.dota3.simulate(0.5)); await frames(page, 1); }
    const match = await gpu(page);
    const ok = await page.evaluate(() => window.dota3.game.allHeroes.every((h) => h.model.mixer && h.model.group.children.length > 2));
    await toMenu(page);
    await frames(page, 10); // меню с фоновым матчем отрисовано
    rows.push({ hero, ok, match, menu: await gpu(page) });
  }
  check(rows.every((r) => r.ok), 'у героя пропала модель-робот', rows);
  // Первые два цикла — прогрев. Дальше в равных состояниях текстуры не растут вовсе:
  // каждая текстура костей и карта теней принадлежат одному матчу и уходят вместе с ним.
  // Геометрия в меню зависит от пары героев фонового матча (случайный противник): разброс
  // по деталям героев до ~25 единиц, но не рост.
  const warm = rows.slice(0, 2), later = rows.slice(2);
  const max = (xs) => Math.max(...xs);
  check(max(later.map((r) => r.menu.tex)) <= max(warm.map((r) => r.menu.tex)), 'текстуры в меню растут от цикла к циклу', rows);
  check(max(later.map((r) => r.match.tex)) <= max(warm.map((r) => r.match.tex)), 'текстуры в матче растут от цикла к циклу', rows);
  check(max(later.map((r) => r.menu.geo)) <= max(warm.map((r) => r.menu.geo)) + 25, 'геометрия в меню растёт от цикла к циклу', rows);
}, { settings: { quality: 'medium', mode: '3v3' }, init: equipSkins });

test('долгий матч не копит геометрию погибших крипов, снарядов и эффектов', async ({ page }) => {
  await toMenu(page);
  await page.evaluate(() => document.getElementById('playBtn').click());
  await page.waitForFunction(() => window.dota3.state === 'play');
  await page.evaluate(() => { window.dota3.game.isVisible = () => true; });
  const pts = [];
  for (let k = 0; k < 240; k++) {
    await page.evaluate(() => window.dota3.simulate(0.5));
    if (k % 2 === 0) await frames(page, 1);
    if (k % 20 === 19) pts.push({ t: (k + 1) / 2, ...(await gpu(page)), units: await page.evaluate(() => window.dota3.game.units.length) });
  }
  // Число объектов на карте колеблется вместе с волнами; без утечки геометрия идёт за ним,
  // а не растёт со временем. До исправления за 2 минуты рост был больше чем в полтора раза.
  const early = Math.max(...pts.filter((p) => p.t <= 50).map((p) => p.geo));
  const late = Math.max(...pts.filter((p) => p.t >= 80).map((p) => p.geo));
  check(late <= early * 1.3, 'геометрия растёт со временем матча', pts);
}, { settings: { quality: 'low', mode: '3v3' } });

test('запасные модели: ресурсы не растут от матча к матчу', async ({ page }) => {
  await toMenu(page);
  const rows = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate((h) => { document.getElementById(`hero-${h}`).checked = true; document.getElementById('playBtn').click(); }, ['pyro', 'grok', 'lira', 'pyro'][i]);
    await page.waitForFunction(() => window.dota3.state === 'play');
    await page.evaluate(() => { window.dota3.game.isVisible = () => true; });
    for (let k = 0; k < 10; k++) { await page.evaluate(() => window.dota3.simulate(0.5)); await frames(page, 1); }
    const fallback = await page.evaluate(() => window.dota3.game.allHeroes.every((h) => !h.model.mixer));
    await toMenu(page);
    await frames(page, 10);
    rows.push({ fallback, menu: await gpu(page) });
  }
  check(rows.every((r) => r.fallback), 'ожидались запасные модели', rows);
  check(rows.every((r) => r.menu.tex === rows[0].menu.tex), 'текстуры растут (карты теней старых матчей)', rows);
}, { settings: { quality: 'medium', mode: '3v3' }, init: () => { window.ROBOT_URL = 'missing-robot.glb'; } });

// --- полоски здоровья героев и кнопки умений ----------------------------------------------
// Матч 3 на 3 заморожен: боты стоят, туман настоящий; все герои рядом с игроком
async function frozenLineup(page) {
  // камера догоняет игрока несколько кадров; полоски считаются до сдвига камеры в кадре
  await page.evaluate(() => {
    const g = window.dota3.game;
    window.pose = 'idle';
    g.update = function (dt) {
      this.time += dt;
      for (const h of this.allHeroes) { h.anim = window.pose === 'attack' ? 0.3 : 0; h.moving = window.pose === 'run'; }
      this.computeVision();
    };
    g.allHeroes.forEach((h, i) => { h.pos.x = -20 + (i % 3 - 1) * 4.2; h.pos.z = i < 3 ? 1.6 : -2.6; h.facing = 0.55; });
    const p = g.player, dx = -20 - p.pos.x; for (const h of g.allHeroes) h.pos.x += dx;
  });
  await page.waitForFunction(() => {
    const { hud, game } = window.dota3, p = game.player, s = hud.project(p.pos.x, 0, p.pos.z);
    const ok = window.__lastFoot && Math.abs(s.x - window.__lastFoot.x) < 0.1 && Math.abs(s.y - window.__lastFoot.y) < 0.1;
    window.__lastFoot = s;
    return ok;
  }, null, { polling: 'raf', timeout: 30000 });
  await frames(page, 3);
}
// Для каждого видимого героя: нижний край полоски и точка верха его модели на экране
const barVsTop = (page) => page.evaluate(() => {
  const { game, hud } = window.dota3;
  return game.allHeroes.map((h) => {
    const b = hud.bars.get(h);
    const top = hud.project(h.pos.x, h.model.top, h.pos.z);
    const foot = hud.project(h.pos.x, 0, h.pos.z);
    const r = b.el.getBoundingClientRect();
    return { id: h.heroId, team: h.team, top: h.model.top, barBottom: r.bottom, topY: top.y, topX: top.x, footY: foot.y, barX: (r.left + r.right) / 2 };
  });
});

for (const robot of [true, false]) {
  test(`полоска здоровья над силуэтом героя и не прыгает (${robot ? 'робот' : 'запасные модели'})`, async ({ page }) => {
    if (robot) await page.waitForFunction(() => window.dota3.game.player.model.mixer, null, { timeout: 30000 });
    await page.evaluate(() => document.getElementById('playBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'play');
    await frozenLineup(page);
    const idle = await barVsTop(page);
    for (const x of idle) {
      check(x.barBottom <= x.topY + 1, `полоска ${x.id} закрывает верх модели`, x);
      // по перспективе верх героя сбоку от центра смещён от точки у ног; полоска — над верхом
      check(Math.abs(x.barX - x.topX) < 2, `полоска ${x.id} не над своим героем`, x);
    }
    const tops = Object.fromEntries(idle.filter((x) => x.team === 0).map((x) => [x.id, x.top]));
    check(tops.pyro > tops.lira, 'у Пиро (шляпа) полоска выше, чем у Лиры', tops);
    // при атаке и беге полоска стоит на том же месте относительно героя
    for (const pose of ['attack', 'run']) {
      await page.evaluate((p) => { window.pose = p; }, pose);
      const shifts = [];
      for (let i = 0; i < 5; i++) {
        await frames(page, 3);
        const now = await barVsTop(page);
        now.forEach((x, k) => shifts.push(Math.abs((x.barBottom - x.footY) - (idle[k].barBottom - idle[k].footY))));
      }
      check(Math.max(...shifts) <= 1, `полоска прыгает в позе ${pose}`, shifts);
    }
  }, { start: null, settings: { mode: '3v3', hero: 'pyro' }, init: robot ? undefined : () => { window.ROBOT_URL = 'missing-robot.glb'; } });
}

// Состояния кнопок: A — Q готово, W перезарядка, E мало маны, R закрыта; B — Q не изучено, R готова, E перезарядка
async function buttonStates(page, set) {
  await page.evaluate((set) => {
    const p = window.dota3.game.player;
    window.__cost ??= p.manaCost.bind(p);
    if (set === 'A') {
      p.level = 1; p.points = 0; Object.assign(p.ranks, { Q: 1, W: 1, E: 1, R: 0 }); Object.assign(p.cd, { Q: 0, W: 5.4, E: 0, R: 0 });
      p.manaCost = (k) => (k === 'E' ? 1e9 : window.__cost(k));
      p.spellCd[p.spells[1]] = 23;
    } else {
      p.level = 6; p.points = 1; Object.assign(p.ranks, { Q: 0, W: 1, E: 1, R: 1 }); Object.assign(p.cd, { Q: 0, W: 0, E: 8.2, R: 0 });
      p.manaCost = window.__cost;
      p.spellCd[p.spells[0]] = 117;
    }
    p.mana = p.maxMana;
  }, set);
  await frames(page, 4);
}
const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('#actions .ab, #actions .spell')].map((b) => {
  const r = b.getBoundingClientRect(), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, R = r.width / 2;
  const box = (sel) => { const e = b.querySelector(sel); if (!e || !e.offsetParent || !e.textContent && !e.children.length) return null; return e.getBoundingClientRect(); };
  // скруглённый прямоугольник (круг, плашка) внутри круга кнопки: внутренний прямоугольник,
  // уменьшенный на радиус скругления, лежит в круге радиусом R − r
  const inside = (q) => {
    if (!q) return true;
    const r = Math.min(q.width, q.height) / 2;
    return [[q.left + r, q.top + r], [q.right - r, q.top + r], [q.left + r, q.bottom - r], [q.right - r, q.bottom - r]].every(([x, y]) => Math.hypot(x - cx, y - cy) <= R - r + 0.5);
  };
  const hit = (a, c) => a && c && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
  const ico = b.querySelector('.ico');
  const key = box('.key'), badge = box('.badge'), em = box('em');
  return {
    id: b.id, cls: [...b.classList].filter((c) => ['ready', 'cool', 'nomana', 'unlearned', 'locked'].includes(c)), label: b.getAttribute('aria-label'),
    svg: !!ico.querySelector('svg'), text: [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(''),
    icoOpacity: +getComputedStyle(ico).opacity, icoFilter: getComputedStyle(ico).filter, em: b.querySelector('em').textContent,
    keyIn: inside(key), badgeIn: inside(badge), emIn: inside(em), emKey: hit(em, key), emBadge: hit(em, badge),
    target: document.elementFromPoint(cx, cy)?.closest('button')?.id, conic: getComputedStyle(b.querySelector('.cd')).getPropertyValue('--p').trim(),
  };
}));

for (const [width, height] of [[667, 375], [844, 390], [915, 412]]) {
  test(`значки и состояния кнопок умений на ${width}×${height} при размерах 0,8 / 1 / 1,3`, async ({ page }) => {
    const bad = [];
    for (const scale of [0.8, 1, 1.3]) {
      await page.evaluate((s) => { const r = document.getElementById('setButtons'); r.value = s; r.dispatchEvent(new Event('input')); }, scale);
      for (const set of ['A', 'B']) {
        await buttonStates(page, set);
        const bs = await buttons(page);
        for (const b of bs) {
          const why = [];
          if (!b.svg) why.push('нет значка');
          if (b.text) why.push(`голый текст «${b.text}»`);
          if (!b.label || b.label.length < 6) why.push('нет доступного имени');
          if (!b.keyIn || !b.badgeIn || !b.emIn) why.push('слой выходит за круг');
          if (b.emKey || b.emBadge) why.push('число налезает на букву или значок');
          if (b.target !== b.id) why.push(`касание в центре попадает в ${b.target}`);
          if (why.length) bad.push({ scale, set, ...b, why });
        }
        const by = Object.fromEntries(bs.map((b) => [b.id, b]));
        const expect = set === 'A'
          ? { abQ: 'ready', abW: 'cool', abE: 'nomana', abR: 'locked' }
          : { abQ: 'unlearned', abW: 'ready', abE: 'cool', abR: 'ready' };
        for (const [id, st] of Object.entries(expect)) if (!by[id].cls.includes(st)) bad.push({ scale, set, id, want: st, got: by[id].cls });
        if (set === 'A') {
          if (!/^\d+$/.test(by.abW.em)) bad.push({ scale, set, id: 'abW', em: by.abW.em });
          if (!/5 ур/.test(by.abR.em) || !/откроется на 5 уровне/.test(by.abR.label)) bad.push({ scale, set, id: 'abR', em: by.abR.em, label: by.abR.label });
          if (!/не хватает маны/.test(by.abE.label)) bad.push({ scale, set, id: 'abE', label: by.abE.label });
          if (by.abS2.em !== '23') bad.push({ scale, set, id: 'abS2', em: by.abS2.em });
        } else {
          // не изученное умение узнаваемо: серое, но не почти чёрное и без тёмной заливки перезарядки
          if (!(by.abQ.icoOpacity >= 0.5) || !/grayscale/.test(by.abQ.icoFilter) || by.abQ.conic !== '0%') bad.push({ scale, set, id: 'abQ', ...by.abQ });
        }
      }
    }
    check(!bad.length, 'кнопки умений', bad.slice(0, 4));
  }, { viewport: { width, height }, start: 'practiceBtn' });
}

test('у каждого умения и заклинания свой значок, касание по значку применяет умение', async (t) => {
  const { page } = t;
  const ids = await page.evaluate(async () => {
    const { ICON_IDS } = await import('./src/icons.js');
    const { ABILITIES, SPELLS } = await import('./src/config.js');
    return { icons: ICON_IDS, need: [...Object.keys(ABILITIES), ...Object.keys(SPELLS)] };
  });
  const missing = ids.need.filter((id) => !ids.icons.includes(id));
  check(!missing.length, 'нет значка для', missing);
  // касание по центру значка Q — то же, что по кнопке: умение применяется
  await page.evaluate(() => { const p = window.dota3.game.player; p.ranks.Q = 1; p.points = 0; window.casts = 0; window.dota3.game.on('cast', ({ hero }) => { if (hero === p) window.casts++; }); });
  await t.tap(await t.center('#abQ .ico'));
  await t.frames(0.4);
  check(await page.evaluate(() => window.casts) === 1, 'касание значка Q должно применить умение');
});

test('все модули игры есть в списке офлайн-кэша', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const sw = await (await fetch('./sw.js')).text();
    const files = new Set([...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const seen = new Set(['src/main.js']), queue = ['src/main.js'];
    while (queue.length) {
      const f = queue.shift();
      const src = await (await fetch('./' + f)).text();
      for (const m of src.matchAll(/from '\.\.?\/([^']+)'/g)) {
        const dir = f.split('/').slice(0, -1).join('/');
        const path = m[0].includes("'../") ? m[1] : `${dir}/${m[1]}`;
        if (!seen.has(path)) { seen.add(path); queue.push(path); }
      }
    }
    return { missing: [...seen].filter((f) => !files.has(f)) };
  });
  check(!r.missing.length, 'не кэшируются для офлайна', r.missing);
});

await run(tests, boot);
