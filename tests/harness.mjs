// Общая обвязка проверок: статический сервер, Chromium, открытие матча, касания, прогон.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

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

// Открывает игру в мобильном горизонтальном окне и запускает матч.
// start — id кнопки меню: 'playBtn' (матч 1 на 1) или 'practiceBtn' (тренировка с манекенами).
export async function openGame({ start = 'playBtn' } = {}) {
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
  await page.evaluate((id) => document.getElementById(id).click(), start);
  await page.waitForFunction(() => window.dota3.state === 'play');
  const cdp = await ctx.newCDPSession(page);
  return {
    page, ctx, errors,
    touch: (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }),
    // Пакет касаний без ожидания ответа на каждое. Ожидание ответа раздвигает события на длину
    // кадра (браузер выдаёт движения к следующему кадру), и быстрый жест превращается в долгий.
    burst: (steps) => Promise.all(steps.map(([type, pts]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }))),
    async center(sel) {
      const b = await page.locator(sel).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    // ждём, пока игра обработает ввод (несколько кадров игрового времени)
    async frames(sec = 0.4) {
      const t0 = await page.evaluate(() => window.dota3.game.time);
      await page.waitForFunction((t) => window.dota3.state !== 'play' || window.dota3.game.time > t, t0 + sec, { timeout: 15000 });
    },
  };
}

export function check(cond, msg, data) { if (!cond) throw new Error(msg + (data ? ` ${JSON.stringify(data)}` : '')); }

// Прогон проверок; ONLY=строка — только проверки, в названии которых она есть
export async function run(tests, boot) {
  const ONLY = process.env.ONLY;
  const list = tests.filter((x) => !ONLY || x.name.includes(ONLY));
  let failed = 0;
  for (const { name, fn, ...rest } of list) {
    const t = await boot({ name, fn, ...rest });
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
  console.log(`\n${list.length - failed} из ${list.length} проверок пройдено`);
  process.exit(failed ? 1 : 0);
}
