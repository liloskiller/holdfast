// The World: a uniform voxel grid with static geometry, destructible cells,
// doors/windows (openings), stair steps and dynamic solids (shields etc).
// The server owns the truth; the client holds an identical instance kept in sync by diffs.

import {
  CELL, FLOOR_H, LAYERS_PER_FLOOR, MATERIAL_HP, MaterialId, PLAYER, TILE, WALL_LAYERS, SIEGE,
} from './constants';
import { BOX_STRIDE, rayAabb, overlapsAny, type Aabb, type RayNormal } from './collision';
import { tileAt, type MapData, type StairDef } from './mapFormat';
import type { CellDiff, OpeningDiff, WorldDiff } from './types';

export const Vox = { AIR: 0, STATIC: 1, CELL: 2 } as const;

/** Render skin of static voxels. */
export const Skin = { CONCRETE: 0, SLAB: 1, FURNITURE: 2, FENCE: 3, ROOF: 4, TALL: 5 } as const;

export const HitKind = { NONE: 0, STATIC: 1, CELL: 2, OPENING: 3, DYN: 4, STAIR: 5 } as const;
export type HitKind = (typeof HitKind)[keyof typeof HitKind];

export interface RayHit {
  kind: HitKind;
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  /** cell id, opening id or dynamic solid id depending on kind */
  id: number;
}

export function makeRayHit(): RayHit {
  return { kind: HitKind.NONE, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, id: -1 };
}

export interface RayOpts {
  /** Treat glass as transparent (used for line of sight). */
  seeThroughGlass?: boolean;
  /** Skip dynamic solids (shields etc). */
  skipDyn?: boolean;
  /** Skip openings (doors, barricades). */
  skipOpenings?: boolean;
  /** Skip this dynamic solid id. */
  skipDynId?: number;
}

export interface Opening {
  id: number;
  kind: 'door' | 'window';
  floor: number;
  tiles: [number, number][];
  alongX: boolean;
  box: Aabb;
  open: boolean;
  destroyed: boolean;
  hp: number;
  maxHp: number;
  barricadeHp: number;
  glass: number[];
  cx: number;
  cz: number;
}

export interface Panel {
  id: number;
  floor: number;
  tiles: [number, number][];
  cellIds: number[];
  reinforced: boolean;
  cx: number;
  cy: number;
  cz: number;
}

export interface HatchInfo {
  id: number;
  floor: number;
  cellIds: number[];
  cx: number;
  cz: number;
}

export interface DynSolid {
  id: number;
  box: Aabb;
  hp: number;
  maxHp: number;
  team: number;
  kind: number;
  vaultable: boolean;
  blocksMove: boolean;
}

export interface VaultTarget {
  x: number;
  y: number;
  z: number;
}

const MAX_BOXES = 1024;

export class World {
  readonly map: MapData;
  readonly nx: number;
  readonly nz: number;
  readonly ny: number;
  readonly floorCount: number;

  vox!: Uint8Array;
  skin!: Uint8Array;
  cellAtVox!: Int32Array;

  cellCount = 0;
  cellVox!: Int32Array;
  cellMat!: Uint8Array;
  cellHp!: Float32Array;
  cellMaxHp!: Float32Array;
  cellReinf!: Uint8Array;
  cellAlive!: Uint8Array;
  cellPanel!: Int16Array;
  cellOpening!: Int16Array;

  panels: Panel[] = [];
  hatches: HatchInfo[] = [];
  openings: Opening[] = [];
  dyn = new Map<number, DynSolid>();

  stairTop!: Float32Array;
  stairBase!: Float32Array;

  /** Called whenever a cell changes (damage, destroy, reinforce). */
  onCell: ((id: number) => void) | null = null;
  onOpening: ((id: number) => void) | null = null;

  private dirtyCells = new Set<number>();
  private dirtyOpenings = new Set<number>();
  private scratch = new Float64Array(MAX_BOXES * BOX_STRIDE);
  private rn: RayNormal = { nx: 0, ny: 0, nz: 0 };

  constructor(map: MapData) {
    this.map = map;
    this.nx = map.nx;
    this.nz = map.nz;
    this.floorCount = map.floorCount;
    this.ny = map.floorCount * LAYERS_PER_FLOOR;
    this.build();
  }

  // -------------------------------------------------------------------------
  // Building from the map
  // -------------------------------------------------------------------------

  /** Restore the pristine state (new round). */
  reset(): void {
    this.build();
  }

  private vi(x: number, l: number, z: number): number {
    return (l * this.nz + z) * this.nx + x;
  }

  private build(): void {
    const { map, nx, nz, ny } = this;
    const total = nx * nz * ny;
    this.vox = new Uint8Array(total);
    this.skin = new Uint8Array(total);
    this.cellAtVox = new Int32Array(total).fill(-1);
    this.stairTop = new Float32Array(nx * nz);
    this.stairBase = new Float32Array(nx * nz);
    this.panels = [];
    this.hatches = [];
    this.openings = [];
    this.dyn.clear();
    this.dirtyCells.clear();
    this.dirtyOpenings.clear();

    // Collect cell definitions first (count), then fill arrays.
    const cellVoxList: number[] = [];
    const cellMatList: number[] = [];
    const cellPanelList: number[] = [];
    const cellOpeningList: number[] = [];

    const addCell = (x: number, l: number, z: number, mat: number, panel = -1, opening = -1): number => {
      const v = this.vi(x, l, z);
      const id = cellVoxList.length;
      this.vox[v] = Vox.CELL;
      this.cellAtVox[v] = id;
      cellVoxList.push(v);
      cellMatList.push(mat);
      cellPanelList.push(panel);
      cellOpeningList.push(opening);
      return id;
    };
    const addStatic = (x: number, l: number, z: number, skin: number): void => {
      const v = this.vi(x, l, z);
      this.vox[v] = Vox.STATIC;
      this.skin[v] = skin;
    };

    const b = map.building;
    const inBuilding = (x: number, z: number): boolean => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;
    const onShell = (x: number, z: number): boolean =>
      inBuilding(x, z) && (x === b.x0 || x === b.x1 - 1 || z === b.z0 || z === b.z1 - 1);

    // Pass 1: slabs (floor/ceiling), then per tile content.
    for (let f = 0; f < this.floorCount; f++) {
      const slabL = f * LAYERS_PER_FLOOR + WALL_LAYERS;
      const last = f === this.floorCount - 1;
      for (let z = b.z0; z < b.z1; z++) {
        for (let x = b.x0; x < b.x1; x++) addStatic(x, slabL, z, last ? Skin.ROOF : Skin.SLAB);
      }
    }

    // Openings need component grouping, do after the tile pass.
    for (let f = 0; f < this.floorCount; f++) {
      const base = f * LAYERS_PER_FLOOR;
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const ch = tileAt(map, f, x, z);
          switch (ch) {
            case '#': {
              if (inBuilding(x, z)) {
                for (let k = 0; k < LAYERS_PER_FLOOR; k++) addStatic(x, base + k, z, Skin.CONCRETE);
              } else {
                // fence ring or yard walls: full height
                if (f === 0) for (let l = 0; l < LAYERS_PER_FLOOR; l++) addStatic(x, l, z, Skin.FENCE);
              }
              break;
            }
            case 'W':
            case 'P':
            case 'B':
            case 'R': {
              const mat = ch === 'W' ? MaterialId.WOOD : ch === 'B' ? MaterialId.BRICK : MaterialId.PLASTER;
              for (let k = 0; k < WALL_LAYERS; k++) addCell(x, base + k, z, mat);
              break;
            }
            case 'f':
              if (f === 0 || inBuilding(x, z)) {
                for (let k = 0; k < 2; k++) addStatic(x, base + k, z, Skin.FURNITURE);
              }
              break;
            case 'F':
              if (f === 0 || inBuilding(x, z)) {
                for (let k = 0; k < 4; k++) addStatic(x, base + k, z, Skin.TALL);
              }
              break;
            default:
              break;
          }
        }
      }
    }

    // Openings (doors, doorways, windows)
    const seen = new Uint8Array(nx * nz * this.floorCount);
    for (let f = 0; f < this.floorCount; f++) {
      const base = f * LAYERS_PER_FLOOR;
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const ch = tileAt(map, f, x, z);
          if (ch !== 'D' && ch !== 'd' && ch !== 'g') continue;
          const si = (f * nz + z) * nx + x;
          if (seen[si]) continue;
          // group along the wall axis only (same char, adjacent in x or z)
          const tiles: [number, number][] = [];
          const stack: [number, number][] = [[x, z]];
          seen[si] = 1;
          while (stack.length) {
            const [cx, cz] = stack.pop() as [number, number];
            tiles.push([cx, cz]);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const ax = cx + dx;
              const az = cz + dz;
              if (ax < 0 || az < 0 || ax >= nx || az >= nz) continue;
              const ssi = (f * nz + az) * nx + ax;
              if (seen[ssi] || tileAt(map, f, ax, az) !== ch) continue;
              seen[ssi] = 1;
              stack.push([ax, az]);
            }
          }
          tiles.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
          let alongX = tiles.every((t) => t[1] === (tiles[0] as [number, number])[1]);
          if (tiles.length === 1) {
            const wallish = (cx: number, cz: number): boolean => {
              const c = tileAt(map, f, cx, cz);
              return c === '#' || c === 'W' || c === 'P' || c === 'B' || c === 'R' || c === 'D' || c === 'd' || c === 'g';
            };
            alongX = wallish(x - 1, z) && wallish(x + 1, z);
          }
          const minTx = Math.min(...tiles.map((t) => t[0]));
          const maxTx = Math.max(...tiles.map((t) => t[0]));
          const minTz = Math.min(...tiles.map((t) => t[1]));
          const maxTz = Math.max(...tiles.map((t) => t[1]));
          const y0 = base * CELL;

          if (ch === 'd') {
            for (const [tx, tz] of tiles) {
              if (onShell(tx, tz)) addStatic(tx, base + 4, tz, Skin.CONCRETE);
              else addCell(tx, base + 4, tz, MaterialId.PLASTER);
            }
            continue;
          }

          const id = this.openings.length;
          const box: Aabb = {
            minX: minTx * TILE, maxX: (maxTx + 1) * TILE,
            minZ: minTz * TILE, maxZ: (maxTz + 1) * TILE,
            minY: y0, maxY: y0 + 2.0,
          };
          const opening: Opening = {
            id, kind: ch === 'D' ? 'door' : 'window', floor: f, tiles, alongX, box,
            open: false, destroyed: false, hp: SIEGE.doorHp, maxHp: SIEGE.doorHp, barricadeHp: 0, glass: [],
            cx: (box.minX + box.maxX) / 2, cz: (box.minZ + box.maxZ) / 2,
          };
          if (ch === 'g') {
            box.minY = y0 + 1.0;
            box.maxY = y0 + 2.0;
            opening.hp = 0;
            opening.maxHp = 0;
            for (const [tx, tz] of tiles) {
              const shell = onShell(tx, tz);
              for (const k of [0, 1, 4]) {
                if (shell) addStatic(tx, base + k, tz, Skin.CONCRETE);
                else addCell(tx, base + k, tz, MaterialId.PLASTER);
              }
              for (const k of [2, 3]) opening.glass.push(addCell(tx, base + k, tz, MaterialId.GLASS, -1, id));
            }
          } else {
            for (const [tx, tz] of tiles) {
              if (onShell(tx, tz)) addStatic(tx, base + 4, tz, Skin.CONCRETE);
              else addCell(tx, base + 4, tz, MaterialId.PLASTER);
            }
          }
          this.openings.push(opening);
        }
      }
    }

    // Stairs: step boxes and slab holes
    for (const st of map.stairs) this.buildStairs(st);

    // Hatches: soft floor cells in the lower floor's slab layer
    for (const h of map.hatches) {
      const ids: number[] = [];
      let sx = 0;
      let sz = 0;
      for (const [x, z] of h.tiles) {
        const l = (h.floor - 1) * LAYERS_PER_FLOOR + WALL_LAYERS;
        const v = this.vi(x, l, z);
        this.vox[v] = Vox.AIR;
        ids.push(addCell(x, l, z, MaterialId.FLOOR_WOOD));
        sx += (x + 0.5) * TILE;
        sz += (z + 0.5) * TILE;
      }
      this.hatches.push({ id: this.hatches.length, floor: h.floor, cellIds: ids, cx: sx / h.tiles.length, cz: sz / h.tiles.length });
    }

    // Finalize cell arrays
    const n = cellVoxList.length;
    this.cellCount = n;
    this.cellVox = Int32Array.from(cellVoxList);
    this.cellMat = Uint8Array.from(cellMatList);
    this.cellPanel = Int16Array.from(cellPanelList);
    this.cellOpening = Int16Array.from(cellOpeningList);
    this.cellHp = new Float32Array(n);
    this.cellMaxHp = new Float32Array(n);
    this.cellReinf = new Uint8Array(n);
    this.cellAlive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      const hp = MATERIAL_HP[this.cellMat[i] as number] ?? 40;
      this.cellHp[i] = hp;
      this.cellMaxHp[i] = hp;
    }

    // Panels: connected `R` groups
    const rseen = new Uint8Array(nx * nz * this.floorCount);
    for (let f = 0; f < this.floorCount; f++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          if (tileAt(map, f, x, z) !== 'R' || rseen[(f * nz + z) * nx + x]) continue;
          const tiles: [number, number][] = [];
          const stack: [number, number][] = [[x, z]];
          rseen[(f * nz + z) * nx + x] = 1;
          while (stack.length) {
            const [cx, cz] = stack.pop() as [number, number];
            tiles.push([cx, cz]);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const ax = cx + dx;
              const az = cz + dz;
              if (ax < 0 || az < 0 || ax >= nx || az >= nz) continue;
              const ri = (f * nz + az) * nx + ax;
              if (rseen[ri] || tileAt(map, f, ax, az) !== 'R') continue;
              rseen[ri] = 1;
              stack.push([ax, az]);
            }
          }
          const id = this.panels.length;
          const cellIds: number[] = [];
          let sx = 0;
          let sz = 0;
          for (const [tx, tz] of tiles) {
            sx += (tx + 0.5) * TILE;
            sz += (tz + 0.5) * TILE;
            for (let k = 0; k < WALL_LAYERS; k++) {
              const cid = this.cellAtVox[this.vi(tx, f * LAYERS_PER_FLOOR + k, tz)] as number;
              if (cid >= 0) {
                cellIds.push(cid);
                this.cellPanel[cid] = id;
              }
            }
          }
          this.panels.push({
            id, floor: f, tiles, cellIds, reinforced: false,
            cx: sx / tiles.length, cy: f * FLOOR_H + 1.25, cz: sz / tiles.length,
          });
        }
      }
    }
  }

  private buildStairs(st: StairDef): void {
    const baseY = st.floor * FLOOR_H;
    for (let z = st.z0; z <= st.z1; z++) {
      for (let x = st.x0; x <= st.x1; x++) {
        let i: number;
        switch (st.dir) {
          case 'E': i = x - st.x0; break;
          case 'W': i = st.x1 - x; break;
          case 'S': i = z - st.z0; break;
          default: i = st.z1 - z; break;
        }
        const t = z * this.nx + x;
        this.stairBase[t] = baseY;
        this.stairTop[t] = baseY + (i + 1) * st.stepHeight;
        // open the slab above so the climber has headroom
        const l = st.floor * LAYERS_PER_FLOOR + WALL_LAYERS;
        this.vox[this.vi(x, l, z)] = Vox.AIR;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  inBounds(tx: number, l: number, tz: number): boolean {
    return tx >= 0 && tz >= 0 && l >= 0 && tx < this.nx && tz < this.nz && l < this.ny;
  }

  isSolidVoxel(tx: number, l: number, tz: number): boolean {
    if (!this.inBounds(tx, l, tz)) return false;
    return this.vox[this.vi(tx, l, tz)] !== Vox.AIR;
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    return this.isSolidVoxel(Math.floor(x / TILE), Math.floor(y / CELL), Math.floor(z / TILE));
  }

  floorOf(y: number): number {
    const f = Math.floor((y + 0.01) / FLOOR_H);
    return f < 0 ? 0 : f >= this.floorCount ? this.floorCount - 1 : f;
  }

  cellCenter(id: number, out: { x: number; y: number; z: number }): void {
    const v = this.cellVox[id] as number;
    const x = v % this.nx;
    const r = (v - x) / this.nx;
    const z = r % this.nz;
    const l = (r - z) / this.nz;
    out.x = (x + 0.5) * TILE;
    out.y = (l + 0.5) * CELL;
    out.z = (z + 0.5) * TILE;
  }

  /**
   * Fill `out` with solid boxes overlapping the query box. Returns the count.
   * Includes voxels, stair steps, closed doors/barricades and dynamic solids.
   */
  queryBoxes(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Float64Array = this.scratch): number {
    const e = 0.002;
    let n = 0;
    const cap = Math.floor(out.length / BOX_STRIDE);
    const x0 = Math.max(0, Math.floor((minX - e) / TILE));
    const x1 = Math.min(this.nx - 1, Math.floor((maxX + e) / TILE));
    const z0 = Math.max(0, Math.floor((minZ - e) / TILE));
    const z1 = Math.min(this.nz - 1, Math.floor((maxZ + e) / TILE));
    const l0 = Math.max(0, Math.floor((minY - e) / CELL));
    const l1 = Math.min(this.ny - 1, Math.floor((maxY + e) / CELL));

    for (let l = l0; l <= l1; l++) {
      for (let z = z0; z <= z1; z++) {
        let v = (l * this.nz + z) * this.nx + x0;
        for (let x = x0; x <= x1; x++, v++) {
          if (this.vox[v] === Vox.AIR || n >= cap) continue;
          const o = n * BOX_STRIDE;
          out[o] = x * TILE;
          out[o + 1] = l * CELL;
          out[o + 2] = z * TILE;
          out[o + 3] = (x + 1) * TILE;
          out[o + 4] = (l + 1) * CELL;
          out[o + 5] = (z + 1) * TILE;
          n++;
        }
      }
    }
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const top = this.stairTop[z * this.nx + x] as number;
        if (top <= 0 || n >= cap) continue;
        const base = this.stairBase[z * this.nx + x] as number;
        if (top < minY - e || base > maxY + e) continue;
        const o = n * BOX_STRIDE;
        out[o] = x * TILE;
        out[o + 1] = base;
        out[o + 2] = z * TILE;
        out[o + 3] = (x + 1) * TILE;
        out[o + 4] = top;
        out[o + 5] = (z + 1) * TILE;
        n++;
      }
    }
    for (let i = 0; i < this.openings.length; i++) {
      const op = this.openings[i] as Opening;
      if (!this.openingSolid(op) || n >= cap) continue;
      const bx = op.box;
      if (bx.maxX < minX - e || bx.minX > maxX + e || bx.maxZ < minZ - e || bx.minZ > maxZ + e || bx.maxY < minY - e || bx.minY > maxY + e) continue;
      const o = n * BOX_STRIDE;
      out[o] = bx.minX; out[o + 1] = bx.minY; out[o + 2] = bx.minZ;
      out[o + 3] = bx.maxX; out[o + 4] = bx.maxY; out[o + 5] = bx.maxZ;
      n++;
    }
    if (this.dyn.size) {
      for (const d of this.dyn.values()) {
        if (!d.blocksMove || n >= cap) continue;
        const bx = d.box;
        if (bx.maxX < minX - e || bx.minX > maxX + e || bx.maxZ < minZ - e || bx.minZ > maxZ + e || bx.maxY < minY - e || bx.minY > maxY + e) continue;
        const o = n * BOX_STRIDE;
        out[o] = bx.minX; out[o + 1] = bx.minY; out[o + 2] = bx.minZ;
        out[o + 3] = bx.maxX; out[o + 4] = bx.maxY; out[o + 5] = bx.maxZ;
        n++;
      }
    }
    if (minY < e && n < cap) {
      const o = n * BOX_STRIDE;
      out[o] = -1000; out[o + 1] = -100; out[o + 2] = -1000;
      out[o + 3] = 1000; out[o + 4] = 0; out[o + 5] = 1000;
      n++;
    }
    return n;
  }

  /** Is the given box free of solids? */
  boxFree(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const n = this.queryBoxes(minX, minY, minZ, maxX, maxY, maxZ);
    return !overlapsAny(minX, minY, minZ, maxX, maxY, maxZ, this.scratch, n);
  }

  standingFree(x: number, y: number, z: number, height: number = PLAYER.heightStand): boolean {
    const r = PLAYER.radius;
    return this.boxFree(x - r, y + 0.02, z - r, x + r, y + height, z + r);
  }

  openingSolid(op: Opening): boolean {
    if (op.barricadeHp > 0) return true;
    if (op.kind === 'window') return false;
    return !op.open && !op.destroyed;
  }

  // -------------------------------------------------------------------------
  // Raycast
  // -------------------------------------------------------------------------

  /**
   * Cast a ray (direction must be normalized). Writes the nearest hit to `out`.
   * Returns true on hit.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit, opts?: RayOpts): boolean {
    let bestT = maxDist;
    let bestKind: HitKind = HitKind.NONE;
    let bestId = -1;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    const rn = this.rn;

    if (!opts?.skipOpenings) {
      for (let i = 0; i < this.openings.length; i++) {
        const op = this.openings[i] as Opening;
        if (!this.openingSolid(op)) continue;
        const bx = op.box;
        const t = rayAabb(ox, oy, oz, dx, dy, dz, bx.minX, bx.minY, bx.minZ, bx.maxX, bx.maxY, bx.maxZ, bestT, rn);
        if (t >= 0 && t < bestT) {
          bestT = t; bestKind = HitKind.OPENING; bestId = op.id; bnx = rn.nx; bny = rn.ny; bnz = rn.nz;
        }
      }
    }
    if (!opts?.skipDyn && this.dyn.size) {
      for (const d of this.dyn.values()) {
        if (d.id === opts?.skipDynId) continue;
        const bx = d.box;
        const t = rayAabb(ox, oy, oz, dx, dy, dz, bx.minX, bx.minY, bx.minZ, bx.maxX, bx.maxY, bx.maxZ, bestT, rn);
        if (t >= 0 && t < bestT) {
          bestT = t; bestKind = HitKind.DYN; bestId = d.id; bnx = rn.nx; bny = rn.ny; bnz = rn.nz;
        }
      }
    }

    // Voxel DDA
    let ix = Math.floor(ox / TILE);
    let iy = Math.floor(oy / CELL);
    let iz = Math.floor(oz / TILE);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : TILE / Math.abs(dx);
    const tdy = dy === 0 ? Infinity : CELL / Math.abs(dy);
    const tdz = dz === 0 ? Infinity : TILE / Math.abs(dz);
    let tmx = dx === 0 ? Infinity : ((dx > 0 ? (ix + 1) * TILE : ix * TILE) - ox) / dx;
    let tmy = dy === 0 ? Infinity : ((dy > 0 ? (iy + 1) * CELL : iy * CELL) - oy) / dy;
    let tmz = dz === 0 ? Infinity : ((dz > 0 ? (iz + 1) * TILE : iz * TILE) - oz) / dz;
    let tCur = 0;
    let lnx = 0;
    let lny = 0;
    let lnz = 0;
    let guard = 0;

    while (tCur <= bestT && guard++ < 2048) {
      if (ix >= 0 && iz >= 0 && iy >= 0 && ix < this.nx && iz < this.nz && iy < this.ny) {
        const v = (iy * this.nz + iz) * this.nx + ix;
        const vv = this.vox[v] as number;
        if (vv !== Vox.AIR) {
          if (vv === Vox.STATIC) {
            if (tCur < bestT) { bestT = tCur; bestKind = HitKind.STATIC; bestId = v; bnx = lnx; bny = lny; bnz = lnz; }
            break;
          }
          const cid = this.cellAtVox[v] as number;
          if (!(opts?.seeThroughGlass && this.cellMat[cid] === MaterialId.GLASS)) {
            if (tCur < bestT) { bestT = tCur; bestKind = HitKind.CELL; bestId = cid; bnx = lnx; bny = lny; bnz = lnz; }
            break;
          }
        }
        const top = this.stairTop[iz * this.nx + ix] as number;
        if (top > 0) {
          const base = this.stairBase[iz * this.nx + ix] as number;
          const t = rayAabb(ox, oy, oz, dx, dy, dz, ix * TILE, base, iz * TILE, (ix + 1) * TILE, top, (iz + 1) * TILE, bestT, rn);
          if (t >= 0 && t < bestT) {
            bestT = t; bestKind = HitKind.STAIR; bestId = -1; bnx = rn.nx; bny = rn.ny; bnz = rn.nz;
          }
        }
      } else {
        // Leaving the grid in a direction we cannot come back from ends the cast.
        if ((ix < 0 && sx < 0) || (ix >= this.nx && sx > 0) || (iz < 0 && sz < 0) || (iz >= this.nz && sz > 0) ||
            (iy < 0 && sy < 0) || (iy >= this.ny && sy > 0)) break;
      }
      // advance
      if (tmx < tmy && tmx < tmz) {
        tCur = tmx; ix += sx; tmx += tdx; lnx = -sx; lny = 0; lnz = 0;
      } else if (tmy < tmz) {
        tCur = tmy; iy += sy; tmy += tdy; lnx = 0; lny = -sy; lnz = 0;
      } else {
        tCur = tmz; iz += sz; tmz += tdz; lnx = 0; lny = 0; lnz = -sz;
      }
    }

    if (bestKind === HitKind.NONE) return false;
    out.kind = bestKind;
    out.t = bestT;
    out.x = ox + dx * bestT;
    out.y = oy + dy * bestT;
    out.z = oz + dz * bestT;
    out.nx = bnx;
    out.ny = bny;
    out.nz = bnz;
    out.id = bestId;
    return true;
  }

  private losHit: RayHit = makeRayHit();

  /** Line of sight between two points (glass is transparent, doors and shields block). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    const inv = 1 / len;
    return !this.raycast(ax, ay, az, dx * inv, dy * inv, dz * inv, len - 0.01, this.losHit, { seeThroughGlass: true });
  }

  // -------------------------------------------------------------------------
  // Damage and destruction
  // -------------------------------------------------------------------------

  materialOf(id: number): number {
    return this.cellMat[id] as number;
  }

  isSoftMaterial(mat: number): boolean {
    return mat === MaterialId.WOOD || mat === MaterialId.PLASTER || mat === MaterialId.FLOOR_WOOD;
  }

  private markCell(id: number): void {
    this.dirtyCells.add(id);
    this.onCell?.(id);
  }

  private markOpening(id: number): void {
    this.dirtyOpenings.add(id);
    this.onOpening?.(id);
  }

  killCell(id: number): void {
    if (!this.cellAlive[id]) return;
    this.cellAlive[id] = 0;
    this.cellHp[id] = 0;
    const v = this.cellVox[id] as number;
    this.vox[v] = Vox.AIR;
    this.markCell(id);
  }

  /** Damage a cell. Returns true if it was destroyed by this call. `hard` ignores reinforcement. */
  damageCell(id: number, amount: number, hard = false): boolean {
    if (!this.cellAlive[id]) return false;
    if (this.cellReinf[id] && !hard) return false;
    this.cellHp[id] = (this.cellHp[id] as number) - amount;
    if ((this.cellHp[id] as number) <= 0) {
      this.killCell(id);
      return true;
    }
    this.markCell(id);
    return false;
  }

  /** Destroy all cells and openings inside the box. Returns destroyed cell ids. */
  destroyBox(box: Aabb, includeReinforced: boolean, outIds: number[] = []): number[] {
    const x0 = Math.max(0, Math.floor(box.minX / TILE));
    const x1 = Math.min(this.nx - 1, Math.floor((box.maxX - 1e-6) / TILE));
    const z0 = Math.max(0, Math.floor(box.minZ / TILE));
    const z1 = Math.min(this.nz - 1, Math.floor((box.maxZ - 1e-6) / TILE));
    const l0 = Math.max(0, Math.floor(box.minY / CELL));
    const l1 = Math.min(this.ny - 1, Math.floor((box.maxY - 1e-6) / CELL));
    for (let l = l0; l <= l1; l++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const v = this.vi(x, l, z);
          if (this.vox[v] !== Vox.CELL) continue;
          const id = this.cellAtVox[v] as number;
          if (this.cellReinf[id] && !includeReinforced) continue;
          this.killCell(id);
          outIds.push(id);
        }
      }
    }
    for (const op of this.openings) {
      const b = op.box;
      if (b.maxX <= box.minX || b.minX >= box.maxX || b.maxZ <= box.minZ || b.minZ >= box.maxZ || b.maxY <= box.minY || b.minY >= box.maxY) continue;
      if (op.barricadeHp > 0 || (op.kind === 'door' && !op.destroyed)) {
        op.barricadeHp = 0;
        if (op.kind === 'door') { op.destroyed = true; op.open = true; }
        this.markOpening(op.id);
      }
    }
    return outIds;
  }

  /** Explosion: damages cells within the radius with linear falloff. */
  explode(x: number, y: number, z: number, radius: number, damage: number, hard = false): number[] {
    const destroyed: number[] = [];
    const x0 = Math.max(0, Math.floor((x - radius) / TILE));
    const x1 = Math.min(this.nx - 1, Math.floor((x + radius) / TILE));
    const z0 = Math.max(0, Math.floor((z - radius) / TILE));
    const z1 = Math.min(this.nz - 1, Math.floor((z + radius) / TILE));
    const l0 = Math.max(0, Math.floor((y - radius) / CELL));
    const l1 = Math.min(this.ny - 1, Math.floor((y + radius) / CELL));
    for (let l = l0; l <= l1; l++) {
      for (let tz = z0; tz <= z1; tz++) {
        for (let tx = x0; tx <= x1; tx++) {
          const v = this.vi(tx, l, tz);
          if (this.vox[v] !== Vox.CELL) continue;
          const cx = (tx + 0.5) * TILE;
          const cy = (l + 0.5) * CELL;
          const cz = (tz + 0.5) * TILE;
          const d = Math.sqrt((cx - x) ** 2 + (cy - y) ** 2 + (cz - z) ** 2);
          if (d > radius) continue;
          const id = this.cellAtVox[v] as number;
          if (this.damageCell(id, damage * (1 - d / radius), hard) ) destroyed.push(id);
        }
      }
    }
    return destroyed;
  }

  reinforcePanel(id: number): boolean {
    const p = this.panels[id];
    if (!p || p.reinforced) return false;
    p.reinforced = true;
    for (const cid of p.cellIds) {
      if (!this.cellAlive[cid]) continue;
      this.cellReinf[cid] = 1;
      this.markCell(cid);
    }
    return true;
  }

  panelIntact(id: number): boolean {
    const p = this.panels[id];
    if (!p) return false;
    return p.cellIds.every((c) => this.cellAlive[c]);
  }

  setDoorOpen(id: number, open: boolean): boolean {
    const op = this.openings[id];
    if (!op || op.kind !== 'door' || op.destroyed || op.barricadeHp > 0) return false;
    if (op.open === open) return false;
    op.open = open;
    this.markOpening(id);
    return true;
  }

  placeBarricade(id: number): boolean {
    const op = this.openings[id];
    if (!op || op.barricadeHp > 0 || op.destroyed) return false;
    op.barricadeHp = SIEGE.barricadeHp;
    if (op.kind === 'door') op.open = false;
    this.markOpening(id);
    return true;
  }

  /** Damage an opening (barricade first, then the door). Returns true if something broke. */
  damageOpening(id: number, amount: number): boolean {
    const op = this.openings[id];
    if (!op) return false;
    if (op.barricadeHp > 0) {
      op.barricadeHp -= amount;
      let broke = false;
      if (op.barricadeHp <= 0) { op.barricadeHp = 0; broke = true; }
      this.markOpening(id);
      return broke;
    }
    if (op.kind === 'door' && !op.destroyed) {
      op.hp -= amount;
      if (op.hp <= 0) { op.hp = 0; op.destroyed = true; op.open = true; this.markOpening(id); return true; }
      this.markOpening(id);
    }
    return false;
  }

  addDyn(d: DynSolid): void {
    this.dyn.set(d.id, d);
  }

  removeDyn(id: number): void {
    this.dyn.delete(id);
  }

  /** Nearest door/window opening whose center is within reach and roughly in front. */
  findOpeningNear(x: number, y: number, z: number, fx: number, fz: number, reach: number, kind?: 'door' | 'window'): Opening | null {
    let best: Opening | null = null;
    let bestD = reach;
    const floor = this.floorOf(y);
    for (const op of this.openings) {
      if (op.floor !== floor) continue;
      if (kind && op.kind !== kind) continue;
      if (op.kind === 'door' && op.destroyed) continue;
      // closest point on the box in XZ
      const cx = Math.max(op.box.minX, Math.min(x, op.box.maxX));
      const cz = Math.max(op.box.minZ, Math.min(z, op.box.maxZ));
      const d = Math.hypot(cx - x, cz - z);
      if (d >= bestD) continue;
      const len = Math.hypot(cx - x, cz - z) || 1;
      const dot = ((cx - x) * fx + (cz - z) * fz) / len;
      if (d > 0.05 && dot < 0.2) continue;
      best = op;
      bestD = d;
    }
    return best;
  }

  /** Is this window clear to vault through (glass broken, no barricade)? */
  windowClear(op: Opening): boolean {
    if (op.kind !== 'window' || op.barricadeHp > 0) return false;
    for (const g of op.glass) if (this.cellAlive[g]) return false;
    return true;
  }

  /** Find a vault target in front of the player. */
  findVault(x: number, y: number, z: number, yaw: number, out: VaultTarget): boolean {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const floor = this.floorOf(y);
    for (const op of this.openings) {
      if (op.floor !== floor || !this.windowClear(op)) continue;
      const b = op.box;
      if (Math.abs(y - (b.minY - 1.0)) > 0.6) continue;
      if (op.alongX) {
        const toward = z < op.cz ? 1 : -1;
        if (fz * toward < 0.5) continue;
        const gap = toward > 0 ? b.minZ - z : z - b.maxZ;
        if (gap > PLAYER.vaultReach || gap < -0.05) continue;
        if (x < b.minX - 0.1 || x > b.maxX + 0.1) continue;
        const tx = Math.max(b.minX + PLAYER.radius, Math.min(x, b.maxX - PLAYER.radius));
        const tz = toward > 0 ? b.maxZ + 0.55 : b.minZ - 0.55;
        if (!this.standingFree(tx, b.minY - 1.0, tz)) continue;
        out.x = tx; out.y = b.minY - 1.0; out.z = tz;
        return true;
      } else {
        const toward = x < op.cx ? 1 : -1;
        if (fx * toward < 0.5) continue;
        const gap = toward > 0 ? b.minX - x : x - b.maxX;
        if (gap > PLAYER.vaultReach || gap < -0.05) continue;
        if (z < b.minZ - 0.1 || z > b.maxZ + 0.1) continue;
        const tz = Math.max(b.minZ + PLAYER.radius, Math.min(z, b.maxZ - PLAYER.radius));
        const tx = toward > 0 ? b.maxX + 0.55 : b.minX - 0.55;
        if (!this.standingFree(tx, b.minY - 1.0, tz)) continue;
        out.x = tx; out.y = b.minY - 1.0; out.z = tz;
        return true;
      }
    }
    // vaultable dynamic solids (shields)
    for (const d of this.dyn.values()) {
      if (!d.vaultable) continue;
      const b = d.box;
      if (Math.abs(y - b.minY) > 0.6) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
      if (alongX) {
        const toward = z < cz ? 1 : -1;
        if (fz * toward < 0.5) continue;
        const gap = toward > 0 ? b.minZ - z : z - b.maxZ;
        if (gap > PLAYER.vaultReach || gap < -0.05) continue;
        if (x < b.minX - 0.2 || x > b.maxX + 0.2) continue;
        const tz = toward > 0 ? b.maxZ + 0.55 : b.minZ - 0.55;
        if (!this.standingFree(x, b.minY, tz)) continue;
        out.x = x; out.y = b.minY; out.z = tz;
        return true;
      } else {
        const toward = x < cx ? 1 : -1;
        if (fx * toward < 0.5) continue;
        const gap = toward > 0 ? b.minX - x : x - b.maxX;
        if (gap > PLAYER.vaultReach || gap < -0.05) continue;
        if (z < b.minZ - 0.2 || z > b.maxZ + 0.2) continue;
        const tx = toward > 0 ? b.maxX + 0.55 : b.minX - 0.55;
        if (!this.standingFree(tx, b.minY, z)) continue;
        out.x = tx; out.y = b.minY; out.z = z;
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Replication
  // -------------------------------------------------------------------------

  private cellDiff(id: number): CellDiff {
    return [id, this.cellAlive[id] ? Math.round(this.cellHp[id] as number) : 0, this.cellReinf[id] as number];
  }

  private openingDiff(id: number): OpeningDiff {
    const op = this.openings[id] as Opening;
    const flags = (op.open ? 1 : 0) | (op.destroyed ? 2 : 0) | (op.barricadeHp > 0 ? 4 : 0);
    return [id, flags, Math.round(op.hp), Math.round(op.barricadeHp)];
  }

  /** Changes since the last flush, or null when nothing changed. */
  flushDiff(): WorldDiff | null {
    if (this.dirtyCells.size === 0 && this.dirtyOpenings.size === 0) return null;
    const c: CellDiff[] = [];
    const o: OpeningDiff[] = [];
    for (const id of this.dirtyCells) c.push(this.cellDiff(id));
    for (const id of this.dirtyOpenings) o.push(this.openingDiff(id));
    this.dirtyCells.clear();
    this.dirtyOpenings.clear();
    return { c, o };
  }

  /** Full state of everything that differs from pristine (for late joiners). */
  fullDiff(): WorldDiff {
    const c: CellDiff[] = [];
    for (let id = 0; id < this.cellCount; id++) {
      if (!this.cellAlive[id] || this.cellReinf[id] || (this.cellHp[id] as number) < (this.cellMaxHp[id] as number)) c.push(this.cellDiff(id));
    }
    const o: OpeningDiff[] = [];
    for (const op of this.openings) o.push(this.openingDiff(op.id));
    return { c, o };
  }

  /** Apply a diff received from the server. Calls onCell/onOpening for each change. */
  applyDiff(d: WorldDiff): void {
    for (const [id, hp, reinf] of d.c) {
      if (id < 0 || id >= this.cellCount) continue;
      if (hp <= 0) {
        if (this.cellAlive[id]) {
          this.cellAlive[id] = 0;
          this.cellHp[id] = 0;
          this.vox[this.cellVox[id] as number] = Vox.AIR;
        }
      } else {
        this.cellHp[id] = hp;
      }
      if (reinf && !this.cellReinf[id]) {
        this.cellReinf[id] = 1;
        const p = this.panels[this.cellPanel[id] as number];
        if (p) p.reinforced = true;
      }
      this.onCell?.(id);
    }
    for (const [id, flags, hp, bhp] of d.o) {
      const op = this.openings[id];
      if (!op) continue;
      op.open = (flags & 1) !== 0;
      op.destroyed = (flags & 2) !== 0;
      op.hp = hp;
      op.barricadeHp = (flags & 4) !== 0 ? Math.max(bhp, 1) : 0;
      this.onOpening?.(id);
    }
  }
}
