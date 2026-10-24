// Слои поверх карты: затемнение тумана войны и индикатор прицела умений.
import * as THREE from 'three';
import { MAP, VISION, ABILITIES, SPELLS, side } from './config.js';
import { ringDecal, lineDecal } from './models.js';

const W = 144, H = 56; // метры, по 2 пикселя на метр

export class FogOverlay {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W * 2;
    this.canvas.height = H * 2;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.12;
    mesh.renderOrder = 1;
    scene.add(mesh);
    this.mesh = mesh;
    this.timer = 0;
  }

  update(game, team, dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.15;
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W * 2, H * 2);
    c.fillStyle = 'rgba(4, 8, 14, 0.62)';
    c.fillRect(0, 0, W * 2, H * 2);
    c.globalCompositeOperation = 'destination-out';
    const hole = (x, z, r) => {
      const px = (x + W / 2) * 2, py = (z + H / 2) * 2, pr = r * 2;
      const g = c.createRadialGradient(px, py, pr * 0.75, px, py, pr);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(px, py, pr, 0, Math.PI * 2);
      c.fill();
    };
    for (const u of game.units) {
      if (!u.alive || u.team !== team) continue;
      hole(u.pos.x, u.pos.z, VISION[u.kind] ?? 8);
    }
    hole(side(team) * MAP.fountainX, 0, MAP.baseRadius + 2);
    this.tex.needsUpdate = true;
  }

  dispose() { this.tex.dispose(); }
}

// Прицел: линия или круг на земле плюс круг дальности вокруг героя
export class AimIndicator {
  constructor(scene) {
    this.line = lineDecal(0x9fe8ff, 0.32);
    this.area = ringDecal(0x9fe8ff, 1, 0.8, 0.12);
    this.areaFill = ringDecal(0x9fe8ff, 1, 0.18, 1);
    this.range = ringDecal(0xffffff, 1, 0.22, 0.03);
    for (const m of [this.line, this.area, this.areaFill, this.range]) { m.visible = false; m.renderOrder = 2; scene.add(m); }
  }

  hide() { for (const m of [this.line, this.area, this.areaFill, this.range]) m.visible = false; }

  // aiming: { key, dx, dz, mag, manual }; возвращает aim для умения
  update(hero, aiming, cancel) {
    this.hide();
    if (!aiming || !hero.alive) return null;
    const spellId = aiming.key[0] === 'S' ? hero.spells[+aiming.key[1] - 1] : null;
    const def = spellId ? { aim: 'line', range: SPELLS[spellId].distance ?? 4, width: 0.5 } : ABILITIES[hero.abilityIds[aiming.key]];
    const color = cancel ? 0xff5050 : 0x9fe8ff;
    const range = def.range ?? def.radius ?? 3;
    this.range.visible = true;
    this.range.scale.setScalar(range);
    this.range.position.set(hero.pos.x, 0.09, hero.pos.z);
    let dir;
    if (aiming.manual) dir = { x: aiming.dx, z: aiming.dz };
    else if (spellId) dir = { x: Math.sin(hero.facing), z: Math.cos(hero.facing) };
    else {
      const t = hero.aimTarget(range, !!def.heroOnly);
      if (t) {
        const dx = t.pos.x - hero.pos.x, dz = t.pos.z - hero.pos.z, d = Math.hypot(dx, dz) || 1;
        dir = { x: dx / d, z: dz / d };
      } else dir = { x: Math.sin(hero.facing), z: Math.cos(hero.facing) };
    }
    if (def.aim === 'circle') {
      const t = !aiming.manual ? hero.aimTarget(range) : null;
      const dist = aiming.manual ? Math.max(0.15, aiming.mag) * range : t ? Math.min(range, Math.hypot(t.pos.x - hero.pos.x, t.pos.z - hero.pos.z)) : range * 0.6;
      const p = { x: hero.pos.x + dir.x * dist, z: hero.pos.z + dir.z * dist };
      for (const m of [this.area, this.areaFill]) {
        m.visible = true;
        m.scale.setScalar(def.radius);
        m.position.set(p.x, 0.1, p.z);
        m.material.color.set(color);
      }
      return { point: p };
    }
    const len = def.range;
    const width = def.width ? def.width * 2 : 1.4;
    this.line.visible = true;
    this.line.scale.set(width, 1, len);
    this.line.position.set(hero.pos.x, 0.1, hero.pos.z);
    this.line.rotation.y = Math.atan2(dir.x, dir.z);
    this.line.material.color.set(color);
    return { dir };
  }
}

// Маркер цели обычной атаки: кольцо на земле под целью, которую выбрала логика боя.
// Жёлтый с тёмной подложкой — не путается с голубым прицелом умений, зелёным кольцом игрока
// и цветами команд. Всё создаётся один раз на матч; в кадре меняются только позиция и масштаб.
const MARKER_COLOR = 0xffd84a;

export class TargetMarker {
  constructor(scene) {
    this.group = new THREE.Group();
    this.spin = new THREE.Group();
    const under = ringDecal(0x000000, 1.08, 0.5, 0.3);
    const ring = ringDecal(MARKER_COLOR, 1, 0.95, 0.13);
    this.group.add(under, ring, this.spin);
    // четыре засечки-стрелки, смотрят к центру
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0.16, 0, 0, 0, 0, -0.26], 3));
    const triMat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tri, triMat);
      const a = (i * Math.PI) / 2;
      t.position.set(Math.sin(a) * 1.28, 0.07, Math.cos(a) * 1.28);
      t.rotation.y = a;
      this.spin.add(t);
    }
    this.group.traverse((o) => { o.renderOrder = 3; });
    this.group.visible = false;
    this.target = null;
    this.t = 0;
    scene.add(this.group);
  }

  // target — цель атаки игрока (hero.attackTarget) или null
  update(target, dt) {
    this.target = target;
    this.group.visible = !!target;
    if (!target) return;
    this.t += dt;
    const r = target.radius + 0.35;
    this.group.position.set(target.pos.x, 0, target.pos.z);
    this.group.scale.setScalar(r * (1 + Math.sin(this.t * 6) * 0.04));
    this.spin.rotation.y += dt * 1.2;
  }

  dispose() {
    this.group.traverse((o) => { if (o.material) o.material.dispose(); });
    this.group.removeFromParent();
  }
}
