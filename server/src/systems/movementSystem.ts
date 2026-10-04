// Drains each player's input queue through the shared deterministic step.

import { FALL, KillCause, SIM_DT, makeStepOut, stepPlayer, OperatorId, type InputCmd } from '@holdfast/shared';
import type { Room } from '../Room';
import type { Player } from '../Player';
import { applyDamage, melee, shoot } from './combatSystem';
import { processInteract } from './destructionSystem';
import { cycleCamera, destroyDrone, droneButton, droneTag, useGadget } from './gadgetSystem';
import { spawnRoundPlayer } from './roundSystem';

const out = makeStepOut();

export function processInputs(room: Room): void {
  for (const p of room.players.values()) {
    if (p.isDummy) {
      updateDummy(room, p);
      continue;
    }
    if (!p.connected) continue;
    if (p.meleeCd > 0) p.meleeCd = Math.max(0, p.meleeCd - SIM_DT);
    // Catch up gently when a burst arrived, never run more than two steps per tick (anti speedhack).
    const n = p.queue.length > 4 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const cmd = p.queue.shift();
      if (!cmd) break;
      applyCmd(room, p, cmd);
    }
    if (room.sandbox && !p.state.alive && p.respawnAt > 0 && room.time >= p.respawnAt) {
      p.respawnAt = 0;
      spawnRoundPlayer(room, p);
    }
  }
}

function applyCmd(room: Room, p: Player, cmd: InputCmd): void {
  const s = p.state;
  const wasAlive = s.alive;
  stepPlayer(s, cmd, room.world, SIM_DT, out);
  p.lastSeq = cmd.seq;
  p.lastCmdTime = cmd.clientTime;
  if (!wasAlive || !s.alive) return;
  if (out.landSpeed > FALL.safe) {
    applyDamage(room, p, null, Math.round((out.landSpeed - FALL.safe) * FALL.perMps), false, KillCause.FALL);
    if (!s.alive) return;
  }
  if (out.landSpeed > 3) room.sound('step', s.x, s.y + 0.1, s.z, 10, p.id, p.team);
  if (out.droneHop) room.sound('drone', s.dx, s.dy, s.dz, 6, p.id, p.team);
  if (s.dDeployed && s.dhp <= 0) destroyDrone(room, p, null); // a hard landing broke it

  const eyeY = s.y + (s.crouch ? 1.15 : 1.65);

  if (out.fired) shoot(room, p, out.shotIdx, out.weapon, cmd.clientTime, { yaw: out.aimYaw, pitch: out.aimPitch, spread: out.spread });
  if (out.reloadStarted) room.sound('reload', s.x, eyeY, s.z, 8, p.id, p.team);
  if (out.vaultStarted) room.sound('vault', s.x, s.y + 1, s.z, 10, p.id, p.team);

  processInteract(room, p, cmd, out);

  if (out.meleePressed && !s.dCtl && !s.cam && s.vault <= 0) melee(room, p);
  if (out.gadgetPressed && !s.dCtl && !s.cam && s.vault <= 0) useGadget(room, p);
  if (out.cameraPressed && !s.dCtl) cycleCamera(room, p);
  if (out.dronePressed) droneButton(room, p, out.droneToggled);
  if (s.dCtl && out.firePressed) droneTag(room, p);

  // footsteps (positional noise), sprinting is loud
  const speed = Math.hypot(s.vx, s.vz);
  if (s.onGround && !s.crouch && speed > 2.3 && s.vault <= 0 && !s.dCtl && !s.cam) {
    p.stepDist += speed * SIM_DT;
    const stride = s.sprint ? 1.7 : 1.4;
    if (p.stepDist >= stride) {
      p.stepDist = 0;
      let radius = s.sprint ? 8 : 4;
      if (p.op === OperatorId.SNARE) radius *= 0.5;
      room.sound('step', s.x, s.y + 0.1, s.z, radius, p.id, p.team);
    }
  } else if (speed < 0.5) {
    p.stepDist = 0;
  }
}

/** Dummies are stationary targets that respawn, used by Practice mode. */
function updateDummy(room: Room, p: Player): void {
  const s = p.state;
  if (!s.alive) {
    if (room.time >= p.respawnAt) spawnRoundPlayer(room, p);
    return;
  }
  if (room.time >= p.dummyToggleAt) {
    s.crouch = !s.crouch && room.rand() < 0.5;
    p.dummyToggleAt = room.time + 3000 + room.rand() * 4000;
  }
}
