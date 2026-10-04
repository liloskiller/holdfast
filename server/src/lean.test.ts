import { describe, expect, it } from 'vitest';
import { KillCause, PhaseId, WeaponId, eyeHeight } from '@holdfast/shared';
import { shoot } from './systems/combatSystem';
import { buildSnapshot } from './systems/visibilitySystem';
import { addHuman, feed, forceAction, makeRoom, place } from './testUtil';

const FACING_EAST = -Math.PI / 2;
const FACING_WEST = Math.PI / 2;

function peekSetup(): { room: ReturnType<typeof makeRoom>; a: ReturnType<typeof addHuman>; b: ReturnType<typeof addHuman> } {
  const room = makeRoom();
  const a = addHuman(room, 'A', 0);
  const b = addHuman(room, 'B', 1);
  forceAction(room);
  room.phase = PhaseId.ACTION;
  // a wall 0.5 m thick (x tile 14) that covers z 5.0 to 6.0
  const w = room.world;
  for (let l = 0; l < 5; l++) for (const zt of [10, 11]) w.vox[(l * w.nz + zt) * w.nx + 14] = 1;
  place(a.p, 3, 0, 4.91, FACING_EAST);
  place(b.p, 10, 0, 5.25, FACING_WEST);
  return { room, a, b };
}

describe('lean on the server', () => {
  it('a leaned head sticks out of cover and can be shot, an unleaned one cannot', () => {
    const { room, a, b } = peekSetup();
    const headY = b.p.state.y + 1.65 - 0.1 - 0.05;
    const pitch = Math.atan2(headY - (a.p.state.y + eyeHeight(a.p.state)), 7);
    const aim = { yaw: FACING_EAST, pitch, spread: 0 };
    shoot(room, a.p, 0, WeaponId.MARKSMAN, room.time, aim);
    expect(b.p.state.hp).toBe(100); // not leaning: the head is behind the wall

    b.p.state.lean = 1; // leaning right (toward -z while facing west)
    b.p.clearHistory();
    shoot(room, a.p, 1, WeaponId.MARKSMAN, room.time, aim);
    expect(b.p.state.hp).toBeLessThan(100);
  });

  it('visibility: only a leaned head is seen around the corner', () => {
    const { room, a, b } = peekSetup();
    a.p.seen.clear();
    expect(buildSnapshot(room, a.p, null).players.find((p) => p.id === b.p.id)).toBeUndefined();
    b.p.state.lean = 1;
    a.p.seen.clear();
    const snap = buildSnapshot(room, a.p, null);
    expect(snap.players.find((p) => p.id === b.p.id)).toBeDefined();
  });

  it('the shooter fires from the leaned eye (so they can shoot around a corner)', () => {
    const { room, a, b } = peekSetup();
    // A stands at z=5.25 (behind the wall as well) and leans out toward -z to shoot B's head
    place(a.p, 3, 0, 5.25, FACING_EAST);
    b.p.state.lean = 0;
    place(b.p, 10, 0, 4.91, FACING_WEST);
    b.p.state.hp = 100;
    const pitch = Math.atan2(1.55 - 1.65, 7);
    // from the unleaned eye the ray at yaw east crosses z=5.25 only: the wall is at x 7..7.5 for z 5..6, so it is blocked
    shoot(room, a.p, 0, WeaponId.MARKSMAN, room.time, { yaw: FACING_EAST, pitch, spread: 0 });
    expect(b.p.state.hp).toBe(100);
    a.p.state.lean = -1; // facing east, right is +z, so left is -z: the eye moves to z=4.91
    shoot(room, a.p, 1, WeaponId.MARKSMAN, room.time, { yaw: FACING_EAST, pitch: Math.atan2(1.5 - 1.6, 7), spread: 0 });
    expect(b.p.state.hp).toBeLessThan(100);
  });

  it('lean is driven by input commands and shows up as a flag for other players', () => {
    const { room, a, b } = peekSetup();
    room.debugNoVisibility = true;
    feed(room, b.p, { buttons: 1 << 14, yaw: FACING_WEST }, 30); // LEAN_R
    expect(b.p.state.lean).toBe(1);
    const snap = buildSnapshot(room, a.p, null);
    const seen = snap.players.find((p) => p.id === b.p.id)!;
    expect((seen.flags & 512) !== 0).toBe(true);
  });
});

describe('falling', () => {
  it('a long fall hurts, a short drop does not, and a lethal one is a fall kill', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0);
    addHuman(room, 'B', 1);
    forceAction(room);
    place(a.p, 5, 2.5, 5, 0);
    a.p.state.onGround = false;
    feed(room, a.p, {}, 60);
    expect(a.p.state.y).toBeCloseTo(0, 1);
    expect(a.p.state.hp).toBeLessThan(100);
    expect(a.p.state.hp).toBeGreaterThan(50);

    place(a.p, 5, 0.8, 5, 0);
    a.p.state.onGround = false;
    feed(room, a.p, {}, 40);
    expect(a.p.state.hp).toBe(100);

    place(a.p, 5, 8, 5, 0);
    a.p.state.onGround = false;
    feed(room, a.p, {}, 120);
    expect(a.p.state.alive).toBe(false);
    const kills = a.conn.msgs.flatMap((m) => (m.t === 'SNAP' ? m.snap.events : [])).filter((e) => e.k === 'kill');
    expect(kills.some((e) => e.k === 'kill' && e.w === KillCause.FALL)).toBe(true);
  });
});
