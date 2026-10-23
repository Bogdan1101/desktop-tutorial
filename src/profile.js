// Профиль игрока: статистика, ежедневные задания, кристаллы и скины. Хранится в браузере.
import { SKINS, HEROES } from './config.js';

const KEY = 'dota3-profile';

export const QUEST_POOL = [
  { id: 'play2', text: 'Сыграйте 2 матча', goal: 2, reward: 50, stat: 'games' },
  { id: 'win1', text: 'Победите в матче', goal: 1, reward: 80, stat: 'wins' },
  { id: 'kills5', text: 'Убейте 5 героев', goal: 5, reward: 60, stat: 'kills' },
  { id: 'cs80', text: 'Добейте 80 крипов', goal: 80, reward: 60, stat: 'cs' },
  { id: 'dragon1', text: 'Убейте дракона с командой', goal: 1, reward: 70, stat: 'dragons' },
  { id: 'towers3', text: 'Разрушьте 3 башни', goal: 3, reward: 60, stat: 'towers' },
  { id: 'assists5', text: 'Помогите в 5 убийствах', goal: 5, reward: 50, stat: 'assists' },
];
export const TUTORIAL_REWARD = 100;

const today = () => new Date().toISOString().slice(0, 10);

function fresh() {
  return {
    games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0,
    heroes: {}, crystals: 0, owned: {}, equipped: {}, tutorialDone: false,
    questDay: '', quests: [],
  };
}

// Три задания на день, одинаковые весь день
function rollQuests(day) {
  let seed = [...day].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pool = [...QUEST_POOL];
  const out = [];
  while (out.length < 3) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out.map((q) => ({ id: q.id, progress: 0, claimed: false }));
}

export function loadProfile() {
  let p = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) p = { ...p, ...JSON.parse(raw) };
  } catch { /* хранилище недоступно: профиль живёт до перезагрузки */ }
  const day = today();
  if (p.questDay !== day) { p.questDay = day; p.quests = rollQuests(day); }
  return p;
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* не сохранится */ }
}

export const questDef = (id) => QUEST_POOL.find((q) => q.id === id);

// Итог матча: обновляет статистику и задания. Возвращает только что выполненные задания.
export function recordMatch(p, r) {
  p.games++;
  if (r.won) p.wins++;
  p.kills += r.kills; p.deaths += r.deaths; p.assists += r.assists; p.cs += r.cs;
  const h = (p.heroes[r.heroId] ??= { games: 0, wins: 0 });
  h.games++;
  if (r.won) h.wins++;
  const gain = { games: 1, wins: r.won ? 1 : 0, kills: r.kills, cs: r.cs, dragons: r.dragons, towers: r.towers, assists: r.assists };
  const done = [];
  for (const q of p.quests) {
    const def = questDef(q.id);
    if (!def || q.progress >= def.goal) continue;
    q.progress = Math.min(def.goal, q.progress + (gain[def.stat] ?? 0));
    if (q.progress >= def.goal) done.push(def);
  }
  saveProfile(p);
  return done;
}

export function claimQuest(p, id) {
  const q = p.quests.find((x) => x.id === id);
  const def = questDef(id);
  if (!q || !def || q.claimed || q.progress < def.goal) return false;
  q.claimed = true;
  p.crystals += def.reward;
  saveProfile(p);
  return true;
}

export function finishTutorial(p) {
  if (p.tutorialDone) return false;
  p.tutorialDone = true;
  p.crystals += TUTORIAL_REWARD;
  saveProfile(p);
  return true;
}

export const ownsSkin = (p, heroId, skinId) => skinId === 'base' || (p.owned[heroId] ?? []).includes(skinId);
export const equippedSkin = (p, heroId) => p.equipped[heroId] ?? 'base';

export function buySkin(p, heroId, skinId) {
  const skin = SKINS[heroId]?.find((s) => s.id === skinId);
  if (!skin || ownsSkin(p, heroId, skinId) || p.crystals < skin.cost) return false;
  p.crystals -= skin.cost;
  (p.owned[heroId] ??= []).push(skinId);
  p.equipped[heroId] = skinId;
  saveProfile(p);
  return true;
}

export function equipSkin(p, heroId, skinId) {
  if (!ownsSkin(p, heroId, skinId)) return false;
  p.equipped[heroId] = skinId;
  saveProfile(p);
  return true;
}

export const heroNames = () => Object.fromEntries(Object.entries(HEROES).map(([id, h]) => [id, h.name]));
