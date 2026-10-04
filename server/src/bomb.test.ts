import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOMB, BombState, Btn, EntityKind, GameMode, PhaseId } from '@holdfast/shared';
import { addHuman, feed, forceAction, makeRoom, place } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

function bombRoom() {
  const room = makeRoom({ map: SAFEHOUSE, settings: { mode: GameMode.BOMB, actionTime: 120 } });
  const atk = addHuman(room, 'Atk', 0);
  const atk2 = addHuman(room, 'Atk2', 0);
  const def = addHuman(room, 'Def', 1);
  const def2 = addHuman(room, 'Def2', 1);
  forceAction(room);
  room.phaseEndsAt = room.time + 120000;
  room.attackerTeam = 0;
  room.objectiveIdx = 0;
  const site = room.map.objectives[0]!;
  const cx = (site.minX + site.maxX) / 2;
  const cz = (site.minZ + site.maxZ) / 2;
  place(atk.p, cx, 0, cz, 0);
  place(atk2.p, 30, 0, 52, 0);
  place(def.p, cx + 2.2, 0, cz, Math.PI / 2);
  place(def2.p, 20, 0, 20, 0);
  return { room, atk, atk2, def, def2, cx, cz };
}

describe('bomb mode', () => {
  it('attackers plant by holding INTERACT on the site, and only there', () => {
    const { room, atk, atk2 } = bombRoom();
    // outside the site: nothing starts
    feed(room, atk2.p, { buttons: Btn.INTERACT, yaw: 0 }, 60 * 5);
    expect(room.bomb.state).toBe(BombState.NONE);
    // on the site: a partial hold does not plant
    feed(room, atk.p, { buttons: Btn.INTERACT, yaw: 0 }, 60 * 2);
    expect(room.bomb.state).toBe(BombState.NONE);
    feed(room, atk.p, { buttons: 0, yaw: 0 }, 3);
    feed(room, atk.p, { buttons: Btn.INTERACT, yaw: 0 }, Math.ceil(60 * (BOMB.plantTime + 0.8)));
    expect(room.bomb.state).toBe(BombState.PLANTED);
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.BOMB)).toBe(true);
    // the round clock is now the fuse
    expect(room.phaseEndsAt - room.time).toBeLessThanOrEqual(BOMB.timer * 1000);
    expect(room.phaseInfo().bomb).toBe(BombState.PLANTED);
  });

  it('defenders disable it from close by, which ends the round for them', () => {
    const { room, atk, def } = bombRoom();
    feed(room, atk.p, { buttons: Btn.INTERACT, yaw: 0 }, Math.ceil(60 * (BOMB.plantTime + 0.8)));
    expect(room.bomb.state).toBe(BombState.PLANTED);
    // too far away to try
    place(def.p, room.bomb.x + 5, 0, room.bomb.z, 0);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: 0 }, 60 * 9);
    expect(room.bomb.state).toBe(BombState.PLANTED);
    place(def.p, room.bomb.x + 1, 0, room.bomb.z, 0);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: 0 }, Math.ceil(60 * (BOMB.defuseTime + 0.8)));
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(1);
    expect(room.reason).toBe('Defuser disabled');
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.BOMB)).toBe(false);
  });

  it('the fuse burns down, the blast hurts whoever stands close and the attackers win', () => {
    const { room, atk, atk2, def } = bombRoom();
    feed(room, atk.p, { buttons: Btn.INTERACT, yaw: 0 }, Math.ceil(60 * (BOMB.plantTime + 0.8)));
    expect(room.bomb.state).toBe(BombState.PLANTED);
    // the planter walks off, a defender stays next to the bomb and is hit by the blast
    place(atk.p, 60, 0, 52, 0);
    place(def.p, room.bomb.x + 1.5, 0, room.bomb.z, 0);
    room.advance((BOMB.timer + 1) * 1000);
    expect(room.bomb.state).toBe(BombState.EXPLODED);
    expect(def.p.state.alive).toBe(false);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(0);
    expect(room.reason).toBe('Defuser detonated');
    void atk2;
  });

  it('the round goes on when every attacker is down after the plant, but not before', () => {
    const a = bombRoom();
    a.atk.p.state.alive = false;
    a.atk2.p.state.alive = false;
    a.room.advance(100);
    expect(a.room.reason).toBe('Attackers eliminated');
    expect(a.room.winnerTeam).toBe(1);

    const b = bombRoom();
    feed(b.room, b.atk.p, { buttons: Btn.INTERACT, yaw: 0 }, Math.ceil(60 * (BOMB.plantTime + 0.8)));
    expect(b.room.bomb.state).toBe(BombState.PLANTED);
    b.atk.p.state.alive = false;
    b.atk2.p.state.alive = false;
    b.room.advance(500);
    expect(b.room.phase).toBe(PhaseId.ACTION);
    // defenders wipe the attackers out: they have to disable it, and cannot hide from the timer
    b.room.advance(BOMB.timer * 1000);
    expect(b.room.winnerTeam).toBe(0);
  });

  it('nothing planted before time runs out hands the round to the defenders', () => {
    const { room } = bombRoom();
    room.advance(121000);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(1);
    expect(room.reason).toBe('Time expired');
  });
});
