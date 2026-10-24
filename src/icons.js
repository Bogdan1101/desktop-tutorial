// Значки умений и заклинаний: простые фигуры SVG 24×24, рисуются прямо в кнопке (без файлов и шрифтов).
// Контур — цветом кнопки (currentColor), заливка-акцент — цветом умения. Форма у каждого своя,
// чтобы значки различались и без цвета.
const NS = 'http://www.w3.org/2000/svg';

// [акцент, разметка внутри <svg>]; class="f" — заливка акцентом, class="d" — пунктир
const ICONS = {
  // Пиро
  fireball: ['#ff8a3d', '<circle class="f" cx="15" cy="9" r="5.5"/><path d="M3 21 10.5 13.5M4.5 15.5 9 12.5M8.5 19.5 11.5 15"/>'],
  frost: ['#9fe3ff', '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 2 3-2M9 20.5l3-2 3 2M3.6 10.4l2.6-1.6-.2-3M20.4 13.6l-2.6 1.6.2 3"/><circle class="f" cx="12" cy="12" r="2.2"/>'],
  shield: ['#ffb347', '<path d="M12 2.5 19.5 5.5V11c0 5.2-3.3 8.6-7.5 10.5C7.8 19.6 4.5 16.2 4.5 11V5.5Z"/><path class="f" d="M12 7c2 2.8 3.6 4.3 3.1 6.9-.4 2-1.6 3.1-3.1 3.1s-2.7-1.1-3.1-3.1c-.2-1.4.7-2.4 1.4-3.3.3 1.4 1 1.9 1.6 1.9-.4-1.5-.5-3.4.1-5.5Z"/>'],
  meteor: ['#ff6b3d', '<path class="f" d="M5 11.5 10 8l5.5 1.5 1.5 5-3.5 4.5-6 .5-3-4Z"/><path d="M15 8.5 21 2.5M17.5 11 22 6.5M12 7l4-4.5M2 22.5h20"/>'],
  // Грок
  shieldBash: ['#ffd36b', '<path class="f" d="M15 4 21 6.3V11c0 4.3-2.7 7.3-6 8.8-3.3-1.5-6-4.5-6-8.8V6.3Z"/><path d="M1.5 8h5M.5 12h5M1.5 16h5"/>'],
  stoneSkin: ['#b8bec9', '<path class="f" d="M12 2 20.5 7v10L12 22l-8.5-5V7Z"/><path d="M12 2v8.5M12 10.5 20.5 7M12 10.5 3.5 7M12 10.5V22M7.5 14.5l4.5 2.5"/>'],
  quake: ['#e0c088', '<circle class="f" cx="12" cy="12" r="3"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4 4.5a10.6 10.6 0 0 0 0 15M20 4.5a10.6 10.6 0 0 1 0 15"/>'],
  earthquake: ['#c9a27a', '<path d="M2 15.5h20M12 15.5 9.8 18.5l3.2 1.8L10.5 23"/><path class="f" d="m4.5 10.5 2.5-3.5 3 2-1.2 3.5ZM14.5 8l3.8-2.6 1.4 3.6-3.6 1.6Z"/><path d="M8 14V12.6M17 14v-2"/>'],
  // Лира
  volley: ['#ffe6a0', '<path d="M2.5 15.5 13 5M6 19 16.5 8.5M9.5 22.5 20 12"/><path class="f" d="m15 3 .5 4.5L11 7ZM18.5 6.5l.5 4.5-4.5-.5ZM22 10l.5 4.5L18 14Z"/>'],
  roll: ['#9fe8c8', '<path d="M19.5 13A7.5 7.5 0 1 1 14 4.9"/><path class="f" d="m12.5 1.5 5.5 3.2-4.8 4.1Z"/><path d="M2 21h5M4 18h3"/>'],
  frenzy: ['#ffe14d', '<path class="f" d="M13.5 2 5 13.5h6.2L9.3 22 19 9.5h-6.2Z"/>'],
  harpoon: ['#d8e6ff', '<path d="M3 21 17 7"/><path class="f" d="M21.5 2.5 19.8 9.6 17 7 14.4 4.2Z"/><path d="M14.6 9.4 13 13M14.4 4.2 11 5.5M3 21c2.2.4 3.3-1 2.4-2.6-.8-1.4.4-2.6 1.9-2.4"/>'],
  // Заклинания
  flash: ['#ffe14d', '<path class="d" d="M3 21 12 12"/><path d="M10 6.5h7.5V14"/><path class="f" d="m20 1.5 1.1 2.6 2.6 1.1-2.6 1.1L20 9l-1.1-2.7-2.6-1.1 2.6-1.1Z"/>'],
  heal: ['#6dff8a', '<path class="f" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>'],
  ignite: ['#ff7a3d', '<path class="f" d="M12 2c3 4 7 7 6 12-.7 4.5-3.5 7-6 7-4 0-6.5-3-6-7 .3-2.5 2-4 3-5.5.5 2 1.5 3 2.5 3-1-3-.5-6.5.5-9.5Z"/>'],
  barrier: ['#9fe8ff', '<path class="f" d="M6 18.5a6 6 0 0 1 12 0Z" opacity=".55"/><path d="M2.5 18.5a9.5 9.5 0 0 1 19 0M1.5 18.5h21"/>'],
};

// Замок для закрытой ульты и капля для нехватки маны — поверх значка, в углу кнопки
export const LOCK = '<rect x="5" y="10.5" width="14" height="11" rx="2" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>';
export const DROP = '<path fill="currentColor" d="M12 2.5c3.8 5 6.5 8.4 6.5 12a6.5 6.5 0 0 1-13 0c0-3.6 2.7-7 6.5-12Z"/>';

export function svgIcon(body, accent) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (accent) svg.style.setProperty('--accent', accent);
  svg.innerHTML = body; // только постоянные строки этого модуля, без данных игрока
  return svg;
}

// Значок умения или заклинания по его id
export function abilityIcon(id) {
  const [accent, body] = ICONS[id] ?? ['#ffffff', '<circle class="f" cx="12" cy="12" r="6"/>'];
  return svgIcon(body, accent);
}

export const ICON_IDS = Object.keys(ICONS);
