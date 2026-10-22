// Баланс и константы игры. Все расстояния в метрах, время в секундах.

export const TEAM = { BLUE: 0, RED: 1 };
export const TEAM_NAME = ['Синие', 'Красные'];
export const TEAM_COLOR = [0x3d8bff, 0xff4a3d];
export const TEAM_GLOW = [0x7fc4ff, 0xffa07a];

// Карта: одна линия вдоль оси X, синяя база слева, красная справа.
export const MAP = {
  halfLength: 72,      // край карты по X
  laneHalfWidth: 8,    // полуширина линии по Z
  baseX: 62,           // центр базы
  baseRadius: 13,
  fountainX: 68,       // точка возрождения
  fountainRadius: 7,
};

// side = -1 для синих, +1 для красных
export const side = (team) => (team === TEAM.BLUE ? -1 : 1);

export const STRUCTURES = [
  // x задаётся для синих, у красных зеркально
  { kind: 'tower', x: -24, hp: 2600, order: 0 },
  { kind: 'tower', x: -44, hp: 3000, order: 1 },
  { kind: 'nexus', x: -59, hp: 4200, order: 2 },
];

export const TOWER = {
  range: 9.5,
  damage: 140,
  heroRampPerShot: 0.3, // каждый следующий выстрел по герою сильнее на 30%
  cooldown: 1.0,
  radius: 1.6,
  creepDamageMul: 1,
};

export const NEXUS = { radius: 2.6 };

export const CREEP = {
  firstWave: 4,
  waveInterval: 28,
  melee: { hp: 440, damage: 16, range: 1.7, cooldown: 1.15, speed: 4.4, radius: 0.55, gold: 22, xp: 60 },
  ranged: { hp: 290, damage: 24, range: 6, cooldown: 1.5, speed: 4.4, radius: 0.5, gold: 16, xp: 40 },
  meleeCount: 3,
  rangedCount: 2,
  aggroRange: 8,
  growthPerWave: 0.03, // крипы крепнут с каждой волной
};

export const HERO = {
  radius: 0.75,
  baseHp: 640,
  hpPerLevel: 85,
  baseDamage: 56,
  damagePerLevel: 6,
  range: 5.5,
  cooldown: 0.85,
  speed: 7,
  regen: 3,          // хп в секунду вне боя
  maxLevel: 12,
  xpToLevel: (lvl) => 180 + lvl * 110,
  respawn: (lvl) => 6 + lvl * 1.6,
  killGold: 300,
  killXp: (lvl) => 140 + lvl * 25,
  passiveGold: 2.5,  // золота в секунду
  recallTime: 4,
};

export const ABILITIES = {
  Q: { name: 'Огненный шар', cooldown: 5, range: 14, speed: 24, width: 0.9,
       damage: (lvl) => 85 + lvl * 14 },
  W: { name: 'Рывок', cooldown: 9, distance: 6.5, duration: 0.18 },
  E: { name: 'Щит', cooldown: 14, duration: 3, shield: (lvl) => 110 + lvl * 18 },
  R: { name: 'Метеор', cooldown: 50, range: 12, radius: 4, delay: 0.85, unlockLevel: 3,
       damage: (lvl) => 210 + lvl * 28 },
};

export const FOUNTAIN = { healPerSec: 0.2, enemyDps: 450 };

export const ITEMS = [
  { id: 'blade', name: 'Клинок', desc: '+22 к урону', cost: 350, apply: (h) => { h.bonusDamage += 22; } },
  { id: 'armor', name: 'Кольчуга', desc: '+220 к здоровью', cost: 350, apply: (h) => { h.bonusHp += 220; h.hp += 220; } },
  { id: 'boots', name: 'Сапоги', desc: '+1,2 к скорости', cost: 300, unique: true, apply: (h) => { h.bonusSpeed += 1.2; } },
  { id: 'amulet', name: 'Амулет', desc: '−15% к перезарядке', cost: 500, unique: true, apply: (h) => { h.cdr += 0.15; } },
  { id: 'staff', name: 'Посох', desc: '+25% к урону умений', cost: 600, apply: (h) => { h.abilityPower += 0.25; } },
];

export const MAX_ITEMS = 6;

export const DIFFICULTY = {
  easy: { label: 'Легко', damageMul: 0.75, think: 0.5, aggression: 0.7 },
  normal: { label: 'Нормально', damageMul: 1, think: 0.3, aggression: 1 },
  hard: { label: 'Сложно', damageMul: 1.15, think: 0.15, aggression: 1.25 },
};
