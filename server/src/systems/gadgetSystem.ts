// Operator gadgets, drones and placed entities (shields, traps, jammers, cameras, breach charges).

import {
  DRONE, EntityKind, GADGET, GadgetKind, HitKind, OperatorId, PhaseId, SIM_DT, eyeHeight, makeRayHit,
  operatorDef, rayAabb, type Aabb, type RayHit,
} from '@holdfast/shared';
import type { Entity } from '../Player';
import { Player } from '../Player';
import type { Room } from '../Room';
import { applyDamage } from './combatSystem';

const hit: RayHit = makeRayHit();
export const BREACH_WEAPON = 5;

function look(p: Player): [number, number, number] {
  const s = p.state;
  const cp = Math.cos(s.pitch);
  return [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp];
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

interface EntityInit {
  kind: EntityKind;
  owner: Player;
  x: number;
  y: number;
  z: number;
  hp: number;
  box: Aabb;
  a?: number;
  b?: number;
  nx?: number;
  ny?: number;
  nz?: number;
  shield?: boolean;
}

function spawnEntity(room: Room, init: EntityInit): Entity {
  const id = room.nextEntityId++;
  const e: Entity = {
    id, kind: init.kind, team: init.owner.team, owner: init.owner.id,
    x: init.x, y: init.y, z: init.z, a: init.a ?? 0, b: init.b ?? 0,
    hp: init.hp, maxHp: init.hp, box: init.box,
    nx: init.nx ?? 0, ny: init.ny ?? 1, nz: init.nz ?? 0,
    born: room.time, dynId: -1, armed: true, lastCheck: 0,
  };
  if (init.shield) {
    e.dynId = id;
    room.world.addDyn({ id, box: init.box, hp: init.hp, maxHp: init.hp, team: e.team, kind: init.kind, vaultable: true, blocksMove: true });
  }
  room.entities.set(id, e);
  return e;
}

export function removeEntity(room: Room, e: Entity): void {
  room.entities.delete(e.id);
  if (e.dynId >= 0) room.world.removeDyn(e.dynId);
  const owner = room.players.get(e.owner);
  if (owner) {
    owner.charges = owner.charges.filter((c) => c !== e.id);
    owner.cameras = owner.cameras.filter((c) => c !== e.id);
    if (owner.camIdx >= owner.cameras.length) exitCamera(room, owner);
  }
}

export function clearEntities(room: Room): void {
  for (const e of [...room.entities.values()]) removeEntity(room, e);
  room.entities.clear();
  for (const p of room.players.values()) {
    p.charges = [];
    p.cameras = [];
    p.camIdx = -1;
  }
}

function boxAround(x: number, y: number, z: number, hw: number, h: number, hd: number): Aabb {
  return { minX: x - hw, maxX: x + hw, minY: y, maxY: y + h, minZ: z - hd, maxZ: z + hd };
}

// ---------------------------------------------------------------------------
// Using gadgets
// ---------------------------------------------------------------------------

export function useGadget(room: Room, p: Player): void {
  const s = p.state;
  if (!s.alive) return;
  const op = operatorDef(p.op);
  if (op.gadget === GadgetKind.NONE || op.gadget === GadgetKind.REINFORCE) {
    room.msg(op.gadget === GadgetKind.REINFORCE ? 'Warden: use INTERACT to reinforce walls' : 'No gadget', p.id);
    return;
  }
  if (op.gadget === GadgetKind.BREACH && p.charges.length > 0) {
    detonate(room, p);
    return;
  }
  if (p.gadgetUses <= 0) {
    room.msg('No ' + op.gadgetName.toLowerCase() + ' left', p.id);
    return;
  }
  if (p.gadgetCd > 0) {
    room.msg('Recharging (' + Math.ceil(p.gadgetCd) + 's)', p.id);
    return;
  }
  const eye = eyeHeight(s);
  const [dx, dy, dz] = look(p);
  const ox = s.x;
  const oy = s.y + eye;
  const oz = s.z;

  switch (op.gadget) {
    case GadgetKind.BREACH: {
      if (!room.world.raycast(ox, oy, oz, dx, dy, dz, GADGET.breachReach, hit, { skipDyn: true }) ||
          (hit.kind !== HitKind.CELL && hit.kind !== HitKind.STATIC && hit.kind !== HitKind.OPENING)) {
        room.msg('Aim at a wall, door or hatch', p.id);
        return;
      }
      const e = spawnEntity(room, {
        kind: EntityKind.BREACH, owner: p, x: hit.x + hit.nx * 0.06, y: hit.y + hit.ny * 0.06, z: hit.z + hit.nz * 0.06,
        hp: 0, box: boxAround(hit.x, hit.y - 0.1, hit.z, 0.12, 0.2, 0.12), nx: hit.nx, ny: hit.ny, nz: hit.nz,
      });
      p.charges.push(e.id);
      p.gadgetUses--;
      room.sound('gadget', e.x, e.y, e.z, 12, p.id, p.team);
      break;
    }
    case GadgetKind.SENSOR: {
      if (p.jammed) {
        room.msg('Signal jammed', p.id);
        return;
      }
      p.sensorT = GADGET.sensorDuration;
      p.gadgetCd = GADGET.sensorCooldown;
      p.gadgetUses--;
      room.sound('gadget', s.x, oy, s.z, 8, p.id, p.team);
      break;
    }
    case GadgetKind.DART: {
      if (p.jammed) {
        room.msg('Signal jammed', p.id);
        return;
      }
      let target: Player = p;
      let bestT: number = GADGET.dartRange;
      if (room.world.raycast(ox, oy, oz, dx, dy, dz, GADGET.dartRange, hit, { seeThroughGlass: true })) bestT = hit.t;
      for (const o of room.players.values()) {
        if (o === p || o.team !== p.team || !o.state.alive) continue;
        const t = rayAabb(ox, oy, oz, dx, dy, dz, o.state.x - 0.45, o.state.y, o.state.z - 0.45, o.state.x + 0.45, o.state.y + 1.9, o.state.z + 0.45, bestT);
        if (t >= 0 && t < bestT) {
          bestT = t;
          target = o;
        }
      }
      const amount = GADGET.dartHeal * (p.op === OperatorId.MEND ? 1.25 : 1);
      target.healLeft += amount;
      target.healRate = amount / GADGET.dartHealTime;
      p.gadgetUses--;
      p.gadgetCd = 1;
      room.sound('gadget', s.x, oy, s.z, 10, p.id, p.team);
      room.msg(target === p ? 'Healing yourself' : 'Healing ' + target.name, p.id);
      if (target !== p) room.msg(p.name + ' is healing you', target.id);
      break;
    }
    case GadgetKind.SHIELD: {
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      const cx = s.x + fx * 1.3;
      const cz = s.z + fz * 1.3;
      const alongZ = Math.abs(fx) > Math.abs(fz); // shield faces x, spans z
      const hw = alongZ ? GADGET.shieldThickness / 2 : GADGET.shieldWidth / 2;
      const hd = alongZ ? GADGET.shieldWidth / 2 : GADGET.shieldThickness / 2;
      const box = boxAround(cx, s.y, cz, hw, GADGET.shieldHeight, hd);
      if (!room.world.boxFree(box.minX, box.minY + 0.05, box.minZ, box.maxX, box.maxY, box.maxZ)) {
        room.msg('Not enough room', p.id);
        return;
      }
      spawnEntity(room, { kind: EntityKind.SHIELD, owner: p, x: cx, y: s.y, z: cz, hp: GADGET.shieldHp, box, a: alongZ ? Math.PI / 2 : 0, shield: true });
      p.gadgetUses--;
      room.sound('gadget', cx, s.y + 1, cz, 15, p.id, p.team);
      break;
    }
    case GadgetKind.TRAP:
    case GadgetKind.JAMMER: {
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      const cx = s.x + fx * 0.9;
      const cz = s.z + fz * 0.9;
      const isTrap = op.gadget === GadgetKind.TRAP;
      const hw = isTrap ? 0.3 : 0.18;
      const h = isTrap ? 0.1 : 0.5;
      const box = boxAround(cx, s.y, cz, hw, h, hw);
      if (!room.world.boxFree(box.minX, box.minY + 0.03, box.minZ, box.maxX, box.maxY + 0.3, box.maxZ)) {
        room.msg('Not enough room', p.id);
        return;
      }
      spawnEntity(room, {
        kind: isTrap ? EntityKind.TRAP : EntityKind.JAMMER, owner: p, x: cx, y: s.y, z: cz,
        hp: isTrap ? 0 : GADGET.jammerHp, box,
      });
      p.gadgetUses--;
      room.sound('gadget', cx, s.y + 0.3, cz, 8, p.id, p.team);
      break;
    }
    case GadgetKind.CAMERA: {
      if (p.cameras.length >= 2) {
        room.msg('Both cameras are placed', p.id);
        return;
      }
      if (!room.world.raycast(ox, oy, oz, dx, dy, dz, GADGET.placeReach, hit, { skipDyn: true, skipOpenings: true }) ||
          (hit.kind !== HitKind.CELL && hit.kind !== HitKind.STATIC)) {
        room.msg('Aim at a wall or ceiling', p.id);
        return;
      }
      const cx = hit.x + hit.nx * 0.12;
      const cy = hit.y + hit.ny * 0.12;
      const cz = hit.z + hit.nz * 0.12;
      const yaw = Math.atan2(-hit.nx, -hit.nz);
      const pitch = Math.asin(Math.max(-1, Math.min(1, hit.ny)));
      const e = spawnEntity(room, {
        kind: EntityKind.CAMERA, owner: p, x: cx, y: cy, z: cz, hp: GADGET.cameraHp,
        box: boxAround(cx, cy - 0.12, cz, 0.12, 0.24, 0.12), a: hit.ny === 0 ? yaw : yaw, b: pitch, nx: hit.nx, ny: hit.ny, nz: hit.nz,
      });
      p.cameras.push(e.id);
      p.gadgetUses--;
      room.sound('gadget', cx, cy, cz, 8, p.id, p.team);
      room.msg('Camera ' + p.cameras.length + ' placed', p.id);
      break;
    }
    default:
      break;
  }
}

function detonate(room: Room, p: Player): void {
  const ids = [...p.charges];
  p.charges = [];
  for (const id of ids) {
    const e = room.entities.get(id);
    if (!e) continue;
    const cx = e.x - e.nx * 0.45;
    const cy = e.y - e.ny * 0.45;
    const cz = e.z - e.nz * 0.45;
    let box: Aabb;
    if (Math.abs(e.ny) > 0.5) {
      box = { minX: cx - 0.75, maxX: cx + 0.75, minY: cy - 0.5, maxY: cy + 0.5, minZ: cz - 0.75, maxZ: cz + 0.75 };
    } else {
      box = { minX: cx - 0.75, maxX: cx + 0.75, minY: cy - 1.0, maxY: cy + 1.0, minZ: cz - 0.75, maxZ: cz + 0.75 };
    }
    room.world.destroyBox(box, true);
    room.pub.push({ k: 'boom', x: e.x, y: e.y, z: e.z, r: 2.5 });
    room.sound('breach', e.x, e.y, e.z, 90, p.id, p.team);
    // blast: damage and knockback to players in LOS
    for (const o of room.players.values()) {
      if (!o.state.alive) continue;
      const os = o.state;
      const d = Math.hypot(os.x - e.x, os.y + 1 - e.y, os.z - e.z);
      if (d > GADGET.breachDamageRadius) continue;
      const open = room.world.lineOfSight(e.x, e.y, e.z, os.x, os.y + 1, os.z) || d < 0.8;
      if (!open) continue;
      const f = 1 - d / GADGET.breachDamageRadius;
      const dx = os.x - e.x;
      const dz = os.z - e.z;
      const l = Math.hypot(dx, dz) || 1;
      os.vx += (dx / l) * GADGET.breachKnockback * f;
      os.vz += (dz / l) * GADGET.breachKnockback * f;
      os.vy = 3 * f;
      os.onGround = false;
      if (o.team !== p.team || room.settings.friendlyFire || o === p) {
        applyDamage(room, o, p, Math.round(GADGET.breachDamage * f), false, BREACH_WEAPON);
      }
    }
    removeEntity(room, e);
  }
}

// ---------------------------------------------------------------------------
// Drones
// ---------------------------------------------------------------------------

export function deployDronesForPrep(room: Room): void {
  const spots = room.map.droneSpawns;
  let i = 0;
  for (const p of room.players.values()) {
    if (p.isDummy || !p.state.alive || !room.isAttacker(p)) continue;
    const spot = spots[i % Math.max(1, spots.length)];
    i++;
    const s = p.state;
    s.dDeployed = true;
    s.dCtl = false;
    s.dx = spot ? spot.x : s.x;
    s.dy = spot ? spot.y : s.y + 1.2;
    s.dz = spot ? spot.z : s.z;
    s.dvx = 0;
    s.dvy = 0;
    s.dvz = 0;
    s.dhp = DRONE.hp;
    p.droneCd = 0;
  }
}

export function droneButton(room: Room, p: Player, toggled: boolean): void {
  const s = p.state;
  if (toggled || s.dDeployed || !s.alive) return;
  if (!room.canAttackerStuff(p)) {
    room.msg('Only attackers have drones', p.id);
    return;
  }
  if (!room.sandbox && room.phase !== PhaseId.PREP && room.phase !== PhaseId.ACTION) return;
  if (p.droneCd > 0) {
    room.msg('Drone ready in ' + Math.ceil(p.droneCd) + 's', p.id);
    return;
  }
  const [dx, , dz] = look(p);
  let x = s.x + dx * 0.7;
  let z = s.z + dz * 0.7;
  const y = s.y + eyeHeight(s) - 0.35;
  if (!room.world.boxFree(x - 0.15, y - 0.15, z - 0.15, x + 0.15, y + 0.15, z + 0.15)) {
    x = s.x;
    z = s.z;
  }
  s.dDeployed = true;
  s.dCtl = true;
  s.dx = x;
  s.dy = y;
  s.dz = z;
  s.dvx = 0;
  s.dvy = 0;
  s.dvz = 0;
  s.dhp = DRONE.hp;
}

export function droneTag(room: Room, p: Player): void {
  if (p.tagCd > 0) return;
  if (p.jammed) {
    room.msg('Signal jammed', p.id);
    return;
  }
  const s = p.state;
  const [dx, dy, dz] = look(p);
  let maxT = 40;
  if (room.world.raycast(s.dx, s.dy, s.dz, dx, dy, dz, maxT, hit, { seeThroughGlass: true })) maxT = hit.t;
  let target: Player | null = null;
  for (const o of room.players.values()) {
    if (o.team === p.team || !o.state.alive) continue;
    const os = o.state;
    const t = rayAabb(s.dx, s.dy, s.dz, dx, dy, dz, os.x - 0.4, os.y, os.z - 0.4, os.x + 0.4, os.y + 1.9, os.z + 0.4, maxT);
    if (t >= 0 && t < maxT) {
      maxT = t;
      target = o;
    }
  }
  p.tagCd = DRONE.tagCooldown;
  if (!target) return;
  target.tagUntil[p.team] = room.time + DRONE.tagDuration * 1000;
  for (const m of room.players.values()) {
    if (m.team === p.team && !m.isDummy) room.pushEvent(m.id, { k: 'tag', id: target.id });
  }
  room.sound('ping', target.state.x, target.state.y + 1, target.state.z, 4, p.id, p.team);
}

export function destroyDrone(room: Room, owner: Player, _killer: Player | null): void {
  const s = owner.state;
  if (!s.dDeployed) return;
  s.dDeployed = false;
  s.dCtl = false;
  s.dhp = 0;
  owner.droneCd = room.phase === PhaseId.PREP || room.sandbox ? 3 : DRONE.respawnCooldown;
  room.msg('Drone destroyed', owner.id);
  room.sound('metal', s.dx, s.dy, s.dz, 25, owner.id, owner.team);
  room.pub.push({ k: 'boom', x: s.dx, y: s.dy, z: s.dz, r: 0.6 });
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

export function cycleCamera(room: Room, p: Player): void {
  const s = p.state;
  if (!s.alive) return;
  const cams = p.cameras.filter((id) => room.entities.has(id));
  p.cameras = cams;
  if (!cams.length) {
    room.msg('No cameras placed', p.id);
    return;
  }
  const next = p.camIdx + 1;
  if (next >= cams.length) {
    exitCamera(room, p);
  } else {
    p.camIdx = next;
    s.cam = true;
    s.vx = 0;
    s.vz = 0;
  }
}

export function exitCamera(_room: Room, p: Player): void {
  p.camIdx = -1;
  p.state.cam = false;
}

// ---------------------------------------------------------------------------
// Per tick
// ---------------------------------------------------------------------------

export function updateGadgets(room: Room): void {
  const dt = SIM_DT;
  const now = room.time;
  const jammers: Entity[] = [];
  for (const e of room.entities.values()) if (e.kind === EntityKind.JAMMER) jammers.push(e);

  for (const p of room.players.values()) {
    if (p.isDummy) continue;
    if (p.gadgetCd > 0) p.gadgetCd = Math.max(0, p.gadgetCd - dt);
    if (p.droneCd > 0) p.droneCd = Math.max(0, p.droneCd - dt);
    if (p.tagCd > 0) p.tagCd = Math.max(0, p.tagCd - dt);
    const s = p.state;
    if (!s.alive) continue;

    if (p.healLeft > 0) {
      const h = Math.min(p.healLeft, p.healRate * dt);
      s.hp = Math.min(100 + (p.op === OperatorId.AEGIS ? 10 : 0), s.hp + h);
      p.healLeft -= h;
    }

    // jamming
    let jam = false;
    for (const j of jammers) {
      if (j.team === p.team) continue;
      if (Math.hypot(j.x - s.x, j.y - s.y - 1, j.z - s.z) <= GADGET.jammerRange) {
        jam = true;
        break;
      }
      if (s.dDeployed && Math.hypot(j.x - s.dx, j.y - s.dy, j.z - s.dz) <= GADGET.jammerRange) {
        jam = true;
        break;
      }
    }
    p.jammed = jam;
    if (jam && s.dDeployed) {
      // a jammed drone is held in place
      s.dx = p.dLastX;
      s.dy = p.dLastY;
      s.dz = p.dLastZ;
      s.dvx = 0;
      s.dvy = 0;
      s.dvz = 0;
    }
    p.dLastX = s.dx;
    p.dLastY = s.dy;
    p.dLastZ = s.dz;

    // pulse sensor
    if (p.sensorT > 0) {
      const before = p.sensorT;
      p.sensorT = Math.max(0, p.sensorT - dt);
      if (!p.jammed && Math.floor(before * 2) !== Math.floor(p.sensorT * 2)) {
        const pts: number[] = [];
        for (const o of room.players.values()) {
          if (o.team === p.team || !o.state.alive) continue;
          const d = Math.hypot(o.state.x - s.x, o.state.y - s.y, o.state.z - s.z);
          if (d > GADGET.sensorRange) continue;
          pts.push(
            Math.round((o.state.x + (room.rand() - 0.5) * 1.6) * 100) / 100,
            Math.round((o.state.y + 1.0) * 100) / 100,
            Math.round((o.state.z + (room.rand() - 0.5) * 1.6) * 100) / 100,
          );
        }
        room.pushEvent(p.id, { k: 'sense', pts });
      }
    }
  }

  // entity logic
  for (const e of [...room.entities.values()]) {
    if (e.kind === EntityKind.TRAP) {
      for (const o of room.players.values()) {
        if (o.team === e.team || !o.state.alive) continue;
        const os = o.state;
        if (Math.abs(os.x - e.x) < GADGET.trapRadius && Math.abs(os.z - e.z) < GADGET.trapRadius && Math.abs(os.y - e.y) < 0.5) {
          os.slow = GADGET.trapSlowTime;
          applyDamage(room, o, room.players.get(e.owner) ?? null, GADGET.trapDamage, false, 6);
          room.sound('trap', e.x, e.y, e.z, 30, e.owner, e.team);
          removeEntity(room, e);
          break;
        }
      }
    } else if (e.kind === EntityKind.CAMERA && now - e.lastCheck >= 250) {
      e.lastCheck = now;
      const fx = -Math.sin(e.a) * Math.cos(e.b);
      const fy = Math.sin(e.b);
      const fz = -Math.cos(e.a) * Math.cos(e.b);
      for (const o of room.players.values()) {
        if (o.team === e.team || !o.state.alive) continue;
        const os = o.state;
        const dx = os.x - e.x;
        const dy = os.y + 1.0 - e.y;
        const dz = os.z - e.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 25 || d < 0.1) continue;
        if ((dx * fx + dy * fy + dz * fz) / d < 0.5) continue;
        if (!room.world.lineOfSight(e.x, e.y, e.z, os.x, os.y + 1.0, os.z)) continue;
        o.tagUntil[e.team] = now + 1500;
      }
    }
  }
}
