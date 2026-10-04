// ASCII map format parser. See PLAN.md section 5.8 for the legend.

import { DRONE, FLOOR_H, TILE } from './constants';

export const LEGEND = '.#WPBRgDdhcsSfFAYOx';

export type StairDir = 'N' | 'S' | 'E' | 'W';

export interface SpawnPoint {
  name: string;
  floor: number;
  tx: number;
  tz: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ObjectiveSite {
  name: string;
  floor: number;
  tiles: [number, number][];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  y: number;
}

export interface StairDef {
  floor: number;
  dir: StairDir;
  x0: number;
  z0: number;
  x1: number; // inclusive
  z1: number; // inclusive
  length: number; // tiles along the climb direction
  width: number;
  stepHeight: number;
}

export interface HatchDef {
  floor: number; // upper floor index (the hatch sits in its floor slab)
  tiles: [number, number][];
}

export interface NamedPoint {
  name: string;
  floor: number;
  tx: number;
  tz: number;
  x: number;
  y: number;
  z: number;
}

export interface BuildingRect {
  x0: number;
  z0: number;
  x1: number; // exclusive
  z1: number; // exclusive
}

export interface MapData {
  name: string;
  tile: number;
  floorHeight: number;
  nx: number;
  nz: number;
  floorCount: number;
  floors: string[][];
  building: BuildingRect;
  objectives: ObjectiveSite[];
  attackerSpawns: SpawnPoint[];
  defenderSpawns: SpawnPoint[];
  droneSpawns: NamedPoint[];
  cameraSpots: NamedPoint[];
  stairs: StairDef[];
  hatches: HatchDef[];
  warnings: string[];
}

export class MapError extends Error {}

/** Minimal tile step used by the stairs: climbing direction as dx, dz. */
export function stairVec(dir: StairDir): [number, number] {
  switch (dir) {
    case 'E': return [1, 0];
    case 'W': return [-1, 0];
    case 'S': return [0, 1];
    default: return [0, -1];
  }
}

export function tileAt(map: MapData, floor: number, x: number, z: number): string {
  if (floor < 0 || floor >= map.floorCount || x < 0 || z < 0 || x >= map.nx || z >= map.nz) return 'x';
  return (map.floors[floor] as string[])[z]!.charAt(x);
}

type Tiles = [number, number][];

function components(
  map: { nx: number; nz: number; floors: string[][] },
  floor: number,
  chars: string,
  eight: boolean,
): Tiles[] {
  const seen = new Uint8Array(map.nx * map.nz);
  const out: Tiles[] = [];
  const rows = map.floors[floor] as string[];
  for (let z = 0; z < map.nz; z++) {
    for (let x = 0; x < map.nx; x++) {
      if (seen[z * map.nx + x] || !chars.includes(rows[z]!.charAt(x))) continue;
      const comp: Tiles = [];
      const stack: [number, number][] = [[x, z]];
      seen[z * map.nx + x] = 1;
      while (stack.length) {
        const [cx, cz] = stack.pop() as [number, number];
        comp.push([cx, cz]);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dz === 0) || (!eight && dx !== 0 && dz !== 0)) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= map.nx || nz >= map.nz) continue;
            if (seen[nz * map.nx + nx] || !chars.includes(rows[nz]!.charAt(nx))) continue;
            seen[nz * map.nx + nx] = 1;
            stack.push([nx, nz]);
          }
        }
      }
      comp.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      out.push(comp);
    }
  }
  return out;
}

export function parseMap(text: string): MapData {
  const lines = text.replace(/\r/g, '').split('\n');
  const header: Record<string, string[]> = {};
  const floorBlocks: string[][] = [];
  let current: string[] | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const fm = /^---\s*floor\s+(\d+)\s*---$/i.exec(line);
    if (fm) {
      const idx = Number(fm[1]);
      if (idx !== floorBlocks.length) throw new MapError(`Floor blocks must be in order, got floor ${idx}`);
      current = [];
      floorBlocks.push(current);
      continue;
    }
    if (current === null) {
      if (line === '' || line.startsWith('//')) continue;
      const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line);
      if (!m) throw new MapError(`Bad header line: "${line}"`);
      const key = (m[1] as string).toLowerCase();
      (header[key] ??= []).push((m[2] as string).trim());
    } else {
      if (line === '' || line.startsWith('//')) continue;
      current.push(line);
    }
  }

  if (floorBlocks.length === 0) throw new MapError('No floor blocks found');
  const nz = (floorBlocks[0] as string[]).length;
  const nx = ((floorBlocks[0] as string[])[0] as string).length;
  for (let f = 0; f < floorBlocks.length; f++) {
    const rows = floorBlocks[f] as string[];
    if (rows.length !== nz) throw new MapError(`Floor ${f} has ${rows.length} rows, expected ${nz}`);
    for (let z = 0; z < rows.length; z++) {
      const r = rows[z] as string;
      if (r.length !== nx) throw new MapError(`Floor ${f} row ${z} has width ${r.length}, expected ${nx}`);
      for (let x = 0; x < r.length; x++) {
        if (!LEGEND.includes(r.charAt(x))) {
          throw new MapError(`Floor ${f} row ${z} col ${x}: unknown tile '${r.charAt(x)}'`);
        }
      }
    }
  }

  const one = (k: string): string | undefined => header[k]?.[0];
  const tile = Number(one('tile') ?? TILE);
  const floorHeight = Number(one('floor_height') ?? FLOOR_H);
  if (Math.abs(tile - TILE) > 1e-9) throw new MapError(`Unsupported tile size ${tile}`);
  if (Math.abs(floorHeight - FLOOR_H) > 1e-9) throw new MapError(`Unsupported floor height ${floorHeight}`);
  if (header['size']) {
    const [sx, sz] = (one('size') as string).split(/\s+/).map(Number);
    if (sx !== nx || sz !== nz) throw new MapError(`Header size ${sx}x${sz} does not match grid ${nx}x${nz}`);
  }
  if (header['floors'] && Number(one('floors')) !== floorBlocks.length) {
    throw new MapError(`Header floors ${one('floors')} does not match ${floorBlocks.length} blocks`);
  }

  let building: BuildingRect = { x0: 0, z0: 0, x1: nx, z1: nz };
  if (header['building']) {
    const [x0, z0, x1, z1] = (one('building') as string).split(/\s+/).map(Number) as [number, number, number, number];
    building = { x0, z0, x1, z1 };
  }

  const map: MapData = {
    name: one('name') ?? 'Unnamed',
    tile,
    floorHeight,
    nx,
    nz,
    floorCount: floorBlocks.length,
    floors: floorBlocks,
    building,
    objectives: [],
    attackerSpawns: [],
    defenderSpawns: [],
    droneSpawns: [],
    cameraSpots: [],
    stairs: [],
    hatches: [],
    warnings: [],
  };

  const centerX = ((building.x0 + building.x1) / 2) * TILE;
  const centerZ = ((building.z0 + building.z1) / 2) * TILE;
  const faceCenter = (x: number, z: number): number => Math.atan2(-(centerX - x), -(centerZ - z));

  // Objectives: connected `O` groups, named in header order (by floor, then row-major).
  const objNames = header['objective'] ?? [];
  let objIdx = 0;
  for (let f = 0; f < map.floorCount; f++) {
    for (const comp of components(map, f, 'O', false)) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of comp) {
        minX = Math.min(minX, x); minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
      }
      map.objectives.push({
        name: objNames[objIdx] ?? `Site ${objIdx + 1}`,
        floor: f,
        tiles: comp,
        minX: minX * TILE, minZ: minZ * TILE, maxX: (maxX + 1) * TILE, maxZ: (maxZ + 1) * TILE,
        y: f * FLOOR_H,
      });
      objIdx++;
    }
  }
  if (objNames.length && objNames.length !== map.objectives.length) {
    map.warnings.push(`Header lists ${objNames.length} objectives but map has ${map.objectives.length} sites`);
  }

  // Attacker spawns: each `A` tile, grouped (8-connected) and named in header order.
  const aNames = header['attacker'] ?? [];
  for (let f = 0; f < map.floorCount; f++) {
    components(map, f, 'A', true).forEach((comp, gi) => {
      for (const [tx, tz] of comp) {
        const x = (tx + 0.5) * TILE;
        const z = (tz + 0.5) * TILE;
        map.attackerSpawns.push({
          name: aNames[gi] ?? `Spawn ${gi + 1}`, floor: f, tx, tz, x, y: f * FLOOR_H, z, yaw: faceCenter(x, z),
        });
      }
    });
    components(map, f, 'Y', false).forEach((comp, gi) => {
      for (const [tx, tz] of comp) {
        const x = (tx + 0.5) * TILE;
        const z = (tz + 0.5) * TILE;
        map.defenderSpawns.push({
          name: `Defender ${f}.${gi}`, floor: f, tx, tz, x, y: f * FLOOR_H, z, yaw: faceCenter(x, z) + Math.PI,
        });
      }
    });
  }

  for (const line of header['drone'] ?? []) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)$/.exec(line);
    if (!m) throw new MapError(`Bad drone line: ${line}`);
    const tx = Number(m[2]);
    const tz = Number(m[3]);
    map.droneSpawns.push({ name: m[1] as string, floor: 0, tx, tz, x: (tx + 0.5) * TILE, y: DRONE.halfH + 0.01, z: (tz + 0.5) * TILE });
  }
  for (const line of header['camera'] ?? []) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(line);
    if (!m) throw new MapError(`Bad camera line: ${line}`);
    const floor = Number(m[2]);
    const tx = Number(m[3]);
    const tz = Number(m[4]);
    map.cameraSpots.push({ name: m[1] as string, floor, tx, tz, x: (tx + 0.5) * TILE, y: floor * FLOOR_H + 2.2, z: (tz + 0.5) * TILE });
  }

  // Stairs
  for (const line of header['stairs'] ?? []) {
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+([NSEW])$/.exec(line);
    if (!m) throw new MapError(`Bad stairs line: ${line}`);
    const floor = Number(m[1]);
    const sx = Number(m[2]);
    const sz = Number(m[3]);
    const dir = m[4] as StairDir;
    const comp = components(map, floor, 's', false).find((c) => c.some(([x, z]) => x === sx && z === sz));
    if (!comp) throw new MapError(`Stairs at floor ${floor} (${sx},${sz}) has no 's' tiles`);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of comp) {
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    const w = x1 - x0 + 1;
    const d = z1 - z0 + 1;
    if (w * d !== comp.length) throw new MapError(`Stairs at (${sx},${sz}) are not a rectangle`);
    const length = dir === 'E' || dir === 'W' ? w : d;
    const width = dir === 'E' || dir === 'W' ? d : w;
    if (length < 10) throw new MapError(`Stairs at (${sx},${sz}) need at least 10 tiles of run, got ${length}`);
    const stepHeight = (FLOOR_H - 0.25) / length;
    if (floor + 1 >= map.floorCount) throw new MapError(`Stairs at floor ${floor} lead nowhere`);
    for (const [x, z] of comp) {
      if (tileAt(map, floor + 1, x, z) !== 'S') throw new MapError(`Stairs at (${x},${z}) missing 'S' above`);
    }
    map.stairs.push({ floor, dir, x0, z0, x1, z1, length, width, stepHeight });
  }
  // Any `s` tile must belong to a declared stair.
  for (let f = 0; f < map.floorCount; f++) {
    for (const comp of components(map, f, 's', false)) {
      const ok = map.stairs.some((s) => s.floor === f && comp.every(([x, z]) => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1));
      if (!ok) throw new MapError(`'s' tiles at floor ${f} (${comp[0]![0]},${comp[0]![1]}) have no stairs header line`);
    }
  }

  // Hatches: `h` on floor F must have `c` on floor F-1 at the same tile and vice versa.
  for (let f = 0; f < map.floorCount; f++) {
    for (const comp of components(map, f, 'h', false)) {
      if (f === 0) throw new MapError('Hatch (h) on floor 0 has nothing below');
      for (const [x, z] of comp) {
        if (tileAt(map, f - 1, x, z) !== 'c') throw new MapError(`Hatch at floor ${f} (${x},${z}) has no 'c' below`);
      }
      map.hatches.push({ floor: f, tiles: comp });
    }
    for (const comp of components(map, f, 'c', false)) {
      for (const [x, z] of comp) {
        if (tileAt(map, f + 1, x, z) !== 'h') throw new MapError(`Ceiling hatch marker at floor ${f} (${x},${z}) has no 'h' above`);
      }
    }
  }

  if (map.attackerSpawns.length === 0) map.warnings.push('No attacker spawns (A)');
  if (map.defenderSpawns.length === 0) map.warnings.push('No defender spawns (Y)');
  return map;
}
