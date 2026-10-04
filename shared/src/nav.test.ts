import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from './constants';
import { parseMap } from './mapFormat';
import { NavGrid } from './nav';
import { makeStepOut, stepPlayer } from './movement';
import { arenaMapText } from './testMap';
import { cmdFor, spawnState } from './testUtil';
import { World } from './world';

const here = path.dirname(fileURLToPath(import.meta.url));
const safehouse = parseMap(fs.readFileSync(path.join(here, '..', 'maps', 'safehouse.map.txt'), 'utf8'));

describe('NavGrid', () => {
  const world = new World(safehouse);
  const nav = new NavGrid(world);

  it('finds a path from every spawn to every objective, upstairs included', () => {
    const spawns = [...safehouse.attackerSpawns, ...safehouse.defenderSpawns];
    for (const o of safehouse.objectives) {
      const gx = (o.minX + o.maxX) / 2;
      const gz = (o.minZ + o.maxZ) / 2;
      for (const s of spawns) {
        const p = nav.path(s.x, s.y, s.z, gx, o.y, gz);
        expect(p, `${s.name} -> ${o.name}`).not.toBeNull();
        expect(p!.n).toBeGreaterThan(1);
      }
    }
  });

  it('paths on the upper floor leave the ground floor only through the stairs', () => {
    const o = safehouse.objectives.find((x) => x.floor === 1);
    expect(o).toBeDefined();
    const s = safehouse.defenderSpawns.find((d) => d.floor === 0)!;
    const p = nav.path(s.x, s.y, s.z, (o!.minX + o!.maxX) / 2, o!.y, (o!.minZ + o!.maxZ) / 2)!;
    expect(p.floor[0]).toBe(0);
    expect(p.floor[p.n - 1]).toBe(1);
    const changes = p.floor.filter((f, i) => i > 0 && f !== p.floor[i - 1]).length;
    expect(changes).toBe(1);
  });

  it('never routes through a window or a solid tile', () => {
    for (const op of world.openings) {
      if (op.kind !== 'window') continue;
      for (const [tx, tz] of op.tiles) {
        // none of the four nodes around a window tile are walkable
        for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          expect(nav.nodeOk(op.floor, tx + ox, tz + oz)).toBe(false);
        }
      }
    }
  });

  it('paths start and end where asked and avoid null input', () => {
    const s = safehouse.attackerSpawns[0]!;
    expect(nav.findPath(-1, 5)).toBeNull();
    const p = nav.path(s.x, s.y, s.z, s.x, s.y, s.z)!;
    expect(p.n).toBe(1);
  });

  it('a simulated player can really walk the paths (doors open), stairs included', () => {
    const w = new World(safehouse);
    for (const op of w.openings) if (op.kind === 'door') w.setDoorOpen(op.id, true);
    const n = new NavGrid(w);
    const o = safehouse.objectives.find((x) => x.floor === 1)!;
    const start = safehouse.attackerSpawns[0]!;
    const goal = { x: (o.minX + o.maxX) / 2, y: o.y, z: (o.minZ + o.maxZ) / 2 };
    const p = n.path(start.x, start.y, start.z, goal.x, goal.y, goal.z)!;
    expect(p).not.toBeNull();
    const s = spawnState(start.x, start.y, start.z, 0);
    const out = makeStepOut();
    let wp = 1;
    let steps = 0;
    while (wp < p.n && steps < 60 * 90) {
      const tx = p.xz[wp * 2] as number;
      const tz = p.xz[wp * 2 + 1] as number;
      const dx = tx - s.x;
      const dz = tz - s.z;
      if (Math.hypot(dx, dz) < 0.35) {
        wp++;
        continue;
      }
      stepPlayer(s, cmdFor(s, { moveZ: 1, yaw: Math.atan2(-dx, -dz) }), w, SIM_DT, out);
      steps++;
    }
    expect(wp).toBe(p.n);
    expect(Math.hypot(s.x - goal.x, s.z - goal.z)).toBeLessThan(1);
    expect(s.y).toBeGreaterThan(2.5); // on the upper floor
  });

  it('works on the open arena too', () => {
    const w = new World(parseMap(arenaMapText()));
    const n = new NavGrid(w);
    const p = n.path(3, 0, 5, 17, 0, 12)!;
    expect(p).not.toBeNull();
    expect(p.n).toBeGreaterThan(1);
    const r = n.randomNear(10, 0, 10, 3, () => 0.5);
    expect(r).toBeGreaterThanOrEqual(0);
  });
});
