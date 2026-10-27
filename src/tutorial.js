// Обучение: шаги с подсказками в режиме тренировки. Каждый шаг проверяет, сделал ли игрок нужное.
// Подсказка показывает, какую кнопку нажать (подсветка), а на шаге с ходьбой — куда идти
// (метка у манекенов, стрелка у ног героя и направление в окне подсказки).
import * as THREE from 'three';
import { dist } from './units.js';
import { ringDecal, discDecal, disposeObject } from './models.js';

const GOAL = { x: -3, z: 0 }; // манекены у реки
const GOLD = 0xffd84a;

const STEPS = [
  { text: 'Изучите первое умение: нажмите «+» над кнопкой Q', focus: () => '#rankQ', done: (g, p) => p.ranks.Q > 0 },
  { text: 'Купите предмет: нажмите золотую кнопку слева, под портретом', focus: () => '#quickBtn', done: (g, p) => p.items.length > 0 },
  { text: 'Идите к золотой метке у манекенов: ведите пальцем по левой половине экрана', goal: GOAL, done: (g, p) => dist(p.pos, GOAL) < 9 },
  { text: 'Ударьте манекен: удерживайте «Атака»', focus: () => '#atkBtn', done: (g, p, c) => c.hits >= 3 },
  { text: 'Коснитесь Q и сразу отпустите — умение сработает по ближайшей цели', focus: () => '#abQ', done: (g, p, c) => c.casts >= 1 },
  {
    text: 'Прицельтесь сами: зажмите Q, потяните в сторону и отпустите', focus: () => '#abQ', done: (g, p, c) => c.manual >= 1,
    wait: (p) => (p.cd.Q > 0 ? `Q перезаряжается: ещё ${Math.ceil(p.cd.Q)} с` : null),
  },
  {
    text: 'Скачок: коснитесь «Вспышки» или потяните её в нужную сторону', done: (g, p, c) => c.flash >= 1,
    focus: (p) => (p.spells[0] === 'flash' ? '#abS1' : '#abS2'),
  },
  {
    text: 'Вернитесь на базу: нажмите «Домой» и постойте 4 секунды', focus: () => '#recallBtn', done: (g, p, c) => c.recalled >= 1,
    wait: (p) => (p.recall ? `Стойте на месте: ещё ${Math.ceil(p.recall.t)} с` : null),
  },
];

export class Tutorial {
  // view — { scene, camera } для метки и направления; actions — { onMatch, onStay } кнопок в конце
  constructor(game, el, view, onFinish, actions) {
    this.game = game;
    this.el = el;
    this.view = view;
    this.onFinish = onFinish;
    this.step = 0;
    this.c = { hits: 0, casts: 0, manual: 0, flash: 0, recalled: 0 };
    this.focusEl = null;
    this.goal = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.title = el.querySelector('b');
    this.textEl = el.querySelector('span');
    this.dirEl = el.querySelector('.tut-dir');
    this.doneEl = el.querySelector('.tut-done');
    const p = game.player;
    p.gold += 1500;
    game.on('damage', ({ source, target }) => { if (source === p && target.kind === 'dummy') this.c.hits++; });
    game.on('cast', ({ hero }) => { if (hero === p) this.c.casts++; });
    game.on('manualcast', () => { this.c.manual++; });
    game.on('spell', ({ hero, id }) => { if (hero === p && id === 'flash') this.c.flash++; });
    game.on('recalled', (h) => { if (h === p) this.c.recalled++; });
    // кнопки в конце: обработчики на время этого обучения, снимаются в dispose
    this.actions = actions;
    this.onMatch = () => actions.onMatch();
    this.onStay = () => { this.el.hidden = true; actions.onStay(); };
    el.querySelector('#tutMatchBtn').addEventListener('click', this.onMatch);
    el.querySelector('#tutStayBtn').addEventListener('click', this.onStay);
    this.render();
  }

  get current() { return STEPS[this.step]; }

  render() {
    this.el.hidden = false;
    this.setFocus(null);
    this.setGoal(null);
    this.dirEl.hidden = true;
    this.lastText = null;
    if (this.step >= STEPS.length) {
      this.title.textContent = this.doneTitle ?? 'Обучение пройдено';
      this.textEl.textContent = 'Сыграйте первый матч против бота';
      this.doneEl.hidden = false;
      return;
    }
    this.doneEl.hidden = true;
    const s = this.current;
    this.title.textContent = `Шаг ${this.step + 1} из ${STEPS.length}`;
    this.textEl.textContent = s.text;
    if (s.focus) this.setFocus(document.querySelector(s.focus(this.game.player)));
    if (s.goal) this.setGoal(s.goal);
  }

  setFocus(el) {
    this.focusEl?.classList.remove('tut-focus');
    this.focusEl = el;
    el?.classList.add('tut-focus');
  }

  // Метка цели на земле и стрелка у ног героя, указывающая на неё
  setGoal(goal) {
    if (this.goal) {
      for (const o of [this.goal.mark, this.goal.arrow]) { o.removeFromParent(); disposeObject(o); }
      this.goal = null;
    }
    if (!goal) return;
    const mark = new THREE.Group();
    mark.add(ringDecal(GOLD, 1.7, 0.85, 0.16), discDecal(GOLD, 1.7, 0.18));
    mark.position.set(goal.x, 0.08, goal.z);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9); shape.lineTo(0.55, 0); shape.lineTo(0.2, 0); shape.lineTo(0.2, -0.6);
    shape.lineTo(-0.2, -0.6); shape.lineTo(-0.2, 0); shape.lineTo(-0.55, 0); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // плоская стрелка на земле, острие в сторону −z
    const arrow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.8, depthWrite: false }));
    arrow.renderOrder = 2;
    this.view.scene.add(mark, arrow);
    this.goal = { ...goal, mark, arrow };
  }

  update(dt = 0) {
    if (this.step >= STEPS.length) return;
    const g = this.game, p = g.player;
    if (this.current.done(g, p, this.c)) {
      this.step++;
      g.emit('tutorialstep', this.step);
      // onFinish выдаёт награду и возвращает заголовок для окна завершения
      if (this.step >= STEPS.length) this.doneTitle = this.onFinish();
      this.render();
      return;
    }
    const s = this.current;
    // пока шаг ждёт перезарядку или стояние на месте, подсказка говорит, сколько осталось
    const text = s.wait?.(p) ?? s.text;
    if (text !== this.lastText) { this.textEl.textContent = text; this.lastText = text; }
    if (this.goal) this.updateGoal(p, dt);
  }

  updateGoal(p, dt) {
    const { mark, arrow } = this.goal;
    const dx = this.goal.x - p.pos.x, dz = this.goal.z - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // стрелка в 2,2 м от героя в сторону цели
    arrow.position.set(p.pos.x + (dx / d) * 2.2, 0.1, p.pos.z + (dz / d) * 2.2);
    arrow.rotation.y = Math.atan2(-dx, -dz);
    if (!this.reduced) {
      const k = 1 + Math.sin(this.game.time * 2.5) * 0.06; // медленное «дыхание» метки, без мигания
      mark.scale.set(k, 1, k);
    }
    // направление на экране: если метки не видно, в окне подсказки появляется стрелка и расстояние
    const cam = this.view.camera;
    const v = new THREE.Vector3(this.goal.x, 0, this.goal.z).project(cam);
    const off = v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95;
    this.dirEl.hidden = !off;
    if (off) {
      const h = new THREE.Vector3(p.pos.x, 0, p.pos.z).project(cam);
      const ang = Math.atan2(-(v.y - h.y), v.x - h.x); // экранный угол: y вниз
      this.dirEl.firstElementChild.style.transform = `rotate(${ang}rad)`;
      const label = `до метки ${Math.round(d)} м`;
      const small = this.dirEl.lastElementChild;
      if (small.textContent !== label) small.textContent = label;
    }
  }

  // Матч заменён или закончен: снять подсветку, метку, стрелку и обработчики кнопок
  dispose() {
    this.setFocus(null);
    this.setGoal(null);
    this.el.hidden = true;
    this.dirEl.hidden = true;
    this.doneEl.hidden = true;
    this.el.querySelector('#tutMatchBtn').removeEventListener('click', this.onMatch);
    this.el.querySelector('#tutStayBtn').removeEventListener('click', this.onStay);
  }
}
