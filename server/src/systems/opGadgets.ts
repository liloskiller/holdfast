// Gadgets of the later operators: Burn (burn charge), Rush (stim), Nitro (sticky remote charge), Patch (med station).

import {
  EntityKind, FLOOR_H, GADGET, GadgetKind, HitKind, KillCause, MaterialId, SIM_DT, THROW, eyeHeight, makeRayHit, operatorDef,
  type Aabb, type RayHit,
} from '@holdfast/shared';
import type { Entity, Player } from '../Player';
import type { Room } from '../Room';
import { applyDamage } from './combatSystem';
import { removeEntity, spawnEntity } from './gadgetSystem';
import { blast } from './throwSystem';

const hit: RayHit = makeRayHit();

function look(p: Player): [number, number, number] {
  const s = p.state;
  const cp = Math.cos(s.pitch);
  return [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp];
}

function box(x: number, y: number, z: number, hw: number, h: number): Aabb {
  return { minX: x - hw, maxX: x + hw, minY: y, maxY: y + h, minZ: z - hw, maxZ: z + hw };
}

/** Handles the button for the later operators. Returns false for the older gadgets, which useGadget handles. */
export function useOperatorGadget(room: Room, p: Player): boolean {
  const op = operatorDef(p.op);
  const kind = op.gadget;
  if (kind !== GadgetKind.THERMITE && kind !== GadgetKind.STIM && kind !== GadgetKind.NITRO && kind !== GadgetKind.STATION) return false;
  const s = p.state;
  if (!s.alive) return true;
  if (kind === GadgetKind.NITRO && p.charges.length > 0) {
    detonateNitro(room, p);
    return true;
  }
  if (p.gadgetUses <= 0) {
    room.msg('No ' + op.gadgetName.toLowerCase() + ' left', p.id);
    return true;
  }
  if (p.gadgetCd > 0) {
    room.msg('Wait ' + Math.ceil(p.gadgetCd) + 's', p.id);
    return true;
  }
  const ey = s.y + eyeHeight(s);
  const [dx, dy, dz] = look(p);

  switch (kind) {
    case GadgetKind.THERMITE: {
      if (!room.world.raycast(s.x, ey, s.z, dx, dy, dz, GADGET.placeReach, hit, { skipDyn: true }) ||
          (hit.kind !== HitKind.CELL && hit.kind !== HitKind.STATIC && hit.kind !== HitKind.OPENING)) {
        room.msg('Aim at a wall or hatch', p.id);
        return true;
      }
      const e = spawnEntity(room, {
        kind: EntityKind.BURNER, owner: p, x: hit.x + hit.nx * 0.06, y: hit.y + hit.ny * 0.06, z: hit.z + hit.nz * 0.06,
        hp: 0, box: box(hit.x, hit.y - 0.1, hit.z, 0.12, 0.2), nx: hit.nx, ny: hit.ny, nz: hit.nz,
      });
      e.b = GADGET.burnFuse;
      p.gadgetUses--;
      room.sound('gadget', e.x, e.y, e.z, 12, p.id, p.team);
      return true;
    }
    case GadgetKind.STIM: {
      if (p.stimT > 0) {
        room.msg('Still running on the last one', p.id);
        return true;
      }
      p.stimT = GADGET.stimTime;
      p.healLeft += GADGET.stimHeal;
      p.healRate = GADGET.stimHeal / GADGET.stimTime;
      p.gadgetUses--;
      p.gadgetCd = 1;
      room.sound('gadget', s.x, ey, s.z, 8, p.id, p.team);
      return true;
    }
    case GadgetKind.NITRO: {
      const ox = s.x + dx * 0.4;
      const oy = ey + dy * 0.4 - 0.1;
      const oz = s.z + dz * 0.4;
      const e = spawnEntity(room, {
        kind: EntityKind.NITRO, owner: p, x: ox, y: oy, z: oz, hp: 0, box: box(ox, oy - 0.08, oz, 0.08, 0.16),
      });
      e.b = 0; // 0 flying, 1 stuck
      e.vx = dx * THROW.speed + s.vx * THROW.inherit;
      e.vy = dy * THROW.speed + THROW.lift + s.vy * THROW.inherit;
      e.vz = dz * THROW.speed + s.vz * THROW.inherit;
      p.charges.push(e.id);
      p.gadgetUses--;
      p.gadgetCd = 0.5;
      room.sound('gadget', s.x, ey, s.z, 10, p.id, p.team);
      return true;
    }
    case GadgetKind.STATION: {
      const cx = s.x - Math.sin(s.yaw) * 0.9;
      const cz = s.z - Math.cos(s.yaw) * 0.9;
      const b = box(cx, s.y, cz, 0.3, 0.35);
      if (!room.world.boxFree(b.minX, b.minY + 0.03, b.minZ, b.maxX, b.maxY, b.maxZ)) {
        room.msg('Not enough room', p.id);
        return true;
      }
      const e = spawnEntity(room, { kind: EntityKind.STATION, owner: p, x: cx, y: s.y, z: cz, hp: 0, box: b });
      e.b = GADGET.stationSupply;
      p.gadgetUses--;
      room.sound('gadget', cx, s.y + 0.3, cz, 8, p.id, p.team);
      return true;
    }
    default:
      return true;
  }
}

function detonateNitro(room: Room, p: Player): void {
  const ids = [...p.charges];
  p.charges = [];
  for (const id of ids) {
    const e = room.entities.get(id);
    if (!e || e.kind !== EntityKind.NITRO) continue;
    removeEntity(room, e);
    blast(room, p, e.x, e.y, e.z, GADGET.nitroRadius, GADGET.nitroDamage, GADGET.nitroWallRadius, GADGET.nitroWallDamage, KillCause.NITRO);
  }
}

// ---------------------------------------------------------------------------
// Per tick
// ---------------------------------------------------------------------------

export function updateOperatorGadgets(room: Room): void {
  for (const p of room.players.values()) {
    if (p.isDummy) continue;
    if (p.stimT > 0) p.stimT = Math.max(0, p.stimT - SIM_DT);
    p.state.spdMul = operatorDef(p.op).speedMul * (p.stimT > 0 ? GADGET.stimSpeed : 1);
  }
  for (const e of [...room.entities.values()]) {
    if (e.kind === EntityKind.BURNER) {
      e.b -= SIM_DT;
      if (e.b <= 0) burnThrough(room, e);
    } else if (e.kind === EntityKind.NITRO) {
      stepNitro(room, e);
    } else if (e.kind === EntityKind.STATION) {
      stepStation(room, e);
    }
  }
}

function burnThrough(room: Room, e: Entity): void {
  const owner = room.players.get(e.owner) ?? null;
  const { w, h, d } = GADGET.burnBox;
  const cx = e.x - e.nx * 0.4;
  const cy = e.y - e.ny * 0.4;
  const cz = e.z - e.nz * 0.4;
  let region: Aabb;
  if (Math.abs(e.ny) > 0.5) {
    // a hatch or a floor: a square hole
    region = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - 0.5, maxY: cy + 0.5, minZ: cz - w / 2, maxZ: cz + w / 2 };
  } else {
    // a wall: from the floor up past the charge, so it can be walked through
    const base = room.world.floorOf(cy) * FLOOR_H;
    const alongX = Math.abs(e.nx) < Math.abs(e.nz);
    const hw = alongX ? w / 2 : d / 2;
    const hd = alongX ? d / 2 : w / 2;
    region = { minX: cx - hw, maxX: cx + hw, minY: base, maxY: Math.max(base + 1.9, cy + h / 2), minZ: cz - hd, maxZ: cz + hd };
  }
  room.world.destroyBox(region, true);
  room.pub.push({ k: 'boom', x: e.x, y: e.y, z: e.z, r: 1.3 });
  room.sound('breach', e.x, e.y, e.z, 55, e.owner, -1);
  for (const o of room.players.values()) {
    if (!o.state.alive) continue;
    const os = o.state;
    const dist = Math.hypot(os.x - e.x, os.y + 1 - e.y, os.z - e.z);
    if (dist > GADGET.burnRadius) continue;
    if (dist > 0.6 && !room.world.lineOfSight(e.x, e.y, e.z, os.x, os.y + 1, os.z)) continue;
    if (!owner || o === owner || o.team !== owner.team || room.settings.friendlyFire) {
      applyDamage(room, o, owner, Math.round(GADGET.burnDamage * (1 - dist / (GADGET.burnRadius * 1.3))), false, KillCause.BURN);
    }
  }
  removeEntity(room, e);
}

function stepNitro(room: Room, e: Entity): void {
  if (e.b >= 1) return; // stuck
  e.vy -= THROW.gravity * SIM_DT;
  const mx = e.vx * SIM_DT;
  const my = e.vy * SIM_DT;
  const mz = e.vz * SIM_DT;
  const len = Math.hypot(mx, my, mz);
  if (len > 1e-6) {
    const dx = mx / len;
    const dy = my / len;
    const dz = mz / len;
    if (room.world.raycast(e.x, e.y, e.z, dx, dy, dz, len + 0.08, hit)) {
      if (hit.kind === HitKind.CELL && room.world.materialOf(hit.id) === MaterialId.GLASS) {
        room.world.damageCell(hit.id, 100);
        e.x += mx;
        e.y += my;
        e.z += mz;
        return;
      }
      stick(e, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
      room.sound('metal', e.x, e.y, e.z, 12, e.owner, -1);
      return;
    }
    e.x += mx;
    e.y += my;
    e.z += mz;
  }
  if (e.y < 0.06 && room.world.floorOf(e.y) === 0 && e.vy < 0) {
    stick(e, e.x, 0, e.z, 0, 1, 0);
    return;
  }
  // thrown into the sky: it comes down eventually
  if (room.time - e.born > 6000) stick(e, e.x, Math.max(0, e.y - 0.5), e.z, 0, 1, 0);
}

function stick(e: Entity, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  e.x = x + nx * 0.05;
  e.y = y + ny * 0.05;
  e.z = z + nz * 0.05;
  e.nx = nx;
  e.ny = ny;
  e.nz = nz;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.b = 1;
}

function stepStation(room: Room, e: Entity): void {
  for (const o of room.players.values()) {
    if (o.team !== e.team || !o.state.alive) continue;
    const os = o.state;
    if (Math.hypot(os.x - e.x, os.z - e.z) > GADGET.stationRadius || Math.abs(os.y - e.y) > 1.5) continue;
    const max = 100 + operatorDef(o.op).hpBonus;
    if (os.hp >= max) continue;
    const amount = Math.min(GADGET.stationRate * SIM_DT, e.b, max - os.hp);
    os.hp += amount;
    e.b -= amount;
  }
  if (e.b <= 0.01) removeEntity(room, e);
}
