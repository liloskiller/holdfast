import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Btn, HITBOX, KillCause, OPERATORS, OperatorId, PhaseId, WeaponId, operatorDef, weaponDef } from '@holdfast/shared';
import { shoot, melee } from './systems/combatSystem';
import { applyPick } from './systems/roundSystem';
import { addHuman, aimChest, feed, forceAction, makeRoom, place } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

function duel(): { room: ReturnType<typeof makeRoom>; a: ReturnType<typeof addHuman>['p']; b: ReturnType<typeof addHuman>['p'] } {
  const room = makeRoom();
  const a = addHuman(room, 'A', 0).p;
  const b = addHuman(room, 'B', 1).p;
  forceAction(room);
  place(a, 5, 0, 5, -Math.PI / 2);
  place(b, 12, 0, 5, 0);
  return { room, a, b };
}

describe('gunplay on the server', () => {
  it('leg hits do less damage than body hits', () => {
    const { room, a, b } = duel();
    a.state.adsAmt = 1;
    const dmg = (aimY: number): number => {
      b.state.hp = 100;
      a.state.pitch = Math.atan2(aimY - 1.65, 7);
      shoot(room, a, 0, WeaponId.SIDEARM, room.time);
      return 100 - b.state.hp;
    };
    const body = dmg(1.2);
    const legs = dmg(0.4);
    expect(body).toBeGreaterThan(30);
    expect(legs).toBeGreaterThan(0);
    expect(legs).toBeCloseTo(body * HITBOX.legMul, 0);
  });

  it('a suppressed gun makes a small sound, a loud one a big sound', () => {
    const { room, a } = duel();
    a.state.pitch = 0;
    room.sounds.length = 0;
    shoot(room, a, 0, WeaponId.WHISPER, room.time);
    const quiet = room.sounds.find((x) => x.s === 'shot')!;
    room.sounds.length = 0;
    shoot(room, a, 1, WeaponId.MARKSMAN, room.time);
    const loud = room.sounds.find((x) => x.s === 'shot')!;
    expect(quiet.radius).toBe(weaponDef(WeaponId.WHISPER).loudness);
    expect(loud.radius).toBe(weaponDef(WeaponId.MARKSMAN).loudness);
    expect(quiet.radius).toBeLessThan(loud.radius / 3);
  });

  it('an explicit aim overrides the player state (recoil comes from the shared step)', () => {
    const { room, a, b } = duel();
    a.state.pitch = aimChest(a, b);
    shoot(room, a, 0, WeaponId.MARKSMAN, room.time, { yaw: -Math.PI / 2, pitch: aimChest(a, b), spread: 0 });
    expect(b.state.hp).toBeLessThan(100);
    b.state.hp = 100;
    // aimed far over his head
    shoot(room, a, 1, WeaponId.MARKSMAN, room.time, { yaw: -Math.PI / 2, pitch: 0.4, spread: 0 });
    expect(b.state.hp).toBe(100);
  });

  it('recoil is authoritative: an uncontrolled spray climbs off the target, a controlled one stays on', () => {
    const run = (control: boolean): number => {
      const { room, a, b } = duel();
      place(a, 3, 0, 5, -Math.PI / 2);
      place(b, 17.5, 0, 5, 0); // far enough that a few degrees of climb means missing over his head
      b.state.hp = 1e6;
      const aim = aimChest(a, b);
      feed(room, a, { buttons: Btn.ADS, yaw: -Math.PI / 2, pitch: aim }, 30);
      const before = b.state.hp;
      for (let i = 0; i < 180; i++) {
        const pitch = control ? aim - a.state.rcP : aim;
        feed(room, a, { buttons: Btn.FIRE | Btn.ADS, yaw: -Math.PI / 2, pitch }, 1);
        a.state.ammo0 = 30;
      }
      return before - b.state.hp;
    };
    const uncontrolled = run(false);
    const controlled = run(true);
    expect(controlled).toBeGreaterThan(uncontrolled * 1.25);
    expect(uncontrolled).toBeGreaterThan(0); // the first rounds still land
  });

  it('weapons keep different amounts of damage through a soft wall', () => {
    const room = makeRoom({ map: SAFEHOUSE });
    const atk = addHuman(room, 'Atk', 0);
    const def = addHuman(room, 'Def', 1);
    forceAction(room);
    room.phase = PhaseId.ACTION;
    const through = (w: number): number => {
      place(atk.p, 12.0, 0, 7.75, Math.PI / -2);
      place(def.p, 17.0, 0, 7.75, Math.PI / 2);
      atk.p.state.adsAmt = 1;
      atk.p.state.pitch = -0.08;
      let best = 0;
      for (let i = 0; i < 6; i++) {
        def.p.state.hp = 100;
        def.p.state.alive = true;
        shoot(room, atk.p, i, w, room.time, { yaw: -Math.PI / 2, pitch: -0.08, spread: 0 });
        best = Math.max(best, 100 - def.p.state.hp);
      }
      return best;
    };
    const marksman = through(WeaponId.MARKSMAN);
    const rattler = through(WeaponId.RATTLER);
    expect(marksman).toBeGreaterThan(rattler);
  });

  it('the recoil assist message is clamped and stored in the player state', () => {
    const { room, a } = duel();
    room.handleMessage(a, { t: 'SET_ASSIST', recoil: 0.6 });
    expect(a.state.rcMul).toBe(0.6);
    room.handleMessage(a, { t: 'SET_ASSIST', recoil: 0 });
    expect(a.state.rcMul).toBe(0.4); // no recoil is not an option
    room.handleMessage(a, { t: 'SET_ASSIST', recoil: 5 });
    expect(a.state.rcMul).toBe(1);
  });

  it('loadout: secondary picks are validated and applied to the spawned player', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    forceAction(room);
    expect(applyPick(room, a, OperatorId.RAM, WeaponId.CARBINE, true, WeaponId.MAGNUM)).toBeNull();
    expect(a.secondary).toBe(WeaponId.MAGNUM);
    expect(applyPick(room, a, OperatorId.RAM, WeaponId.CARBINE, true, WeaponId.ANVIL)).toBeNull();
    expect(a.secondary).toBe(operatorDef(OperatorId.RAM).secondaries[0]); // not an allowed sidearm, falls back
    expect(applyPick(room, a, OperatorId.RAM, WeaponId.ANVIL, true)).toBeNull();
    expect(a.primary).toBe(operatorDef(OperatorId.RAM).primaries[0]); // not on Ram's list either
  });

  it('every operator can field every one of its weapons', () => {
    for (const op of OPERATORS) {
      for (const w of op.primaries) expect(weaponDef(w).id).toBe(w);
      for (const w of op.secondaries) expect(weaponDef(w).kind === 'pistol' || weaponDef(w).kind === 'revolver').toBe(true);
    }
  });

  it('kill causes: melee kills are reported as melee, not as a gun', () => {
    const { room, a, b } = duel();
    place(a, 10, 0, 5, -Math.PI / 2);
    place(b, 10.9, 0, 5, 0);
    b.state.hp = 30;
    melee(room, a);
    expect(b.state.alive).toBe(false);
    const kill = room.pub.find((e) => e.k === 'kill');
    expect(kill && kill.k === 'kill' ? kill.w : -1).toBe(KillCause.MELEE);
  });
});
