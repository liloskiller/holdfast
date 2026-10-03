import { describe, expect, it } from 'vitest';
import { GameMode, PhaseId, WeaponId } from '@holdfast/shared';
import { killPlayer } from './systems/combatSystem';
import { addHuman, makeRoom } from './testUtil';

function startTwoPlayerMatch(settings = {}) {
  const room = makeRoom({ settings });
  const a = addHuman(room, 'Alice', 0);
  const b = addHuman(room, 'Bob', 1);
  const err = (room as unknown as { handleMessage: (p: unknown, m: unknown) => void });
  err.handleMessage(a.p, { t: 'START_MATCH' });
  return { room, a, b };
}

describe('round flow', () => {
  it('needs two players to start', () => {
    const room = makeRoom();
    const a = addHuman(room, 'Solo', 0);
    room.handleMessage(a.p, { t: 'START_MATCH' });
    expect(room.phase).toBe(PhaseId.LOBBY);
    expect(a.conn.last('ERR')?.msg).toMatch(/2 players/);
  });

  it('runs operator select, prep and action with timers', () => {
    const { room, a, b } = startTwoPlayerMatch();
    expect(room.phase).toBe(PhaseId.OPERATOR_SELECT);
    expect(room.round).toBe(1);
    expect(room.attackerTeam).toBe(0);
    room.advance(5100);
    expect(room.phase).toBe(PhaseId.PREP);
    expect(a.p.state.alive && b.p.state.alive).toBe(true);
    expect(a.p.state.confined).toBe(true); // attackers are confined in prep
    expect(b.p.state.confined).toBe(false);
    expect(a.p.state.dDeployed).toBe(true); // drone is out
    room.advance(5100);
    expect(room.phase).toBe(PhaseId.ACTION);
    expect(a.p.state.confined).toBe(false);
  });

  it('skips operator select when everyone has picked', () => {
    const { room, a, b } = startTwoPlayerMatch();
    room.handleMessage(a.p, { t: 'PICK_OPERATOR', op: 0, primary: WeaponId.CARBINE });
    room.handleMessage(b.p, { t: 'PICK_OPERATOR', op: 4, primary: WeaponId.HAMMER });
    room.advance(100);
    expect(room.phase).toBe(PhaseId.PREP);
    expect(a.p.op).toBe(0);
    expect(b.p.op).toBe(4);
  });

  it('validates operator picks (side and uniqueness)', () => {
    const { room, a, b } = startTwoPlayerMatch();
    room.handleMessage(a.p, { t: 'PICK_OPERATOR', op: 4, primary: 0 }); // defender op for an attacker
    expect(a.conn.last('ERR')?.msg).toMatch(/other side/);
    expect(a.p.picked).toBe(false);
    const c = addHuman(room, 'Carol', 0);
    room.handleMessage(a.p, { t: 'PICK_OPERATOR', op: 0, primary: 0 });
    room.handleMessage(c.p, { t: 'PICK_OPERATOR', op: 0, primary: 0 });
    expect(c.conn.last('ERR')?.msg).toMatch(/taken/);
    void b;
  });

  it('attackers win by eliminating defenders, scores, sides swap, match ends', () => {
    const { room, a, b } = startTwoPlayerMatch({ roundsToWin: 2, swapEvery: 1 });
    const toAction = (): void => {
      room.advance(5100);
      room.advance(5100);
      expect(room.phase).toBe(PhaseId.ACTION);
    };
    toAction();
    killPlayer(room, b.p, a.p, WeaponId.CARBINE, false);
    room.advance(100);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.scores).toEqual([1, 0]);
    expect(room.winnerTeam).toBe(0);
    room.advance(3100);
    expect(room.phase).toBe(PhaseId.OPERATOR_SELECT);
    expect(room.round).toBe(2);
    expect(room.attackerTeam).toBe(1); // swapped
    toAction();
    // Alice (team 0) is now a defender and kills the attacker Bob
    killPlayer(room, b.p, a.p, WeaponId.CARBINE, false);
    room.advance(100);
    expect(room.scores).toEqual([2, 0]);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    room.advance(3100);
    expect(room.phase).toBe(PhaseId.MATCH_END);
    expect(room.winnerTeam).toBe(0);
    room.advance(15100);
    expect(room.phase).toBe(PhaseId.LOBBY);
    expect(room.scores).toEqual([0, 0]);
  });

  it('defenders win when time runs out in Secure Area', () => {
    const { room } = startTwoPlayerMatch({ mode: GameMode.SECURE, actionTime: 10 });
    room.advance(5100);
    room.advance(5100);
    expect(room.phase).toBe(PhaseId.ACTION);
    room.advance(10200);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(1);
    expect(room.reason).toMatch(/Time/);
  });

  it('attackers secure the objective by holding the zone', () => {
    const { room, a } = startTwoPlayerMatch({ mode: GameMode.SECURE, captureTime: 3 });
    room.advance(5100);
    room.advance(5100);
    const site = room.map.objectives[room.objectiveIdx]!;
    // teleport the attacker into the zone
    a.p.state.x = (site.minX + site.maxX) / 2;
    a.p.state.z = (site.minZ + site.maxZ) / 2;
    a.p.state.y = site.y;
    room.advance(1500);
    expect(room.capture).toBeGreaterThan(0.3);
    expect(room.phase).toBe(PhaseId.ACTION);
    room.advance(2000);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(0);
    expect(room.reason).toMatch(/Objective/);
  });

  it('a disconnected player counts as dead for the round', () => {
    const { room, a, b } = startTwoPlayerMatch();
    room.advance(5100);
    room.advance(5100);
    room.disconnect(b.p);
    // a short blip is forgiven
    room.advance(1000);
    expect(room.phase).toBe(PhaseId.ACTION);
    expect(b.p.state.alive).toBe(true);
    room.advance(2500);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(a.p.team);
  });

  it('late joiners spectate until the next round', () => {
    const { room } = startTwoPlayerMatch();
    room.advance(5100);
    const late = addHuman(room, 'Late', 0);
    expect(late.p.state.alive).toBe(false);
  });
});
