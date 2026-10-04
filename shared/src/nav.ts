// Navigation grid for bots. Nodes are the corners between tiles (a node is walkable when the 2 x 2 tiles
// around it leave room for a person), links go to the 8 neighbours and up and down the stairs.
// Doors count as walkable (the bot opens them), windows never do. Deterministic and free of DOM / Three.js.

import { FLOOR_H, LAYERS_PER_FLOOR, TILE, WALL_LAYERS } from './constants';
import { hash32, rand01 } from './math';
import { stairVec, type MapData } from './mapFormat';
import { Vox, type World } from './world';

export interface NavPath {
  /** x, z pairs of the waypoints, in order. */
  xz: number[];
  /** Floor index of every waypoint. */
  floor: number[];
  /** Number of waypoints. */
  n: number;
}

const SQRT2 = Math.SQRT2;

interface StairInfo {
  floor: number;
  alongX: boolean;
  /** Tile rectangle of the steps. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  startEdge: number;
  endEdge: number;
  pairs: { lat: number; bottom: number; top: number }[];
}

/** A staircase seen as one long link: where to walk to in between (x, z pairs) and how much it costs. */
interface StairLink {
  to: number;
  via: number[];
  viaFloor: number;
  cost: number;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] as number) <= key) break;
      k[i] = k[p] as number;
      v[i] = v[p] as number;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0] as number;
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (k[c + 1] as number) < (k[c] as number)) c++;
        if ((k[c] as number) >= lastK) break;
        k[i] = k[c] as number;
        v[i] = v[c] as number;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

export class NavGrid {
  readonly nx: number;
  readonly nz: number;
  readonly floors: number;
  private w: number; // nodes per row (nx + 1)
  private h: number; // nodes per column (nz + 1)
  private ok: Uint8Array;
  /** Extra cost near walls, so paths keep to the middle of corridors. */
  private near: Uint8Array;
  private links = new Map<number, StairLink[]>();
  private stairs: StairInfo[] = [];
  private gScore: Float32Array;
  private parent: Int32Array;
  private parentLink: (StairLink | null)[];
  private stamp: Uint32Array;
  private run = 0;
  private closed: Uint32Array;

  constructor(private world: World) {
    this.nx = world.nx;
    this.nz = world.nz;
    this.floors = world.floorCount;
    this.w = this.nx + 1;
    this.h = this.nz + 1;
    const total = this.floors * this.w * this.h;
    this.ok = new Uint8Array(total);
    this.near = new Uint8Array(total);
    this.gScore = new Float32Array(total);
    this.parent = new Int32Array(total);
    this.parentLink = new Array<StairLink | null>(total).fill(null);
    this.stamp = new Uint32Array(total);
    this.closed = new Uint32Array(total);
    this.build(world.map);
  }

  index(f: number, vx: number, vz: number): number {
    return (f * this.h + vz) * this.w + vx;
  }

  private fOf(i: number): number {
    return Math.floor(i / (this.w * this.h));
  }

  private vzOf(i: number): number {
    return Math.floor((i % (this.w * this.h)) / this.w);
  }

  private vxOf(i: number): number {
    return i % this.w;
  }

  /** World position of a node (x, z at the tile corner, y at the floor level). */
  posOf(i: number, out: { x: number; y: number; z: number }): void {
    out.x = this.vxOf(i) * TILE;
    out.z = this.vzOf(i) * TILE;
    out.y = this.fOf(i) * FLOOR_H;
  }

  private passable(f: number, x: number, z: number, blocked: Set<number>): boolean {
    const nx = this.nx;
    const nz = this.nz;
    if (x < 0 || z < 0 || x >= nx || z >= nz) return false;
    if (blocked.has((f * nz + z) * nx + x)) return false;
    const base = f * LAYERS_PER_FLOOR;
    const vox = this.world.vox;
    for (let k = 0; k < 4; k++) if (vox[((base + k) * nz + z) * nx + x] !== Vox.AIR) return false;
    if (f > 0) {
      const below = (((f - 1) * LAYERS_PER_FLOOR + WALL_LAYERS) * nz + z) * nx + x;
      if (vox[below] === Vox.AIR) return false; // void or stairwell
    }
    return true;
  }

  private build(map: MapData): void {
    const blocked = new Set<number>();
    for (const op of this.world.openings) {
      if (op.kind !== 'window') continue;
      for (const [tx, tz] of op.tiles) blocked.add((op.floor * this.nz + tz) * this.nx + tx);
    }
    // the steps are walked along the staircase only, never entered from the side: block them and link the landings
    for (const st of map.stairs) {
      for (let z = st.z0; z <= st.z1; z++) for (let x = st.x0; x <= st.x1; x++) blocked.add((st.floor * this.nz + z) * this.nx + x);
    }
    for (let f = 0; f < this.floors; f++) {
      for (let vz = 1; vz <= this.nz; vz++) {
        for (let vx = 1; vx <= this.nx; vx++) {
          if (
            this.passable(f, vx - 1, vz - 1, blocked) && this.passable(f, vx, vz - 1, blocked) &&
            this.passable(f, vx - 1, vz, blocked) && this.passable(f, vx, vz, blocked)
          ) this.ok[this.index(f, vx, vz)] = 1;
        }
      }
    }
    // wall proximity: how many of the 8 neighbours are not walkable
    for (let f = 0; f < this.floors; f++) {
      for (let vz = 1; vz <= this.nz; vz++) {
        for (let vx = 1; vx <= this.nx; vx++) {
          const i = this.index(f, vx, vz);
          if (!this.ok[i]) continue;
          let c = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if ((dx || dz) && !this.nodeOk(f, vx + dx, vz + dz)) c++;
            }
          }
          this.near[i] = c;
        }
      }
    }
    // stairs: one link per lateral position, from the landing before the first step to the landing past the top
    for (const st of map.stairs) {
      const [dx, dz] = stairVec(st.dir);
      const alongX = dx !== 0;
      const dir = alongX ? dx : dz;
      const a0 = alongX ? st.x0 : st.z0;
      const a1 = alongX ? st.x1 : st.z1;
      const l0 = alongX ? st.z0 : st.x0;
      const l1 = alongX ? st.z1 : st.x1;
      const bottomV = dir > 0 ? a0 - 1 : a1 + 2;
      const topV = dir > 0 ? a1 + 2 : a0 - 1;
      const startEdge = dir > 0 ? a0 : a1 + 1;
      const endEdge = dir > 0 ? a1 + 1 : a0;
      const lo = l1 > l0 ? l0 + 1 : l0;
      const hi = l1 > l0 ? l1 : l0 + 1;
      const info: StairInfo = { floor: st.floor, alongX, x0: st.x0, z0: st.z0, x1: st.x1, z1: st.z1, startEdge, endEdge, pairs: [] };
      this.stairs.push(info);
      for (let lat = lo; lat <= hi; lat++) {
        const bi = alongX ? this.index(st.floor, bottomV, lat) : this.index(st.floor, lat, bottomV);
        const ti = alongX ? this.index(st.floor + 1, topV, lat) : this.index(st.floor + 1, lat, topV);
        if (!this.ok[bi] || !this.ok[ti]) continue;
        const pts = alongX
          ? [startEdge * TILE, lat * TILE, endEdge * TILE, lat * TILE]
          : [lat * TILE, startEdge * TILE, lat * TILE, endEdge * TILE];
        const rev = alongX
          ? [endEdge * TILE, lat * TILE, startEdge * TILE, lat * TILE]
          : [lat * TILE, endEdge * TILE, lat * TILE, startEdge * TILE];
        const cost = (a1 - a0 + 3) * 1.3;
        this.link(bi, { to: ti, via: pts, viaFloor: st.floor, cost });
        this.link(ti, { to: bi, via: rev, viaFloor: st.floor, cost });
        info.pairs.push({ lat, bottom: bi, top: ti });
      }
    }
  }

  private link(a: number, link: StairLink): void {
    let l = this.links.get(a);
    if (!l) {
      l = [];
      this.links.set(a, l);
    }
    l.push(link);
  }

  nodeOk(f: number, vx: number, vz: number): boolean {
    if (f < 0 || f >= this.floors || vx < 1 || vz < 1 || vx > this.nx || vz > this.nz) return false;
    return this.ok[this.index(f, vx, vz)] === 1;
  }

  /** The walkable node nearest to a world position (searching a few tiles around), or -1. */
  nearest(x: number, y: number, z: number, maxTiles = 4): number {
    const f = Math.max(0, Math.min(this.floors - 1, Math.floor((y + 0.5) / FLOOR_H)));
    const cx = Math.round(x / TILE);
    const cz = Math.round(z / TILE);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= maxTiles; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const vx = cx + dx;
          const vz = cz + dz;
          if (!this.nodeOk(f, vx, vz)) continue;
          const d = (vx * TILE - x) ** 2 + (vz * TILE - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = this.index(f, vx, vz);
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  /** A random walkable node within a radius (metres) of a position on the same floor, or -1. */
  randomNear(x: number, y: number, z: number, radius: number, rand: () => number): number {
    const f = Math.max(0, Math.min(this.floors - 1, Math.floor((y + 0.5) / FLOOR_H)));
    const r = Math.ceil(radius / TILE);
    const cx = Math.round(x / TILE);
    const cz = Math.round(z / TILE);
    for (let attempt = 0; attempt < 24; attempt++) {
      const vx = cx + Math.floor((rand() * 2 - 1) * r);
      const vz = cz + Math.floor((rand() * 2 - 1) * r);
      if (this.nodeOk(f, vx, vz) && (vx - cx) ** 2 + (vz - cz) ** 2 <= r * r) return this.index(f, vx, vz);
    }
    return -1;
  }

  /**
   * Shortest path between two nodes, or null. The result starts with the start node. A non zero `seed`
   * perturbs the costs a little (per node), so different bots pick different but similar routes.
   */
  findPath(from: number, to: number, seed = 0): NavPath | null {
    if (from < 0 || to < 0 || !this.ok[from] || !this.ok[to]) return null;
    const run = ++this.run;
    const open = new MinHeap();
    const w = this.w;
    const gx = this.vxOf(to);
    const gz = this.vzOf(to);
    const gf = this.fOf(to);
    const heur = (i: number): number => {
      if (this.fOf(i) !== gf) return 0;
      const dx = Math.abs(this.vxOf(i) - gx);
      const dz = Math.abs(this.vzOf(i) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    this.gScore[from] = 0;
    this.parent[from] = -1;
    this.parentLink[from] = null;
    this.stamp[from] = run;
    open.push(heur(from), from);
    let found = false;
    while (open.size) {
      const cur = open.pop();
      if (this.closed[cur] === run) continue;
      this.closed[cur] = run;
      if (cur === to) {
        found = true;
        break;
      }
      const f = this.fOf(cur);
      const vx = this.vxOf(cur);
      const vz = this.vzOf(cur);
      const g = this.gScore[cur] as number;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = vx + dx;
          const nz = vz + dz;
          if (!this.nodeOk(f, nx, nz)) continue;
          const diag = dx !== 0 && dz !== 0;
          if (diag && (!this.nodeOk(f, vx + dx, vz) || !this.nodeOk(f, vx, vz + dz))) continue;
          const ni = cur + dz * w + dx;
          let cost = (diag ? SQRT2 : 1) + (this.near[ni] as number) * 0.18;
          if (seed !== 0) cost *= 1 + 0.5 * rand01(hash32(seed, ni), 7);
          this.relax(open, cur, ni, g + cost, heur(ni), run, null);
        }
      }
      const extra = this.links.get(cur);
      if (extra) for (const l of extra) this.relax(open, cur, l.to, g + l.cost, heur(l.to), run, l);
    }
    if (!found) return null;
    const idx: number[] = [];
    for (let i = to; i !== -1; i = this.parent[i] as number) idx.push(i);
    idx.reverse();
    // build waypoints; a staircase inserts its via points, straight runs are merged
    const xz: number[] = [];
    const floor: number[] = [];
    const add = (x: number, z: number, f: number): void => {
      const n = floor.length;
      if (n >= 2) {
        // drop the previous waypoint when the three points are collinear on the same floor
        const x0 = xz[(n - 2) * 2] as number;
        const z0 = xz[(n - 2) * 2 + 1] as number;
        const x1 = xz[(n - 1) * 2] as number;
        const z1 = xz[(n - 1) * 2 + 1] as number;
        if (floor[n - 2] === f && floor[n - 1] === f && Math.abs((x1 - x0) * (z - z1) - (z1 - z0) * (x - x1)) < 1e-6) {
          xz[(n - 1) * 2] = x;
          xz[(n - 1) * 2 + 1] = z;
          return;
        }
      }
      xz.push(x, z);
      floor.push(f);
    };
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] as number;
      const l = this.parentLink[i];
      if (k > 0 && l) {
        for (let q = 0; q < l.via.length; q += 2) add(l.via[q] as number, l.via[q + 1] as number, l.viaFloor);
      }
      add(this.vxOf(i) * TILE, this.vzOf(i) * TILE, this.fOf(i));
    }
    return { xz, floor, n: floor.length };
  }

  private relax(open: MinHeap, from: number, to: number, g: number, h: number, run: number, link: StairLink | null): void {
    if (this.closed[to] === run) return;
    if (this.stamp[to] === run && (this.gScore[to] as number) <= g) return;
    this.stamp[to] = run;
    this.gScore[to] = g;
    this.parent[to] = from;
    this.parentLink[to] = link;
    open.push(g + h, to);
  }

  /** The staircase a position is on, or null. */
  private stairAt(x: number, y: number, z: number): StairInfo | null {
    for (const st of this.stairs) {
      if (x < st.x0 * TILE || x > (st.x1 + 1) * TILE || z < st.z0 * TILE || z > (st.z1 + 1) * TILE) continue;
      if (y < st.floor * FLOOR_H - 0.4 || y > (st.floor + 1) * FLOOR_H + 0.4) continue;
      return st;
    }
    return null;
  }

  /**
   * Path from a world position to a node. On a staircase there is no walkable node under the feet, so the
   * path starts from whichever landing (bottom or top) is cheaper to reach, then to the goal.
   */
  pathFrom(x: number, y: number, z: number, to: number, seed = 0): NavPath | null {
    const st = this.stairAt(x, y, z);
    if (!st || st.pairs.length === 0) return this.findPath(this.nearest(x, y, z, 3), to, seed);
    const lat = st.alongX ? z : x;
    const along = st.alongX ? x : z;
    let pair = st.pairs[0] as StairInfo['pairs'][number];
    for (const p of st.pairs) if (Math.abs(p.lat * TILE - lat) < Math.abs(pair.lat * TILE - lat)) pair = p;
    const length = Math.abs(st.endEdge - st.startEdge) * TILE;
    const prog = Math.max(0, Math.min(1, (along - st.startEdge * TILE) / ((st.endEdge - st.startEdge) * TILE)));
    const pb = this.findPath(pair.bottom, to, seed);
    const pt = this.findPath(pair.top, to, seed);
    const len = (p: NavPath | null): number => {
      if (!p) return Infinity;
      let d = 0;
      for (let i = 1; i < p.n; i++) d += Math.hypot((p.xz[i * 2] as number) - (p.xz[(i - 1) * 2] as number), (p.xz[i * 2 + 1] as number) - (p.xz[(i - 1) * 2 + 1] as number));
      return d;
    };
    return prog * length + len(pb) <= (1 - prog) * length + len(pt) ? pb : pt;
  }

  /** Convenience: path between two world positions. */
  path(sx: number, sy: number, sz: number, gx: number, gy: number, gz: number, seed = 0): NavPath | null {
    return this.findPath(this.nearest(sx, sy, sz), this.nearest(gx, gy, gz), seed);
  }
}
