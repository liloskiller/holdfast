// Hitscan with server side lag compensation, damage, melee and death.

import {
  DRONE, HITBOX, HitKind, KillCause, MAX_PELLETS, MaterialId, NET, PLAYER, SIEGE, buildShotRays, buildShotRaysFromState, damageFor, leanVec,
  eyeHeight, makeRayHit, operatorDef, rayAabb, raySphere, weaponDef,
  type RayHit,
} from '@holdfast/shared';
import type { Entity, Rewound } from '../Player';
import { Player } from '../Player';
import type { Room } from '../Room';
import { destroyDrone, exitCamera, removeEntity } from './gadgetSystem';

const rays = new Float64Array(MAX_PELLETS * 3);
const hit: RayHit = makeRayHit();
const tmpRew: Rewound = { x: 0, y: 0, z: 0, crouch: false, lean: 0, yaw: 0 };
const leanTmp = { x: 0, y: 0, z: 0 };

interface PlayerTarget {
  p: Player;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  /** Head shift caused by leaning (the shoulders move about a third as far). */
  hx: number;
  hy: number;
  hz: number;
}

interface Pending {
  p: Player;
  dmg: number;
  head: boolean;
}

/** The aim a shot was fired with: view angles including recoil, and the spread cone at that moment. */
export interface ShotAim {
  yaw: number;
  pitch: number;
  spread: number;
}

const RANGE = 160;

/** Resolve a fired shot: lag compensated player hits, current world state for walls. */
export function shoot(room: Room, shooter: Player, shotIdx: number, weaponId: number, clientTime: number, aim?: ShotAim): void {
  const def = weaponDef(weaponId);
  const s = shooter.state;
  // shots start at the (possibly leaned) eye
  const lv = leanVec(s.yaw, s.lean, leanTmp);
  const ox = s.x + lv.x;
  const oy = s.y + eyeHeight(s) + lv.y;
  const oz = s.z + lv.z;
  if (aim) buildShotRays(aim.yaw, aim.pitch, aim.spread, shooter.id, shotIdx, def, rays);
  else buildShotRaysFromState(s, shooter.id, shotIdx, def, rays);

  // rewind time: the shooter sees others `interpDelay` in the past
  let tr = room.time;
  if (clientTime > 0 && clientTime <= room.time + 60 && clientTime > room.time - 1000) {
    tr = Math.min(room.time, Math.max(room.time - NET.lagCompMaxMs, clientTime - NET.interpDelayMs));
  }

  // candidate player targets at the rewound time
  const targets: PlayerTarget[] = [];
  for (const o of room.players.values()) {
    if (o === shooter || !o.state.alive) continue;
    if (o.team === shooter.team && !room.settings.friendlyFire) continue;
    o.rewind(tr, tmpRew);
    const tl = leanVec(tmpRew.yaw, tmpRew.lean, leanTmp);
    targets.push({ p: o, x: tmpRew.x, y: tmpRew.y, z: tmpRew.z, crouch: tmpRew.crouch, hx: tl.x, hy: tl.y, hz: tl.z });
  }

  const pending = new Map<number, Pending>();
  const ends: number[] = [];
  const soundDone = new Set<string>();

  for (let pi = 0; pi < def.pellets; pi++) {
    const dx = rays[pi * 3] as number;
    const dy = rays[pi * 3 + 1] as number;
    const dz = rays[pi * 3 + 2] as number;
    let cx = ox;
    let cy = oy;
    let cz = oz;
    let travelled = 0;
    let mul = 1;
    let walls = 0;
    let endKind = 0;
    let ex = ox + dx * 2;
    let ey = oy + dy * 2;
    let ez = oz + dz * 2;
    for (let iter = 0; iter < 4; iter++) {
      const remaining = RANGE - travelled;
      if (remaining <= 0) break;
      const worldHit = room.world.raycast(cx, cy, cz, dx, dy, dz, remaining, hit);
      const worldT = worldHit ? hit.t : remaining;

      // nearest player / drone / entity in front of the world hit
      let bestT = worldT;
      let bestPlayer: PlayerTarget | null = null;
      let bestHead = false;
      let bestLeg = false;
      let bestDrone: Player | null = null;
      let bestEntity: Entity | null = null;
      for (const t of targets) {
        const eye = t.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
        const th = raySphere(cx, cy, cz, dx, dy, dz, t.x + t.hx, t.y + t.hy + eye - HITBOX.headDropFromEye, t.z + t.hz, HITBOX.headRadius, bestT);
        const bx = t.x + t.hx * 0.3;
        const bz = t.z + t.hz * 0.3;
        const tb = rayAabb(
          cx, cy, cz, dx, dy, dz,
          bx - HITBOX.bodyHalf, t.y, bz - HITBOX.bodyHalf,
          bx + HITBOX.bodyHalf, t.y + eye - HITBOX.bodyTopFromEye, bz + HITBOX.bodyHalf, bestT,
        );
        if (th >= 0 && th <= bestT && (tb < 0 || th <= tb + 0.02)) {
          bestT = th; bestPlayer = t; bestHead = true; bestLeg = false; bestDrone = null; bestEntity = null;
        } else if (tb >= 0 && tb < bestT) {
          bestT = tb; bestPlayer = t; bestHead = false; bestDrone = null; bestEntity = null;
          bestLeg = cy + dy * tb - t.y < (t.crouch ? HITBOX.legTopCrouch : HITBOX.legTopStand);
        }
      }
      for (const o of room.players.values()) {
        if (o.team === shooter.team || !o.state.dDeployed) continue;
        const td = raySphere(cx, cy, cz, dx, dy, dz, o.state.dx, o.state.dy, o.state.dz, DRONE.hitRadius, bestT);
        if (td >= 0 && td < bestT) {
          bestT = td; bestPlayer = null; bestDrone = o; bestEntity = null;
        }
      }
      for (const e of room.entities.values()) {
        if (e.hp <= 0 || e.team === shooter.team || e.dynId >= 0) continue;
        const te = rayAabb(cx, cy, cz, dx, dy, dz, e.box.minX, e.box.minY, e.box.minZ, e.box.maxX, e.box.maxY, e.box.maxZ, bestT);
        if (te >= 0 && te < bestT) {
          bestT = te; bestPlayer = null; bestDrone = null; bestEntity = e;
        }
      }

      if (bestPlayer || bestDrone || bestEntity) {
        ex = cx + dx * bestT;
        ey = cy + dy * bestT;
        ez = cz + dz * bestT;
        endKind = 2;
        if (bestPlayer) {
          const dist = travelled + bestT;
          const dmg = damageFor(def, dist, bestHead, mul * (bestLeg ? HITBOX.legMul : 1));
          const cur = pending.get(bestPlayer.p.id);
          if (cur) {
            cur.dmg += dmg;
            cur.head = cur.head || bestHead;
          } else {
            pending.set(bestPlayer.p.id, { p: bestPlayer.p, dmg, head: bestHead });
          }
        } else if (bestDrone) {
          bestDrone.state.dhp -= damageFor(def, travelled + bestT, false, mul);
          room.sound('metal', ex, ey, ez, 20, shooter.id, shooter.team);
          if (bestDrone.state.dhp <= 0) destroyDrone(room, bestDrone, shooter);
        } else if (bestEntity) {
          damageEntity(room, bestEntity, damageFor(def, travelled + bestT, false, mul));
        }
        break;
      }

      if (!worldHit) {
        ex = cx + dx * remaining;
        ey = cy + dy * remaining;
        ez = cz + dz * remaining;
        endKind = 0;
        break;
      }

      // world interaction
      ex = hit.x;
      ey = hit.y;
      ez = hit.z;
      endKind = 1;
      let penetrate = false;
      let skip = 0.02;
      if (hit.kind === HitKind.CELL) {
        const id = hit.id;
        const mat = room.world.materialOf(id);
        const reinforced = room.world.cellReinf[id] === 1;
        if (mat === MaterialId.GLASS) {
          const destroyed = room.world.damageCell(id, 100);
          if (destroyed && !soundDone.has('g' + id)) {
            soundDone.add('g' + id);
            room.sound('glass', hit.x, hit.y, hit.z, 25, shooter.id, shooter.team);
          }
          penetrate = true;
        } else if (!reinforced) {
          const destroyed = room.world.damageCell(id, def.wallDamage);
          if (destroyed) {
            room.sound('wall', hit.x, hit.y, hit.z, 30, shooter.id, shooter.team);
            skip = 0.02;
          }
          if (SIEGE.penetrationEnabled && room.world.isSoftMaterial(mat) && walls < SIEGE.penetrationMaxWalls) {
            penetrate = true;
            walls++;
            mul *= def.pen;
            if (!destroyed) skip = 0.55;
          }
        } else if (!soundDone.has('m')) {
          soundDone.add('m');
          room.sound('metal', hit.x, hit.y, hit.z, 25, shooter.id, shooter.team);
        }
      } else if (hit.kind === HitKind.OPENING) {
        const broke = room.world.damageOpeningAt(hit.id, hit.sub, hit.x, hit.y, hit.z, def.wallDamage, SIEGE.bulletPlankRadius);
        if (!soundDone.has('b' + hit.id)) {
          soundDone.add('b' + hit.id);
          room.sound(broke ? 'wall' : 'barricade', hit.x, hit.y, hit.z, 25, shooter.id, shooter.team);
        }
      } else if (hit.kind === HitKind.DYN) {
        const e = [...room.entities.values()].find((en) => en.dynId === hit.id);
        if (e) damageEntity(room, e, damageFor(def, travelled + hit.t, false, mul));
      }

      if (!penetrate) break;
      travelled += hit.t + skip;
      cx = hit.x + dx * skip;
      cy = hit.y + dy * skip;
      cz = hit.z + dz * skip;
    }
    ends.push(round2(ex), round2(ey), round2(ez), endKind);
  }

  // apply aggregated damage per victim
  for (const pd of pending.values()) {
    const dmg = Math.round(pd.dmg);
    const killed = applyDamage(room, pd.p, shooter, dmg, pd.head, weaponId);
    room.pushEvent(shooter.id, { k: 'hit', head: pd.head, kill: killed, dmg });
  }

  const ev = { k: 'shot' as const, id: shooter.id, w: weaponId, ox: round2(ox), oy: round2(oy), oz: round2(oz), ends };
  room.shots.push({ src: shooter.id, team: shooter.team, ev, x: ox, y: oy, z: oz, ends });
  room.sound('shot', ox, oy, oz, def.loudness, shooter.id, shooter.team);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Apply damage to a player. Returns true if it killed them. */
export function applyDamage(room: Room, victim: Player, attacker: Player | null, dmg: number, head: boolean, weaponId: number): boolean {
  const s = victim.state;
  if (!s.alive || dmg <= 0) return false;
  s.hp -= dmg;
  victim.lastDamageFrom = attacker?.id ?? 0;
  if (s.cam) exitCamera(room, victim);
  if (attacker) {
    const dx = attacker.state.x - s.x;
    const dz = attacker.state.z - s.z;
    const l = Math.hypot(dx, dz) || 1;
    room.pushEvent(victim.id, { k: 'hurt', dx: round2(dx / l), dz: round2(dz / l), dmg });
  } else {
    room.pushEvent(victim.id, { k: 'hurt', dx: 0, dz: 0, dmg });
  }
  if (s.hp <= 0) {
    killPlayer(room, victim, attacker, weaponId, head);
    return true;
  }
  return false;
}

export function killPlayer(room: Room, victim: Player, killer: Player | null, weaponId: number, head: boolean): void {
  const s = victim.state;
  if (!s.alive) return;
  s.alive = false;
  s.hp = 0;
  s.dCtl = false;
  s.dDeployed = false;
  s.cam = false;
  s.ads = false;
  victim.camIdx = -1;
  victim.deaths++;
  if (killer && killer.id !== victim.id) killer.kills++;
  victim.actKind = 0;
  victim.healLeft = 0;
  victim.sensorT = 0;
  room.pub.push({ k: 'kill', killer: killer ? killer.id : 0, victim: victim.id, w: weaponId, head });
  if (room.sandbox || victim.isDummy) victim.respawnAt = room.time + 3000;
  // pick a teammate to spectate
  victim.spec = 0;
  room.cycleSpectate(victim, 1);
  for (const o of room.players.values()) {
    if (!o.state.alive && o.spec === victim.id) {
      o.spec = 0;
      room.cycleSpectate(o, 1);
    }
  }
  room.markRoomDirty();
}

/** Damage a placed gadget. */
export function damageEntity(room: Room, e: Entity, dmg: number): void {
  if (e.hp <= 0 && e.maxHp <= 0) return;
  e.hp -= dmg;
  if (e.hp <= 0) {
    room.sound('metal', e.x, e.y, e.z, 25, e.owner, e.team);
    removeEntity(room, e);
  }
}

/** Melee: players first, then barricades and doors. */
export function melee(room: Room, p: Player): void {
  if (p.meleeCd > 0) return;
  p.meleeCd = SIEGE.meleeCooldown;
  const s = p.state;
  const eye = eyeHeight(s);
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  room.pub.push({ k: 'melee', id: p.id });
  room.sound('melee', s.x, s.y + 1, s.z, 12, p.id, p.team);

  let best: Player | null = null;
  let bestD = SIEGE.meleeRange + PLAYER.radius;
  for (const o of room.players.values()) {
    if (o === p || !o.state.alive || (o.team === p.team && !room.settings.friendlyFire)) continue;
    const dx = o.state.x - s.x;
    const dz = o.state.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(o.state.y - s.y) > 1.2) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.55) continue;
    if (!room.world.lineOfSight(s.x, s.y + eye, s.z, o.state.x, o.state.y + 1.0, o.state.z)) continue;
    best = o;
    bestD = d;
  }
  if (best) {
    const killed = applyDamage(room, best, p, SIEGE.meleeDamage, false, KillCause.MELEE);
    room.pushEvent(p.id, { k: 'hit', head: false, kill: killed, dmg: SIEGE.meleeDamage });
    return;
  }

  const cp = Math.cos(s.pitch);
  const dx = fx * cp;
  const dy = Math.sin(s.pitch);
  const dz = fz * cp;
  if (room.world.raycast(s.x, s.y + eye, s.z, dx, dy, dz, SIEGE.meleeRange + 0.4, hit)) {
    const mul = operatorDef(p.op).meleeStructureMul;
    if (hit.kind === HitKind.OPENING) {
      const broke = room.world.damageOpeningAt(hit.id, hit.sub, hit.x, hit.y, hit.z, SIEGE.meleeBarricadeDamage * mul, SIEGE.meleePlankRadius);
      room.sound(broke ? 'wall' : 'barricade', hit.x, hit.y, hit.z, 30, p.id, p.team);
    } else if (hit.kind === HitKind.DYN) {
      const e = [...room.entities.values()].find((en) => en.dynId === hit.id);
      if (e) damageEntity(room, e, SIEGE.meleeDamage);
    } else if (hit.kind === HitKind.CELL && room.world.materialOf(hit.id) === MaterialId.GLASS) {
      if (room.world.damageCell(hit.id, 100)) room.sound('glass', hit.x, hit.y, hit.z, 25, p.id, p.team);
    }
  }
}

