// First person weapon model with bob, sway, recoil, per weapon reload animations, slide / bolt / pump
// motion, sprint pose and aim down sights lined up to the sight height of each gun.

import * as THREE from 'three';
import { clamp, weaponDef, type WeaponDef } from '@holdfast/shared';
import { box } from './geo';
import { buildGun, type GunModel } from './gunModels';

export interface VmInput {
  speed: number;
  /** 0 hip .. 1 fully aimed (the simulated value, so the model never gets ahead of the accuracy). */
  adsAmt: number;
  sprint: boolean;
  reloading: boolean;
  reloadProgress: number; // 0..1
  reloadTac: boolean;
  /** The gun is empty (the slide stays locked back). */
  empty: boolean;
  lookDX: number;
  lookDY: number;
  onGround: boolean;
  crouch: boolean;
}

interface ReloadPose {
  tiltX: number;
  tiltZ: number;
  dropY: number;
  magOffY: number;
  magVisible: boolean;
  hand: THREE.Vector3;
  slideBack: number;
}

const SCALE = 0.72;
const HIP = new THREE.Vector3(0.17, -0.165, -0.42);

function tintColor(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 255) * f);
  const g = Math.round(((color >> 8) & 255) * f);
  const b = Math.round((color & 255) * f);
  return (r << 16) | (g << 8) | b;
}

function tri(t: number): number {
  return 1 - Math.abs(2 * clamp(t, 0, 1) - 1);
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  private flash: THREE.Mesh;
  private flash2: THREE.Mesh;
  private model: GunModel | null = null;
  private def: WeaponDef = weaponDef(0);
  private weaponId = -1;
  private bob = 0;
  private breathe = 0;
  private kick = 0;
  private kickV = 0;
  private flashT = 0;
  private slideT = 0;
  private pumpAge = 99;
  private swayX = 0;
  private swayY = 0;
  private sprintT = 0;
  private switchT = 0;
  private meleeT = 0;
  private dip = 0;
  private lastGround = true;
  private reloadAnim = 0;
  private muzzle = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private accent = 0xff7a1a;
  private hands = new THREE.Group();
  private handR = new THREE.Group();
  private handL = new THREE.Group();
  private magRest = new THREE.Vector3();
  private slideRest = 0;
  private pumpRest = 0;
  private handLBase = new THREE.Vector3();
  private flashSize = 1;

  constructor(scene: THREE.Scene, accent: number) {
    this.root.add(this.gun);
    this.root.scale.setScalar(SCALE);
    const mat = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), mat());
    this.flash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), mat());
    this.flash.visible = false;
    this.flash2.visible = false;
    this.gun.add(this.hands);
    this.gun.add(this.flash, this.flash2);
    this.accent = accent;
    this.buildHands();
    scene.add(this.root);
    this.setWeapon(0);
  }

  private buildHands(): void {
    this.hands.clear();
    this.handR = new THREE.Group();
    this.handL = new THREE.Group();
    const sleeve = tintColor(this.accent, 0.42);
    const glove = 0x1c1f23;
    // right hand on the grip with a forearm running back and out of view
    this.handR.add(box(0.062, 0.07, 0.09, glove, 0, -0.04, 0.005));
    const armR = box(0.05, 0.05, 0.42, sleeve, 0.045, -0.12, 0.26);
    armR.rotation.set(0.5, 0.2, 0, 'YXZ');
    this.handR.add(armR);
    // left hand holds the front of the gun
    this.handL.add(box(0.07, 0.066, 0.1, glove, 0, 0, 0));
    const armL = box(0.05, 0.05, 0.5, sleeve, -0.07, -0.16, 0.3);
    armL.rotation.set(0.55, -0.32, 0, 'YXZ');
    this.handL.add(armL);
    this.hands.add(this.handR, this.handL);
  }

  setAccent(color: number): void {
    if (color === this.accent) return;
    this.accent = color;
    this.buildHands();
  }

  setWeapon(id: number): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.switchT = 1;
    this.pumpAge = 99;
    this.slideT = 0;
    if (this.model) this.gun.remove(this.model.group);
    const def = weaponDef(id);
    this.def = def;
    const m = buildGun(def);
    this.model = m;
    this.gun.add(m.group);
    this.flash.position.copy(m.muzzle);
    this.flash2.position.copy(m.muzzle);
    this.flashSize = def.suppressed ? 0.3 : def.kind === 'shotgun' ? 1.7 : def.kind === 'dmr' || def.kind === 'revolver' ? 1.4 : def.kind === 'lmg' ? 1.3 : 1;
    this.magRest.copy(m.mag ? m.mag.position : this.tmp.set(0, 0, 0));
    this.slideRest = m.slide ? m.slide.position.z : 0;
    this.pumpRest = m.pump ? m.pump.position.z : 0;
    this.handLBase.copy(m.leftHand);
    this.handR.position.set(0, 0, 0);
    this.handL.position.copy(m.leftHand);
  }

  /** Called when a shot goes off. */
  fire(def: WeaponDef): void {
    this.kickV += 3 + def.kickPitch * 120;
    this.flashT = def.suppressed ? 0.035 : 0.05;
    this.slideT = 1;
    if (def.kind === 'shotgun') this.pumpAge = 0;
  }

  meleeSwing(): void {
    this.meleeT = 0.3;
  }

  /** Muzzle position in camera space (the tracer starts here). */
  muzzleLocal(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.flash.getWorldPosition(this.muzzle));
  }

  /** Ejection port position in camera space. */
  ejectLocal(out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0.1, -0.1, -0.4);
    out.copy(this.model.eject);
    return this.gun.localToWorld(out);
  }

  /** Where a spent shell starts and which way it flies, in camera space. */
  ejectDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0.7 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, 0.2 + Math.random() * 0.3);
  }

  private reloadPose(p: number, tac: boolean, out: ReloadPose): void {
    const m = this.model;
    const kind = this.def.kind;
    out.tiltX = 0; out.tiltZ = 0; out.dropY = 0; out.magOffY = 0; out.magVisible = true; out.slideBack = 0;
    out.hand.set(0, 0, 0);
    if (!m) return;
    if (kind === 'shotgun') {
      // one shell per cycle: tip the gun, push a shell into the gate with the left hand
      const q = p;
      out.tiltX = 0.25 * tri(q * 1.2);
      out.tiltZ = -0.35 * tri(q * 1.2);
      out.hand.set(0.05 * tri(q), -0.1 * tri(q), 0.2 * tri(q));
      return;
    }
    if (kind === 'revolver') {
      out.tiltZ = 0.7 * tri(clamp(p * 1.1, 0, 1));
      out.tiltX = 0.25 * tri(clamp(p * 1.1, 0, 1));
      out.hand.set(0.03, -0.09 * tri(p), 0.12 * tri(p));
      return;
    }
    // magazine guns
    const rise = clamp(p / 0.15, 0, 1) - clamp((p - 0.8) / 0.2, 0, 1);
    out.tiltX = 0.22 * rise;
    out.tiltZ = -0.3 * rise;
    out.dropY = 0.02 * rise;
    // left hand goes to the magazine well, pulls the mag, fetches a new one, seats it
    const toMag = m.mag ? m.mag.position : this.magRest;
    const base = this.handLBase;
    const hx = toMag.x - base.x;
    const hy = toMag.y - 0.02 - base.y;
    const hz = toMag.z - base.z;
    let w = 0; // 0 hand on the foregrip .. 1 hand at the magazine
    if (p < 0.15) w = p / 0.15;
    else if (p < 0.4) w = 1;
    else if (p < 0.5) w = 1 - (p - 0.4) / 0.1 * 0.2;
    else if (p < 0.75) w = 0.8 + (p - 0.5) / 0.25 * 0.2;
    else w = 1 - clamp((p - 0.75) / 0.12, 0, 1);
    out.hand.set(hx * w, hy * w, hz * w);
    if (p >= 0.4 && p < 0.5) out.hand.y -= 0.11 * tri((p - 0.4) / 0.1);
    // magazine: drops out, then a new one comes up from below
    if (p < 0.18) out.magOffY = 0;
    else if (p < 0.4) { out.magOffY = -0.32 * ((p - 0.18) / 0.22); out.magVisible = p < 0.34; }
    else if (p < 0.55) { out.magVisible = false; out.magOffY = -0.32; }
    else if (p < 0.75) { out.magOffY = -0.32 * (1 - (p - 0.55) / 0.2); }
    else out.magOffY = 0;
    if (!tac && p > 0.78 && p < 0.95) out.slideBack = tri((p - 0.78) / 0.17);
  }

  private rp: ReloadPose = { tiltX: 0, tiltZ: 0, dropY: 0, magOffY: 0, magVisible: true, hand: new THREE.Vector3(), slideBack: 0 };

  update(dt: number, i: VmInput, visible: boolean): void {
    this.root.visible = visible;
    const m = this.model;
    if (!visible || !m) return;
    // springs
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.kickV += (-this.kick * 220 - this.kickV * 18) * h;
      this.kick += this.kickV * h;
    }
    const k = i.adsAmt;
    this.sprintT += ((i.sprint ? 1 : 0) - this.sprintT) * Math.min(1, dt * 9);
    this.switchT = Math.max(0, this.switchT - dt * (this.def.drawTime > 0 ? 1 / Math.max(0.2, this.def.drawTime) : 4));
    if (this.meleeT > 0) this.meleeT = Math.max(0, this.meleeT - dt);
    this.slideT = Math.max(0, this.slideT - dt * 12);
    this.pumpAge += dt;
    if (i.onGround && !this.lastGround) this.dip = 0.05;
    this.lastGround = i.onGround;
    this.dip = Math.max(0, this.dip - dt * 0.3);

    const moving = i.speed > 0.4 && i.onGround;
    this.bob += dt * (moving ? 5 + i.speed * 1.4 : 0);
    this.breathe += dt;
    const bobAmt = moving ? (1 - 0.85 * k) * Math.min(1, i.speed / 3.4) : 0;
    const bx = Math.sin(this.bob) * 0.012 * bobAmt;
    const by = Math.abs(Math.cos(this.bob)) * 0.014 * bobAmt + Math.sin(this.breathe * 1.4) * 0.0012 * (1 - 0.7 * k);

    this.swayX += (-i.lookDX * 0.0006 * (1 - 0.6 * k) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (i.lookDY * 0.0006 * (1 - 0.6 * k) - this.swayY) * Math.min(1, dt * 10);

    // reload pose, eased
    const rp = this.rp;
    if (i.reloading) this.reloadPose(clamp(i.reloadProgress, 0, 1), i.reloadTac, rp);
    else {
      rp.tiltX = 0; rp.tiltZ = 0; rp.dropY = 0; rp.magOffY = 0; rp.magVisible = true; rp.slideBack = 0; rp.hand.set(0, 0, 0);
    }
    this.reloadAnim += ((i.reloading ? 1 : 0) - this.reloadAnim) * Math.min(1, dt * 14);

    // placement: hip to the sights, where the sight line of this gun sits on the screen center
    const adsY = -m.sightY * SCALE - 0.004;
    const adsX = 0;
    const adsZ = -0.34;
    const x = HIP.x + (adsX - HIP.x) * k + bx + this.swayX;
    const y = HIP.y + (adsY - HIP.y) * k - by + this.swayY - this.reloadAnim * 0.05 - rp.dropY - this.switchT * 0.3 - this.dip - (i.crouch ? 0.008 : 0);
    const z = HIP.z + (adsZ - HIP.z) * k + this.kick * 0.07 + (this.meleeT > 0 ? -Math.sin((this.meleeT / 0.3) * Math.PI) * 0.18 : 0);
    this.root.position.set(x, y, z);
    this.gun.rotation.set(
      this.kick * 0.55 + rp.tiltX - this.sprintT * 0.35 + this.switchT * 0.7 + (this.meleeT > 0 ? Math.sin((this.meleeT / 0.3) * Math.PI) * 0.6 : 0),
      this.sprintT * 0.6 - this.swayX * 1.5,
      this.sprintT * -0.25 + rp.tiltZ + this.swayX * 2,
    );

    // animated parts
    if (m.mag) {
      m.mag.visible = rp.magVisible;
      m.mag.position.y = this.magRest.y + rp.magOffY;
    }
    if (m.slide) {
      const locked = i.empty && !i.reloading ? 1 : 0;
      const back = Math.max(this.slideT, locked, rp.slideBack);
      m.slide.position.z = this.slideRest + m.travel * back;
    }
    if (m.pump) {
      // pump the forend back and forth after each shot
      const t = (this.pumpAge - 0.14) / 0.34;
      const pz = this.pumpAge > 0.14 && this.pumpAge < 0.48 ? tri(t) : 0;
      m.pump.position.z = this.pumpRest + m.travel * pz;
      rp.hand.z += m.travel * pz;
    }
    if (m.cylinder) m.cylinder.rotation.z += dt * (i.reloading ? 6 : 0);

    // hands follow the gun: right on the grip, left on the foregrip (or the magazine while reloading)
    this.handL.position.set(this.handLBase.x + rp.hand.x, this.handLBase.y + rp.hand.y, this.handLBase.z + rp.hand.z);

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash2.visible = true;
      this.flash.rotation.z = Math.random() * 6;
      this.flash2.rotation.set(0, Math.PI / 2, Math.random() * 6);
      const j = 0.75 + Math.random() * 0.5;
      this.flash.scale.setScalar(this.flashSize * j);
      this.flash2.scale.setScalar(this.flashSize * 0.8 * j);
    } else {
      this.flash.visible = false;
      this.flash2.visible = false;
    }
  }
}
