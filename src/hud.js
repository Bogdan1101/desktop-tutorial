// Интерфейс поверх сцены: полоски, цифры урона, кнопки умений, лавка, таблица счёта, миникарта.
import * as THREE from 'three';
import { ABILITIES, ITEMS, MAX_ITEMS, MAP, HERO, TEAM, WALLS, BUFFS, STAT_NAMES, TEAM_NAME, SPELLS } from './config.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, '0')}`;

export function itemStatsText(item) {
  return Object.entries(item.stats).map(([k, v]) => {
    const val = ['as', 'crit', 'lifesteal', 'cdr'].includes(k) ? `${Math.round(v * 100)}%` : v;
    return `+${val} ${STAT_NAMES[k]}`;
  }).join(', ');
}

export class Hud {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.bars = new Map();
    this.floats = [];
    this.dmgPool = [];
    this.v = new THREE.Vector3();
    this.mapTimer = 0;
    this.slowTimer = 0;
    this.bannerTimer = 0;
    this.bannerQueue = [];
    this.mini = $('minimap').getContext('2d');
    this.shopOpen = false;
    this.scoreOpen = false;
    this.el = {
      lvl: $('lvl'), hpFill: $('hpFill'), hpText: $('hpText'), xpFill: $('xpFill'), gold: $('gold'), buffs: $('buffs'),
      killsBlue: $('killsBlue'), killsRed: $('killsRed'), clock: $('clock'), banner: $('banner'),
      death: $('death'), deathTimer: $('deathTimer'), shop: $('shop'), shopGold: $('shopGold'), shopHint: $('shopHint'),
      shopBtn: $('shopBtn'), recallBtn: $('recallBtn'), quickBtn: $('quickBtn'), activeBtn: $('activeBtn'),
      barsLayer: $('bars'), floatLayer: $('floaters'), vignette: $('vignette'), score: $('score'), scoreBody: $('scoreBody'),
      portrait: $('portraitLetter'), mpFill: $('mpFill'), mpText: $('mpText'),
    };
    const p = game.player;
    this.el.portrait.textContent = p.name[0];
    this.spellBtns = p.spells.map((id, i) => {
      const btn = $(`abS${i + 1}`);
      btn.querySelector('b').textContent = SPELLS[id].short;
      btn.setAttribute('aria-label', SPELLS[id].name);
      return { id, btn, cd: btn.querySelector('.cd'), em: btn.querySelector('em') };
    });
    this.ab = {};
    for (const k of 'QWER') {
      const btn = $('ab' + k);
      const def = ABILITIES[p.abilityIds[k]];
      btn.querySelector('small').textContent = def.short;
      btn.setAttribute('aria-label', def.name);
      this.ab[k] = {
        btn, cd: btn.querySelector('.cd'), em: btn.querySelector('em'), pips: btn.querySelector('.pips'),
        rank: document.querySelector(`[data-rank="${k}"]`), max: def.ult ? 3 : 4,
      };
    }

    $('shopClose').onclick = () => this.toggleShop(false);
    this.el.shop.onpointerdown = (e) => { if (e.target === this.el.shop) this.toggleShop(false); };
    this.tipEl = $('skillTip');
    this.tipEl.hidden = true;
    this.tipKey = null;
    $('scoreClose').onclick = () => this.toggleScore(false);

    game.on('float', ({ unit, text }) => { if (unit === game.player) this.addFloat(unit, text, 'gold'); });
    game.on('damage', (e) => this.onDamage(e));
    game.on('herokill', ({ victim, killer }) => {
      const total = game.kills[0] + game.kills[1];
      if (victim === p) this.banner(killer ? `Вас убил ${killer.name}` : 'Вы погибли', true);
      else if (killer === p) this.banner(total === 1 ? 'Первая кровь' : `Вы убили: ${victim.name}`);
      else if (victim.team === p.team) this.banner(`Погиб союзник: ${victim.name}`, true);
      else this.banner(`${killer ? killer.name : 'Союзники'} убил ${victim.name}`);
    });
    game.on('structure', (t) => { if (t.kind === 'tower') this.banner(t.team === p.team ? 'Наша башня пала' : 'Вражеская башня разрушена', t.team === p.team); });
    game.on('levelup', (h) => { if (h === p) this.banner(`Уровень ${h.level}`); });
    game.on('monster', ({ monster, hero }) => {
      const ours = hero.team === p.team;
      if (monster.monsterKind === 'dragon') this.banner(ours ? 'Дракон наш: +8% к урону' : 'Враги забрали дракона', !ours);
      else if (hero === p) this.banner(BUFFS[monster.monsterKind].name);
    });
    game.on('dragonspawn', () => this.banner('Дракон появился у реки'));
    game.on('multikill', ({ hero, text }) => this.banner(hero === p ? text : `${hero.name}: ${text.toLowerCase()}`, hero.team !== p.team));
    game.on('shutdown', ({ victim, gold }) => this.banner(`Конец серии ${victim.name}! +${gold}`, victim.team === p.team));
    game.on('structure', (t) => {
      if (t.kind === 'inhib') this.banner(t.team === p.team ? 'Наш ингибитор разрушен: у врага супер-крипы' : 'Ингибитор разрушен: у нас супер-крипы', t.team === p.team);
    });
    game.on('inhibrespawn', (t) => this.banner(t.team === p.team ? 'Наш ингибитор восстановлен' : 'Вражеский ингибитор восстановлен'));

    this.buildShop();
  }

  // --- лавка ---
  buildShop() {
    const make = (listId, ids) => {
      const list = $(listId);
      list.innerHTML = '';
      return ids.map((id) => {
        const item = ITEMS[id];
        const li = document.createElement('li');
        const b = document.createElement('button');
        const name = document.createElement('b');
        name.textContent = item.name;
        const stats = document.createElement('small');
        stats.textContent = itemStatsText(item) + (item.desc ? `. ${item.desc}` : '');
        const recipe = document.createElement('span');
        recipe.className = 'recipe';
        if (item.from) recipe.textContent = 'Из: ' + item.from.map((x) => ITEMS[x].name).join(' + ');
        const price = document.createElement('span');
        price.className = 'gold';
        const own = document.createElement('span');
        own.className = 'own';
        b.append(name, stats, recipe, price, own);
        b.addEventListener('click', () => { this.game.buy(this.game.player, id); this.updateShop(); });
        li.append(b);
        list.append(li);
        return { id, b, price, own };
      });
    };
    const all = Object.keys(ITEMS);
    this.shopRows = [
      ...make('shopBuild', [...new Set(this.game.player.heroDef.build)]),
      ...make('shopParts', all.filter((id) => !ITEMS[id].from)),
      ...make('shopItems', all.filter((id) => ITEMS[id].from)),
    ];
  }

  toggleShop(open = !this.shopOpen) {
    this.shopOpen = open;
    this.el.shop.hidden = !open;
    if (open) this.updateShop();
  }

  updateShop() {
    const g = this.game, p = g.player;
    this.el.shopGold.textContent = Math.floor(p.gold);
    this.el.shopHint.textContent = !p.inBase ? 'Покупать можно только на базе. Нажмите «Домой».'
      : `Ячеек занято: ${p.items.length} из ${MAX_ITEMS}. Части, которые уже есть, идут в зачёт цены.`;
    for (const r of this.shopRows) {
      const { price } = g.priceOf(p, r.id);
      r.price.textContent = price;
      const count = p.items.filter((x) => x === r.id).length;
      r.own.textContent = count ? `есть ×${count}` : '';
      r.b.disabled = !g.canBuy(p, r.id);
      r.b.classList.toggle('poor', p.gold < price);
    }
    const slots = $('shopSlots');
    slots.textContent = '';
    for (let i = 0; i < MAX_ITEMS; i++) {
      const s = document.createElement('span');
      s.className = 'slot';
      s.textContent = p.items[i] ? ITEMS[p.items[i]].name : '';
      slots.append(s);
    }
  }

  // --- описание умения (зажать кнопку) ---
  setTip(key) {
    if (key === this.tipKey) return;
    this.tipKey = key;
    this.tipEl.hidden = !key;
    if (key) this.tipEl.replaceChildren(...(key[0] === 'S' ? spellTip(this.game.player, key) : abilityTip(this.game.player, key)));
  }

  // --- таблица счёта ---
  toggleScore(open = !this.scoreOpen) {
    this.scoreOpen = open;
    this.el.score.hidden = !open;
    if (open) this.updateScore();
  }

  updateScore() {
    this.el.scoreBody.replaceChildren(scoreTable(this.game));
  }

  // --- сообщения ---
  banner(text, bad = false) {
    if (this.bannerTimer > 0.6) { if (this.bannerQueue.length < 3) this.bannerQueue.push([text, bad]); return; }
    const b = this.el.banner;
    b.textContent = text;
    b.classList.toggle('bad', bad);
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    this.bannerTimer = 2;
  }

  addFloat(unit, text, cls, dx = 0) {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    this.el.floatLayer.append(el);
    this.floats.push({ el, x: unit.pos.x + dx, z: unit.pos.z, h: unit.barHeight + 0.4, t: 0, life: 0.9 });
  }

  onDamage({ target, source, amount, type, crit }) {
    const p = this.game.player;
    if (amount < 1 || (source !== p && target !== p)) return;
    if (this.floats.length > 40) return;
    const cls = target === p ? 'taken' : crit ? 'crit' : type === 'magic' ? 'magic' : type === 'true' ? 'true' : 'phys';
    this.addFloat(target, crit ? `${Math.round(amount)}!` : String(Math.round(amount)), cls, (Math.random() - 0.5) * 1.2);
  }

  project(x, y, z) {
    const v = this.v.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }

  barFor(u) {
    let b = this.bars.get(u);
    if (!b) {
      const p = this.game.player;
      const el = document.createElement('div');
      const rel = u === p ? 'me' : u.team === TEAM.NEUTRAL ? 'neutral' : u.team === p.team ? 'ally' : 'enemy';
      el.className = `ubar ${rel} ${u.kind === 'hero' ? 'hero' : u.isStructure ? 'struct' : u.kind === 'monster' ? 'mon' : ''}`;
      const fill = document.createElement('i');
      el.append(fill);
      let shield = null, lvl = null;
      if (u.kind === 'hero') {
        shield = document.createElement('s');
        lvl = document.createElement('b');
        const name = document.createElement('u');
        name.textContent = u.name;
        el.append(shield, lvl, name);
      }
      this.el.barsLayer.append(el);
      b = { el, fill, shield, lvl, lastW: -1, lastLvl: 0, shown: true };
      this.bars.set(u, b);
    }
    return b;
  }

  update(dt) {
    const g = this.game, p = g.player;

    for (const [u, b] of this.bars) {
      if ((!u.alive && u.kind !== 'hero') || !g.units.includes(u)) { b.el.remove(); this.bars.delete(u); }
    }
    for (const u of g.units) {
      const b = this.barFor(u);
      const visible = u.alive && g.isVisible(p.team, u);
      const s = visible ? this.project(u.pos.x, u.barHeight, u.pos.z) : null;
      const show = s && s.x > -60 && s.x < innerWidth + 60 && s.y > -20 && s.y < innerHeight + 20;
      if (!show) { if (b.shown) { b.el.style.display = 'none'; b.shown = false; } continue; }
      if (!b.shown) { b.el.style.display = ''; b.shown = true; }
      b.el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px)`;
      const w = Math.round(u.hp / u.maxHp * 100);
      if (w !== b.lastW) { b.fill.style.width = w + '%'; b.lastW = w; }
      if (u.isStructure) b.el.classList.toggle('locked', u.invulnerable);
      if (b.shield) b.shield.style.width = u.shield > 0 ? Math.min(100, u.shield / u.maxHp * 100) + '%' : '0';
      if (b.lvl && b.lastLvl !== u.level) { b.lvl.textContent = u.level; b.lastLvl = u.level; }
    }

    this.floats = this.floats.filter((f) => {
      f.t += dt;
      const s = this.project(f.x, f.h + f.t * 2.2, f.z);
      if (s) {
        f.el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translateX(-50%)`;
        f.el.style.opacity = String(Math.min(1, 1.6 * (1 - f.t / f.life)));
      }
      if (f.t >= f.life) { f.el.remove(); return false; }
      return true;
    });

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.el.banner.hidden = true;
        const next = this.bannerQueue.shift();
        if (next) this.banner(...next);
      }
    }

    // кнопки умений
    for (const k of 'QWER') {
      const a = this.ab[k];
      const rank = p.ranks[k];
      const cd = p.cd[k];
      const def = p.ability(k);
      const max = rank ? def.cooldown[rank - 1] * (1 - p.cdr) : 1;
      a.cd.style.setProperty('--p', rank === 0 ? '100%' : `${cd > 0 ? (cd / max) * 100 : 0}%`);
      const label = rank === 0 ? (k === 'R' && p.level < HERO.ultLevels[0] ? `${HERO.ultLevels[0]} ур.` : '') : cd > 0 ? String(Math.ceil(cd)) : '';
      if (a.em.textContent !== label) a.em.textContent = label;
      a.btn.classList.toggle('off', rank === 0 || cd > 0 || !p.canAct);
      a.btn.classList.toggle('nomana', rank > 0 && p.mana < p.manaCost(k));
      const pips = '●'.repeat(rank) + '○'.repeat(a.max - rank);
      if (a.pips.textContent !== pips) a.pips.textContent = pips;
      a.rank.hidden = !p.alive || !p.canRankUp(k);
    }

    // заклинания призывателя
    for (const sb of this.spellBtns) {
      const cd = p.spellCd[sb.id];
      sb.cd.style.setProperty('--p', `${(cd / SPELLS[sb.id].cooldown) * 100}%`);
      const label = cd > 0 ? String(Math.ceil(cd)) : '';
      if (sb.em.textContent !== label) sb.em.textContent = label;
    }

    // предмет с активным действием
    const act = p.activeItem;
    this.el.activeBtn.hidden = !act;
    if (act) {
      this.el.activeBtn.querySelector('.cd').style.setProperty('--p', `${(p.activeCd / ITEMS[act].active.cooldown) * 100}%`);
      this.el.activeBtn.querySelector('em').textContent = p.activeCd > 0 ? Math.ceil(p.activeCd) : '';
    }

    this.el.vignette.style.opacity = p.alive && p.hp / p.maxHp < 0.3 ? String(0.9 - (p.hp / p.maxHp) * 2) : '0';

    this.slowTimer -= dt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.12;
      const e = this.el;
      e.lvl.textContent = p.level;
      e.hpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
      e.hpText.textContent = `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`;
      e.mpFill.style.width = `${(p.mana / p.maxMana) * 100}%`;
      e.mpText.textContent = `${Math.floor(p.mana)} / ${Math.round(p.maxMana)}`;
      e.xpFill.style.width = p.level >= HERO.maxLevel ? '100%' : `${(p.xp / HERO.xpToLevel(p.level)) * 100}%`;
      e.gold.textContent = Math.floor(p.gold);
      e.killsBlue.textContent = g.kills[0];
      e.killsRed.textContent = g.kills[1];
      e.clock.textContent = fmtTime(g.time);
      e.death.hidden = p.alive || g.over;
      if (!p.alive) e.deathTimer.textContent = Math.ceil(p.respawnTimer);
      e.shopBtn.classList.toggle('on', p.inBase && p.alive);
      e.recallBtn.classList.toggle('on', !!p.recall);
      e.recallBtn.textContent = p.recall ? `Домой ${p.recall.t.toFixed(1)}` : 'Домой';
      // быстрая покупка по рекомендованной сборке
      const step = p.inBase && p.alive ? g.nextBuildStep(p) : null;
      e.quickBtn.hidden = !step;
      if (step) {
        e.quickBtn.textContent = `${ITEMS[step.id].name} · ${step.price}`;
        e.quickBtn.disabled = !g.canBuy(p, step.id);
      }
      // усиления
      const chips = [];
      for (const id of ['red', 'blue']) {
        const b = p.buffs.get(id);
        if (b) chips.push(`<span class="chip ${id}">${id === 'red' ? 'Багр.' : 'Лаз.'} ${Math.ceil(b.until - g.time)}</span>`);
      }
      if (g.dragonStacks[p.team]) chips.push(`<span class="chip dragon">Дракон ×${g.dragonStacks[p.team]}</span>`);
      const html = chips.join('');
      if (e.buffs.innerHTML !== html) e.buffs.innerHTML = html;
      if (this.shopOpen) this.updateShop();
      if (this.scoreOpen) this.updateScore();
    }

    this.mapTimer -= dt;
    if (this.mapTimer <= 0) { this.mapTimer = 0.15; this.drawMinimap(); }
  }

  drawMinimap() {
    const c = this.mini, W = 288, H = 112;
    const sx = (x) => (x + 72) * 2;
    const sz = (z) => (z + 28) * 2;
    const g = this.game, p = g.player;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(52,82,47,0.9)';
    c.fillRect(sx(-MAP.jungleHalfX), sz(-MAP.jungleHalfZ), MAP.jungleHalfX * 4, MAP.jungleHalfZ * 4);
    c.fillStyle = 'rgba(139,122,88,0.95)';
    c.fillRect(sx(-MAP.baseX), sz(-MAP.laneHalfWidth), MAP.baseX * 4, MAP.laneHalfWidth * 4);
    c.fillStyle = 'rgba(47,127,168,0.9)';
    c.fillRect(sx(-MAP.riverHalfWidth), sz(-MAP.jungleHalfZ), MAP.riverHalfWidth * 4, MAP.jungleHalfZ * 4);
    c.fillStyle = 'rgba(20,40,24,0.95)';
    for (const w of WALLS) c.fillRect(sx(w[0]), sz(w[1]), (w[2] - w[0]) * 2, (w[3] - w[1]) * 2);
    for (const [x, col] of [[-MAP.baseX, 'rgba(61,139,255,0.45)'], [MAP.baseX, 'rgba(255,74,61,0.45)']]) {
      c.fillStyle = col;
      c.beginPath(); c.arc(sx(x), sz(0), MAP.baseRadius * 2, 0, 7); c.fill();
    }
    const col = ['#58a6ff', '#ff5a4a', '#ffc24a'];
    for (const u of g.units) {
      if (!u.alive || u.kind === 'hero' || !g.isVisible(p.team, u)) continue;
      c.fillStyle = col[u.team];
      const x = sx(u.pos.x), y = sz(u.pos.z);
      if (u.kind === 'creep') c.fillRect(x - 2, y - 2, 4, 4);
      else if (u.kind === 'monster') { c.beginPath(); c.arc(x, y, u.monsterKind === 'dragon' ? 6 : 4, 0, 7); c.fill(); }
      else if (u.kind === 'tower') { c.fillRect(x - 5, y - 5, 10, 10); c.strokeStyle = '#000'; c.lineWidth = 1; c.strokeRect(x - 5, y - 5, 10, 10); }
      else if (u.kind === 'nexus') { c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 7, y); c.lineTo(x, y + 9); c.lineTo(x - 7, y); c.fill(); }
    }
    for (const h of g.allHeroes) {
      if (!h.alive || !g.isVisible(p.team, h)) continue;
      c.fillStyle = col[h.team];
      c.strokeStyle = h === p ? '#6dff8a' : '#fff';
      c.lineWidth = 2;
      c.beginPath(); c.arc(sx(h.pos.x), sz(h.pos.z), 6, 0, 7); c.fill(); c.stroke();
    }
    // рамка камеры
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1;
    c.strokeRect(sx(p.pos.x) - 36, sz(p.pos.z) - 22, 72, 44);
  }

  clear() {
    for (const [, b] of this.bars) b.el.remove();
    this.bars.clear();
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    this.el.banner.hidden = true;
    this.toggleShop(false);
    this.toggleScore(false);
  }
}

// Таблица счёта: обе команды, уровень, У/С/П, крипы, предметы
export function scoreTable(game) {
  const wrap = document.createDocumentFragment();
  for (const team of [TEAM.BLUE, TEAM.RED]) {
    const h3 = document.createElement('h3');
    h3.className = team === TEAM.BLUE ? 'blue' : 'red';
    h3.textContent = `${TEAM_NAME[team]} · ${game.kills[team]}`;
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const t of ['Герой', 'Ур.', 'У / С / П', 'Крипы', 'Предметы']) {
      const th = document.createElement('th');
      th.textContent = t;
      head.append(th);
    }
    table.append(head);
    for (const h of game.heroes[team]) {
      const tr = document.createElement('tr');
      if (h === game.player) tr.className = 'mine';
      const cells = [
        `${h.name} (${h.heroDef.role})`, h.level, `${h.kills} / ${h.deaths} / ${h.assists}`, h.cs,
        h.items.map((id) => ITEMS[id].name).join(', ') || '—',
      ];
      for (const v of cells) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(td);
      }
      table.append(tr);
    }
    wrap.append(h3, table);
  }
  return wrap;
}

// --- Тексты описаний -------------------------------------------------------------
const num = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const pct = (v) => `${Math.round(v * 100)}%`;
const sentence = (parts) => { const t = parts.join('; ') + '.'; return t[0].toUpperCase() + t.slice(1); };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tipHeader(name, key, rankText) {
  const h = el('header');
  h.append(el('h4', '', name), el('span', 'key', key));
  return [h, el('div', 'tip-rank', rankText)];
}

// Урон умения на ранге r с учётом характеристик героя
function abilityDamage(p, def, r) {
  let v = def.damage[r - 1];
  if (def.ap) v += p.ap * def.ap;
  if (def.adRatio) v += p.ad * def.adRatio;
  if (def.hpRatio) v += p.maxHp * def.hpRatio;
  return v * p.outMul;
}

function scalingText(def) {
  const parts = [];
  if (def.ap) parts.push(`${pct(def.ap)} силы умений`);
  if (def.adRatio) parts.push(`${pct(def.adRatio)} урона`);
  if (def.hpRatio) parts.push(`${pct(def.hpRatio)} макс. здоровья`);
  return parts.length ? ` + ${parts.join(' + ')}` : '';
}

function effectsText(def, i) {
  const fx = [];
  if (def.slow) fx.push(`замедляет на ${pct(def.slow)} на ${num(def.slowTime)} с`);
  if (def.stun) fx.push(`оглушает на ${num(def.stun)} с`);
  if (def.knockback) fx.push(`отбрасывает на ${num(def.knockback)} м`);
  if (def.shield) fx.push(`щит ${def.shield[i]}${def.ap ? ` + ${pct(def.ap)} силы умений` : ''} на ${num(def.duration)} с`);
  if (def.resist) fx.push(`+${def.resist[i]} брони и сопр. магии на ${num(def.duration)} с`);
  if (def.hpShield) fx.push(`щит ${pct(def.hpShield)} макс. здоровья`);
  if (def.attackSpeed) fx.push(`+${pct(def.attackSpeed[i])} скорости атаки на ${num(def.duration)} с`);
  if (def.empower) fx.push(`следующая атака сильнее на ${pct(def.empower[i])}`);
  if (def.pierce) fx.push('пробивает всех на пути');
  if (def.heroOnly) fx.push('летит сквозь крипов, бьёт только героев');
  if (def.delay) fx.push(`срабатывает через ${num(def.delay)} с`);
  return fx;
}

export function abilityTip(p, key) {
  const def = p.ability(key);
  const r = p.ranks[key];
  const max = def.ult ? HERO.ultLevels.length : HERO.basicMaxRank;
  const i = Math.max(0, r - 1);
  let rankText = r ? `Ранг ${r} из ${max}` : 'Не изучено';
  if (!r && def.ult) rankText += `. Открывается на ${HERO.ultLevels[0]} уровне`;
  const out = tipHeader(def.name, key, rankText);
  out.push(el('div', '', def.desc));
  const stats = el('div', 'stats');
  stats.append(el('span', 'cd', `Перезарядка ${num(def.cooldown[i] * (1 - p.cdr))} с`), el('span', 'mana', `Мана ${def.mana[i]}`));
  if (def.range) stats.append(el('span', '', `Дальность ${num(def.range)} м`));
  if (def.radius) stats.append(el('span', '', `Радиус ${num(def.radius)} м`));
  out.push(stats);
  if (def.damage) {
    const type = def.type === 'magic' ? 'магический' : 'физический';
    const line = el('div', 'stats');
    line.append(el('span', def.type === 'magic' ? 'magic' : 'phys',
      `Урон ${def.damage[i]}${scalingText(def)} (${type}), сейчас ≈ ${Math.round(abilityDamage(p, def, i + 1))}`));
    out.push(line);
  }
  const fx = effectsText(def, i);
  if (fx.length) out.push(el('div', 'fx', sentence(fx)));
  if (r < max) {
    const n = r; // индекс следующего ранга
    const next = [`перезарядка ${num(def.cooldown[n])} с`];
    if (def.damage) next.unshift(`урон ${def.damage[n]}`);
    if (def.shield) next.push(`щит ${def.shield[n]}`);
    if (def.resist) next.push(`броня ${def.resist[n]}`);
    if (def.attackSpeed) next.push(`скорость атаки +${pct(def.attackSpeed[n])}`);
    if (def.empower) next.push(`усиление ${pct(def.empower[n])}`);
    out.push(el('div', 'next', `${r ? 'Следующий ранг' : 'Ранг 1'}: ${next.join(', ')}`));
  }
  out.push(el('div', 'next', 'Отпустите — умение не применится. Касание применяет сразу, перетаскивание — с прицелом.'));
  return out;
}

export function spellTip(p, key) {
  const id = p.spells[+key[1] - 1];
  const def = SPELLS[id];
  const out = tipHeader(def.name, 'Заклинание', `Перезарядка ${def.cooldown} с`);
  out.push(el('div', '', def.desc));
  const v = [];
  if (def.heal) v.push(`лечит на ${def.heal(p.level)} сейчас`);
  if (def.shield) v.push(`щит ${def.shield(p.level)} сейчас`);
  if (def.damage) v.push(`${def.damage(p.level)} чистого урона за ${def.duration} с, дальность ${num(def.range)} м`);
  if (def.distance) v.push('можно потянуть, чтобы выбрать направление');
  if (v.length) out.push(el('div', 'fx', sentence(v)));
  return out;
}
