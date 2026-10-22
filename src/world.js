// Статичная карта: земля, линия, река, лес со стенами и кустами, базы, места монстров.
import * as THREE from 'three';
import { MAP, TEAM_COLOR, TEAM, WALLS, BRUSHES, MONSTERS } from './config.js';
import { discDecal, ringDecal } from './models.js';
import { inRegion } from './nav.js';

export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function flatPlane(w, h, color, x, z, y, opts = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color, ...opts }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

export function buildWorld(scene, quality = 'medium') {
  const rand = seededRandom(7);

  scene.background = new THREE.Color(0x14211c);
  scene.fog = new THREE.Fog(0x14211c, 55, 110);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x2a3a22, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(-20, 40, 18);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 100;
  scene.add(sun, sun.target);

  scene.add(flatPlane(240, 130, 0x23392a, 0, 0, 0));
  // лесная подстилка
  scene.add(flatPlane(MAP.jungleHalfX * 2, MAP.jungleHalfZ * 2, 0x34522f, 0, 0, 0.005));
  // линия
  scene.add(flatPlane(MAP.baseX * 2, MAP.laneHalfWidth * 2, 0x8b7a58, 0, 0, 0.01));
  // река поперёк всей карты
  scene.add(flatPlane(MAP.riverHalfWidth * 2, MAP.jungleHalfZ * 2, 0x2f7fa8, 0, 0, 0.03, { transparent: true, opacity: 0.85 }));

  for (const team of [TEAM.BLUE, TEAM.RED]) {
    const x = team === TEAM.BLUE ? -MAP.baseX : MAP.baseX;
    const plate = new THREE.Mesh(new THREE.CircleGeometry(MAP.baseRadius, 48), new THREE.MeshLambertMaterial({ color: 0x6f7480 }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x, 0.015, 0);
    plate.receiveShadow = true;
    scene.add(plate);
    const ring = ringDecal(TEAM_COLOR[team], MAP.baseRadius, 0.6, 0.05);
    ring.position.set(x, 0.04, 0);
    scene.add(ring);
    const fountain = discDecal(TEAM_COLOR[team], MAP.fountainRadius, 0.22);
    fountain.position.set(team === TEAM.BLUE ? -MAP.fountainX : MAP.fountainX, 0.045, 0);
    scene.add(fountain);
  }

  // Места лагерей монстров
  for (const key of ['red', 'blue', 'dragon']) {
    const m = MONSTERS[key];
    const spots = m.single ? [[m.x, m.z]] : [[m.x, m.z], [-m.x, -m.z]];
    for (const [x, z] of spots) {
      const d = discDecal(key === 'dragon' ? 0x3a2a55 : 0x3d3426, m.single ? 6 : 3.4, 0.55);
      d.position.set(x, 0.035, z);
      scene.add(d);
    }
  }

  // Деревья: стены целиком из деревьев, плюс лес за краем карты
  const trees = [];
  for (const w of WALLS) {
    for (let x = w[0] + 0.9; x < w[2]; x += 1.9) {
      for (let z = w[1] + 0.9; z < w[3]; z += 1.9) trees.push([x + (rand() - 0.5) * 0.6, z + (rand() - 0.5) * 0.6, 0.78]);
    }
  }
  for (let i = 0; i < 1600 && trees.length < 520; i++) {
    const x = (rand() * 2 - 1) * 92;
    const z = (rand() * 2 - 1) * 46;
    if (inRegion(x, z) || inRegion(x + 1.5, z) || inRegion(x - 1.5, z) || inRegion(x, z + 1.5) || inRegion(x, z - 1.5)) continue;
    trees.push([x, z, 1 + rand() * 0.5]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.9, 5);
  trunkGeo.translate(0, 0.45, 0);
  const crownGeo = new THREE.ConeGeometry(1.25, 3, 6);
  crownGeo.translate(0, 2.3, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3d26 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
  const greens = [0x2f6b3a, 0x3a7d3f, 0x27593a, 0x356a34].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  trees.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    s.set(k, k * (0.85 + rand() * 0.4), k);
    p.set(x, 0, z);
    m4.compose(p, q, s);
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, greens[Math.floor(rand() * greens.length)]);
  });
  crowns.castShadow = quality === 'high';
  scene.add(trunks, crowns);

  // Кусты: густая трава
  const blades = [];
  for (const b of BRUSHES) {
    const n = Math.round(((b[2] - b[0]) * (b[3] - b[1])) / 0.55);
    for (let i = 0; i < n; i++) blades.push([b[0] + rand() * (b[2] - b[0]), b[1] + rand() * (b[3] - b[1])]);
  }
  const bladeGeo = new THREE.ConeGeometry(0.28, 1.5, 4);
  bladeGeo.translate(0, 0.75, 0);
  const grass = new THREE.InstancedMesh(bladeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), blades.length);
  const grassCols = [0x4f8a3a, 0x5c9a3f, 0x3f7a33].map((c) => new THREE.Color(c));
  blades.forEach(([x, z], i) => {
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5, rand() * 3, (rand() - 0.5) * 0.5));
    const k = 0.8 + rand() * 0.5;
    s.set(k, k, k);
    p.set(x, 0, z);
    m4.compose(p, q, s);
    grass.setMatrixAt(i, m4);
    grass.setColorAt(i, grassCols[Math.floor(rand() * 3)]);
  });
  scene.add(grass);

  return { sun };
}
