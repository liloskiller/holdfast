// Secondary gadgets: thrown grenades (frag, flash, smoke, impact) and set down traps (barbed wire, alarm).

import {
  EntityKind, HitKind, KillCause, MaterialId, PhaseId, SIM_DT, THROW, ThrowKind, defaultThrowable, eyeHeight, makeRayHit, throwDef,
  type RayHit,
} from '@holdfast/shared';
import type { Entity } from '../Player';
import type { Player } from '../Player';
import type { Room } from '../Room';
import { applyDamage, damageEntity } from './combatSystem';
import { destroyDrone, removeEntity, spawnEntity } from './gadgetSystem';

const hit: RayHit = makeRayHit();

/** Refill the pouch for a new life. `side` is the side of the operator that was picked. */
export function stockThrowable(p: Player, side: 'attack' | 'defend'): void {
  let def = throwDef(p.throwPick);
  if (def.id === ThrowKind.NONE || def.side !== side) def = throwDef(defaultThrowable(side));
  p.throwKind = def.id;
  p.throwLeft = def.count;
  p.throwCd = 0;
  p.blindUntil = 0;
}

function dirOf(p: Player): [number, number, number] {
  const s = p.state;
  const cp = Math.cos(s.pitch);
  return [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp];
}

/** The secondary gadget button. */
export function useThrowable(room: Room, p: Player): void {
  const s = p.state;
  if (!s.alive || s.dCtl || s.cam || s.vault > 0) return;
  if (room.phase !== PhaseId.PREP && room.phase !== PhaseId.ACTION && !room.sandbox) return;
  if (p.throwKind === ThrowKind.NONE) return;
  const def = throwDef(p.throwKind);
  if (p.throwLeft <= 0) {
    room.msg('No ' + def.name.toLowerCase() + ' left', p.id);
    return;
  }
  if (p.throwCd > 0) return;
  if (def.thrown) throwGrenade(room, p);
  else placeTrap(room, p);
}

function throwGrenade(room: Room, p: Player): void {
  const s = p.state;
  const [dx, dy, dz] = dirOf(p);
  const ey = s.y + eyeHeight(s);
  // start a little in front of the face, but not on the other side of a wall
  let ox = s.x + dx * 0.4;
  let oy = ey + dy * 0.4 - 0.1;
  let oz = s.z + dz * 0.4;
  if (room.world.raycast(s.x, ey, s.z, dx, dy, dz, 0.45, hit)) {
    ox = s.x;
    oy = ey - 0.1;
    oz = s.z;
  }
  const kind = p.throwKind;
  const e = spawnEntity(room, {
    kind: EntityKind.GRENADE, owner: p, x: ox, y: oy, z: oz, hp: 0,
    box: { minX: ox - 0.08, maxX: ox + 0.08, minY: oy - 0.08, maxY: oy + 0.08, minZ: oz - 0.08, maxZ: oz + 0.08 },
    a: kind,
  });
  e.b = kind === ThrowKind.FRAG ? THROW.fuse.frag : kind === ThrowKind.FLASH ? THROW.fuse.flash : kind === ThrowKind.SMOKE ? THROW.fuse.smoke : THROW.fuse.impact;
  e.vx = dx * THROW.speed + s.vx * THROW.inherit;
  e.vy = dy * THROW.speed + THROW.lift + s.vy * THROW.inherit;
  e.vz = dz * THROW.speed + s.vz * THROW.inherit;
  p.throwLeft--;
  p.throwCd = THROW.cooldown;
  room.sound('gadget', s.x, ey, s.z, 10, p.id, p.team);
}

function placeTrap(room: Room, p: Player): void {
  const s = p.state;
  const x = s.x - Math.sin(s.yaw) * 0.9;
  const z = s.z - Math.cos(s.yaw) * 0.9;
  const wire = p.throwKind === ThrowKind.WIRE;
  const hw = wire ? 0.5 : 0.12;
  const h = wire ? 0.25 : 0.12;
  if (!room.world.boxFree(x - hw, s.y + 0.03, z - hw, x + hw, s.y + h + 0.2, z + hw)) {
    room.msg('Not enough room', p.id);
    return;
  }
  spawnEntity(room, {
    kind: wire ? EntityKind.WIRE : EntityKind.ALARM, owner: p, x, y: s.y, z, hp: 0,
    box: { minX: x - hw, maxX: x + hw, minY: s.y, maxY: s.y + h, minZ: z - hw, maxZ: z + hw },
  });
  p.throwLeft--;
  p.throwCd = THROW.cooldown;
  room.sound('gadget', x, s.y + 0.2, z, 8, p.id, p.team);
}

// ---------------------------------------------------------------------------
// Per tick
// ---------------------------------------------------------------------------

export function updateThrowables(room: Room): void {
  const now = room.time;
  for (const p of room.players.values()) {
    if (p.throwCd > 0) p.throwCd = Math.max(0, p.throwCd - SIM_DT);
  }
  for (const e of [...room.entities.values()]) {
    if (e.kind === EntityKind.GRENADE) stepGrenade(room, e);
    else if (e.kind === EntityKind.SMOKE) stepSmoke(room, e);
    else if (e.kind === EntityKind.WIRE) stepWire(room, e, now);
    else if (e.kind === EntityKind.ALARM) stepAlarm(room, e, now);
  }
}

function stepGrenade(room: Room, e: Entity): void {
  const owner = room.players.get(e.owner) ?? null;
  const kind = e.a;
  e.vy -= THROW.gravity * SIM_DT;
  const mx = e.vx * SIM_DT;
  const my = e.vy * SIM_DT;
  const mz = e.vz * SIM_DT;
  const len = Math.hypot(mx, my, mz);
  let hitSomething = false;
  if (len > 1e-6) {
    const dx = mx / len;
    const dy = my / len;
    const dz = mz / len;
    if (room.world.raycast(e.x, e.y, e.z, dx, dy, dz, len + THROW.radius, hit)) {
      hitSomething = true;
      const travel = Math.max(0, hit.t - THROW.radius);
      e.x += dx * travel + hit.nx * 0.02;
      e.y += dy * travel + hit.ny * 0.02;
      e.z += dz * travel + hit.nz * 0.02;
      bounce(room, e, hit.nx, hit.ny, hit.nz, hit.kind === HitKind.CELL && room.world.materialOf(hit.id) === MaterialId.GLASS ? hit.id : -1);
    } else {
      e.x += mx;
      e.y += my;
      e.z += mz;
    }
  }
  // the ground of the first floor is not a solid in the voxel grid
  if (e.y < THROW.radius && room.world.floorOf(e.y) === 0 && e.vy < 0) {
    e.y = THROW.radius;
    bounce(room, e, 0, 1, 0, -1);
    hitSomething = true;
  }
  e.b -= SIM_DT;
  if (kind === ThrowKind.IMPACT && hitSomething) {
    detonate(room, e, owner);
    return;
  }
  if (e.b <= 0) detonate(room, e, owner);
}

function bounce(room: Room, e: Entity, nx: number, ny: number, nz: number, glassCell: number): void {
  const speed = Math.hypot(e.vx, e.vy, e.vz);
  if (glassCell >= 0) {
    // it goes through the pane and takes some speed with it
    room.world.damageCell(glassCell, 100);
    room.sound('glass', e.x, e.y, e.z, 25, e.owner, -1);
    e.vx *= 0.6;
    e.vy *= 0.6;
    e.vz *= 0.6;
    return;
  }
  const vn = e.vx * nx + e.vy * ny + e.vz * nz;
  if (vn < 0) {
    e.vx -= (1 + THROW.bounce) * vn * nx;
    e.vy -= (1 + THROW.bounce) * vn * ny;
    e.vz -= (1 + THROW.bounce) * vn * nz;
  }
  if (ny > 0.5) {
    e.vx *= THROW.friction;
    e.vz *= THROW.friction;
    if (Math.hypot(e.vx, e.vy, e.vz) < 1.2) {
      e.vx = 0;
      e.vy = 0;
      e.vz = 0;
    }
  }
  if (speed > 3) room.sound('metal', e.x, e.y, e.z, 9, e.owner, -1);
}

function detonate(room: Room, e: Entity, owner: Player | null): void {
  const kind = e.a;
  const { x, y, z } = e;
  removeEntity(room, e);
  switch (kind) {
    case ThrowKind.FRAG:
      blast(room, owner, x, y, z, THROW.frag.radius, THROW.frag.damage, THROW.frag.wallRadius, THROW.frag.wallDamage);
      break;
    case ThrowKind.IMPACT:
      blast(room, owner, x, y, z, THROW.impact.radius, THROW.impact.damage, THROW.impact.wallRadius, THROW.impact.wallDamage);
      break;
    case ThrowKind.FLASH:
      flash(room, owner, x, y, z);
      break;
    case ThrowKind.SMOKE:
      if (owner) {
        const cloud = spawnEntity(room, {
          kind: EntityKind.SMOKE, owner, x, y: Math.max(y, 0.4), z, hp: 0,
          box: { minX: x - 0.1, maxX: x + 0.1, minY: y, maxY: y + 0.2, minZ: z - 0.1, maxZ: z + 0.1 },
        });
        cloud.a = 0.5;
        cloud.b = 0;
        room.world.smokes.push({ id: cloud.id, x, y: Math.max(y, 0.4) + 0.5, z, r: 0.5 });
        room.sound('gadget', x, y, z, 30, owner.id, -1);
      }
      break;
    default:
      break;
  }
}

export function blast(
  room: Room, owner: Player | null, x: number, y: number, z: number, radius: number, damage: number, wallRadius: number, wallDamage: number,
  cause: number = KillCause.GRENADE,
): void {
  for (const o of room.players.values()) {
    const os = o.state;
    if (os.dDeployed && (!owner || o.team !== owner.team)) {
      const dd = Math.hypot(os.dx - x, os.dy - y, os.dz - z);
      if (dd < radius * 0.7 && room.world.lineOfSight(x, y, z, os.dx, os.dy, os.dz)) {
        os.dhp -= damage * (1 - dd / radius);
        if (os.dhp <= 0) destroyDrone(room, o, owner);
      }
    }
    if (!os.alive) continue;
    const d = Math.hypot(os.x - x, os.y + 1 - y, os.z - z);
    if (d > radius) continue;
    if (d > 0.9 && !room.world.lineOfSight(x, y, z, os.x, os.y + 1, os.z)) continue;
    const f = 1 - d / radius;
    const dx = os.x - x;
    const dz = os.z - z;
    const l = Math.hypot(dx, dz) || 1;
    os.vx += (dx / l) * 4 * f;
    os.vz += (dz / l) * 4 * f;
    if (!owner || o === owner || o.team !== owner.team || room.settings.friendlyFire) {
      applyDamage(room, o, owner, Math.round(damage * f), false, cause);
    }
  }
  // gadgets nearby: shields take the blast, traps and cameras are wrecked
  for (const g of [...room.entities.values()]) {
    if (g.kind === EntityKind.GRENADE || g.kind === EntityKind.SMOKE || g.kind === EntityKind.BOMB || g.kind === EntityKind.NITRO) continue;
    const d = Math.hypot(g.x - x, g.y - y, g.z - z);
    if (d > wallRadius * 1.6) continue;
    if (g.dynId >= 0 || g.maxHp > 0) damageEntity(room, g, damage * (1 - d / (wallRadius * 1.6)));
    else if (g.team !== (owner?.team ?? -1)) removeEntity(room, g);
  }
  room.world.explode(x, y, z, wallRadius, wallDamage);
  room.pub.push({ k: 'boom', x, y, z, r: radius * 0.5 });
  room.sound('boom', x, y, z, 80, owner?.id ?? 0, -1);
}

function flash(room: Room, owner: Player | null, x: number, y: number, z: number): void {
  const F = THROW.flash;
  for (const o of room.players.values()) {
    const os = o.state;
    if (!os.alive) continue;
    const ey = os.y + eyeHeight(os);
    const d = Math.hypot(os.x - x, ey - y, os.z - z);
    if (d > F.radius) continue;
    if (d > 0.5 && !room.world.lineOfSight(x, y, z, os.x, ey, os.z)) continue;
    // how much of it lands on the eyes: looking at it is worst, turned away still hurts a bit
    const cp = Math.cos(os.pitch);
    const lx = -Math.sin(os.yaw) * cp;
    const ly = Math.sin(os.pitch);
    const lz = -Math.cos(os.yaw) * cp;
    const dot = d > 0.01 ? (lx * (x - os.x) + ly * (y - ey) + lz * (z - os.z)) / d : 1;
    const facing = dot > 0.1 ? 1 : dot > -0.5 ? 0.6 : F.awayMul;
    const dur = (F.maxTime + (F.minTime - F.maxTime) * (d / F.radius)) * facing;
    if (dur < 0.3) continue;
    o.blindUntil = Math.max(o.blindUntil, room.time + dur * 1000);
  }
  void owner;
  room.sound('flash', x, y, z, 45, owner?.id ?? 0, -1);
}

function stepSmoke(room: Room, e: Entity): void {
  e.b += SIM_DT;
  const R = THROW.smoke.radius;
  const r = Math.min(R, 0.5 + (R - 0.5) * (e.b / THROW.smoke.grow));
  e.a = r;
  const sm = room.world.smokes.find((s) => s.id === e.id);
  if (sm) sm.r = r;
  if (e.b >= THROW.smoke.life) removeEntity(room, e);
}

function stepWire(room: Room, e: Entity, now: number): void {
  const W = THROW.wire;
  for (const o of room.players.values()) {
    if (o.team === e.team || !o.state.alive) continue;
    const os = o.state;
    if (Math.abs(os.x - e.x) > W.radius || Math.abs(os.z - e.z) > W.radius || Math.abs(os.y - e.y) > 0.6) continue;
    os.slow = Math.max(os.slow, 0.25);
    if (now - e.lastCheck >= 500) {
      e.lastCheck = now;
      applyDamage(room, o, room.players.get(e.owner) ?? null, Math.round(W.dps * 0.5), false, KillCause.WIRE);
      room.sound('trap', e.x, e.y, e.z, 10, e.owner, e.team);
    }
  }
}

function stepAlarm(room: Room, e: Entity, now: number): void {
  if (now - e.lastCheck < 250) return;
  e.lastCheck = now;
  for (const o of room.players.values()) {
    if (o.team === e.team || !o.state.alive) continue;
    const os = o.state;
    if (Math.hypot(os.x - e.x, os.z - e.z) > THROW.alarm.radius || Math.abs(os.y - e.y) > 1.6) continue;
    o.tagUntil[e.team] = now + THROW.alarm.mark * 1000;
    for (const m of room.players.values()) {
      if (m.team !== e.team || m.isDummy) continue;
      room.pushEvent(m.id, { k: 'tag', id: o.id });
      room.msg('Proximity alarm!', m.id);
    }
    room.sound('ping', e.x, e.y + 0.2, e.z, 40, 0, -1);
    removeEntity(room, e);
    return;
  }
}
