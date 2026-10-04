// Cosmetic effects: tracers, impact particles, debris, explosions, hit sparks, screen shake.
// All pooled, nothing allocates per effect.

import * as THREE from 'three';
import { MaterialId } from '@holdfast/shared';
import { shadedBox } from './geo';

const MAX_PARTICLES = 700;
const MAX_TRACERS = 48;
const MAX_BOOMS = 6;

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  gravity: number;
  r: number; g: number; b: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Boom {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

const MAT_DEBRIS: Record<number, number> = {
  [MaterialId.WOOD]: 0x9a7448,
  [MaterialId.PLASTER]: 0xddd6c6,
  [MaterialId.BRICK]: 0xa8503b,
  [MaterialId.GLASS]: 0xbfeaf5,
  [MaterialId.FLOOR_WOOD]: 0xa87a40,
  [MaterialId.METAL]: 0x808c98,
};

export class Effects {
  private particles: Particle[] = [];
  private mesh: THREE.InstancedMesh;
  private tracers: Tracer[] = [];
  private booms: Boom[] = [];
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();
  private nextP = 0;
  private nextT = 0;
  private nextB = 0;
  shake = 0;

  constructor(scene: THREE.Scene) {
    const geo = shadedBox(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), MAX_PARTICLES);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.05, gravity: 9, r: 1, g: 1, b: 1 });
      this.tmp.scale.setScalar(0);
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
      this.mesh.setColorAt(i, this.col.setRGB(1, 1, 1));
    }
    scene.add(this.mesh);

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(
        tracerGeo,
        new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0.08 });
    }
    for (let i = 0; i < MAX_BOOMS; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.visible = false;
      scene.add(m);
      this.booms.push({ mesh: m, life: 0, max: 0.5, radius: 2 });
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, gravity = 9): void {
    const p = this.particles[this.nextP] as Particle;
    this.nextP = (this.nextP + 1) % MAX_PARTICLES;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life;
    p.size = size;
    p.gravity = gravity;
    this.col.setHex(color);
    p.r = this.col.r; p.g = this.col.g; p.b = this.col.b;
  }

  /** Debris burst when a cell is destroyed. */
  debris(x: number, y: number, z: number, mat: number): void {
    const color = MAT_DEBRIS[mat] ?? 0xcccccc;
    const n = mat === MaterialId.GLASS ? 6 : 4;
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 3, Math.random() * 3 + 0.5, (Math.random() - 0.5) * 3,
        0.6, 0.06 + Math.random() * 0.05, color,
      );
    }
    // a little dust
    this.spawn(x, y, z, 0, 0.4, 0, 0.5, 0.12, 0xcfc8bd, -0.6);
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, flesh: boolean): void {
    const color = flesh ? 0xc02020 : 0xffd9a0;
    const n = flesh ? 6 : 4;
    for (let i = 0; i < n; i++) {
      this.spawn(
        x, y, z,
        nx * 2 + (Math.random() - 0.5) * 2.4, ny * 2 + Math.random() * 1.5, nz * 2 + (Math.random() - 0.5) * 2.4,
        0.28, 0.025, color, 8,
      );
    }
    if (!flesh) this.spawn(x, y, z, nx * 0.2, 0.3, nz * 0.2, 0.3, 0.06, 0xa8a49c, -0.3);
  }

  /** A spent casing: a tiny brass (or red shotgun) cube that tumbles to the floor. */
  shell(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number): void {
    this.spawn(x, y, z, vx, vy, vz, 1.2, 0.018, color, 14);
  }

  tracer(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number): void {
    const t = this.tracers[this.nextT] as Tracer;
    this.nextT = (this.nextT + 1) % MAX_TRACERS;
    const dx = ex - ox;
    const dy = ey - oy;
    const dz = ez - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.1) return;
    const m = t.mesh;
    m.visible = true;
    m.position.set(ox + dx / 2, oy + dy / 2, oz + dz / 2);
    m.scale.set(0.012, 0.012, len);
    m.lookAt(ex, ey, ez);
    t.life = t.max;
    (m.material as THREE.MeshBasicMaterial).opacity = 0.9;
  }

  boom(x: number, y: number, z: number, radius: number): void {
    const b = this.booms[this.nextB] as Boom;
    this.nextB = (this.nextB + 1) % MAX_BOOMS;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
    b.life = b.max;
    b.radius = radius;
    for (let i = 0; i < 24; i++) {
      this.spawn(
        x, y, z,
        (Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10,
        0.5 + Math.random() * 0.4, 0.07 + Math.random() * 0.08, Math.random() < 0.5 ? 0xffa030 : 0x555555,
      );
    }
  }

  burst(x: number, y: number, z: number, color: number, count = 10): void {
    for (let i = 0; i < count; i++) {
      this.spawn(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4, 0.7, 0.07, color);
    }
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i] as Particle;
      if (!p.alive) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.tmp.scale.setScalar(0);
        this.tmp.updateMatrix();
        this.mesh.setMatrixAt(i, this.tmp.matrix);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02 && p.gravity > 0) {
        p.y = 0.02;
        p.vy = 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const k = p.life / p.max;
      this.tmp.position.set(p.x, p.y, p.z);
      this.tmp.scale.setScalar(p.size * (p.gravity < 0 ? 1 + (1 - k) * 2 : Math.min(1, k * 2 + 0.3)));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
      this.mesh.setColorAt(i, this.col.setRGB(p.r, p.g, p.b));
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else (t.mesh.material as THREE.MeshBasicMaterial).opacity = (t.life / t.max) * 0.9;
    }
    for (const b of this.booms) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      const k = 1 - b.life / b.max;
      b.mesh.scale.setScalar(b.radius * (0.3 + k * 0.9));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }
}
