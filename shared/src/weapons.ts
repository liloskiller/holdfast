import { TAU, hash32, rand01, lookDir, type Vec3 } from './math';
import { DRONE, PLAYER, WEAPONS, WeaponId, type WeaponDef } from './constants';
import { eyeHeight, type PlayerState } from './types';

export function weaponDef(id: number): WeaponDef {
  return (WEAPONS[id] ?? WEAPONS[0]) as WeaponDef;
}

export function activeWeaponId(s: PlayerState): number {
  return s.slot === 0 ? s.w0 : s.w1;
}

export function activeWeapon(s: PlayerState): WeaponDef {
  return weaponDef(activeWeaponId(s));
}

export function fireInterval(def: WeaponDef): number {
  return 60 / def.rpm;
}

/** Fill ammo for a fresh round. */
export function resetLoadout(s: PlayerState, primary: number, sidearm: number = WeaponId.SIDEARM): void {
  const p = weaponDef(primary);
  const q = weaponDef(sidearm);
  s.w0 = p.id;
  s.w1 = q.id;
  s.ammo0 = p.mag;
  s.res0 = p.mag * p.reserveMags;
  s.ammo1 = q.mag;
  s.res1 = q.mag * q.reserveMags;
  s.slot = 0;
  s.reloading = false;
  s.reload = 0;
  s.cooldown = 0;
}

/** Spread cone half angle in degrees for the current state. */
export function spreadDeg(def: WeaponDef, s: PlayerState): number {
  let sp = s.ads ? def.spreadAds : def.spreadHip;
  if (s.crouch) sp *= 0.8;
  const speed2 = s.vx * s.vx + s.vz * s.vz;
  if (speed2 > 0.25) sp *= 1.35;
  if (!s.onGround) sp *= 2;
  return sp;
}

export function eyeOf(s: PlayerState, out: Vec3): Vec3 {
  out.x = s.x;
  out.y = s.y + eyeHeight(s);
  out.z = s.z;
  return out;
}

const fwd: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Compute pellet directions for a shot. `out` receives pellets * 3 floats (unit vectors).
 * Deterministic: seed = playerId * 7919 + shotIdx. Client and server agree.
 */
export function buildShotRays(s: PlayerState, playerId: number, shotIdx: number, def: WeaponDef, out: Float64Array): void {
  lookDir(s.yaw, s.pitch, fwd);
  const sy = Math.sin(s.yaw);
  const cy = Math.cos(s.yaw);
  const sp = Math.sin(s.pitch);
  const cp = Math.cos(s.pitch);
  // right and up vectors of the camera frame
  const rx = cy, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  const spread = (spreadDeg(def, s) * Math.PI) / 180;
  const tanS = Math.tan(spread);
  const seed = hash32(playerId * 7919 + shotIdx, 0x51ed);
  for (let p = 0; p < def.pellets; p++) {
    const ang = TAU * rand01(seed, p * 2);
    const rad = tanS * Math.sqrt(rand01(seed, p * 2 + 1));
    const ox = Math.cos(ang) * rad;
    const oy = Math.sin(ang) * rad;
    let dx = fwd.x + rx * ox + ux * oy;
    let dy = fwd.y + uy * oy;
    let dz = fwd.z + rz * ox + uz * oy;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= len; dy /= len; dz /= len;
    out[p * 3] = dx;
    out[p * 3 + 1] = dy;
    out[p * 3 + 2] = dz;
  }
}

/** Damage for one pellet after range falloff and headshot multiplier. */
export function damageFor(def: WeaponDef, dist: number, head: boolean, wallMul = 1): number {
  let mul = 1;
  if (dist > def.falloffStart) {
    const t = Math.min(1, (dist - def.falloffStart) / Math.max(1, def.falloffEnd - def.falloffStart));
    mul = 1 - t * (1 - def.minDamageMul);
  }
  return def.damage * mul * (head ? def.headMul : 1) * wallMul;
}

export const MAX_PELLETS = 12;

export function dronePos(s: PlayerState, out: Vec3): Vec3 {
  out.x = s.dx;
  out.y = s.dy;
  out.z = s.dz;
  return out;
}

export function droneRadius(): number {
  return DRONE.hitRadius;
}

/** Where the drone camera sits (the nose of the chassis, a little above the centre). */
export function droneEye(s: PlayerState, out: Vec3): Vec3 {
  out.x = s.dx;
  out.y = s.dy + DRONE.camUp;
  out.z = s.dz;
  return out;
}

export function playerEyeY(s: PlayerState): number {
  return s.y + (s.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand);
}
