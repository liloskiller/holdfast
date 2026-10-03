// First person weapon model with bob, sway, recoil, reload dip, sprint tilt and ADS.

import * as THREE from 'three';
import { weaponDef } from '@holdfast/shared';
import { box } from './geo';

export interface VmInput {
  speed: number;
  ads: boolean;
  sprint: boolean;
  reloading: boolean;
  reloadProgress: number; // 0..1
  lookDX: number;
  lookDY: number;
  onGround: boolean;
  crouch: boolean;
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  private flash: THREE.Mesh;
  private weaponId = -1;
  private bob = 0;
  private kick = 0;
  private kickV = 0;
  private flashT = 0;
  private swayX = 0;
  private swayY = 0;
  private adsT = 0;
  private sprintT = 0;
  private switchT = 0;
  private meleeT = 0;
  private reloadAnim = 0;
  private muzzle = new THREE.Vector3();

  constructor(scene: THREE.Scene, accent: number) {
    this.root.add(this.gun);
    this.root.scale.setScalar(0.72);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 0.11),
      new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
    this.gun.add(this.flash);
    // hands: gloves in the team accent
    this.setAccent(accent);
    scene.add(this.root);
    this.setWeapon(0);
  }

  private hands: THREE.Object3D[] = [];

  setAccent(color: number): void {
    for (const h of this.hands) this.gun.remove(h);
    this.hands = [box(0.07, 0.07, 0.11, color, 0.0, -0.065, -0.05), box(0.07, 0.07, 0.1, color, 0.0, -0.05, -0.28)];
    for (const h of this.hands) this.gun.add(h);
  }

  setWeapon(id: number): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.switchT = 1;
    for (const c of this.gun.children.slice()) {
      if (c !== this.flash && !this.hands.includes(c)) this.gun.remove(c);
    }
    const def = weaponDef(id);
    const len = def.length;
    const body = box(0.055, 0.085, len, def.color, 0, 0, -len / 2);
    const barrel = box(0.028, 0.028, len * 0.35, 0x15171a, 0, 0.012, -len - len * 0.12);
    const mag = box(0.04, 0.13, 0.06, 0x202328, 0, -0.1, -len * 0.45);
    const sight = box(0.02, 0.03, 0.04, 0x0e0e0e, 0, 0.06, -len * 0.7);
    const stock = box(0.05, 0.08, len * 0.3, def.color, 0, -0.01, len * 0.12);
    this.gun.add(body, barrel, mag, sight, stock);
    this.flash.position.set(0, 0.012, -len - len * 0.32);
  }

  fire(recoilPitch: number): void {
    this.kickV += 3.2 + recoilPitch * 90;
    this.flashT = 0.05;
  }

  meleeSwing(): void {
    this.meleeT = 0.3;
  }

  /** Approximate muzzle position in camera space (for tracer starts). */
  muzzleLocal(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.flash.getWorldPosition(this.muzzle));
  }

  update(dt: number, i: VmInput, visible: boolean): void {
    this.root.visible = visible;
    if (!visible) return;
    // springs
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.kickV += (-this.kick * 220 - this.kickV * 18) * h;
      this.kick += this.kickV * h;
    }
    this.adsT += ((i.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    this.sprintT += ((i.sprint ? 1 : 0) - this.sprintT) * Math.min(1, dt * 9);
    this.switchT = Math.max(0, this.switchT - dt * 4);
    if (this.meleeT > 0) this.meleeT = Math.max(0, this.meleeT - dt);

    const moving = i.speed > 0.4 && i.onGround;
    this.bob += dt * (moving ? 5 + i.speed * 1.4 : 1.2);
    const bobAmt = moving ? (i.ads ? 0.15 : 1) * Math.min(1, i.speed / 3.4) : 0.15;
    const bx = Math.sin(this.bob) * 0.012 * bobAmt;
    const by = Math.abs(Math.cos(this.bob)) * 0.014 * bobAmt;

    this.swayX += (-i.lookDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (i.lookDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);

    const reload = i.reloading ? Math.sin(Math.min(1, i.reloadProgress) * Math.PI) : 0;
    this.reloadAnim += (reload - this.reloadAnim) * Math.min(1, dt * 12);

    const hipX = 0.17;
    const hipY = -0.17;
    const hipZ = -0.4;
    const adsX = 0.0;
    const adsY = -0.105;
    const adsZ = -0.32;
    const k = this.adsT;
    const x = hipX + (adsX - hipX) * k + bx + this.swayX;
    const y = hipY + (adsY - hipY) * k - by + this.swayY - this.reloadAnim * 0.12 - this.switchT * 0.25 - (i.crouch ? 0.01 : 0);
    const z = hipZ + (adsZ - hipZ) * k + this.kick * 0.06 + (this.meleeT > 0 ? -Math.sin((this.meleeT / 0.3) * Math.PI) * 0.18 : 0);
    this.root.position.set(x, y, z);
    this.gun.rotation.set(
      this.kick * 0.5 + this.reloadAnim * 0.9 - this.sprintT * 0.35 + this.switchT * 0.6 + (this.meleeT > 0 ? Math.sin((this.meleeT / 0.3) * Math.PI) * 0.6 : 0),
      this.sprintT * 0.6 - this.swayX * 1.5,
      this.sprintT * -0.25 + this.reloadAnim * 0.5 + this.swayX * 2,
    );

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.rotation.z = Math.random() * 6;
      this.flash.scale.setScalar(0.6 + Math.random() * 0.6);
    } else {
      this.flash.visible = false;
    }
  }
}
