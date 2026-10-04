// Remote player model: a blocky robot soldier with a team colored chest stripe, a blob shadow,
// a name tag for teammates and a see-through outline when tagged.

import * as THREE from 'three';
import { COLORS, PFlag, weaponDef } from '@holdfast/shared';
import { buildGun } from './gunModels';
import { basicMat, box, shadedBox } from './geo';
import type { Pose } from '../net/Interpolation';

const ARMOR = 0x3b4047;
const DARK = 0x1b1e22;
/** Grip position of the held gun, relative to the shoulder pivot. */
const GRIP = new THREE.Vector3(0.17, -0.09, -0.3);
const SHOULDER_R = new THREE.Vector3(0.3, 0, 0);
const SHOULDER_L = new THREE.Vector3(-0.3, 0, 0);
const GUN_SCALE = 0.9;
const UP_Z = new THREE.Vector3(0, 0, 1);
const tmpDir = new THREE.Vector3();

/** Stretch a unit box from a to b (same space as the mesh's parent). */
function placeLimb(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thick: number): void {
  tmpDir.subVectors(b, a);
  const len = Math.max(0.01, tmpDir.length());
  mesh.position.copy(a).addScaledVector(tmpDir, 0.5);
  mesh.scale.set(thick, thick, len);
  mesh.quaternion.setFromUnitVectors(UP_Z, tmpDir.multiplyScalar(1 / len));
}

function makeNameTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(name, 128, 34);
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.fillText(name, 128, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.0, 0.25, 1);
  sp.position.y = 2.15;
  sp.renderOrder = 50;
  return sp;
}

let shadowTex: THREE.CanvasTexture | null = null;
function blobTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export class PlayerView {
  readonly root = new THREE.Group();
  private upper = new THREE.Group();
  private head = new THREE.Group();
  /** Shoulder height pivot. The gun and both arms live in here and follow the look pitch. */
  private aim = new THREE.Group();
  private limbR: THREE.Mesh;
  private limbL: THREE.Mesh;
  private handR: THREE.Mesh;
  private handL: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private gun = new THREE.Group();
  private stripe: THREE.Mesh;
  private visor: THREE.Mesh;
  private tag: THREE.Group;
  private nameSprite: THREE.Sprite | null = null;
  private weaponId = -1;
  private phase = 0;
  private lastX = 0;
  private lastZ = 0;
  private first = true;
  private flash: THREE.Mesh;
  private flashT = 0;
  private meleeT = 0;
  private tmp = new THREE.Vector3();
  private leanVis = 0;
  speed = 0;

  constructor(readonly id: number, readonly name: string, friendly: boolean, teamColor: number) {
    const body = this.root;

    this.legL = box(0.18, 0.8, 0.22, DARK, 0, -0.4, 0);
    this.legR = box(0.18, 0.8, 0.22, DARK, 0, -0.4, 0);
    const hipL = new THREE.Group();
    hipL.position.set(-0.12, 0.8, 0);
    hipL.add(this.legL);
    const hipR = new THREE.Group();
    hipR.position.set(0.12, 0.8, 0);
    hipR.add(this.legR);
    body.add(hipL, hipR);

    this.upper.position.set(0, 0.8, 0);
    const torso = box(0.5, 0.62, 0.28, ARMOR, 0, 0.31, 0);
    this.stripe = box(0.52, 0.12, 0.3, teamColor, 0, 0.42, 0);
    this.upper.add(torso, this.stripe);
    const pack = box(0.34, 0.4, 0.14, DARK, 0, 0.36, 0.2);
    this.upper.add(pack);

    this.head.position.set(0, 0.8, 0);
    const skull = box(0.27, 0.27, 0.29, ARMOR, 0, 0, 0);
    this.visor = box(0.22, 0.08, 0.06, teamColor, 0, 0.02, -0.15);
    this.head.add(skull, this.visor);
    this.upper.add(this.head);

    // arms and gun: the gun is held in front of the chest and the arms reach for the grip and foregrip
    this.aim.position.set(0, 0.56, 0);
    this.upper.add(this.aim);
    this.gun.position.copy(GRIP);
    this.aim.add(this.gun);
    this.limbR = new THREE.Mesh(shadedBox(1, 1, 1), basicMat(ARMOR));
    this.limbL = new THREE.Mesh(shadedBox(1, 1, 1), basicMat(ARMOR));
    this.handR = box(0.1, 0.1, 0.1, DARK);
    this.handL = box(0.1, 0.1, 0.1, DARK);
    this.aim.add(this.limbR, this.limbL, this.handR, this.handL);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
    this.gun.add(this.flash);
    body.add(this.upper);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    shadow.renderOrder = -1;
    body.add(shadow);

    // tagged marker: wire box + arrow, drawn through walls
    this.tag = new THREE.Group();
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.75, 1.95, 0.75)),
      new THREE.LineBasicMaterial({ color: COLORS.tagged, depthTest: false, transparent: true }),
    );
    edges.position.y = 0.97;
    edges.renderOrder = 999;
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.3, 4),
      new THREE.MeshBasicMaterial({ color: COLORS.tagged, depthTest: false, transparent: true }),
    );
    arrow.rotation.x = Math.PI;
    arrow.position.y = 2.5;
    arrow.renderOrder = 999;
    this.tag.add(edges, arrow);
    this.tag.visible = false;
    body.add(this.tag);

    if (friendly) {
      this.nameSprite = makeNameTag(name, teamColor);
      body.add(this.nameSprite);
    }
    this.setWeapon(0);
  }

  setWeapon(id: number): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.gun.children.slice().forEach((c) => {
      if (c !== this.flash) this.gun.remove(c);
    });
    const def = weaponDef(id);
    const m = buildGun(def);
    m.group.scale.setScalar(GUN_SCALE);
    this.gun.add(m.group);
    this.flash.position.copy(m.muzzle).multiplyScalar(GUN_SCALE);
    this.flash.scale.setScalar(def.suppressed ? 0.25 : 1);
    // hands on the grip and on the foregrip, arms stretched between shoulders and hands
    const gripPoint = this.tmp.set(GRIP.x, GRIP.y - 0.02, GRIP.z).clone();
    const fore = this.tmp.set(GRIP.x, GRIP.y, GRIP.z).add(m.leftHand.clone().multiplyScalar(GUN_SCALE)).clone();
    this.handR.position.copy(gripPoint);
    this.handL.position.copy(fore);
    placeLimb(this.limbR, SHOULDER_R, gripPoint, 0.11);
    placeLimb(this.limbL, SHOULDER_L, fore, 0.11);
  }

  setTeamColor(c: number): void {
    this.stripe.material = basicMat(c);
    this.visor.material = basicMat(c);
  }

  fired(): void {
    this.flashT = 0.06;
  }

  melee(): void {
    this.meleeT = 0.25;
  }

  update(pose: Pose, dt: number): void {
    const f = pose.flags;
    this.root.position.set(pose.x, pose.y, pose.z);
    this.root.rotation.y = pose.yaw;
    if (this.first) {
      this.lastX = pose.x;
      this.lastZ = pose.z;
      this.first = false;
    }
    const moved = Math.hypot(pose.x - this.lastX, pose.z - this.lastZ);
    this.lastX = pose.x;
    this.lastZ = pose.z;
    const spd = dt > 0 ? moved / dt : 0;
    this.speed += (Math.min(spd, 7) - this.speed) * Math.min(1, dt * 12);
    const crouch = (f & PFlag.CROUCH) !== 0;
    const vault = (f & PFlag.VAULT) !== 0;

    this.phase += this.speed * dt * 2.4;
    const swing = Math.sin(this.phase) * Math.min(0.9, this.speed * 0.3);
    this.legL.parent!.rotation.x = swing;
    this.legR.parent!.rotation.x = -swing;
    const legScale = crouch ? 0.62 : 1;
    this.legL.parent!.scale.y = legScale;
    this.legR.parent!.scale.y = legScale;
    this.upper.position.y = 0.8 * legScale - (vault ? 0.2 : 0);
    // aim: right arm and head follow pitch
    const aim = pose.pitch;
    this.head.rotation.x = aim * 0.8;
    let lift = aim * 0.9;
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      lift += Math.sin((this.meleeT / 0.25) * Math.PI) * 0.9;
    }
    this.aim.rotation.x = lift;
    // lean: tilt the upper body about the waist and slide it out (smoothed, the flag only gives the direction)
    const leanWant = (f & PFlag.LEAN_R) !== 0 ? 1 : (f & PFlag.LEAN_L) !== 0 ? -1 : 0;
    this.leanVis += (leanWant - this.leanVis) * Math.min(1, dt * 12);
    this.upper.rotation.z = -this.leanVis * 0.32;
    this.upper.position.x = this.leanVis * 0.14;
    this.setWeapon(pose.weapon);

    this.tag.visible = (f & PFlag.TAGGED) !== 0;
    if (this.nameSprite) this.nameSprite.position.y = crouch ? 1.65 : 2.15;
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flash.rotation.z = Math.random() * 3;
      this.flash.scale.setScalar(0.6 + Math.random() * 0.6);
    } else {
      this.flash.visible = false;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material && (m.material as THREE.Material).dispose && !(m.material as THREE.MeshBasicMaterial).map) {
        // shared cached materials are intentionally kept
      }
    });
    if (this.nameSprite) {
      (this.nameSprite.material as THREE.SpriteMaterial).map?.dispose();
      this.nameSprite.material.dispose();
    }
  }
}
