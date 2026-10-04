// Phone controls: floating left stick, right side look drag and an action button cluster.
// Pointer events with per pointer tracking so multi touch works (move + look + fire at once).

import { Btn } from '@holdfast/shared';
import { settings } from '../settings';
import type { InputState } from './InputState';

type Mode = 'hold' | 'tap' | 'toggle';

interface BtnDef {
  id: string;
  label: string;
  btn: number;
  mode: Mode;
  cls: string;
  /** which context shows the button */
  ctx?: 'drone' | 'body';
}

const DEFS: BtnDef[] = [
  { id: 'fire', label: 'FIRE', btn: Btn.FIRE, mode: 'hold', cls: 't-fire' },
  { id: 'ads', label: 'AIM', btn: Btn.ADS, mode: 'toggle', cls: 't-ads', ctx: 'body' },
  { id: 'reload', label: 'RELOAD', btn: Btn.RELOAD, mode: 'tap', cls: 't-reload', ctx: 'body' },
  { id: 'crouch', label: 'CROUCH', btn: Btn.CROUCH, mode: 'toggle', cls: 't-crouch', ctx: 'body' },
  { id: 'use', label: 'USE', btn: Btn.INTERACT, mode: 'hold', cls: 't-use', ctx: 'body' },
  { id: 'melee', label: 'KICK', btn: Btn.MELEE, mode: 'tap', cls: 't-melee', ctx: 'body' },
  { id: 'gadget', label: 'GADGET', btn: Btn.GADGET, mode: 'tap', cls: 't-gadget', ctx: 'body' },
  { id: 'switch', label: 'SWAP', btn: 0, mode: 'tap', cls: 't-switch', ctx: 'body' },
  { id: 'drone', label: 'DRONE', btn: Btn.DRONE, mode: 'tap', cls: 't-drone' },
  { id: 'mark', label: 'PING', btn: 0, mode: 'tap', cls: 't-mark', ctx: 'body' },
  { id: 'nade', label: 'NADE', btn: Btn.THROW, mode: 'tap', cls: 't-nade', ctx: 'body' },
  { id: 'cam', label: 'CAM', btn: Btn.CAMERA, mode: 'tap', cls: 't-cam', ctx: 'body' },
  { id: 'leanl', label: 'LEAN', btn: Btn.LEAN_L, mode: 'toggle', cls: 't-leanl', ctx: 'body' },
  { id: 'leanr', label: 'LEAN', btn: Btn.LEAN_R, mode: 'toggle', cls: 't-leanr', ctx: 'body' },
  { id: 'up', label: 'HOP', btn: Btn.UP, mode: 'tap', cls: 't-up', ctx: 'drone' },
];

export interface TouchHooks {
  onScoreboard(show: boolean): void;
  onPause(): void;
  onMark(): void;
  haptic(ms: number): void;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private active = false;
  private stickPointer = -1;
  private stickOrigin = { x: 0, y: 0 };
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private lookPointer = -1;
  private lastLook = { x: 0, y: 0 };
  private firePointer = -1;
  private fireLast = { x: 0, y: 0 };
  private buttons = new Map<string, HTMLDivElement>();
  private toggled = new Set<string>();
  private gyroOn = false;
  private lastGyro = 0;

  constructor(private input: InputState, parent: HTMLElement, private hooks: TouchHooks) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'touch-root hidden';
    parent.appendChild(root);
    this.root = root;

    const moveZone = document.createElement('div');
    moveZone.className = 't-zone t-zone-move';
    const lookZone = document.createElement('div');
    lookZone.className = 't-zone t-zone-look';
    root.append(moveZone, lookZone);

    this.stickBase = document.createElement('div');
    this.stickBase.className = 't-stick-base hidden';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 't-stick-knob';
    this.stickBase.appendChild(this.stickKnob);
    root.appendChild(this.stickBase);

    moveZone.addEventListener('pointerdown', (e) => this.onStickDown(e, moveZone));
    moveZone.addEventListener('pointermove', (e) => this.onStickMove(e));
    moveZone.addEventListener('pointerup', (e) => this.onStickUp(e));
    moveZone.addEventListener('pointercancel', (e) => this.onStickUp(e));

    lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookPointer >= 0) return;
      this.lookPointer = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this.lastLook = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.input.lookDX += e.clientX - this.lastLook.x;
      this.input.lookDY += e.clientY - this.lastLook.y;
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e: PointerEvent): void => {
      if (e.pointerId === this.lookPointer) this.lookPointer = -1;
    };
    lookZone.addEventListener('pointerup', lookEnd);
    lookZone.addEventListener('pointercancel', lookEnd);

    for (const def of DEFS) this.makeButton(def);

    const sb = this.makeSmall('SCORE', 't-score', (down) => hooks.onScoreboard(down), true);
    const pause = this.makeSmall('II', 't-pause', (down) => down && hooks.onPause(), false);
    root.append(sb, pause);

    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applySettings();
  }

  private makeSmall(label: string, cls: string, cb: (down: boolean) => void, hold: boolean): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 't-small ' + cls;
    el.textContent = label;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      cb(true);
      e.preventDefault();
    });
    if (hold) {
      el.addEventListener('pointerup', () => cb(false));
      el.addEventListener('pointercancel', () => cb(false));
    }
    return el;
  }

  private makeButton(def: BtnDef): void {
    const el = document.createElement('div');
    el.className = 't-btn ' + def.cls;
    el.textContent = def.label;
    el.dataset['ctx'] = def.ctx ?? 'all';
    this.root.appendChild(el);
    this.buttons.set(def.id, el);
    const input = this.input;
    let pid = -1;

    const down = (e: PointerEvent): void => {
      if (pid >= 0) return;
      pid = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      this.hooks.haptic(8);
      e.preventDefault();
      if (def.id === 'switch') {
        input.slot = input.slot ? 0 : 1;
        return;
      }
      if (def.id === 'mark') {
        this.hooks.onMark();
        return;
      }
      switch (def.mode) {
        case 'hold':
          input.setHeld(def.btn, true);
          if (def.id === 'fire') {
            this.firePointer = e.pointerId;
            this.fireLast = { x: e.clientX, y: e.clientY };
          }
          break;
        case 'tap':
          input.tap(def.btn);
          break;
        case 'toggle':
          this.toggle(def);
          break;
      }
    };
    const move = (e: PointerEvent): void => {
      if (def.id === 'fire' && e.pointerId === this.firePointer) {
        input.lookDX += e.clientX - this.fireLast.x;
        input.lookDY += e.clientY - this.fireLast.y;
        this.fireLast = { x: e.clientX, y: e.clientY };
      }
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      pid = -1;
      el.classList.remove('down');
      if (def.mode === 'hold') input.setHeld(def.btn, false);
      if (def.id === 'fire') this.firePointer = -1;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private toggle(def: BtnDef): void {
    const on = !this.toggled.has(def.id);
    if (def.id === 'crouch') this.input.crouchToggle = on;
    else if (def.id === 'ads') this.input.adsToggle = on;
    else if (def.id === 'leanl' || def.id === 'leanr') {
      // tap to lean and stay, tap again to come back, tapping the other side switches over
      this.input.leanToggle = on ? def.btn : 0;
    }
    if (on) this.toggled.add(def.id);
    else this.toggled.delete(def.id);
    this.syncToggles();
  }

  /** Make the lit buttons match the input state (it is reset on death, round change and pause). */
  private syncToggles(): void {
    const inp = this.input;
    const state: Record<string, boolean> = {
      crouch: inp.crouchToggle,
      ads: inp.adsToggle,
      leanl: inp.leanToggle === Btn.LEAN_L,
      leanr: inp.leanToggle === Btn.LEAN_R,
    };
    for (const id of Object.keys(state)) {
      const on = state[id] === true;
      if (on) this.toggled.add(id);
      else this.toggled.delete(id);
      this.buttons.get(id)?.classList.toggle('on', on);
    }
  }

  /** Called by the game when sprint should flip (stick pushed fully). */
  private setSprint(on: boolean): void {
    this.input.sprintToggle = on;
  }

  private onStickDown(e: PointerEvent, zone: HTMLElement): void {
    if (this.stickPointer >= 0) return;
    this.stickPointer = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stickBase.style.left = e.clientX + 'px';
    this.stickBase.style.top = e.clientY + 'px';
    this.stickBase.classList.remove('hidden');
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
    e.preventDefault();
  }

  private onStickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    const radius = 56 * settings.touchScale;
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, radius);
    if (len > 0) {
      dx = (dx / len) * clamped;
      dy = (dy / len) * clamped;
    }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    let mx = dx / radius;
    let mz = -dy / radius;
    const mag = Math.hypot(mx, mz);
    if (mag < 0.12) {
      mx = 0;
      mz = 0;
    } else {
      const k = (mag - 0.12) / (1 - 0.12) / mag;
      mx *= k;
      mz *= k;
    }
    this.input.moveX = mx;
    this.input.moveZ = mz;
    // pushing the stick past its rim sprints
    this.setSprint(len > radius * 1.25 && mz > 0.6);
  }

  private onStickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = -1;
    this.stickBase.classList.add('hidden');
    this.input.moveX = 0;
    this.input.moveZ = 0;
    this.setSprint(false);
  }

  setActive(on: boolean): void {
    this.active = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.stickPointer = -1;
      this.lookPointer = -1;
      this.stickBase.classList.add('hidden');
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Update which buttons are visible for the current context. */
  setContext(inDrone: boolean, camCount: number, droneAllowed: boolean): void {
    this.syncToggles();
    for (const [id, el] of this.buttons) {
      const ctx = el.dataset['ctx'];
      let show = true;
      if (ctx === 'drone') show = inDrone;
      else if (ctx === 'body') show = !inDrone;
      if (id === 'cam') show = show && camCount > 0;
      if (id === 'drone') show = droneAllowed;
      el.classList.toggle('hidden', !show);
    }
  }

  applySettings(): void {
    this.root.style.setProperty('--tscale', String(settings.touchScale));
    this.root.classList.toggle('lefty', settings.leftHanded);
  }

  // ---- optional gyro aim (experimental) ----
  async enableGyro(): Promise<boolean> {
    try {
      const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
      if (DME && typeof DME.requestPermission === 'function') {
        const r = await DME.requestPermission();
        if (r !== 'granted') return false;
      }
      if (!this.gyroOn) {
        window.addEventListener('devicemotion', (e) => this.onMotion(e));
        this.gyroOn = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  private onMotion(e: DeviceMotionEvent): void {
    if (!settings.gyro || !this.active) return;
    const r = e.rotationRate;
    if (!r) return;
    const now = performance.now();
    const dt = this.lastGyro ? Math.min(0.05, (now - this.lastGyro) / 1000) : 0;
    this.lastGyro = now;
    const angle = (screen.orientation && screen.orientation.angle) || 0;
    // rates are in deg/s about the device axes: alpha=z, beta=x, gamma=y
    let yawRate = 0;
    let pitchRate = 0;
    if (angle === 90) { yawRate = (r.beta ?? 0); pitchRate = (r.alpha ?? 0); }
    else if (angle === 270) { yawRate = -(r.beta ?? 0); pitchRate = -(r.alpha ?? 0); }
    else { yawRate = -(r.alpha ?? 0); pitchRate = (r.beta ?? 0); }
    // convert degrees to touch units used by the look path (see Game.applyLook)
    this.input.lookDX -= yawRate * dt * 9;
    this.input.lookDY -= pitchRate * dt * 9;
  }
}
