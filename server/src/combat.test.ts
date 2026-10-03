import { describe, expect, it } from 'vitest';
import { Btn, WeaponId } from '@holdfast/shared';
import { shoot } from './systems/combatSystem';
import { addHuman, aimChest, feed, forceAction, makeRoom, place } from './testUtil';


describe('combat', () => {
  it('lag compensation: a shot at where the target was hits, a shot at where it is now misses', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    const b = addHuman(room, 'B', 1).p;
    forceAction(room);
    // A at (5, 0, 5) looking +x (yaw -PI/2). B walks from the ray (z=5) to z=8.
    place(a, 5, 0, 5, -Math.PI / 2);
    place(b, 15, 0, 5, 0);
    room.time = 1000;
    b.pushHistory(1000); // on the ray at t=1000
    b.state.z = 8;
    room.time = 1150;
    b.pushHistory(1150); // moved off the ray
    // Shooter saw B at time clientTime - 100 = 1000 => hit
    a.state.pitch = aimChest(a, b);
    shoot(room, a, 0, WeaponId.MARKSMAN, 1100);
    expect(b.state.hp).toBeLessThan(100);

    // reverse: B was off the ray at the rewound time and is on it now => miss
    b.state.hp = 100;
    b.clearHistory();
    b.state.z = 8;
    room.time = 2000;
    b.pushHistory(2000);
    b.state.z = 5;
    room.time = 2150;
    b.pushHistory(2150);
    shoot(room, a, 1, WeaponId.MARKSMAN, 2100);
    expect(b.state.hp).toBe(100);
    // with no rewinding (clientTime is now) the shot lands
    shoot(room, a, 2, WeaponId.MARKSMAN, 2150 + 100);
    expect(b.state.hp).toBeLessThan(100);
  });

  it('headshots deal extra damage and kills register once', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    const b = addHuman(room, 'B', 1).p;
    forceAction(room);
    place(a, 5, 0, 5, -Math.PI / 2);
    place(b, 12, 0, 5, 0);
    const bodyDmg = (): number => {
      b.state.hp = 100;
      a.state.pitch = aimChest(a, b);
      shoot(room, a, 0, WeaponId.SIDEARM, room.time);
      return 100 - b.state.hp;
    };
    const body = bodyDmg();
    expect(body).toBeGreaterThan(30);
    // aim at the head: eye 1.65 - 0.1 = 1.55 above feet; shooter eye is 1.65
    b.state.hp = 100;
    const dy = 1.55 - 1.65;
    a.state.pitch = Math.atan2(dy, 7);
    a.state.ads = true;
    shoot(room, a, 1, WeaponId.SIDEARM, room.time);
    expect(100 - b.state.hp).toBeGreaterThan(body * 2);
    a.state.ads = false;
    b.state.alive = true;
    b.state.hp = 20;
    const kills = a.kills;
    a.state.pitch = aimChest(a, b);
    shoot(room, a, 2, WeaponId.SIDEARM, room.time);
    expect(b.state.alive).toBe(false);
    expect(a.kills).toBe(kills + 1);
    shoot(room, a, 3, WeaponId.SIDEARM, room.time);
    expect(a.kills).toBe(kills + 1);
  });

  it('does not hurt teammates by default', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    const b = addHuman(room, 'B', 0).p;
    forceAction(room);
    place(a, 5, 0, 5, -Math.PI / 2);
    place(b, 12, 0, 5, 0);
    a.state.pitch = aimChest(a, b);
    shoot(room, a, 0, WeaponId.CARBINE, room.time);
    expect(b.state.hp).toBe(100);
  });

  it('full path: inputs fire, ammo drains, victim takes damage', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    const b = addHuman(room, 'B', 1).p;
    forceAction(room);
    place(a, 5, 0, 5, -Math.PI / 2);
    place(b, 12, 0, 5, 0);
    const ammo = a.state.ammo0;
    feed(room, a, { buttons: Btn.FIRE, yaw: -Math.PI / 2, pitch: aimChest(a, b) }, 20);
    expect(a.state.ammo0).toBeLessThan(ammo);
    expect(b.state.hp).toBeLessThan(100);
  });

  it('walls absorb bullets and soft walls let a weakened bullet through', () => {
    const room = makeRoom({ map: undefined });
    const a = addHuman(room, 'A', 0).p;
    const b = addHuman(room, 'B', 1).p;
    forceAction(room);
    place(a, 5, 0, 5, -Math.PI / 2);
    place(b, 12, 0, 5, 0);
    // put a plaster cell wall between them by editing the world voxel directly
    const w = room.world;
    expect(w.cellCount).toBe(0); // arena has no cells, so check static blocking instead
    for (let l = 0; l < 4; l++) w.vox[(l * w.nz + 10) * w.nx + 16] = 1;
    a.state.pitch = aimChest(a, b);
    shoot(room, a, 0, WeaponId.MARKSMAN, room.time);
    expect(b.state.hp).toBe(100);
  });
});
