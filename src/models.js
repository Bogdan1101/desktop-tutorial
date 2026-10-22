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
const GOLD = 0xd9c27a;
export const darker = (c, k = 0.6) => new THREE.Color(c).multiplyScalar(k).getHex();

function pyroModel(team) {
  const g = new THREE.Group();
  const c = TEAM_COLOR[team];
  const robe = mesh(new THREE.CylinderGeometry(0.32, 0.62, 1.15, 7), mat(c), 0, 0.58, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.44, 0.36, 0.62, 7), mat(darker(c)), 0, 1.45, 0);
  const head = mesh(new THREE.IcosahedronGeometry(0.31, 0), mat(SKIN), 0, 2.02, 0);
  const hood = mesh(new THREE.ConeGeometry(0.4, 0.7, 7), mat(c), 0, 2.4, -0.02);
  hood.rotation.x = -0.15;
  const shL = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(GOLD), -0.44, 1.7, 0);
  const shR = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(GOLD), 0.44, 1.7, 0);
  const weapon = new THREE.Group();
  weapon.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 5), mat(0x6b4a2f), 0, 0, 0));
  const orb = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(0xffa63d, { glow: true }), 0, 1.15, 0, false);
  weapon.add(orb);
  weapon.position.set(0.62, 1.3, 0.15);
  g.add(robe, torso, head, hood, shL, shR, weapon);
  return { group: g, orb, weapon };
}

function grokModel(team) {
  const g = new THREE.Group();
  const c = TEAM_COLOR[team];
  const legs = mesh(new THREE.BoxGeometry(0.9, 0.8, 0.6), mat(STONE_DARK), 0, 0.4, 0);
  const body = mesh(new THREE.BoxGeometry(1.25, 1.0, 0.85), mat(c), 0, 1.3, 0);
  const belt = mesh(new THREE.BoxGeometry(1.3, 0.18, 0.9), mat(GOLD), 0, 0.85, 0);
  const head = mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(SKIN), 0, 2.05, 0.05);
  const helm = mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.35, 6), mat(STONE), 0, 2.32, 0.02);
  const hornL = mesh(new THREE.ConeGeometry(0.09, 0.4, 4), mat(0xeee6cf), -0.36, 2.45, 0);
  hornL.rotation.z = 0.8;
  const hornR = hornL.clone(); hornR.position.x = 0.36; hornR.rotation.z = -0.8;
  const padL = mesh(new THREE.BoxGeometry(0.5, 0.3, 0.6), mat(STONE), -0.78, 1.75, 0);
  const padR = padL.clone(); padR.position.x = 0.78;
  const weapon = new THREE.Group();
  const shield = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 8), mat(darker(c, 0.8)), 0, 0, 0);
  shield.rotation.z = Math.PI / 2;
  const boss = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(GOLD), 0.1, 0, 0);
  weapon.add(shield, boss);
  weapon.position.set(-0.85, 1.25, 0.35);
  weapon.rotation.y = -0.3;
  const orb = mesh(new THREE.OctahedronGeometry(0.15), mat(TEAM_GLOW[team], { glow: true }), 0, 1.4, 0.45, false);
  g.add(legs, body, belt, head, helm, hornL, hornR, padL, padR, weapon, orb);
  g.scale.setScalar(1.08);
  return { group: g, orb, weapon };
}

function liraModel(team) {
  const g = new THREE.Group();
  const c = TEAM_COLOR[team];
  const legs = mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 6), mat(0x3b3226), 0, 0.45, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.75, 6), mat(c), 0, 1.25, 0);
  const cape = mesh(new THREE.ConeGeometry(0.5, 1.2, 6, 1, true), mat(darker(c, 0.7)), 0, 1.2, -0.12);
  const head = mesh(new THREE.IcosahedronGeometry(0.28, 0), mat(SKIN), 0, 1.86, 0);
  const hair = mesh(new THREE.ConeGeometry(0.16, 0.7, 5), mat(0xc8902e), 0, 1.7, -0.32);
  hair.rotation.x = 0.5;
  const weapon = new THREE.Group();
  const bow = mesh(new THREE.TorusGeometry(0.75, 0.05, 4, 10, Math.PI), mat(0x7a5230), 0, 0, 0);
  bow.rotation.z = -Math.PI / 2;
  const string = mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.5, 3), mat(0xf2efe6), 0, 0, 0, false);
  weapon.add(bow, string);
  weapon.position.set(0.5, 1.3, 0.3);
  const orb = mesh(new THREE.OctahedronGeometry(0.12), mat(0xfff1a8, { glow: true }), 0.6, 1.3, 0.3, false);
  g.add(legs, torso, cape, head, hair, weapon, orb);
  return { group: g, orb, weapon };
}

export function heroModel(team, heroId) {
  if (heroId === 'grok') return grokModel(team);
  if (heroId === 'lira') return liraModel(team);
  return pyroModel(team);
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
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), mat(0xc9ced8), 0.45, 0.6, 0.35));
  }
  return { group: g, orb };
}

export function monsterModel(kind) {
  const g = new THREE.Group();
  if (kind === 'dragon') {
    const c = 0x8e4bd6;
    const body = mesh(new THREE.SphereGeometry(1.4, 8, 6), mat(c), 0, 1.6, 0);
    body.scale.set(1, 0.8, 1.5);
    const neck = mesh(new THREE.CylinderGeometry(0.35, 0.55, 1.5, 6), mat(c), 0, 2.5, 1.5);
    neck.rotation.x = 0.7;
    const head = mesh(new THREE.ConeGeometry(0.55, 1.3, 6), mat(darker(c, 0.8)), 0, 3.1, 2.4);
    head.rotation.x = Math.PI / 2;
    const tail = mesh(new THREE.ConeGeometry(0.5, 2.6, 6), mat(c), 0, 1.3, -2.6);
    tail.rotation.x = -Math.PI / 2 - 0.2;
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.8, 0, 0, -1, 3, 0.6, -0.6], 3));
    wingGeo.computeVertexNormals();
    const wingMat = new THREE.MeshLambertMaterial({ color: 0xc58bff, side: THREE.DoubleSide, flatShading: true });
    const wingL = new THREE.Mesh(wingGeo, wingMat); wingL.position.set(0.6, 2.1, 0);
    const wingR = new THREE.Mesh(wingGeo, wingMat); wingR.position.set(-0.6, 2.1, 0); wingR.scale.x = -1;
    const eye = mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(0xffe066, { glow: true }), 0, 3.25, 2.6, false);
    g.add(body, neck, head, tail, wingL, wingR, eye);
    return { group: g, orb: eye, wings: [wingL, wingR] };
  }
  const core = kind === 'red' ? 0xff5a3d : 0x4fb6ff;
  const legs = mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), mat(STONE_DARK), 0, 0.45, 0);
  const body = mesh(new THREE.DodecahedronGeometry(1.05, 0), mat(0x6f6a5e), 0, 1.65, 0);
  const armL = mesh(new THREE.BoxGeometry(0.45, 1.2, 0.45), mat(STONE), -1.15, 1.4, 0.1);
  const armR = armL.clone(); armR.position.x = 1.15;
  const orb = mesh(new THREE.OctahedronGeometry(0.42), mat(core, { glow: true }), 0, 1.75, 0.75, false);
  g.add(legs, body, armL, armR, orb);
  return { group: g, orb };
}

export function towerModel(team) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.9, 8), mat(STONE_DARK), 0, 0.45, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.3, 4.2, 8), mat(STONE), 0, 2.9, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.45, 1.1, 0.6, 8), mat(STONE_DARK), 0, 5.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.35, 8), mat(TEAM_COLOR[team]), 0, 4.2, 0));
  const crystal = mesh(new THREE.OctahedronGeometry(0.7), mat(TEAM_GLOW[team], { glow: true }), 0, 6.5, 0, false);
  crystal.scale.y = 1.5;
  g.add(crystal);
  return { group: g, crystal };
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
  return { group: g, crystal, ring };
}

export function projectileModel(color, size = 0.22) {
  return mesh(new THREE.IcosahedronGeometry(size, 0), mat(color, { glow: true }), 0, 0, 0, false);
}

export function arrowModel(color, length = 1.2) {
  const m = mesh(new THREE.CylinderGeometry(0.06, 0.06, length, 4), mat(color, { glow: true }), 0, 0, 0, false);
  m.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function rockModel(rand) {
  const r = mesh(new THREE.DodecahedronGeometry(0.5 + rand() * 0.7, 0), mat(rand() > 0.5 ? STONE : STONE_DARK), 0, 0.2, 0);
  r.rotation.set(rand() * 3, rand() * 3, rand() * 3);
  r.scale.y = 0.6;
  return r;
}

// Кольцо со звёздочками над оглушённым
export function stunModel() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = mesh(new THREE.OctahedronGeometry(0.13), mat(0xffe066, { glow: true }), Math.cos(i * 2.1) * 0.5, 0, Math.sin(i * 2.1) * 0.5, false);
    g.add(s);
  }
  return g;
}

export function ringDecal(color, radius, opacity = 0.5, thickness = 0.14) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(radius * (1 - thickness), radius, 48),
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

// Прямоугольник на земле для прицела по линии; длина вдоль локальной оси Z
export function lineDecal(color, opacity = 0.35) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.position.y = 0.08;
  return m;
}
