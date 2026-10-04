// Bomb mode: attackers plant the defuser on the site, defenders disable it before it goes off.

import { BOMB, BombState, EntityKind, FLOOR_H, GameMode, KillCause, PhaseId, type ObjectiveSite } from '@holdfast/shared';
import type { Player } from '../Player';
import type { Room } from '../Room';
import { applyDamage } from './combatSystem';
import { removeEntity, spawnEntity } from './gadgetSystem';

export function isBombMode(room: Room): boolean {
  return room.settings.mode === GameMode.BOMB;
}

export function bombSite(room: Room): ObjectiveSite | undefined {
  return room.map.objectives[room.objectiveIdx];
}

export function inBombSite(room: Room, p: Player): boolean {
  const site = bombSite(room);
  if (!site) return false;
  const s = p.state;
  return s.x >= site.minX && s.x <= site.maxX && s.z >= site.minZ && s.z <= site.maxZ && s.y >= site.y - 0.3 && s.y <= site.y + FLOOR_H - 0.5;
}

/** Can this player start planting right now? */
export function canPlant(room: Room, p: Player): boolean {
  return isBombMode(room) && room.phase === PhaseId.ACTION && room.bomb.state === BombState.NONE && p.state.alive &&
    p.team === room.attackerTeam && inBombSite(room, p);
}

/** Can this player start disabling the defuser right now? */
export function canDefuse(room: Room, p: Player): boolean {
  if (!isBombMode(room) || room.phase !== PhaseId.ACTION || room.bomb.state !== BombState.PLANTED) return false;
  if (!p.state.alive || p.team === room.attackerTeam) return false;
  const s = p.state;
  return Math.hypot(s.x - room.bomb.x, s.z - room.bomb.z) <= BOMB.defuseReach && Math.abs(s.y - room.bomb.y) < 1.5;
}

export function resetBomb(room: Room): void {
  room.bomb.state = BombState.NONE;
  room.bomb.entity = -1;
  room.bomb.nextBeep = 0;
}

export function plantBomb(room: Room, p: Player): void {
  if (!canPlant(room, p)) return;
  const s = p.state;
  // set down just in front of the planter's feet
  const x = s.x - Math.sin(s.yaw) * 0.5;
  const z = s.z - Math.cos(s.yaw) * 0.5;
  const e = spawnEntity(room, {
    kind: EntityKind.BOMB, owner: p, x, y: s.y, z, hp: 0,
    box: { minX: x - 0.2, maxX: x + 0.2, minY: s.y, maxY: s.y + 0.3, minZ: z - 0.2, maxZ: z + 0.2 },
  });
  room.bomb.state = BombState.PLANTED;
  room.bomb.x = x;
  room.bomb.y = s.y;
  room.bomb.z = z;
  room.bomb.entity = e.id;
  room.bomb.nextBeep = room.time;
  p.objTime += 5;
  // the round clock becomes the fuse
  room.phaseEndsAt = room.time + BOMB.timer * 1000;
  room.overtime = false;
  room.msg('Defuser planted! Defenders, disable it');
  room.sound('gadget', x, s.y + 0.3, z, 30, p.id, p.team);
  room.broadcastPhase();
}

export function defuseBomb(room: Room, p: Player): void {
  if (!canDefuse(room, p)) return;
  room.bomb.state = BombState.DEFUSED;
  const e = room.entities.get(room.bomb.entity);
  if (e) removeEntity(room, e);
  p.objTime += 5;
  room.msg('Defuser disabled');
  room.sound('gadget', room.bomb.x, room.bomb.y + 0.3, room.bomb.z, 30, p.id, p.team);
  room.broadcastPhase();
}

/** Beeps faster as the fuse runs down, and the blast itself. Called every tick during the action phase. */
export function updateBomb(room: Room): void {
  if (room.bomb.state !== BombState.PLANTED) return;
  const left = (room.phaseEndsAt - room.time) / 1000;
  if (room.time >= room.bomb.nextBeep) {
    room.sound('beep', room.bomb.x, room.bomb.y + 0.3, room.bomb.z, 28, 0, -1);
    room.bomb.nextBeep = room.time + (left > 10 ? 1000 : left > 5 ? 500 : 250);
  }
  if (left > 0) return;
  explode(room);
}

function explode(room: Room): void {
  const b = room.bomb;
  b.state = BombState.EXPLODED;
  const e = room.entities.get(b.entity);
  if (e) removeEntity(room, e);
  const cy = b.y + 0.4;
  room.world.explode(b.x, cy, b.z, BOMB.radius, 160);
  room.pub.push({ k: 'boom', x: b.x, y: cy, z: b.z, r: BOMB.radius });
  room.sound('breach', b.x, cy, b.z, 100, 0, -1);
  for (const o of room.players.values()) {
    if (!o.state.alive) continue;
    const os = o.state;
    const d = Math.hypot(os.x - b.x, os.y + 1 - cy, os.z - b.z);
    if (d > BOMB.radius) continue;
    if (d > 1 && !room.world.lineOfSight(b.x, cy, b.z, os.x, os.y + 1, os.z)) continue;
    applyDamage(room, o, null, Math.round(BOMB.damage * (1 - d / BOMB.radius)), false, KillCause.BOMB);
  }
}
