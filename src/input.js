// Управление: плавающий джойстик на левой половине экрана, кнопки справа, клавиатура для компьютера.

export class Input {
  constructor() {
    this.move = { x: 0, z: 0 };
    this.attackHeld = false;
    this.casts = [];       // нажатые умения, ждут обработки
    this.actions = [];     // recall, shop
    this.keys = new Set();
    this.joy = null;
    this.bindJoystick();
    this.bindButtons();
    this.bindKeys();
  }

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
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY - zone.getBoundingClientRect().top}px`;
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

  bindButtons() {
    for (const btn of document.querySelectorAll('[data-act]')) {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('held');
        if (act === 'attack') { this.attackHeld = true; btn.setPointerCapture(e.pointerId); }
        else if ('QWER'.includes(act)) this.casts.push(act);
        else this.actions.push(act);
      });
      const up = () => {
        btn.classList.remove('held');
        if (act === 'attack') this.attackHeld = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  bindKeys() {
    const abil = { Digit1: 'Q', Digit2: 'W', Digit3: 'E', Digit4: 'R' };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (abil[e.code]) this.casts.push(abil[e.code]);
      if (e.code === 'KeyB') this.actions.push('recall');
      if (e.code === 'KeyP') this.actions.push('shop');
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; });
  }

  // Итоговый вектор движения и состояние атаки
  read() {
    let x = this.move.x, z = this.move.z;
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const kz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (kx || kz) { const d = Math.hypot(kx, kz); x = kx / d; z = kz / d; }
    return { x, z, attack: this.attackHeld || k.has('Space') || k.has('KeyJ') };
  }

  reset() {
    this.casts.length = 0;
    this.actions.length = 0;
    this.attackHeld = false;
    this.move.x = 0; this.move.z = 0;
  }
}
