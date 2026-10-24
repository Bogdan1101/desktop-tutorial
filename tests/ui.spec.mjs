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
    start: 'practiceBtn',
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

test('смена матчей не копит геометрию героев', async ({ page }) => {
  await page.waitForFunction(() => window.dota3.game.player.model.mixer, null, { timeout: 30000 });
  const counts = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.dota3.state === 'pause');
    await page.evaluate(() => document.getElementById('quitBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'menu');
    await page.evaluate(() => document.getElementById('practiceBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'play');
    await page.evaluate(() => new Promise((ok) => { let n = 0; const f = () => (++n > 5 ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    counts.push(await page.evaluate(() => window.dota3.renderer.info.memory.geometries));
  }
  check(counts.every((c) => c === counts[0]), 'число геометрий растёт от матча к матчу', counts);
});

await run(tests, boot);
