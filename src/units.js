// Игровые объекты: герой, крипы, башни, нексус, монстры леса, снаряды и эффекты.
import * as THREE from 'three';
import {
  TEAM, TEAM_COLOR, TEAM_GLOW, CREEP, TOWER, NEXUS, INHIB, HERO, HEROES, ABILITIES, ITEMS, MONSTERS, SPELLS, side, MAP,
} from './config.js';
import {
  heroModel, creepModel, towerModel, nexusModel, inhibModel, monsterModel, dummyModel, projectileModel, arrowModel,
  ringDecal, discDecal, rockModel, stunModel,
} from './models.js';
import { seededRandom } from './world.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Unit {
  constructor(game, team, kind, x, z) {
    this.game = game;
    this.id = game.nextId++;
    this.team = team;
    this.kind = kind; // hero | creep | tower | inhib | nexus | monster | dummy
    this.pos = { x, z };
    this.facing = side(team) < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.alive = true;
    this.radius = 0.6;
    this.baseHp = 100;
    this.hp = 100;
    this.shield = 0;
    this.shieldUntil = 0;
    this.atkTimer = 0;
    this.target = null;
    this.moving = false;
    this.moveDir = { x: 0, z: 0 };
    this.lastHitBy = null;
    this.lastDamagedAt = -99;
    this.hitTime = -99;
    this.static = false;
    this.ranged = false;
    this.anim = 0;
    this.stunUntil = 0;
    this.slows = [];
    this.knock = null;
    this.revealUntil = 0;
    this.buffs = new Map();
    this.baseArmor = 0;
    this.baseMr = 0;
    this.dots = [];
  }

  get maxHp() { return this.baseHp; }
  get ad() { return 10; }
  get ap() { return 0; }
  get armor() { return this.baseArmor + this.buffStat('armor'); }
  get mr() { return this.baseMr + this.buffStat('mr'); }
  get attackSpeed() { return 1; }
  get range() { return 1.5; }
  get baseSpeed() { return 0; }
  get crit() { return 0; }
  get lifesteal() { return 0; }
  get outMul() { return 1; }
  get speed() {
    let slow = 0;
    for (const s of this.slows) slow = Math.max(slow, s.pct);
    return this.baseSpeed * (1 - slow);
  }
  get isStructure() { return this.kind === 'tower' || this.kind === 'nexus' || this.kind === 'inhib'; }
  get invulnerable() { return false; }
  get stunned() { return this.game.time < this.stunUntil; }
  get slowed() { return this.slows.length > 0; }
  get canAct() { return this.alive && !this.stunned && !this.knock && !this.inStasis; }
  get inStasis() { return false; }

  buffStat(stat) {
    let v = 0;
    for (const b of this.buffs.values()) if (b.stats && b.stats[stat]) v += b.stats[stat];
    return v;
  }
  addBuff(id, duration, data = {}) {
    this.buffs.set(id, { until: this.game.time + duration, ...data });
  }
  hasBuff(id) { return this.buffs.has(id); }

  edgeDist(u) { return dist(this.pos, u.pos) - this.radius - u.radius; }
  inRange(u, extra = 0) { return this.edgeDist(u) <= this.range + extra; }

  canBeHitBy(team) { return this.alive && this.team !== team && !this.invulnerable; }

  // Урон с учётом брони или сопротивления магии
  takeDamage(raw, type, source, opts = {}) {
    if (!this.alive || this.invulnerable || this.inStasis) return 0;
    const resist = type === 'physical' ? this.armor : type === 'magic' ? this.mr : 0;
    let dmg = raw * (100 / (100 + Math.max(0, resist)));
    const shown = dmg;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    this.lastHitBy = source;
    this.lastDamagedAt = this.game.time;
    this.hitTime = this.game.time;
    if (source) {
      source.revealUntil = this.game.time + 1.2;
      if (source.lifesteal > 0 && opts.basic) source.heal(shown * source.lifesteal);
      if (source.kind === 'hero' && this.kind === 'hero') {
        this.damagedBy.set(source, this.game.time);
        this.game.onHeroHitHero(source, this);
      }
    }
    if (this.kind === 'monster') this.onAttacked(source);
    this.game.emit('damage', { target: this, source, amount: shown, type, crit: !!opts.crit, dot: !!opts.dot });
    if (this.kind === 'dummy' && this.hp < 1) this.hp = 1; // манекен не умирает
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(source);
    }
    return shown;
  }

  heal(amount) {
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  stun(t) {
    if (!this.alive || this.isStructure) return;
    this.stunUntil = Math.max(this.stunUntil, this.game.time + t);
    if (this.recall) this.cancelRecall();
  }
  slow(pct, t) {
    if (!this.alive || this.isStructure) return;
    this.slows.push({ pct, until: this.game.time + t });
  }
  // Урон по времени (поджог): тикает раз в полсекунды
  burn(dps, duration, source) {
    if (!this.alive) return;
    this.dots.push({ dps, until: this.game.time + duration, acc: 0, source });
  }
  knockback(fromX, fromZ, distance) {
    if (!this.alive || this.static) return;
    let dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const t = 0.25;
    this.knock = { vx: dx * distance / t, vz: dz * distance / t, t };
    if (this.recall) this.cancelRecall();
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

  // Обычная атака
  basicAttack(target) {
    const crit = Math.random() < this.crit;
    let dmg = this.ad * this.outMul * (crit ? HERO.critMul : 1);
    if (this.empower && this.game.time < this.empower.until) { dmg *= 1 + this.empower.pct; this.empower = null; }
    const onHit = (t) => {
      t.takeDamage(dmg, 'physical', this, { basic: true, crit });
      if (this.hasBuff('red') && t.alive) t.slow(0.2, 1);
      this.game.hitSpark(t, this.team === TEAM.NEUTRAL ? 0xffd27a : TEAM_GLOW[this.team]);
    };
    this.anim = 0.25;
    if (this.ranged) {
      const color = this.heroDef?.projectile ?? TEAM_GLOW[this.team];
      this.game.addProjectile(new Homing(this.game, this, target, onHit, { color, arrow: this.heroId === 'lira' }));
    } else {
      onHit(target);
    }
    this.game.emit('attack', this);
  }

  // Атакует цель, если она в радиусе. Возвращает true, если стоит и бьёт.
  tryAttack(target) {
    if (!target || !target.canBeHitBy(this.team)) return false;
    if (!this.inRange(target)) return false;
    this.moving = false;
    this.face(target);
    if (this.atkTimer <= 0) {
      this.atkTimer = 1 / this.attackSpeed;
      this.basicAttack(target);
    }
    return true;
  }

  updateStatus(dt) {
    const t = this.game.time;
    this.atkTimer -= dt;
    this.anim -= dt;
    if (this.shield > 0 && t >= this.shieldUntil) this.shield = 0;
    if (this.slows.length) this.slows = this.slows.filter((s) => s.until > t);
    for (const [id, b] of this.buffs) if (b.until <= t) this.buffs.delete(id);
    if (this.dots.length) {
      for (const d of this.dots) {
        d.acc += dt;
        if (d.acc >= 0.5) { d.acc -= 0.5; this.takeDamage(d.dps * 0.5, 'true', d.source, { dot: true }); }
      }
      this.dots = this.dots.filter((d) => d.until > t && this.alive);
    }
    if (this.knock) {
      this.pos.x += this.knock.vx * dt;
      this.pos.z += this.knock.vz * dt;
      this.knock.t -= dt;
      if (this.knock.t <= 0) this.knock = null;
    }
  }

  syncMesh() {
    if (!this.model) return;
    const g = this.model.group;
    g.position.x = this.pos.x;
    g.position.z = this.pos.z;
    if (!this.static) {
      let d = this.facing - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * 0.35;
    }
    // вздрагивание при попадании
    const k = Math.max(0, 1 - (this.game.time - this.hitTime) / 0.15);
    const base = this.modelScale ?? 1;
    g.scale.set(base * (1 + k * 0.1), base * (1 - k * 0.08), base * (1 + k * 0.1));
    if (!this.static) {
      if (this.stunned) {
        if (!this.stunMesh) { this.stunMesh = stunModel(); this.stunMesh.position.y = this.barHeight - 0.5; g.add(this.stunMesh); }
        this.stunMesh.visible = true;
        this.stunMesh.rotation.y += 0.15;
      } else if (this.stunMesh) this.stunMesh.visible = false;
      if (this.slowed) {
        if (!this.slowMesh) { this.slowMesh = ringDecal(0x7fd4ff, this.radius + 0.35, 0.7, 0.25); g.add(this.slowMesh); }
        this.slowMesh.visible = true;
      } else if (this.slowMesh) this.slowMesh.visible = false;
    }
  }

  get barHeight() { return 2; }

  removeMesh() {
    if (this.model) this.game.scene.remove(this.model.group);
  }
}

export class Hero extends Unit {
  constructor(game, team, heroId, isPlayer, slot = 0, opts = {}) {
    super(game, team, 'hero', side(team) * MAP.fountainX, (slot - 1) * 2);
    this.talent = opts.talent ?? null;
    this.spells = opts.spells ?? ['flash', 'ignite'];
    this.spellCd = Object.fromEntries(this.spells.map((id) => [id, 0]));
    this.skin = opts.skin ?? 'base';
    this.streak = 0;
    this.deathStreak = 0;
    this.lastKillAt = -99;
    this.multi = 0;
    this.heroId = heroId;
    this.heroDef = HEROES[heroId];
    this.isPlayer = isPlayer;
    this.slot = slot;
    this.radius = HERO.radius;
    this.ranged = this.heroDef.ranged;
    this.level = 1;
    this.xp = 0;
    this.points = 1;
    this.ranks = { Q: 0, W: 0, E: 0, R: 0 };
    this.abilityIds = { Q: this.heroDef.abilities[0], W: this.heroDef.abilities[1], E: this.heroDef.abilities[2], R: this.heroDef.abilities[3] };
    this.gold = 500;
    this.items = [];
    this.itemStats = {};
    this.activeCd = 0;
    this.damageMul = 1;
    this.cd = { Q: 0, W: 0, E: 0, R: 0 };
    this.dash = null;
    this.recall = null;
    this.respawnTimer = 0;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.cs = 0;
    this.damagedBy = new Map();
    this.stasisUntil = 0;
    this.empower = null;
    this.aggroTime = -99;
    this.intent = { mx: 0, mz: 0, attack: false, filter: null, target: null, cast: null, recall: false, active: false, spell: null };
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.model = heroModel(team, heroId, this.skin);
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.shieldMesh.position.y = 1.2;
    this.shieldMesh.visible = false;
    this.stasisMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 2.8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.stasisMesh.position.y = 1.4;
    this.stasisMesh.visible = false;
    this.recallMesh = discDecal(TEAM_GLOW[team], 1.4, 0.35);
    this.recallMesh.visible = false;
    this.model.group.add(this.shieldMesh, this.stasisMesh, this.recallMesh);
    // кольцо под героем: зелёное у игрока, цвет команды у остальных
    this.model.group.add(ringDecal(isPlayer ? 0x6dff8a : TEAM_COLOR[team], 1.05, isPlayer ? 0.6 : 0.45, 0.12));
    game.scene.add(this.model.group);
  }

  get name() { return this.heroDef.name; }
  lvlStat(key) { const [b, g] = this.heroDef[key]; return b + g * (this.level - 1); }
  item(stat) { return this.itemStats[stat] ?? 0; }

  get maxHp() { return (this.lvlStat('hp') + this.item('hp')) * (this.talent === 'fortitude' ? 1.08 : 1); }
  get maxMana() { return this.lvlStat('mana') + this.item('mana'); }
  get manaRegen() {
    return (this.heroDef.manaRegen + this.level * 0.15 + (this.hasBuff('blue') ? 4 : 0)) * (this.talent === 'wisdom' ? 1.3 : 1);
  }
  get ad() { return this.lvlStat('ad') + this.item('ad'); }
  get ap() { return this.item('ap'); }
  get armor() { return this.lvlStat('armor') + this.item('armor') + this.buffStat('armor'); }
  get mr() { return this.lvlStat('mr') + this.item('mr') + this.buffStat('mr'); }
  get attackSpeed() {
    const [b, g] = this.heroDef.as;
    const talent = this.talent === 'swiftness' ? 0.12 : 0;
    return Math.min(2.5, b * (1 + g * (this.level - 1) + this.item('as') + this.buffStat('as') + talent));
  }
  get range() { return this.heroDef.range; }
  get baseSpeed() {
    return this.heroDef.speed + this.item('speed') + this.buffStat('speed') + (this.talent === 'swiftness' ? 0.4 : 0);
  }
  get crit() { return Math.min(1, this.item('crit')); }
  get lifesteal() { return this.item('lifesteal'); }
  get cdr() { return Math.min(0.45, this.item('cdr') + (this.hasBuff('blue') ? 0.2 : 0) + (this.talent === 'wisdom' ? 0.1 : 0)); }
  get regen() {
    return this.heroDef.regen + this.level * 0.3 + this.item('regen') + (this.hasBuff('blue') ? 5 : 0) + (this.talent === 'fortitude' ? 2 : 0);
  }
  get outMul() {
    const dragons = this.game.dragonStacks[this.team] ?? 0;
    return this.damageMul * (1 + dragons * 0.08) * (this.hasBuff('red') ? 1.15 : 1) * (this.talent === 'onslaught' ? 1.08 : 1);
  }
  get inStasis() { return this.game.time < this.stasisUntil; }
  get barHeight() { return 3.2; }

  get inBase() {
    return Math.hypot(this.pos.x - side(this.team) * MAP.fountainX, this.pos.z) < MAP.baseRadius;
  }

  recomputeItems() {
    const s = {};
    for (const id of this.items) for (const [k, v] of Object.entries(ITEMS[id].stats)) s[k] = (s[k] ?? 0) + v;
    const before = this.maxHp, beforeMana = this.maxMana;
    this.itemStats = s;
    if (this.maxHp > before) this.hp += this.maxHp - before;
    if (this.maxMana > beforeMana) this.mana += this.maxMana - beforeMana;
    this.hp = Math.min(this.hp, this.maxHp);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  hasItem(id) { return this.items.includes(id); }
  get activeItem() { return this.items.find((id) => ITEMS[id].active) ?? null; }

  // --- уровни и очки умений ---
  gainXp(amount) {
    if (this.level >= HERO.maxLevel) return;
    this.xp += amount;
    while (this.level < HERO.maxLevel && this.xp >= HERO.xpToLevel(this.level)) {
      this.xp -= HERO.xpToLevel(this.level);
      const before = this.maxHp, beforeMana = this.maxMana;
      this.level++;
      this.points++;
      this.hp += this.maxHp - before;
      this.mana += this.maxMana - beforeMana;
      this.game.emit('levelup', this);
    }
  }

  canRankUp(key) {
    if (this.points <= 0) return false;
    if (key === 'R') return this.ranks.R < HERO.ultLevels.filter((l) => l <= this.level).length;
    // обычное умение: не выше 4 ранга и не больше половины уровня (округление вверх)
    return this.ranks[key] < HERO.basicMaxRank && this.ranks[key] < Math.ceil(this.level / 2);
  }

  rankUp(key) {
    if (!this.canRankUp(key)) return false;
    this.ranks[key]++;
    this.points--;
    this.game.emit('rankup', { hero: this, key });
    return true;
  }

  gainGold(amount, show = true) {
    this.gold += amount;
    if (show && amount >= 5) this.game.emit('float', { unit: this, text: `+${Math.round(amount)}`, kind: 'gold' });
  }

  ability(key) { return ABILITIES[this.abilityIds[key]]; }

  manaCost(key) {
    const r = this.ranks[key];
    return r ? this.ability(key).mana[r - 1] : 0;
  }

  // Почему умение сейчас нельзя применить; null — можно. Одна проверка и для игры, и для подсказок.
  castBlock(key) {
    if (!this.alive) return 'dead';
    if (!this.canAct) return 'control';
    if (this.ranks[key] === 0) return 'unlearned';
    if (this.cd[key] > 0) return 'cooldown';
    if (this.mana < this.manaCost(key)) return 'mana';
    return null;
  }

  abilityReady(key) { return this.castBlock(key) === null; }

  // Отказ на команду игрока (боты вызывают cast напрямую и сюда не попадают)
  rejectCast(key) {
    const reason = this.castBlock(key);
    if (!reason) return;
    const control = this.stunned ? 'stun' : this.knock ? 'knock' : this.inStasis ? 'stasis' : null;
    this.game.emit('castrejected', { hero: this, key, reason, control });
  }

  // Цель обычной атаки, которую герой сейчас бьёт или к которой идёт; null — не атакует.
  // Невидимую команде цель не возвращает, чтобы маркер не выдавал врагов в тумане.
  get attackTarget() {
    const t = this.target;
    if (!this.alive || !this.intent.attack || !t) return null;
    if (!t.canBeHitBy(this.team) || !this.game.isVisible(this.team, t)) return null;
    return t;
  }

  spellReady(id) { return this.canAct && this.spells.includes(id) && this.spellCd[id] <= 0; }

  castSpell(id, aim = null) {
    if (!this.spellReady(id)) return false;
    if (!this.game.castSpell(this, id, aim)) return false;
    this.spellCd[id] = SPELLS[id].cooldown;
    this.revealUntil = this.game.time + 1.2;
    this.game.emit('spell', { hero: this, id });
    return true;
  }

  // Ближайший видимый враг для умения: сначала герой, потом всё остальное
  aimTarget(range, heroOnly = false) {
    let best = null, bestD = Infinity;
    for (const u of this.game.units) {
      if (!u.canBeHitBy(this.team) || u.isStructure) continue;
      if (heroOnly && u.kind !== 'hero') continue;
      if (!this.game.isVisible(this.team, u)) continue;
      const d = dist(this.pos, u.pos) - u.radius;
      if (d > range) continue;
      const score = u.kind === 'hero' ? d - 100 : d;
      if (score < bestD) { bestD = score; best = u; }
    }
    return best;
  }

  // Цель для обычной атаки; filter: null (сначала герои), 'creep', 'tower'
  pickAttackTarget(filter = null) {
    const reach = this.range + 3;
    const cur = this.target;
    let enemyHero = null, best = null, bestScore = Infinity;
    for (const u of this.game.units) {
      if (!u.canBeHitBy(this.team)) continue;
      if (!this.game.isVisible(this.team, u)) continue;
      if (filter === 'creep' && u.kind !== 'creep' && u.kind !== 'monster') continue;
      if (filter === 'tower' && !u.isStructure) continue;
      const d = this.edgeDist(u);
      if (d > reach + (filter === 'tower' ? 4 : 0)) continue;
      if (!filter && u.kind === 'hero' && d <= this.range + 1) enemyHero = u;
      let score = d;
      if (u.kind === 'creep' || u.kind === 'monster') score += u.hp / u.maxHp * 3 - (u.hp <= this.ad ? 4 : 0);
      if (u.isStructure) score += filter === 'tower' ? 0 : 6;
      if (u === cur) score -= 1.5;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return enemyHero || best;
  }

  cast(key, aim = null) {
    if (!this.abilityReady(key)) return false;
    const id = this.abilityIds[key];
    const cost = this.manaCost(key);
    const ok = this.game.castAbility(this, id, this.ranks[key], aim);
    if (!ok) return false;
    this.mana -= cost;
    this.cancelRecall();
    const def = ABILITIES[id];
    this.cd[key] = def.cooldown[this.ranks[key] - 1] * (1 - this.cdr);
    this.anim = 0.3;
    this.revealUntil = this.game.time + 1.2;
    this.game.emit('cast', { hero: this, key, id });
    return true;
  }

  useActive() {
    const id = this.activeItem;
    if (!id || this.activeCd > 0 || !this.alive || this.stunned) return false;
    const a = ITEMS[id].active;
    if (id === 'hourglass') {
      this.stasisUntil = this.game.time + a.duration;
      this.cancelRecall();
    }
    this.activeCd = a.cooldown;
    this.game.emit('active', { hero: this, id });
    return true;
  }

  startRecall() {
    if (!this.canAct || this.recall || this.inBase) return;
    this.recall = { t: HERO.recallTime };
    this.recallMesh.visible = true;
  }

  cancelRecall() {
    if (this.recall) { this.recall = null; this.recallMesh.visible = false; }
  }

  respawn() {
    this.alive = true;
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.shield = 0;
    this.dots = [];
    this.slows = [];
    this.knock = null;
    this.stunUntil = 0;
    this.pos.x = side(this.team) * MAP.fountainX;
    this.pos.z = (this.slot - 1) * 2;
    this.target = null;
    this.dash = null;
    const g = this.model.group;
    g.visible = true;
    g.rotation.x = 0;
    g.position.y = 0;
    this.game.emit('respawn', this);
  }

  update(dt) {
    if (!this.alive) {
      // нажатие умения, пока герой мёртв, — отказ, а не бросок после возрождения
      if (this.intent.cast) { this.rejectCast(this.intent.cast.key); this.intent.cast = null; }
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }
    this.updateStatus(dt);
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    for (const k in this.spellCd) this.spellCd[k] = Math.max(0, this.spellCd[k] - dt);
    this.activeCd = Math.max(0, this.activeCd - dt);
    this.mana = Math.min(this.maxMana, this.mana + this.manaRegen * dt);
    this.hp = Math.min(this.maxHp, this.hp + this.regen * dt * (this.game.time - this.lastDamagedAt > 5 ? 2 : 1));

    const it = this.intent;
    if (it.active) { this.useActive(); it.active = false; }
    if (!this.canAct) {
      if (it.cast) this.rejectCast(it.cast.key);
      it.cast = null;
      it.spell = null;
      this.dash = null;
      this.moving = !!this.knock;
      return;
    }
    if (it.cast) {
      if (this.abilityReady(it.cast.key)) this.cast(it.cast.key, it.cast.aim);
      else this.rejectCast(it.cast.key);
      it.cast = null;
    }
    if (it.spell) { this.castSpell(it.spell.id, it.spell.aim); it.spell = null; }
    if (it.recall) { this.startRecall(); it.recall = false; }

    this.moving = false;
    if (this.dash) {
      this.pos.x += this.dash.vx * dt;
      this.pos.z += this.dash.vz * dt;
      this.dash.t -= dt;
      if (this.dash.onTick) this.dash.onTick();
      if (this.dash && this.dash.t <= 0) this.dash = null;
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
        const t = it.target && it.target.canBeHitBy(this.team) ? it.target : this.pickAttackTarget(it.filter);
        this.target = t;
        if (t) {
          this.cancelRecall();
          if (!this.tryAttack(t)) this.moveToward(t.pos.x, t.pos.z, dt, t.radius + this.radius + this.range - 0.3);
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
          this.pos.z = (this.slot - 1) * 2;
          this.game.emit('recalled', this);
        }
      }
    }
  }

  syncMesh(dt = 0) {
    super.syncMesh();
    const m = this.model;
    const t = this.game.time;
    if (m.mixer) {
      // скелетная модель: выбираем анимацию по состоянию
      let state = 'Idle';
      if (this.game.over && this.game.winner === this.team) state = 'Dance';
      else if (this.anim > 0) state = 'Punch';
      else if (this.moving) state = 'Running';
      else if (this.recall) state = 'Wave';
      m.play(state, this.speed / 7);
      m.mixer.update(this.stunned ? dt * 0.2 : dt);
    } else {
      const bob = this.moving ? Math.abs(Math.sin(t * 11)) * 0.12 : Math.sin(t * 2) * 0.03;
      m.group.position.y = bob;
      m.weapon.rotation.x = this.anim > 0 ? -0.9 : (this.moving ? Math.sin(t * 11) * 0.25 : 0);
    }
    m.orb.scale.setScalar(this.anim > 0 ? 1.8 : 1 + Math.sin(t * 4) * 0.1);
    this.shieldMesh.visible = this.shield > 0;
    this.stasisMesh.visible = this.inStasis;
    if (this.recall) this.recallMesh.scale.setScalar(1 - this.recall.t / HERO.recallTime + 0.2);
  }
}

export class Creep extends Unit {
  constructor(game, team, type, wave, zOffset) {
    const s = side(team);
    super(game, team, 'creep', s * (MAP.baseX - 10), zOffset);
    const st = CREEP[type];
    this.stats = st;
    this.creepType = type;
    const ranged = type === 'ranged';
    this.ranged = ranged;
    const grow = 1 + CREEP.growthPerWave * wave;
    this.baseHp = st.hp * grow;
    this.dmg = st.damage * grow;
    this.hp = this.baseHp;
    this.baseArmor = st.armor;
    this.baseMr = st.mr;
    this.radius = st.radius;
    this.laneZ = zOffset;
    this.thinkTimer = Math.random() * 0.3;
    this.forced = null;
    this.model = creepModel(team, type);
    game.scene.add(this.model.group);
  }

  get ad() { return this.dmg; }
  get range() { return this.stats.range; }
  get attackSpeed() { return 1 / this.stats.cooldown; }
  get baseSpeed() { return this.stats.speed; }
  get barHeight() { return this.creepType === 'super' ? 2.6 : 1.8; }

  update(dt) {
    this.updateStatus(dt);
    if (!this.canAct) { this.moving = false; return; }
    this.thinkTimer -= dt;
    if (this.forced && (!this.forced.canBeHitBy(this.team) || this.edgeDist(this.forced) > CREEP.aggroRange + 3)) this.forced = null;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.3;
      if (this.forced) this.target = this.forced;
      else if (!this.target || !this.target.canBeHitBy(this.team) || this.edgeDist(this.target) > CREEP.aggroRange + 1.5
        || !this.game.isVisible(this.team, this.target)) {
        this.target = this.game.nearestEnemy(this, CREEP.aggroRange, (u) => u.kind !== 'monster' && this.game.isVisible(this.team, u));
      }
    }
    const t = this.target;
    if (t && t.canBeHitBy(this.team)) {
      if (!this.tryAttack(t)) this.moveToward(t.pos.x, t.pos.z, dt, t.radius + this.radius + this.range - 0.2);
    } else {
      const goalX = -side(this.team) * (MAP.baseX - 3);
      this.moveToward(goalX, this.laneZ, dt, 0.5);
    }
  }

  syncMesh() {
    super.syncMesh();
    const t = this.game.time + this.id;
    this.model.group.position.y = this.moving ? Math.abs(Math.sin(t * 12)) * 0.1 : 0;
  }
}

export class Monster extends Unit {
  constructor(game, kind, x, z, minute) {
    super(game, TEAM.NEUTRAL, 'monster', x, z);
    const def = MONSTERS[kind];
    this.def = def;
    this.monsterKind = kind;
    this.camp = { x, z };
    const grow = 1 + MONSTERS.growthPerMinute * minute;
    this.baseHp = def.hp * grow;
    this.hp = this.baseHp;
    this.dmg = def.damage * grow;
    this.baseArmor = def.armor;
    this.baseMr = def.mr;
    this.radius = def.radius;
    this.facing = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.aggro = null;
    this.resetting = false;
    this.model = monsterModel(kind);
    game.scene.add(this.model.group);
  }
  get ad() { return this.dmg; }
  get range() { return this.def.range; }
  get attackSpeed() { return 1 / this.def.cooldown; }
  get baseSpeed() { return 5.5; }
  get barHeight() { return this.monsterKind === 'dragon' ? 4.6 : 3.2; }
  get name() { return this.def.name; }

  onAttacked(source) {
    if (source && source.alive && !this.resetting && source.team !== TEAM.NEUTRAL) this.aggro = source;
  }

  update(dt) {
    this.updateStatus(dt);
    if (!this.canAct) return;
    const home = dist(this.pos, this.camp);
    if (this.resetting) {
      if (this.moveToward(this.camp.x, this.camp.z, dt, 0.3)) {
        this.resetting = false;
        this.hp = this.maxHp;
        this.facing = this.camp.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
      return;
    }
    const a = this.aggro;
    if (a && (!a.alive || dist(a.pos, this.camp) > MONSTERS.leash + 3 || home > MONSTERS.leash)) {
      this.aggro = null;
      this.resetting = true;
      return;
    }
    if (a) {
      if (!this.tryAttack(a)) this.moveToward(a.pos.x, a.pos.z, dt, a.radius + this.radius + this.range - 0.3);
    } else if (home > 0.5) {
      this.moveToward(this.camp.x, this.camp.z, dt, 0.3);
    } else {
      this.moving = false;
      if (this.game.time - this.lastDamagedAt > 4) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.05 * dt);
    }
  }

  syncMesh() {
    super.syncMesh();
    const t = this.game.time;
    this.model.orb.scale.setScalar(1 + Math.sin(t * 3 + this.id) * 0.15);
    if (this.model.wings) {
      const f = Math.sin(t * (this.aggro ? 8 : 2)) * 0.35;
      this.model.wings[0].rotation.z = f;
      this.model.wings[1].rotation.z = -f;
    }
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
    this.baseArmor = TOWER.armor;
    this.baseMr = TOWER.mr;
    this.radius = TOWER.radius;
    this.heroStreak = 0;
    this.forced = null;
    this.model = towerModel(team);
    this.rangeRing = ringDecal(TEAM_GLOW[team], TOWER.range + this.radius, 0.0, 0.05);
    this.model.group.add(this.rangeRing);
    game.scene.add(this.model.group);
  }

  get range() { return TOWER.range; }
  get barHeight() { return 8; }
  get invulnerable() { return this.game.structureProtected(this); }

  update(dt) {
    this.updateStatus(dt);
    // башня видит всё в своём радиусе, даже в кустах
    const valid = (u) => u && u.canBeHitBy(this.team) && u.kind !== 'monster' && this.inRange(u);
    if (this.forced && !valid(this.forced)) this.forced = null;
    if (this.forced) this.target = this.forced;
    if (!valid(this.target)) {
      this.target = this.game.nearestEnemy(this, this.range, (u) => u.kind === 'creep')
        || this.game.nearestEnemy(this, this.range, (u) => u.kind === 'hero');
      this.heroStreak = 0;
    }
    if (this.target && this.atkTimer <= 0) {
      const t = this.target;
      this.atkTimer = TOWER.cooldown;
      let dmg = TOWER.damage;
      if (t.kind === 'hero') { dmg *= 1 + this.heroStreak * TOWER.heroRampPerShot; this.heroStreak++; } else this.heroStreak = 0;
      const onHit = (u) => { u.takeDamage(dmg, 'physical', this); this.game.hitSpark(u, TEAM_GLOW[this.team]); };
      this.game.addProjectile(new Homing(this.game, this, t, onHit, { speed: 26, size: 0.38, y: 6.5 }));
      this.game.emit('towershot', this);
    }
  }

  syncMesh() {
    super.syncMesh();
    this.model.crystal.rotation.y += 0.02;
    const p = this.game.player;
    const near = p && p.alive && p.team !== this.team && dist(p.pos, this.pos) < this.range + 6;
    const m = this.rangeRing.material;
    m.opacity += ((near ? (this.target === p ? 0.75 : 0.35) : 0) - m.opacity) * 0.15;
    m.color.set(this.target === p ? 0xff3030 : TEAM_GLOW[this.team]);
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

// Ингибитор: пока он разрушен, у врага в каждой волне идёт супер-крип. Восстанавливается сам.
export class Inhibitor extends Unit {
  constructor(game, team, x, hp, order) {
    super(game, team, 'inhib', x, 0);
    this.static = true;
    this.order = order;
    this.baseHp = hp;
    this.hp = hp;
    this.baseArmor = INHIB.armor;
    this.baseMr = INHIB.mr;
    this.radius = INHIB.radius;
    this.respawnTimer = 0;
    this.model = inhibModel(team);
    game.scene.add(this.model.group);
  }
  get invulnerable() { return this.game.structureProtected(this); }
  get barHeight() { return 4.2; }
  update(dt) {
    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.alive = true;
        this.hp = this.maxHp;
        this.model.crystal.visible = true;
        this.game.emit('inhibrespawn', this);
      }
      return;
    }
    this.updateStatus(dt);
  }
  syncMesh() {
    super.syncMesh();
    this.model.crystal.rotation.y = this.game.time * 1.2;
  }
  die(killer) {
    super.die(killer);
    this.respawnTimer = INHIB.respawn;
    this.everDestroyed = true;
    this.model.crystal.visible = false;
  }
}

// Тренировочный манекен: не бьёт в ответ и не умирает
export class Dummy extends Unit {
  constructor(game, x, z) {
    super(game, TEAM.RED, 'dummy', x, z);
    this.static = true;
    this.baseHp = 3000;
    this.hp = 3000;
    this.baseArmor = 30;
    this.baseMr = 30;
    this.radius = 0.7;
    this.facing = -Math.PI / 2;
    this.model = dummyModel();
    game.scene.add(this.model.group);
  }
  get barHeight() { return 2.4; }
  get name() { return 'Манекен'; }
  update(dt) {
    this.updateStatus(dt);
    if (this.game.time - this.lastDamagedAt > 3) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5 * dt);
  }
}

export class Nexus extends Unit {
  constructor(game, team, x, hp, order) {
    super(game, team, 'nexus', x, 0);
    this.static = true;
    this.order = order;
    this.baseHp = hp;
    this.hp = hp;
    this.baseArmor = NEXUS.armor;
    this.baseMr = NEXUS.mr;
    this.radius = NEXUS.radius;
    this.model = nexusModel(team);
    game.scene.add(this.model.group);
  }
  get invulnerable() { return this.game.structureProtected(this); }
  get barHeight() { return 6.6; }
  update(dt) { this.updateStatus(dt); }
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
  constructor(game, owner, target, onHit, opts = {}) {
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.target = target;
    this.onHit = onHit;
    this.speed = opts.speed ?? 22;
    this.pos = { x: owner.pos.x, y: opts.y ?? 1.4, z: owner.pos.z };
    this.mesh = opts.arrow ? arrowModel(opts.color ?? 0xffffff) : projectileModel(opts.color ?? TEAM_GLOW[owner.team], opts.size ?? 0.2);
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
      if (t.canBeHitBy(this.team)) this.onHit(t);
      this.done = true;
      return;
    }
    this.pos.x += dx / d * step; this.pos.y += dy / d * step; this.pos.z += dz / d * step;
    this.mesh.lookAt(t.pos.x, ty, t.pos.z);
  }
  sync() { this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z); }
  dispose() { this.game.scene.remove(this.mesh); }
}

// Снаряд по прямой: бьёт первого врага или всех на пути (pierce)
export class Skillshot {
  constructor(game, owner, dir, opts) {
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.dir = dir;
    this.opts = opts; // { range, speed, width, pierce, heroOnly, color, size, onHit }
    this.left = opts.range;
    this.hit = new Set();
    this.pos = { x: owner.pos.x + dir.x * 0.8, y: 1.4, z: owner.pos.z + dir.z * 0.8 };
    this.mesh = opts.arrow ? arrowModel(opts.color, 2) : projectileModel(opts.color, opts.size ?? 0.42);
    this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    this.done = false;
    game.scene.add(this.mesh);
  }
  update(dt) {
    const o = this.opts;
    const step = o.speed * dt;
    this.pos.x += this.dir.x * step;
    this.pos.z += this.dir.z * step;
    this.left -= step;
    for (const u of this.game.units) {
      if (!u.canBeHitBy(this.team) || u.isStructure || this.hit.has(u)) continue;
      if (o.heroOnly && u.kind !== 'hero') continue;
      if (dist(this.pos, u.pos) <= u.radius + o.width) {
        this.hit.add(u);
        o.onHit(u, this);
        if (!o.pierce) { this.done = true; return; }
      }
    }
    if (this.left <= 0) this.done = true;
  }
  sync() {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (!this.opts.arrow) this.mesh.rotation.x += 0.3;
  }
  dispose() { this.game.scene.remove(this.mesh); }
}

// Удар по области с задержкой и кругом-предупреждением
export class AreaStrike {
  constructor(game, owner, x, z, opts) {
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.x = x; this.z = z;
    this.opts = opts; // { radius, delay, color, onHit, falling }
    this.t = opts.delay;
    this.ring = ringDecal(opts.color, opts.radius, 0.85, 0.08);
    this.ring.position.set(x, 0.07, z);
    this.disc = discDecal(opts.color, opts.radius, 0.2);
    this.disc.position.set(x, 0.06, z);
    this.rock = opts.falling ? projectileModel(opts.color, 0.9) : null;
    this.done = false;
    game.scene.add(this.ring, this.disc);
    if (this.rock) game.scene.add(this.rock);
  }
  update(dt) {
    this.t -= dt;
    if (this.t <= 0) {
      for (const u of [...this.game.units]) {
        if (!u.canBeHitBy(this.team) || u.isStructure) continue;
        if (Math.hypot(u.pos.x - this.x, u.pos.z - this.z) <= this.opts.radius + u.radius) this.opts.onHit(u);
      }
      this.game.burst(this.x, this.z, this.opts.color, this.opts.radius * 1.1);
      this.game.emit('boom', { x: this.x, z: this.z, big: this.opts.radius >= 4 });
      if (this.opts.radius >= 4) this.game.shake(0.35);
      this.done = true;
    }
  }
  sync() {
    const k = Math.max(0, this.t / this.opts.delay);
    if (this.rock) this.rock.position.set(this.x - k * 6, 0.5 + k * 22, this.z);
    this.disc.scale.setScalar(1 - k * 0.8);
  }
  dispose() {
    this.game.scene.remove(this.ring, this.disc);
    if (this.rock) this.game.scene.remove(this.rock);
  }
}

// Вспышка: расширяющаяся и тающая сфера
const burstGeo = new THREE.IcosahedronGeometry(1, 1);
export class Burst {
  constructor(game, x, y, z, color, size, life = 0.35) {
    this.game = game;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.mesh = new THREE.Mesh(burstGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
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
    this.mesh.material.dispose();
  }
}

// Анимация смерти: модель падает и уходит под землю
export class DeathAnim {
  constructor(game, unit, removeAfter) {
    this.game = game;
    this.model = unit.model;
    this.group = unit.model.group;
    this.removeAfter = removeAfter;
    this.t = 0;
    this.skeletal = !!unit.model.mixer;
    this.life = this.skeletal ? 1.8 : 0.9;
    this.dir = Math.random() > 0.5 ? 1 : -1;
    this.done = false;
    if (this.skeletal) this.model.play('Death');
  }
  update(dt) {
    this.t += dt;
    if (this.skeletal) this.model.mixer.update(dt);
    if (this.t >= this.life) this.done = true;
  }
  sync() {
    const k = Math.min(1, this.t / this.life);
    if (this.skeletal) { this.group.position.y = k > 0.7 ? -(k - 0.7) * 3 : 0; return; }
    this.group.rotation.z = this.dir * Math.min(1, k * 2.5) * 1.45;
    this.group.position.y = k > 0.5 ? -(k - 0.5) * 3 : 0;
  }
  dispose() {
    if (this.removeAfter) this.game.scene.remove(this.group);
    else { this.group.visible = false; this.group.rotation.z = 0; this.group.position.y = 0; }
  }
}
