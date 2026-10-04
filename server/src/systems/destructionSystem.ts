// Siege interactions: doors, reinforcement, barricades, and the sandbox debug commands.

import {
  BOMB, Btn, GADGET, HitKind, OperatorId, PhaseId, PLAYER, SIEGE, SIM_DT, eyeHeight, makeRayHit, operatorDef,
  type InputCmd, type RayHit, type StepOut,
} from '@holdfast/shared';
import type { Player } from '../Player';
import type { Room } from '../Room';
import { spawnRoundPlayer } from './roundSystem';
import { clearEntities } from './gadgetSystem';
import { canDefuse, canPlant, defuseBomb, plantBomb } from './bombSystem';

export const Act = { NONE: 0, REINFORCE: 1, BARRICADE: 2, PLANT: 3, DEFUSE: 4 } as const;
export const Prompt = { NONE: 0, OPEN: 1, CLOSE: 2, VAULT: 3, REINFORCE: 4, BARRICADE: 5, DETONATE: 6, PLANT: 7, DEFUSE: 8 } as const;

const hit: RayHit = makeRayHit();

interface HoldTarget {
  kind: number; // Act
  id: number; // panel id or opening id
}

function forward(p: Player): [number, number, number] {
  const s = p.state;
  const cp = Math.cos(s.pitch);
  return [-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp];
}

function reinforceAllowed(room: Room, p: Player): boolean {
  if (!room.canDefenderStuff(p) || p.reinf <= 0) return false;
  return room.sandbox || room.phase === PhaseId.PREP;
}

function barricadeAllowed(room: Room, p: Player): boolean {
  if (!room.canDefenderStuff(p)) return false;
  return room.sandbox || room.phase === PhaseId.PREP || room.phase === PhaseId.ACTION;
}

/** What would holding INTERACT start right now? */
function findHoldTarget(room: Room, p: Player): HoldTarget | null {
  if (canPlant(room, p)) return { kind: Act.PLANT, id: 0 };
  if (canDefuse(room, p)) return { kind: Act.DEFUSE, id: 0 };
  const s = p.state;
  const [dx, dy, dz] = forward(p);
  const ox = s.x;
  const oy = s.y + eyeHeight(s);
  const oz = s.z;
  if (room.world.raycast(ox, oy, oz, dx, dy, dz, SIEGE.reinforceReach, hit, { skipDyn: true })) {
    if (hit.kind === HitKind.CELL) {
      const panel = room.world.cellPanel[hit.id] as number;
      if (panel >= 0 && reinforceAllowed(room, p)) {
        const pn = room.world.panels[panel];
        if (pn && !pn.reinforced && room.world.panelIntact(panel)) return { kind: Act.REINFORCE, id: panel };
      }
      const opening = room.world.cellOpening[hit.id] as number;
      if (opening >= 0 && barricadeAllowed(room, p) && hit.t <= SIEGE.barricadeReach) {
        const op = room.world.openings[opening];
        if (op && op.barricadeHp <= 0) return { kind: Act.BARRICADE, id: opening };
      }
    } else if (hit.kind === HitKind.OPENING && hit.t <= SIEGE.barricadeReach && barricadeAllowed(room, p)) {
      const op = room.world.openings[hit.id];
      if (op && op.barricadeHp <= 0 && !op.destroyed) return { kind: Act.BARRICADE, id: hit.id };
    }
  }
  if (barricadeAllowed(room, p)) {
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const door = room.world.findOpeningNear(s.x, s.y, s.z, fx, fz, SIEGE.barricadeReach, 'door');
    if (door && door.barricadeHp <= 0 && !door.destroyed) return { kind: Act.BARRICADE, id: door.id };
  }
  return null;
}

function cancelAct(p: Player): void {
  p.actKind = Act.NONE;
  p.actT = 0;
  p.actTarget = -1;
}

export function actDuration(p: Player, kind: number): number {
  if (kind === Act.PLANT) return BOMB.plantTime;
  if (kind === Act.DEFUSE) return BOMB.defuseTime;
  const op = operatorDef(p.op);
  if (kind === Act.REINFORCE) return op.id === OperatorId.WARDEN ? SIEGE.reinforceTimeWarden : SIEGE.reinforceTime;
  return SIEGE.barricadeTime * op.buildTimeMul;
}

export function processInteract(room: Room, p: Player, cmd: InputCmd, out: StepOut): void {
  const s = p.state;
  if (!s.alive || s.dCtl || s.cam) {
    if (p.actKind) cancelAct(p);
    return;
  }
  const held = (cmd.buttons & Btn.INTERACT) !== 0;

  // tap: toggle a door
  if (out.tapUse && !out.vaultStarted) {
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const door = room.world.findOpeningNear(s.x, s.y, s.z, fx, fz, SIEGE.doorReach, 'door');
    if (door) {
      if (door.barricadeHp > 0) {
        room.sound('barricade', door.cx, s.y + 1, door.cz, 12, p.id, p.team);
      } else if (room.world.setDoorOpen(door.id, !door.open)) {
        room.sound('door', door.cx, s.y + 1, door.cz, 22, p.id, p.team);
      }
    }
  }

  // hold: reinforce or barricade
  if (held && s.useHeld >= PLAYER.useHoldStart && s.vault <= 0) {
    const speed = Math.hypot(s.vx, s.vz);
    const target = speed > 1.2 ? null : findHoldTarget(room, p);
    if (!target) {
      if (p.actKind) cancelAct(p);
      return;
    }
    const key = target.kind * 100000 + target.id;
    if (p.actKind !== target.kind || p.actTarget !== key) {
      p.actKind = target.kind;
      p.actTarget = key;
      p.actT = 0;
    }
    const need = actDuration(p, target.kind);
    const before = p.actT;
    p.actT += SIM_DT;
    if (Math.floor(before / 0.4) !== Math.floor(p.actT / 0.4)) {
      if (target.kind === Act.PLANT || target.kind === Act.DEFUSE) {
        room.sound('gadget', s.x, s.y + 0.4, s.z, 16, p.id, p.team);
      } else {
        const pos = target.kind === Act.REINFORCE ? room.world.panels[target.id] : room.world.openings[target.id];
        const px = pos ? (pos as { cx: number }).cx : s.x;
        const pz = pos ? (pos as { cz: number }).cz : s.z;
        room.sound(target.kind === Act.REINFORCE ? 'reinforce' : 'barricade', px, s.y + 1.2, pz, 22, p.id, p.team);
      }
    }
    if (p.actT >= need) {
      if (target.kind === Act.PLANT) {
        plantBomb(room, p);
      } else if (target.kind === Act.DEFUSE) {
        defuseBomb(room, p);
      } else if (target.kind === Act.REINFORCE) {
        if (room.world.reinforcePanel(target.id)) {
          p.reinf--;
          room.msg('Wall reinforced', p.id);
        }
      } else if (room.world.placeBarricade(target.id)) {
        room.msg('Barricade placed', p.id);
      }
      cancelAct(p);
    }
  } else if (p.actKind) {
    cancelAct(p);
  }
}

/** Contextual prompt for the HUD (computed at snapshot rate). */
export function computePrompt(room: Room, p: Player): number {
  const s = p.state;
  if (!s.alive || s.dCtl || s.cam || s.vault > 0) return Prompt.NONE;
  if (p.charges.length > 0) return Prompt.DETONATE;
  const hold = findHoldTarget(room, p);
  if (hold && hold.kind === Act.PLANT) return Prompt.PLANT;
  if (hold && hold.kind === Act.DEFUSE) return Prompt.DEFUSE;
  if (hold && hold.kind === Act.REINFORCE) return Prompt.REINFORCE;
  const fx = -Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  const door = room.world.findOpeningNear(s.x, s.y, s.z, fx, fz, SIEGE.doorReach, 'door');
  if (door && door.barricadeHp <= 0) return door.open ? Prompt.CLOSE : Prompt.OPEN;
  const vt = { x: 0, y: 0, z: 0 };
  if (s.onGround && room.world.findVault(s.x, s.y, s.z, s.yaw, vt)) return Prompt.VAULT;
  if (hold && hold.kind === Act.BARRICADE) return Prompt.BARRICADE;
  return Prompt.NONE;
}

// ---------------------------------------------------------------------------
// Sandbox debug commands
// ---------------------------------------------------------------------------

export function debugCommand(room: Room, p: Player, cmd: string): void {
  const s = p.state;
  const [dx, dy, dz] = forward(p);
  switch (cmd) {
    case 'breach': {
      if (!s.alive) return;
      if (room.world.raycast(s.x, s.y + eyeHeight(s), s.z, dx, dy, dz, 40, hit, { skipDyn: true })) {
        const c = GADGET.breachBox;
        const cx = hit.x - hit.nx * 0.4;
        const cy = hit.y - hit.ny * 0.4;
        const cz = hit.z - hit.nz * 0.4;
        room.world.destroyBox(
          { minX: cx - c.w / 2, maxX: cx + c.w / 2, minY: cy - 0.75, maxY: cy + 0.75, minZ: cz - c.d / 2, maxZ: cz + c.d / 2 },
          true,
        );
        room.pub.push({ k: 'boom', x: hit.x, y: hit.y, z: hit.z, r: 1.5 });
        room.sound('breach', hit.x, hit.y, hit.z, 80, p.id, p.team);
      }
      break;
    }
    case 'reinforce': {
      if (room.world.raycast(s.x, s.y + eyeHeight(s), s.z, dx, dy, dz, 12, hit, { skipDyn: true }) && hit.kind === HitKind.CELL) {
        const panel = room.world.cellPanel[hit.id] as number;
        if (panel >= 0 && room.world.reinforcePanel(panel)) room.msg('Panel reinforced');
      }
      break;
    }
    case 'reset':
      room.world.reset();
      clearEntities(room);
      room.broadcastPhase(true);
      room.msg('World reset');
      break;
    case 'refill':
      spawnRoundPlayer(room, p, true);
      break;
    case 'respawn':
      spawnRoundPlayer(room, p);
      break;
    case 'dummies':
      for (const o of room.players.values()) if (o.isDummy) spawnRoundPlayer(room, o);
      break;
    default:
      break;
  }
}
