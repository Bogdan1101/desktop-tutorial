// Обучение: шаги с подсказками в режиме тренировки. Каждый шаг проверяет, сделал ли игрок нужное.
import { dist } from './units.js';

const STEPS = [
  { text: 'Изучите первое умение: нажмите «+» над кнопкой Q', done: (g, p) => p.ranks.Q > 0 },
  { text: 'Купите предмет: нажмите золотую кнопку внизу экрана', done: (g, p) => p.items.length > 0 },
  { text: 'Идите к манекенам у реки: ведите пальцем по левой половине экрана', done: (g, p) => dist(p.pos, { x: -3, z: 0 }) < 9 },
  { text: 'Ударьте манекен: удерживайте «Атака»', done: (g, p, c) => c.hits >= 3 },
  { text: 'Примените умение: коснитесь Q', done: (g, p, c) => c.casts >= 1 },
  { text: 'Прицельтесь вручную: потяните Q в сторону и отпустите', done: (g, p, c) => c.manual >= 1 },
  { text: 'Скачок: коснитесь «Вспышки» или потяните её в нужную сторону', done: (g, p, c) => c.flash >= 1 },
  { text: 'Вернитесь на базу: нажмите «Домой» и постойте 4 секунды', done: (g, p, c) => c.recalled >= 1 },
];

export class Tutorial {
  constructor(game, el, onFinish) {
    this.game = game;
    this.el = el;
    this.onFinish = onFinish;
    this.step = 0;
    this.c = { hits: 0, casts: 0, manual: 0, flash: 0, recalled: 0 };
    const p = game.player;
    p.gold += 1500;
    game.on('damage', ({ source, target }) => { if (source === p && target.kind === 'dummy') this.c.hits++; });
    game.on('cast', ({ hero }) => { if (hero === p) this.c.casts++; });
    game.on('manualcast', () => { this.c.manual++; });
    game.on('spell', ({ hero, id }) => { if (hero === p && id === 'flash') this.c.flash++; });
    game.on('recalled', (h) => { if (h === p) this.c.recalled++; });
    this.render();
  }

  render() {
    this.el.hidden = false;
    if (this.step >= STEPS.length) {
      this.el.querySelector('b').textContent = 'Обучение пройдено';
      this.el.querySelector('span').textContent = 'Теперь попробуйте матч 1 на 1. Можно остаться и потренироваться.';
      return;
    }
    this.el.querySelector('b').textContent = `Шаг ${this.step + 1} из ${STEPS.length}`;
    this.el.querySelector('span').textContent = STEPS[this.step].text;
  }

  update() {
    if (this.step >= STEPS.length) return;
    const g = this.game;
    if (STEPS[this.step].done(g, g.player, this.c)) {
      this.step++;
      g.emit('tutorialstep', this.step);
      this.render();
      if (this.step >= STEPS.length) this.onFinish();
    }
  }
}
