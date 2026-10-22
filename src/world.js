// Статичная карта: земля, линия, река, базы, деревья. Плюс проверка, где можно ходить.
import * as THREE from 'three';
import { MAP, TEAM_COLOR, TEAM } from './config.js';
import { treeModel, rockModel, discDecal, ringDecal } from './models.js';

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildWorld(scene) {
  const rand = seededRandom(7);

  scene.background = new THREE.Color(0x1b2a24);
  scene.fog = new THREE.Fog(0x1b2a24, 45, 95);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x2a3a22, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(-20, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 100;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 110),
    new THREE.MeshLambertMaterial({ color: 0x2d4a2c }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Линия: утоптанная дорога
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.baseX * 2, MAP.laneHalfWidth * 2),
    new THREE.MeshLambertMaterial({ color: 0x8b7a58 }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.y = 0.01;
  lane.receiveShadow = true;
  scene.add(lane);

  // Края дороги
  for (const z of [-MAP.laneHalfWidth, MAP.laneHalfWidth]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.baseX * 2, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x6b5d42 }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(0, 0.02, z);
    scene.add(edge);
  }

  // Река поперёк линии
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 110),
    new THREE.MeshLambertMaterial({ color: 0x2f7fa8, transparent: true, opacity: 0.85 }),
  );
  river.rotation.x = -Math.PI / 2;
  river.position.y = 0.03;
  scene.add(river);

  // Базы
  for (const team of [TEAM.BLUE, TEAM.RED]) {
    const x = team === TEAM.BLUE ? -MAP.baseX : MAP.baseX;
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(MAP.baseRadius, 48),
      new THREE.MeshLambertMaterial({ color: 0x6f7480 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x, 0.015, 0);
    plate.receiveShadow = true;
    scene.add(plate);
    const ring = ringDecal(TEAM_COLOR[team], MAP.baseRadius, 0.6);
    ring.position.set(x, 0.04, 0);
    scene.add(ring);
    const fx = team === TEAM.BLUE ? -MAP.fountainX : MAP.fountainX;
    const fountain = discDecal(TEAM_COLOR[team], MAP.fountainRadius, 0.22);
    fountain.position.set(fx, 0.045, 0);
    scene.add(fountain);
  }

  // Лес по краям
  const placed = [];
  const blocked = (x, z) =>
    Math.abs(z) < MAP.laneHalfWidth + 2.2 ||
    Math.hypot(Math.abs(x) - MAP.baseX, z) < MAP.baseRadius + 2.5 ||
    Math.abs(x) < 4.5 ||
    placed.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6);
  for (let i = 0; i < 420 && placed.length < 150; i++) {
    const x = (rand() * 2 - 1) * 82;
    const z = (rand() > 0.5 ? 1 : -1) * (MAP.laneHalfWidth + 2 + rand() * 24);
    if (blocked(x, z)) continue;
    placed.push({ x, z });
    const obj = rand() > 0.18 ? treeModel(rand) : rockModel(rand);
    obj.position.set(x, obj.position.y, z);
    scene.add(obj);
  }

  return { sun };
}

// Точка внутри линии или базы?
export function isWalkable(x, z) {
  if (Math.abs(x) > MAP.halfLength - 1) return false;
  if (Math.abs(z) <= MAP.laneHalfWidth && Math.abs(x) <= MAP.baseX) return true;
  return Math.hypot(Math.abs(x) - MAP.baseX, z) <= MAP.baseRadius;
}

// Сдвигает точку внутрь проходимой зоны
export function clampToWalkable(p) {
  if (isWalkable(p.x, p.z)) return;
  const maxX = MAP.halfLength - 1;
  // кандидат 1: прямоугольник линии
  const lx = Math.max(-MAP.baseX, Math.min(MAP.baseX, p.x));
  const lz = Math.max(-MAP.laneHalfWidth, Math.min(MAP.laneHalfWidth, p.z));
  // кандидат 2: ближайший круг базы
  const bx = p.x < 0 ? -MAP.baseX : MAP.baseX;
  const dx = p.x - bx, dz = p.z;
  const d = Math.hypot(dx, dz) || 1;
  let cx = d > MAP.baseRadius ? bx + (dx / d) * MAP.baseRadius : p.x;
  const cz = d > MAP.baseRadius ? (dz / d) * MAP.baseRadius : p.z;
  cx = Math.max(-maxX, Math.min(maxX, cx));
  const d1 = Math.hypot(p.x - lx, p.z - lz);
  const d2 = Math.hypot(p.x - cx, p.z - cz);
  if (d1 <= d2) { p.x = lx; p.z = lz; } else { p.x = cx; p.z = cz; }
}
