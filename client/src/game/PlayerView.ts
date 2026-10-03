// Remote player model: a blocky robot soldier with a team colored chest stripe, a blob shadow,
// a name tag for teammates and a see-through outline when tagged.

import * as THREE from 'three';
import { COLORS, PFlag, weaponDef } from '@holdfast/shared';
import { basicMat, box } from './geo';
import type { Pose } from '../net/Interpolation';

const ARMOR = 0x3b4047;
const DARK = 0x1b1e22;

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
  private armR = new THREE.Group();
  private armL = new THREE.Group();
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

    // arms: pivot at shoulder
    this.armR.position.set(0.31, 0.56, 0);
    this.armR.add(box(0.12, 0.5, 0.12, ARMOR, 0, -0.22, 0));
    this.armL.position.set(-0.31, 0.56, 0);
    this.armL.add(box(0.12, 0.5, 0.12, ARMOR, 0, -0.22, 0));
    this.upper.add(this.armR, this.armL);

    this.gun.position.set(0, -0.42, -0.1);
    this.armR.add(this.gun);

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
    const len = def.length * 0.8;
    const g = box(0.07, 0.1, len, def.color, 0, 0, -len / 2 + 0.05);
    const barrel = box(0.04, 0.04, 0.2, 0x111111, 0, 0.01, -len - 0.02);
    this.gun.add(g, barrel);
    this.flash.position.set(0, 0.01, -len - 0.2);
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
    let armR = -(1.35 - aim * 0.9);
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      armR += Math.sin((this.meleeT / 0.25) * Math.PI) * 1.1;
    }
    this.armR.rotation.x = armR;
    this.armL.rotation.x = -(1.2 - aim * 0.9);
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
