// Бот-герой: фармит крипов, дерётся, когда сильнее, отступает и лечится на базе.
import { ABILITIES, MAP, TOWER, side } from './config.js';
import { dist } from './units.js';

const BUILD = ['blade', 'boots', 'armor', 'blade', 'amulet', 'armor', 'staff', 'blade', 'armor', 'staff'];

export class HeroBrain {
  constructor(game, hero, diff) {
    this.game = game;
    this.hero = hero;
    this.diff = diff;
    this.timer = 0;
    this.goal = null;    // точка, куда идти
    this.target = null;  // кого бить
    this.mode = 'lane';
  }

  get forward() { return -side(this.hero.team); } // +1 для синих: вперёд = вправо

  enemyTowers() {
    return this.game.units.filter((u) => u.alive && u.kind === 'tower' && u.team !== this.hero.team);
  }

  // Опасно ли стоять в точке: она под вражеской башней, которая не занята крипами
  towerDanger(x, z) {
    for (const t of this.enemyTowers()) {
      if (Math.hypot(t.pos.x - x, t.pos.z - z) > TOWER.range + t.radius + 1.2) continue;
      const busy = t.target && t.target.alive && t.target.kind === 'creep';
      const tanked = this.game.units.some((c) => c.alive && c.kind === 'creep' && c.team === this.hero.team
        && dist(c.pos, t.pos) < TOWER.range + t.radius);
      if (!(busy || tanked) || t.target === this.hero) return t;
    }
    return null;
  }

  update(dt) {
    const h = this.hero;
    if (!h.alive) { this.mode = 'dead'; return; }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.diff.think;
      this.think();
    }
    this.steer();
  }

  steer() {
    const h = this.hero;
    const it = h.intent;
    it.attack = false;
    it.target = null;
    it.mx = 0; it.mz = 0;
    if (h.recall) return;
    const t = this.target;
    if (t && t.canBeHitBy(h.team)) {
      if (h.inRange(t)) { it.attack = true; it.target = t; return; }
      this.moveTo(t.pos.x, t.pos.z, 0);
      return;
    }
    if (this.goal) this.moveTo(this.goal.x, this.goal.z, 0.5);
  }

  moveTo(x, z, stop) {
    const h = this.hero;
    const dx = x - h.pos.x, dz = z - h.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return;
    h.intent.mx = dx / d;
    h.intent.mz = dz / d;
  }

  think() {
    const g = this.game, h = this.hero, f = this.forward;
    const e = g.heroOf(1 - h.team);
    const hpPct = h.hp / h.maxHp;
    const fountainX = side(h.team) * MAP.fountainX;
    this.target = null;

    // На базе: покупки и лечение
    if (h.inBase) {
      const want = {};
      for (const id of BUILD) {
        want[id] = (want[id] ?? 0) + 1;
        if (h.items.filter((x) => x === id).length >= want[id]) continue;
        if (!g.buy(h, id)) break;
      }
      if (hpPct < 0.92) { this.mode = 'heal'; this.goal = { x: fountainX, z: 0 }; return; }
    }

    const enemyNear = e.alive && dist(e.pos, h.pos) < 12;
    const eDist = e.alive ? dist(e.pos, h.pos) : Infinity;

    // Отступление
    const lowHp = hpPct < 0.28 || (enemyNear && hpPct < 0.42 && e.hp > h.hp * 1.3);
    if (lowHp || this.mode === 'retreat') {
      if (!lowHp && hpPct > 0.7) this.mode = 'lane';
      else {
        this.mode = 'retreat';
        if (h.inBase) { this.mode = 'heal'; return; }
        const enemiesClose = g.units.some((u) => u.canBeHitBy(h.team) && !u.isStructure && dist(u.pos, h.pos) < 10);
        if (!enemiesClose && !h.recall) { h.intent.recall = true; this.goal = null; return; }
        if (h.recall) return;
        this.goal = { x: fountainX, z: 0 };
        if (eDist < 5 && h.abilityReady('W')) { h.intent.mx = side(h.team); h.intent.mz = 0; h.cast('W'); }
        if (eDist < 7 && h.abilityReady('E')) h.cast('E');
        return;
      }
    }
    if (h.recall) return;

    // Бегство из-под башни
    const tower = this.towerDanger(h.pos.x, h.pos.z);
    if (tower && tower.target === h) {
      this.goal = { x: tower.pos.x - f * (TOWER.range + 4), z: h.pos.z * 0.5 };
      return;
    }

    // Драка с героем
    if (e.alive && eDist < 11) {
      const mine = h.hp * h.damage * this.diff.aggression;
      const theirs = e.hp * e.damage;
      const eUnderTower = this.towerDanger(e.pos.x, e.pos.z);
      const killable = e.hp < h.damage * 2.2 && hpPct > 0.45;
      if ((mine >= theirs * 0.95 || e.hp / e.maxHp < 0.25) && (!eUnderTower || killable)) {
        this.mode = 'fight';
        this.target = e;
        if (eDist <= ABILITIES.R.range && h.abilityReady('R') && (e.hp / e.maxHp < 0.6 || this.diff.aggression > 1)) h.cast('R');
        if (eDist <= ABILITIES.Q.range * 0.9 && h.abilityReady('Q')) h.cast('Q');
        if (eDist <= 7 && h.abilityReady('E') && hpPct < 0.8) h.cast('E');
        if (eDist > h.range + 2 && e.hp / e.maxHp < 0.3 && h.abilityReady('W')) {
          h.intent.mx = (e.pos.x - h.pos.x) / eDist; h.intent.mz = (e.pos.z - h.pos.z) / eDist;
          h.cast('W');
        }
        return;
      }
      // враг сильнее: держаться позади своих крипов
      if (eDist < h.range + 2 && h.lastDamagedAt > g.time - 1 && h.abilityReady('E')) h.cast('E');
    }

    // Фарм и пуш
    this.mode = 'lane';
    const front = this.frontLine();
    const creep = this.bestCreep();
    if (creep) { this.target = creep; return; }
    const structure = g.units.find((u) => u.isStructure && u.canBeHitBy(h.team) && dist(u.pos, h.pos) < h.range + u.radius + 6
      && !this.towerDanger(u.pos.x - f * (h.range + u.radius - 0.5), 0));
    if (structure) { this.target = structure; return; }
    // иногда кидать Q в волну крипов при полном здоровье
    if (hpPct > 0.8 && h.abilityReady('Q') && h.aimTarget(ABILITIES.Q.range * 0.8) && Math.random() < 0.15) h.cast('Q');
    let gx = front - f * 2.5;
    // не заходить под вражескую башню без крипов
    for (let i = 0; i < 20 && this.towerDanger(gx, 0); i++) gx -= f * 1.5;
    this.goal = { x: gx, z: (h.team ? 1.5 : -1.5) };
  }

  // Где сейчас передний край своей волны (или своя башня, если крипов нет)
  frontLine() {
    const g = this.game, h = this.hero, f = this.forward;
    let best = null;
    for (const u of g.units) {
      if (!u.alive || u.team !== h.team || u.kind !== 'creep') continue;
      if (best === null || u.pos.x * f > best * f) best = u.pos.x;
    }
    if (best !== null) return best;
    const own = g.units.filter((u) => u.alive && u.kind === 'tower' && u.team === h.team);
    if (!own.length) return side(h.team) * (MAP.baseX - 6);
    const outer = own.reduce((a, b) => (a.pos.x * f > b.pos.x * f ? a : b));
    return outer.pos.x + f * 3;
  }

  bestCreep() {
    const g = this.game, h = this.hero;
    let best = null, bestScore = Infinity;
    for (const u of g.units) {
      if (u.kind !== 'creep' || !u.canBeHitBy(h.team)) continue;
      const d = h.edgeDist(u);
      if (d > h.range + 4) continue;
      if (this.towerDanger(u.pos.x, u.pos.z) && d > h.range) {
        // можно бить издалека, но не подходить под башню
        const approach = { x: u.pos.x - (u.pos.x - h.pos.x) / (d + u.radius + h.radius) * h.range, z: u.pos.z };
        if (this.towerDanger(approach.x, approach.z)) continue;
      }
      const score = u.hp - (u.hp <= h.damage ? 1000 : 0) + d * 10;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }
}
