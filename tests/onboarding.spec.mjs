// Первое знакомство: меню без прокрутки, обучение с подсказками, переход к первому матчу.
// Запуск: npm run test:onboarding   (нужны пакет playwright и браузер Chromium)
import { openGame, check, run } from './harness.mjs';

// Шрифты Google не грузятся: всё проверяется на системных шрифтах
const blockFonts = (ctx) => ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const VIEWPORTS = [[667, 375], [844, 390], [915, 412]];
const RETURNING = {
  settings: { hero: 'lira', mode: '3v3', difficulty: 'hard', talent: 'wisdom', spells: ['heal', 'barrier'] },
  profile: { tutorialDone: true, games: 5, wins: 3, crystals: 140 },
};

async function boot(test) {
  const t = await openGame({
    start: null,
    viewport: test.viewport,
    settings: { mode: '3v3', ...test.settings },
    profile: test.profile,
    contextOptions: test.contextOptions,
    setup: async (ctx) => {
      await blockFonts(ctx);
      if (test.init) await ctx.addInitScript(test.init);
    },
  });
  t.tap = (pt) => t.burst([['touchStart', [{ ...pt, id: 9 }]], ['touchEnd', []]]);
  t.rect = (sel) => t.page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight };
  }, sel);
  t.step = () => t.page.evaluate(() => window.dota3.tutorial?.step ?? null);
  return t;
}

const tests = [];
const test = (name, fn, extra) => tests.push({ name, fn, ...extra });
const inView = (r) => r && r.top >= 0 && r.left >= 0 && r.bottom <= r.h && r.right <= r.w;

// --- меню -------------------------------------------------------------------------------
for (const [width, height] of VIEWPORTS) {
  for (const who of ['new', 'returning']) {
    test(`меню ${width}×${height}, ${who === 'new' ? 'новый' : 'вернувшийся'} игрок: герой и «Играть» видны без прокрутки`, async (t) => {
      const { page } = t;
      for (const sel of ['#heroCards', '#playBtn', '#tutorialBtn', '.menu-main .seg', '#matchSetup > summary']) {
        check(inView(await t.rect(sel)), `${sel} вне экрана`, await t.rect(sel));
      }
      const m = await page.evaluate(() => ({
        recommended: document.getElementById('tutorialBtn').classList.contains('recommended'),
        reward: !document.getElementById('tutorialReward').hidden,
        scrolled: document.getElementById('menu').scrollTop,
        hero: document.querySelector('input[name="hero"]:checked')?.value,
        mode: document.querySelector('input[name="mode"]:checked')?.value,
        diff: document.querySelector('input[name="diff"]:checked')?.value,
        talent: document.querySelector('input[name="talent"]:checked')?.value,
        spells: [...document.querySelectorAll('#spellPick input:checked')].map((b) => b.value).sort(),
        summary: document.getElementById('setupSummary').textContent,
        setupOpen: document.getElementById('matchSetup').open,
        // текст не обрезан и не вылезает из кнопок и карточек на системных шрифтах
        clipped: [...document.querySelectorAll('#menu button, #menu .hero-card b, #menu .hero-card i, #menu .seg span, #menu summary')]
          .filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.id || e.textContent.trim()),
      }));
      check(m.scrolled === 0 && !m.setupOpen, 'меню должно открываться сверху со свёрнутой настройкой', m);
      check(!m.clipped.length, 'текст обрезан', m);
      if (who === 'new') {
        check(m.recommended && m.reward, 'новичку обучение должно быть выделено и с наградой', m);
        check(m.summary.includes('Натиск') && m.summary.includes('Нормально'), 'в сводке — значения по умолчанию', m);
      } else {
        check(!m.recommended && !m.reward, 'вернувшемуся игроку обучение не навязывается', m);
        check(m.hero === 'lira' && m.mode === '3v3' && m.diff === 'hard' && m.talent === 'wisdom' && m.spells.join() === 'barrier,heal',
          'сохранённые настройки должны остаться', m);
        check(m.summary.includes('Мудрость') && m.summary.includes('Сложно') && m.summary.includes('Исцеление'), 'сводка показывает сохранённое', m);
      }
      // выбор героя касанием и запуск матча кнопкой «Играть»
      await t.tap(await t.center('label:has(#hero-grok) .hero-card'));
      await t.tap(await t.center('#playBtn'));
      await page.waitForFunction(() => window.dota3.state === 'play');
      const g = await page.evaluate(() => ({ hero: window.dota3.game.player.heroId, mode: window.dota3.game.mode }));
      check(g.hero === 'grok' && g.mode === '3v3', 'матч должен начаться выбранным героем', g);
    }, { viewport: { width, height }, ...(who === 'returning' ? RETURNING : {}) });
  }
}

test('настройка матча раскрывается, прокручивается и сохраняет выбор', async (t) => {
  const { page } = t;
  await t.tap(await t.center('#matchSetup > summary'));
  await page.waitForFunction(() => document.getElementById('matchSetup').open);
  // последняя строка блока достижима прокруткой меню
  await page.evaluate(() => document.getElementById('diffHard').closest('label').scrollIntoView({ block: 'end' }));
  const r = await t.rect('label:has(#diffHard)');
  const scrolled = await page.evaluate(() => document.getElementById('menu').scrollTop);
  check(inView(r) && scrolled > 0, 'сложность должна быть видна после прокрутки', { r, scrolled });
  await t.tap(await t.center('label:has(#diffHard) span'));
  await t.tap(await t.center('label:has(#talent-fortitude) span'));
  await t.tap(await t.center('label:has(#spell-heal) span'));
  const s = await page.evaluate(() => ({ summary: document.getElementById('setupSummary').textContent }));
  check(s.summary.includes('Сложно') && s.summary.includes('Стойкость') && s.summary.includes('Исцеление'), 'сводка должна обновиться', s);
  await page.evaluate(() => document.getElementById('playBtn').scrollIntoView());
  await t.tap(await t.center('#playBtn'));
  await page.waitForFunction(() => window.dota3.state === 'play');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dota3-settings')));
  check(saved.difficulty === 'hard' && saved.talent === 'fortitude' && saved.spells.includes('heal'), 'выбор должен сохраниться', saved);
}, { viewport: { width: 667, height: 375 } });

test('меню проходится клавиатурой', async (t) => {
  const { page } = t;
  const order = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => { const e = document.activeElement; return e.name || e.id || e.tagName.toLowerCase(); }));
  }
  const at = (x) => order.indexOf(x);
  check(at('hero') >= 0 && at('hero') < at('mode') && at('mode') < at('playBtn') && at('playBtn') < at('tutorialBtn')
    && at('tutorialBtn') < at('practiceBtn') && at('profileBtn') < at('settingsBtn') && at('settingsBtn') < at('summary'), 'порядок фокуса', order);
  // стрелки меняют героя, Enter раскрывает настройку
  await page.focus('input[name="hero"]:checked');
  await page.keyboard.press('ArrowRight');
  const hero = await page.evaluate(() => document.querySelector('input[name="hero"]:checked').value);
  check(hero === 'grok', 'стрелка должна выбрать следующего героя', hero);
  await page.focus('#matchSetup > summary');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.getElementById('matchSetup').open), 'Enter должен раскрыть настройку');
  await page.focus('#playBtn');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.dota3.state === 'play');
}, { viewport: { width: 667, height: 375 } });

// --- обучение настоящим вводом -------------------------------------------------------
async function waitStep(t, n, timeout = 30000) {
  await t.page.waitForFunction((n) => (window.dota3.tutorial?.step ?? -1) >= n, n, { timeout });
}

// Джойстиком к метке: направление пересчитывается по ходу, у препятствий — обход вбок
async function walkToGoal(t) {
  const { page } = t;
  const base = { x: 150, y: 260 };
  await t.touch('touchStart', [{ ...base, id: 3 }]);
  let last = null, stuck = 0;
  for (let i = 0; i < 200 && (await t.step()) === 2; i++) {
    const s = await page.evaluate(() => { const p = window.dota3.game.player; return { x: p.pos.x, z: p.pos.z }; });
    let dx = -3 - s.x, dz = 0 - s.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    if (last && Math.hypot(s.x - last.x, s.z - last.z) < 0.05) stuck = 6;
    if (stuck > 0) { stuck--; [dx, dz] = [dx * 0.5 - dz * 0.87, dz * 0.5 + dx * 0.87]; }
    last = s;
    // мир: +x — вправо, +z — вниз по экрану
    await t.touch('touchMove', [{ x: base.x + dx * 70, y: base.y + dz * 70, id: 3 }]);
    await page.waitForTimeout(120);
  }
  await t.touch('touchEnd', []);
}

test('обучение целиком настоящим вводом, затем «Начать матч 1 на 1»', async (t) => {
  const { page } = t;
  // выбран не первый герой: матч после обучения должен начаться им же
  await page.evaluate(() => { document.getElementById('hero-lira').checked = true; });
  await t.tap(await t.center('#tutorialBtn'));
  await page.waitForFunction(() => window.dota3.state === 'play' && window.dota3.tutorial);
  const focusOf = () => page.evaluate(() => [...document.querySelectorAll('.tut-focus')].map((e) => e.id));

  check((await focusOf()).join() === 'rankQ', 'шаг 1: подсвечен «+» над Q', await focusOf());
  await t.tap(await t.center('#rankQ'));
  await waitStep(t, 1);
  check((await focusOf()).join() === 'quickBtn', 'шаг 2: подсвечена кнопка покупки, старая подсветка снята', await focusOf());
  await t.tap(await t.center('#quickBtn'));
  await waitStep(t, 2);

  // шаг 3: метка у манекенов, стрелка у героя и направление в подсказке (метка за экраном)
  await page.waitForFunction(() => !document.getElementById('tutDir').hidden);
  const goal = await page.evaluate(() => {
    const tu = window.dota3.tutorial;
    return { mark: !!tu.goal?.mark.parent, arrow: !!tu.goal?.arrow.parent, dir: !document.getElementById('tutDir').hidden, focus: document.querySelectorAll('.tut-focus').length };
  });
  check(goal.mark && goal.arrow && goal.dir && goal.focus === 0, 'шаг 3: метка, стрелка и направление; кнопки не подсвечены', goal);
  await walkToGoal(t);
  await waitStep(t, 3);
  check(await page.evaluate(() => !window.dota3.tutorial.goal && document.getElementById('tutDir').hidden), 'метка и направление должны исчезнуть сразу');

  check((await focusOf()).join() === 'atkBtn', 'шаг 4: подсвечена «Атака»', await focusOf());
  await t.touch('touchStart', [{ ...(await t.center('#atkBtn')), id: 4 }]);
  await waitStep(t, 4);
  await t.touch('touchEnd', []);

  check((await focusOf()).join() === 'abQ', 'шаг 5: подсвечена Q', await focusOf());
  const tapText = await page.evaluate(() => document.querySelector('#tutorialBox span').textContent);
  check(/Коснитесь Q и сразу отпустите/.test(tapText), 'шаг 5: про касание', tapText);
  await t.tap(await t.center('#abQ'));
  await waitStep(t, 5);

  // шаг 6: пока Q перезаряжается, подсказка об этом говорит; перезарядку никто не сбрасывает
  await page.waitForFunction(() => /перезаряжается/.test(document.querySelector('#tutorialBox span').textContent), null, { timeout: 5000 });
  const aimText = await page.evaluate(() => ({ text: document.querySelector('#tutorialBox span').textContent, cd: window.dota3.game.player.cd.Q }));
  check(aimText.cd > 0, 'шаг 6: Q ещё на перезарядке — её никто не сбросил', aimText);
  await page.waitForFunction(() => window.dota3.game.player.cd.Q === 0, null, { timeout: 30000 });
  await page.waitForFunction(() => /потяните в сторону/.test(document.querySelector('#tutorialBox span').textContent));
  const q = await t.center('#abQ');
  await t.burst([
    ['touchStart', [{ ...q, id: 5 }]],
    ['touchMove', [{ x: q.x - 25, y: q.y - 10, id: 5 }]],
    ['touchMove', [{ x: q.x - 55, y: q.y - 20, id: 5 }]],
    ['touchMove', [{ x: q.x - 80, y: q.y - 30, id: 5 }]],
    ['touchEnd', []],
  ]);
  await waitStep(t, 6);

  const flashSel = await page.evaluate(() => (window.dota3.game.player.spells[0] === 'flash' ? '#abS1' : '#abS2'));
  check((await focusOf()).join() === flashSel.slice(1), 'шаг 7: подсвечена «Вспышка»', await focusOf());
  await t.tap(await t.center(flashSel));
  await waitStep(t, 7);

  check((await focusOf()).join() === 'recallBtn', 'шаг 8: подсвечено «Домой»', await focusOf());
  await t.tap(await t.center('#recallBtn'));
  await waitStep(t, 8);

  const done = await page.evaluate(() => ({
    title: document.querySelector('#tutorialBox b').textContent,
    buttons: !document.getElementById('tutDone').hidden,
    focus: document.querySelectorAll('.tut-focus').length,
    profile: JSON.parse(localStorage.getItem('dota3-profile')),
  }));
  check(done.buttons && /\+100/.test(done.title) && done.focus === 0, 'окно завершения с наградой и кнопками', done);
  check(done.profile.tutorialDone && done.profile.crystals === 100, 'награда начислена один раз', done.profile);

  await t.tap(await t.center('#tutMatchBtn'));
  await page.waitForFunction(() => window.dota3.state === 'play' && window.dota3.game.mode === '1v1');
  const m = await page.evaluate(() => ({
    hero: window.dota3.game.player.heroId, spells: window.dota3.game.player.spells, tutorial: window.dota3.tutorial,
    box: document.getElementById('tutorialBox').hidden, focus: document.querySelectorAll('.tut-focus').length,
    practice: document.getElementById('practicePanel').hidden,
    saved: JSON.parse(localStorage.getItem('dota3-settings')),
  }));
  check(m.hero === 'lira' && m.tutorial === null && m.box && m.focus === 0 && m.practice, 'матч 1 на 1 тем же героем, без следов обучения', m);
  check(m.saved.mode === '3v3' && m.saved.hero === 'lira', 'сохранённый режим не меняется на 1 на 1', m.saved);
  check(m.spells.join() === m.saved.spells.join(), 'в матче — сохранённые заклинания игрока', m);

  // после перезагрузки: настройки и награда на месте, обучение больше не навязывается
  await page.reload();
  await page.waitForFunction(() => window.dota3?.game);
  const r = await page.evaluate(() => ({
    mode: document.querySelector('input[name="mode"]:checked').value, hero: document.querySelector('input[name="hero"]:checked').value,
    recommended: document.getElementById('tutorialBtn').classList.contains('recommended'),
    gems: document.getElementById('menuGems').textContent,
  }));
  check(r.mode === '3v3' && r.hero === 'lira' && !r.recommended && r.gems === '100', 'после перезагрузки всё сохранено', r);
}, { viewport: { width: 844, height: 390 } });

// Быстрое прохождение для проверок вида: условия шагов выставляются напрямую, события — как от игры
async function fastStep(page, n) {
  await page.evaluate((n) => {
    const g = window.dota3.game, p = g.player, dummy = g.units.find((u) => u.kind === 'dummy');
    if (n === 0) { p.ranks.Q = 1; p.points = 0; }
    if (n === 1) g.buy(p, g.nextBuildStep(p).id);
    if (n === 2) { p.pos.x = -10; p.pos.z = 0; }
    if (n === 3) for (let i = 0; i < 3; i++) g.emit('damage', { source: p, target: dummy, amount: 1, dot: true });
    if (n === 4) g.emit('cast', { hero: p });
    if (n === 5) g.emit('manualcast');
    if (n === 6) g.emit('spell', { hero: p, id: 'flash' });
    if (n === 7) g.emit('recalled', p);
  }, n);
  await page.waitForFunction((n) => window.dota3.tutorial.step > n, n);
}

test('повторное обучение: награды второй раз нет', async (t) => {
  const { page } = t;
  await t.tap(await t.center('#tutorialBtn'));
  await page.waitForFunction(() => window.dota3.tutorial);
  for (let n = 0; n < 8; n++) await fastStep(page, n);
  const done = await page.evaluate(() => ({ title: document.querySelector('#tutorialBox b').textContent, profile: JSON.parse(localStorage.getItem('dota3-profile')) }));
  check(done.title === 'Обучение пройдено' && done.profile.crystals === 140, 'повтор без награды', done);
  // «Потренироваться ещё»: окно закрывается, открываются инструменты тренировки
  await t.tap(await t.center('#tutStayBtn'));
  const s = await page.evaluate(() => ({ box: document.getElementById('tutorialBox').hidden, panel: document.getElementById('practicePanel').hidden, state: window.dota3.state }));
  check(s.box && !s.panel && s.state === 'play', 'остаться в тренировке', s);
}, RETURNING);

// Подсказки не закрывают кнопки ни на одном экране и размере кнопок; касания проходят сквозь окно
for (const [width, height] of VIEWPORTS) {
  test(`подсказки обучения не закрывают кнопки на ${width}×${height}`, async (t) => {
    const { page } = t;
    const bad = [];
    for (const scale of [0.8, 1, 1.3]) {
      await page.evaluate(() => { if (window.dota3.state !== 'menu') return; });
      await page.evaluate((s) => { const r = document.getElementById('setButtons'); r.value = s; r.dispatchEvent(new Event('input')); }, scale);
      await page.evaluate(() => document.getElementById('tutorialBtn').click());
      await page.waitForFunction(() => window.dota3.state === 'play' && window.dota3.tutorial?.step === 0);
      for (let n = 0; n <= 8; n++) {
        await t.frames(0.2);
        const m = await page.evaluate(() => {
          const box = document.getElementById('tutorialBox').getBoundingClientRect();
          const hits = [...document.querySelectorAll('#hud .top > *, #actions .act, #actions .rank, #hud .utility > *')]
            .filter((e) => !e.hidden && e.offsetParent)
            .filter((e) => { const o = e.getBoundingClientRect(); return o.left < box.right && box.left < o.right && o.top < box.bottom && box.top < o.bottom; })
            .map((e) => e.id || e.className);
          const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
          const under = document.elementFromPoint(cx, cy);
          return {
            hits, out: box.left < 0 || box.right > innerWidth || box.top < 0,
            blocks: document.getElementById('tutorialBox').contains(under) && !under.closest('button'),
            overflow: [...document.querySelectorAll('#tutorialBox *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).length,
          };
        });
        if (m.hits.length || m.out || m.blocks || m.overflow) bad.push({ scale, step: n, ...m });
        if (n < 8) await fastStep(page, n);
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.dota3.state === 'pause');
      await page.evaluate(() => document.getElementById('quitBtn').click());
      await page.waitForFunction(() => window.dota3.state === 'menu');
    }
    check(!bad.length, 'окно подсказки задевает кнопки или перехватывает касания', bad.slice(0, 4));
  }, { viewport: { width, height } });
}

// --- прерывания ---------------------------------------------------------------------
function trackListeners() {
  const live = new Map();
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, ...r) { if (this.id === 'tutMatchBtn' || this.id === 'tutStayBtn') live.set(fn, this.id); return add.call(this, type, fn, ...r); };
  EventTarget.prototype.removeEventListener = function (type, fn, ...r) { live.delete(fn); return remove.call(this, type, fn, ...r); };
  window.tutListeners = () => live.size;
}

test('пауза, выход в меню и повторный запуск не оставляют подсказок, меток и обработчиков', async (t) => {
  const { page } = t;
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => document.getElementById('tutorialBtn').click());
    await page.waitForFunction(() => window.dota3.tutorial?.step === 0);
    await fastStep(page, 0);
    await fastStep(page, 1);
    // пауза посреди шага с меткой и возврат: подсказка та же, метка на месте
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.dota3.state === 'pause');
    await page.evaluate(() => document.getElementById('resumeBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'play');
    const mid = await page.evaluate(() => ({ step: window.dota3.tutorial.step, mark: !!window.dota3.tutorial.goal?.mark.parent }));
    check(mid.step === 2 && mid.mark, 'после паузы шаг и метка на месте', mid);
    await page.evaluate(() => { window.oldTut = window.dota3.tutorial; window.oldMark = window.dota3.tutorial.goal.mark; });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.dota3.state === 'pause');
    await page.evaluate(() => document.getElementById('quitBtn').click());
    await page.waitForFunction(() => window.dota3.state === 'menu');
    const after = await page.evaluate(() => ({
      tutorial: window.dota3.tutorial, box: document.getElementById('tutorialBox').hidden, dir: document.getElementById('tutDir').hidden,
      focus: document.querySelectorAll('.tut-focus').length, oldGoal: window.oldTut.goal, markParent: !!window.oldMark.parent,
      listeners: window.tutListeners(),
    }));
    check(after.tutorial === null && after.box && after.dir && after.focus === 0 && after.oldGoal === null && !after.markParent && after.listeners === 0,
      'после выхода в меню не должно остаться следов обучения', after);
  }
  // обычная тренировка после обучения — без подсказок
  await page.evaluate(() => document.getElementById('practiceBtn').click());
  await page.waitForFunction(() => window.dota3.state === 'play');
  const p = await page.evaluate(() => ({ box: document.getElementById('tutorialBox').hidden, panel: document.getElementById('practicePanel').hidden }));
  check(p.box && !p.panel, 'тренировка без подсказок обучения', p);
}, { init: trackListeners });

test('при «уменьшить движение» подсветка не пульсирует', async (t) => {
  const { page } = t;
  await page.evaluate(() => document.getElementById('tutorialBtn').click());
  await page.waitForFunction(() => window.dota3.tutorial);
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.tut-focus')).animationName);
  check(anim === 'none', 'анимация подсветки должна быть выключена', anim);
}, { contextOptions: { reducedMotion: 'reduce' } });

await run(tests, boot);
