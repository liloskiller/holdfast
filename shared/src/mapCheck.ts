// Map validation: reachability with a player sized footprint, spawn sanity, feature counts.

import { FLOOR_H, LAYERS_PER_FLOOR, PLAYER, TILE, WALL_LAYERS } from './constants';
import type { MapData } from './mapFormat';
import { stairVec } from './mapFormat';
import { Vox, World } from './world';

export interface MapReport {
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
}

export function checkMap(map: MapData, opts: { requireFeatures?: boolean } = {}): MapReport {
  const strict = opts.requireFeatures ?? true;
  const errors: string[] = [];
  const warnings: string[] = [...map.warnings];
  const world = new World(map);
  const { nx, nz } = map;

  // ---- feature counts ----
  const windows = world.openings.filter((o) => o.kind === 'window').length;
  const doors = world.openings.filter((o) => o.kind === 'door').length;
  const attackerGroups = new Set(map.attackerSpawns.map((s) => s.name)).size;
  const stats: Record<string, number> = {
    nx, nz, floors: map.floorCount, cells: world.cellCount, panels: world.panels.length,
    hatches: world.hatches.length, windows, doors, objectives: map.objectives.length,
    attackerSpawns: map.attackerSpawns.length, attackerGroups, defenderSpawns: map.defenderSpawns.length,
    droneSpawns: map.droneSpawns.length, stairs: map.stairs.length,
  };
  if (strict && world.panels.length < 6) errors.push(`Need at least 6 reinforceable panels, found ${world.panels.length}`);
  if (strict && world.hatches.length < 4) errors.push(`Need at least 4 hatches, found ${world.hatches.length}`);
  if (strict && windows < 8) errors.push(`Need at least 8 windows, found ${windows}`);
  if (strict && attackerGroups < 3) errors.push(`Need at least 3 attacker spawn groups, found ${attackerGroups}`);
  if (strict && map.defenderSpawns.length < 6) errors.push(`Need at least 6 defender spawns, found ${map.defenderSpawns.length}`);
  if (strict && map.droneSpawns.length < 4) errors.push(`Need at least 4 drone spawns, found ${map.droneSpawns.length}`);
  if (map.objectives.length < 1) errors.push('No objective sites');

  // ---- bounds and spawn sanity ----
  const b = map.building;
  for (const s of [...map.attackerSpawns, ...map.defenderSpawns]) {
    if (s.tx < 0 || s.tz < 0 || s.tx >= nx || s.tz >= nz) errors.push(`Spawn ${s.name} out of bounds`);
    else if (!world.standingFree(s.x, s.y, s.z)) errors.push(`Spawn ${s.name} at tile (${s.tx},${s.tz}) f${s.floor} is inside a solid`);
  }
  for (const s of map.attackerSpawns) {
    const inside = s.tx >= b.x0 && s.tx < b.x1 && s.tz >= b.z0 && s.tz < b.z1;
    if (inside) errors.push(`Attacker spawn ${s.name} (${s.tx},${s.tz}) is inside the building`);
  }
  for (const s of map.defenderSpawns) {
    const inside = s.tx >= b.x0 && s.tx < b.x1 && s.tz >= b.z0 && s.tz < b.z1;
    if (strict && !inside) errors.push(`Defender spawn (${s.tx},${s.tz}) is outside the building`);
  }
  for (const d of map.droneSpawns) {
    if (world.isSolidAt(d.x, d.y, d.z)) errors.push(`Drone spawn ${d.name} is inside a solid`);
  }

  // ---- reachability with a 1 m footprint (2x2 tiles) ----
  const passable = (f: number, x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= nx || z >= nz) return false;
    const base = f * LAYERS_PER_FLOOR;
    for (let k = 0; k < 4; k++) if (world.vox[(((base + k) * nz) + z) * nx + x] !== Vox.AIR) return false;
    if (f > 0) {
      const below = (((f - 1) * LAYERS_PER_FLOOR + WALL_LAYERS) * nz + z) * nx + x;
      if (world.vox[below] === Vox.AIR) return false; // no floor (void or stair hole)
    }
    return true;
  };
  // Node (f, vx, vz): footprint tiles (vx-1..vx, vz-1..vz)
  const nodeOk = (f: number, vx: number, vz: number): boolean =>
    passable(f, vx - 1, vz - 1) && passable(f, vx, vz - 1) && passable(f, vx - 1, vz) && passable(f, vx, vz);
  const idx = (f: number, vx: number, vz: number): number => (f * (nz + 1) + vz) * (nx + 1) + vx;
  const seen = new Uint8Array(map.floorCount * (nx + 1) * (nz + 1));
  const stack: number[] = [];
  const push = (f: number, vx: number, vz: number): void => {
    if (vx < 1 || vz < 1 || vx > nx || vz > nz) return;
    const i = idx(f, vx, vz);
    if (seen[i] || !nodeOk(f, vx, vz)) return;
    seen[i] = 1;
    stack.push(f, vx, vz);
  };

  // Stair links: nodes whose footprint overlaps a stair top-end tile link to the upper floor beyond the top.
  const stairLinks = new Map<number, [number, number, number]>();
  for (const st of map.stairs) {
    const [dx, dz] = stairVec(st.dir);
    const topTiles: [number, number][] = [];
    for (let z = st.z0; z <= st.z1; z++) {
      for (let x = st.x0; x <= st.x1; x++) {
        const i = dx !== 0 ? (dx > 0 ? x - st.x0 : st.x1 - x) : (dz > 0 ? z - st.z0 : st.z1 - z);
        if (i === st.length - 1) topTiles.push([x, z]);
      }
    }
    for (const [tx, tz] of topTiles) {
      for (let ox = 0; ox <= 1; ox++) {
        for (let oz = 0; oz <= 1; oz++) {
          const vx = tx + ox;
          const vz = tz + oz;
          stairLinks.set(idx(st.floor, vx, vz), [st.floor + 1, vx + dx, vz + dz]);
        }
      }
    }
  }
  const stairHoleTiles = new Set<string>();
  for (const st of map.stairs) {
    for (let z = st.z0; z <= st.z1; z++) for (let x = st.x0; x <= st.x1; x++) stairHoleTiles.add(`${st.floor}:${x}:${z}`);
  }
  // F0 stair tiles are steps: they are voxel-free so they count as passable on the lower floor already.

  const start = map.attackerSpawns[0];
  if (start) {
    for (const s of map.attackerSpawns) push(s.floor, s.tx + 1, s.tz + 1);
    const reverse = new Map<number, number>();
    for (const [k, v] of stairLinks) reverse.set(idx(v[0], v[1], v[2]), k);
    while (stack.length) {
      const vz = stack.pop() as number;
      const vx = stack.pop() as number;
      const f = stack.pop() as number;
      push(f, vx + 1, vz);
      push(f, vx - 1, vz);
      push(f, vx, vz + 1);
      push(f, vx, vz - 1);
      const up = stairLinks.get(idx(f, vx, vz));
      if (up) push(up[0], up[1], up[2]);
      const down = reverse.get(idx(f, vx, vz));
      if (down !== undefined) {
        const per = (nz + 1) * (nx + 1);
        const df = Math.floor(down / per);
        const rem = down - df * per;
        push(df, rem % (nx + 1), Math.floor(rem / (nx + 1)));
      }
    }

    const reached = (f: number, tx: number, tz: number): boolean =>
      seen[idx(f, tx, tz)] === 1 || seen[idx(f, tx + 1, tz)] === 1 || seen[idx(f, tx, tz + 1)] === 1 || seen[idx(f, tx + 1, tz + 1)] === 1;

    for (const o of map.objectives) {
      const missing = o.tiles.filter(([x, z]) => !reached(o.floor, x, z));
      if (missing.length) errors.push(`Objective ${o.name}: ${missing.length} of ${o.tiles.length} tiles unreachable from attacker spawns`);
    }
    for (const s of map.defenderSpawns) {
      if (!reached(s.floor, s.tx, s.tz)) errors.push(`Defender spawn (${s.tx},${s.tz}) f${s.floor} unreachable from attackers`);
    }
    // every attacker group must connect
    for (const s of map.attackerSpawns) {
      if (!reached(s.floor, s.tx, s.tz)) errors.push(`Attacker spawn ${s.name} (${s.tx},${s.tz}) cannot reach the building`);
    }
    // all rooms reachable: count unreachable walkable tiles (excluding yard void) as a warning
    let isolated = 0;
    const isoList: string[] = [];
    for (let f = 0; f < map.floorCount; f++) {
      for (let z = b.z0; z < b.z1; z++) {
        for (let x = b.x0; x < b.x1; x++) {
          if (stairHoleTiles.has(`${f}:${x}:${z}`) && f > 0) continue;
          if (passable(f, x, z) && !reached(f, x, z)) {
            // only count tiles that could host a 1 m footprint at all
            const anyNode = nodeOk(f, x, z) || nodeOk(f, x + 1, z) || nodeOk(f, x, z + 1) || nodeOk(f, x + 1, z + 1);
            if (anyNode) {
              isolated++;
              if (isoList.length < 10) isoList.push(`f${f}(${x - b.x0},${z - b.z0})`);
            }
          }
        }
      }
    }
    if (isolated > 0) warnings.push(`${isolated} walkable tiles are not reachable by a 1 m wide path, e.g. ${isoList.join(' ')} (building-local coords)`);
    stats['isolatedTiles'] = isolated;
  }

  // ---- hatch headroom: hatch cell must have walkable space above and below ----
  for (const h of map.hatches) {
    for (const [x, z] of h.tiles) {
      if (!passable(h.floor - 1, x, z) && h.floor - 1 >= 0) {
        // below is the ceiling hatch marker tile, should be free floor
        warnings.push(`Hatch at (${x},${z}) f${h.floor}: tile below is not open`);
      }
    }
  }

  void FLOOR_H; void TILE; void PLAYER;
  return { errors, warnings, stats };
}
