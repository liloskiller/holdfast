// Leaning (Q / E): the head and shoulders move sideways around a corner while the feet stay put.
// The offset is part of the simulation, so the server uses it for the line of sight, shot origin and hit boxes.

import { LEAN, PLAYER } from './constants';
import type { Vec3 } from './math';

/** Offset of the head from the body axis for a lean amount (-1 left .. 1 right) and facing. y is the drop. */
export function leanVec(yaw: number, lean: number, out: Vec3): Vec3 {
  if (lean === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  // camera right vector at this yaw is (cos, 0, -sin)
  const k = lean * LEAN.offset;
  out.x = Math.cos(yaw) * k;
  out.y = -Math.abs(lean) * LEAN.drop;
  out.z = -Math.sin(yaw) * k;
  return out;
}

/** How far a lean is allowed to go before the head would be inside geometry. */
export function leanReach(
  boxFree: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => boolean,
  x: number, y: number, z: number, yaw: number, crouch: boolean, dir: number,
): number {
  const eye = y + (crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand);
  const r = LEAN.headClear;
  const rx = Math.cos(yaw) * dir;
  const rz = -Math.sin(yaw) * dir;
  for (const f of [1, 0.7, 0.4]) {
    const hx = x + rx * LEAN.offset * f;
    const hz = z + rz * LEAN.offset * f;
    const mx = x + rx * LEAN.offset * f * 0.5;
    const mz = z + rz * LEAN.offset * f * 0.5;
    const hy = eye - LEAN.drop * f;
    if (boxFree(hx - r, hy - r, hz - r, hx + r, hy + r, hz + r) && boxFree(mx - r, hy - r, mz - r, mx + r, hy + r, mz + r)) return f;
  }
  return 0;
}
