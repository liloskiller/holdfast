import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkMap } from './mapCheck';
import { MapError, parseMap } from './mapFormat';
import { arenaMapText } from './testMap';

const here = path.dirname(fileURLToPath(import.meta.url));
const safehouse = fs.readFileSync(path.join(here, '..', 'maps', 'safehouse.map.txt'), 'utf8');

describe('map parser', () => {
  it('parses the Safehouse map with the expected structure', () => {
    const map = parseMap(safehouse);
    expect(map.name).toBe('Safehouse');
    expect(map.floorCount).toBe(2);
    expect(map.floors[0]).toHaveLength(map.nz);
    expect(map.floors[0]![0]).toHaveLength(map.nx);
    expect(map.objectives.map((o) => o.name)).toEqual(['Kitchen', 'Study']);
    expect(map.objectives[0]!.floor).toBe(0);
    expect(map.objectives[1]!.floor).toBe(1);
    expect(map.attackerSpawns.length).toBeGreaterThanOrEqual(5);
    expect(new Set(map.attackerSpawns.map((s) => s.name))).toEqual(new Set(['Back', 'Side', 'Front']));
    expect(map.defenderSpawns.length).toBeGreaterThanOrEqual(6);
    expect(map.droneSpawns).toHaveLength(4);
    expect(map.hatches).toHaveLength(4);
    expect(map.stairs).toHaveLength(1);
    expect(map.stairs[0]!.length).toBe(11);
  });

  it('every tile is inside the grid bounds and spawns are in range', () => {
    const map = parseMap(safehouse);
    for (const s of [...map.attackerSpawns, ...map.defenderSpawns]) {
      expect(s.tx).toBeGreaterThanOrEqual(0);
      expect(s.tx).toBeLessThan(map.nx);
      expect(s.tz).toBeGreaterThanOrEqual(0);
      expect(s.tz).toBeLessThan(map.nz);
    }
  });

  it('passes the full map check (reachability, counts, spawns)', () => {
    const rep = checkMap(parseMap(safehouse));
    expect(rep.errors).toEqual([]);
    expect(rep.stats['panels']).toBeGreaterThanOrEqual(6);
    expect(rep.stats['windows']).toBeGreaterThanOrEqual(8);
  });

  it('parses the arena', () => {
    const map = parseMap(arenaMapText());
    expect(map.floorCount).toBe(1);
    expect(checkMap(map, { requireFeatures: false }).errors).toEqual([]);
  });

  it('rejects bad input', () => {
    expect(() => parseMap('name: x\n--- floor 0 ---\n..\n.')).toThrow(MapError);
    expect(() => parseMap('name: x\n--- floor 0 ---\n.?\n..')).toThrow(/unknown tile/);
    expect(() => parseMap('size: 3 3\n--- floor 0 ---\n..\n..')).toThrow(/does not match/);
    const noPair = 'floors: 2\n--- floor 0 ---\n..\n..\n--- floor 1 ---\nh.\n..';
    expect(() => parseMap(noPair)).toThrow(/no 'c' below/);
  });
});
