// Проверки управления на настоящих касаниях (Chrome DevTools Protocol, мультитач).
// Запуск: npm run test:input   (нужны пакет playwright и браузер Chromium)
import { openGame, check, run } from './harness.mjs';

// --- помощники ---------------------------------------------------------------------
async function boot() {
  const t = await openGame();
  const { page } = t;
  Object.assign(t, {
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
        cdW: window.dota3.game.player.cd.W, cdE: window.dota3.game.player.cd.E,
        filter: i.filter, casted: { ...window.castLog }, manual: window.manualLog,
        recall: !!window.dota3.game.player.recall,
      };
    }),
  });
  t.joy = { x: 110, y: 290 };
  t.q = await t.center('#abQ');
  t.w = await t.center('#abW');
  t.e = await t.center('#abE');
  t.atk = await t.center('#atkBtn');
  t.creep = await t.center('#atkCreep');
  t.tower = await t.center('#atkTower');
  // журнал применений: какие умения сработали и сколько раз прицельно
  await page.evaluate(() => {
    window.castLog = {};
    window.manualLog = 0;
    const g = window.dota3.game;
    g.on('cast', ({ hero, key }) => { if (hero === g.player) window.castLog[key] = (window.castLog[key] ?? 0) + 1; });
    g.on('manualcast', () => { window.manualLog++; });
    g.player.points = 4; // чтобы можно было изучить и Q, и W, и E
  });
  await t.frames(1); // прогрев: первые кадры после загрузки самые медленные
  return t;
}

const clean = (s) => !s.joy && s.moveX === 0 && s.moveZ === 0 && !s.aiming && !s.tip && !s.cancelShown
  && !s.tipShown && !s.joyShown && s.held.length === 0 && !s.cancelHover;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// --- обычное поведение ---------------------------------------------------------------
test('тап по умению применяет его', async (t) => {
  // за pointerup штатно приходит lostpointercapture
  await t.burst([['touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]], ['touchEnd', []]]);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0, 'умение не применилось', s);
  check(clean(s), 'остались следы жеста', s);
});

test('ручной прицел применяет умение с направлением', async (t) => {
  await t.page.evaluate(() => { window.mc = 0; window.dota3.game.on('manualcast', () => window.mc++); });
  await t.burst([
    ['touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]],
    ['touchMove', [{ x: t.q.x - 40, y: t.q.y - 10, id: 1 }]],
    ['touchMove', [{ x: t.q.x - 80, y: t.q.y - 10, id: 1 }]],
  ]);
  const mid = await t.snap();
  check(mid.aiming && mid.cancelShown, 'прицел не появился', mid);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0 && (await t.page.evaluate(() => window.mc)) === 1, 'прицельное применение не прошло', s);
  check(clean(s), 'остались следы жеста', s);
});

test('увод на «Отмена» отменяет умение', async (t) => {
  await t.burst([['touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]], ['touchMove', [{ x: t.q.x - 40, y: t.q.y, id: 1 }]]]);
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
  await t.burst([
    ['touchStart', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: t.q.x, y: t.q.y, id: 2 }]],
    ['touchEnd', [{ x: t.q.x, y: t.q.y, id: 2 }]],
  ]);
  await t.frames();
  const s = await t.snap();
  check(s.cdQ > 0, 'умение не применилось во время движения', s);
  check(s.joy && s.moveX > 0.5, 'джойстик сбросился от второго пальца', s);
  await t.touch('touchEnd', []);
  const e = await t.snap();
  check(clean(e), 'джойстик не вернулся в нейтраль', e);
});

test('второй палец на той же кнопке не перехватывает жест', async (t) => {
  await t.burst([['touchStart', [{ x: t.q.x, y: t.q.y, id: 1 }]], ['touchMove', [{ x: t.q.x - 60, y: t.q.y, id: 1 }]]]);
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
    await t.burst([
      ['touchStart', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: t.q.x, y: t.q.y, id: 2 }]],
      ['touchMove', [{ x: t.joy.x + 60, y: t.joy.y, id: 1 }, { x: t.q.x - 60, y: t.q.y, id: 2 }]],
    ]);
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

// --- долгий кадр: событие случилось рано, а дошло после таймера удержания -------------
// Событие создаётся сразу (его timeStamp ранний), а отправляется через 600 мс — так браузер
// ведёт себя, когда кадр рисуется дольше порога удержания 450 мс.
async function lateGesture(t, kind) {
  await t.page.evaluate(async ([q, kind]) => {
    const btn = document.getElementById('abQ');
    const opts = (x, y) => ({ pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x, clientY: y });
    btn.dispatchEvent(new PointerEvent('pointerdown', opts(q.x, q.y)));
    const early = kind === 'drag'
      ? [new PointerEvent('pointermove', opts(q.x - 40, q.y - 5)), new PointerEvent('pointermove', opts(q.x - 80, q.y - 10))]
      : [];
    const up = new PointerEvent('pointerup', opts(kind === 'drag' ? q.x - 80 : q.x, kind === 'drag' ? q.y - 10 : q.y));
    await new Promise((r) => setTimeout(r, 600)); // таймер удержания уже сработал
    for (const e of early) btn.dispatchEvent(e);
    btn.dispatchEvent(up);
  }, [t.q, kind]);
  await t.frames();
  return t.snap();
}

test('долгий кадр: ранний свайп остаётся прицелом', async (t) => {
  const s = await lateGesture(t, 'drag');
  check(s.casted.Q === 1 && s.manual === 1, 'свайп, случившийся до порога, принят за удержание', s);
  check(clean(s), 'остались следы жеста', s);
});

test('долгий кадр: ранний тап остаётся тапом', async (t) => {
  const s = await lateGesture(t, 'tap');
  check(s.casted.Q === 1 && s.manual === 0, 'тап, случившийся до порога, принят за удержание', s);
  check(clean(s), 'остались следы жеста', s);
});

// --- мультитач: кто владеет жестом ------------------------------------------------------
const P = (pt, id) => ({ x: pt.x, y: pt.y, id });
const off = (pt, dx, dy = 0) => ({ x: pt.x + dx, y: pt.y + dy });

// E у Пиро — умение на себя, W — направленное (круг): проверяем оба вида второго пальца
for (const second of ['E', 'W']) {
  for (const order of ['сначала Q', `сначала ${second}`]) {
    test(`прицел Q + второй палец на ${second}, отпускание: ${order}`, async (t) => {
      const other = second === 'E' ? t.e : t.w;
      const qAim = off(t.q, -70, -10);
      await t.burst([['touchStart', [P(t.q, 1)]], ['touchMove', [P(off(t.q, -35, -5), 1)]], ['touchMove', [P(qAim, 1)]]]);
      await t.burst([['touchStart', [P(qAim, 1), P(other, 2)]], ['touchMove', [P(qAim, 1), P(off(other, 0, -40), 2)]]]);
      const mid = await t.snap();
      check(mid.aiming && !mid.held.includes('ab' + second), 'второе умение вмешалось в прицел Q', mid);
      if (order === 'сначала Q') {
        await t.touch('touchEnd', [P(qAim, 1)]);
        await t.touch('touchEnd', []);
      } else {
        await t.touch('touchEnd', [P(off(other, 0, -40), 2)]);
        const after = await t.snap();
        check(after.aiming && after.casts === 0, `отпускание ${second} сломало прицел Q`, after);
        await t.touch('touchEnd', []);
      }
      await t.frames();
      const s = await t.snap();
      check(s.casted.Q === 1 && s.manual === 1 && !s.casted[second], 'применилось не то: ожидался один прицельный Q', s);
      check(clean(s), 'остались следы жеста', s);
    });
  }
}

test('описание по удержанию + нажатие другого умения', async (t) => {
  await t.touch('touchStart', [P(t.q, 1)]);
  await t.page.waitForTimeout(800);
  const tip = await t.snap();
  check(tip.tip === 'Q' && tip.tipShown, 'описание не показалось', tip);
  await t.touch('touchStart', [P(t.q, 1), P(t.w, 2)]);
  await t.page.waitForTimeout(800);
  const mid = await t.snap();
  check(mid.tip === 'Q' && !mid.aiming && !mid.held.includes('abW'), 'второе умение вмешалось в описание', mid);
  await t.touch('touchEnd', [P(t.w, 2)]);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(!s.casted.Q && !s.casted.W && s.casts === 0, 'применилось умение', s);
  check(clean(s), 'остались следы жеста', s);
});

test('умение на себя поверх прицела: E во время прицела Q', async (t) => {
  const qAim = off(t.q, -70);
  await t.burst([['touchStart', [P(t.q, 1)]], ['touchMove', [P(off(t.q, -35), 1)]], ['touchMove', [P(qAim, 1)]]]);
  await t.burst([['touchStart', [P(qAim, 1), P(t.e, 2)]], ['touchEnd', [P(t.e, 2)]]]);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.casted.Q === 1 && s.manual === 1 && !s.casted.E, 'ожидался только прицельный Q', s);
  check(clean(s), 'остались следы жеста', s);
});

test('прицел поверх умения на себя: Q во время удержания E', async (t) => {
  await t.burst([
    ['touchStart', [P(t.e, 1)]],
    ['touchStart', [P(t.e, 1), P(t.q, 2)]],
    ['touchMove', [P(t.e, 1), P(off(t.q, -70), 2)]],
  ]);
  const mid = await t.snap();
  check(!mid.aiming && !mid.cancelShown && !mid.held.includes('abQ'), 'прицел Q перехватил жест E', mid);
  // палец на E отпускается быстро, чтобы это был тап, а не удержание для описания
  await t.burst([['touchEnd', [P(off(t.q, -70), 2)]], ['touchEnd', []]]);
  await t.frames();
  const s = await t.snap();
  check(s.casted.E === 1 && !s.casted.Q, 'ожидался только E', s);
  check(clean(s), 'остались следы жеста', s);
});

for (const order of ['сначала «Крип»', 'сначала «Атака»']) {
  test(`две кнопки атаки, отпускание: ${order}`, async (t) => {
    await t.touch('touchStart', [P(t.atk, 1)]);
    await t.touch('touchStart', [P(t.atk, 1), P(t.creep, 2)]);
    const both = await t.snap();
    check(both.attack && both.filter === 'creep', 'последняя нажатая кнопка не задаёт цель', both);
    if (order === 'сначала «Крип»') {
      await t.touch('touchEnd', [P(t.creep, 2)]);
      const one = await t.snap();
      check(one.attack && one.filter === null, 'после отпускания «Крип» не вернулась обычная атака', one);
    } else {
      await t.touch('touchEnd', [P(t.atk, 1)]);
      const one = await t.snap();
      check(one.attack && one.filter === 'creep', 'отпускание «Атака» остановило «Крип»', one);
    }
    await t.touch('touchEnd', []);
    const s = await t.snap();
    check(!s.attack && s.filter === null && clean(s), 'атака не остановилась', s);
  });
}

test('три кнопки атаки: возврат к предыдущей ещё зажатой', async (t) => {
  await t.touch('touchStart', [P(t.atk, 1)]);
  await t.touch('touchStart', [P(t.atk, 1), P(t.creep, 2)]);
  await t.touch('touchStart', [P(t.atk, 1), P(t.creep, 2), P(t.tower, 3)]);
  const a = await t.snap();
  check(a.filter === 'tower', 'последняя кнопка не задала цель', a);
  await t.touch('touchEnd', [P(t.creep, 2)]); // отпускаем среднюю
  const b = await t.snap();
  check(b.attack && b.filter === 'tower', 'отпускание средней кнопки сменило цель', b);
  await t.touch('touchEnd', [P(t.tower, 3)]);
  const c = await t.snap();
  check(c.attack && c.filter === null, 'не вернулась обычная атака', c);
  await t.touch('touchEnd', []);
  check(!(await t.snap()).attack, 'атака не остановилась');
});

test('сброс во время мультитача, затем новый ввод', async (t) => {
  const qAim = off(t.q, -70);
  await t.touch('touchStart', [P(t.joy, 1)]);
  await t.touch('touchMove', [P(off(t.joy, 60), 1)]);
  await t.burst([
    ['touchStart', [P(off(t.joy, 60), 1), P(t.q, 2)]],
    ['touchMove', [P(off(t.joy, 60), 1), P(off(t.q, -35), 2)]],
    ['touchMove', [P(off(t.joy, 60), 1), P(qAim, 2)]],
  ]);
  await t.touch('touchStart', [P(off(t.joy, 60), 1), P(qAim, 2), P(t.e, 3)]);
  await t.touch('touchStart', [P(off(t.joy, 60), 1), P(qAim, 2), P(t.e, 3), P(t.atk, 4)]);
  await t.touch('touchStart', [P(off(t.joy, 60), 1), P(qAim, 2), P(t.e, 3), P(t.atk, 4), P(t.creep, 5)]);
  await t.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const r = await t.snap();
  check(clean(r) && !r.attack && r.filter === null, 'сброс оставил ввод', r);
  await t.touch('touchEnd', []);
  await t.frames();
  const after = await t.snap();
  check(!after.casted.Q && !after.casted.E && after.casts === 0, 'после сброса применилось умение', after);
  // новый ввод работает
  await t.burst([['touchStart', [P(t.e, 6)]], ['touchEnd', []]]);
  await t.touch('touchStart', [P(t.creep, 7)]);
  const atk = await t.snap();
  check(atk.attack && atk.filter === 'creep', 'кнопка атаки не работает после сброса', atk);
  await t.touch('touchEnd', []);
  await t.frames();
  const s = await t.snap();
  check(s.casted.E === 1 && !s.attack && clean(s), 'новое касание не сработало', s);
});

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
await run(tests, boot);
