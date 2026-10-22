// Игровые объекты: герой, крипы, башни, нексус, снаряды и эффекты.
import * as THREE from 'three';
import {
  TEAM_GLOW, CREEP, TOWER, NEXUS, HERO, ABILITIES, side, MAP,
} from './config.js';
import {
  heroModel, creepModel, towerModel, nexusModel, projectileModel, ringDecal, discDecal, rockModel,
} from './models.js';
import { seededRandom } from './world.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Unit {
  constructor(game, team, kind, x, z) {
    this.game = game;
    this.id = game.nextId++;
    this.team = team;
    this.kind = kind; // hero | creep | tower | nexus
    this.pos = { x, z };
    this.facing = side(team) < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.alive = true;
    this.radius = 0.6;
    this.baseHp = 100;
    this.hp = 100;
    this.shield = 0;
    this.shieldTime = 0;
    this.atkTimer = 0;
    this.target = null;
    this.moving = false;
    this.moveDir = { x: 0, z: 0 };
    this.lastHitBy = null;
    this.lastDamagedAt = -99;
    this.hitFlash = 0;
    this.static = false;
    this.ranged = false;
    this.anim = 0;
  }

  get maxHp() { return this.baseHp; }
  get damage() { return 10; }
  get range() { return 1.5; }
  get cooldown() { return 1; }
  get speed() { return 0; }
  get isStructure() { return this.kind === 'tower' || this.kind === 'nexus'; }
  get invulnerable() { return false; }

  edgeDist(u) { return dist(this.pos, u.pos) - this.radius - u.radius; }
  inRange(u, extra = 0) { return this.edgeDist(u) <= this.range + extra; }

  canBeHitBy(team) { return this.alive && this.team !== team && !this.invulnerable; }

  takeDamage(amount, source) {
    if (!this.alive || this.invulnerable) return 0;
    let dmg = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    this.lastHitBy = source;
    this.lastDamagedAt = this.game.time;
    this.hitFlash = 0.12;
    if (source && source.kind === 'hero' && this.kind === 'hero') this.game.onHeroHitHero(source, this);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(source);
    }
    return amount;
  }

  die(killer) {
    this.alive = false;
    this.game.onDeath(this, killer);
  }

  moveToward(x, z, dt, stopDist = 0) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist + 0.01) { this.moving = false; return true; }
    const step = Math.min(this.speed * dt, d - stopDist);
    this.moveDir.x = dx / d; this.moveDir.z = dz / d;
    this.pos.x += this.moveDir.x * step;
    this.pos.z += this.moveDir.z * step;
    this.facing = Math.atan2(dx, dz);
    this.moving = true;
    return false;
  }

  face(u) { this.facing = Math.atan2(u.pos.x - this.pos.x, u.pos.z - this.pos.z); }

  // Атакует цель, если она в радиусе. Возвращает true, если стоит и бьёт.
  tryAttack(target, dt) {
    if (!target || !target.canBeHitBy(this.team)) return false;
    if (!this.inRange(target)) return false;
    this.moving = false;
    this.face(target);
    if (this.atkTimer <= 0) {
      this.atkTimer = this.cooldown;
      this.anim = 0.25;
      if (this.ranged) {
        this.game.addProjectile(new Homing(this.game, this, target, this.damage));
      } else {
        target.takeDamage(this.damage, this);
        this.game.hitSpark(target, TEAM_GLOW[this.team]);
      }
    }
    return true;
  }

  baseUpdate(dt) {
    this.atkTimer -= dt;
    this.hitFlash -= dt;
    this.anim -= dt;
    if (this.shieldTime > 0) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0) this.shield = 0;
    }
  }

  syncMesh() {
    if (!this.model) return;
    const g = this.model.group;
    g.position.x = this.pos.x;
    g.position.z = this.pos.z;
    if (!this.static) {
      // плавный поворот
      let d = this.facing - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * 0.35;
    }
  }

  removeMesh() {
    if (this.model) this.game.scene.remove(this.model.group);
  }
}

export class Hero extends Unit {
  constructor(game, team, x, z, isPlayer) {
    super(game, team, 'hero', x, z);
    this.isPlayer = isPlayer;
    this.radius = HERO.radius;
    this.ranged = true;
    this.level = 1;
    this.xp = 0;
    this.gold = 500;
    this.items = [];
    this.bonusDamage = 0;
    this.bonusHp = 0;
    this.bonusSpeed = 0;
    this.cdr = 0;
    this.abilityPower = 1;
    this.damageMul = 1;
    this.hp = this.maxHp;
    this.cd = { Q: 0, W: 0, E: 0, R: 0 };
    this.dash = null;
    this.recall = null;
    this.respawnTimer = 0;
    this.kills = 0;
    this.deaths = 0;
    this.aggroTime = -99;     // когда последний раз бил вражеского героя
    this.intent = { mx: 0, mz: 0, attack: false, cast: null, recall: false };
    this.model = heroModel(team);
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shieldMesh.position.y = 1.2;
    this.shieldMesh.visible = false;
    this.model.group.add(this.shieldMesh);
    this.recallMesh = discDecal(TEAM_GLOW[team], 1.4, 0.35);
    this.recallMesh.visible = false;
    this.model.group.add(this.recallMesh);
    game.scene.add(this.model.group);
  }

  get maxHp() { return HERO.baseHp + HERO.hpPerLevel * (this.level - 1) + this.bonusHp; }
  get damage() { return (HERO.baseDamage + HERO.damagePerLevel * (this.level - 1) + this.bonusDamage) * this.damageMul; }
  get range() { return HERO.range; }
  get cooldown() { return HERO.cooldown; }
  get speed() { return HERO.speed + this.bonusSpeed; }
  spellDamage(base) { return base * this.abilityPower * this.damageMul; }

  abilityReady(key) {
    if (!this.alive || this.cd[key] > 0) return false;
    if (key === 'R' && this.level < ABILITIES.R.unlockLevel) return false;
    return true;
  }

  get inBase() {
    return Math.hypot(this.pos.x - side(this.team) * MAP.fountainX, this.pos.z) < MAP.baseRadius;
  }

  gainXp(amount) {
    if (this.level >= HERO.maxLevel) return;
    this.xp += amount;
    while (this.level < HERO.maxLevel && this.xp >= HERO.xpToLevel(this.level)) {
      this.xp -= HERO.xpToLevel(this.level);
      const before = this.maxHp;
      this.level++;
      this.hp += this.maxHp - before;
      this.game.emit('levelup', this);
    }
  }

  gainGold(amount, show = true) {
    this.gold += amount;
    if (show && amount >= 5) this.game.emit('float', { unit: this, text: `+${Math.round(amount)}`, kind: 'gold' });
  }

  // Ближайший враг для умения: сначала герой, потом всё остальное
  aimTarget(range) {
    let best = null, bestD = Infinity;
    for (const u of this.game.units) {
      if (!u.canBeHitBy(this.team) || u.isStructure) continue;
      const d = dist(this.pos, u.pos) - u.radius;
      if (d > range) continue;
      const score = u.kind === 'hero' ? d - 100 : d;
      if (score < bestD) { bestD = score; best = u; }
    }
    return best;
  }

  aimDirection(range) {
    const t = this.aimTarget(range);
    if (t) {
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      return { x: dx / d, z: dz / d, target: t };
    }
    return { x: Math.sin(this.facing), z: Math.cos(this.facing), target: null };
  }

  // Цель для обычной атаки
  pickAttackTarget() {
    const reach = this.range + 3;
    const cur = this.target;
    let enemyHero = null, best = null, bestScore = Infinity;
    for (const u of this.game.units) {
      if (!u.canBeHitBy(this.team)) continue;
      const d = this.edgeDist(u);
      if (d > reach) continue;
      if (u.kind === 'hero' && d <= this.range + 1) enemyHero = u;
      // крипы с малым хп в приоритете, чтобы было проще добивать
      let score = d;
      if (u.kind === 'creep') score += u.hp / u.maxHp * 3 - (u.hp <= this.damage ? 4 : 0);
      if (u.isStructure) score += 6;
      if (u === cur) score -= 1.5;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return enemyHero || best;
  }

  cast(key) {
    if (!this.abilityReady(key)) return false;
    const lvl = this.level;
    const cdMul = 1 - this.cdr;
    this.cancelRecall();
    if (key === 'Q') {
      const a = ABILITIES.Q;
      const dir = this.aimDirection(a.range);
      this.facing = Math.atan2(dir.x, dir.z);
      this.game.addProjectile(new Skillshot(this.game, this, dir, this.spellDamage(a.damage(lvl))));
    } else if (key === 'W') {
      const a = ABILITIES.W;
      let dx = this.intent.mx, dz = this.intent.mz;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) { dx = Math.sin(this.facing); dz = Math.cos(this.facing); } else { dx /= len; dz /= len; }
      this.dash = { vx: dx * a.distance / a.duration, vz: dz * a.distance / a.duration, t: a.duration };
      this.facing = Math.atan2(dx, dz);
      this.game.trail(this);
    } else if (key === 'E') {
      const a = ABILITIES.E;
      this.shield = ABILITIES.E.shield(lvl) * this.abilityPower;
      this.shieldTime = a.duration;
    } else if (key === 'R') {
      const a = ABILITIES.R;
      const t = this.aimTarget(a.range);
      let x, z;
      if (t) { x = t.pos.x; z = t.pos.z; } else {
        x = this.pos.x + Math.sin(this.facing) * a.range * 0.6;
        z = this.pos.z + Math.cos(this.facing) * a.range * 0.6;
      }
      this.game.addProjectile(new Meteor(this.game, this, x, z, this.spellDamage(a.damage(lvl))));
    }
    this.cd[key] = ABILITIES[key].cooldown * cdMul;
    this.anim = 0.3;
    this.game.emit('cast', { hero: this, key });
    return true;
  }

  startRecall() {
    if (!this.alive || this.recall || this.inBase) return;
    this.recall = { t: HERO.recallTime };
    this.recallMesh.visible = true;
  }

  cancelRecall() {
    if (this.recall) { this.recall = null; this.recallMesh.visible = false; }
  }

  respawn() {
    this.alive = true;
    this.hp = this.maxHp;
    this.shield = 0;
    this.pos.x = side(this.team) * MAP.fountainX;
    this.pos.z = 0;
    this.target = null;
    this.dash = null;
    this.model.group.visible = true;
    this.game.emit('respawn', this);
  }

  update(dt) {
    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }
    this.baseUpdate(dt);
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (this.game.time - this.lastDamagedAt > 5) this.hp = Math.min(this.maxHp, this.hp + HERO.regen * dt * (1 + this.level * 0.15));

    const it = this.intent;
    if (it.cast) { this.cast(it.cast); it.cast = null; }
    if (it.recall) { this.startRecall(); it.recall = false; }

    this.moving = false;
    if (this.dash) {
      this.pos.x += this.dash.vx * dt;
      this.pos.z += this.dash.vz * dt;
      this.dash.t -= dt;
      if (this.dash.t <= 0) this.dash = null;
      this.moving = true;
    } else {
      const len = Math.hypot(it.mx, it.mz);
      if (len > 0.15) {
        this.cancelRecall();
        const k = Math.min(1, len);
        this.moveDir.x = it.mx / len; this.moveDir.z = it.mz / len;
        this.pos.x += this.moveDir.x * this.speed * k * dt;
        this.pos.z += this.moveDir.z * this.speed * k * dt;
        this.facing = Math.atan2(it.mx, it.mz);
        this.moving = true;
        this.target = null;
      } else if (it.attack) {
        const t = it.target && it.target.canBeHitBy(this.team) ? it.target : this.pickAttackTarget();
        this.target = t;
        if (t) {
          this.cancelRecall();
          if (!this.tryAttack(t, dt)) this.moveToward(t.pos.x, t.pos.z, dt, t.radius + this.radius + this.range - 0.3);
        }
      } else {
        this.target = null;
      }
    }

    if (this.recall) {
      if (this.game.time - this.lastDamagedAt < 0.1) this.cancelRecall();
      else {
        this.recall.t -= dt;
        if (this.recall.t <= 0) {
          this.cancelRecall();
          this.pos.x = side(this.team) * MAP.fountainX;
          this.pos.z = 0;
          this.game.emit('recalled', this);
        }
      }
    }
  }

  syncMesh(dt) {
    super.syncMesh();
    const m = this.model;
    const t = this.game.time;
    const bob = this.moving ? Math.abs(Math.sin(t * 11)) * 0.12 : Math.sin(t * 2) * 0.03;
    m.group.position.y = bob;
    m.staff.rotation.x = this.anim > 0 ? -0.9 : (this.moving ? Math.sin(t * 11) * 0.25 : 0);
    m.orb.scale.setScalar(this.anim > 0 ? 1.8 : 1 + Math.sin(t * 4) * 0.1);
    this.shieldMesh.visible = this.shield > 0;
    if (this.recall) this.recallMesh.scale.setScalar(1 - this.recall.t / HERO.recallTime + 0.2);
  }
}

export class Creep extends Unit {
  constructor(game, team, ranged, wave, zOffset) {
    const s = side(team);
    super(game, team, 'creep', s * (MAP.baseX - 10), zOffset);
    const st = ranged ? CREEP.ranged : CREEP.melee;
    this.stats = st;
    this.ranged = ranged;
    const grow = 1 + CREEP.growthPerWave * wave;
    this.baseHp = st.hp * grow;
    this.dmg = st.damage * grow;
    this.hp = this.baseHp;
    this.radius = st.radius;
    this.laneZ = zOffset;
    this.thinkTimer = Math.random() * 0.3;
    this.forced = null; // цель «на помощь своему герою»
    this.model = creepModel(team, ranged);
    game.scene.add(this.model.group);
  }

  get damage() { return this.dmg; }
  get range() { return this.stats.range; }
  get cooldown() { return this.stats.cooldown; }
  get speed() { return this.stats.speed; }

  update(dt) {
    this.baseUpdate(dt);
    this.thinkTimer -= dt;
    if (this.forced && (!this.forced.canBeHitBy(this.team) || this.edgeDist(this.forced) > CREEP.aggroRange + 3)) this.forced = null;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.3;
      if (this.forced) this.target = this.forced;
      else if (!this.target || !this.target.canBeHitBy(this.team) || this.edgeDist(this.target) > CREEP.aggroRange + 1.5) {
        this.target = this.game.nearestEnemy(this, CREEP.aggroRange);
      }
    }
    const t = this.target;
    if (t && t.canBeHitBy(this.team)) {
      if (!this.tryAttack(t, dt)) this.moveToward(t.pos.x, t.pos.z, dt, t.radius + this.radius + this.range - 0.2);
    } else {
      // идти по линии к вражеской базе
      const goalX = -side(this.team) * (MAP.baseX - 3);
      this.moveToward(goalX, this.laneZ, dt, 0.5);
    }
  }

  syncMesh() {
    super.syncMesh();
    const t = this.game.time + this.id;
    this.model.group.position.y = this.moving ? Math.abs(Math.sin(t * 12)) * 0.1 : 0;
    this.model.group.rotation.z = this.anim > 0 ? 0.15 : 0;
  }
}

export class Tower extends Unit {
  constructor(game, team, x, hp, order) {
    super(game, team, 'tower', x, 0);
    this.static = true;
    this.ranged = true;
    this.order = order;
    this.baseHp = hp;
    this.hp = hp;
    this.radius = TOWER.radius;
    this.heroStreak = 0;
    this.forced = null;
    this.model = towerModel(team);
    this.rangeRing = ringDecal(TEAM_GLOW[team], TOWER.range + this.radius, 0.0);
    this.model.group.add(this.rangeRing);
    game.scene.add(this.model.group);
  }

  get damage() { return TOWER.damage; }
  get range() { return TOWER.range; }
  get cooldown() { return TOWER.cooldown; }
  get invulnerable() { return this.game.structureProtected(this); }

  update(dt) {
    this.baseUpdate(dt);
    const valid = (u) => u && u.canBeHitBy(this.team) && this.inRange(u);
    if (this.forced && !valid(this.forced)) this.forced = null;
    if (this.forced) this.target = this.forced;
    if (!valid(this.target)) {
      this.target = this.game.nearestEnemy(this, this.range, (u) => u.kind === 'creep')
        || this.game.nearestEnemy(this, this.range, (u) => u.kind === 'hero');
      this.heroStreak = 0;
    }
    if (this.target && this.atkTimer <= 0) {
      const t = this.target;
      this.atkTimer = this.cooldown;
      let dmg = this.damage;
      if (t.kind === 'hero') { dmg *= 1 + this.heroStreak * TOWER.heroRampPerShot; this.heroStreak++; }
      else { dmg *= TOWER.creepDamageMul; this.heroStreak = 0; }
      this.game.addProjectile(new Homing(this.game, this, t, dmg, { speed: 26, size: 0.38, y: 6.5 }));
    }
  }

  syncMesh() {
    super.syncMesh();
    this.model.crystal.rotation.y += 0.02;
    // кольцо радиуса видно, когда к башне подходит вражеский игрок
    const p = this.game.player;
    const near = p && p.alive && p.team !== this.team && dist(p.pos, this.pos) < this.range + 6;
    const mat = this.rangeRing.material;
    mat.opacity += ((near ? (this.target === p ? 0.75 : 0.35) : 0) - mat.opacity) * 0.15;
    mat.color.set(this.target === p ? 0xff3030 : TEAM_GLOW[this.team]);
  }

  die(killer) {
    super.die(killer);
    this.removeMesh();
    const rand = seededRandom(this.id * 13);
    for (let i = 0; i < 6; i++) {
      const r = rockModel(rand);
      r.position.set(this.pos.x + (rand() - 0.5) * 3, 0.2, this.pos.z + (rand() - 0.5) * 3);
      this.game.scene.add(r);
    }
  }
}

export class Nexus extends Unit {
  constructor(game, team, x, hp, order) {
    super(game, team, 'nexus', x, 0);
    this.static = true;
    this.order = order;
    this.baseHp = hp;
    this.hp = hp;
    this.radius = NEXUS.radius;
    this.model = nexusModel(team);
    game.scene.add(this.model.group);
  }
  get invulnerable() { return this.game.structureProtected(this); }
  update(dt) { this.baseUpdate(dt); }
  syncMesh() {
    super.syncMesh();
    const t = this.game.time;
    this.model.crystal.rotation.y = t * 0.6;
    this.model.crystal.position.y = 3.6 + Math.sin(t * 1.5) * 0.2;
    this.model.ring.rotation.z = t * 0.8;
  }
  die(killer) {
    super.die(killer);
    this.model.crystal.visible = false;
    this.model.ring.visible = false;
  }
}

// --- Снаряды и эффекты -------------------------------------------------------

// Самонаводящийся снаряд обычной атаки или башни
export class Homing {
  constructor(game, owner, target, damage, opts = {}) {
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.target = target;
    this.damage = damage;
    this.speed = opts.speed ?? 20;
    this.pos = { x: owner.pos.x, y: opts.y ?? 1.4, z: owner.pos.z };
    this.mesh = projectileModel(TEAM_GLOW[owner.team], opts.size ?? 0.2);
    this.done = false;
    game.scene.add(this.mesh);
  }
  update(dt) {
    const t = this.target;
    if (!t.alive) { this.done = true; return; }
    const ty = t.isStructure ? 2 : 1.2;
    const dx = t.pos.x - this.pos.x, dy = ty - this.pos.y, dz = t.pos.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const step = this.speed * dt;
    if (d <= step + 0.3) {
      if (t.canBeHitBy(this.team)) {
        t.takeDamage(this.damage, this.owner);
        this.game.hitSpark(t, TEAM_GLOW[this.team]);
      }
      this.done = true;
      return;
    }
    this.pos.x += dx / d * step; this.pos.y += dy / d * step; this.pos.z += dz / d * step;
  }
  sync() { this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z); }
  dispose() { this.game.scene.remove(this.mesh); }
}

// Огненный шар: летит по прямой, бьёт первого врага (не здание)
export class Skillshot {
  constructor(game, owner, dir, damage) {
    const a = ABILITIES.Q;
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.dir = dir;
    this.damage = damage;
    this.left = a.range;
    this.pos = { x: owner.pos.x + dir.x * 0.8, y: 1.4, z: owner.pos.z + dir.z * 0.8 };
    this.mesh = projectileModel(0xffa63d, 0.42);
    this.done = false;
    game.scene.add(this.mesh);
  }
  update(dt) {
    const a = ABILITIES.Q;
    const step = a.speed * dt;
    this.pos.x += this.dir.x * step;
    this.pos.z += this.dir.z * step;
    this.left -= step;
    for (const u of this.game.units) {
      if (!u.canBeHitBy(this.team) || u.isStructure) continue;
      if (dist(this.pos, u.pos) <= u.radius + a.width) {
        u.takeDamage(this.damage, this.owner);
        this.game.burst(u.pos.x, u.pos.z, 0xffa63d, 1.6);
        this.done = true;
        return;
      }
    }
    if (this.left <= 0) this.done = true;
  }
  sync() {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.x += 0.3;
  }
  dispose() { this.game.scene.remove(this.mesh); }
}

// Метеор: падает в точку с задержкой, бьёт всех врагов в круге
export class Meteor {
  constructor(game, owner, x, z, damage) {
    const a = ABILITIES.R;
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.x = x; this.z = z;
    this.damage = damage;
    this.t = a.delay;
    this.ring = ringDecal(0xff5a2a, a.radius, 0.85);
    this.ring.position.set(x, 0.07, z);
    this.disc = discDecal(0xff5a2a, a.radius, 0.18);
    this.disc.position.set(x, 0.06, z);
    this.rock = projectileModel(0xff7a2a, 0.9);
    this.done = false;
    game.scene.add(this.ring, this.disc, this.rock);
  }
  update(dt) {
    const a = ABILITIES.R;
    this.t -= dt;
    if (this.t <= 0) {
      for (const u of this.game.units) {
        if (!u.canBeHitBy(this.team) || u.isStructure) continue;
        if (Math.hypot(u.pos.x - this.x, u.pos.z - this.z) <= a.radius + u.radius) u.takeDamage(this.damage, this.owner);
      }
      this.game.burst(this.x, this.z, 0xff7a2a, a.radius * 1.2);
      this.game.shake(0.35);
      this.done = true;
    }
  }
  sync() {
    const k = Math.max(0, this.t / ABILITIES.R.delay);
    this.rock.position.set(this.x - k * 6, 0.5 + k * 22, this.z);
    this.disc.scale.setScalar(1 - k * 0.8);
  }
  dispose() { this.game.scene.remove(this.ring, this.disc, this.rock); }
}

// Вспышка: расширяющаяся и тающая сфера
export class Burst {
  constructor(game, x, y, z, color, size, life = 0.35) {
    this.game = game;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(0.01);
    game.scene.add(this.mesh);
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.life) this.done = true;
  }
  sync() {
    const k = this.t / this.life;
    this.mesh.scale.setScalar(this.size * (0.3 + k * 0.7));
    this.mesh.material.opacity = 0.8 * (1 - k);
  }
  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

