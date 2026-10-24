// Проверки управления на настоящих касаниях (Chrome DevTools Protocol, мультитач).
// Запуск: npm run test:input   (нужны пакет playwright и браузер Chromium)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// --- статический сервер -----------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// --- помощники ---------------------------------------------------------------------
async function boot() {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  // низкое качество графики: программный рендер в тестах медленный, а жесты чувствительны ко времени
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('test-init')) {
      sessionStorage.setItem('test-init', '1');
      localStorage.clear();
      localStorage.setItem('dota3-settings', JSON.stringify({ quality: 'low', mode: '1v1', vibration: false }));
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // ускоряем время, чтобы проверки не ждали медленный программный рендер
  await page.goto(BASE + '?speed=3');
  await page.waitForFunction(() => window.dota3?.game);
  await page.evaluate(() => document.getElementById('playBtn').click());
  await page.waitForFunction(() => window.dota3.state === 'play');
  const cdp = await ctx.newCDPSession(page);
  const t = {
    page, ctx, errors,
    touch: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }),
    async center(sel) {
      const b = await page.locator(sel).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    snap: () => page.evaluate(() => {
      const i = window.dota3.input;
      return {
        state: window.dota3.state,
        joy: !!i.joy, moveX: i.move.x, moveZ: i.move.z,
        aiming: !!i.aiming, tip: i.tipKey, cancelHover: i.cancelHover,
        cancelShown: !document.getElementById('aimCancel').hidden,
        tipShown: !document.getElementById('skillTip').hidden,
        joyShown: !document.getElementById('joyBase').hidden,
        held: [...document.querySelectorAll('.held')].map((e) => e.id),
        casts: i.casts.length, actions: i.actions.length, keys: i.keys.size, attack: i.attackHeld,
        cdQ: window.dota3.game.player.cd.Q, rankQ: window.dota3.game.player.ranks.Q,
        recall: !!window.dota3.game.player.recall,
      };
    }),
    // ждём, пока игра обработает ввод (несколько кадров игрового времени)
    async frames(sec = 0.4) {
      const t0 = await page.evaluate(() => window.dota3.game.time);
      await page.waitForFunction((t) => window.dota3.state !== 'play' || window.dota3.game.time > t, t0 + sec, { timeout: 15000 });
    },
  };
  t.joy = { x: 110, y: 290 };
  t.q = await t.center('#abQ');
  await t.frames(1); // прогрев: первые кадры после загрузки самые медленные
  return t;
}

const clean = (s) => !s.joy && s.moveX === 0 && s.moveZ === 0 && !s.aiming && !s.tip && !s.cancelShown
  && !s.tipShown && !s.joyShown && s.held.length === 0 && !s.cancelHover;

const tests = [];
const ONLY = process.env.ONLY; // запустить только проверки, в названии которых есть эта строка
const test = (name, fn) => tests.push({ name, fn });
function check(cond, msg, data) { if (!cond) throw new Error(msg + (data ? ` ${JSON.stringify(data)}` : '')); }

// --- обычное поведение ---------------------------------------------------------------
test('тап по умению применяет его', async (t) => {
  await t.touch('touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]);
  await t.touch('touchEnd', []); // за pointerup штатно приходит lostpointercapture
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0, 'умение не применилось', s);
  check(clean(s), 'остались следы жеста', s);
});

test('ручной прицел применяет умение с направлением', async (t) => {
  await t.page.evaluate(() => { window.mc = 0; window.dota3.game.on('manualcast', () => window.mc++); });
  await t.touch('touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]);
  await t.touch('touchMove', [{ x: t.q.x - 40, y: t.q.y - 10, id: 1 }]);
  await t.touch('touchMove', [{ x: t.q.x - 80, y: t.q.y - 10, id: 1 }]);
  const mid = await t.snap();
  check(mid.aiming && mid.cancelShown, 'прицел не появился', mid);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0 && (await t.page.evaluate(() => window.mc)) === 1, 'прицельное применение не прошло', s);
  check(clean(s), 'остались следы жеста', s);
});

test('увод на «Отмена» отменяет умение', async (t) => {
  await t.touch('touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]);
  await t.touch('touchMove', [{ x: t.q.x - 40, y: t.q.y, id: 1 }]);
  const c = await t.center('#aimCancel');
  await t.touch('touchMove', [{ x: c.x, y: c.y, id: 1 }]);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ === 0 && s.casts === 0, 'умение применилось после отмены', s);
  check(clean(s), 'остались следы жеста', s);
});

test('долгое удержание показывает описание и не применяет умение', async (t) => {
  await t.touch('touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]);
  await t.page.waitForTimeout(800);
  const mid = await t.snap();
  check(mid.tip === 'Q' && mid.tipShown, 'описание не показалось', mid);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ === 0 && s.casts === 0 && s.rankQ === 0, 'умение применилось после описания', s);
  check(clean(s), 'остались следы жеста', s);
});

test('движение джойстиком вместе с умением', async (t) => {
  await t.touch('touchStart', [{ ...t.joy, id: 1 }]);
  await t.touch('touchMove', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }]);
  await t.touch('touchStart', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: t.q.x, y: t.q.y, id: 2 }]);
  await t.touch('touchEnd', [{ x: t.q.x, y: t.q.y, id: 2 }]);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0, 'умение не применилось во время движения', s);
  check(s.joy && s.moveX > 0.5, 'джойстик сбросился от второго пальца', s);
  await t.touch('touchEnd', []);
  const e = await t.snap();
  check(clean(e), 'джойстик не вернулся в нейтраль', e);
});

test('второй палец на той же кнопке не перехватывает жест', async (t) => {
  await t.touch('touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]);
  await t.touch('touchMove', [{ x: t.q.x - 60, y: t.q.y, id: 1 }]);
  await t.touch('touchStart', [{ x: t.q.x - 60, y: t.q.y, id: 1 }, { x: t.q.x + 5, y: t.q.y + 5, id: 2 }]);
  await t.touch('touchEnd', [{ x: t.q.x + 5, y: t.q.y + 5, id: 2 }]);
  const mid = await t.snap();
  check(mid.aiming && mid.casts === 0 && mid.cdQ === 0, 'чужой палец завершил жест', mid);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0, 'первый жест не завершился применением', s);
  check(clean(s), 'остались следы жеста', s);
});

test('второй палец в зоне джойстика не сбрасывает его', async (t) => {
  await t.touch('touchStart', [{ ...t.joy, id: 1 }]);
  await t.touch('touchMove', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }]);
  await t.touch('touchStart', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: 200, y: 200, id: 2 }]);
  await t.touch('touchEnd', [{ x: 200, y: 200, id: 2 }]);
  const s = await t.snap();
  check(s.joy && s.moveX > 0.5, 'чужой палец сбросил джойстик', s);
  await t.touch('touchEnd', []);
});

// --- прерывания ----------------------------------------------------------------------
const INTERRUPTS = {
  'потеря фокуса окна': async (t) => { await t.page.evaluate(() => window.dispatchEvent(new Event('blur'))); },
  'скрытие страницы': async (t) => {
    await t.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
    });
  },
  'пауза': async (t) => {
    await t.page.evaluate(() => document.querySelector('.pause-btn').click());
    await t.page.waitForFunction(() => window.dota3.state === 'pause');
  },
  'выход в меню и новый матч': async (t) => {
    await t.page.evaluate(() => document.querySelector('.pause-btn').click());
    await t.page.waitForFunction(() => window.dota3.state === 'pause');
    await t.page.evaluate(() => document.getElementById('quitBtn').click());
  },
  'потеря захвата указателя': async (t) => {
    await t.page.evaluate(() => {
      for (const [id, el] of window.pointerTargets) { try { el.releasePointerCapture(id); } catch { /* уже отпущен */ } }
    });
    // браузер присылает lostpointercapture при следующем событии этого указателя
    await t.touch('touchMove', [{ x: t.joy.x + 62, y: t.joy.y, id: 1 }, { x: t.q.x - 62, y: t.q.y, id: 2 }]);
  },
  'отмена касания системой': async (t) => {
    await t.touch('touchCancel', []);
  },
};

for (const [name, interrupt] of Object.entries(INTERRUPTS)) {
  test(`прерывание: ${name}`, async (t) => {
    await t.page.evaluate(() => {
      window.pointerTargets = new Map();
      document.addEventListener('pointerdown', (e) => window.pointerTargets.set(e.pointerId, e.target.closest('#joyZone, .act') ?? e.target), true);
    });
    await t.touch('touchStart', [{ ...t.joy, id: 1 }]);
    await t.touch('touchMove', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }]);
    await t.touch('touchStart', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: t.q.x, y: t.q.y, id: 2 }]);
    await t.touch('touchMove', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: t.q.x - 60, y: t.q.y, id: 2 }]);
    const before = await t.snap();
    check(before.joy && before.aiming, 'жест не начался', before);
    await interrupt(t);
    const after = await t.snap();
    check(clean(after), 'после прерывания остался ввод', after);
    await t.page.waitForTimeout(700); // таймер описания не должен сработать позже
    const later = await t.snap();
    check(!later.tip && !later.tipShown, 'таймер удержания сработал после прерывания', later);
    if (name !== 'отмена касания системой') await t.touch('touchEnd', []);
    // вернуться в матч, если прерывание его остановило
    await t.page.evaluate(() => {
      if (window.dota3.state === 'pause') document.getElementById('resumeBtn').click();
      if (window.dota3.state === 'menu') document.getElementById('playBtn').click();
    });
    await t.page.waitForFunction(() => window.dota3.state === 'play');
    await t.frames();
    const res = await t.snap();
    check(res.cdQ === 0 && res.casts === 0, 'прерванное умение применилось', res);
    check(clean(res), 'после возвращения остались следы ввода', res);
    // джойстик принимает новое касание
    await t.touch('touchStart', [{ ...t.joy, id: 3 }]);
    await t.touch('touchMove', [{ x: t.joy.x + 60, y: t.joy.y, id: 3 }]);
    const again = await t.snap();
    check(again.joy && again.moveX > 0.5, 'джойстик не принимает новое касание', again);
    await t.touch('touchEnd', []);
    check(clean(await t.snap()), 'джойстик не вернулся в нейтраль');
  });
}

for (const name of ['потеря фокуса окна', 'пауза']) {
  test(`прерывание неподвижного удержания до описания: ${name}`, async (t) => {
    await t.touch('touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]);
    const before = await t.snap();
    check(before.held.includes('abQ') && !before.tip, 'удержание не началось', before);
    await INTERRUPTS[name](t);
    await t.page.waitForTimeout(800); // дольше задержки описания
    const s = await t.snap();
    check(!s.tip && !s.tipShown && !s.held.length, 'таймер описания сработал после прерывания', s);
    await t.touch('touchEnd', []);
    await t.page.evaluate(() => { if (window.dota3.state === 'pause') document.getElementById('resumeBtn').click(); });
    await t.page.waitForFunction(() => window.dota3.state === 'play');
    await t.frames();
    const res = await t.snap();
    check(res.cdQ === 0 && res.casts === 0 && clean(res), 'прерванное удержание применило умение', res);
  });
}

// --- действия вне матча ---------------------------------------------------------------
test('клавиши, нажатые на паузе, не срабатывают после возвращения', async (t) => {
  await t.page.keyboard.press('Escape');
  await t.page.waitForFunction(() => window.dota3.state === 'pause');
  for (const k of ['KeyQ', 'KeyB', 'KeyT', 'Escape', 'Digit5']) await t.page.keyboard.press(k);
  await t.page.evaluate(() => document.getElementById('resumeBtn').click());
  await t.frames(0.6);
  const s = await t.snap();
  check(s.state === 'play', 'игра снова встала на паузу', s);
  check(s.cdQ === 0 && !s.recall && s.casts === 0 && s.actions === 0, 'действие с паузы выполнилось', s);
});

test('клавиши, нажатые в меню, не срабатывают в новом матче', async (t) => {
  await t.page.evaluate(() => document.querySelector('.pause-btn').click());
  await t.page.waitForFunction(() => window.dota3.state === 'pause');
  await t.page.evaluate(() => document.getElementById('quitBtn').click());
  await t.page.waitForFunction(() => window.dota3.state === 'menu');
  for (const k of ['KeyQ', 'KeyB', 'Escape']) await t.page.keyboard.press(k);
  await t.page.keyboard.down('KeyD');
  await t.page.evaluate(() => document.getElementById('playBtn').click());
  await t.page.waitForFunction(() => window.dota3.state === 'play');
  await t.frames(0.6);
  const s = await t.snap();
  await t.page.keyboard.up('KeyD');
  check(s.state === 'play' && s.cdQ === 0 && !s.recall && s.casts === 0, 'действие из меню выполнилось', s);
  check(s.keys === 0, 'клавиша из меню осталась зажатой в матче', s);
});

test('зажатая клавиша не залипает после скрытия страницы', async (t) => {
  await t.page.keyboard.down('KeyD');
  await t.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await t.page.evaluate(() => document.getElementById('resumeBtn').click());
  await t.frames();
  const s = await t.snap();
  await t.page.keyboard.up('KeyD');
  check(s.keys === 0, 'клавиша залипла после скрытия страницы', s);
});

// --- запуск -------------------------------------------------------------------------
let failed = 0;
for (const { name, fn } of tests.filter((x) => !ONLY || x.name.includes(ONLY))) {
  const t = await boot();
  try {
    await fn(t);
    if (t.errors.length) throw new Error('ошибки на странице: ' + t.errors.join('; '));
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  } finally {
    await t.ctx.close();
  }
}
await browser.close();
server.close();
const total = tests.filter((x) => !ONLY || x.name.includes(ONLY)).length;
console.log(`\n${total - failed} из ${total} проверок пройдено`);
process.exit(failed ? 1 : 0);
