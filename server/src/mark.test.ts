import { describe, expect, it } from 'vitest';
import { arenaMapText } from '@holdfast/shared';
import { addHuman, forceAction, makeRoom, place } from './testUtil';
import { markSpot } from './systems/markSystem';

const EAST = -Math.PI / 2;

function marks(room: ReturnType<typeof makeRoom>, id: number) {
  return (room.priv.get(id) ?? []).filter((e) => e.k === 'mark') as Extract<import('@holdfast/shared').GameEvent, { k: 'mark' }>[];
}

describe('team markers', () => {
  it('only the team is told, the spot is where you look and an enemy in the way marks the enemy', () => {
    const room = makeRoom({ map: arenaMapText({ nx: 120, nz: 60 }) });
    const a = addHuman(room, 'A', 0);
    const b = addHuman(room, 'B', 0);
    const e = addHuman(room, 'E', 1);
    forceAction(room);
    place(a.p, 5, 0, 12, EAST);
    place(b.p, 6, 0, 8, 0);
    place(e.p, 25, 0, 12, 0);
    // looking along the arena: the enemy stands in the way at x = 25
    a.p.state.pitch = -0.045;
    markSpot(room, a.p);
    const got = marks(room, b.p.id);
    expect(got).toHaveLength(1);
    expect(got[0]!.enemy).toBe(true);
    expect(got[0]!.x).toBeGreaterThan(23);
    expect(got[0]!.x).toBeLessThan(25.5);
    expect(marks(room, e.p.id)).toHaveLength(0);
    // the pinger sees it too
    expect(marks(room, a.p.id)).toHaveLength(1);
  });

  it('a plain wall or floor gives a spot, a second press right away is ignored', () => {
    const room = makeRoom({ map: arenaMapText({ nx: 120, nz: 60 }) });
    const a = addHuman(room, 'A', 0);
    const b = addHuman(room, 'B', 0);
    const e = addHuman(room, 'E', 1);
    forceAction(room);
    place(a.p, 5, 0, 12, EAST);
    place(b.p, 6, 0, 8, 0);
    place(e.p, 30, 0, 20, 0);
    // looking down at the floor 4 m ahead
    a.p.state.pitch = -Math.atan2(1.65, 4);
    markSpot(room, a.p);
    markSpot(room, a.p);
    const got = marks(room, b.p.id);
    expect(got).toHaveLength(1);
    expect(got[0]!.enemy).toBe(false);
    expect(got[0]!.x).toBeGreaterThan(8.5);
    expect(got[0]!.x).toBeLessThan(9.5);
    expect(got[0]!.y).toBeLessThan(0.1);
    // the snapshots in between delivered the first one; after the cooldown a new one goes out
    room.advance(900);
    expect(marks(room, b.p.id)).toHaveLength(0);
    markSpot(room, a.p);
    expect(marks(room, b.p.id)).toHaveLength(1);
  });
});
