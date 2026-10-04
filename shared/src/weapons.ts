import { TAU, clamp, hash32, rand01, lookDir, type Vec3 } from './math';
import { DRONE, PLAYER, RECOIL_MAX, WEAPONS, WeaponId, type WeaponDef } from './constants';
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

/** Seconds between two shots (burst weapons: between two bursts is def.burstGap on top of the burst itself). */
export function fireInterval(def: WeaponDef): number {
  return 60 / def.rpm;
}

/** Seconds between shots inside a burst. */
export function burstInterval(def: WeaponDef): number {
  return 60 / def.burstRpm;
}

/** Largest number of rounds the gun can hold right now (one extra when a round is chambered). */
export function ammoCap(def: WeaponDef, chambered: boolean): number {
  return def.mag + (def.chamber && chambered ? 1 : 0);
}

/** Fill ammo for a fresh round. */
export function resetLoadout(s: PlayerState, primary: number, sidearm: number = WeaponId.SIDEARM): void {
  const p = weaponDef(primary);
  const q = weaponDef(sidearm);
  s.w0 = p.id;
  s.w1 = q.id;
  s.ammo0 = ammoCap(p, true);
  s.res0 = p.mag * p.reserveMags;
  s.ammo1 = ammoCap(q, true);
  s.res1 = q.mag * q.reserveMags;
  s.slot = 0;
  s.reloading = false;
  s.reload = 0;
  s.reloadMax = 0;
  s.reloadTac = false;
  s.cooldown = 0;
  s.adsAmt = 0;
  s.rcP = 0;
  s.rcY = 0;
  s.bloom = 0;
  s.sinceShot = 9;
  s.spray = 0;
  s.burstLeft = 0;
  s.fireBuf = 0;
  s.lean = 0;
}

/** Spread cone half angle in degrees for the current state (before the shot that is being fired). */
export function spreadDeg(def: WeaponDef, s: PlayerState): number {
  let sp = def.spreadHip + (def.spreadAds - def.spreadHip) * s.adsAmt;
  if (s.crouch) sp *= 0.8;
  const speed2 = s.vx * s.vx + s.vz * s.vz;
  if (speed2 > 0.25) sp *= 1.35;
  if (!s.onGround) sp *= 2;
  sp += s.bloom * (1 - 0.5 * s.adsAmt);
  return sp;
}

/**
 * Add the recoil of one shot. The kick is real: it moves the aim of the following shots and the view,
 * so the player has to pull down to hold a target. A weapon specific wobble keeps the sideways part
 * learnable but not perfectly predictable. Called by the shared step, so client and server agree.
 */
export function applyKick(s: PlayerState, def: WeaponDef): void {
  const i = s.spray;
  const ramp = Math.min(1, 0.6 + 0.4 * (i / Math.max(1, def.kickRamp)));
  let m = ramp;
  if (s.crouch) m *= 0.85;
  m *= 1 - 0.3 * s.adsAmt;
  if (s.vx * s.vx + s.vz * s.vz > 1) m *= 1.15;
  if (!s.onGround) m *= 1.5;
  const noise = rand01(hash32(s.shotIdx, 0x7a1b + def.id), 0) * 2 - 1;
  const drift = Math.sin(i * 0.9 + def.id);
  s.rcP = Math.min(RECOIL_MAX, s.rcP + def.kickPitch * m);
  s.rcY = clamp(s.rcY + def.kickYaw * m * (0.55 * drift + 0.75 * noise), -RECOIL_MAX, RECOIL_MAX);
  s.bloom = Math.min(def.bloomMax, s.bloom + def.bloomShot);
  s.spray = i + 1;
  s.sinceShot = 0;
}

/** Let the kick and the bloom settle while the trigger is not pulled. */
export function settleRecoil(s: PlayerState, def: WeaponDef, dt: number): void {
  s.sinceShot = Math.min(9, s.sinceShot + dt);
  if (s.sinceShot > def.recoverDelay) {
    const k = Math.exp(-def.recoverRate * dt);
    s.rcP *= k;
    s.rcY *= k;
    if (Math.abs(s.rcP) < 1e-5) s.rcP = 0;
    if (Math.abs(s.rcY) < 1e-5) s.rcY = 0;
  }
  // bloom holds while the trigger keeps the gun cycling and drains once the player lets off
  if (s.sinceShot > 60 / def.rpm * 1.25 + 0.02 && s.bloom > 0) s.bloom = Math.max(0, s.bloom - def.bloomDecay * dt);
  if (s.sinceShot > 0.3 + 60 / def.rpm) s.spray = 0;
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
 * `yaw` and `pitch` are the aim including recoil, `spread` the cone half angle in degrees.
 */
export function buildShotRays(yaw: number, pitch: number, spread: number, playerId: number, shotIdx: number, def: WeaponDef, out: Float64Array): void {
  lookDir(yaw, pitch, fwd);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  // right and up vectors of the camera frame
  const rx = cy, rz = -sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;
  const tanS = Math.tan((spread * Math.PI) / 180);
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

/** Shot rays from the player's current state (aim plus recoil, current spread). */
export function buildShotRaysFromState(s: PlayerState, playerId: number, shotIdx: number, def: WeaponDef, out: Float64Array): void {
  buildShotRays(s.yaw + s.rcY, s.pitch + s.rcP, spreadDeg(def, s), playerId, shotIdx, def, out);
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
