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
  /** True for one step when the INTERACT button was released after a tap. */
  meleePressed: boolean;
  gadgetPressed: boolean;
  firePressed: boolean;
  cameraPressed: boolean;
}

export function makeStepOut(): StepOut {
  return {
    fired: false, shotIdx: 0, weapon: 0, reloadStarted: false, switched: false, vaultStarted: false,
    tapUse: false, droneToggled: false, meleePressed: false, gadgetPressed: false, firePressed: false,
    cameraPressed: false,
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

function stepDrone(s: PlayerState, cmd: InputCmd, world: World, dt: number): void {
  const r = DRONE.radius;
  const sy = Math.sin(cmd.yaw);
  const cy = Math.cos(cmd.yaw);
  const fx = -sy, fz = -cy;
  const rx = cy, rz = -sy;
  let mx = cmd.moveX;
  let mz = cmd.moveZ;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const tx = (fx * mz + rx * mx) * DRONE.speed;
  const tz = (fz * mz + rz * mx) * DRONE.speed;
  const up = ((cmd.buttons & Btn.UP) !== 0 ? 1 : 0) - ((cmd.buttons & Btn.DOWN) !== 0 ? 1 : 0);
  const ty = up * DRONE.vertSpeed;
  const a = DRONE.accel * dt;
  s.dvx = approachTo(s.dvx, tx, a);
  s.dvy = approachTo(s.dvy, ty, a);
  s.dvz = approachTo(s.dvz, tz, a);

  // axis by axis clip
  const mv = [s.dvx * dt, s.dvy * dt, s.dvz * dt];
  for (let ax = 0; ax < 3; ax++) {
    const d = mv[ax] as number;
    if (d === 0) continue;
    const minX = s.dx - r, maxX = s.dx + r, minY = s.dy - r, maxY = s.dy + r, minZ = s.dz - r, maxZ = s.dz + r;
    const n = world.queryBoxes(minX - Math.abs(d), minY - Math.abs(d), minZ - Math.abs(d), maxX + Math.abs(d), maxY + Math.abs(d), maxZ + Math.abs(d), buf);
    const allowed = clipAxis(minX, minY, minZ, maxX, maxY, maxZ, ax as 0 | 1 | 2, d, buf, n, SKIN);
    if (ax === 0) { s.dx += allowed; if (allowed !== d) s.dvx = 0; }
    else if (ax === 1) { s.dy += allowed; if (allowed !== d) s.dvy = 0; }
    else { s.dz += allowed; if (allowed !== d) s.dvz = 0; }
  }
}

function approachTo(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/** Advance one fixed step. Mutates `s`. */
export function stepPlayer(s: PlayerState, cmd: InputCmd, world: World, dt: number, out: StepOut): void {
  out.fired = false;
  out.reloadStarted = false;
  out.switched = false;
  out.vaultStarted = false;
  out.tapUse = false;
  out.droneToggled = false;
  out.meleePressed = false;
  out.gadgetPressed = false;
  out.firePressed = false;
  out.cameraPressed = false;

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

  // Drone toggle (deploying a fresh drone is decided by the server)
  if (pressed & Btn.DRONE && s.dDeployed && s.vault <= 0) {
    s.dCtl = !s.dCtl;
    out.droneToggled = true;
  }

  if (s.dCtl) {
    // Body stands still while piloting the drone.
    s.vx = 0;
    s.vz = 0;
    s.sprint = false;
    s.ads = false;
    stepDrone(s, cmd, world, dt);
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

