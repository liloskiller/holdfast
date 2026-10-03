// Client side prediction and server reconciliation for the local player.

import {
  SIM_DT, copyPlayerState, createPlayerState, makeStepOut, stateFromArray, stepPlayer,
  type InputCmd, type PlayerState, type StepOut, type World,
} from '@holdfast/shared';

export class Prediction {
  state: PlayerState = createPlayerState();
  /** State before the latest step, used for render interpolation. */
  prev: PlayerState = createPlayerState();
  pending: InputCmd[] = [];
  /** Visual correction that decays to zero after a reconciliation. */
  offX = 0;
  offY = 0;
  offZ = 0;
  lastError = 0;
  private scratch: PlayerState = createPlayerState();
  private replayOut: StepOut = makeStepOut();
  private initialised = false;

  get ready(): boolean {
    return this.initialised;
  }

  reset(): void {
    this.pending.length = 0;
    this.initialised = false;
    this.offX = this.offY = this.offZ = 0;
  }

  /** Advance the predicted state by one command. */
  step(cmd: InputCmd, world: World, out: StepOut): void {
    copyPlayerState(this.prev, this.state);
    stepPlayer(this.state, cmd, world, SIM_DT, out);
    this.pending.push(cmd);
    if (this.pending.length > 120) this.pending.shift();
  }

  /** Apply an authoritative state and replay unacknowledged commands. Returns the correction distance. */
  reconcile(auth: readonly number[], ack: number, world: World): number {
    if (!this.initialised) {
      stateFromArray(auth, this.state);
      copyPlayerState(this.prev, this.state);
      this.pending = this.pending.filter((c) => c.seq > ack);
      this.initialised = true;
      return 0;
    }
    const ox = this.state.x;
    const oy = this.state.y;
    const oz = this.state.z;
    this.pending = this.pending.filter((c) => c.seq > ack);
    const s = stateFromArray(auth, this.scratch);
    for (const c of this.pending) stepPlayer(s, c, world, SIM_DT, this.replayOut);
    const err = Math.hypot(s.x - ox, s.y - oy, s.z - oz);
    this.lastError = err;
    copyPlayerState(this.state, s);
    if (err > 0.5) {
      this.offX = this.offY = this.offZ = 0;
      copyPlayerState(this.prev, this.state);
    } else if (err > 0.02) {
      this.offX += ox - s.x;
      this.offY += oy - s.y;
      this.offZ += oz - s.z;
    }
    return err;
  }

  /** Decay the visual correction (call once per rendered frame). */
  decay(dt: number): void {
    const k = Math.exp(-dt / 0.045);
    this.offX *= k;
    this.offY *= k;
    this.offZ *= k;
    if (Math.abs(this.offX) < 1e-4) this.offX = 0;
    if (Math.abs(this.offY) < 1e-4) this.offY = 0;
    if (Math.abs(this.offZ) < 1e-4) this.offZ = 0;
  }
}
