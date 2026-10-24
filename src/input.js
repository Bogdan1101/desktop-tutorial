// Управление: плавающий джойстик слева, кнопки справа, клавиатура для компьютера.
// Умения: тап — автоприцел, перетаскивание — ручной прицел, увод пальца на «Отмена» — отмена.
//
// Каждое касание кнопки или джойстика — жест в общем реестре this.gestures.
// Жест завершается своим pointerup (действие применяется) или отменяется без применения:
// pointercancel, потеря захвата указателя, а также reset() — пауза, меню, скрытие страницы.
//
// Одновременно можно: двигаться, атаковать и вести один жест умения. Все умения и заклинания
// делят один слот 'ability': пока им владеет один палец, касания других кнопок умений
// игнорируются. Кнопки атаки складываются в стек: цель задаёт последняя ещё зажатая.

const AIM_DEADZONE = 14;   // пикселей до начала ручного прицела
const AIM_FULL = 95;       // пикселей до максимальной дальности
const TIP_DELAY = 450;     // мс удержания без движения до показа описания

export class Input {
  constructor() {
    this.move = { x: 0, z: 0 };
    this.attackHeld = false;
    this.filter = null;     // null | 'creep' | 'tower'
    this.casts = [];        // { key, aim? }
    this.actions = [];      // { type, key? }
    this.keys = new Set();
    this.joy = null;
    this.aiming = null;     // { key, dx, dz, mag, manual }
    this.tipKey = null;     // чьё описание показать (зажали кнопку и держат)
    this.cancelHover = false;
    this.aimModes = {};     // key -> 'line' | 'circle' | 'dash' | 'self'
    this.enabled = false;   // ввод принимается только во время матча
    this.gestures = new Map(); // слот -> активный жест: 'joystick', 'ability', 'hold:<кнопка>'
    this.attackStack = [];  // зажатые кнопки атаки в порядке нажатия: { name, filter }
    this.cancelEl = document.getElementById('aimCancel');
    this.bindJoystick();
    this.bindButtons();
    this.bindKeys();
    addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  setAimModes(modes) { this.aimModes = modes; }

  // Включает или выключает приём ввода; при любом переключении всё начатое сбрасывается
  setEnabled(on) {
    this.reset();
    this.enabled = on;
  }

  // Единый сброс: отменяет все жесты без применения и очищает очереди и состояние
  reset() {
    for (const name of [...this.gestures.keys()]) this.cancelGesture(name);
    this.casts.length = 0;
    this.actions.length = 0;
    this.keys.clear();
    this.attackStack = [];
    this.attackHeld = false;
    this.filter = null;
    this.aiming = null;
    this.tipKey = null;
    this.cancelHover = false;
    this.cancelEl.hidden = true;
    this.cancelEl.classList.remove('hot');
    this.joy = null;
    this.move.x = 0; this.move.z = 0;
  }

  // --- реестр жестов -----------------------------------------------------------------
  // name — слот жеста; несколько элементов могут делить один слот, тогда жестом владеет первый.
  // handlers: start(e, g) — начало; move(e, g); end(e, g) — штатное завершение; cancel(g) — отмена
  track(el, name, handlers) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.gestures.has(name)) return; // слот занят — не перехватываем и не берём захват
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* указатель уже отпущен */ }
      const g = { id: e.pointerId, el, handlers };
      this.gestures.set(name, g);
      handlers.start(e, g);
    });
    const own = (e) => {
      const g = this.gestures.get(name);
      return g && g.el === el && g.id === e.pointerId ? g : null;
    };
    el.addEventListener('pointermove', (e) => { const g = own(e); if (g) handlers.move?.(e, g); });
    el.addEventListener('pointerup', (e) => {
      const g = own(e);
      if (!g) return;
      this.gestures.delete(name);
      handlers.end(e, g);
    });
    // после штатного pointerup жест уже удалён, поэтому идущий за ним lostpointercapture ничего не отменит
    el.addEventListener('pointercancel', (e) => { if (own(e)) this.cancelGesture(name); });
    el.addEventListener('lostpointercapture', (e) => { if (own(e)) this.cancelGesture(name); });
  }

  cancelGesture(name) {
    const g = this.gestures.get(name);
    if (!g) return;
    this.gestures.delete(name);
    g.handlers.cancel(g);
    try { if (g.el.hasPointerCapture(g.id)) g.el.releasePointerCapture(g.id); } catch { /* уже отпущен */ }
  }

  // --- джойстик ---------------------------------------------------------------------
  bindJoystick() {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    const R = 50;
    const update = (e) => {
      const dx = e.clientX - this.joy.x, dy = e.clientY - this.joy.y;
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const mag = Math.min(1, d / R);
      this.move.x = d > 4 ? (dx / d) * mag : 0;
      this.move.z = d > 4 ? (dy / d) * mag : 0;
    };
    const release = () => {
      this.joy = null;
      this.move.x = 0; this.move.z = 0;
      knob.style.transform = '';
      base.hidden = true;
    };
    this.track(zone, 'joystick', {
      start: (e) => {
        this.joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
        const r = zone.getBoundingClientRect();
        base.style.left = `${e.clientX - r.left}px`;
        base.style.top = `${e.clientY - r.top}px`;
        base.hidden = false;
        update(e);
      },
      move: (e) => update(e),
      end: release,
      cancel: release,
    });
  }

  overCancel(x, y) {
    const r = this.cancelEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.hypot(x - cx, y - cy) < r.width / 2 + 10;
  }

  // --- умения: тап, прицел, отмена, удержание для описания ----------------------------
  bindAbility(btn, key) {
    const clear = (g) => {
      clearTimeout(g.timer);
      btn.classList.remove('held');
      if (this.tipKey === key) this.tipKey = null;
      if (this.aiming?.key === key) {
        this.aiming = null;
        this.cancelHover = false;
        this.cancelEl.hidden = true;
        this.cancelEl.classList.remove('hot');
      }
    };
    this.track(btn, 'ability', {
      start: (e, g) => {
        btn.classList.add('held');
        g.x = e.clientX;
        g.y = e.clientY;
        g.tip = false;
        // удержание на месте — показать описание; отпускание после этого умение не применяет
        g.timer = setTimeout(() => {
          if (this.gestures.get('ability') !== g || this.aiming?.manual) return;
          g.tip = true;
          this.tipKey = key;
          if (this.aiming?.key === key) { this.aiming = null; this.cancelEl.hidden = true; }
        }, TIP_DELAY);
        const mode = this.aimModes[key];
        if (mode && mode !== 'self') {
          this.aiming = { key, dx: 0, dz: 0, mag: 0, manual: false };
          this.cancelEl.hidden = false;
        }
      },
      move: (e, g) => {
        if (g.tip) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        const d = Math.hypot(dx, dy);
        if (d > AIM_DEADZONE) clearTimeout(g.timer);
        if (this.aiming?.key !== key) return;
        if (d > AIM_DEADZONE) {
          this.aiming.manual = true;
          this.aiming.dx = dx / d;
          this.aiming.dz = dy / d;
          this.aiming.mag = Math.min(1, (d - AIM_DEADZONE) / (AIM_FULL - AIM_DEADZONE));
        }
        this.cancelHover = this.overCancel(e.clientX, e.clientY);
        this.cancelEl.classList.toggle('hot', this.cancelHover);
      },
      end: (e, g) => {
        const a = this.aiming?.key === key ? this.aiming : null;
        const cancelled = g.tip || (a && this.cancelHover);
        if (!cancelled) {
          if (a && a.manual) this.casts.push({ key, manual: { dx: a.dx, dz: a.dz, mag: a.mag } });
          else this.casts.push({ key });
        }
        clear(g);
      },
      cancel: clear,
    });
  }

  // --- кнопки атаки: действуют, пока палец держит; при нескольких — последняя зажатая -----
  bindAttack(btn, filter) {
    const name = 'hold:' + btn.id;
    const up = () => {
      btn.classList.remove('held');
      this.attackStack = this.attackStack.filter((a) => a.name !== name);
      this.syncAttack();
    };
    this.track(btn, name, {
      start: () => {
        btn.classList.add('held');
        this.attackStack.push({ name, filter });
        this.syncAttack();
      },
      end: up,
      cancel: up,
    });
  }

  syncAttack() {
    const top = this.attackStack[this.attackStack.length - 1];
    this.attackHeld = !!top;
    this.filter = top ? top.filter : null;
  }

  bindButtons() {
    this.bindAttack(document.getElementById('atkBtn'), null);
    this.bindAttack(document.getElementById('atkCreep'), 'creep');
    this.bindAttack(document.getElementById('atkTower'), 'tower');
    for (const key of ['Q', 'W', 'E', 'R', 'S1', 'S2']) this.bindAbility(document.getElementById('ab' + key), key);
    for (const btn of document.querySelectorAll('[data-rank]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.enabled) this.actions.push({ type: 'rank', key: btn.dataset.rank });
      });
    }
    for (const btn of document.querySelectorAll('[data-act]')) {
      btn.addEventListener('click', () => { if (this.enabled) this.actions.push({ type: btn.dataset.act }); });
    }
    for (const el of document.querySelectorAll('.act, .util, .mini-act')) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeys() {
    const abil = { Digit1: 'Q', Digit2: 'W', Digit3: 'E', Digit4: 'R', KeyQ: 'Q', KeyE: 'E', KeyR: 'R', KeyF: 'W' };
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      // автоповтор держит клавишу движения зажатой, но не повторяет действия
      this.keys.add(e.code);
      if (e.repeat) return;
      if (abil[e.code]) {
        if (e.ctrlKey) this.actions.push({ type: 'rank', key: abil[e.code] });
        else this.casts.push({ key: abil[e.code] });
      }
      if (e.code === 'KeyZ') this.casts.push({ key: 'S1' });
      if (e.code === 'KeyX') this.casts.push({ key: 'S2' });
      if (e.code === 'KeyB') this.actions.push({ type: 'recall' });
      if (e.code === 'KeyP') this.actions.push({ type: 'shop' });
      if (e.code === 'Tab') this.actions.push({ type: 'score' });
      if (e.code === 'Escape') this.actions.push({ type: 'pause' });
      if (e.code === 'Digit5') this.actions.push({ type: 'active' });
      if (e.code === 'KeyT') this.actions.push({ type: 'quickbuy' });
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  read() {
    let x = this.move.x, z = this.move.z;
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const kz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (kx || kz) { const d = Math.hypot(kx, kz); x = kx / d; z = kz / d; }
    let filter = this.filter;
    if (k.has('KeyC')) filter = 'creep';
    if (k.has('KeyV')) filter = 'tower';
    return { x, z, attack: this.attackHeld || k.has('Space') || k.has('KeyJ') || k.has('KeyC') || k.has('KeyV'), filter };
  }
}
