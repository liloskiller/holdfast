import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Btn, stateToArray } from './types';
import { arenaMapText } from './testMap';
import { parseMap } from './mapFormat';
import { Vox, World } from './world';
import { run, spawnState } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const safehouse = parseMap(fs.readFileSync(path.join(here, '..', 'maps', 'safehouse.map.txt'), 'utf8'));
const arena = (): World => new World(parseMap(arenaMapText()));

describe('stepPlayer', () => {
  it('is deterministic', () => {
    const w1 = arena();
    const w2 = arena();
    const a = spawnState(5, 0, 5);
    const b = spawnState(5, 0, 5);
    for (let i = 0; i < 300; i++) {
      const o = { moveX: Math.sin(i / 17), moveZ: Math.cos(i / 23), yaw: i * 0.013, buttons: i % 90 < 30 ? Btn.SPRINT : 0 };
      run(a, w1, 1, o);
      run(b, w2, 1, o);
    }
    expect(stateToArray(a)).toEqual(stateToArray(b));
  });

  it('walks at the configured speeds', () => {
    const w = arena();
    const s = spawnState(5, 0, 5, -Math.PI / 2); // facing +x
    run(s, w, 120, { moveZ: 1 });
    expect(s.vx).toBeCloseTo(3.4, 1);
    run(s, w, 60, { moveZ: 1, buttons: Btn.SPRINT });
    expect(s.vx).toBeCloseTo(5.0, 1);
    run(s, w, 60, { moveZ: 1, buttons: Btn.CROUCH });
    expect(s.vx).toBeCloseTo(1.8, 1);
    expect(s.crouch).toBe(true);
  });

  it('never tunnels through walls, even at very high speed', () => {
    const w = arena();
    const s = spawnState(3, 0, 6, Math.PI / 2); // facing -x toward the west fence (tile 0 spans 0..0.5)
    s.spdMul = 6; // 30 m/s sprint
    run(s, w, 200, { moveZ: 1, buttons: Btn.SPRINT });
    expect(s.x).toBeGreaterThanOrEqual(0.85 - 1e-6);
    expect(s.x).toBeLessThan(0.9);
  });

  it('slides along walls', () => {
    const w = arena();
    const s = spawnState(3, 0, 6, Math.PI / 2); // facing -x
    run(s, w, 60, { moveZ: 1, moveX: 1 }); // forward and strafe right (which is -z... toward the north)
    const z0 = s.z;
    run(s, w, 60, { moveZ: 1, moveX: 1 });
    expect(Math.abs(s.z - z0)).toBeGreaterThan(1);
    expect(s.x).toBeGreaterThanOrEqual(0.85 - 1e-6);
  });

  it('stops at a low furniture box but steps up small ledges', () => {
    const w = arena();
    // box of furniture at tiles x=18..18, z=6..7 (world x 9..9.5, z 3..4)
    const s = spawnState(7, 0, 3.5, -Math.PI / 2);
    run(s, w, 200, { moveZ: 1 });
    expect(s.x).toBeLessThan(9 - 0.35 + 1e-3);
    expect(s.y).toBe(0);
  });

  it('climbs the Safehouse stairs to the upper floor and walks down again', () => {
    const w = new World(safehouse);
    const st = safehouse.stairs[0]!;
    const z = (st.z0 + 1.5) * 0.5;
    const s = spawnState((st.x0 - 1.5) * 0.5, 0, z, -Math.PI / 2);
    const startX = s.x;
    run(s, w, 420, { moveZ: 1 });
    expect(s.x).toBeGreaterThan((st.x1 + 1) * 0.5);
    expect(s.y).toBeGreaterThan(2.9);
    expect(s.y).toBeLessThan(3.1);
    expect(s.onGround).toBe(true);
    // turn around and descend
    s.yaw = Math.PI / 2;
    run(s, w, 480, { moveZ: 1, yaw: Math.PI / 2 });
    expect(s.y).toBeLessThan(0.05);
    expect(s.x).toBeLessThan(startX + 1);
  });

  it('crouching fits under a 1.5 m gap, standing does not', () => {
    const mk = (): World => {
      const w = arena();
      // beam across the arena at tile x=20, layers 3..5 (y 1.5 to 3.0) for z tiles 3..20
      for (let z = 3; z <= 20; z++) for (let l = 3; l <= 5; l++) w.vox[(l * w.nz + z) * w.nx + 20] = Vox.STATIC;
      return w;
    };
    const standing = spawnState(8, 0, 4.5, -Math.PI / 2);
    run(standing, mk(), 240, { moveZ: 1 });
    expect(standing.x).toBeLessThan(10 - 0.35 + 1e-3);

    const crouching = spawnState(8, 0, 4.5, -Math.PI / 2);
    run(crouching, mk(), 240, { moveZ: 1, buttons: Btn.CROUCH });
    expect(crouching.x).toBeGreaterThan(10.6);
    // and cannot stand up under the beam
    run(crouching, mk(), 3, { buttons: 0, moveZ: 0 });
  });

  it('cannot stand up while crouched under a low ceiling', () => {
    const w = arena();
    for (let z = 3; z <= 20; z++) for (let l = 3; l <= 5; l++) w.vox[(l * w.nz + z) * w.nx + 20] = Vox.STATIC;
    const s = spawnState(10.25, 0, 4.5, -Math.PI / 2);
    run(s, w, 5, { buttons: Btn.CROUCH });
    expect(s.crouch).toBe(true);
    run(s, w, 5, {});
    expect(s.crouch).toBe(true);
    s.x = 8;
    run(s, w, 5, {});
    expect(s.crouch).toBe(false);
  });

  it('falls through a broken hatch', () => {
    const w = new World(safehouse);
    const h = w.hatches[1]!; // master bedroom over the kitchen
    const s = spawnState(h.cx, 3.0, h.cz);
    run(s, w, 30, {});
    expect(s.y).toBeCloseTo(3.0, 2);
    for (const id of h.cellIds) w.damageCell(id, 1000);
    run(s, w, 120, {});
    expect(s.y).toBeLessThan(0.05);
    expect(s.onGround).toBe(true);
  });

  it('vaults through a broken window and not through an intact one', () => {
    const w = new World(safehouse);
    const win = w.openings.find((o) => o.kind === 'window' && o.floor === 0 && !o.alongX && o.box.minX < 5.1)!;
    const s = spawnState(win.box.maxX + 0.4, 0, win.cz, Math.PI / 2); // inside, facing west
    const tap = (st: typeof s): void => {
      run(st, w, 4, { buttons: Btn.INTERACT, yaw: Math.PI / 2 });
      run(st, w, 2, { buttons: 0, yaw: Math.PI / 2 });
    };
    tap(s);
    expect(s.vault).toBe(0);
    for (const g of win.glass) w.damageCell(g, 100);
    tap(s);
    expect(s.vault).toBeGreaterThan(0);
    run(s, w, 50, { yaw: Math.PI / 2 });
    expect(s.vault).toBe(0);
    expect(s.x).toBeLessThan(win.box.minX);
    expect(s.onGround).toBe(true);
  });

  it('confines attackers outside the building', () => {
    const w = new World(safehouse);
    const s = spawnState(12, 0, 12);
    s.confined = true;
    run(s, w, 2, {});
    const b = safehouse.building;
    const inside = s.x > b.x0 * 0.5 - 0.35 && s.x < b.x1 * 0.5 + 0.35 && s.z > b.z0 * 0.5 - 0.35 && s.z < b.z1 * 0.5 + 0.35;
    expect(inside).toBe(false);
  });

  it('drone flies, collides with walls and does not move the body', () => {
    const w = arena();
    const s = spawnState(5, 0, 5, -Math.PI / 2);
    s.dDeployed = true;
    s.dx = 5; s.dy = 1.5; s.dz = 5;
    run(s, w, 2, { buttons: Btn.DRONE });
    expect(s.dCtl).toBe(true);
    run(s, w, 180, { moveZ: 1, buttons: 0 });
    expect(s.dx).toBeGreaterThan(8);
    expect(s.x).toBe(5);
    s.dx = 5;
    run(s, w, 800, { moveZ: 1, yaw: Math.PI / 2 });
    expect(s.dx).toBeGreaterThanOrEqual(0.5 + 0.15 - 1e-6);
  });
});
