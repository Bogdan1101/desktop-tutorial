// Low-poly модели, собранные из простых фигур. Позже их можно заменить на готовые модели.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/SkeletonUtils.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { TEAM_COLOR, TEAM_GLOW, SKINS } from './config.js';

// Владение ресурсами GPU. Объект, убранный со сцены, ещё держит буферы и текстуры на видеокарте:
// их освобождает disposeObject. Общие ресурсы (кэш материалов, геометрия robot.glb, общие
// заготовки эффектов) помечены как shared: ими пользуются другие модели и следующие матчи.
export function markShared(res) {
  res.userData.shared = true;
  return res;
}

// Освобождает то, чем владеет дерево объектов: свои геометрии и материалы (каждый один раз),
// буферы экземпляров InstancedMesh и карты теней источников света. Текстуры материалов
// не трогает: ими владеет тот, кто их создал (например, туман). Скелеты и анимации моделей
// героев освобождает model.dispose().
export function disposeObject(root) {
  const geos = new Set(), mats = new Set();
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) geos.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!m.userData.shared) mats.add(m);
    if (o.isInstancedMesh || o.isLight) o.dispose();
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = opts.glow
      ? new THREE.MeshBasicMaterial({ color, transparent: !!opts.opacity, opacity: opts.opacity ?? 1 })
      : new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: opts.emissive ?? 0x000000 });
    matCache.set(key, markShared(m));
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
const WOOD = 0x8a5a32;
const LIGHT_WOOD = 0xb07a3c;
const HAT_BAND = 0xd98a2b;
const HAIR = 0xe0a63a;
const LEATHER = 0x6b4426;
const ARCHER_CAP = 0x667a34;

// Одна сетка из нескольких фигур одного материала: меньше вызовов отрисовки.
// parts — [геометрия, x, y, z, rx, ry, rz]; исходные геометрии освобождаются.
function merged(parts) {
  const geos = parts.map(([geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0]) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    const flat = geo.index ? geo.toNonIndexed() : geo;
    if (flat !== geo) geo.dispose();
    return flat;
  });
  const out = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  return out;
}

function pyroModel(team, c) {
  const g = new THREE.Group();
  const robe = mesh(new THREE.CylinderGeometry(0.32, 0.62, 1.15, 7), mat(c), 0, 0.58, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.44, 0.36, 0.62, 7), mat(darker(c)), 0, 1.45, 0);
  const head = mesh(new THREE.IcosahedronGeometry(0.31, 0), mat(SKIN), 0, 2.02, 0);
  // шляпа с полями и посох выше головы — как у модели-робота
  const hood = mesh(merged([
    [new THREE.CylinderGeometry(0.7, 0.7, 0.06, 12), 0, 2.3, 0],
    [new THREE.ConeGeometry(0.4, 0.85, 7), 0, 2.72, -0.03, -0.12],
    [new THREE.ConeGeometry(0.17, 0.42, 5), 0, 3.15, -0.17, -0.95],
  ]), mat(darker(c, 0.45)));
  const band = mesh(new THREE.CylinderGeometry(0.41, 0.43, 0.1, 9), mat(HAT_BAND), 0, 2.38, 0);
  const shL = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(GOLD), -0.44, 1.7, 0);
  const shR = mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(GOLD), 0.44, 1.7, 0);
  const weapon = new THREE.Group();
  // навершие ниже полоски здоровья, чтобы огонь не прятался за ней
  weapon.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 5), mat(WOOD), 0, -0.07, 0));
  const orb = mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(0xffa63d, { glow: true }), 0, 1.12, 0, false);
  weapon.add(orb);
  weapon.position.set(0.82, 1.3, 0.15); // за краем полей шляпы
  g.add(robe, torso, head, hood, band, shL, shR, weapon);
  return { group: g, orb, weapon };
}

function grokModel(team, c) {
  const g = new THREE.Group();
  const legs = mesh(new THREE.BoxGeometry(0.9, 0.8, 0.6), mat(STONE_DARK), 0, 0.4, 0);
  const body = mesh(new THREE.BoxGeometry(1.25, 1.0, 0.85), mat(c), 0, 1.3, 0);
  const belt = mesh(new THREE.BoxGeometry(1.3, 0.18, 0.9), mat(GOLD), 0, 0.85, 0);
  const head = mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(SKIN), 0, 2.05, 0.05);
  const helm = mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.35, 6), mat(STONE), 0, 2.32, 0.02);
  const hornL = mesh(new THREE.ConeGeometry(0.09, 0.4, 4), mat(0xeee6cf), -0.36, 2.45, 0);
  hornL.rotation.z = 0.8;
  const hornR = hornL.clone(); hornR.position.x = 0.36; hornR.rotation.z = -0.8;
  const padL = mesh(new THREE.BoxGeometry(0.62, 0.36, 0.72), mat(STONE), -0.85, 1.8, 0);
  const padR = padL.clone(); padR.position.x = 0.85;
  const weapon = new THREE.Group();
  const shield = mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.14, 8), mat(darker(c, 0.7)), 0, 0, 0);
  shield.rotation.z = Math.PI / 2;
  const rim = mesh(merged([
    [new THREE.TorusGeometry(0.8, 0.07, 4, 8), 0, 0, 0, 0, Math.PI / 2, 0], // кайма по краю, лицо щита не закрывает
    [new THREE.IcosahedronGeometry(0.22, 0), 0.12, 0, 0],
  ]), mat(GOLD));
  weapon.add(shield, rim);
  weapon.position.set(-0.85, 1.25, 0.35);
  weapon.rotation.y = -0.3;
  const orb = mesh(new THREE.OctahedronGeometry(0.15), mat(TEAM_GLOW[team], { glow: true }), 0, 1.4, 0.45, false);
  g.add(legs, body, belt, head, helm, hornL, hornR, padL, padR, weapon, orb);
  g.scale.setScalar(1.08);
  return { group: g, orb, weapon };
}

function liraModel(team, c) {
  const g = new THREE.Group();
  const legs = mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 6), mat(0x3b3226), 0, 0.45, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.75, 6), mat(c), 0, 1.25, 0);
  const cape = mesh(new THREE.ConeGeometry(0.5, 1.2, 6, 1, true), mat(darker(c, 0.7)), 0, 1.2, -0.12);
  const head = mesh(new THREE.IcosahedronGeometry(0.28, 0), mat(SKIN), 0, 1.86, 0);
  const hair = mesh(new THREE.ConeGeometry(0.16, 0.7, 5), mat(0xc8902e), 0, 1.7, -0.32);
  hair.rotation.x = 0.5;
  const weapon = new THREE.Group();
  const bow = mesh(new THREE.TorusGeometry(0.9, 0.06, 4, 12, Math.PI), mat(LIGHT_WOOD), 0, 0, 0);
  bow.rotation.z = -Math.PI / 2;
  const string = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.8, 3), mat(0xf2efe6), 0, 0, 0, false);
  weapon.add(bow, string);
  weapon.position.set(0.5, 1.3, 0.3);
  const orb = mesh(new THREE.OctahedronGeometry(0.12), mat(0xfff1a8, { glow: true }), 0.6, 1.3, 0.3, false);
  // шапка лучника и колчан за спиной
  const cap = mesh(new THREE.ConeGeometry(0.32, 0.95, 6), mat(ARCHER_CAP), 0, 2.08, -0.2);
  cap.rotation.x = -Math.PI / 2 + 0.25;
  const quiver = mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.75, 6), mat(LEATHER), -0.12, 1.4, -0.38);
  quiver.rotation.set(0.2, 0, 0.45);
  g.add(legs, torso, cape, head, hair, cap, quiver, weapon, orb);
  return { group: g, orb, weapon };
}

export function skinColors(team, heroId, skinId) {
  const skin = (SKINS[heroId] ?? []).find((x) => x.id === skinId);
  return { main: skin?.main ?? TEAM_COLOR[team], trim: skin?.trim ?? darker(TEAM_COLOR[team], 0.55) };
}

// --- Анимированный робот (CC0, Quaternius) -------------------------------------
let robot = null;

export async function loadRobot(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  // геометрию робота делят все копии героев (clone не копирует буферы): её не освобождаем
  gltf.scene.traverse((o) => { if (o.geometry) markShared(o.geometry); });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  robot = { scene: gltf.scene, clips: gltf.animations, height: box.max.y - box.min.y };
  return robot;
}

export function robotReady() { return !!robot; }

const HERO_SIZE = { pyro: 2.7, grok: 3, lira: 2.6 };
// Ширина силуэта: танк шире, лучница тоньше. Только вид; размеры для боя задаёт config.
const HERO_BUILD = { grok: [1.15, 1.12], lira: [0.9, 0.9] };

// Прикрепляет деталь к кости так, чтобы в позе привязки она стояла в точке (x, y, z) модели
// с поворотом (rx, ry, rz). Модель в этот момент без сдвига и поворота: её координаты — мировые.
function pin(bone, obj, x, y, z, rx = 0, ry = 0, rz = 0) {
  const want = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  obj.matrix.copy(bone.matrixWorld).invert().multiply(want);
  obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
}

function robotHero(team, heroId, colors) {
  const g = new THREE.Group();
  const root = cloneSkinned(robot.scene);
  const k = (HERO_SIZE[heroId] ?? 2.3) / robot.height;
  const [wx, wz] = HERO_BUILD[heroId] ?? [1, 1];
  root.scale.set(k * wx, k, k * wz);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const name = o.material.name;
    o.material = o.material.clone();
    if (name === 'Main') o.material.color.set(colors.main);
    if (name === 'Grey') o.material.color.set(colors.trim).lerp(new THREE.Color(0x9aa0aa), 0.5);
  });
  g.add(root);
  g.updateMatrixWorld(true);
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const at = (b) => b.getWorldPosition(new THREE.Vector3());
  const head = bones.Head, torso = bones.Torso_1 ?? bones.Body, hips = bones.Hips ?? bones.Body;
  const handR = bones.Palm2R ?? bones.LowerArmR, handL = bones.Palm2L ?? bones.LowerArmL;
  const s = (HERO_SIZE[heroId] ?? 2.7) / 2.7; // детали заданы для роста 2,7 м
  const hy = at(head).y;
  // Оружие в руке: от кости берём только положение, поворот — от корпуса. Так оно не
  // выкручивается вместе с кистью и не уходит в землю, а при ударе выносится вперёд вместе с рукой.
  const held = [];
  const hold = (bone, obj, place) => { g.add(obj); held.push({ bone, obj, place }); };
  const unit = new THREE.Group(); // детали, не привязанные к костям
  let orb;
  if (heroId === 'pyro') {
    // посох выше головы, тёплый огонь в навершии
    const staff = new THREE.Group();
    // навершие выше полей шляпы, чтобы огонь был виден сверху
    staff.add(mesh(new THREE.CylinderGeometry(0.065 * s, 0.08 * s, 3.1 * s, 6), mat(WOOD), 0, 1.2 * s, 0));
    staff.add(mesh(new THREE.TorusGeometry(0.22 * s, 0.05 * s, 4, 10), mat(GOLD), 0, 2.85 * s, 0));
    orb = mesh(new THREE.IcosahedronGeometry(0.22 * s, 0), mat(0xffa63d, { glow: true }), 0, 2.85 * s, 0, false);
    staff.add(orb);
    hold(handR, staff, (o, p) => {
      o.position.set(p.x - 0.12 * s, Math.max(p.y, 0.36 * s), p.z);
      // верх отклонён наружу, чтобы посох не проходил сквозь поля шляпы
      o.rotation.set(THREE.MathUtils.clamp(p.z * 0.4, -0.25, 0.5), 0, 0.2);
    });
    // остроконечная шляпа с широкими полями — главный знак мага при виде сверху
    const dark = darker(colors.trim, 0.75);
    const top = hy + 0.9 * s;
    pin(head, mesh(merged([
      [new THREE.CylinderGeometry(0.85 * s, 0.85 * s, 0.07 * s, 14), 0, top, 0],
      [new THREE.ConeGeometry(0.58 * s, 1.15 * s, 8), 0, top + 0.57 * s, -0.04 * s, -0.12],
      [new THREE.ConeGeometry(0.25 * s, 0.62 * s, 6), 0, top + 1.16 * s, -0.25 * s, -0.95],
    ]), mat(dark)), 0, 0, 0);
    pin(head, mesh(new THREE.CylinderGeometry(0.59 * s, 0.63 * s, 0.14 * s, 10), mat(HAT_BAND)), 0, top + 0.11 * s, -0.01 * s);
    // мантия от пояса: силуэт расширяется книзу
    pin(hips, mesh(new THREE.CylinderGeometry(0.38 * s, 0.68 * s, 0.68 * s, 9), mat(dark)), 0, at(hips).y - 0.33 * s, -0.02 * s);
  } else if (heroId === 'grok') {
    // большой прямоугольный щит на левой руке, золотая окантовка и умбон
    const shield = new THREE.Group();
    shield.add(mesh(new THREE.BoxGeometry(1.1 * s, 1.4 * s, 0.1 * s), mat(darker(colors.trim, 0.85)), 0, 0, 0));
    shield.add(mesh(merged([
      [new THREE.BoxGeometry(1.26 * s, 1.56 * s, 0.06 * s), 0, 0, -0.03 * s],
      [new THREE.IcosahedronGeometry(0.2 * s, 0), 0, 0.05 * s, 0.09 * s],
    ]), mat(GOLD)));
    const fore = bones.LowerArmL ?? handL;
    const f = new THREE.Vector3();
    hold(handL, shield, (o, p) => {
      g.worldToLocal(fore.getWorldPosition(f));
      p.lerp(f, 0.4); // между кистью и предплечьем
      o.position.set(Math.max(p.x + 0.3 * s, 0.8 * s), Math.max(p.y, 0.92 * s), p.z + 0.3 * s);
      o.rotation.set(-0.45, 0.5, 0); // лицевая сторона чуть вверх — видна с камеры
    });
    // широкие каменные наплечники выступают по бокам головы
    const shL = at(bones.ShoulderL), shR = at(bones.ShoulderR);
    const dome = (sh, side) => [new THREE.SphereGeometry(0.5 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), sh.x + side * 0.28 * s, sh.y + 0.1 * s, sh.z, 0, 0, -side * 0.4];
    pin(torso, mesh(merged([dome(shL, 1), dome(shR, -1)]), mat(STONE)), 0, 0, 0);
    // каменный шлем с гребнем и крупные рога
    const top = hy + 0.78 * s;
    const cap = new THREE.SphereGeometry(0.62 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.55, 1);
    pin(head, mesh(merged([
      [cap, 0, top, 0],
      [new THREE.BoxGeometry(0.2 * s, 0.3 * s, 1.15 * s), 0, top + 0.3 * s, 0],
    ]), mat(STONE)), 0, 0, 0);
    pin(head, mesh(merged([
      [new THREE.ConeGeometry(0.18 * s, 1.0 * s, 5), 0.68 * s, top + 0.3 * s, 0.05 * s, 0, 0, -0.6],
      [new THREE.ConeGeometry(0.18 * s, 1.0 * s, 5), -0.68 * s, top + 0.3 * s, 0.05 * s, 0, 0, 0.6],
    ]), mat(0xeee6cf)), 0, 0, 0);
    orb = mesh(new THREE.OctahedronGeometry(0.15), mat(TEAM_GLOW[team], { glow: true }), 0, 1.5, 0.5, false);
    unit.add(orb);
  } else {
    // большой лук в левой руке, слегка наклонён, чтобы читался и сверху
    const R = 0.9 * s;
    const bow = new THREE.Group();
    const arc = mesh(new THREE.TorusGeometry(R, 0.06 * s, 4, 12, Math.PI), mat(LIGHT_WOOD), -R, 0, 0);
    arc.rotation.z = -Math.PI / 2;
    bow.add(arc, mesh(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 2 * R, 3), mat(0xf2efe6), -R, 0, 0, false));
    const bowWrap = new THREE.Group();
    bowWrap.add(bow);
    bow.rotation.y = -Math.PI / 2; // выгиб вперёд, тетива к лучнице
    hold(handL, bowWrap, (o, p) => {
      o.position.set(p.x + 0.3 * s, Math.max(p.y, 1.0 * s), p.z + 0.15 * s);
      o.rotation.set(-0.25, 0.35, -0.6); // наклон наружу и к камере: дуга видна сверху
    });
    // шапка лучника с пером, хвост волос и колчан за спиной: силуэт головы и спины
    const top = hy + 0.82 * s;
    // шапка своего, оливкового цвета: голову лучницы видно и у синих, и у красных
    pin(head, mesh(new THREE.ConeGeometry(0.52 * s, 1.4 * s, 6), mat(ARCHER_CAP)), 0, top, -0.35 * s, -Math.PI / 2 + 0.25, 0, 0);
    pin(head, mesh(new THREE.ConeGeometry(0.07 * s, 1.0 * s, 4), mat(0xf2efe6)), 0.3 * s, top + 0.3 * s, -0.55 * s, -0.9, 0, -0.35);
    pin(head, mesh(new THREE.ConeGeometry(0.2 * s, 1.1 * s, 6), mat(HAIR)), 0, hy + 0.1 * s, -0.7 * s, -Math.PI / 2 - 0.7, 0, 0);
    const ty = at(torso).y;
    pin(torso, mesh(new THREE.CylinderGeometry(0.14 * s, 0.12 * s, 0.85 * s, 6), mat(LEATHER)), -0.15 * s, ty + 0.2 * s, -0.45 * s, 0.2, 0, 0.45);
    pin(torso, mesh(merged([-0.07, 0, 0.07].map((d, i) =>
      [new THREE.ConeGeometry(0.07 * s, 0.24 * s, 3), -0.36 * s + d * s, ty + 0.66 * s + i * 0.03 * s, -0.54 * s + d * s, 0.2, 0, 0.45])), mat(0xf2efe6)), 0, 0, 0);
    orb = mesh(new THREE.OctahedronGeometry(0.12), mat(0xfff1a8, { glow: true }), 0, 1.4, 0.5, false);
    unit.add(orb);
  }
  // Скелеты копии (по одному на каждую SkinnedMesh) держат на GPU текстуру костей
  const skeletons = new Set();
  root.traverse((o) => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
  const tmp = new THREE.Vector3();
  const update = () => {
    for (const h of held) {
      h.bone.getWorldPosition(tmp);
      g.worldToLocal(tmp);
      h.place(h.obj, tmp);
    }
  };
  update();
  g.add(unit);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of robot.clips) actions[clip.name] = mixer.clipAction(clip);
  for (const n of ['Punch', 'Death']) {
    if (!actions[n]) continue;
    actions[n].setLoop(THREE.LoopOnce, 1);
    actions[n].clampWhenFinished = true;
  }
  let current = null;
  const play = (name, speed = 1) => {
    const a = actions[name];
    if (!a) return;
    if (name === 'Running') a.timeScale = 0.7 + speed * 0.5;
    if (name === 'Punch') a.timeScale = 2.2;
    if (current === name) return;
    const prev = actions[current];
    a.reset().fadeIn(0.12).play();
    if (prev) prev.fadeOut(0.12);
    current = name;
  };
  play('Idle');
  // Модель больше не нужна: анимации остановлены и забыты, текстуры костей освобождены.
  // Геометрию и материалы освобождает disposeObject вместе с остальной сценой.
  const dispose = () => {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const s of skeletons) s.dispose();
  };
  return { group: g, orb, weapon: unit, mixer, play, update, dispose, skeletal: true };
}

export function heroModel(team, heroId, skinId = 'base') {
  const colors = skinColors(team, heroId, skinId);
  if (robot) return robotHero(team, heroId, colors);
  if (heroId === 'grok') return grokModel(team, colors.main);
  if (heroId === 'lira') return liraModel(team, colors.main);
  return pyroModel(team, colors.main);
}

export function creepModel(team, type) {
  const g = new THREE.Group();
  const c = TEAM_COLOR[team];
  const ranged = type === 'ranged';
  if (type === 'super') {
    const body = mesh(new THREE.BoxGeometry(1.2, 1.3, 0.9), mat(darker(c, 0.7)), 0, 0.9, 0);
    const head = mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), mat(0xd9c27a), 0, 1.85, 0);
    const club = mesh(new THREE.BoxGeometry(0.25, 0.25, 1.4), mat(0x6b4a2f), 0.75, 1, 0.5);
    const orb = mesh(new THREE.OctahedronGeometry(0.2), mat(TEAM_GLOW[team], { glow: true }), 0, 2.4, 0, false);
    g.add(body, head, club, orb);
    return { group: g, orb };
  }
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

export function inhibModel(team) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.9, 2.2, 0.6, 8), mat(STONE_DARK), 0, 0.3, 0));
  const crystal = mesh(new THREE.IcosahedronGeometry(1.1, 0), mat(TEAM_GLOW[team], { glow: true, opacity: 0.85 }), 0, 1.9, 0, false);
  g.add(crystal);
  for (let i = 0; i < 4; i++) {
    const p = mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), mat(STONE), Math.cos(i * Math.PI / 2) * 1.6, 1.2, Math.sin(i * Math.PI / 2) * 1.6);
    g.add(p);
  }
  return { group: g, crystal };
}

export function dummyModel() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 5), mat(0x6b4a2f), 0, 1.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.9, 7), mat(0xd8b56a), 0, 1.35, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(0.3, 0), mat(0xe2c27e), 0, 2.1, 0));
  const arms = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 5), mat(0x6b4a2f), 0, 1.55, 0);
  arms.rotation.z = Math.PI / 2;
  g.add(arms);
  const target = mesh(new THREE.TorusGeometry(0.25, 0.05, 4, 12), mat(0xff4a3d), 0, 1.4, 0.38);
  g.add(target);
  return { group: g, orb: target };
}

export function plantModel() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.8, 5), mat(0x3f7a33), 0, 0.4, 0));
  for (let i = 0; i < 4; i++) {
    const leaf = mesh(new THREE.ConeGeometry(0.16, 0.6, 4), mat(0x5c9a3f), Math.cos(i * 1.6) * 0.25, 0.3, Math.sin(i * 1.6) * 0.25);
    leaf.rotation.z = Math.cos(i * 1.6) * 0.9;
    leaf.rotation.x = -Math.sin(i * 1.6) * 0.9;
    g.add(leaf);
  }
  const fruit = mesh(new THREE.IcosahedronGeometry(0.28, 0), mat(0xff7ab6, { glow: true }), 0, 0.95, 0, false);
  g.add(fruit);
  return { group: g, fruit };
}
