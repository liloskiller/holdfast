import { describe, expect, it } from 'vitest';
import { WEAPONS, WeaponId } from './constants';
import { Btn, createPlayerState } from './types';
import { parseMap } from './mapFormat';
import { arenaMapText } from './testMap';
import { World } from './world';
import { run, spawnState } from './testUtil';
import { buildShotRays, damageFor, fireInterval, resetLoadout, spreadDeg, weaponDef } from './weapons';

const arena = (): World => new World(parseMap(arenaMapText()));

describe('weapons', () => {
  it('spread is deterministic per player and shot index', () => {
    const s = spawnState(5, 0, 5, 0.7);
    s.pitch = 0.2;
    const def = weaponDef(WeaponId.HAMMER);
    const a = new Float64Array(12 * 3);
    const b = new Float64Array(12 * 3);
    buildShotRays(s, 3, 17, def, a);
    buildShotRays(s, 3, 17, def, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    buildShotRays(s, 3, 18, def, b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    buildShotRays(s, 4, 17, def, b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('pellets stay inside the spread cone and are unit vectors', () => {
    const s = spawnState(5, 0, 5, 0);
    const def = weaponDef(WeaponId.HAMMER);
    const rays = new Float64Array(12 * 3);
    const cone = (spreadDeg(def, s) * Math.PI) / 180;
    for (let shot = 0; shot < 50; shot++) {
      buildShotRays(s, 1, shot, def, rays);
      for (let p = 0; p < def.pellets; p++) {
        const dx = rays[p * 3]!, dy = rays[p * 3 + 1]!, dz = rays[p * 3 + 2]!;
        expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1, 6);
        // forward at yaw 0 / pitch 0 is -z
        expect(Math.acos(-dz)).toBeLessThanOrEqual(cone + 1e-9);
      }
    }
    expect(def.pellets).toBe(8);
  });

  it('ads tightens the spread', () => {
    const s = spawnState(5, 0, 5);
    const def = weaponDef(WeaponId.CARBINE);
    const hip = spreadDeg(def, s);
    s.ads = true;
    expect(spreadDeg(def, s)).toBeLessThan(hip);
  });

  it('full auto weapons fire at their RPM and semi autos need a press per shot', () => {
    const w = arena();
    const s = spawnState(5, 0, 5);
    const empty = run(s, w, 60 * 3, { buttons: Btn.FIRE });
    // carbine: 650 rpm => 10.83 shots/s, but the mag is 30 so it empties within 3 s
    expect(empty.shots).toBe(30);
    s.ammo0 = 1000;
    const r2 = run(spawnState(5, 0, 5), w, 60, { buttons: Btn.FIRE });
    expect(r2.shots).toBeGreaterThanOrEqual(10);
    expect(r2.shots).toBeLessThanOrEqual(11);

    const dmr = spawnState(5, 0, 5, 0, WeaponId.MARKSMAN);
    const held = run(dmr, w, 120, { buttons: Btn.FIRE });
    expect(held.shots).toBe(1);
    // alternate press and release
    let shots = 0;
    const dmr2 = spawnState(5, 0, 5, 0, WeaponId.MARKSMAN);
    for (let i = 0; i < 12; i++) {
      shots += run(dmr2, w, 1, { buttons: Btn.FIRE }).shots;
      run(dmr2, w, 9, { buttons: 0 });
    }
    // 180 rpm = one shot per 20 ticks, so 10 tick cycles only land every other press
    expect(shots).toBeGreaterThanOrEqual(5);
    expect(shots).toBeLessThanOrEqual(7);
  });

  it('reloads from reserve and shells load one at a time', () => {
    const w = arena();
    const s = spawnState(5, 0, 5);
    s.ammo0 = 10;
    const reserve = s.res0;
    run(s, w, 1, { buttons: Btn.RELOAD });
    expect(s.reloading).toBe(true);
    run(s, w, Math.ceil(60 * weaponDef(WeaponId.CARBINE).reload) + 2, {});
    expect(s.reloading).toBe(false);
    expect(s.ammo0).toBe(30);
    expect(s.res0).toBe(reserve - 20);

    const sg = spawnState(5, 0, 5, 0, WeaponId.HAMMER);
    sg.ammo0 = 2;
    run(sg, w, 1, { buttons: Btn.RELOAD });
    run(sg, w, Math.ceil(60 * 0.6) + 1, {});
    expect(sg.ammo0).toBe(3);
    run(sg, w, Math.ceil(60 * 0.6) * 3 + 6, {});
    expect(sg.ammo0).toBe(6);
    expect(sg.reloading).toBe(false);
  });

  it('switching weapons uses the other slot and takes time', () => {
    const w = arena();
    const s = spawnState(5, 0, 5);
    const r = run(s, w, 1, { slot: 1, buttons: Btn.FIRE });
    expect(r.out.switched).toBe(true);
    expect(s.slot).toBe(1);
    expect(r.shots).toBe(0);
    run(s, w, 40, { slot: 1, buttons: 0 });
    const later = run(s, w, 2, { slot: 1, buttons: Btn.FIRE });
    expect(later.shots).toBe(1);
    expect(s.ammo1).toBeLessThan(weaponDef(WeaponId.SIDEARM).mag);
  });

  it('damage falls off with range and headshots multiply', () => {
    const c = weaponDef(WeaponId.CARBINE);
    expect(damageFor(c, 10, false)).toBe(27);
    expect(damageFor(c, 10, true)).toBeCloseTo(27 * 2.5, 6);
    expect(damageFor(c, 80, false)).toBeLessThan(damageFor(c, 40, false));
    expect(damageFor(c, 40, false)).toBeLessThan(27);
  });

  it('weapon table matches the plan', () => {
    expect(WEAPONS).toHaveLength(5);
    expect(fireInterval(weaponDef(WeaponId.CARBINE))).toBeCloseTo(60 / 650, 9);
    const s = createPlayerState();
    resetLoadout(s, WeaponId.MARKSMAN);
    expect(s.ammo0).toBe(10);
    expect(s.ammo1).toBe(12);
  });
});
