// Spawn placement helpers: spread people out and turn them toward open space.
// Pure functions of their inputs, so they are safe on both sides of the wire.

import { lookDir, type Vec3 } from './math';
import { makeRayHit, type World } from './world';

export interface Spot {
  x: number;
  y: number;
  z: number;
}

/** Distance between two spots where another floor counts as far away (the stairs are a long walk). */
export function spotDistance(a: Spot, b: Spot): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const dy = (a.y - b.y) * 2.5;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Choose `count` spots out of `candidates` that are as far from each other (and from `taken`) as
 * possible. Greedy farthest point: with nothing taken the first pick is `candidates[start]`.
 * Returns indexes into `candidates`; when there are fewer candidates than `count` it wraps around, which
 * only happens on tiny test maps.
 */
export function spreadPick(candidates: readonly Spot[], count: number, taken: readonly Spot[] = [], start = 0): number[] {
  const out: number[] = [];
  if (candidates.length === 0) return out;
  const chosen: Spot[] = [...taken];
  const used = new Set<number>();
  for (let n = 0; n < count; n++) {
    if (used.size >= candidates.length) used.clear();
    let best = -1;
    let bestScore = -1;
    for (let k = 0; k < candidates.length; k++) {
      const i = (k + start) % candidates.length;
      if (used.has(i)) continue;
      const c = candidates[i] as Spot;
      let score = Infinity;
      for (const t of chosen) score = Math.min(score, spotDistance(c, t));
      if (chosen.length === 0) score = 0;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = i;
      }
    }
    used.add(best);
    out.push(best);
    chosen.push(candidates[best] as Spot);
  }
  return out;
}

const dir: Vec3 = { x: 0, y: 0, z: 0 };
const hit = makeRayHit();

/**
 * The yaw that looks into the most open space from a spot, so nobody starts the round staring at a wall.
 * Free distance is capped at `cap` so a long outdoor view does not beat a room that is simply big, and a
 * small bias toward `preferYaw` breaks ties and decides between equally open directions.
 */
export function openFacing(world: World, spot: Spot, preferYaw: number, cap = 9, steps = 24): number {
  let bestYaw = preferYaw;
  let bestScore = -Infinity;
  const eye = spot.y + 1.5;
  for (let i = 0; i < steps; i++) {
    const yaw = (i / steps) * Math.PI * 2;
    // a fan of three rays so a thin gap between furniture does not count as open
    let free = 0;
    for (const off of [-0.25, 0, 0.25]) {
      lookDir(yaw + off, 0, dir);
      const got = world.raycast(spot.x, eye, spot.z, dir.x, dir.y, dir.z, cap, hit, { seeThroughGlass: true });
      free += got ? hit.t : cap;
    }
    free /= 3;
    const d = Math.abs(((yaw - preferYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const score = free - d * 0.4;
    if (score > bestScore) {
      bestScore = score;
      bestYaw = yaw;
    }
  }
  return bestYaw;
}
