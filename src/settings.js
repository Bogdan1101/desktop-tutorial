// Настройки игрока. Хранятся в браузере; если хранилище недоступно, работают значения по умолчанию.

const KEY = 'dota3-settings';
const DEFAULTS = {
  sfx: 0.8, music: 0.4, quality: 'medium', buttons: 1, vibration: true,
  hero: 'pyro', mode: '3v3', difficulty: 'normal', talent: 'onslaught', spells: ['flash', 'ignite'],
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* хранилище недоступно */ }
  return { ...DEFAULTS };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* не сохранится, это не страшно */ }
}
