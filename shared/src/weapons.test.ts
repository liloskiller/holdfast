import { describe, expect, it } from 'vitest';
import { PLAYER, RECOIL_MAX, WEAPONS, WeaponId } from './constants';
import { Btn, createPlayerState, stateToArray } from './types';
import { parseMap } from './mapFormat';
import { arenaMapText } from './testMap';
import { World } from './world';
import { cmdFor, run, spawnState } from './testUtil';
import { makeStepOut, stepPlayer, type StepOut } from './movement';
import { SIM_DT } from './constants';
import {
  ammoCap, buildShotRays, buildShotRaysFromState, damageFor, fireInterval, resetLoadout, spreadDeg, weaponDef,
} from './weapons';

const arena = (): World => new World(parseMap(arenaMapText()));

describe('weapons', () => {
  it('spread is deterministic per player and shot index', () => {
    const s = spawnState(5, 0, 5, 0.7);
    s.pitch = 0.2;
    const def = weaponDef(WeaponId.HAMMER);
    const a = new Float64Array(12 * 3);
    const b = new Float64Array(12 * 3);
    buildShotRaysFromState(s, 3, 17, def, a);
    buildShotRaysFromState(s, 3, 17, def, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    buildShotRaysFromState(s, 3, 18, def, b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    buildShotRaysFromState(s, 4, 17, def, b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('pellets stay inside the spread cone and are unit vectors', () => {
    const s = spawnState(5, 0, 5, 0);
    const def = weaponDef(WeaponId.HAMMER);
    const rays = new Float64Array(12 * 3);
    const cone = (spreadDeg(def, s) * Math.PI) / 180;
    for (let shot = 0; shot < 50; shot++) {
      buildShotRaysFromState(s, 1, shot, def, rays);
      for (let p = 0; p < def.pellets; p++) {
        const dx = rays[p * 3]!, dy = rays[p * 3 + 1]!, dz = rays[p * 3 + 2]!;
        expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1, 6);
        // forward at yaw 0 / pitch 0 is -z
        expect(Math.acos(-dz)).toBeLessThanOrEqual(cone + 1e-9);
      }
    }
    expect(def.pellets).toBe(8);
  });

  it('explicit aim overrides: the recoil offset really moves the rays', () => {
    const def = weaponDef(WeaponId.MARKSMAN);
    const a = new Float64Array(36);
    buildShotRays(0, 0, 0, 1, 1, def, a);
    expect(a[1]).toBeCloseTo(0, 9); // level
    buildShotRays(0, 0.1, 0, 1, 1, def, a);
    expect(a[1]).toBeCloseTo(Math.sin(0.1), 9); // aiming up by the kick
  });

  it('ads tightens the spread', () => {
    const s = spawnState(5, 0, 5);
    const def = weaponDef(WeaponId.CARBINE);
    const hip = spreadDeg(def, s);
    s.adsAmt = 1;
    expect(spreadDeg(def, s)).toBeLessThan(hip);
    expect(spreadDeg(def, s)).toBeCloseTo(def.spreadAds, 6);
  });

  it('aiming down sights takes the weapon specific time, and slows you gradually', () => {
    const w = arena();
    const carbine = spawnState(5, 0, 5, -Math.PI / 2);
    const def = weaponDef(WeaponId.CARBINE);
    run(carbine, w, Math.round(60 * def.adsTime * 0.5), { buttons: Btn.ADS });
    expect(carbine.adsAmt).toBeGreaterThan(0.3);
    expect(carbine.adsAmt).toBeLessThan(0.7);
    run(carbine, w, Math.round(60 * def.adsTime), { buttons: Btn.ADS });
    expect(carbine.adsAmt).toBe(1);
    run(carbine, w, 120, { buttons: Btn.ADS, moveZ: 1 });
    expect(Math.hypot(carbine.vx, carbine.vz)).toBeCloseTo(PLAYER.walk * def.adsMoveMul * def.moveMul, 1);

    // the LMG is slower to raise than the SMG
    const lmg = spawnState(5, 0, 5, 0, WeaponId.ANVIL);
    const smg = spawnState(5, 0, 5, 0, WeaponId.RATTLER);
    run(lmg, w, 10, { buttons: Btn.ADS });
    run(smg, w, 10, { buttons: Btn.ADS });
    expect(smg.adsAmt).toBeGreaterThan(lmg.adsAmt);
    // releasing drops back out of the sights
    run(smg, w, 30, { buttons: 0 });
    expect(smg.adsAmt).toBe(0);
  });

  it('reloading cancels aiming', () => {
    const w = arena();
    const s = spawnState(5, 0, 5);
    s.ammo0 = 5;
    run(s, w, 30, { buttons: Btn.ADS });
    expect(s.adsAmt).toBe(1);
    run(s, w, 1, { buttons: Btn.RELOAD | Btn.ADS });
    expect(s.reloading).toBe(true);
    run(s, w, 40, { buttons: Btn.ADS });
    expect(s.adsAmt).toBe(0);
  });

  it('full auto weapons fire at their RPM and semi autos need a press per shot', () => {
    const w = arena();
    const s = spawnState(5, 0, 5);
    const empty = run(s, w, 60 * 3, { buttons: Btn.FIRE });
    // carbine: 650 rpm => 10.83 shots/s; mag 30 plus one in the chamber empties within 3 s
    expect(empty.shots).toBe(31);
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
    // 180 rpm = one shot per 20 ticks, so 10 tick cycles land every other press (the buffer may catch a few more)
    expect(shots).toBeGreaterThanOrEqual(5);
    expect(shots).toBeLessThanOrEqual(8);
  });

  it('a click just before the gun is ready is remembered, an early one is not', () => {
    const w = arena();
    const s = spawnState(5, 0, 5, 0, WeaponId.MARKSMAN);
    expect(run(s, w, 1, { buttons: Btn.FIRE }).shots).toBe(1);
    run(s, w, 9, { buttons: 0 }); // 10 ticks in, 20 needed
    expect(run(s, w, 1, { buttons: Btn.FIRE }).shots).toBe(0); // too early (more than 0.12 s to go): lost
    run(s, w, 25, { buttons: 0 });
    expect(s.shotIdx).toBe(1);

    const t = spawnState(5, 0, 5, 0, WeaponId.MARKSMAN);
    expect(run(t, w, 1, { buttons: Btn.FIRE }).shots).toBe(1);
    run(t, w, 14, { buttons: 0 }); // 15 ticks in, ready in 5
    expect(run(t, w, 1, { buttons: Btn.FIRE }).shots).toBe(0);
    let fired = 0;
    for (let i = 0; i < 10; i++) fired += run(t, w, 1, { buttons: 0 }).shots;
    expect(fired).toBe(1); // fired by itself as soon as it was ready
  });

  it('reloads: tactical keeps one in the chamber and is quicker than an empty reload', () => {
    const w = arena();
    const def = weaponDef(WeaponId.CARBINE);
    const s = spawnState(5, 0, 5);
    s.ammo0 = 10;
    const reserve = s.res0;
    run(s, w, 1, { buttons: Btn.RELOAD });
    expect(s.reloading).toBe(true);
    expect(s.reloadMax).toBe(def.reload);
    run(s, w, Math.ceil(60 * def.reload) + 2, {});
    expect(s.reloading).toBe(false);
    expect(s.ammo0).toBe(def.mag + 1);
    expect(s.res0).toBe(reserve - (def.mag + 1 - 10));

    const e = spawnState(5, 0, 5);
    e.ammo0 = 0;
    run(e, w, 1, { buttons: Btn.RELOAD });
    expect(e.reloadMax).toBe(def.reloadEmpty);
    expect(def.reloadEmpty).toBeGreaterThan(def.reload);
    run(e, w, Math.ceil(60 * def.reloadEmpty) + 2, {});
    expect(e.ammo0).toBe(def.mag); // nothing chambered

    // a full gun with one in the chamber cannot be topped up
    const full = spawnState(5, 0, 5);
    run(full, w, 1, { buttons: Btn.RELOAD });
    expect(full.reloading).toBe(false);
  });

  it('shotgun shells load one at a time and the reload can be interrupted by firing', () => {
    const w = arena();
    const sg = spawnState(5, 0, 5, 0, WeaponId.HAMMER);
    sg.ammo0 = 2;
    const per = weaponDef(WeaponId.HAMMER).reload;
    run(sg, w, 1, { buttons: Btn.RELOAD });
    run(sg, w, Math.ceil(60 * per) + 1, {});
    expect(sg.ammo0).toBe(3);
    run(sg, w, Math.ceil(60 * per) * 3 + 6, {});
    expect(sg.ammo0).toBe(6);
    expect(sg.reloading).toBe(false);

    sg.ammo0 = 1;
    run(sg, w, 1, { buttons: Btn.RELOAD });
    expect(sg.reloading).toBe(true);
    const r = run(sg, w, 2, { buttons: Btn.FIRE });
    expect(r.shots).toBe(1);
    expect(sg.reloading).toBe(false);
  });

  it('switching weapons uses the other slot and takes the new weapon draw time', () => {
    const w = arena();
    const s = spawnState(5, 0, 5);
    const r = run(s, w, 1, { slot: 1, buttons: Btn.FIRE });
    expect(r.out.switched).toBe(true);
    expect(s.slot).toBe(1);
    expect(r.shots).toBe(0);
    run(s, w, 40, { slot: 1, buttons: 0 });
    const later = run(s, w, 2, { slot: 1, buttons: Btn.FIRE });
    expect(later.shots).toBe(1);
    expect(s.ammo1).toBeLessThan(ammoCap(weaponDef(WeaponId.SIDEARM), true));
    // the LMG is slow to bring up, the SMG is quick
    const lmg = spawnState(5, 0, 5, 0, WeaponId.ANVIL);
    const smg = spawnState(5, 0, 5, 0, WeaponId.RATTLER);
    lmg.w1 = WeaponId.RATTLER; smg.w1 = WeaponId.ANVIL;
    lmg.ammo1 = 30; smg.ammo1 = 30;
    run(lmg, w, 1, { slot: 1 });
    run(smg, w, 1, { slot: 1 });
    run(lmg, w, 25, { slot: 1 });
    run(smg, w, 25, { slot: 1 });
    expect(run(lmg, w, 1, { slot: 1, buttons: Btn.FIRE }).shots).toBe(1); // SMG drawn at 0.3 s
    expect(run(smg, w, 1, { slot: 1, buttons: Btn.FIRE }).shots).toBe(0); // LMG still coming up (0.7 s)
  });

  it('the gun cannot fire right after a sprint ends', () => {
    const w = arena();
    const def = weaponDef(WeaponId.CARBINE);
    const s = spawnState(5, 0, 5, -Math.PI / 2);
    run(s, w, 60, { moveZ: 1, buttons: Btn.SPRINT });
    expect(s.sprint).toBe(true);
    const out = makeStepOut();
    let first = -1;
    for (let i = 0; i < 40; i++) {
      stepPlayer(s, cmdFor(s, { moveZ: 1, buttons: Btn.SPRINT | Btn.FIRE }), w, SIM_DT, out);
      if (out.fired && first < 0) first = i;
    }
    expect(first).toBeGreaterThanOrEqual(Math.floor(def.sprintOut / SIM_DT) - 1);
    expect(first).toBeLessThan(Math.ceil((def.sprintOut + 0.05) / SIM_DT));
  });

  describe('recoil and bloom', () => {
    const fire = (s: ReturnType<typeof spawnState>, w: World, n: number): StepOut[] => {
      const outs: StepOut[] = [];
      for (let i = 0; i < n; i++) {
        const out = makeStepOut();
        stepPlayer(s, cmdFor(s, { buttons: Btn.FIRE }), w, SIM_DT, out);
        if (out.fired) outs.push({ ...out });
      }
      return outs;
    };

    it('the first shot is accurate, later shots climb, and the kick is capped', () => {
      const w = arena();
      const s = spawnState(5, 0, 5, 0, WeaponId.CARBINE);
      const shots = fire(s, w, 90);
      expect(shots.length).toBeGreaterThan(12);
      expect(shots[0]!.aimPitch).toBeCloseTo(0, 9);
      expect(shots[5]!.aimPitch).toBeGreaterThan(shots[1]!.aimPitch);
      expect(shots[12]!.aimPitch).toBeGreaterThan(shots[5]!.aimPitch);
      for (const sh of shots) expect(sh.aimPitch).toBeLessThanOrEqual(RECOIL_MAX + 1e-9);
      // a weapon with a real kick moves the aim right after the first shot
      const dmr = spawnState(5, 0, 5, 0, WeaponId.MARKSMAN);
      const d = fire(dmr, w, 1);
      expect(dmr.rcP).toBeCloseTo(weaponDef(WeaponId.MARKSMAN).kickPitch * 0.6, 3);
      expect(d[0]!.aimPitch).toBeCloseTo(0, 9);
    });

    it('pulling the aim down by the kick keeps the shots on target', () => {
      const w = arena();
      const s = spawnState(5, 0, 5, 0, WeaponId.CARBINE);
      let off = 0;
      for (let i = 0; i < 60; i++) {
        const out = makeStepOut();
        // the player counters the visible kick (view = aim + kick)
        stepPlayer(s, cmdFor(s, { buttons: Btn.FIRE, pitch: -s.rcP }), w, SIM_DT, out);
        if (out.fired) off = Math.max(off, Math.abs(out.aimPitch));
      }
      expect(off).toBeLessThan(0.02);
    });

    it('settles back to zero after the trigger is released', () => {
      const w = arena();
      const s = spawnState(5, 0, 5, 0, WeaponId.CARBINE);
      fire(s, w, 40);
      expect(s.rcP).toBeGreaterThan(0.01);
      expect(s.bloom).toBeGreaterThan(0);
      run(s, w, 120, {});
      expect(s.rcP).toBe(0);
      expect(s.rcY).toBe(0);
      expect(s.bloom).toBe(0);
      expect(s.spray).toBe(0);
    });

    it('sustained fire opens up the spread, aiming and crouching help', () => {
      const w = arena();
      const def = weaponDef(WeaponId.CARBINE);
      const s = spawnState(5, 0, 5, 0, WeaponId.CARBINE);
      const base = spreadDeg(def, s);
      fire(s, w, 40);
      const bloomed = spreadDeg(def, s);
      expect(bloomed).toBeGreaterThan(base + 0.5);
      expect(bloomed).toBeLessThanOrEqual(def.spreadHip + def.bloomMax + 1e-9);
      s.adsAmt = 1;
      expect(spreadDeg(def, s)).toBeLessThan(bloomed);
    });

    it('is deterministic for identical input', () => {
      const w1 = arena();
      const w2 = arena();
      const a = spawnState(5, 0, 5, 0.3, WeaponId.ANVIL);
      const b = spawnState(5, 0, 5, 0.3, WeaponId.ANVIL);
      for (let i = 0; i < 400; i++) {
        const o = { buttons: i % 120 < 70 ? Btn.FIRE : i % 120 > 100 ? Btn.RELOAD : 0, moveZ: i % 50 < 25 ? 1 : 0, yaw: 0.3 + Math.sin(i / 30) * 0.2 };
        run(a, w1, 1, o);
        run(b, w2, 1, o);
      }
      expect(stateToArray(a)).toEqual(stateToArray(b));
      expect(a.shotIdx).toBeGreaterThan(10);
    });

    it('the kick wobble differs per shot but repeats for the same shot index', () => {
      const w = arena();
      const mk = (): ReturnType<typeof spawnState> => spawnState(5, 0, 5, 0, WeaponId.RATTLER);
      const a = mk();
      const b = mk();
      fire(a, w, 30);
      fire(b, w, 30);
      expect(a.rcY).toBe(b.rcY);
      const c = mk();
      c.shotIdx = 500;
      fire(c, w, 30);
      expect(c.rcY).not.toBe(a.rcY);
    });
  });

  describe('burst fire', () => {
    it('one press fires exactly one burst, then the gun waits for the next press', () => {
      const w = arena();
      const def = weaponDef(WeaponId.TALON);
      const s = spawnState(5, 0, 5, 0, WeaponId.TALON);
      const held = run(s, w, 120, { buttons: Btn.FIRE });
      expect(held.shots).toBe(def.burst);
      // press again: another burst
      run(s, w, 5, { buttons: 0 });
      expect(run(s, w, 60, { buttons: Btn.FIRE }).shots).toBe(def.burst);
    });

    it('shots inside a burst come faster than the gap between bursts', () => {
      const w = arena();
      const s = spawnState(5, 0, 5, 0, WeaponId.TALON);
      const ticks: number[] = [];
      const out = makeStepOut();
      for (let i = 0; i < 60; i++) {
        stepPlayer(s, cmdFor(s, { buttons: Btn.FIRE }), w, SIM_DT, out);
        if (out.fired) ticks.push(i);
      }
      expect(ticks).toHaveLength(3);
      const inner = ticks[1]! - ticks[0]!;
      expect(inner).toBeLessThanOrEqual(5);
      expect(inner).toBeGreaterThanOrEqual(3);
    });

    it('running dry in the middle of a burst ends it', () => {
      const w = arena();
      const s = spawnState(5, 0, 5, 0, WeaponId.TALON);
      s.ammo0 = 2;
      const r = run(s, w, 60, { buttons: Btn.FIRE });
      expect(r.shots).toBe(2);
      expect(s.burstLeft).toBe(0);
    });
  });

  it('damage falls off with range and headshots multiply', () => {
    const c = weaponDef(WeaponId.CARBINE);
    expect(damageFor(c, 10, false)).toBe(27);
    expect(damageFor(c, 10, true)).toBeCloseTo(27 * 2.5, 6);
    expect(damageFor(c, 80, false)).toBeLessThan(damageFor(c, 40, false));
    expect(damageFor(c, 40, false)).toBeLessThan(27);
  });

  it('weapon table is consistent and balanced', () => {
    expect(WEAPONS).toHaveLength(9);
    WEAPONS.forEach((d, i) => {
      expect(d.id).toBe(i);
      expect(d.mag).toBeGreaterThan(0);
      expect(d.rpm).toBeGreaterThan(0);
      expect(d.reloadEmpty).toBeGreaterThanOrEqual(d.reload);
      expect(d.spreadAds).toBeLessThanOrEqual(d.spreadHip);
      expect(d.minDamageMul).toBeGreaterThan(0);
      expect(d.pen).toBeGreaterThan(0);
      expect(d.pen).toBeLessThanOrEqual(1);
      if (d.mode === 'burst') expect(d.burst).toBeGreaterThan(1);
      // time to kill with body shots at point blank stays in a sane band (under 1.2 s)
      const perShot = d.damage * (d.pellets > 1 ? d.pellets * 0.6 : 1);
      const shots = Math.ceil(100 / perShot);
      const ttk = (shots - 1) * fireInterval(d);
      expect(ttk).toBeLessThan(1.2);
    });
    expect(fireInterval(weaponDef(WeaponId.CARBINE))).toBeCloseTo(60 / 650, 9);
    // the suppressed gun is quiet, the marksman rifle is loud
    expect(weaponDef(WeaponId.WHISPER).suppressed).toBe(true);
    expect(weaponDef(WeaponId.WHISPER).loudness).toBeLessThan(weaponDef(WeaponId.SIDEARM).loudness);
    expect(weaponDef(WeaponId.MARKSMAN).loudness).toBeGreaterThan(weaponDef(WeaponId.CARBINE).loudness);
    // a headshot with the precise weapons is a one hit kill
    for (const id of [WeaponId.MARKSMAN, WeaponId.SIDEARM, WeaponId.MAGNUM]) {
      expect(damageFor(weaponDef(id), 10, true)).toBeGreaterThanOrEqual(100);
    }
    expect(damageFor(weaponDef(WeaponId.CARBINE), 10, true)).toBeLessThan(100);
    const s = createPlayerState();
    resetLoadout(s, WeaponId.MARKSMAN);
    expect(s.ammo0).toBe(11); // 10 + chambered
    expect(s.ammo1).toBe(13);
    resetLoadout(s, WeaponId.HAMMER, WeaponId.MAGNUM);
    expect(s.ammo0).toBe(6); // shotguns have no chamber bonus
    expect(s.ammo1).toBe(6);
  });
});
