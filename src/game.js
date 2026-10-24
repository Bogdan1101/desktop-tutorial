// Состояние матча и игровой цикл. Логика отделена от отрисовки,
// поэтому матч можно прокручивать без экрана (для тестов).
import {
  TEAM, STRUCTURES, CREEP, HERO, HEROES, MAP, FOUNTAIN, ITEMS, MAX_ITEMS, DIFFICULTY, MONSTERS, BUFFS, VISION, side,
  TALENTS, PLANTS, STREAK_NAMES, SPREE_NAMES,
} from './config.js';
import { Hero, Creep, Tower, Inhibitor, Nexus, Monster, Dummy, Burst, DeathAnim, dist } from './units.js';
import { resolveTerrain, brushAt } from './nav.js';
import { castAbility, castSpell } from './abilities.js';
import { plantModel } from './models.js';
import { HeroBrain } from './ai.js';

const ROSTER = Object.keys(HEROES);

export class Game {
  constructor(scene, {
    difficulty = 'normal', mode = '3v3', heroId = 'pyro', autoplay = false,
    talent = 'onslaught', spells = ['flash', 'ignite'], skin = 'base',
  } = {}) {
    this.scene = scene;
    this.mode = mode; // 1v1 | 3v3 | practice
    this.practice = mode === 'practice' ? { waves: false, noCooldowns: false } : null;
    this.teamStats = [{ towers: 0, dragons: 0 }, { towers: 0, dragons: 0 }];
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
    this.dragonStacks = [0, 0];
    this.over = false;
    this.winner = null;
    this.shakeAmount = 0;
    this.visionTimer = 0;
    this.visible = [new Set(), new Set()];

    for (const team of [TEAM.BLUE, TEAM.RED]) {
      for (const st of STRUCTURES) {
        const x = team === TEAM.BLUE ? st.x : -st.x;
        const Cls = { tower: Tower, inhib: Inhibitor, nexus: Nexus }[st.kind];
        this.units.push(new Cls(this, team, x, st.hp, st.order));
      }
    }

    // Состав команд
    const others = ROSTER.filter((h) => h !== heroId);
    let blue, red;
    if (mode === 'practice') {
      blue = [heroId];
      red = [];
    } else if (mode === '1v1') {
      blue = [heroId];
      red = [others[Math.floor(Math.random() * others.length)]];
    } else {
      blue = [heroId, ...others];
      red = [...ROSTER].sort(() => Math.random() - 0.5);
    }
    this.heroes = [[], []];
    // ботам — случайный талант и заклинания под роль
    const botOpts = (id) => ({
      talent: Object.keys(TALENTS)[Math.floor(Math.random() * 4)],
      spells: ['flash', id === 'grok' ? 'heal' : Math.random() < 0.5 ? 'ignite' : 'barrier'],
    });
    blue.forEach((id, i) => this.heroes[0].push(new Hero(this, TEAM.BLUE, id, i === 0, blue.length === 1 ? 1 : i,
      i === 0 ? { talent, spells, skin } : botOpts(id))));
    red.forEach((id, i) => this.heroes[1].push(new Hero(this, TEAM.RED, id, false, red.length === 1 ? 1 : i, botOpts(id))));
    this.player = this.heroes[0][0];
    for (const h of this.heroes[1]) h.damageMul = this.diff.damageMul;
    this.allHeroes = [...this.heroes[0], ...this.heroes[1]];
    this.units.push(...this.allHeroes);

    // Боты. В 3 на 3 один бот в команде ходит в лес (лучше всего танк)
    this.brains = [];
    for (const team of [0, 1]) {
      const bots = this.heroes[team].filter((h) => !h.isPlayer || autoplay);
      let jungler = null;
      if (mode === '3v3') jungler = bots.find((h) => h.heroId === 'grok' && !h.isPlayer) ?? bots.find((h) => !h.isPlayer);
      for (const h of bots) {
        const diff = team === 1 ? this.diff : DIFFICULTY.normal;
        this.brains.push(new HeroBrain(this, h, diff, h === jungler ? 'jungle' : 'lane'));
      }
    }

    // Тренировка: манекены посреди линии
    if (mode === 'practice') {
      for (const [x, z] of [[-6, -2.5], [-3, 2], [0, -1]]) this.units.push(new Dummy(this, x, z));
    }

    // Лечебные растения
    this.plants = [];
    for (const [x, z] of PLANTS.spots) {
      for (const [px, pz] of [[x, z], [-x, -z]]) {
        const model = plantModel();
        model.group.position.set(px, 0, pz);
        model.group.visible = false;
        scene.add(model.group);
        this.plants.push({ x: px, z: pz, readyAt: PLANTS.first, model });
      }
    }

    // Лагеря монстров
    this.camps = [];
    for (const kind of ['red', 'blue', 'dragon']) {
      const m = MONSTERS[kind];
      const spots = m.single ? [[m.x, m.z]] : [[m.x, m.z], [-m.x, -m.z]];
      for (const [x, z] of spots) this.camps.push({ kind, x, z, timer: m.first, monster: null });
    }
  }

  on(name, fn) { (this.listeners[name] ??= []).push(fn); }
  emit(name, data) { for (const fn of this.listeners[name] ?? []) fn(data); }

  enemyHeroes(team) { return this.heroes[1 - team]; }

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

  structureProtected(s) {
    // после первого разрушения ингибитора нексус остаётся открытым, даже когда ингибитор восстановится
    return this.units.some((u) => u.alive && u.isStructure && u.team === s.team && u.order < s.order && !u.everDestroyed);
  }

  isVisible(team, unit) {
    if (team === TEAM.NEUTRAL || unit.team === team) return true;
    return this.visible[team].has(unit);
  }

  // Туман войны: что видит каждая команда. Из кустов видно наружу, но не внутрь.
  computeVision() {
    const brushOf = new Map();
    for (const u of this.units) if (u.alive && !u.static) brushOf.set(u, brushAt(u.pos.x, u.pos.z));
    for (const team of [TEAM.BLUE, TEAM.RED]) {
      const set = this.visible[team];
      set.clear();
      const sources = [];
      const ownBrushes = new Set();
      for (const u of this.units) {
        if (!u.alive || u.team !== team) continue;
        const r = VISION[u.kind] ?? 8;
        sources.push([u.pos.x, u.pos.z, r]);
        const b = brushOf.get(u);
        if (b !== undefined && b >= 0) ownBrushes.add(b);
      }
      sources.push([side(team) * MAP.fountainX, 0, MAP.baseRadius + 2]);
      for (const u of this.units) {
        if (!u.alive || u.team === team) continue;
        if (u.static) { set.add(u); continue; } // здания видно всегда
        const b = brushOf.get(u) ?? -1;
        if (b >= 0 && !ownBrushes.has(b) && this.time > u.revealUntil) continue;
        for (const [x, z, r] of sources) {
          if (Math.hypot(u.pos.x - x, u.pos.z - z) <= r) { set.add(u); break; }
        }
      }
    }
    this.visionSources = null;
  }

  onHeroHitHero(attacker, victim) {
    attacker.aggroTime = this.time;
    for (const u of this.units) {
      if (!u.alive || u.team !== victim.team) continue;
      if (u.kind === 'tower' && u.inRange(attacker)) u.forced = attacker;
      if (u.kind === 'creep' && dist(u.pos, victim.pos) < 10 && u.edgeDist(attacker) < CREEP.aggroRange) u.forced = attacker;
    }
  }

  shareXp(team, pos, amount) {
    const near = this.heroes[team].filter((h) => h.alive && dist(h.pos, pos) < HERO.xpShareRange);
    if (!near.length) return;
    const each = near.length === 1 ? amount : (amount * 1.3) / near.length;
    for (const h of near) h.gainXp(each);
  }

  onDeath(unit, killer) {
    const killerHero = killer && killer.kind === 'hero' ? killer : null;
    if (unit.kind === 'creep') {
      const enemyTeam = 1 - unit.team;
      const lastHit = killerHero && killerHero.team === enemyTeam ? killerHero : null;
      if (lastHit) { lastHit.gainGold(unit.stats.gold); lastHit.cs++; }
      // половина золота героям рядом, которые не добили
      const near = this.heroes[enemyTeam].filter((h) => h.alive && h !== lastHit && dist(h.pos, unit.pos) < HERO.nearbyGoldRange);
      for (const h of near) h.gainGold((unit.stats.gold * HERO.nearbyGoldShare) / near.length, false);
      this.shareXp(enemyTeam, unit.pos, unit.stats.xp);
      this.effects.push(new DeathAnim(this, unit, true));
    } else if (unit.kind === 'monster') {
      const def = unit.def;
      if (killerHero) {
        killerHero.gainGold(def.gold);
        killerHero.cs += 4;
        this.shareXp(killerHero.team, unit.pos, def.xp);
        if (def.buff === 'dragon') {
          this.dragonStacks[killerHero.team] = Math.min(4, this.dragonStacks[killerHero.team] + 1);
          this.teamStats[killerHero.team].dragons++;
          for (const h of this.heroes[killerHero.team]) if (h !== killerHero) h.gainGold(def.gold * 0.5);
        } else {
          killerHero.addBuff(def.buff, BUFFS[def.buff].duration);
        }
        this.emit('monster', { monster: unit, hero: killerHero });
      }
      const camp = this.camps.find((c) => c.monster === unit);
      if (camp) { camp.monster = null; camp.timer = def.respawn; }
      this.effects.push(new DeathAnim(this, unit, true));
    } else if (unit.kind === 'hero') {
      const enemyTeam = 1 - unit.team;
      unit.deaths++;
      unit.respawnTimer = HERO.respawn(unit.level);
      unit.cancelRecall();
      unit.dash = null;
      unit.shield = 0;
      this.kills[enemyTeam]++;
      // кто убил и кто помогал: все враги, бившие героя последние 10 секунд
      const recent = [...unit.damagedBy.entries()].filter(([h, t]) => this.time - t < 10 && h.team === enemyTeam).map(([h]) => h);
      const credit = killerHero && killerHero.team === enemyTeam ? killerHero : recent[recent.length - 1] ?? null;
      // за серию убийств жертвы — бонус, за серию её смертей — меньше золота
      const shutdown = unit.streak >= 3 ? Math.min(HERO.shutdownMax, (unit.streak - 2) * HERO.shutdownPerKill) : 0;
      const bounty = HERO.killGold * Math.max(0.4, 1 - 0.15 * unit.deathStreak) + shutdown;
      if (shutdown) this.emit('shutdown', { victim: unit, killer: credit, gold: shutdown });
      unit.streak = 0;
      unit.deathStreak++;
      unit.multi = 0;
      if (credit) {
        credit.kills++;
        credit.streak++;
        credit.deathStreak = 0;
        credit.multi = this.time - credit.lastKillAt < HERO.multiKillWindow ? credit.multi + 1 : 1;
        credit.lastKillAt = this.time;
        if (STREAK_NAMES[credit.multi]) this.emit('multikill', { hero: credit, text: STREAK_NAMES[credit.multi] });
        else if (SPREE_NAMES[credit.streak]) this.emit('multikill', { hero: credit, text: SPREE_NAMES[credit.streak] });
        credit.gainGold(bounty);
        const helpers = recent.filter((h) => h !== credit);
        for (const h of helpers) { h.assists++; h.gainGold(HERO.assistGold / helpers.length); }
      }
      this.shareXp(enemyTeam, unit.pos, HERO.killXp(unit.level));
      unit.damagedBy.clear();
      this.effects.push(new DeathAnim(this, unit, false));
      this.emit('herokill', { victim: unit, killer: credit });
    } else if (unit.kind === 'tower' || unit.kind === 'inhib') {
      const enemyTeam = 1 - unit.team;
      if (unit.kind === 'tower') this.teamStats[enemyTeam].towers++;
      for (const h of this.heroes[enemyTeam]) { h.gainGold(unit.kind === 'tower' ? 150 : 100); h.gainXp(100); }
      this.burst(unit.pos.x, unit.pos.z, 0xffd27a, 4);
      this.shake(0.5);
      this.emit('structure', unit);
    } else if (unit.kind === 'nexus') {
      this.burst(unit.pos.x, unit.pos.z, 0xffffff, 8);
      this.shake(1);
      this.over = true;
      this.winner = 1 - unit.team;
      this.emit('gameover', this.winner);
    }
  }

  // --- Лавка --------------------------------------------------------------------
  // Цена с учётом частей, которые уже есть у героя
  priceOf(hero, id) {
    const item = ITEMS[id];
    let price = item.cost;
    const consume = [];
    const have = [...hero.items];
    for (const part of item.from ?? []) {
      const i = have.indexOf(part);
      if (i >= 0) { consume.push(part); have.splice(i, 1); } else price += ITEMS[part].cost;
    }
    return { price, consume };
  }

  canBuy(hero, id) {
    const item = ITEMS[id];
    if (!item || !hero.alive || !hero.inBase) return false;
    if (item.unique && hero.items.includes(id)) return false;
    if (item.active && item.from && hero.activeItem && hero.activeItem !== id) return false;
    const { price, consume } = this.priceOf(hero, id);
    if (hero.gold < price) return false;
    return hero.items.length - consume.length + 1 <= MAX_ITEMS;
  }

  buy(hero, id) {
    if (!this.canBuy(hero, id)) return false;
    const { price, consume } = this.priceOf(hero, id);
    for (const part of consume) hero.items.splice(hero.items.indexOf(part), 1);
    hero.gold -= price;
    hero.items.push(id);
    hero.recomputeItems();
    this.emit('bought', { hero, id });
    return true;
  }

  // Следующая покупка по рекомендованной сборке: готовый предмет, если хватает, иначе его часть
  nextBuildStep(hero) {
    const want = {};
    for (const id of hero.heroDef.build) {
      want[id] = (want[id] ?? 0) + 1;
      if (hero.items.filter((x) => x === id).length >= want[id]) continue;
      const item = ITEMS[id];
      const { price } = this.priceOf(hero, id);
      if (!item.from) return { id, price };
      const missing = item.from.filter((p, i, arr) => hero.items.filter((x) => x === p).length < arr.slice(0, i + 1).filter((x) => x === p).length);
      if (hero.gold >= price || !missing.length) return { id, price };
      const part = missing.sort((a, b) => ITEMS[a].cost - ITEMS[b].cost)[0];
      return { id: part, price: ITEMS[part].cost };
    }
    return null;
  }

  castAbility(hero, id, rank, aim) { return castAbility(this, hero, id, rank, aim); }
  castSpell(hero, id, aim) { return castSpell(this, hero, id, aim); }

  // Разрушен ли ингибитор команды: тогда у врага идут супер-крипы
  inhibDown(team) {
    return this.units.some((u) => u.kind === 'inhib' && u.team === team && !u.alive);
  }

  spawnWave() {
    for (const team of [TEAM.BLUE, TEAM.RED]) {
      const s = side(team);
      const add = (type, i, row) => {
        const z = (i - (type === 'ranged' ? 0.5 : 1)) * 1.6;
        const c = new Creep(this, team, type, this.wave, z);
        c.pos.x = s * (MAP.baseX - 10 + row * 1.6);
        this.units.push(c);
      };
      for (let i = 0; i < CREEP.meleeCount; i++) add('melee', i, 0);
      for (let i = 0; i < CREEP.rangedCount; i++) add('ranged', i, 1);
      if (this.inhibDown(1 - team)) add('super', 1, -1);
    }
    this.wave++;
  }

  update(dt) {
    if (this.over) { this.updateFx(dt); return; }
    this.time += dt;
    if (this.time >= this.nextWave) {
      if (!this.practice || this.practice.waves) this.spawnWave();
      this.nextWave += CREEP.waveInterval;
    }
    if (this.practice?.noCooldowns) {
      for (const h of this.allHeroes) {
        for (const k in h.cd) h.cd[k] = Math.min(h.cd[k], 0.3);
        for (const k in h.spellCd) h.spellCd[k] = 0;
        h.mana = h.maxMana;
      }
    }
    this.updatePlants(dt);
    for (const c of this.camps) {
      if (c.monster) continue;
      c.timer -= dt;
      if (c.timer <= 0) {
        c.monster = new Monster(this, c.kind, c.x, c.z, this.time / 60);
        this.units.push(c.monster);
        if (c.kind === 'dragon') this.emit('dragonspawn', c.monster);
      }
    }
    for (const h of this.allHeroes) if (h.alive) h.gold += HERO.passiveGold * dt;
    this.visionTimer -= dt;
    if (this.visionTimer <= 0) { this.visionTimer = 0.1; this.computeVision(); }
    for (const b of this.brains) b.update(dt);
    for (const u of this.units) if (u.alive || u.kind === 'hero' || u.kind === 'inhib') u.update(dt);
    this.resolveCollisions(dt);
    this.fountains(dt);
    for (const p of this.projectiles) p.update(dt);
    this.updateFx(dt);

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!u.alive && (u.kind === 'creep' || u.kind === 'monster')) this.units.splice(i, 1);
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
        if (a.moving && a.moveDir.x * nx + a.moveDir.z * nz < -0.6) {
          // обходить здание с той стороны, где уже стоим
          const sgn = nz > 0.05 ? 1 : nz < -0.05 ? -1 : (a.id % 2 ? 1 : -1);
          let tx = -nz, tz = nx;
          if (tz * sgn < 0) { tx = -tx; tz = -tz; }
          a.pos.x += tx * a.speed * dt * 0.8;
          a.pos.z += tz * a.speed * dt * 0.8;
        }
      }
      resolveTerrain(a.pos, a.radius * 0.8);
    }
  }

  fountains(dt) {
    for (const h of this.allHeroes) {
      if (!h.alive) continue;
      const own = Math.hypot(h.pos.x - side(h.team) * MAP.fountainX, h.pos.z);
      const foe = Math.hypot(h.pos.x + side(h.team) * MAP.fountainX, h.pos.z);
      if (own < MAP.fountainRadius + 1) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * FOUNTAIN.healPerSec * dt);
      if (foe < MAP.fountainRadius + 3) h.takeDamage(FOUNTAIN.enemyDps * dt, 'true', null);
    }
  }

  addProjectile(p) { this.projectiles.push(p); }

  burst(x, z, color, size) { this.effects.push(new Burst(this, x, 1, z, color, size)); }
  hitSpark(target, color) {
    this.effects.push(new Burst(this, target.pos.x, target.isStructure ? 2 : 1.2, target.pos.z, color, 0.6, 0.18));
  }
  trail(hero) { this.effects.push(new Burst(this, hero.pos.x, 1, hero.pos.z, 0x9fe8ff, 1.4, 0.3)); }
  shake(a) { this.shakeAmount = Math.max(this.shakeAmount, a); }

  updatePlants(dt) {
    for (const pl of this.plants) {
      const ready = this.time >= pl.readyAt;
      pl.model.group.visible = ready;
      if (!ready) continue;
      const h = this.allHeroes.find((x) => x.alive && Math.hypot(x.pos.x - pl.x, x.pos.z - pl.z) < PLANTS.radius + x.radius);
      if (!h) continue;
      h.heal(h.maxHp * PLANTS.heal);
      h.mana = Math.min(h.maxMana, h.mana + h.maxMana * PLANTS.mana);
      pl.readyAt = this.time + PLANTS.respawn;
      this.burst(pl.x, pl.z, 0xff7ab6, 1.6);
      this.emit('plant', { hero: h, plant: pl });
    }
  }

  // Матч заменён: модели освобождают то, что не видно при обходе сцены, — скелеты и анимации
  // героев. Геометрию и материалы всей сцены освобождает main.js (disposeObject(scene)).
  dispose() {
    for (const u of new Set([...this.units, ...this.allHeroes])) u.model?.dispose?.();
  }

  syncMeshes(dt = 0) {
    const p = this.player;
    for (const pl of this.plants) if (pl.model.group.visible) pl.model.fruit.rotation.y += dt * 2;
    for (const u of this.units) {
      if (!u.model) continue;
      if (u.alive || u.isStructure) u.syncMesh(dt);
      // туман войны: врагов вне видимости не рисуем
      if (u.alive && !u.static && u.team !== p.team) u.model.group.visible = this.isVisible(p.team, u);
    }
    for (const pr of this.projectiles) pr.sync();
    for (const e of this.effects) e.sync();
  }
}
