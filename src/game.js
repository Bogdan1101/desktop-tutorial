// Состояние матча и игровой цикл. Логика отделена от отрисовки,
// поэтому матч можно прокручивать без экрана (для тестов).
import {
  TEAM, STRUCTURES, CREEP, HERO, MAP, FOUNTAIN, ITEMS, MAX_ITEMS, DIFFICULTY, side,
} from './config.js';
import { Hero, Creep, Tower, Nexus, Burst, dist } from './units.js';
import { clampToWalkable } from './world.js';
import { HeroBrain } from './ai.js';

export class Game {
  constructor(scene, { difficulty = 'normal', autoplay = false } = {}) {
    this.scene = scene;
    this.diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    this.units = [];
    this.projectiles = [];
    this.effects = [];
    this.listeners = {};
    this.time = 0;
    this.nextId = 1;
    this.wave = 0;
    this.nextWave = CREEP.firstWave;
    this.kills = [0, 0];
    this.over = false;
    this.winner = null;
    this.shakeAmount = 0;

    for (const team of [TEAM.BLUE, TEAM.RED]) {
      for (const st of STRUCTURES) {
        const x = team === TEAM.BLUE ? st.x : -st.x; // st.x задан для синих
        const u = st.kind === 'tower' ? new Tower(this, team, x, st.hp, st.order) : new Nexus(this, team, x, st.hp, st.order);
        this.units.push(u);
      }
    }

    this.player = new Hero(this, TEAM.BLUE, -MAP.fountainX, 0, true);
    this.enemy = new Hero(this, TEAM.RED, MAP.fountainX, 0, false);
    this.enemy.damageMul = this.diff.damageMul;
    this.units.push(this.player, this.enemy);

    this.brains = [new HeroBrain(this, this.enemy, this.diff)];
    if (autoplay) this.brains.push(new HeroBrain(this, this.player, DIFFICULTY.normal));
  }

  on(name, fn) { (this.listeners[name] ??= []).push(fn); }
  emit(name, data) { for (const fn of this.listeners[name] ?? []) fn(data); }

  heroOf(team) { return team === TEAM.BLUE ? this.player : this.enemy; }

  nearestEnemy(unit, range, filter) {
    let best = null, bestD = Infinity;
    for (const u of this.units) {
      if (!u.canBeHitBy(unit.team)) continue;
      if (filter && !filter(u)) continue;
      const d = unit.edgeDist(u);
      if (d <= range && d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  // Здание неуязвимо, пока стоит предыдущее здание этой команды
  structureProtected(s) {
    return this.units.some((u) => u.alive && u.isStructure && u.team === s.team && u.order < s.order);
  }

  // Нападение на героя под башней или рядом со своими крипами притягивает их агрессию
  onHeroHitHero(attacker, victim) {
    attacker.aggroTime = this.time;
    for (const u of this.units) {
      if (!u.alive || u.team !== victim.team) continue;
      if (u.kind === 'tower' && u.inRange(attacker)) u.forced = attacker;
      if (u.kind === 'creep' && dist(u.pos, victim.pos) < 10 && u.edgeDist(attacker) < CREEP.aggroRange) u.forced = attacker;
    }
  }

  onDeath(unit, killer) {
    const enemyTeam = 1 - unit.team;
    const enemyHero = this.heroOf(enemyTeam);
    const nearEnemyHero = enemyHero.alive && dist(enemyHero.pos, unit.pos) < 16;
    if (unit.kind === 'creep') {
      if (killer === enemyHero) enemyHero.gainGold(unit.stats.gold);
      if (nearEnemyHero) enemyHero.gainXp(unit.stats.xp);
      this.burst(unit.pos.x, unit.pos.z, 0x888888, 0.9);
    } else if (unit.kind === 'hero') {
      unit.deaths++;
      unit.respawnTimer = HERO.respawn(unit.level);
      unit.cancelRecall();
      unit.dash = null;
      unit.model.group.visible = false;
      this.kills[enemyTeam]++;
      if (killer === enemyHero || nearEnemyHero) {
        enemyHero.kills++;
        enemyHero.gainGold(HERO.killGold);
        enemyHero.gainXp(HERO.killXp(unit.level));
      }
      this.burst(unit.pos.x, unit.pos.z, 0xffffff, 2);
      this.emit('herokill', { victim: unit, killer });
    } else if (unit.kind === 'tower') {
      enemyHero.gainGold(150);
      enemyHero.gainXp(120);
      this.burst(unit.pos.x, unit.pos.z, 0xffd27a, 4);
      this.shake(0.5);
      this.emit('structure', unit);
    } else if (unit.kind === 'nexus') {
      this.burst(unit.pos.x, unit.pos.z, 0xffffff, 8);
      this.shake(1);
      this.over = true;
      this.winner = enemyTeam;
      this.emit('gameover', enemyTeam);
    }
  }

  buy(hero, id) {
    const item = ITEMS.find((i) => i.id === id);
    if (!item || !hero.alive || !hero.inBase || hero.gold < item.cost) return false;
    if (item.unique && hero.items.includes(id)) return false;
    if (hero.items.length >= MAX_ITEMS) return false;
    hero.gold -= item.cost;
    hero.items.push(id);
    item.apply(hero);
    this.emit('bought', { hero, item });
    return true;
  }

  spawnWave() {
    for (const team of [TEAM.BLUE, TEAM.RED]) {
      const s = side(team);
      const add = (ranged, i, row) => {
        const z = (i - (ranged ? 0.5 : 1)) * 1.6;
        const c = new Creep(this, team, ranged, this.wave, z);
        c.pos.x = s * (MAP.baseX - 10 + row * 1.6);
        this.units.push(c);
      };
      for (let i = 0; i < CREEP.meleeCount; i++) add(false, i, 0);
      for (let i = 0; i < CREEP.rangedCount; i++) add(true, i, 1);
    }
    this.wave++;
  }

  update(dt) {
    if (this.over) { this.updateFx(dt); return; }
    this.time += dt;
    if (this.time >= this.nextWave) {
      this.spawnWave();
      this.nextWave += CREEP.waveInterval;
    }
    for (const h of [this.player, this.enemy]) if (h.alive) h.gold += HERO.passiveGold * dt;
    for (const b of this.brains) b.update(dt);
    for (const u of this.units) if (u.alive) u.update(dt);
    // мёртвые герои тоже обновляются (таймер возрождения)
    for (const h of [this.player, this.enemy]) if (!h.alive) h.update(dt);
    this.resolveCollisions(dt);
    this.fountains(dt);
    for (const p of this.projectiles) p.update(dt);
    this.updateFx(dt);

    // убрать погибших крипов
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!u.alive && u.kind === 'creep') { u.removeMesh(); this.units.splice(i, 1); }
    }
  }

  updateFx(dt) {
    for (const e of this.effects) e.update(dt);
    this.projectiles = this.projectiles.filter((p) => (p.done ? (p.dispose(), false) : true));
    this.effects = this.effects.filter((e) => (e.done ? (e.dispose(), false) : true));
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2);
  }

  resolveCollisions(dt) {
    const mobile = this.units.filter((u) => u.alive && !u.static);
    const statics = this.units.filter((u) => u.alive && u.static);
    for (let i = 0; i < mobile.length; i++) {
      const a = mobile[i];
      for (let j = i + 1; j < mobile.length; j++) {
        const b = mobile[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const nx = d2 ? dx / d : 1, nz = d2 ? dz / d : 0;
        // рывок не толкают
        const wa = a.dash ? 0 : b.dash ? 2 : 1;
        const wb = b.dash ? 0 : a.dash ? 2 : 1;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * wb; b.pos.z += nz * push * wb;
      }
      for (const s of statics) {
        const dx = a.pos.x - s.pos.x, dz = a.pos.z - s.pos.z;
        const min = a.radius + s.radius;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const nx = d ? dx / d : 0, nz = d ? dz / d : 1;
        a.pos.x = s.pos.x + nx * min;
        a.pos.z = s.pos.z + nz * min;
        // обходить здание сбоку, а не упираться в него
        if (a.moving && a.moveDir.x * nx + a.moveDir.z * nz < -0.6) {
          // уходить в ту сторону, где уже стоим (или по чётности id, если ровно по центру)
          const sgn = nz > 0.05 ? 1 : nz < -0.05 ? -1 : (a.id % 2 ? 1 : -1);
          let tx = -nz, tz = nx;
          if (tz * sgn < 0) { tx = -tx; tz = -tz; }
          a.pos.x += tx * a.speed * dt * 0.8;
          a.pos.z += tz * a.speed * dt * 0.8;
        }
      }
      clampToWalkable(a.pos);
    }
  }

  fountains(dt) {
    for (const h of [this.player, this.enemy]) {
      if (!h.alive) continue;
      const own = Math.hypot(h.pos.x - side(h.team) * MAP.fountainX, h.pos.z);
      const foe = Math.hypot(h.pos.x + side(h.team) * MAP.fountainX, h.pos.z);
      if (own < MAP.fountainRadius + 1) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * FOUNTAIN.healPerSec * dt);
      if (foe < MAP.fountainRadius + 3) h.takeDamage(FOUNTAIN.enemyDps * dt, null);
    }
  }

  addProjectile(p) { this.projectiles.push(p); }

  burst(x, z, color, size) { this.effects.push(new Burst(this, x, 1, z, color, size)); }
  hitSpark(target, color) {
    this.effects.push(new Burst(this, target.pos.x, target.isStructure ? 2 : 1.2, target.pos.z, color, 0.6, 0.18));
  }
  trail(hero) { this.effects.push(new Burst(this, hero.pos.x, 1, hero.pos.z, 0x9fe8ff, 1.4, 0.3)); }
  shake(a) { this.shakeAmount = Math.max(this.shakeAmount, a); }

  syncMeshes(dt) {
    for (const u of this.units) if (u.alive || u.isStructure) u.syncMesh(dt);
    for (const p of this.projectiles) p.sync();
    for (const e of this.effects) e.sync();
  }
}
