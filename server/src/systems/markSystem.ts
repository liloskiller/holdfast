// Team markers: mark the spot (or the enemy) in the middle of the screen, only teammates are told.

import { DRONE, PhaseId, eyeHeight, makeRayHit, rayAabb, type RayHit } from '@holdfast/shared';
import type { Player } from '../Player';
import type { Room } from '../Room';

const hit: RayHit = makeRayHit();
const MAX_DIST = 90;
const COOLDOWN_MS = 700;

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function markSpot(room: Room, p: Player): void {
  const s = p.state;
  if (!s.alive || room.time < p.markAt) return;
  if (room.phase !== PhaseId.PREP && room.phase !== PhaseId.ACTION && !room.sandbox) return;
  // from the eyes, or from the camera of the drone while piloting it
  const ox = s.dCtl ? s.dx : s.x;
  const oy = s.dCtl ? s.dy + DRONE.camUp : s.y + eyeHeight(s);
  const oz = s.dCtl ? s.dz : s.z;
  const cp = Math.cos(s.pitch);
  const dx = -Math.sin(s.yaw) * cp;
  const dy = Math.sin(s.pitch);
  const dz = -Math.cos(s.yaw) * cp;

  let t = MAX_DIST;
  let found = false;
  if (room.world.raycast(ox, oy, oz, dx, dy, dz, MAX_DIST, hit, { seeThroughGlass: true, skipDyn: true })) {
    t = hit.t - 0.05;
    found = true;
  }
  // the ground of the first floor is not a solid in the voxel grid
  if (dy < -1e-4 && oy > 0 && room.world.floorOf(oy) === 0) {
    const tg = oy / -dy;
    if (tg < t) {
      t = tg;
      found = true;
    }
  }
  let enemy = false;
  for (const o of room.players.values()) {
    if (o.team === p.team || !o.state.alive || o.isDummy && !room.sandbox) continue;
    const os = o.state;
    const top = os.crouch ? 1.3 : 1.85;
    const d = rayAabb(ox, oy, oz, dx, dy, dz, os.x - 0.4, os.y, os.z - 0.4, os.x + 0.4, os.y + top, os.z + 0.4, t);
    if (d >= 0 && d < t) {
      t = d;
      enemy = true;
      found = true;
    }
  }
  if (!found) {
    room.msg('Nothing to mark', p.id);
    return;
  }
  p.markAt = room.time + COOLDOWN_MS;
  const ev = { k: 'mark' as const, id: p.id, x: r2(ox + dx * t), y: r2(oy + dy * t), z: r2(oz + dz * t), enemy };
  for (const m of room.players.values()) {
    if (m.team === p.team && !m.isDummy) room.pushEvent(m.id, ev);
  }
}
