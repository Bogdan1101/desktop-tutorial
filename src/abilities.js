// Умения героев. aim — куда целился игрок: { dir } для линии и рывка, { point } для области.
// Без aim умение наводится само: на ближайшего видимого героя, иначе на ближайшего врага.
import { ABILITIES, ITEMS } from './config.js';
import { Skillshot, AreaStrike, dist } from './units.js';

function autoDir(hero, range, heroOnly = false) {
  const t = hero.aimTarget(range, heroOnly);
  if (t) {
    const dx = t.pos.x - hero.pos.x, dz = t.pos.z - hero.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }
  return { x: Math.sin(hero.facing), z: Math.cos(hero.facing) };
}

function moveOrFacingDir(hero) {
  const { mx, mz } = hero.intent;
  const len = Math.hypot(mx, mz);
  if (len > 0.2) return { x: mx / len, z: mz / len };
  return { x: Math.sin(hero.facing), z: Math.cos(hero.facing) };
}

function resolvePoint(hero, aim, range) {
  let x, z;
  if (aim?.point) { x = aim.point.x; z = aim.point.z; } else {
    const t = hero.aimTarget(range);
    if (t) { x = t.pos.x; z = t.pos.z; } else {
      x = hero.pos.x + Math.sin(hero.facing) * range * 0.6;
      z = hero.pos.z + Math.cos(hero.facing) * range * 0.6;
    }
  }
  const dx = x - hero.pos.x, dz = z - hero.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > range) { x = hero.pos.x + dx / d * range; z = hero.pos.z + dz / d * range; }
  return { x, z };
}

function damageOf(hero, def, rank) {
  let v = def.damage[rank - 1];
  if (def.ap) v += hero.ap * def.ap;
  if (def.adRatio) v += hero.ad * def.adRatio;
  if (def.hpRatio) v += hero.maxHp * def.hpRatio;
  return v * hero.outMul;
}

function spellHit(hero, target, amount, type) {
  target.takeDamage(amount, type, hero);
  if (target.alive && hero.items.some((id) => ITEMS[id].spellSlow)) target.slow(0.2, 1);
}

function faceDir(hero, dir) { hero.facing = Math.atan2(dir.x, dir.z); }

const IMPL = {
  fireball(game, hero, def, rank, aim) {
    const dir = aim?.dir ?? autoDir(hero, def.range);
    faceDir(hero, dir);
    const dmg = damageOf(hero, def, rank);
    game.addProjectile(new Skillshot(game, hero, dir, {
      range: def.range, speed: def.speed, width: def.width, color: 0xffa63d,
      onHit: (u) => { spellHit(hero, u, dmg, def.type); game.burst(u.pos.x, u.pos.z, 0xffa63d, 1.6); },
    }));
    return true;
  },
  frost(game, hero, def, rank, aim) {
    const p = resolvePoint(hero, aim, def.range);
    const dmg = damageOf(hero, def, rank);
    game.addProjectile(new AreaStrike(game, hero, p.x, p.z, {
      radius: def.radius, delay: def.delay, color: 0x7fd4ff,
      onHit: (u) => { spellHit(hero, u, dmg, def.type); if (u.alive) u.slow(def.slow, def.slowTime); },
    }));
    return true;
  },
  shield(game, hero, def, rank) {
    hero.shield = def.shield[rank - 1] + hero.ap * def.ap;
    hero.shieldUntil = game.time + def.duration;
    return true;
  },
  meteor(game, hero, def, rank, aim) {
    const p = resolvePoint(hero, aim, def.range);
    const dmg = damageOf(hero, def, rank);
    game.addProjectile(new AreaStrike(game, hero, p.x, p.z, {
      radius: def.radius, delay: def.delay, color: 0xff5a2a, falling: true,
      onHit: (u) => { spellHit(hero, u, dmg, def.type); if (u.alive) u.stun(def.stun); },
    }));
    return true;
  },

  shieldBash(game, hero, def, rank, aim) {
    let dir = aim?.dir;
    if (!dir) {
      const t = hero.aimTarget(def.range + 1);
      dir = t ? autoDir(hero, def.range + 1) : moveOrFacingDir(hero);
    }
    faceDir(hero, dir);
    const dmg = damageOf(hero, def, rank);
    const time = 0.28;
    hero.dash = {
      vx: dir.x * def.range / time, vz: dir.z * def.range / time, t: time,
      onTick: () => {
        for (const u of game.units) {
          if (!u.canBeHitBy(hero.team) || u.isStructure) continue;
          if (dist(u.pos, hero.pos) <= u.radius + hero.radius + 0.4) {
            spellHit(hero, u, dmg, def.type);
            if (u.alive) u.stun(def.stun);
            game.burst(u.pos.x, u.pos.z, 0xffd27a, 1.4);
            game.emit('boom', { x: u.pos.x, z: u.pos.z, big: false });
            hero.dash = null;
            return;
          }
        }
      },
    };
    game.trail(hero);
    return true;
  },
  stoneSkin(game, hero, def, rank) {
    const v = def.resist[rank - 1];
    hero.addBuff('stoneSkin', def.duration, { stats: { armor: v, mr: v } });
    hero.shield = hero.maxHp * def.hpShield;
    hero.shieldUntil = game.time + def.duration;
    game.burst(hero.pos.x, hero.pos.z, 0xb8b0a0, 1.6);
    return true;
  },
  quake(game, hero, def, rank) {
    const dmg = damageOf(hero, def, rank);
    for (const u of [...game.units]) {
      if (!u.canBeHitBy(hero.team) || u.isStructure) continue;
      if (dist(u.pos, hero.pos) <= def.radius + u.radius) {
        spellHit(hero, u, dmg, def.type);
        if (u.alive) u.knockback(hero.pos.x, hero.pos.z, def.knockback);
      }
    }
    game.burst(hero.pos.x, hero.pos.z, 0xd9b38c, def.radius);
    game.emit('boom', { x: hero.pos.x, z: hero.pos.z, big: false });
    game.shake(0.2);
    return true;
  },
  earthquake(game, hero, def, rank) {
    const dmg = damageOf(hero, def, rank);
    game.addProjectile(new AreaStrike(game, hero, hero.pos.x, hero.pos.z, {
      radius: def.radius, delay: def.delay, color: 0xd98b3d,
      onHit: (u) => { spellHit(hero, u, dmg, def.type); if (u.alive) u.stun(def.stun); },
    }));
    return true;
  },

  volley(game, hero, def, rank, aim) {
    const dir = aim?.dir ?? autoDir(hero, def.range);
    faceDir(hero, dir);
    const dmg = damageOf(hero, def, rank);
    game.addProjectile(new Skillshot(game, hero, dir, {
      range: def.range, speed: def.speed, width: def.width, pierce: true, color: 0xfff1a8, arrow: true,
      onHit: (u) => { spellHit(hero, u, dmg, def.type); if (u.alive) u.slow(def.slow, def.slowTime); },
    }));
    return true;
  },
  roll(game, hero, def, rank, aim) {
    const dir = aim?.dir ?? moveOrFacingDir(hero);
    faceDir(hero, dir);
    const time = 0.2;
    hero.dash = { vx: dir.x * def.range / time, vz: dir.z * def.range / time, t: time };
    hero.empower = { pct: def.empower[rank - 1], until: game.time + 3.5 };
    hero.atkTimer = 0;
    game.trail(hero);
    return true;
  },
  frenzy(game, hero, def, rank) {
    hero.addBuff('frenzy', def.duration, { stats: { as: def.attackSpeed[rank - 1] } });
    game.burst(hero.pos.x, hero.pos.z, 0xfff1a8, 1.2);
    return true;
  },
  harpoon(game, hero, def, rank, aim) {
    const dir = aim?.dir ?? autoDir(hero, def.range, true);
    faceDir(hero, dir);
    const dmg = damageOf(hero, def, rank);
    game.addProjectile(new Skillshot(game, hero, dir, {
      range: def.range, speed: def.speed, width: def.width, heroOnly: true, color: 0x9fe8ff, arrow: true,
      onHit: (u) => { spellHit(hero, u, dmg, def.type); if (u.alive) u.stun(def.stun); game.burst(u.pos.x, u.pos.z, 0x9fe8ff, 2); game.shake(0.25); },
    }));
    return true;
  },
};

export function castAbility(game, hero, id, rank, aim) {
  return IMPL[id](game, hero, ABILITIES[id], rank, aim);
}

// Для бота: целевая точка/направление с небольшой ошибкой прицела
export function botAim(hero, id, target, error) {
  const def = ABILITIES[id];
  if (!target) return null;
  // упреждение: куда цель придёт к моменту попадания
  let lead = 0;
  if (def.aim === 'line') lead = Math.min(1, dist(hero.pos, target.pos) / (def.speed ?? 30));
  if (def.aim === 'circle') lead = def.delay ?? 0;
  const vx = target.moving ? target.moveDir.x * target.speed : 0;
  const vz = target.moving ? target.moveDir.z * target.speed : 0;
  const px = target.pos.x + vx * lead * 0.7 + (Math.random() - 0.5) * error * 6;
  const pz = target.pos.z + vz * lead * 0.7 + (Math.random() - 0.5) * error * 6;
  if (def.aim === 'circle') return { point: { x: px, z: pz } };
  const dx = px - hero.pos.x, dz = pz - hero.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  return { dir: { x: dx / d, z: dz / d } };
}
