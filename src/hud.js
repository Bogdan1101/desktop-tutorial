// Интерфейс поверх сцены: полоски здоровья, счёт, миникарта, умения, лавка, сообщения.
import * as THREE from 'three';
import { ABILITIES, ITEMS, MAX_ITEMS, MAP, HERO, TEAM } from './config.js';

const $ = (id) => document.getElementById(id);
const BAR_HEIGHT = { hero: 3.2, creep: 1.8, tower: 8, nexus: 6.6 };

export class Hud {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.bars = new Map();
    this.floats = [];
    this.v = new THREE.Vector3();
    this.mapTimer = 0;
    this.slowTimer = 0;
    this.bannerTimer = 0;
    this.mini = $('minimap').getContext('2d');
    this.shopOpen = false;
    this.el = {
      lvl: $('lvl'), hpFill: $('hpFill'), hpText: $('hpText'), xpFill: $('xpFill'), gold: $('gold'),
      killsBlue: $('killsBlue'), killsRed: $('killsRed'), clock: $('clock'), banner: $('banner'),
      death: $('death'), deathTimer: $('deathTimer'), shop: $('shop'), shopList: $('shopList'),
      shopGold: $('shopGold'), shopHint: $('shopHint'), shopBtn: $('shopBtn'), recallBtn: $('recallBtn'),
      barsLayer: $('bars'), floatLayer: $('floaters'),
    };
    this.ab = {};
    for (const k of 'QWER') this.ab[k] = { btn: $('ab' + k), cd: $('ab' + k).querySelector('.cd'), em: $('ab' + k).querySelector('em') };

    this.buildShop();
    $('shopClose').addEventListener('click', () => this.toggleShop(false));
    this.el.shop.addEventListener('pointerdown', (e) => { if (e.target === this.el.shop) this.toggleShop(false); });

    game.on('float', ({ unit, text }) => { if (unit === game.player) this.addFloat(unit, text); });
    game.on('herokill', ({ victim }) => {
      const total = game.kills[0] + game.kills[1];
      if (victim === game.player) this.banner('Вы погибли', true);
      else this.banner(total === 1 ? 'Первая кровь' : 'Враг повержен');
    });
    game.on('structure', (t) => this.banner(t.team === TEAM.BLUE ? 'Наша башня пала' : 'Башня разрушена', t.team === TEAM.BLUE));
    game.on('levelup', (h) => { if (h === game.player) this.banner(`Уровень ${h.level}`); });
  }

  buildShop() {
    this.el.shopList.innerHTML = '';
    this.shopButtons = ITEMS.map((item) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.innerHTML = `<b>${item.name}</b><small>${item.desc}</small><span class="gold">${item.cost}</span><span class="own"></span>`;
      b.addEventListener('click', () => { this.game.buy(this.game.player, item.id); this.updateShop(); });
      li.append(b);
      this.el.shopList.append(li);
      return { item, b, own: b.querySelector('.own') };
    });
  }

  toggleShop(open = !this.shopOpen) {
    this.shopOpen = open;
    this.el.shop.hidden = !open;
    if (open) this.updateShop();
  }

  updateShop() {
    const p = this.game.player;
    this.el.shopGold.textContent = Math.floor(p.gold);
    this.el.shopHint.textContent = !p.inBase ? 'Покупать можно только на своей базе. Нажмите «Домой».'
      : p.items.length >= MAX_ITEMS ? `Все ${MAX_ITEMS} ячеек заняты.` : `Вы на базе. Ячеек занято: ${p.items.length} из ${MAX_ITEMS}.`;
    for (const { item, b, own } of this.shopButtons) {
      const count = p.items.filter((x) => x === item.id).length;
      own.textContent = count ? (item.unique ? 'Куплено' : `Есть: ${count}`) : '';
      b.disabled = !p.inBase || p.gold < item.cost || (item.unique && count > 0) || !p.alive || p.items.length >= MAX_ITEMS;
    }
  }

  banner(text, bad = false) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.toggle('bad', bad);
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    this.bannerTimer = 2.2;
  }

  addFloat(unit, text) {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    this.el.floatLayer.append(el);
    this.floats.push({ el, x: unit.pos.x, z: unit.pos.z, t: 0 });
  }

  project(x, y, z) {
    const v = this.v.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }

  barFor(u) {
    let b = this.bars.get(u);
    if (!b) {
      const el = document.createElement('div');
      const rel = u === this.game.player ? 'me' : u.team === this.game.player.team ? 'ally' : 'enemy';
      el.className = `ubar ${rel} ${u.kind === 'hero' ? 'hero' : u.isStructure ? 'struct' : ''}`;
      el.innerHTML = u.kind === 'hero' ? '<i></i><s></s><b></b>' : '<i></i>';
      this.el.barsLayer.append(el);
      b = { el, fill: el.firstChild, shield: el.querySelector('s'), lvl: el.querySelector('b'), lastW: -1, lastLvl: 0 };
      this.bars.set(u, b);
    }
    return b;
  }

  update(dt) {
    const g = this.game, p = g.player;

    // полоски над юнитами
    for (const [u, b] of this.bars) {
      if (!u.alive || !g.units.includes(u)) { b.el.remove(); this.bars.delete(u); }
    }
    for (const u of g.units) {
      if (!u.alive) continue;
      const b = this.barFor(u);
      const s = this.project(u.pos.x, BAR_HEIGHT[u.kind], u.pos.z);
      if (!s || s.x < -60 || s.x > innerWidth + 60 || s.y < -20 || s.y > innerHeight + 20) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      b.el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px)`;
      const w = Math.round(u.hp / u.maxHp * 100);
      if (w !== b.lastW) { b.fill.style.width = w + '%'; b.lastW = w; }
      if (u.isStructure) b.el.classList.toggle('locked', u.invulnerable);
      if (b.shield) b.shield.style.width = u.shield > 0 ? Math.min(100, u.shield / u.maxHp * 100) + '%' : '0';
      if (b.lvl && b.lastLvl !== u.level) { b.lvl.textContent = u.level; b.lastLvl = u.level; }
    }

    // всплывающие цифры
    this.floats = this.floats.filter((f) => {
      f.t += dt;
      const s = this.project(f.x, 3.6 + f.t * 2, f.z);
      if (s) {
        f.el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translateX(-50%)`;
        f.el.style.opacity = String(1 - f.t);
      }
      if (f.t >= 1) { f.el.remove(); return false; }
      return true;
    });

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.hidden = true;
    }

    // кнопки умений
    for (const k of 'QWER') {
      const a = this.ab[k];
      const locked = k === 'R' && p.level < ABILITIES.R.unlockLevel;
      const cd = p.cd[k];
      const max = ABILITIES[k].cooldown * (1 - p.cdr);
      a.cd.style.setProperty('--p', locked ? '100%' : `${cd > 0 ? (cd / max) * 100 : 0}%`);
      a.em.textContent = locked ? `${ABILITIES.R.unlockLevel} ур.` : cd > 0 ? Math.ceil(cd) : '';
      a.em.style.fontSize = locked ? '11px' : '';
      a.btn.classList.toggle('off', locked || cd > 0 || !p.alive);
    }

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.1;
      const e = this.el;
      e.lvl.textContent = p.level;
      e.hpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
      e.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`;
      e.xpFill.style.width = p.level >= HERO.maxLevel ? '100%' : `${(p.xp / HERO.xpToLevel(p.level)) * 100}%`;
      e.gold.textContent = Math.floor(p.gold);
      e.killsBlue.textContent = g.kills[0];
      e.killsRed.textContent = g.kills[1];
      const t = Math.floor(g.time);
      e.clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      e.death.hidden = p.alive || g.over;
      if (!p.alive) e.deathTimer.textContent = Math.ceil(p.respawnTimer);
      e.shopBtn.classList.toggle('on', p.inBase && p.alive);
      e.recallBtn.classList.toggle('on', !!p.recall);
      e.recallBtn.textContent = p.recall ? `Домой ${p.recall.t.toFixed(1)}` : 'Домой';
      if (this.shopOpen) this.updateShop();
    }

    this.mapTimer -= dt;
    if (this.mapTimer <= 0) { this.mapTimer = 0.15; this.drawMinimap(); }
  }

  drawMinimap() {
    const c = this.mini, W = 240, H = 72;
    const sx = (x) => ((x + MAP.halfLength) / (MAP.halfLength * 2)) * (W - 8) + 4;
    const sz = (z) => H / 2 + (z / 16) * (H / 2 - 4);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(139,122,88,0.55)';
    c.fillRect(sx(-MAP.baseX), sz(-MAP.laneHalfWidth), sx(MAP.baseX) - sx(-MAP.baseX), sz(MAP.laneHalfWidth) - sz(-MAP.laneHalfWidth));
    c.fillStyle = 'rgba(47,127,168,0.8)';
    c.fillRect(sx(-3.5), 0, sx(3.5) - sx(-3.5), H);
    for (const [x, col] of [[-MAP.baseX, 'rgba(61,139,255,0.35)'], [MAP.baseX, 'rgba(255,74,61,0.35)']]) {
      c.fillStyle = col;
      c.beginPath(); c.ellipse(sx(x), H / 2, (MAP.baseRadius / (MAP.halfLength * 2)) * (W - 8), (MAP.baseRadius / 16) * (H / 2 - 4), 0, 0, 7); c.fill();
    }
    const col = ['#58a6ff', '#ff5a4a'];
    for (const u of this.game.units) {
      if (!u.alive) continue;
      c.fillStyle = col[u.team];
      const x = sx(u.pos.x), y = sz(u.pos.z);
      if (u.kind === 'creep') c.fillRect(x - 1.5, y - 1.5, 3, 3);
      else if (u.kind === 'tower') { c.fillRect(x - 4, y - 4, 8, 8); c.strokeStyle = '#000'; c.strokeRect(x - 4, y - 4, 8, 8); }
      else if (u.kind === 'nexus') { c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 6, y); c.lineTo(x, y + 7); c.lineTo(x - 6, y); c.fill(); }
    }
    for (const h of [this.game.enemy, this.game.player]) {
      if (!h.alive) continue;
      c.fillStyle = col[h.team];
      c.strokeStyle = h === this.game.player ? '#e9b949' : '#fff';
      c.lineWidth = 2;
      c.beginPath(); c.arc(sx(h.pos.x), sz(h.pos.z), 5, 0, 7); c.fill(); c.stroke();
    }
  }

  clear() {
    for (const [, b] of this.bars) b.el.remove();
    this.bars.clear();
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    this.el.banner.hidden = true;
    this.toggleShop(false);
  }
}
