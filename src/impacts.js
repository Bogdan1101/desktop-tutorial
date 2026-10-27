// Отклик на попадание: короткая фигура в точке удара, когда урон уже рассчитан (событие 'damage').
// Обычные атаки трёх героев и их Q. У каждого героя своя форма:
//   Пиро — тёплое кольцо и искры (магия), Грок — четырёхлучевая «звезда» удара, Лира — узкий след стрелы
//   по направлению выстрела. Удар, целиком ушедший в щит, — голубой шестиугольник без формы урона.
// Пул фигур создаётся один раз на матч и переиспользуется: ничего не создаётся во время боя.
// Не показывается: промах (нет события урона), урон по времени. Пока цель в тумане или в чужих кустах,
// отклик скрыт (но живёт и гаснет по времени).
import * as THREE from 'three';

const KINDS = {
  // [цвет фигуры, цвет искр, время жизни, с]
  ember: [0xffa040, 0xffd27a, 0.28],
  strike: [0xfff0c0, 0xffd27a, 0.22],
  pierce: [0xfff1a8, 0xfff1a8, 0.2],
  shield: [0x9fe8ff, 0x9fe8ff, 0.3],
};
// чьё попадание какой формы; Q — по id умения
const BY_HERO = { pyro: 'ember', grok: 'strike', lira: 'pierce' };
const BY_ABILITY = { fireball: 'ember', shieldBash: 'strike', volley: 'pierce' };
const BIG = { fireball: 1.35, shieldBash: 1.35, volley: 1.1 };
const POOL = 14;        // одновременно не больше 14 фигур
const OTHERS_MAX = 8;   // попадания без участия игрока — не больше 8, остальное место за игроком
const PER_CAST = 3;     // одно умение по толпе: не больше 3 откликов
const SPARKS = 4;

function starShape(r, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 4, rr = i % 2 ? inner : r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i) s.lineTo(x, y); else s.moveTo(x, y);
  }
  s.closePath();
  return s;
}
function streakShape() {
  // острый клин вдоль +x: тонкий хвост, широкая голова у точки попадания
  const s = new THREE.Shape();
  s.moveTo(0.45, 0); s.lineTo(-0.95, 0.1); s.lineTo(-0.95, -0.1); s.closePath();
  return s;
}

export class ImpactFx {
  // opts: { quality: 'low'|'medium'|'high', reduced: bool }
  constructor(scene, game, camera, opts = {}) {
    this.game = game;
    this.camera = camera;
    this.low = opts.quality === 'low';
    this.reduced = !!opts.reduced;
    this.group = new THREE.Group();
    this.group.name = 'impactFx';
    scene.add(this.group);
    // геометрии — по одной на форму, общие для всех ячеек пула этого матча
    this.geo = {
      ring: new THREE.RingGeometry(0.34, 0.5, 20),
      star: new THREE.ShapeGeometry(starShape(0.62, 0.17)),
      streak: new THREE.ShapeGeometry(streakShape()),
      hex: new THREE.RingGeometry(0.42, 0.56, 6),
      spark: new THREE.CircleGeometry(0.09, 4),
    };
    const mat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.slots = [];
    for (let i = 0; i < POOL; i++) {
      const root = new THREE.Group();
      root.visible = false;
      root.renderOrder = 5;
      const shapes = {
        ring: new THREE.Mesh(this.geo.ring, mat(0xffffff)),
        star: new THREE.Mesh(this.geo.star, mat(0xffffff)),
        streak: new THREE.Mesh(this.geo.streak, mat(0xffffff)),
        hex: new THREE.Mesh(this.geo.hex, mat(0xffffff)),
      };
      const sparks = [];
      for (let k = 0; k < SPARKS; k++) sparks.push(new THREE.Mesh(this.geo.spark, mat(0xffffff)));
      for (const m of [...Object.values(shapes), ...sparks]) { m.renderOrder = 5; m.visible = false; root.add(m); }
      this.group.add(root);
      this.slots.push({ root, shapes, sparks, t: 0, life: 0, kind: null, mine: false, used: [], active: false, target: null });
    }
    this.casts = new Map(); // (источник, умение) → { at, n } — предел откликов одного умения
    this.shown = 0;         // для проверок: сколько откликов показано за матч
    this.v = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    game.on('damage', (e) => { if (!this.disposed) this.onDamage(e); });
  }

  onDamage(e) {
    const { source, target, dot } = e;
    if (dot || !source || source.kind !== 'hero' || !target) return;
    const kind = e.ability ? BY_ABILITY[e.ability] : e.basic ? BY_HERO[source.heroId] : null;
    if (!kind) return;
    const g = this.game, p = g.player;
    const mine = source === p || target === p;
    if (e.ability) {
      const key = source.id + ':' + e.ability;
      const c = this.casts.get(key);
      if (c && g.time - c.at < 0.4) { if (++c.n > PER_CAST) return; } else this.casts.set(key, { at: g.time, n: 1 });
    }
    const slot = this.pick(mine);
    if (!slot) return;
    // целиком в щит — честно показываем щит, а не урон по здоровью
    const shieldOnly = e.absorbed > 0 && e.lost <= 0;
    const scale = (e.ability ? BIG[e.ability] : 1) * (target.kind === 'hero' ? 1 : 0.85) * (e.crit ? 1.15 : 1);
    const dx = target.pos.x - source.pos.x, dz = target.pos.z - source.pos.z;
    slot.target = target;
    this.spawn(slot, shieldOnly ? 'shield' : kind, target, scale, dx, dz, mine);
  }

  // Свободная ячейка; если всё занято — самая старая. Чужим попаданиям — не больше OTHERS_MAX.
  pick(mine) {
    let free = null, oldest = null, others = 0;
    for (const s of this.slots) {
      if (s.active) {
        if (!s.mine) others++;
        if (!oldest || s.t / s.life > oldest.t / oldest.life) oldest = s;
      } else if (!free) free = s;
    }
    if (!mine && others >= OTHERS_MAX) return null;
    if (free) return free;
    return mine ? oldest : null;
  }

  spawn(s, kind, target, scale, dx, dz, mine) {
    const [color, sparkColor, life] = KINDS[kind];
    s.kind = kind; s.mine = mine; s.t = 0; s.life = this.reduced ? Math.min(life, 0.2) : life; s.scale = scale;
    const y = target.isStructure ? 2 : Math.min(1.4, (target.barHeight ?? 2) * 0.45);
    s.root.position.set(target.pos.x, y, target.pos.z);
    s.root.quaternion.copy(this.camera.quaternion); // плоская фигура лицом к камере
    s.active = true;
    s.root.visible = this.seen(s);
    for (const m of [...Object.values(s.shapes), ...s.sparks]) m.visible = false;
    s.used = [];
    const show = (m, c) => { m.visible = true; m.material.color.setHex(c); m.material.opacity = 1; m.scale.setScalar(1); m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); s.used.push(m); };
    if (kind === 'ember') show(s.shapes.ring, color);
    if (kind === 'strike') { show(s.shapes.star, color); s.shapes.star.rotation.z = Math.random() * 0.5; }
    if (kind === 'shield') show(s.shapes.hex, color);
    if (kind === 'pierce') {
      show(s.shapes.streak, color);
      // направление выстрела на экране: проекция вектора «стрелок → цель» в плоскость фигуры
      this.v.set(dx, 0, dz).normalize().applyQuaternion(this.q.copy(this.camera.quaternion).invert());
      s.shapes.streak.rotation.z = Math.atan2(this.v.y, this.v.x);
    }
    // искры только у Пиро и Грока, только при обычном и высоком качестве и без «меньше движения»
    s.sparkDirs = null;
    if (!this.low && !this.reduced && (kind === 'ember' || kind === 'strike')) {
      s.sparkDirs = [];
      for (let k = 0; k < SPARKS; k++) {
        const a = (k / SPARKS) * Math.PI * 2 + Math.random() * 0.8;
        show(s.sparks[k], sparkColor);
        s.sparkDirs.push([Math.cos(a), Math.sin(a)]);
      }
    }
    this.apply(s);
    this.shown++;
  }

  // Вид ячейки в момент времени: быстрый рост и затухание; при «меньше движения» — только затухание
  apply(s) {
    const k = Math.min(1, s.t / s.life);
    const fade = 1 - k * k;
    const grow = this.reduced ? 1 : 0.55 + 0.75 * (1 - (1 - k) * (1 - k));
    for (const m of s.used) m.material.opacity = fade;
    const sc = s.scale;
    if (s.kind === 'ember') s.shapes.ring.scale.setScalar(sc * grow * 1.2);
    if (s.kind === 'strike') s.shapes.star.scale.setScalar(sc * (this.reduced ? 1 : 1.15 - 0.25 * k) * (k < 0.15 && !this.reduced ? 0.6 + k * 2.6 : 1));
    if (s.kind === 'shield') s.shapes.hex.scale.setScalar(sc * (this.reduced ? 1 : 0.9 + 0.2 * k));
    if (s.kind === 'pierce') { const st = s.shapes.streak; st.scale.set(sc * (this.reduced ? 1 : 0.6 + 0.6 * Math.min(1, k * 3)), sc, 1); }
    if (s.sparkDirs) s.sparkDirs.forEach(([x, y], i) => s.sparks[i].position.set(x * (0.3 + k * 0.7) * sc, y * (0.3 + k * 0.7) * sc, 0));
  }

  // Отклик привязан к цели: виден, пока цель видна команде игрока (туман, кусты). Скрытый отклик
  // идёт и гаснет как обычно — если цель за это время выйдет из тумана, он станет виден.
  seen(s) { return this.game.seesUnit(this.game.viewTeam, s.target); }

  update(dt) {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t >= s.life) { s.active = false; s.root.visible = false; s.target = null; continue; }
      s.root.visible = this.seen(s);
      this.apply(s);
    }
  }

  get active() { return this.slots.filter((s) => s.active).length; }

  // Матч заменён: снять подписку, убрать фигуры и освободить свои геометрии и материалы
  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    const mats = new Set();
    this.group.traverse((o) => { if (o.material) mats.add(o.material); });
    for (const m of mats) m.dispose();
    for (const g of Object.values(this.geo)) g.dispose();
  }
}
