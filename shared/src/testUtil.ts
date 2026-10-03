// Helpers for tests (also used by server tests).
import { SIM_DT } from './constants';
import { makeStepOut, stepPlayer, type StepOut } from './movement';
import { makeCmd, createPlayerState, quantizeCmd, type InputCmd, type PlayerState } from './types';
import { resetLoadout } from './weapons';
import type { World } from './world';

export function spawnState(x: number, y: number, z: number, yaw = 0, primary = 0): PlayerState {
  const s = createPlayerState();
  s.x = x;
  s.y = y;
  s.z = z;
  s.yaw = yaw;
  s.onGround = true;
  resetLoadout(s, primary);
  return s;
}

export interface RunOpts {
  moveX?: number;
  moveZ?: number;
  buttons?: number;
  yaw?: number;
  pitch?: number;
  slot?: number;
}

let seqCounter = 0;

export function cmdFor(s: PlayerState, o: RunOpts): InputCmd {
  const c = makeCmd();
  c.seq = ++seqCounter;
  c.moveX = o.moveX ?? 0;
  c.moveZ = o.moveZ ?? 0;
  c.buttons = o.buttons ?? 0;
  c.yaw = o.yaw ?? s.yaw;
  c.pitch = o.pitch ?? s.pitch;
  c.slot = o.slot ?? s.slot;
  return quantizeCmd(c);
}

/** Run n fixed steps with constant input. Returns the last StepOut and the count of fired shots. */
export function run(s: PlayerState, world: World, n: number, o: RunOpts, out: StepOut = makeStepOut()): { out: StepOut; shots: number } {
  let shots = 0;
  for (let i = 0; i < n; i++) {
    stepPlayer(s, cmdFor(s, o), world, SIM_DT, out);
    if (out.fired) shots++;
  }
  return { out, shots };
}
