// Views for placed gadgets and drones, created and removed as entities appear in snapshots.

import * as THREE from 'three';
import { COLORS, EntityKind, GADGET, type EntitySnap } from '@holdfast/shared';
import { basicMat, box } from './geo';
import type { Pose } from '../net/Interpolation';

interface View {
  group: THREE.Group;
  kind: EntityKind;
  extra: THREE.Object3D[];
  hp: number;
}

function droneModel(color: number): { g: THREE.Group; rotors: THREE.Object3D[] } {
  const g = new THREE.Group();
  g.add(box(0.2, 0.06, 0.2, 0x25282c));
  g.add(box(0.07, 0.05, 0.07, color, 0, 0.05, 0));
  const rotors: THREE.Object3D[] = [];
  for (const [x, z] of [[0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]] as const) {
    g.add(box(0.03, 0.03, 0.03, 0x111111, x * 0.7, 0.02, z * 0.7));
    const r = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.008, 10),
      new THREE.MeshBasicMaterial({ color: 0xcfd6dc, transparent: true, opacity: 0.45 }),
    );
    r.position.set(x, 0.045, z);
    g.add(r);
    rotors.push(r);
  }
  // camera eye
  g.add(box(0.05, 0.05, 0.05, 0x00ff88, 0, -0.02, -0.11));
  return { g, rotors };
}

export class EntityViews {
  private views = new Map<number, View>();
  private time = 0;

  constructor(private scene: THREE.Scene, private attackerTeam: () => number) {}

  clear(): void {
    for (const v of this.views.values()) this.scene.remove(v.group);
    this.views.clear();
  }

  private colorFor(team: number): number {
    return team === this.attackerTeam() ? COLORS.attackers : COLORS.defenders;
  }

  private create(e: EntitySnap): View {
    const g = new THREE.Group();
    const extra: THREE.Object3D[] = [];
    const color = this.colorFor(e.team);
    switch (e.kind) {
      case EntityKind.DRONE: {
        const m = droneModel(color);
        g.add(m.g);
        extra.push(...m.rotors);
        break;
      }
      case EntityKind.SHIELD: {
        const w = GADGET.shieldWidth;
        const h = GADGET.shieldHeight;
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, GADGET.shieldThickness),
          new THREE.MeshBasicMaterial({ color: 0x5ab4ff, transparent: true, opacity: 0.38, depthWrite: false }),
        );
        panel.position.y = h / 2;
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(panel.geometry),
          new THREE.LineBasicMaterial({ color: color }),
        );
        frame.position.copy(panel.position);
        g.add(panel, frame);
        break;
      }
      case EntityKind.TRAP: {
        g.add(box(0.5, 0.04, 0.5, 0x2a2d31, 0, 0.02, 0));
        for (let i = 0; i < 5; i++) {
          const s = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 5), basicMat(0xc9ced4));
          s.position.set(Math.cos(i * 1.256) * 0.14, 0.12, Math.sin(i * 1.256) * 0.14);
          g.add(s);
        }
        g.add(box(0.04, 0.05, 0.04, COLORS.tagged, 0, 0.06, 0));
        break;
      }
      case EntityKind.JAMMER: {
        g.add(box(0.34, 0.4, 0.34, 0x2c3138, 0, 0.2, 0));
        g.add(box(0.03, 0.2, 0.03, 0x111111, 0.1, 0.5, 0.1));
        const led = box(0.07, 0.05, 0.05, 0x00e0ff, 0, 0.32, -0.18);
        g.add(led);
        extra.push(led);
        break;
      }
      case EntityKind.CAMERA: {
        g.add(box(0.22, 0.2, 0.22, 0x2a2e33, 0, 0, 0));
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), basicMat(0x101215));
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, 0, -0.15);
        g.add(lens);
        const led = box(0.04, 0.04, 0.04, 0xff2020, 0.08, 0.1, -0.12);
        g.add(led);
        extra.push(led);
        break;
      }
      case EntityKind.BREACH: {
        g.add(box(0.26, 0.2, 0.07, 0x3f4a2e, 0, 0, 0));
        const led = box(0.05, 0.05, 0.03, 0xff2a2a, 0, 0.04, 0.05);
        g.add(led);
        extra.push(led);
        break;
      }
      default:
        break;
    }
    this.scene.add(g);
    return { group: g, kind: e.kind, extra, hp: e.hp };
  }

  /** Sync the set of entities with the latest snapshot, then position them from interpolated poses. */
  sync(entities: EntitySnap[], sample: (id: number, out: Pose) => boolean, dt: number, isPiloting: (ownerId: number) => boolean): void {
    this.time += dt;
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, weapon: 0, hp: 0, a: 0 };
    const seen = new Set<number>();
    for (const e of entities) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = this.create(e);
        this.views.set(e.id, v);
      }
      if (!sample(e.id, pose)) {
        pose.x = e.x; pose.y = e.y; pose.z = e.z; pose.yaw = e.a; pose.pitch = e.b;
      }
      const g = v.group;
      g.position.set(pose.x, pose.y, pose.z);
      switch (e.kind) {
        case EntityKind.DRONE: {
          g.rotation.y = pose.yaw;
          for (const r of v.extra) r.rotation.y = this.time * 40;
          g.position.y += Math.sin(this.time * 3 + e.id) * 0.01;
          // hide the drone we are looking through
          g.visible = !isPiloting(e.owner);
          break;
        }
        case EntityKind.SHIELD:
          g.rotation.y = e.a;
          break;
        case EntityKind.CAMERA:
          g.rotation.set(e.b, e.a, 0, 'YXZ');
          for (const l of v.extra) l.visible = Math.floor(this.time * 2) % 2 === 0;
          break;
        case EntityKind.BREACH:
          g.rotation.y = e.b;
          for (const l of v.extra) l.visible = Math.floor(this.time * 3) % 2 === 0;
          break;
        case EntityKind.JAMMER:
          for (const l of v.extra) l.visible = Math.floor(this.time * 4) % 2 === 0;
          break;
        default:
          break;
      }
      v.hp = e.hp;
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(v.group);
        this.views.delete(id);
      }
    }
  }

  /** World position of an entity, for camera views. */
  position(id: number, out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v) return false;
    out.copy(v.group.position);
    return true;
  }

}
