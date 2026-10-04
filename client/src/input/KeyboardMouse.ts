// Desktop controls: WASD + mouse with Pointer Lock.

import { Btn } from '@holdfast/shared';
import { settings } from '../settings';
import type { InputState } from './InputState';

export interface KeyboardHooks {
  onScoreboard(show: boolean): void;
  onPause(): void;
  onDebug(cmd: string): void;
  onLockChange(locked: boolean): void;
  onSpectate(dir: number): void;
}

export class KeyboardMouse {
  private keys = new Set<string>();
  private enabled = false;
  private locked = false;
  /** ?nolock lets automated tests drive the game without a real pointer lock. */
  private forceLock = new URLSearchParams(location.search).has('nolock');

  constructor(private input: InputState, private canvas: HTMLElement, private hooks: KeyboardHooks) {
    document.addEventListener('keydown', (e) => this.onKey(e, true));
    document.addEventListener('keyup', (e) => this.onKey(e, false));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => this.onMouse(e, true));
    document.addEventListener('mouseup', (e) => this.onMouse(e, false));
    document.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
      this.hooks.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.releaseAll();
  }

  get isLocked(): boolean {
    return this.locked || this.forceLock;
  }

  requestLock(): void {
    if (this.forceLock) return;
    try {
      const p = (this.canvas as HTMLElement & { requestPointerLock(): Promise<void> | void }).requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private releaseAll(): void {
    this.keys.clear();
    this.input.moveX = 0;
    this.input.moveZ = 0;
    this.input.held = 0;
  }

  private updateMove(): void {
    const k = this.keys;
    this.input.moveX = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.input.moveZ = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    const code = e.code;
    if (e.repeat) {
      if (code !== 'F5') e.preventDefault();
      return;
    }
    if (code === 'Tab') {
      e.preventDefault();
      this.hooks.onScoreboard(down);
      return;
    }
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    const inp = this.input;
    switch (code) {
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD':
        this.updateMove();
        break;
      case 'ShiftLeft': case 'ShiftRight':
        inp.setHeld(Btn.SPRINT, down);
        break;
      case 'KeyC':
        if (down) inp.crouchToggle = !inp.crouchToggle;
        break;
      case 'ControlLeft': case 'ControlRight':
        inp.setHeld(Btn.CROUCH, down);
        e.preventDefault();
        break;
      case 'Space':
        inp.setHeld(Btn.UP, down);
        e.preventDefault();
        break;
      case 'KeyE': inp.setHeld(Btn.INTERACT, down); break;
      case 'KeyR': inp.setHeld(Btn.RELOAD, down); break;
      case 'KeyF': inp.setHeld(Btn.GADGET, down); break;
      case 'KeyV': inp.setHeld(Btn.MELEE, down); break;
      case 'KeyX': inp.setHeld(Btn.DRONE, down); break;
      case 'KeyZ': inp.setHeld(Btn.CAMERA, down); break;
      case 'Digit1': if (down) inp.slot = 0; break;
      case 'Digit2': if (down) inp.slot = 1; break;
      case 'KeyQ': if (down) inp.slot = inp.slot ? 0 : 1; break;
      case 'KeyB': if (down) this.hooks.onDebug('breach'); break;
      case 'KeyN': if (down) this.hooks.onDebug('reinforce'); break;
      case 'KeyM': if (down) this.hooks.onDebug('reset'); break;
      case 'KeyK': if (down) this.hooks.onDebug('refill'); break;
      case 'ArrowLeft': if (down) this.hooks.onSpectate(-1); break;
      case 'ArrowRight': if (down) this.hooks.onSpectate(1); break;
      case 'Escape':
        if (down) this.hooks.onPause();
        break;
      default:
        return;
    }
    if (code !== 'Escape') e.preventDefault();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.enabled || !this.isLocked) return;
    this.input.lookDX += e.movementX;
    this.input.lookDY += e.movementY;
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    if (!this.enabled) return;
    if (!this.isLocked) return;
    if (e.button === 0) this.input.setHeld(Btn.FIRE, down);
    else if (e.button === 2) {
      if (settings.adsToggle) {
        if (down) this.input.adsToggle = !this.input.adsToggle;
      } else {
        this.input.setHeld(Btn.ADS, down);
      }
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.enabled || !this.isLocked) return;
    if (e.deltaY !== 0) this.input.slot = this.input.slot ? 0 : 1;
  }
}
