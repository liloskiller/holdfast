// Deterministic player step. Used by the server for truth and by the client for prediction.
// No Date, no Math.random, no DOM, no Three.js.

import { BOX_STRIDE, clipAxis } from './collision';
import { DRONE, PLAYER, SWITCH_TIME, TILE } from './constants';
import { clamp } from './math';
import { Btn, type InputCmd, type PlayerState } from './types';
import { fireInterval, weaponDef } from './weapons';
import type { VaultTarget, World } from './world';

export interface StepOut {
  fired: boolean;
  /** Index of the shot that was fired (seed input), valid when fired is true. */
  shotIdx: number;
  weapon: number;
  reloadStarted: boolean;
  switched: boolean;
  vaultStarted: boolean;
  tapUse: boolean;
  droneToggled: boolean;
  /** Raw DRONE press edge (the server decides whether to deploy a drone). */
  dronePressed: boolean;
  /** True for one step when the INTERACT button was released after a tap. */
  meleePressed: boolean;
  gadgetPressed: boolean;
  firePressed: boolean;
  cameraPressed: boolean;
  /** The drone hopped this step (for sound). */
  droneHop: boolean;
  /** Downward speed (m/s) when the drone landed this step, else 0. */
  droneLand: number;
}

export function makeStepOut(): StepOut {
  return {
    fired: false, shotIdx: 0, weapon: 0, reloadStarted: false, switched: false, vaultStarted: false,
    tapUse: false, droneToggled: false, dronePressed: false, meleePressed: false, gadgetPressed: false, firePressed: false,
    cameraPressed: false, droneHop: false, droneLand: 0,
  };
}

const buf = new Float64Array(512 * BOX_STRIDE);
const vaultTarget: VaultTarget = { x: 0, y: 0, z: 0 };
const SKIN = PLAYER.skin;

function height(s: PlayerState): number {
  return s.crouch ? PLAYER.heightCrouch : PLAYER.heightStand;
}

/** Move the player box along one horizontal axis, with step up. */
function moveHorizontal(s: PlayerState, world: World, axis: 0 | 2, delta: number, canStep: boolean): number {
  if (delta === 0) return 0;
  const r = PLAYER.radius;
  const h = height(s);
  let minX = s.x - r, maxX = s.x + r, minZ = s.z - r, maxZ = s.z + r;
  let minY = s.y, maxY = s.y + h;
  // sweep region including potential step-up
  const sweepMinX = axis === 0 ? (delta < 0 ? minX + delta : minX) : minX;
  const sweepMaxX = axis === 0 ? (delta > 0 ? maxX + delta : maxX) : maxX;
  const sweepMinZ = axis === 2 ? (delta < 0 ? minZ + delta : minZ) : minZ;
  const sweepMaxZ = axis === 2 ? (delta > 0 ? maxZ + delta : maxZ) : maxZ;
  const n = world.queryBoxes(sweepMinX, minY, sweepMinZ, sweepMaxX, maxY + PLAYER.stepUp, sweepMaxZ, buf);
  let allowed = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, axis, delta, buf, n, SKIN);

  if (canStep && Math.abs(allowed) < Math.abs(delta) - 1e-5) {
    const up = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, 1, PLAYER.stepUp, buf, n, SKIN);
    if (up > 0.01) {
      minY += up;
      maxY += up;
      const allowed2 = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, axis, delta, buf, n, SKIN);
      if (Math.abs(allowed2) > Math.abs(allowed) + 1e-4) {
        s.y += up;
        allowed = allowed2;
      }
    }
  }
  if (axis === 0) s.x += allowed;
  else s.z += allowed;
  return allowed;
}

function snapOrFall(s: PlayerState, world: World, wasGround: boolean, dt: number): void {
  const r = PLAYER.radius;
  const h = height(s);
  if (wasGround && s.vy <= 0.01) {
    const n = world.queryBoxes(s.x - r, s.y - PLAYER.stepDown, s.z - r, s.x + r, s.y + h, s.z + r, buf);
    const drop = clipAxis(s.x - r, s.y, s.z - r, s.x + r, s.y + h, s.z + r, 1, -PLAYER.stepDown, buf, n, SKIN);
    if (drop > -PLAYER.stepDown + 1e-6) {
      s.y += drop;
      s.vy = 0;
      s.onGround = true;
      return;
    }
    s.onGround = false;
  }
  // airborne
  s.vy -= PLAYER.gravity * dt;
  if (s.vy < -PLAYER.terminalVel) s.vy = -PLAYER.terminalVel;
  const dy = s.vy * dt;
  const n = world.queryBoxes(s.x - r, Math.min(s.y, s.y + dy), s.z - r, s.x + r, Math.max(s.y + h, s.y + h + dy), s.z + r, buf);
  const allowed = clipAxis(s.x - r, s.y, s.z - r, s.x + r, s.y + h, s.z + r, 1, dy, buf, n, SKIN);
  s.y += allowed;
  if (Math.abs(allowed - dy) > 1e-9) {
    if (dy < 0) s.onGround = true;
    s.vy = 0;
  } else {
    s.onGround = false;
  }
}

function confine(s: PlayerState, world: World): void {
  const b = world.map.building;
  const r = PLAYER.radius;
  const x0 = b.x0 * TILE - r;
  const x1 = b.x1 * TILE + r;
  const z0 = b.z0 * TILE - r;
  const z1 = b.z1 * TILE + r;
  if (s.x > x0 && s.x < x1 && s.z > z0 && s.z < z1) {
    const dl = s.x - x0;
    const dr = x1 - s.x;
    const dt = s.z - z0;
    const db = z1 - s.z;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) { s.x = x0; if (s.vx > 0) s.vx = 0; }
    else if (m === dr) { s.x = x1; if (s.vx < 0) s.vx = 0; }
    else if (m === dt) { s.z = z0; if (s.vz > 0) s.vz = 0; }
    else { s.z = z1; if (s.vz < 0) s.vz = 0; }
  }
}

/** Roll the drone chassis along one horizontal axis, over lips up to DRONE.stepUp when on the ground. */
function droneSlide(s: PlayerState, world: World, axis: 0 | 2, delta: number, canStep: boolean): number {
  if (delta === 0) return 0;
  const w = DRONE.halfW;
  const h = DRONE.halfH;
  const minX = s.dx - w, maxX = s.dx + w, minZ = s.dz - w, maxZ = s.dz + w;
  let minY = s.dy - h, maxY = s.dy + h;
  const sx0 = axis === 0 && delta < 0 ? minX + delta : minX;
  const sx1 = axis === 0 && delta > 0 ? maxX + delta : maxX;
  const sz0 = axis === 2 && delta < 0 ? minZ + delta : minZ;
  const sz1 = axis === 2 && delta > 0 ? maxZ + delta : maxZ;
  const n = world.queryBoxes(sx0, minY, sz0, sx1, maxY + DRONE.stepUp, sz1, buf);
  let allowed = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, axis, delta, buf, n, SKIN);
  if (canStep && Math.abs(allowed) < Math.abs(delta) - 1e-5) {
    const up = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, 1, DRONE.stepUp, buf, n, SKIN);
    if (up > 0.005) {
      minY += up;
      maxY += up;
      const allowed2 = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, axis, delta, buf, n, SKIN);
      if (Math.abs(allowed2) > Math.abs(allowed) + 1e-4) {
        s.dy += up;
        allowed = allowed2;
      }
    }
  }
  if (axis === 0) s.dx += allowed;
  else s.dz += allowed;
  return allowed;
}

/** True when the chassis is resting on something (or about to be, within a hair). */
function droneGrounded(s: PlayerState, world: World): boolean {
  const w = DRONE.halfW;
  const h = DRONE.halfH;
  const probe = 0.04;
  const n = world.queryBoxes(s.dx - w, s.dy - h - probe, s.dz - w, s.dx + w, s.dy + h, s.dz + w, buf);
  const d = clipAxis(s.dx - w, s.dy - h, s.dz - w, s.dx + w, s.dy + h, s.dz + w, 1, -probe, buf, n, SKIN);
  return d > -probe + 1e-6;
}

/**
 * Step the RC drone: it drives on the ground relative to the view yaw, falls with gravity, rolls over
 * small lips and hops when `hop` is pressed while on the ground. Also used (with no input) to let a
 * parked drone settle and fall when the floor under it is destroyed.
 */
function stepDrone(s: PlayerState, world: World, dt: number, moveX: number, moveZ: number, yaw: number, hop: boolean, out: StepOut): void {
  const w = DRONE.halfW;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  let mx = moveX;
  let mz = moveZ;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const hasInput = len > 0.01;

  const wasGround = s.dvy <= 0.01 && droneGrounded(s, world);
  if (hop && wasGround) {
    s.dvy = DRONE.hopSpeed;
    out.droneHop = true;
  }
  const grounded = wasGround && !out.droneHop;

  // horizontal velocity toward the wished velocity (vector acceleration, weaker in the air)
  const tx = (-sy * mz + cy * mx) * DRONE.speed;
  const tz = (-cy * mz - sy * mx) * DRONE.speed;
  const a = (hasInput ? DRONE.accel : DRONE.decel) * (grounded ? 1 : DRONE.airControl) * dt;
  const ex = tx - s.dvx;
  const ez = tz - s.dvz;
  const elen = Math.hypot(ex, ez);
  if (elen <= a || elen < 1e-9) {
    s.dvx = tx;
    s.dvz = tz;
  } else {
    s.dvx += (ex / elen) * a;
    s.dvz += (ez / elen) * a;
  }

  const movedX = droneSlide(s, world, 0, s.dvx * dt, grounded);
  if (Math.abs(movedX) < Math.abs(s.dvx * dt) - 1e-5) s.dvx = 0;
  const movedZ = droneSlide(s, world, 2, s.dvz * dt, grounded);
  if (Math.abs(movedZ) < Math.abs(s.dvz * dt) - 1e-5) s.dvz = 0;

  // vertical: stay glued to the ground over small drops, otherwise fall
  const h = DRONE.halfH;
  if (grounded) {
    const n = world.queryBoxes(s.dx - w, s.dy - h - DRONE.stepUp, s.dz - w, s.dx + w, s.dy + h, s.dz + w, buf);
    const drop = clipAxis(s.dx - w, s.dy - h, s.dz - w, s.dx + w, s.dy + h, s.dz + w, 1, -DRONE.stepUp, buf, n, SKIN);
    if (drop > -DRONE.stepUp + 1e-6) {
      s.dy += drop;
      s.dvy = 0;
      keepInside(s, world);
      return;
    }
  }
  s.dvy -= DRONE.gravity * dt;
  if (s.dvy < -DRONE.terminalVel) s.dvy = -DRONE.terminalVel;
  const dy = s.dvy * dt;
  const n = world.queryBoxes(s.dx - w, Math.min(s.dy - h, s.dy - h + dy), s.dz - w, s.dx + w, Math.max(s.dy + h, s.dy + h + dy), s.dz + w, buf);
  const allowed = clipAxis(s.dx - w, s.dy - h, s.dz - w, s.dx + w, s.dy + h, s.dz + w, 1, dy, buf, n, SKIN);
  s.dy += allowed;
  if (Math.abs(allowed - dy) > 1e-9) {
    if (dy < 0) {
      const impact = -s.dvy;
      out.droneLand = impact;
      if (impact > DRONE.fallSafe) s.dhp -= (impact - DRONE.fallSafe) * DRONE.fallDamage;
    }
    s.dvy = 0;
  }
  keepInside(s, world);
}

/** Stay inside the fenced area. */
function keepInside(s: PlayerState, world: World): void {
  const r = DRONE.halfW;
  const lo = TILE + r;
  const hiX = (world.nx - 1) * TILE - r;
  const hiZ = (world.nz - 1) * TILE - r;
  if (s.dx < lo) { s.dx = lo; s.dvx = 0; } else if (s.dx > hiX) { s.dx = hiX; s.dvx = 0; }
  if (s.dz < lo) { s.dz = lo; s.dvz = 0; } else if (s.dz > hiZ) { s.dz = hiZ; s.dvz = 0; }
}

/** Advance one fixed step. Mutates `s`. */
export function stepPlayer(s: PlayerState, cmd: InputCmd, world: World, dt: number, out: StepOut): void {
  out.fired = false;
  out.reloadStarted = false;
  out.switched = false;
  out.vaultStarted = false;
  out.tapUse = false;
  out.droneToggled = false;
  out.dronePressed = false;
  out.meleePressed = false;
  out.gadgetPressed = false;
  out.firePressed = false;
  out.cameraPressed = false;
  out.droneHop = false;
  out.droneLand = 0;

  const buttons = cmd.buttons;
  const prev = s.prevButtons;
  const pressed = buttons & ~prev;
  s.prevButtons = buttons;

  if (!s.alive) {
    s.vx = 0;
    s.vz = 0;
    s.sprint = false;
    s.ads = false;
    s.yaw = cmd.yaw;
    s.pitch = cmd.pitch;
    return;
  }

  s.yaw = cmd.yaw;
  s.pitch = clamp(cmd.pitch, -PLAYER.pitchLimit, PLAYER.pitchLimit);

  out.meleePressed = (pressed & Btn.MELEE) !== 0;
  out.gadgetPressed = (pressed & Btn.GADGET) !== 0;
  out.firePressed = (pressed & Btn.FIRE) !== 0;
  out.cameraPressed = (pressed & Btn.CAMERA) !== 0;

  // cooldown keeps a small negative carry so the fire rate matches the RPM exactly
  s.cooldown -= dt;
  if (s.cooldown < -dt) s.cooldown = -dt;
  if (s.slow > 0) s.slow = Math.max(0, s.slow - dt);

  // INTERACT hold tracking
  if (buttons & Btn.INTERACT) {
    s.useHeld += dt;
  } else {
    out.tapUse = (prev & Btn.INTERACT) !== 0 && s.useHeld < PLAYER.useTapMax;
    s.useHeld = 0;
  }

  out.dronePressed = (pressed & Btn.DRONE) !== 0;
  // Drone toggle (deploying a fresh drone is decided by the server)
  if (pressed & Btn.DRONE && s.dDeployed && s.vault <= 0) {
    s.dCtl = !s.dCtl;
    out.droneToggled = true;
  }

  // A parked drone still obeys gravity (it falls if the floor under it is destroyed).
  if (s.dDeployed && !s.dCtl) stepDrone(s, world, dt, 0, 0, 0, false, out);

  if (s.dCtl) {
    // Body stands still while piloting the drone.
    s.vx = 0;
    s.vz = 0;
    s.sprint = false;
    s.ads = false;
    stepDrone(s, world, dt, cmd.moveX, cmd.moveZ, cmd.yaw, (pressed & Btn.UP) !== 0, out);
    snapOrFall(s, world, s.onGround, dt);
    return;
  }

  if (s.cam) {
    s.vx = 0;
    s.vz = 0;
    s.sprint = false;
    s.ads = false;
    snapOrFall(s, world, s.onGround, dt);
    return;
  }

  // ---- Vault in progress ----
  if (s.vault > 0) {
    s.vault -= dt;
    const t = 1 - Math.max(s.vault, 0) / PLAYER.vaultTime;
    s.x = s.vfx + (s.vtx - s.vfx) * t;
    s.z = s.vfz + (s.vtz - s.vfz) * t;
    s.y = s.vfy + (s.vty - s.vfy) * t + 0.4 * Math.sin(Math.PI * t);
    s.vx = 0;
    s.vz = 0;
    s.vy = 0;
    s.sprint = false;
    s.ads = false;
    if (s.vault <= 0) {
      s.vault = 0;
      s.x = s.vtx;
      s.y = s.vty;
      s.z = s.vtz;
      s.onGround = true;
    }
    return;
  }

  // ---- Stance ----
  const wantCrouch = (buttons & Btn.CROUCH) !== 0;
  if (wantCrouch && !s.crouch) {
    s.crouch = true;
  } else if (!wantCrouch && s.crouch) {
    if (world.standingFree(s.x, s.y, s.z, PLAYER.heightStand)) s.crouch = false;
  }

  // ---- Vault start ----
  if (out.tapUse && s.onGround && world.findVault(s.x, s.y, s.z, s.yaw, vaultTarget)) {
    s.vault = PLAYER.vaultTime;
    s.vfx = s.x; s.vfy = s.y; s.vfz = s.z;
    s.vtx = vaultTarget.x; s.vty = vaultTarget.y; s.vtz = vaultTarget.z;
    s.crouch = false;
    out.vaultStarted = true;
    return;
  }

  // ---- Weapon slot switching ----
  if (cmd.slot !== s.slot) {
    s.slot = cmd.slot ? 1 : 0;
    s.reloading = false;
    s.reload = 0;
    s.cooldown = SWITCH_TIME;
    out.switched = true;
  }
  const def = weaponDef(s.slot === 0 ? s.w0 : s.w1);

  // ---- Movement ----
  const sinY = Math.sin(s.yaw);
  const cosY = Math.cos(s.yaw);
  let mx = cmd.moveX;
  let mz = cmd.moveZ;
  const mlen = Math.hypot(mx, mz);
  if (mlen > 1) { mx /= mlen; mz /= mlen; }
  const hasInput = mlen > 0.01;

  const wantAds = (buttons & Btn.ADS) !== 0;
  const wantSprint = (buttons & Btn.SPRINT) !== 0 && mz > 0.1 && !s.crouch && !wantAds && (buttons & Btn.FIRE) === 0;
  s.sprint = wantSprint && hasInput;
  s.ads = wantAds && !s.sprint;

  let speed = s.crouch ? PLAYER.crouchSpeed : s.sprint ? PLAYER.sprint : PLAYER.walk;
  if (s.ads) speed *= def.adsMoveMul;
  if (s.slow > 0) speed *= 0.3;
  speed *= s.spdMul;

  const wx = (-sinY * mz + cosY * mx) * speed;
  const wz = (-cosY * mz - sinY * mx) * speed;

  const accel = (hasInput ? PLAYER.accel : PLAYER.decel) * (s.onGround ? 1 : PLAYER.airControl) * dt;
  const dvx = wx - s.vx;
  const dvz = wz - s.vz;
  const dlen = Math.hypot(dvx, dvz);
  if (dlen <= accel || dlen < 1e-9) {
    s.vx = wx;
    s.vz = wz;
  } else {
    s.vx += (dvx / dlen) * accel;
    s.vz += (dvz / dlen) * accel;
  }

  const wasGround = s.onGround;
  const canStep = wasGround;
  const movedX = moveHorizontal(s, world, 0, s.vx * dt, canStep);
  if (Math.abs(movedX) < Math.abs(s.vx * dt) - 1e-5) s.vx = 0;
  const movedZ = moveHorizontal(s, world, 2, s.vz * dt, canStep);
  if (Math.abs(movedZ) < Math.abs(s.vz * dt) - 1e-5) s.vz = 0;
  snapOrFall(s, world, wasGround, dt);
  if (s.confined) confine(s, world);

  // ---- Weapon handling ----
  let ammo = s.slot === 0 ? s.ammo0 : s.ammo1;
  let res = s.slot === 0 ? s.res0 : s.res1;

  if (pressed & Btn.RELOAD && !s.reloading && ammo < def.mag && res > 0) {
    s.reloading = true;
    s.reload = def.reload;
    out.reloadStarted = true;
  }
  if (s.reloading) {
    s.reload -= dt;
    if (s.reload <= 0) {
      if (def.perShell) {
        ammo += 1;
        res -= 1;
        if (ammo < def.mag && res > 0) s.reload += def.reload;
        else { s.reloading = false; s.reload = 0; }
      } else {
        const take = Math.min(def.mag - ammo, res);
        ammo += take;
        res -= take;
        s.reloading = false;
        s.reload = 0;
      }
    }
  }

  const fireHeld = (buttons & Btn.FIRE) !== 0;
  const wantFire = fireHeld && (def.auto || (pressed & Btn.FIRE) !== 0);
  if (wantFire) {
    if (ammo <= 0) {
      if (!s.reloading && res > 0 && (pressed & Btn.FIRE) !== 0) {
        s.reloading = true;
        s.reload = def.reload;
        out.reloadStarted = true;
      }
    } else if (s.cooldown <= 0 && (!s.reloading || def.perShell)) {
      if (s.reloading) { s.reloading = false; s.reload = 0; }
      ammo -= 1;
      s.cooldown += fireInterval(def);
      out.fired = true;
      out.shotIdx = s.shotIdx;
      out.weapon = def.id;
      s.shotIdx += 1;
    }
  }

  if (s.slot === 0) { s.ammo0 = ammo; s.res0 = res; } else { s.ammo1 = ammo; s.res1 = res; }
}

