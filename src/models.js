// Low-poly модели, собранные из простых фигур. Позже их можно заменить на готовые модели.
import * as THREE from 'three';
import { TEAM_COLOR, TEAM_GLOW } from './config.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = opts.glow
      ? new THREE.MeshBasicMaterial({ color, transparent: !!opts.opacity, opacity: opts.opacity ?? 1 })
      : new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: opts.emissive ?? 0x000000 });
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

const SKIN = 0xe8b894;
const STONE = 0x8a8f9c;
const STONE_DARK = 0x5d6270;
const darker = (c, k = 0.6) => new THREE.Color(c).multiplyScalar(k).getHex();

export function heroModel(team) {
  const g = new THREE.Group();
  const c = TEAM_COLOR[team];
  const robe = mesh(new THREE.CylinderGeometry(0.32, 0.62, 1.15, 7), mat(c), 0, 0.58, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.44, 0.36, 0.62, 7), mat(darker(c)), 0, 1.45, 0);
  const head = mesh(new THREE.IcosahedronGeometry(0.31, 0), mat(SKIN), 0, 2.02, 0);
  const hood = mesh(new THREE.ConeGeometry(0.4, 0.7, 7), mat(c), 0, 2.4, -0.02);
  hood.rotation.x = -0.15;
  const shL = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(0xd9c27a), -0.44, 1.7, 0);
  const shR = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(0xd9c27a), 0.44, 1.7, 0);
  const staff = new THREE.Group();
  staff.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 5), mat(0x6b4a2f), 0, 0, 0));
  const orb = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(TEAM_GLOW[team], { glow: true }), 0, 1.15, 0, false);
  staff.add(orb);
  staff.position.set(0.62, 1.3, 0.15);
  g.add(robe, torso, head, hood, shL, shR, staff);
  return { group: g, orb, staff, body: [robe, torso, head, hood, shL, shR] };
}

export function creepModel(team, ranged) {
  const g = new THREE.Group();
  const c = TEAM_COLOR[team];
  const s = ranged ? 0.85 : 1;
  const body = mesh(new THREE.BoxGeometry(0.7 * s, 0.8 * s, 0.55 * s), mat(darker(c, 0.8)), 0, 0.55 * s, 0);
  const head = mesh(new THREE.BoxGeometry(0.45 * s, 0.4 * s, 0.45 * s), mat(ranged ? SKIN : STONE), 0, 1.15 * s, 0);
  g.add(body, head);
  let orb = null;
  if (ranged) {
    orb = mesh(new THREE.OctahedronGeometry(0.16), mat(TEAM_GLOW[team], { glow: true }), 0.42, 0.95, 0.2, false);
    g.add(orb);
  } else {
    const sword = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), mat(0xc9ced8), 0.45, 0.6, 0.35);
    g.add(sword);
  }
  return { group: g, orb, body: [body, head] };
}

export function towerModel(team) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.9, 8), mat(STONE_DARK), 0, 0.45, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.3, 4.2, 8), mat(STONE), 0, 2.9, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.45, 1.1, 0.6, 8), mat(STONE_DARK), 0, 5.2, 0));
  const band = mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.35, 8), mat(TEAM_COLOR[team]), 0, 4.2, 0);
  g.add(band);
  const crystal = mesh(new THREE.OctahedronGeometry(0.7), mat(TEAM_GLOW[team], { glow: true }), 0, 6.5, 0, false);
  crystal.scale.y = 1.5;
  g.add(crystal);
  return { group: g, crystal, body: [band] };
}

export function nexusModel(team) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(2.5, 2.9, 1.0, 6), mat(STONE_DARK), 0, 0.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.8, 2.2, 0.6, 6), mat(STONE), 0, 1.3, 0));
  const crystal = mesh(new THREE.OctahedronGeometry(1.5), mat(TEAM_COLOR[team], { emissive: darker(TEAM_COLOR[team], 0.45) }), 0, 3.6, 0);
  crystal.scale.y = 1.4;
  const ring = mesh(new THREE.TorusGeometry(2.1, 0.09, 4, 24), mat(TEAM_GLOW[team], { glow: true }), 0, 3.6, 0, false);
  ring.rotation.x = Math.PI / 2;
  g.add(crystal, ring);
  return { group: g, crystal, ring, body: [crystal] };
}

export function projectileModel(color, size = 0.22) {
  return mesh(new THREE.IcosahedronGeometry(size, 0), mat(color, { glow: true }), 0, 0, 0, false);
}

export function treeModel(rand) {
  const g = new THREE.Group();
  const h = 2.4 + rand() * 1.6;
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.9, 5), mat(0x5a3d26), 0, 0.45, 0));
  const greens = [0x2f6b3a, 0x3a7d3f, 0x27593a];
  const crown = mesh(new THREE.ConeGeometry(1.1 + rand() * 0.5, h, 6), mat(greens[Math.floor(rand() * 3)]), 0, 0.9 + h / 2, 0);
  crown.rotation.y = rand() * Math.PI;
  g.add(crown);
  return g;
}

export function rockModel(rand) {
  const r = mesh(new THREE.DodecahedronGeometry(0.5 + rand() * 0.7, 0), mat(rand() > 0.5 ? STONE : STONE_DARK), 0, 0.2, 0);
  r.rotation.set(rand() * 3, rand() * 3, rand() * 3);
  r.scale.y = 0.6;
  return r;
}

// Круг-указатель на земле (зона метеора, выделение цели)
export function ringDecal(color, radius, opacity = 0.5) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  return m;
}

export function discDecal(color, radius, opacity = 0.25) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  return m;
}
