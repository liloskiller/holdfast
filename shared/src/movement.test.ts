import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Btn, stateToArray, type PlayerState } from './types';
import { DRONE, SIM_DT } from './constants';
import { makeStepOut, stepPlayer } from './movement';
import { arenaMapText } from './testMap';
import { parseMap } from './mapFormat';
import { Vox, World } from './world';
import { cmdFor, run, spawnState } from './testUtil';

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

  describe('drone (grounded RC car)', () => {
    const lipBox = (id: number, minX: number, maxX: number, h: number): Parameters<World['addDyn']>[0] => ({
      id, hp: 1, maxHp: 1, team: 0, kind: 0, vaultable: false, blocksMove: true,
      box: { minX, minY: 0, minZ: 4, maxX, maxY: h, maxZ: 8 },
    });
    const deploy = (w: World, x = 5, y: number = DRONE.halfH + 0.01, z = 5): PlayerState => {
      const s = spawnState(5, 0, 5, -Math.PI / 2); // faces +x
      s.dDeployed = true;
      s.dx = x; s.dy = y; s.dz = z;
      run(s, w, 2, { buttons: Btn.DRONE });
      return s;
    };

    it('toggles control, drives on the floor and does not move the body', () => {
      const w = arena();
      const s = deploy(w);
      expect(s.dCtl).toBe(true);
      run(s, w, 120, { moveZ: 1, buttons: 0 });
      expect(s.dx).toBeGreaterThan(8);
      expect(s.dy).toBeCloseTo(DRONE.halfH, 2); // still rolling on the floor
      expect(Math.hypot(s.dvx, s.dvz)).toBeCloseTo(DRONE.speed, 1);
      expect(s.x).toBe(5);
    });

    it('falls to the floor under gravity and cannot fly', () => {
      const w = arena();
      const s = deploy(w, 5, 1.5, 5);
      run(s, w, 90, {});
      expect(s.dy).toBeCloseTo(DRONE.halfH, 2);
      // holding every vertical button does nothing but a hop
      run(s, w, 60, { buttons: Btn.DOWN });
      expect(s.dy).toBeCloseTo(DRONE.halfH, 2);
    });

    it('collides with the arena fence', () => {
      const w = arena();
      const s = deploy(w);
      run(s, w, 800, { moveZ: 1, yaw: Math.PI / 2 });
      expect(s.dx).toBeGreaterThanOrEqual(0.5 + DRONE.halfW - 1e-6);
    });

    it('hops about 0.6 m, once per press, and not while airborne', () => {
      const w = arena();
      const s = deploy(w);
      const floorY = s.dy;
      let apex = floorY;
      let hops = 0;
      const out = makeStepOut();
      // press once, keep it held: only one hop
      for (let i = 0; i < 90; i++) {
        stepPlayer(s, cmdFor(s, { buttons: Btn.UP }), w, SIM_DT, out);
        if (out.droneHop) hops++;
        apex = Math.max(apex, s.dy);
      }
      expect(hops).toBe(1);
      expect(apex - floorY).toBeGreaterThan(0.5);
      expect(apex - floorY).toBeLessThan(0.65);
      expect(s.dy).toBeCloseTo(floorY, 2);
      // a second press in mid air does nothing
      run(s, w, 1, { buttons: 0 });
      run(s, w, 1, { buttons: Btn.UP });
      run(s, w, 6, { buttons: 0 });
      const h1 = s.dy;
      run(s, w, 1, { buttons: Btn.UP });
      run(s, w, 1, { buttons: 0 });
      expect(s.dvy).toBeLessThan(DRONE.hopSpeed - 0.5);
      expect(h1).toBeGreaterThan(floorY);
    });

    it('rolls over a tiny lip, is stopped by a taller one, and hops onto it', () => {
      const w = arena();
      w.addDyn(lipBox(900, 8, 8.5, 0.08)); // within the wheels' step up
      const a = deploy(w);
      run(a, w, 150, { moveZ: 1 });
      expect(a.dx).toBeGreaterThan(9);

      const w2 = arena();
      w2.addDyn(lipBox(901, 8, 8.5, 0.4));
      const b = deploy(w2);
      run(b, w2, 150, { moveZ: 1 });
      expect(b.dx).toBeLessThan(8 - DRONE.halfW + 0.01); // blocked by the ledge

      // drive up to it and hop: it gets on top
      const c = deploy(w2);
      run(c, w2, 60, { moveZ: 1 });
      for (let i = 0; i < 120; i++) run(c, w2, 1, { moveZ: 1, buttons: i % 40 === 0 ? Btn.UP : 0 });
      expect(c.dx).toBeGreaterThan(9);
    });

    it('cannot get over a one metre piece of furniture', () => {
      const w = arena();
      const s = deploy(w, 7.5, DRONE.halfH + 0.01, 3.4); // furniture tile 18,6..7 spans x 9..9.5, z 3..4
      for (let i = 0; i < 240; i++) run(s, w, 1, { moveZ: 1, buttons: i % 40 === 0 ? Btn.UP : 0 });
      expect(s.dx).toBeLessThan(9 - DRONE.halfW + 0.01);
    });

    it('is damaged by a hard fall but not by a small drop', () => {
      const w = arena();
      const hi = deploy(w, 5, 3.0, 5);
      hi.dhp = DRONE.hp;
      run(hi, w, 120, {});
      expect(hi.dhp).toBeLessThan(DRONE.hp - 5);
      const lo = deploy(w, 5, 0.6, 7);
      lo.dhp = DRONE.hp;
      run(lo, w, 60, {});
      expect(lo.dhp).toBe(DRONE.hp);
    });

    it('a parked drone settles on the floor too', () => {
      const w = arena();
      const s = spawnState(5, 0, 5);
      s.dDeployed = true; s.dCtl = false;
      s.dx = 7; s.dy = 1.2; s.dz = 7;
      run(s, w, 90, {});
      expect(s.dy).toBeCloseTo(DRONE.halfH, 2);
      expect(s.dx).toBeCloseTo(7, 3);
    });

    it('can hop its way up the stairs of the Safehouse', () => {
      const w = new World(safehouse);
      const st = safehouse.stairs[0]!;
      // start at the bottom of the stairs, facing the climbing direction
      const s = spawnState(5, 0, 5);
      s.dDeployed = true;
      const tz = (st.z0 + st.z1 + 1) / 4;
      s.dx = (st.x0 - 3) * 0.5; s.dy = DRONE.halfH + 0.01; s.dz = tz;
      run(s, w, 2, { buttons: Btn.DRONE });
      let up = 0;
      let hops = 0;
      for (let i = 0; i < 60 * 40 && s.dy < 2.5; i++) {
        const out = makeStepOut();
        stepPlayer(s, cmdFor(s, { moveZ: 1, yaw: -Math.PI / 2, buttons: i % 20 === 0 ? Btn.UP : 0 }), w, SIM_DT, out);
        if (out.droneHop) hops++;
        up = Math.max(up, s.dy);
      }
      expect(hops).toBeGreaterThan(2);
      expect(up).toBeGreaterThan(2.5); // reached the upper floor
    });
  });
});
