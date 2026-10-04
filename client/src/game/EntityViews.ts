// Views for placed gadgets and drones, created and removed as entities appear in snapshots.

import * as THREE from 'three';
import { COLORS, DRONE, EntityKind, GADGET, wrapAngle, type EntitySnap } from '@holdfast/shared';
import { basicMat, box } from './geo';
import type { Pose } from '../net/Interpolation';

interface View {
  group: THREE.Group;
  kind: EntityKind;
  extra: THREE.Object3D[];
  hp: number;
  /** Drone only: the camera turret, plus last position and heading used to turn the chassis and spin wheels. */
  turret?: THREE.Object3D;
  chassis?: THREE.Object3D;
  lx: number;
  lz: number;
  heading: number;
}

let wheelGeo: THREE.CylinderGeometry | null = null;

interface DroneModel {
  g: THREE.Group;
  wheels: THREE.Object3D[];
  turret: THREE.Object3D;
}

/** A small wheeled RC car. The group origin is the chassis centre (DRONE.halfH above the floor). */
function droneModel(color: number): DroneModel {
  if (!wheelGeo) {
    wheelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10);
    wheelGeo.userData['shared'] = true;
  }
  const g = new THREE.Group();
  g.add(box(0.28, 0.06, 0.38, 0x25282c, 0, -0.03, 0));
  g.add(box(0.2, 0.025, 0.24, color, 0, 0.012, 0.03));
  g.add(box(0.02, 0.2, 0.02, 0x111111, 0.1, 0.11, 0.14));
  const wheels: THREE.Object3D[] = [];
  const tire = basicMat(0x15171a);
  for (const [x, z] of [[0.165, 0.13], [-0.165, 0.13], [0.165, -0.13], [-0.165, -0.13]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -DRONE.halfH + 0.07, z);
    const m = new THREE.Mesh(wheelGeo, tire);
    m.rotation.z = Math.PI / 2;
    pivot.add(m);
    // a pale stripe so the spin is visible
    pivot.add(box(0.055, 0.02, 0.12, 0x6b7178, 0, 0, 0));
    g.add(pivot);
    wheels.push(pivot);
  }
  // camera turret on the nose (the lens points where the pilot looks)
  const turret = new THREE.Group();
  turret.position.set(0, 0.06, -0.1);
  turret.add(box(0.08, 0.06, 0.08, 0x1b1e22));
  turret.add(box(0.045, 0.045, 0.03, 0x00ff88, 0, 0, -0.045));
  g.add(turret);
  return { g, wheels, turret };
}

export class EntityViews {
  private views = new Map<number, View>();
  private time = 0;
  private seen = new Set<number>();
  private pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, weapon: 0, hp: 0, a: 0 };

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
    let turret: THREE.Object3D | undefined;
    let chassis: THREE.Object3D | undefined;
    const color = this.colorFor(e.team);
    switch (e.kind) {
      case EntityKind.DRONE: {
        const m = droneModel(color);
        g.add(m.g);
        extra.push(...m.wheels);
        turret = m.turret;
        chassis = m.g;
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
    const view: View = { group: g, kind: e.kind, extra, hp: e.hp, lx: e.x, lz: e.z, heading: e.a };
    if (turret) view.turret = turret;
    if (chassis) view.chassis = chassis;
    return view;
  }

  /** Sync the set of entities with the latest snapshot, then position them from interpolated poses. */
  sync(entities: EntitySnap[], sample: (id: number, out: Pose) => boolean, dt: number, isPiloting: (ownerId: number) => boolean): void {
    this.time += dt;
    const pose = this.pose;
    const seen = this.seen;
    seen.clear();
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
          // the chassis turns toward its direction of travel, the camera turret keeps pointing where the pilot looks
          const mx = pose.x - v.lx;
          const mz = pose.z - v.lz;
          const dist = Math.hypot(mx, mz);
          v.lx = pose.x;
          v.lz = pose.z;
          if (dist > 0.002 && dt > 0) {
            const want = Math.atan2(-mx, -mz);
            v.heading += wrapAngle(want - v.heading) * Math.min(1, dt * 10);
            const spin = dist / 0.07;
            for (const w of v.extra) w.rotation.x -= spin;
          }
          if (v.chassis) v.chassis.rotation.y = v.heading;
          if (v.turret) v.turret.rotation.y = pose.yaw - v.heading;
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
