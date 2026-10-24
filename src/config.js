// Баланс и константы игры. Все расстояния в метрах, время в секундах.

export const TEAM = { BLUE: 0, RED: 1, NEUTRAL: 2 };
export const TEAM_NAME = ['Синие', 'Красные'];
export const TEAM_COLOR = [0x3d8bff, 0xff4a3d, 0x9a7b4f];
export const TEAM_GLOW = [0x7fc4ff, 0xffa07a, 0xffd27a];

// side = -1 для синих (слева), +1 для красных (справа)
export const side = (team) => (team === TEAM.BLUE ? -1 : 1);

// Карта: линия вдоль оси X, по бокам лес, отделённый стенами с проходами.
export const MAP = {
  halfLength: 72,
  laneHalfWidth: 7,
  baseX: 62,
  baseRadius: 13,
  fountainX: 68,
  fountainRadius: 7,
  jungleHalfX: 57,
  jungleHalfZ: 27,
  riverHalfWidth: 3.5,
};

// Препятствия (x1, z1, x2, z2). Заданы для одной четверти карты (x < 0, z > 0)
// и отражаются на остальные: карта симметрична.
const WALLS_QUARTER = [
  [-58, 7.2, -39, 10], [-33, 7.2, -17, 10], [-11, 7.2, -4, 10], // стена между линией и лесом с проходами
  [-29, 16.5, -21, 21.5],   // скала в лесу
  [-50, 14, -45, 22],
  [-14, 15, -8, 19],
];
export const WALLS = [];
for (const [x1, z1, x2, z2] of WALLS_QUARTER) {
  WALLS.push([x1, z1, x2, z2], [-x2, z1, -x1, z2], [x1, -z2, x2, -z1], [-x2, -z2, -x1, -z1]);
}

// Кусты: в них не видно снаружи
const BRUSH_QUARTER = [
  [-36, 3.8, -30, 7],      // у края линии
  [-14, 3.8, -8, 7],
  [-40, 11, -34, 14],      // у входа в лес
  [-18, 22, -10, 26],      // в глубине леса
];
export const BRUSHES = [];
for (const [x1, z1, x2, z2] of BRUSH_QUARTER) {
  BRUSHES.push([x1, z1, x2, z2], [-x2, z1, -x1, z2], [x1, -z2, x2, -z1], [-x2, -z2, -x1, -z1]);
}

export const STRUCTURES = [
  // x задан для синих, у красных зеркально
  { kind: 'tower', x: -24, hp: 2600, order: 0 },
  { kind: 'tower', x: -44, hp: 3000, order: 1 },
  { kind: 'inhib', x: -52, hp: 2500, order: 2 },
  { kind: 'nexus', x: -59.5, hp: 4200, order: 3 },
];

export const TOWER = {
  range: 9.5, damage: 150, heroRampPerShot: 0.3, cooldown: 1.0, radius: 1.6, armor: 40, mr: 40,
};

export const NEXUS = { radius: 2.6, armor: 40, mr: 40 };
export const INHIB = { radius: 1.8, armor: 30, mr: 30, respawn: 90 };

export const CREEP = {
  firstWave: 4,
  waveInterval: 28,
  melee: { hp: 440, damage: 16, range: 1.7, cooldown: 1.15, speed: 4.4, radius: 0.55, gold: 22, xp: 60, armor: 10, mr: 0 },
  ranged: { hp: 290, damage: 24, range: 6, cooldown: 1.5, speed: 4.4, radius: 0.5, gold: 16, xp: 40, armor: 0, mr: 5 },
  super: { hp: 1500, damage: 60, range: 2.2, cooldown: 1.2, speed: 4.4, radius: 0.85, gold: 45, xp: 90, armor: 30, mr: 30 },
  meleeCount: 3,
  rangedCount: 2,
  aggroRange: 8,
  growthPerWave: 0.03,
};

// Монстры леса. Позиции для синей половины, у красных центральная симметрия.
export const MONSTERS = {
  red: { name: 'Багровый страж', hp: 1000, damage: 28, armor: 20, mr: 20, range: 2.2, cooldown: 1.2, radius: 1.2,
         gold: 110, xp: 200, respawn: 90, first: 30, buff: 'red', x: -36, z: 20 },
  blue: { name: 'Лазурный страж', hp: 1000, damage: 28, armor: 20, mr: 20, range: 2.2, cooldown: 1.2, radius: 1.2,
          gold: 110, xp: 200, respawn: 90, first: 30, buff: 'blue', x: -36, z: -20 },
  dragon: { name: 'Дракон', hp: 3200, damage: 70, armor: 40, mr: 40, range: 3, cooldown: 1.4, radius: 2.2,
            gold: 150, xp: 300, respawn: 150, first: 90, buff: 'dragon', x: 0, z: -21, single: true },
  leash: 9,
  growthPerMinute: 0.05,
};

export const BUFFS = {
  red: { name: 'Багровая печать', duration: 70, desc: '+15% к урону, атаки замедляют' },
  blue: { name: 'Лазурная печать', duration: 70, desc: '−20% к перезарядке, восстановление' },
  dragon: { name: 'Ярость дракона', duration: Infinity, desc: '+8% к урону всей команде' },
};

export const HERO = {
  radius: 0.75,
  maxLevel: 15,
  ultLevels: [5, 9, 13],
  basicMaxRank: 4,
  xpToLevel: (lvl) => 150 + lvl * 90,
  respawn: (lvl) => 5 + lvl * 1.5,
  killGold: 300,
  assistGold: 150,
  killXp: (lvl) => 140 + lvl * 25,
  passiveGold: 2.5,
  nearbyGoldShare: 0.5,   // за крипа, погибшего рядом без добивания
  nearbyGoldRange: 12,
  multiKillWindow: 10,
  shutdownPerKill: 60,    // бонус за каждую смерть в серии врага после второй
  shutdownMax: 450,
  recallTime: 4,
  xpShareRange: 16,
  critMul: 1.75,
};

// Герои. Характеристики: значение на 1 уровне + прирост за уровень.
export const HEROES = {
  pyro: {
    name: 'Пиро', role: 'Маг', color: 0x3d8bff,
    desc: 'Огонь и лёд издалека. Метеор оглушает целую группу.',
    ranged: true, range: 5.5, projectile: 0xffb36b,
    hp: [600, 85], mana: [400, 45], manaRegen: 2.4, ad: [50, 3], armor: [20, 3.5], mr: [30, 1], as: [0.65, 0.02], speed: 6.8, regen: 3,
    abilities: ['fireball', 'frost', 'shield', 'meteor'],
    build: ['sage', 'boots', 'archstaff', 'hourglass', 'scepter', 'spirit'],
    skillOrder: ['Q', 'W', 'E'],
  },
  grok: {
    name: 'Грок', role: 'Танк', color: 0x3d8bff,
    desc: 'Врывается в бой, оглушает и отбрасывает. Очень крепкий.',
    ranged: false, range: 1.9,
    hp: [720, 115], mana: [300, 35], manaRegen: 1.8, ad: [62, 4], armor: [32, 4.5], mr: [32, 1.5], as: [0.7, 0.02], speed: 7, regen: 5,
    abilities: ['shieldBash', 'stoneSkin', 'quake', 'earthquake'],
    build: ['titan', 'boots', 'thorns', 'spirit', 'titan', 'thorns'],
    skillOrder: ['Q', 'E', 'W'],
  },
  lira: {
    name: 'Лира', role: 'Стрелок', color: 0x3d8bff,
    desc: 'Быстрые выстрелы с дальней дистанции. Стрела-гарпун через всю линию.',
    ranged: true, range: 6.5, projectile: 0xfff1a8,
    hp: [580, 85], mana: [320, 38], manaRegen: 2, ad: [60, 4], armor: [22, 3.5], mr: [30, 1], as: [0.72, 0.03], speed: 6.8, regen: 3,
    abilities: ['volley', 'roll', 'frenzy', 'harpoon'],
    build: ['storm', 'boots', 'feather', 'vampire', 'storm', 'thorns'],
    skillOrder: ['Q', 'E', 'W'],
  },
};

// Умения. aim: line — линия, circle — точка на земле, self — на себя, dash — рывок.
// Числа в массивах — значения по рангам.
export const ABILITIES = {
  fireball: { name: 'Огненный шар', short: 'Шар', mana: [50, 55, 60, 65], aim: 'line', range: 13, width: 0.9, speed: 24,
              cooldown: [6, 5.5, 5, 4.5], damage: [80, 120, 160, 200], ap: 0.75, type: 'magic',
              desc: 'Летит по прямой и бьёт первого врага.' },
  frost: { name: 'Ледяная волна', short: 'Лёд', mana: [70, 75, 80, 85], aim: 'circle', range: 10, radius: 3, delay: 0.35,
           cooldown: [10, 9.5, 9, 8.5], damage: [60, 90, 120, 150], ap: 0.5, type: 'magic', slow: 0.4, slowTime: 2,
           desc: 'Урон по области и замедление на 40%.' },
  shield: { name: 'Огненный щит', short: 'Щит', mana: [60, 60, 60, 60], aim: 'self',
            cooldown: [14, 13, 12, 11], shield: [90, 130, 170, 210], ap: 0.6, duration: 3,
            desc: 'Щит, который поглощает урон 3 секунды.' },
  meteor: { name: 'Метеор', short: 'Метеор', mana: [100, 100, 100], aim: 'circle', range: 12, radius: 4, delay: 0.85, ult: true,
            cooldown: [60, 50, 40], damage: [220, 330, 440], ap: 0.9, type: 'magic', stun: 1,
            desc: 'Падает через секунду: урон и оглушение всех в круге.' },

  shieldBash: { name: 'Удар щитом', short: 'Таран', mana: [50, 55, 60, 65], aim: 'dash', range: 6, width: 1.2,
                cooldown: [10, 9, 8, 7], damage: [70, 105, 140, 175], hpRatio: 0.04, type: 'physical', stun: 1,
                desc: 'Рывок вперёд. Первый враг на пути оглушён.' },
  stoneSkin: { name: 'Каменная кожа', short: 'Кожа', mana: [40, 40, 40, 40], aim: 'self',
               cooldown: [14, 13, 12, 11], resist: [25, 35, 45, 55], hpShield: 0.08, duration: 4,
               desc: 'Броня, сопротивление магии и щит на 4 секунды.' },
  quake: { name: 'Сотрясение', short: 'Толчок', mana: [50, 55, 60, 65], aim: 'self', radius: 3.5,
           cooldown: [9, 8.5, 8, 7.5], damage: [60, 95, 130, 165], hpRatio: 0.03, type: 'magic', knockback: 3.5,
           desc: 'Удар вокруг себя отбрасывает врагов.' },
  earthquake: { name: 'Землетрясение', short: 'Земля', mana: [100, 100, 100], aim: 'self', radius: 5, delay: 0.4, ult: true,
                cooldown: [70, 60, 50], damage: [150, 250, 350], hpRatio: 0.05, type: 'magic', stun: 1.25,
                desc: 'Подбрасывает и оглушает всех врагов вокруг.' },

  volley: { name: 'Залп', short: 'Залп', mana: [40, 45, 50, 55], aim: 'line', range: 10, width: 1.6, speed: 30, pierce: true,
            cooldown: [7, 6.5, 6, 5.5], damage: [50, 80, 110, 140], adRatio: 0.8, type: 'physical', slow: 0.3, slowTime: 1.5,
            desc: 'Пробивает всех на линии и замедляет.' },
  roll: { name: 'Кувырок', short: 'Кувырок', mana: [30, 30, 30, 30], aim: 'dash', range: 5,
          cooldown: [10, 9, 8, 7], empower: [0.4, 0.6, 0.8, 1.0],
          desc: 'Рывок. Следующая атака сильнее.' },
  frenzy: { name: 'Охотничий азарт', short: 'Азарт', mana: [40, 40, 40, 40], aim: 'self',
            cooldown: [15, 14, 13, 12], attackSpeed: [0.4, 0.55, 0.7, 0.85], duration: 4,
            desc: 'Скорость атаки сильно растёт на 4 секунды.' },
  harpoon: { name: 'Стрела-гарпун', short: 'Гарпун', mana: [100, 100, 100], aim: 'line', range: 28, width: 1, speed: 30, heroOnly: true, ult: true,
             cooldown: [75, 65, 55], damage: [200, 300, 400], adRatio: 1, type: 'physical', stun: 1.5,
             desc: 'Летит через всю линию, оглушает первого героя.' },
};

// Предметы. Части покупаются отдельно и собираются в сильные предметы.
export const ITEMS = {
  sword: { name: 'Меч', cost: 350, stats: { ad: 15 } },
  tome: { name: 'Книга', cost: 400, stats: { ap: 25 } },
  ruby: { name: 'Рубин', cost: 400, stats: { hp: 180 } },
  cloth: { name: 'Кольчуга', cost: 300, stats: { armor: 20 } },
  mantle: { name: 'Плащ', cost: 300, stats: { mr: 20 } },
  dagger: { name: 'Кинжал', cost: 300, stats: { as: 0.15 } },
  boots: { name: 'Сапоги', cost: 300, stats: { speed: 1 }, unique: true },

  vampire: { name: 'Клинок кровопийцы', cost: 550, from: ['sword', 'sword'], stats: { ad: 40, lifesteal: 0.15 } },
  storm: { name: 'Буря клинков', cost: 700, from: ['sword', 'dagger'], stats: { ad: 25, crit: 0.25, as: 0.15 } },
  feather: { name: 'Перо ветра', cost: 600, from: ['dagger', 'dagger'], stats: { as: 0.45, speed: 0.4 } },
  archstaff: { name: 'Посох архимага', cost: 700, from: ['tome', 'tome'], stats: { ap: 85 } },
  sage: { name: 'Амулет мудреца', cost: 450, from: ['tome'], stats: { ap: 35, cdr: 0.2, mana: 250 } },
  hourglass: { name: 'Песочные часы', cost: 600, from: ['tome', 'cloth'], stats: { ap: 50, armor: 30 },
               active: { name: 'Остановка времени', cooldown: 90, duration: 2 },
               desc: 'Активно: 2 секунды неуязвимости, но нельзя двигаться.' },
  scepter: { name: 'Хрустальный скипетр', cost: 500, from: ['tome', 'ruby'], stats: { ap: 40, hp: 250 },
             desc: 'Умения замедляют на 20%.' , spellSlow: 0.2 },
  titan: { name: 'Сердце титана', cost: 600, from: ['ruby', 'ruby'], stats: { hp: 450, regen: 6 } },
  thorns: { name: 'Шипастый доспех', cost: 500, from: ['cloth', 'ruby'], stats: { armor: 45, hp: 250 } },
  spirit: { name: 'Мантия духов', cost: 500, from: ['mantle', 'ruby'], stats: { mr: 45, hp: 250, regen: 4 } },
};
export const MAX_ITEMS = 6;
export const STAT_NAMES = {
  ad: 'урон', ap: 'сила умений', hp: 'здоровье', armor: 'броня', mr: 'сопр. магии', as: 'скорость атаки',
  crit: 'крит', lifesteal: 'вампиризм', cdr: 'перезарядка', speed: 'скорость', regen: 'восстановление', mana: 'мана',
};

export const FOUNTAIN = { healPerSec: 0.2, enemyDps: 450 };

export const VISION = { hero: 11, creep: 8, tower: 11, nexus: 12, reveal: 1.2 };

export const DIFFICULTY = {
  easy: { label: 'Легко', damageMul: 0.75, think: 0.5, aggression: 0.7, aimError: 0.35 },
  normal: { label: 'Нормально', damageMul: 1, think: 0.3, aggression: 1, aimError: 0.15 },
  hard: { label: 'Сложно', damageMul: 1.12, think: 0.15, aggression: 1.25, aimError: 0.03 },
};

// Заклинания призывателя: два на выбор перед матчем
export const SPELLS = {
  flash: { name: 'Вспышка', short: 'Вспышка', cooldown: 120, distance: 4.5, desc: 'Мгновенный скачок на 4,5 м.' },
  heal: { name: 'Исцеление', short: 'Лечение', cooldown: 110, heal: (lvl) => 90 + lvl * 16, desc: 'Лечит и ускоряет на 2 секунды.' },
  ignite: { name: 'Воспламенение', short: 'Поджог', cooldown: 100, range: 6.5, damage: (lvl) => 55 + lvl * 22, duration: 5,
            desc: 'Поджигает ближайшего героя: чистый урон 5 секунд.' },
  barrier: { name: 'Барьер', short: 'Барьер', cooldown: 100, shield: (lvl) => 105 + lvl * 20, desc: 'Щит на 2 секунды.' },
};

// Таланты: один на выбор перед матчем
export const TALENTS = {
  onslaught: { name: 'Натиск', desc: '+8% ко всему урону' },
  fortitude: { name: 'Стойкость', desc: '+8% к здоровью, +2 восстановления' },
  swiftness: { name: 'Ловкость', desc: '+12% к скорости атаки, +0,4 к скорости' },
  wisdom: { name: 'Мудрость', desc: '−10% к перезарядке, +30% восстановления маны' },
};

// Лечебные растения: съесть, проходя рядом. Позиции для одной половины, у второй центральная симметрия.
export const PLANTS = {
  spots: [[-16, -6], [-38, 6], [-30, -24], [-6, 13]],
  heal: 0.15, mana: 0.1, respawn: 60, first: 45, radius: 1.5,
};

export const STREAK_NAMES = { 2: 'Двойное убийство', 3: 'Тройное убийство', 4: 'Четверное убийство', 5: 'Пентакилл' };
export const SPREE_NAMES = { 3: 'Серия убийств', 5: 'Неудержим', 7: 'Божественно' };

// Скины: меняют основной цвет и цвет отделки. Покупаются за кристаллы из заданий.
export const SKINS = {
  pyro: [
    { id: 'base', name: 'Обычный', cost: 0 },
    { id: 'ice', name: 'Ледяной маг', cost: 120, main: 0x8fe3ff, trim: 0xe9f8ff },
    { id: 'gold', name: 'Золотой', cost: 250, main: 0xf0c040, trim: 0x7a4b00 },
  ],
  grok: [
    { id: 'base', name: 'Обычный', cost: 0 },
    { id: 'stone', name: 'Каменный страж', cost: 120, main: 0x8c8f97, trim: 0x4d5560 },
    { id: 'gold', name: 'Золотой', cost: 250, main: 0xf0c040, trim: 0x7a4b00 },
  ],
  lira: [
    { id: 'base', name: 'Обычная', cost: 0 },
    { id: 'forest', name: 'Лесная', cost: 120, main: 0x5fbf5a, trim: 0x2f5e2b },
    { id: 'gold', name: 'Золотая', cost: 250, main: 0xf0c040, trim: 0x7a4b00 },
  ],
};
