import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GameMode, PhaseId } from '@holdfast/shared';
import { addBot } from './bots/botSystem';
import { Lobby } from './Lobby';
import { startMatch } from './systems/roundSystem';
import { Player } from './Player';
import { FakeConn, forceAction, makeRoom, place } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

function botMatchRoom(seed: number, size = 3, difficulty = 1, mode: GameMode = GameMode.SECURE): ReturnType<typeof makeRoom> {
  const room = makeRoom({
    map: SAFEHOUSE,
    settings: { prepTime: 30, actionTime: 100, operatorSelectTime: 5, roundEndTime: 3, roundsToWin: 2, mode },
  });
  room.rngState = seed >>> 0;
  for (let i = 0; i < size; i++) {
    addBot(room, 0, difficulty);
    addBot(room, 1, difficulty);
  }
  return room;
}

describe('bots', () => {
  it('bots in an open arena find each other and fight', () => {
    const room = makeRoom();
    const a1 = addBot(room, 0, 2)!;
    const a2 = addBot(room, 0, 2)!;
    const b1 = addBot(room, 1, 2)!;
    const b2 = addBot(room, 1, 2)!;
    forceAction(room);
    [a1, a2].forEach((p, i) => place(p, 3, 0, 4 + i * 2, -Math.PI / 2));
    [b1, b2].forEach((p, i) => place(p, 17, 0, 5 + i * 2, Math.PI / 2));
    room.advance(15000);
    const kills = [a1, a2, b1, b2].reduce((n, p) => n + p.kills, 0);
    expect(kills).toBeGreaterThan(0);
  });

  it('bots obey the normal rules: they cannot hurt teammates, and dead bots stay quiet', () => {
    const room = makeRoom();
    const a1 = addBot(room, 0, 2)!;
    const a2 = addBot(room, 0, 2)!;
    // an enemy dummy keeps the round alive (bots ignore dummies outside Practice)
    const dummy = new Player(100, 'Dummy');
    dummy.isDummy = true;
    dummy.team = 1;
    dummy.connected = true;
    room.players.set(dummy.id, dummy);
    forceAction(room);
    place(dummy, 17, 0, 10, 0);
    place(a1, 5, 0, 5, -Math.PI / 2);
    place(a2, 12, 0, 5, Math.PI / 2);
    room.advance(8000);
    expect(a1.state.hp).toBe(100);
    expect(a2.state.hp).toBe(100);
    a1.state.alive = false;
    a1.queue.length = 0;
    room.advance(500);
    expect(a1.queue.length).toBe(0);
  });

  it('a bots only match runs through all its phases to a winner (several seeds, easy to hard)', () => {
    const reasons = new Set<string>();
    for (const [seed, diff] of [[3, 1], [11, 0], [5, 2], [21, 1]] as const) {
      const room = botMatchRoom(seed, 3, diff);
      expect(startMatch(room)).toBeNull();
      const seen = new Set<number>();
      let ticks = 0;
      while (room.phase !== PhaseId.MATCH_END && ticks < 60 * 60 * 12) {
        room.advance(500);
        ticks += 30;
        seen.add(room.phase);
        if (room.phase === PhaseId.ROUND_END && room.reason) reasons.add(room.reason);
      }
      expect(room.phase, `seed ${seed}`).toBe(PhaseId.MATCH_END);
      for (const ph of [PhaseId.OPERATOR_SELECT, PhaseId.PREP, PhaseId.ACTION, PhaseId.ROUND_END]) expect(seen.has(ph)).toBe(true);
      expect(Math.max(room.scores[0], room.scores[1])).toBe(2);
      const kills = [...room.players.values()].reduce((n, p) => n + p.kills, 0);
      expect(kills).toBeGreaterThan(2);
    }
    // across the matches the objective was actually taken at least once
    expect(reasons.has('Objective secured')).toBe(true);
  });

  it('bots play bomb mode: they plant, defuse and finish the match', () => {
    const reasons = new Set<string>();
    for (const [seed, diff] of [[3, 1], [11, 1], [5, 2], [21, 1], [8, 0]] as const) {
      const room = botMatchRoom(seed, 3, diff, GameMode.BOMB);
      expect(startMatch(room)).toBeNull();
      let ticks = 0;
      while (room.phase !== PhaseId.MATCH_END && ticks < 60 * 60 * 14) {
        room.advance(500);
        ticks += 30;
        if (room.phase === PhaseId.ROUND_END && room.reason) reasons.add(room.reason);
      }
      expect(room.phase, `seed ${seed}`).toBe(PhaseId.MATCH_END);
    }
    // somebody planted the defuser in at least one round, and it either went off or was disabled
    expect(reasons.has('Defuser detonated') || reasons.has('Defuser disabled')).toBe(true);
  });

  it('defender bots reinforce walls and barricade doors during prep, attackers do not', () => {
    const room = botMatchRoom(7);
    startMatch(room);
    room.advance(5000 + 30000);
    expect(room.phase === PhaseId.PREP || room.phase === PhaseId.ACTION).toBe(true);
    expect(room.world.panels.filter((p) => p.reinforced).length).toBeGreaterThan(0);
    expect(room.world.openings.filter((o) => o.barricadeHp > 0).length).toBeGreaterThan(0);
  });

  it('bots pick distinct operators for their side', () => {
    const room = botMatchRoom(9, 4);
    startMatch(room);
    room.advance(6000);
    for (const team of [0, 1] as const) {
      const ops = [...room.players.values()].filter((p) => p.team === team).map((p) => p.op);
      const unique = ops.filter((o) => o < 8);
      expect(new Set(unique).size).toBe(unique.length);
    }
  });

  it('a solo match request builds the teams and starts the match', () => {
    const lobby = new Lobby(SAFEHOUSE, { manual: true, clock: () => 0 });
    const conn = new FakeConn();
    const cs = lobby.open(conn);
    lobby.message(cs, JSON.stringify({ t: 'CREATE_ROOM', name: 'Me', solo: { size: 3, difficulty: 2, side: 1 } }));
    const room = [...lobby.rooms.values()][0]!;
    const players = [...room.players.values()];
    expect(players).toHaveLength(6);
    expect(players.filter((p) => p.isBot)).toHaveLength(5);
    const me = players.find((p) => !p.isBot)!;
    expect(me.team).toBe(1); // started as a defender
    expect(players.filter((p) => p.team === 1)).toHaveLength(3);
    expect(room.phase).toBe(PhaseId.OPERATOR_SELECT);
    expect(room.roomState().players.filter((p) => p.bot)).toHaveLength(5);
    // the human picks and the round goes on once the bots have picked too
    lobby.message(cs, JSON.stringify({ t: 'PICK_OPERATOR', op: 9, primary: 0 }));
    room.advance(8000);
    expect(room.phase).toBe(PhaseId.PREP);
    expect(room.alivePlayers().length).toBe(6);
    // leaving ends the room for the bots too
    lobby.message(cs, JSON.stringify({ t: 'LEAVE' }));
    room.advance(1000);
    expect(room.livePeople()).toHaveLength(0);
    expect(room.emptySince).toBeGreaterThan(0);
  });

  it('nothing in the room is ever sent to a bot (no connection)', () => {
    const room = botMatchRoom(2);
    startMatch(room);
    room.advance(2000);
    for (const p of room.players.values()) expect(p.conn).toBeNull();
  });
});
