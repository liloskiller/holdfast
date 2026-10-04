// Gamepad support (standard mapping: Xbox / PlayStation / most Bluetooth pads). Writes into the same
// InputState as the keyboard and the touch layer, so everything downstream is unchanged.
//
//   left stick move, L3 sprint (toggle), right stick look, RT fire, LT aim, A use (and drone hop),
//   B crouch (toggle), X reload, Y swap weapon, LB / RB lean, R3 kick, D-pad up gadget, down drone,
//   left camera, Back scoreboard (hold), Start pause.

import { Btn } from '@holdfast/shared';
import { settings } from '../settings';
import type { InputState } from './InputState';

const DEAD = 0.17;
const LOOK_PX_PER_S = 1500;
const TRIGGER = 0.3;

export interface PadHooks {
  onPause(): void;
  onScoreboard(show: boolean): void;
  /** Called once the first time the pad is actually used, so the UI can stop asking for a mouse click. */
  onUsed(): void;
}

function shape(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  const n = (a - DEAD) / (1 - DEAD);
  return Math.sign(v) * n;
}

export class GamepadControls {
  /** True after the pad was used at least once. */
  used = false;
  private prev: boolean[] = [];
  private held = 0;
  private moving = false;
  private looking = false;

  constructor(private input: InputState, private hooks: PadHooks) {}

  private find(): Gamepad | null {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected && (p.mapping === 'standard' || p.buttons.length >= 16)) return p;
    } catch {
      /* some browsers throw outside secure contexts */
    }
    return null;
  }

  /** Set or clear a held button, remembering which ones this controller owns. */
  private hold(btn: number, down: boolean): void {
    if (down) {
      if ((this.held & btn) === 0) this.input.setHeld(btn, true);
      this.held |= btn;
    } else if (this.held & btn) {
      this.input.setHeld(btn, false);
      this.held &= ~btn;
    }
  }

  private releaseAll(): void {
    for (const b of Object.values(Btn)) this.hold(b, false);
    if (this.moving) {
      this.input.moveX = 0;
      this.input.moveZ = 0;
      this.moving = false;
    }
  }

  /** Read the pad. `enabled` is false in menus and while paused (then only Start works). */
  poll(dt: number, enabled: boolean): void {
    const pad = this.find();
    if (!pad) {
      this.releaseAll();
      this.prev = [];
      return;
    }
    const cur: boolean[] = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i: number): boolean => !!cur[i] && !this.prev[i];
    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    const any = cur.some(Boolean) || Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > 0.4 || Math.hypot(pad.axes[2] ?? 0, pad.axes[3] ?? 0) > 0.4;
    if (any && !this.used) {
      this.used = true;
      this.hooks.onUsed();
    }
    if (edge(9)) this.hooks.onPause();
    if (!enabled) {
      this.releaseAll();
      this.prev = cur;
      return;
    }

    const inp = this.input;
    // move
    const lx = shape(pad.axes[0] ?? 0);
    const ly = shape(pad.axes[1] ?? 0);
    if (lx !== 0 || ly !== 0) {
      inp.moveX = lx;
      inp.moveZ = -ly;
      this.moving = true;
    } else if (this.moving) {
      inp.moveX = 0;
      inp.moveZ = 0;
      this.moving = false;
    }
    // look (rate based, with a curve so small pushes are precise)
    const rx = shape(pad.axes[2] ?? 0);
    const ry = shape(pad.axes[3] ?? 0);
    if (rx !== 0 || ry !== 0) {
      const k = LOOK_PX_PER_S * dt;
      inp.lookDX += Math.sign(rx) * rx * rx * k + rx * k * 0.3;
      inp.lookDY += Math.sign(ry) * ry * ry * k + ry * k * 0.3;
      this.looking = true;
    } else {
      this.looking = false;
    }

    // triggers and face buttons
    this.hold(Btn.FIRE, rt > TRIGGER);
    if (settings.adsToggle) {
      if (lt > TRIGGER && !(this.prev[6] ?? false)) inp.adsToggle = !inp.adsToggle;
    } else {
      this.hold(Btn.ADS, lt > TRIGGER);
    }
    this.hold(Btn.INTERACT, !!cur[0]);
    this.hold(Btn.UP, !!cur[0]); // A also hops the drone
    if (edge(1)) inp.crouchToggle = !inp.crouchToggle;
    this.hold(Btn.RELOAD, !!cur[2]);
    if (edge(3)) inp.slot = inp.slot ? 0 : 1;
    this.hold(Btn.LEAN_L, !!cur[4]);
    this.hold(Btn.LEAN_R, !!cur[5]);
    if (edge(10)) inp.sprintToggle = !inp.sprintToggle;
    if (edge(11)) inp.tap(Btn.MELEE);
    this.hold(Btn.GADGET, !!cur[12]);
    if (edge(13)) inp.tap(Btn.DRONE);
    if (edge(14)) inp.tap(Btn.CAMERA);
    if (edge(15)) inp.tap(Btn.THROW);
    if (edge(8)) this.hooks.onScoreboard(true);
    else if (!cur[8] && this.prev[8]) this.hooks.onScoreboard(false);

    this.prev = cur;
  }

  /** For tests. */
  get isLooking(): boolean {
    return this.looking;
  }
}
