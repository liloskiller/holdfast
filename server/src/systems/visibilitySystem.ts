// Builds each recipient's snapshot. Enemy positions are only included when the recipient can
// legitimately know them (line of sight, tag, or very close), which also cuts bandwidth.

import {
  DRONE, EntityKind, NET, PFlag, stateToArray, makeExtra, eyeHeight, PhaseId,
  type EntitySnap, type GameEvent, type PlayerSnap, type SelfExtra, type Snapshot, type WorldDiff,
} from '@holdfast/shared';
import type { Player } from '../Player';
import type { Room } from '../Room';
import { computePrompt } from './destructionSystem';

const HYST_MS = NET.visibilityHysteresis * 1000;
const DRONE_ID_BASE = 100000;

interface Eye {
  x: number;
  y: number;
  z: number;
}

/** The player whose view this recipient is seeing (themself, or a spectated teammate). */
function viewTarget(room: Room, viewer: Player): Player {
  if (!viewer.state.alive && viewer.spec) {
    const t = room.players.get(viewer.spec);
    if (t && t.state.alive) return t;
  }
  return viewer;
}

function eyeOf(room: Room, p: Player): Eye {
  const s = p.state;
  if (s.dCtl) return { x: s.dx, y: s.dy + DRONE.camUp, z: s.dz };
  if (s.cam && p.camIdx >= 0) {
    const e = room.entities.get(p.cameras[p.camIdx] ?? -1);
    if (e) return { x: e.x, y: e.y, z: e.z };
  }
  return { x: s.x, y: s.y + eyeHeight(s), z: s.z };
}

function canSeePlayer(room: Room, eye: Eye, o: Player): boolean {
  const s = o.state;
  const h = eyeHeight(s);
  const w = room.world;
  return (
    w.lineOfSight(eye.x, eye.y, eye.z, s.x, s.y + h - 0.1, s.z) ||
    w.lineOfSight(eye.x, eye.y, eye.z, s.x, s.y + h * 0.55, s.z) ||
    w.lineOfSight(eye.x, eye.y, eye.z, s.x, s.y + 0.25, s.z)
  );
}

function flagsOf(room: Room, o: Player, viewerTeam: number): number {
  const s = o.state;
  let f = 0;
  if (s.crouch) f |= PFlag.CROUCH;
  if (s.alive) f |= PFlag.ALIVE;
  if (s.sprint) f |= PFlag.SPRINT;
  if (s.vault > 0) f |= PFlag.VAULT;
  if (s.ads) f |= PFlag.ADS;
  if (o.team !== viewerTeam && o.isTaggedFor(viewerTeam, room.time)) f |= PFlag.TAGGED;
  if (s.dCtl) f |= PFlag.DRONE;
  if (s.reloading) f |= PFlag.RELOAD;
  return f;
}

function jitter(room: Room, v: number, amount: number): number {
  return v + (room.rand() - 0.5) * 2 * amount;
}

export function buildSnapshot(room: Room, viewer: Player, diff: WorldDiff | null): Snapshot {
  const now = room.time;
  const vt = viewTarget(room, viewer);
  const eye = eyeOf(room, vt);
  const team = vt.team;
  const all = room.debugNoVisibility;

  // ---- players ----
  const players: PlayerSnap[] = [];
  for (const o of room.players.values()) {
    if (o === viewer || !o.state.alive) continue;
    const s = o.state;
    let include = false;
    if (o.team === team) {
      include = true;
    } else if (all || o.isTaggedFor(team, now)) {
      include = true;
    } else {
      const dx = s.x - eye.x;
      const dz = s.z - eye.z;
      const dy = s.y - eye.y;
      if (dx * dx + dz * dz + dy * dy < 2.25) {
        include = true;
      } else if (canSeePlayer(room, eye, o)) {
        viewer.seen.set(o.id, now);
        include = true;
      } else {
        const last = viewer.seen.get(o.id);
        include = last !== undefined && now - last < HYST_MS;
      }
    }
    if (!include) continue;
    players.push({
      id: o.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch,
      flags: flagsOf(room, o, team),
      weapon: s.slot === 0 ? s.w0 : s.w1,
      hp: o.team === team ? Math.round(s.hp) : 0,
    });
  }

  // ---- entities ----
  const entities: EntitySnap[] = [];
  for (const e of room.entities.values()) {
    let include = e.team === team;
    if (!include && e.kind !== EntityKind.TRAP) {
      const key = 1e6 + e.id;
      if (all || room.world.lineOfSight(eye.x, eye.y, eye.z, e.x, e.y + 0.1, e.z)) {
        viewer.seen.set(key, now);
        include = true;
      } else {
        const last = viewer.seen.get(key);
        include = last !== undefined && now - last < HYST_MS;
      }
    }
    if (!include) continue;
    entities.push({
      id: e.id, kind: e.kind, team: e.team, owner: e.owner, x: e.x, y: e.y, z: e.z,
      a: e.a, hp: e.hp, b: e.kind === EntityKind.CAMERA ? e.b : e.kind === EntityKind.BREACH ? Math.atan2(e.nx, e.nz) : 0,
    });
  }
  for (const o of room.players.values()) {
    const s = o.state;
    if (!s.dDeployed) continue;
    let include = o.team === team;
    if (!include) {
      const key = 2e6 + o.id;
      if (all || room.world.lineOfSight(eye.x, eye.y, eye.z, s.dx, s.dy, s.dz)) {
        viewer.seen.set(key, now);
        include = true;
      } else {
        const last = viewer.seen.get(key);
        include = last !== undefined && now - last < HYST_MS;
      }
    }
    if (!include) continue;
    if (o === viewer && s.dCtl) {
      // own drone is part of the predicted self state, still list it so the model can be drawn
    }
    entities.push({
      id: DRONE_ID_BASE + o.id, kind: EntityKind.DRONE, team: o.team, owner: o.id,
      x: s.dx, y: s.dy, z: s.dz, a: s.yaw, hp: s.dhp, b: s.dCtl ? 1 : 0,
    });
  }

  // ---- events ----
  const events: GameEvent[] = [];
  for (const ev of room.pub) events.push(ev);
  const mine = room.priv.get(viewer.id);
  if (mine) for (const ev of mine) events.push(ev);

  for (const sh of room.shots) {
    const dx = sh.x - eye.x;
    const dy = sh.y - eye.y;
    const dz = sh.z - eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    let visible = sh.team === team || sh.src === viewer.id || all || d2 < 16;
    if (!visible) visible = room.world.lineOfSight(eye.x, eye.y, eye.z, sh.x, sh.y, sh.z);
    if (!visible) {
      for (let i = 0; i + 3 < sh.ends.length && !visible; i += 4) {
        visible = room.world.lineOfSight(eye.x, eye.y, eye.z, sh.ends[i] as number, sh.ends[i + 1] as number, sh.ends[i + 2] as number);
      }
    }
    if (visible) {
      events.push(sh.ev);
    } else if (d2 < 60 * 60) {
      events.push({ k: 'snd', s: 'shot', x: jitter(room, sh.x, 1.5), y: sh.y, z: jitter(room, sh.z, 1.5), v: 60, src: sh.src, exact: false });
    }
  }
  for (const sn of room.sounds) {
    if (sn.s === 'shot') continue; // shots are handled above
    const dx = sn.x - eye.x;
    const dy = sn.y - eye.y;
    const dz = sn.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > sn.radius) continue;
    let exact = sn.team === team || sn.src === viewer.id || all || d < 3;
    if (!exact) exact = room.world.lineOfSight(eye.x, eye.y, eye.z, sn.x, sn.y, sn.z);
    events.push({
      k: 'snd', s: sn.s,
      x: exact ? sn.x : jitter(room, sn.x, 1.2), y: sn.y, z: exact ? sn.z : jitter(room, sn.z, 1.2),
      v: sn.radius, src: sn.src, exact,
    });
  }

  // ---- self extra ----
  const extra: SelfExtra = makeExtra();
  extra.reinf = viewer.reinf;
  extra.gadget = viewer.gadgetUses;
  extra.gadgetCd = viewer.gadgetCd;
  extra.droneCd = viewer.droneCd;
  extra.tagCd = viewer.tagCd;
  extra.spec = viewer.state.alive ? 0 : vt.id === viewer.id ? 0 : vt.id;
  extra.op = viewer.op;
  extra.sensorT = viewer.sensorT;
  extra.charges = viewer.charges.length;
  extra.camIdx = viewer.camIdx;
  extra.camCount = viewer.cameras.length;
  extra.jam = viewer.jammed ? 1 : 0;
  extra.cap = room.capture;
  if (viewer.actKind) {
    extra.act = viewer.actKind;
    const need = viewer.actKind === 1 ? (viewer.op === 4 ? 1.5 : 2.0) : 1.2;
    extra.actP = Math.min(1, viewer.actT / need);
  }
  if (viewer.state.alive && room.phase !== PhaseId.LOBBY) {
    viewer.prompt = computePrompt(room, viewer);
    extra.prompt = viewer.prompt;
  }

  return {
    tick: room.tick,
    time: room.time,
    ack: viewer.lastSeq,
    self: stateToArray(viewer.state),
    extra,
    players,
    entities,
    world: diff,
    events,
  };
}
