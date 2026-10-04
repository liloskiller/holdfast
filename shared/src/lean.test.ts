import { describe, expect, it } from 'vitest';
import { LEAN, PLAYER } from './constants';
import { Btn } from './types';
import { parseMap } from './mapFormat';
import { arenaMapText } from './testMap';
import { World } from './world';
import { leanReach, leanVec } from './lean';
import { run, spawnState } from './testUtil';

const arena = (): World => new World(parseMap(arenaMapText()));

describe('lean', () => {
  it('moves the head to the side by the lean amount, in the camera right direction', () => {
    const v = { x: 0, y: 0, z: 0 };
    leanVec(0, 1, v); // facing -z, right is +x
    expect(v.x).toBeCloseTo(LEAN.offset, 9);
    expect(v.z).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(-LEAN.drop, 9);
    leanVec(Math.PI / 2, 1, v); // facing -x, right is -z
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(-LEAN.offset, 9);
    leanVec(0, -0.5, v);
    expect(v.x).toBeCloseTo(-LEAN.offset / 2, 9);
    leanVec(1.2, 0, v);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('eases in over a fraction of a second and back out when released', () => {
    const w = arena();
    const s = spawnState(10, 0, 10, 0);
    run(s, w, 4, { buttons: Btn.LEAN_R });
    expect(s.lean).toBeGreaterThan(0.3);
    expect(s.lean).toBeLessThan(0.7);
    run(s, w, 12, { buttons: Btn.LEAN_R });
    expect(s.lean).toBe(1);
    run(s, w, 4, { buttons: 0 });
    expect(s.lean).toBeLessThan(1);
    run(s, w, 20, { buttons: 0 });
    expect(s.lean).toBe(0);
    run(s, w, 20, { buttons: Btn.LEAN_L });
    expect(s.lean).toBe(-1);
    // both keys cancel out
    run(s, w, 30, { buttons: Btn.LEAN_L | Btn.LEAN_R });
    expect(s.lean).toBe(0);
  });

  it('does not lean while sprinting, in the air or vaulting', () => {
    const w = arena();
    const s = spawnState(10, 0, 10, -Math.PI / 2);
    run(s, w, 40, { moveZ: 1, buttons: Btn.SPRINT });
    expect(s.sprint).toBe(true);
    run(s, w, 20, { moveZ: 1, buttons: Btn.SPRINT | Btn.LEAN_R });
    expect(s.lean).toBe(0);
    const air = spawnState(10, 2, 10);
    air.onGround = false;
    run(air, w, 5, { buttons: Btn.LEAN_R });
    expect(air.lean).toBe(0);
  });

  it('walking while leaned is slower', () => {
    const w = arena();
    const a = spawnState(5, 0, 10, -Math.PI / 2);
    const b = spawnState(5, 0, 10, -Math.PI / 2);
    run(a, w, 60, { moveZ: 1 });
    run(b, w, 60, { moveZ: 1, buttons: Btn.LEAN_R });
    expect(Math.hypot(b.vx, b.vz)).toBeLessThan(Math.hypot(a.vx, a.vz) * 0.85);
    expect(b.lean).toBe(1);
  });

  it('a wall limits how far the head can come out', () => {
    const w = arena();
    // the west fence occupies x 0..0.5; stand with the right shoulder against it (facing -z, right is +x: use the left)
    const s = spawnState(0.5 + PLAYER.radius + 0.01, 0, 10, 0);
    run(s, w, 40, { buttons: Btn.LEAN_L });
    expect(s.lean).toBeGreaterThan(-1); // cannot go all the way into the fence
    const open = spawnState(10, 0, 10, 0);
    run(open, w, 40, { buttons: Btn.LEAN_L });
    expect(open.lean).toBe(-1);
    const reach = leanReach((a, b, c, d, e, f) => w.boxFree(a, b, c, d, e, f), s.x, 0, s.z, 0, false, -1);
    expect(reach).toBeLessThan(1);
  });
});
