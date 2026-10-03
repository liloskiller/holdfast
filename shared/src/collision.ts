// AABB helpers, ray tests and axis clipping. Allocation free in the hot paths.

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function makeAabb(minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0): Aabb {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

export function aabbContains(a: Aabb, x: number, y: number, z: number): boolean {
  return x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY && z >= a.minZ && z <= a.maxZ;
}

export const EPS = 1e-6;

/** Number of floats per box in a box buffer. */
export const BOX_STRIDE = 6;

/**
 * Clip a movement of the box (min/max) along one axis against a buffer of solid boxes.
 * axis: 0 = X, 1 = Y, 2 = Z. Returns the allowed signed delta, never larger in magnitude
 * than the requested one. Leaves `skin` of clearance to avoid sticking.
 */
export function clipAxis(
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
  axis: 0 | 1 | 2, delta: number, boxes: Float64Array, count: number, skin: number,
): number {
  if (delta === 0) return 0;
  let allowed = Math.abs(delta);
  const pos = delta > 0;
  for (let i = 0; i < count; i++) {
    const o = i * BOX_STRIDE;
    const bMinX = boxes[o] as number;
    const bMinY = boxes[o + 1] as number;
    const bMinZ = boxes[o + 2] as number;
    const bMaxX = boxes[o + 3] as number;
    const bMaxY = boxes[o + 4] as number;
    const bMaxZ = boxes[o + 5] as number;
    let gap: number;
    if (axis === 0) {
      if (maxY <= bMinY + EPS || minY >= bMaxY - EPS || maxZ <= bMinZ + EPS || minZ >= bMaxZ - EPS) continue;
      gap = pos ? bMinX - maxX : minX - bMaxX;
    } else if (axis === 1) {
      if (maxX <= bMinX + EPS || minX >= bMaxX - EPS || maxZ <= bMinZ + EPS || minZ >= bMaxZ - EPS) continue;
      gap = pos ? bMinY - maxY : minY - bMaxY;
    } else {
      if (maxX <= bMinX + EPS || minX >= bMaxX - EPS || maxY <= bMinY + EPS || minY >= bMaxY - EPS) continue;
      gap = pos ? bMinZ - maxZ : minZ - bMaxZ;
    }
    if (gap < -EPS) continue; // already past or overlapping this box on this axis
    const room = gap - skin;
    const r = room < 0 ? 0 : room;
    if (r < allowed) allowed = r;
  }
  return pos ? allowed : -allowed;
}

/** Does the box overlap any box in the buffer? */
export function overlapsAny(
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
  boxes: Float64Array, count: number,
): boolean {
  for (let i = 0; i < count; i++) {
    const o = i * BOX_STRIDE;
    if (
      minX < (boxes[o + 3] as number) - EPS && maxX > (boxes[o] as number) + EPS &&
      minY < (boxes[o + 4] as number) - EPS && maxY > (boxes[o + 1] as number) + EPS &&
      minZ < (boxes[o + 5] as number) - EPS && maxZ > (boxes[o + 2] as number) + EPS
    ) return true;
  }
  return false;
}

export interface RayNormal {
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Ray vs AABB (slab method). Returns entry distance t in [0, maxT] or -1.
 * Rays that start inside the box return -1 (the box is ignored).
 * Direction does not need to be normalized, t is in units of the direction length.
 */
export function rayAabb(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
  maxT: number, n?: RayNormal,
): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  if (Math.abs(dx) < 1e-12) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; nx = s; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = s; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv;
    let t2 = (maxZ - oz) * inv;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmin < 0 || tmin > maxT) return -1;
  if (n) { n.nx = nx; n.ny = ny; n.nz = nz; }
  return tmin;
}

/** Ray vs sphere. Direction must be normalized. Returns t or -1. */
export function raySphere(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number, maxT: number,
): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > maxT) return -1;
  return t;
}
