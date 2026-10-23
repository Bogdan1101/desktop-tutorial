// Управление: плавающий джойстик слева, кнопки справа, клавиатура для компьютера.
// Умения: тап — автоприцел, перетаскивание — ручной прицел, увод пальца на «Отмена» — отмена.

const AIM_DEADZONE = 14;   // пикселей до начала ручного прицела
const AIM_FULL = 95;       // пикселей до максимальной дальности

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
    this.cancelHover = false;
    this.aimModes = {};     // key -> 'line' | 'circle' | 'dash' | 'self'
    this.cancelEl = document.getElementById('aimCancel');
    this.bindJoystick();
    this.bindButtons();
    this.bindKeys();
  }

  setAimModes(modes) { this.aimModes = modes; }

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
    zone.addEventListener('pointerdown', (e) => {
      if (this.joy) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
      const r = zone.getBoundingClientRect();
      base.style.left = `${e.clientX - r.left}px`;
      base.style.top = `${e.clientY - r.top}px`;
      base.hidden = false;
      update(e);
    });
    zone.addEventListener('pointermove', (e) => { if (this.joy && e.pointerId === this.joy.id) update(e); });
    const end = (e) => {
      if (!this.joy || e.pointerId !== this.joy.id) return;
      this.joy = null;
      this.move.x = 0; this.move.z = 0;
      knob.style.transform = '';
      base.hidden = true;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  overCancel(x, y) {
    const r = this.cancelEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.hypot(x - cx, y - cy) < r.width / 2 + 10;
  }

  bindAbility(btn, key) {
    let st = null;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('held');
      st = { id: e.pointerId, x: e.clientX, y: e.clientY };
      const mode = this.aimModes[key];
      if (mode && mode !== 'self') {
        this.aiming = { key, dx: 0, dz: 0, mag: 0, manual: false };
        this.cancelEl.hidden = false;
      }
    });
    btn.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id || !this.aiming) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      const d = Math.hypot(dx, dy);
      if (d > AIM_DEADZONE) {
        this.aiming.manual = true;
        this.aiming.dx = dx / d;
        this.aiming.dz = dy / d;
        this.aiming.mag = Math.min(1, (d - AIM_DEADZONE) / (AIM_FULL - AIM_DEADZONE));
      }
      this.cancelHover = this.overCancel(e.clientX, e.clientY);
      this.cancelEl.classList.toggle('hot', this.cancelHover);
    });
    const finish = (e, cancelled) => {
      if (!st || e.pointerId !== st.id) return;
      btn.classList.remove('held');
      const a = this.aiming;
      if (!cancelled && !(a && this.cancelHover)) {
        if (a && a.manual) this.casts.push({ key, manual: { dx: a.dx, dz: a.dz, mag: a.mag } });
        else this.casts.push({ key });
      }
      st = null;
      this.aiming = null;
      this.cancelHover = false;
      this.cancelEl.hidden = true;
      this.cancelEl.classList.remove('hot');
    };
    btn.addEventListener('pointerup', (e) => finish(e, false));
    btn.addEventListener('pointercancel', (e) => finish(e, true));
  }

  bindHold(btn, onDown, onUp) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('held');
      onDown();
    });
    const up = () => { btn.classList.remove('held'); onUp(); };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
  }

  bindButtons() {
    this.bindHold(document.getElementById('atkBtn'), () => { this.attackHeld = true; this.filter = null; }, () => { this.attackHeld = false; });
    this.bindHold(document.getElementById('atkCreep'), () => { this.attackHeld = true; this.filter = 'creep'; }, () => { this.attackHeld = false; this.filter = null; });
    this.bindHold(document.getElementById('atkTower'), () => { this.attackHeld = true; this.filter = 'tower'; }, () => { this.attackHeld = false; this.filter = null; });
    for (const key of ['Q', 'W', 'E', 'R', 'S1', 'S2']) this.bindAbility(document.getElementById('ab' + key), key);
    for (const btn of document.querySelectorAll('[data-rank]')) {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.actions.push({ type: 'rank', key: btn.dataset.rank }); });
    }
    for (const btn of document.querySelectorAll('[data-act]')) {
      btn.addEventListener('click', () => this.actions.push({ type: btn.dataset.act }));
    }
    for (const el of document.querySelectorAll('.act, .util, .mini-act')) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeys() {
    const abil = { Digit1: 'Q', Digit2: 'W', Digit3: 'E', Digit4: 'R', KeyQ: 'Q', KeyE: 'E', KeyR: 'R', KeyF: 'W' };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (abil[e.code]) {
        if (e.ctrlKey) this.actions.push({ type: 'rank', key: abil[e.code] });
        else this.casts.push({ key: abil[e.code] });
      }
      if (e.code === 'KeyZ') this.casts.push({ key: 'S1' });
      if (e.code === 'KeyX') this.casts.push({ key: 'S2' });
      if (e.code === 'KeyB') this.actions.push({ type: 'recall' });
      if (e.code === 'KeyP') this.actions.push({ type: 'shop' });
      if (e.code === 'Tab') { e.preventDefault(); this.actions.push({ type: 'score' }); }
      if (e.code === 'Escape') this.actions.push({ type: 'pause' });
      if (e.code === 'Digit5') this.actions.push({ type: 'active' });
      if (e.code === 'KeyT') this.actions.push({ type: 'quickbuy' });
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; });
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

  reset() {
    this.casts.length = 0;
    this.actions.length = 0;
    this.attackHeld = false;
    this.filter = null;
    this.aiming = null;
    this.move.x = 0; this.move.z = 0;
  }
}
