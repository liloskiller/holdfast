// Snapshot interpolation for remote entities (render in the past, lerp between bracketing snapshots).

import { NET, lerp, lerpAngle, type EntitySnap, type PlayerSnap } from '@holdfast/shared';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
  hp: number;
  a: number;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
  hp: number;
  a: number;
}

export function makePose(): Pose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, weapon: 0, hp: 0, a: 0 };
}

const MAX_SAMPLES = 12;

class Buffer {
  samples: Sample[] = [];
  lastSnapTime = 0;
  push(s: Sample): void {
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    this.lastSnapTime = s.t;
  }
  sample(rt: number, out: Pose): boolean {
    const n = this.samples.length;
    if (n === 0) return false;
    const first = this.samples[0] as Sample;
    const last = this.samples[n - 1] as Sample;
    if (rt <= first.t || n === 1) {
      copy(first, out);
      return true;
    }
    if (rt >= last.t) {
      const prev = this.samples[n - 2] as Sample;
      copy(last, out);
      const dt = last.t - prev.t;
      const extra = Math.min(rt - last.t, 100);
      if (dt > 0 && extra > 0) {
        const k = extra / dt;
        out.x += (last.x - prev.x) * k;
        out.y += (last.y - prev.y) * k;
        out.z += (last.z - prev.z) * k;
      }
      return true;
    }
    for (let i = n - 1; i > 0; i--) {
      const b = this.samples[i] as Sample;
      const a = this.samples[i - 1] as Sample;
      if (rt >= a.t && rt <= b.t) {
        const f = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
        out.x = lerp(a.x, b.x, f);
        out.y = lerp(a.y, b.y, f);
        out.z = lerp(a.z, b.z, f);
        out.yaw = lerpAngle(a.yaw, b.yaw, f);
        out.pitch = lerp(a.pitch, b.pitch, f);
        out.a = lerpAngle(a.a, b.a, f);
        out.flags = a.flags;
        out.weapon = a.weapon;
        out.hp = b.hp;
        return true;
      }
    }
    copy(last, out);
    return true;
  }
}

function copy(s: Sample, o: Pose): void {
  o.x = s.x; o.y = s.y; o.z = s.z; o.yaw = s.yaw; o.pitch = s.pitch; o.flags = s.flags; o.weapon = s.weapon; o.hp = s.hp; o.a = s.a;
}

export class Interpolator {
  private players = new Map<number, Buffer>();
  private entities = new Map<number, Buffer>();
  presentPlayers = new Set<number>();
  presentEntities = new Set<number>();
  delayMs: number = NET.interpDelayMs;
  private lastArrival = 0;
  private jitter = 0;

  /** Adapt the buffer to measured arrival jitter. */
  private updateJitter(): void {
    const now = performance.now();
    if (this.lastArrival) {
      const dev = Math.abs(now - this.lastArrival - 50);
      this.jitter = this.jitter * 0.95 + dev * 0.05;
      const target = Math.min(NET.interpDelayMaxMs, NET.interpDelayMs + this.jitter * 2.5);
      this.delayMs += (target - this.delayMs) * 0.05;
    }
    this.lastArrival = now;
  }

  push(time: number, players: PlayerSnap[], entities: EntitySnap[]): void {
    this.updateJitter();
    this.presentPlayers.clear();
    for (const p of players) {
      this.presentPlayers.add(p.id);
      let b = this.players.get(p.id);
      if (!b) {
        b = new Buffer();
        this.players.set(p.id, b);
      }
      b.push({ t: time, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flags: p.flags, weapon: p.weapon, hp: p.hp, a: 0 });
    }
    for (const id of [...this.players.keys()]) if (!this.presentPlayers.has(id)) this.players.delete(id);

    this.presentEntities.clear();
    for (const e of entities) {
      this.presentEntities.add(e.id);
      let b = this.entities.get(e.id);
      if (!b) {
        b = new Buffer();
        this.entities.set(e.id, b);
      }
      b.push({ t: time, x: e.x, y: e.y, z: e.z, yaw: e.a, pitch: e.b, flags: e.kind, weapon: e.team, hp: e.hp, a: e.a });
    }
    for (const id of [...this.entities.keys()]) if (!this.presentEntities.has(id)) this.entities.delete(id);
  }

  samplePlayer(id: number, renderTime: number, out: Pose): boolean {
    const b = this.players.get(id);
    return b ? b.sample(renderTime, out) : false;
  }

  sampleEntity(id: number, renderTime: number, out: Pose): boolean {
    const b = this.entities.get(id);
    return b ? b.sample(renderTime, out) : false;
  }

  clear(): void {
    this.players.clear();
    this.entities.clear();
    this.presentPlayers.clear();
    this.presentEntities.clear();
  }
}
