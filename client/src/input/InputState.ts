// Unified input struct. Keyboard/mouse and touch both write into this; the game samples it
// once per fixed simulation step.

import { Btn } from '@holdfast/shared';

export class InputState {
  moveX = 0;
  moveZ = 0;
  yaw = 0;
  pitch = 0;
  /** Buttons currently held. */
  held = 0;
  /** Buttons that were tapped since the last sample; guarantees a press edge even for very short taps. */
  pulse = 0;
  slot = 0;
  crouchToggle = false;
  sprintToggle = false;
  adsToggle = false;
  /** Lean latched by the touch buttons: 0, Btn.LEAN_L or Btn.LEAN_R. Tap once to lean, tap again to stop. */
  leanToggle = 0;
  /** Raw look deltas in pixels (or touch units), consumed by the game each frame. */
  lookDX = 0;
  lookDY = 0;
  /** Set by the touch layer while it is the active input source. */
  usingTouch = false;
  /** Gameplay context so inputs can map differently while piloting a drone. */
  inDrone = false;

  tap(btn: number): void {
    this.pulse |= btn;
  }

  setHeld(btn: number, down: boolean): void {
    if (down) {
      if ((this.held & btn) === 0) this.pulse |= btn;
      this.held |= btn;
    } else {
      this.held &= ~btn;
    }
  }

  /** Compose the button mask for the next command and clear one-shot pulses. */
  sampleButtons(): number {
    let b = this.held | this.pulse;
    if (this.crouchToggle) b |= Btn.CROUCH;
    if (this.sprintToggle) b |= Btn.SPRINT;
    if (this.adsToggle) b |= Btn.ADS;
    b |= this.leanToggle;
    this.pulse = 0;
    return b;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  reset(): void {
    this.moveX = 0;
    this.moveZ = 0;
    this.held = 0;
    this.pulse = 0;
    this.crouchToggle = false;
    this.sprintToggle = false;
    this.adsToggle = false;
    this.leanToggle = 0;
    this.lookDX = 0;
    this.lookDY = 0;
  }
}
