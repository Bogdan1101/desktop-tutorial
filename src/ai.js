// Бот-герой. Роль lane — стоит на линии за своими крипами, добивает, дерётся, когда сильнее.
// Роль jungle — фармит лагеря в лесу, забирает дракона и приходит на помощь в драки.
import { ABILITIES, MAP, TOWER, side } from './config.js';
import { dist } from './units.js';
import { findPath, lineClear } from './nav.js';
import { botAim } from './abilities.js';

export class HeroBrain {
  constructor(game, hero, diff, role = 'lane') {
    this.game = game;
    this.hero = hero;
    this.diff = diff;
    this.role = role;
    this.timer = Math.random() * 0.3;
    this.goal = null;
    this.target = null;
    this.mode = 'lane';
    this.path = null;
    this.pathGoal = null;
    this.pathTime = -9;
  }

  get forward() { return -side(this.hero.team); }

  enemyTowers() {
    return this.game.units.filter((u) => u.alive && u.kind === 'tower' && u.team !== this.hero.team);
  }

  // Опасно ли стоять в точке: она под вражеской башней, которую не отвлекают свои крипы
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

  visibleEnemyHeroes(range, from = this.hero.pos) {
    const g = this.game, h = this.hero;
    return g.enemyHeroes(h.team).filter((e) => e.alive && g.isVisible(h.team, e) && dist(e.pos, from) < range);
  }

  update(dt) {
    const h = this.hero;
    if (!h.alive) { this.mode = 'dead'; this.path = null; return; }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.diff.think;
      this.levelUp();
      this.think();
    }
    this.steer();
  }

  levelUp() {
    const h = this.hero;
    let guard = 10;
    while (h.points > 0 && guard--) {
      const order = h.heroDef.skillOrder;
      const unlearned = order.find((k) => h.ranks[k] === 0 && h.canRankUp(k));
      if (h.level <= 3 && unlearned) { h.rankUp(unlearned); continue; }
      if (h.rankUp('R')) continue;
      if (!order.some((k) => h.rankUp(k))) break;
    }
  }

  steer() {
    const h = this.hero;
    const it = h.intent;
    it.attack = false;
    it.target = null;
    it.filter = null;
    it.mx = 0; it.mz = 0;
    if (h.recall || h.dash) return;
    const t = this.target;
    if (t && t.canBeHitBy(h.team)) {
      if (h.inRange(t)) { it.attack = true; it.target = t; return; }
      this.moveTo(t.pos.x, t.pos.z, 0);
      return;
    }
    if (this.goal) this.moveTo(this.goal.x, this.goal.z, 0.5);
  }

  // Движение с обходом стен
  moveTo(x, z, stop) {
    const h = this.hero;
    let tx = x, tz = z;
    if (!lineClear(h.pos, { x, z })) {
      const g = this.game;
      if (!this.path || !this.pathGoal || Math.hypot(this.pathGoal.x - x, this.pathGoal.z - z) > 2 || g.time - this.pathTime > 1.5) {
        this.path = findPath(h.pos, { x, z });
        this.pathGoal = { x, z };
        this.pathTime = g.time;
      }
      while (this.path.length > 1 && dist(h.pos, this.path[0]) < 0.8) this.path.shift();
      if (this.path.length) { tx = this.path[0].x; tz = this.path[0].z; }
    } else {
      this.path = null;
    }
    const dx = tx - h.pos.x, dz = tz - h.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop && tx === x) return;
    if (d < 0.01) return;
    h.intent.mx = dx / d;
    h.intent.mz = dz / d;
  }

  // Сила стороны в драке: здоровье × урон героев рядом с точкой
  power(team, pos, range) {
    let p = 0;
    for (const u of this.game.heroes[team]) {
      if (!u.alive || dist(u.pos, pos) > range) continue;
      if (team !== this.hero.team && !this.game.isVisible(this.hero.team, u)) continue;
      p += u.hp * (u.ad * u.attackSpeed + u.ap * 0.6 + 40 * u.level);
    }
    return p;
  }

  useAbilities(e, keys = ['R', 'Q', 'W', 'E']) {
    const h = this.hero;
    const d = dist(h.pos, e.pos) - e.radius;
    const err = this.diff.aimError;
    for (const key of keys) {
      if (!h.abilityReady(key)) continue;
      const id = h.abilityIds[key];
      const def = ABILITIES[id];
      let use = false;
      let aim = null;
      if (def.aim === 'line' || def.aim === 'circle') {
        use = d <= def.range * 0.92;
        if (def.ult && key === 'R') use = use && (e.hp / e.maxHp < 0.65 || this.diff.aggression > 1);
        aim = botAim(h, id, e, err);
      } else if (def.aim === 'dash') {
        if (id === 'roll') {
          use = d > h.range && d < h.range + def.range;
          aim = botAim(h, id, e, 0);
        } else {
          use = d <= def.range;
          aim = botAim(h, id, e, err * 0.5);
        }
      } else if (def.radius) {
        use = d <= def.radius + 0.3;
      } else {
        use = d <= h.range + 3;
      }
      if (use && h.cast(key, aim)) return;
    }
  }

  think() {
    const g = this.game, h = this.hero, f = this.forward;
    const hpPct = h.hp / h.maxHp;
    const fountainX = side(h.team) * MAP.fountainX;
    this.target = null;

    // На базе: покупки и лечение
    if (h.inBase) {
      for (let i = 0; i < 6; i++) {
        const step = g.nextBuildStep(h);
        if (!step || !g.buy(h, step.id)) break;
      }
      if (hpPct < 0.92) { this.mode = 'heal'; this.goal = { x: fountainX, z: (h.slot - 1) * 2 }; return; }
    }

    const enemies = this.visibleEnemyHeroes(12);
    const nearest = enemies.sort((a, b) => dist(a.pos, h.pos) - dist(b.pos, h.pos))[0];
    const eDist = nearest ? dist(nearest.pos, h.pos) : Infinity;

    // Отступление
    const losing = enemies.length && this.power(1 - h.team, h.pos, 12) > this.power(h.team, h.pos, 12) * 1.3;
    const lowHp = hpPct < 0.28 || (losing && hpPct < 0.45);
    if (lowHp || this.mode === 'retreat') {
      if (!lowHp && hpPct > 0.7) this.mode = 'lane';
      else {
        this.mode = 'retreat';
        if (h.inBase) { this.mode = 'heal'; return; }
        const enemiesClose = g.units.some((u) => u.canBeHitBy(h.team) && u.kind !== 'monster' && !u.isStructure
          && g.isVisible(h.team, u) && dist(u.pos, h.pos) < 10);
        const underAttack = g.time - h.lastDamagedAt < 1.5;
        if (!enemiesClose && !underAttack && !h.recall) { h.intent.recall = true; this.goal = null; return; }
        if (h.recall) return;
        this.goal = { x: fountainX, z: 0 };
        this.useSpellsDefensive(eDist);
        if (eDist < 6) {
          if (h.activeItem && hpPct < 0.2) h.intent.active = true;
          for (const key of ['W', 'E', 'Q']) {
            const def = h.ability(key);
            if (!h.abilityReady(key)) continue;
            if (def.aim === 'dash' && h.abilityIds[key] === 'roll') { h.cast(key, { dir: { x: side(h.team), z: 0 } }); break; }
            if (def.aim === 'self' && !def.radius) { h.cast(key); break; }
            if (def.radius && eDist < def.radius) { h.cast(key); break; }
          }
        }
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

    // Драка с героями
    if (nearest && eDist < 11) {
      const target = enemies.filter((e) => dist(e.pos, h.pos) < 11).sort((a, b) => a.hp - b.hp)[0];
      const mine = this.power(h.team, h.pos, 12) * this.diff.aggression;
      const theirs = this.power(1 - h.team, target.pos, 12);
      const eUnderTower = this.towerDanger(target.pos.x, target.pos.z);
      const killable = target.hp < h.ad * 2.2 && hpPct > 0.45;
      if ((mine >= theirs * 0.95 || target.hp / target.maxHp < 0.25) && (!eUnderTower || killable)) {
        this.mode = 'fight';
        this.target = target;
        this.useAbilities(target);
        this.useSpellsOffensive(target);
        return;
      }
      if (h.lastDamagedAt > g.time - 1) {
        for (const key of ['E', 'W']) {
          const def = h.ability(key);
          if (def.aim === 'self' && !def.radius && h.abilityReady(key)) { h.cast(key); break; }
        }
      }
    }

    if (this.role === 'jungle' && this.jungle()) return;
    if (this.role === 'lane' && this.helpAlly()) return;
    this.lane();
  }

  useSpellsOffensive(e) {
    const h = this.hero;
    const d = dist(h.pos, e.pos);
    if (h.spellReady('ignite') && e.hp / e.maxHp < 0.35 && d < 6.5) h.castSpell('ignite');
    if (h.spellReady('flash') && e.hp / e.maxHp < 0.15 && d > h.range + 1.5 && d < h.range + 4.5 && h.hp / h.maxHp > 0.4) {
      h.castSpell('flash', { dir: { x: (e.pos.x - h.pos.x) / d, z: (e.pos.z - h.pos.z) / d } });
    }
    this.useSpellsDefensive(d);
  }

  useSpellsDefensive(eDist) {
    const h = this.hero, g = this.game;
    const hpPct = h.hp / h.maxHp;
    const hurt = g.time - h.lastDamagedAt < 1;
    if (hpPct < 0.25 && hurt && h.spellReady('heal')) h.castSpell('heal');
    if (hpPct < 0.3 && hurt && h.spellReady('barrier')) h.castSpell('barrier');
    if (this.mode === 'retreat' && hpPct < 0.18 && hurt && eDist < 4 && h.spellReady('flash')) {
      h.castSpell('flash', { dir: { x: side(h.team), z: 0 } });
    }
  }

  // Прийти на помощь союзнику, который дерётся неподалёку
  helpAlly() {
    const g = this.game, h = this.hero;
    for (const ally of g.heroes[h.team]) {
      if (ally === h || !ally.alive || dist(ally.pos, h.pos) > 22) continue;
      const foes = this.visibleEnemyHeroes(9, ally.pos);
      if (foes.length && g.time - ally.lastDamagedAt < 2 && !this.towerDanger(foes[0].pos.x, foes[0].pos.z)) {
        this.goal = { x: foes[0].pos.x, z: foes[0].pos.z };
        this.mode = 'help';
        return true;
      }
    }
    return false;
  }

  jungle() {
    const g = this.game, h = this.hero;
    if (this.helpAlly()) return true;
    // дракон: когда герой окреп и рядом нет врагов
    const dragon = g.camps.find((c) => c.kind === 'dragon')?.monster;
    if (dragon && dragon.alive && h.level >= 6 && h.hp / h.maxHp > 0.7 && !this.visibleEnemyHeroes(16, dragon.pos).length) {
      this.mode = 'dragon';
      this.target = dragon;
      this.useAbilities(dragon, ['R', 'Q', 'W', 'E']);
      return true;
    }
    if (dragon && dragon.alive && dragon.aggro === h) { this.target = dragon; this.useAbilities(dragon); return true; }
    // свои лагеря (на своей половине карты), потом чужие, если близко
    const own = g.camps.filter((c) => c.monster && c.monster.alive && c.kind !== 'dragon' && Math.sign(c.x) === side(h.team));
    const camp = own.sort((a, b) => dist(a, h.pos) - dist(b, h.pos))[0];
    if (camp) {
      if (h.hp / h.maxHp < 0.4 && !camp.monster.aggro) return false;
      this.mode = 'farm';
      this.target = camp.monster;
      if (dist(camp.monster.pos, h.pos) < 6) this.useAbilities(camp.monster, ['Q', 'W', 'E']);
      return true;
    }
    return false;
  }

  lane() {
    const g = this.game, h = this.hero, f = this.forward;
    const hpPct = h.hp / h.maxHp;
    this.mode = 'lane';
    const front = this.frontLine();
    // лечебное растение рядом, если здоровья мало
    if (hpPct < 0.6) {
      const plant = g.plants.find((pl) => g.time >= pl.readyAt && Math.hypot(pl.x - h.pos.x, pl.z - h.pos.z) < 14 && !this.towerDanger(pl.x, pl.z));
      if (plant) { this.goal = { x: plant.x, z: plant.z }; this.mode = 'plant'; return; }
    }
    const creep = this.bestCreep();
    if (creep) { this.target = creep; return; }
    const structure = g.units.find((u) => u.isStructure && u.canBeHitBy(h.team) && dist(u.pos, h.pos) < h.range + u.radius + 6
      && !this.towerDanger(u.pos.x - f * (h.range + u.radius - 0.5), 0));
    if (structure) { this.target = structure; return; }
    // иногда умение в волну крипов при полном здоровье
    if (hpPct > 0.8 && Math.random() < 0.1) {
      const t = h.aimTarget(8);
      if (t && t.kind === 'creep') {
        for (const key of ['Q', 'W']) {
          const def = h.ability(key);
          if ((def.aim === 'line' || def.aim === 'circle') && h.abilityReady(key)) { h.cast(key, botAim(h, h.abilityIds[key], t, 0)); break; }
        }
      }
    }
    let gx = front - f * (h.ranged ? 3 : 1.5);
    for (let i = 0; i < 20 && this.towerDanger(gx, 0); i++) gx -= f * 1.5;
    const spread = (h.slot - 1) * 2.2;
    this.goal = { x: gx, z: (h.team ? 1.2 : -1.2) + spread };
  }

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
      if (u.kind !== 'creep' || !u.canBeHitBy(h.team) || !g.isVisible(h.team, u)) continue;
      const d = h.edgeDist(u);
      if (d > h.range + 4) continue;
      if (this.towerDanger(u.pos.x, u.pos.z) && d > h.range) {
        const approach = { x: u.pos.x - (u.pos.x - h.pos.x) / (d + u.radius + h.radius) * h.range, z: u.pos.z };
        if (this.towerDanger(approach.x, approach.z)) continue;
      }
      const score = u.hp - (u.hp <= h.ad ? 1000 : 0) + d * 10;
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }
}

