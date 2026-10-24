// Где можно ходить и как обходить стены: сетка 1×1 м и поиск пути A*.
import { MAP, WALLS, BRUSHES } from './config.js';

export function inRegion(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= MAP.jungleHalfX && az <= MAP.jungleHalfZ) return true;
  if (ax <= MAP.baseX && az <= MAP.laneHalfWidth) return true;
  return ax <= MAP.halfLength - 1 && Math.hypot(ax - MAP.baseX, z) <= MAP.baseRadius;
}

export function inWall(x, z, r = 0) {
  for (const w of WALLS) {
    if (x > w[0] - r && x < w[2] + r && z > w[1] - r && z < w[3] + r) return true;
  }
  return false;
}

export function isWalkable(x, z, r = 0) {
  return inRegion(x, z) && !inWall(x, z, r);
}

export function brushAt(x, z) {
  for (let i = 0; i < BRUSHES.length; i++) {
    const b = BRUSHES[i];
    if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) return i;
  }
  return -1;
}

function clampRegion(p) {
  if (inRegion(p.x, p.z)) return;
  const cands = [];
  cands.push({
    x: Math.max(-MAP.jungleHalfX, Math.min(MAP.jungleHalfX, p.x)),
    z: Math.max(-MAP.jungleHalfZ, Math.min(MAP.jungleHalfZ, p.z)),
  });
  cands.push({
    x: Math.max(-MAP.baseX, Math.min(MAP.baseX, p.x)),
    z: Math.max(-MAP.laneHalfWidth, Math.min(MAP.laneHalfWidth, p.z)),
  });
  const bx = p.x < 0 ? -MAP.baseX : MAP.baseX;
  const dx = p.x - bx, dz = p.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = Math.min(1, (MAP.baseRadius - 0.01) / d);
  const maxX = MAP.halfLength - 1;
  cands.push({ x: Math.max(-maxX, Math.min(maxX, bx + dx * k)), z: dz * k });
  let best = cands[0], bd = Infinity;
  for (const c of cands) {
    const dd = Math.hypot(c.x - p.x, c.z - p.z);
    if (dd < bd && inRegion(c.x, c.z)) { bd = dd; best = c; }
  }
  p.x = best.x; p.z = best.z;
}

// Выталкивает точку из стен и возвращает в границы карты
export function resolveTerrain(p, r) {
  for (const w of WALLS) {
    const x1 = w[0] - r, z1 = w[1] - r, x2 = w[2] + r, z2 = w[3] + r;
    if (p.x > x1 && p.x < x2 && p.z > z1 && p.z < z2) {
      const dl = p.x - x1, dr = x2 - p.x, dt = p.z - z1, db = z2 - p.z;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) p.x = x1; else if (m === dr) p.x = x2; else if (m === dt) p.z = z1; else p.z = z2;
    }
  }
  clampRegion(p);
}

// --- Сетка и A* -----------------------------------------------------------------
const X0 = -72, Z0 = -28, W = 144, H = 56;
const walk = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) walk[j * W + i] = isWalkable(X0 + i + 0.5, Z0 + j + 0.5, 0.7) ? 1 : 0;
}

const cellOf = (x, z) => [Math.floor(x - X0), Math.floor(z - Z0)];
const okCell = (i, j) => i >= 0 && j >= 0 && i < W && j < H && walk[j * W + i] === 1;

export function lineClear(a, b, r = 0.6) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.ceil(d / 0.5);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (!isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
  }
  return true;
}

function nearestOpen(i, j) {
  if (okCell(i, j)) return [i, j];
  for (let r = 1; r < 8; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) === r && okCell(i + di, j + dj)) return [i + di, j + dj];
    }
  }
  return null;
}

const gScore = new Float32Array(W * H);
const came = new Int32Array(W * H);
const stamp = new Uint32Array(W * H);
const closed = new Uint32Array(W * H);
let run = 0;

// Возвращает список точек от from до to (без стартовой точки)
export function findPath(from, to) {
  if (lineClear(from, to)) return [{ x: to.x, z: to.z }];
  const s = nearestOpen(...cellOf(from.x, from.z));
  const g = nearestOpen(...cellOf(to.x, to.z));
  if (!s || !g) return [{ x: to.x, z: to.z }];
  run++;
  const start = s[1] * W + s[0], goal = g[1] * W + g[0];
  const heap = [];
  const push = (node, f) => {
    heap.push([f, node]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  const h = (n) => Math.hypot((n % W) - g[0], Math.floor(n / W) - g[1]);
  stamp[start] = run; gScore[start] = 0; came[start] = -1;
  push(start, h(start));
  let found = false, iter = 0;
  while (heap.length && iter++ < 20000) {
    const cur = pop();
    if (closed[cur] === run) continue;
    closed[cur] = run;
    if (cur === goal) { found = true; break; }
    const ci = cur % W, cj = Math.floor(cur / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!okCell(ni, nj)) continue;
      if (di && dj && (!okCell(ci + di, cj) || !okCell(ci, cj + dj))) continue; // не срезать углы
      const n = nj * W + ni;
      if (closed[n] === run) continue;
      const cost = gScore[cur] + (di && dj ? 1.414 : 1);
      if (stamp[n] !== run || cost < gScore[n]) {
        stamp[n] = run; gScore[n] = cost; came[n] = cur;
        push(n, cost + h(n));
      }
    }
  }
  if (!found) return [{ x: to.x, z: to.z }];
  const cells = [];
  for (let n = goal; n !== -1; n = came[n]) cells.push({ x: X0 + (n % W) + 0.5, z: Z0 + Math.floor(n / W) + 0.5 });
  cells.reverse();
  cells[cells.length - 1] = { x: to.x, z: to.z };
  // спрямление: пропускаем точки, до которых видно напрямую
  const out = [];
  let anchor = from;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = Math.min(cells.length - 1, k + 30); m > k; m--) {
      if (lineClear(anchor, cells[m])) { far = m; break; }
    }
    out.push(cells[far]);
    anchor = cells[far];
    k = far + 1;
  }
  return out;
}
