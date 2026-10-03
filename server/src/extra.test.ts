import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GameMode, PhaseId, World, arenaMapText, decodeServer, encodeClient, parseMap, type ClientMsg, type ServerMsg,
} from '@holdfast/shared';
import { Lobby } from './Lobby';
import { killPlayer } from './systems/combatSystem';
import { buildSnapshot } from './systems/visibilitySystem';
import { FakeConn, addHuman, forceAction, makeRoom, place } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

describe('lobby and late join', () => {
  it('a late joiner receives the full destroyed state and matches the server world', () => {
    const lobby = new Lobby(SAFEHOUSE, { manual: true, clock: () => 0 });
    const c1 = new FakeConn();
    const cs1 = lobby.open(c1);
    lobby.message(cs1, encodeClient({ t: 'CREATE_ROOM', name: 'Host' } as ClientMsg));
    const joined1 = c1.last('JOINED')!;
    expect(joined1.code).toMatch(/^[A-Z]{4}$/);
    const room = lobby.rooms.get(joined1.code)!;
    // wreck some of the house
    room.world.reinforcePanel(0);
    room.world.damageCell(10, 1000);
    room.world.damageCell(11, 15);
    room.world.setDoorOpen(room.world.openings.find((o) => o.kind === 'door')!.id, true);

    const c2 = new FakeConn();
    const cs2 = lobby.open(c2);
    lobby.message(cs2, encodeClient({ t: 'JOIN_ROOM', code: joined1.code, name: 'Late' } as ClientMsg));
    const joined2 = c2.last('JOINED')!;
    expect(joined2.playerId).not.toBe(joined1.playerId);
    const client = new World(parseMap(joined2.mapText));
    client.applyDiff(joined2.world);
    expect(Array.from(client.cellAlive)).toEqual(Array.from(room.world.cellAlive));
    expect(Array.from(client.cellReinf)).toEqual(Array.from(room.world.cellReinf));
    expect(client.openings.map((o) => o.open)).toEqual(room.world.openings.map((o) => o.open));
    lobby.shutdown();
  });

  it('rejects a full room and an unknown room, and rate limits floods', () => {
    const lobby = new Lobby(arenaMapText(), { manual: true, clock: () => 0 });
    const host = new FakeConn();
    const hs = lobby.open(host);
    lobby.message(hs, encodeClient({ t: 'CREATE_ROOM', name: 'Host' } as ClientMsg));
    const code = host.last('JOINED')!.code;
    for (let i = 0; i < 9; i++) {
      const c = new FakeConn();
      lobby.message(lobby.open(c), encodeClient({ t: 'JOIN_ROOM', code, name: 'P' + i } as ClientMsg));
      expect(c.last('JOINED')).toBeDefined();
    }
    const extra = new FakeConn();
    lobby.message(lobby.open(extra), encodeClient({ t: 'JOIN_ROOM', code, name: 'Eleven' } as ClientMsg));
    expect(extra.last('ERR')?.msg).toMatch(/full/);

    const flood = new FakeConn();
    const fs2 = lobby.open(flood);
    for (let i = 0; i < 1000; i++) lobby.message(fs2, JSON.stringify({ t: 'PING', c: i }));
    expect(flood.closed).toBe(true);
    lobby.shutdown();
  });

  it('room codes avoid ambiguous letters', () => {
    const lobby = new Lobby(arenaMapText(), { manual: true, clock: () => 0 });
    for (let i = 0; i < 40; i++) {
      const c = new FakeConn();
      lobby.message(lobby.open(c), encodeClient({ t: 'CREATE_ROOM', name: 'x' } as ClientMsg));
      expect(c.last('JOINED')!.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    }
    lobby.shutdown();
  });
});

describe('spectating and visibility details', () => {
  it('dead players cycle through living teammates and follow them', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    const b = addHuman(room, 'B', 0).p;
    const c = addHuman(room, 'C', 0).p;
    const e = addHuman(room, 'E', 1).p;
    forceAction(room);
    place(a, 5, 0, 5); place(b, 6, 0, 5); place(c, 7, 0, 5); place(e, 30, 0, 5);
    killPlayer(room, a, e, 0, false);
    expect(a.spec).toBe(b.id);
    room.cycleSpectate(a, 1);
    expect(a.spec).toBe(c.id);
    room.cycleSpectate(a, 1);
    expect(a.spec).toBe(b.id);
    // when the spectated player dies, the spectator moves on
    killPlayer(room, b, e, 0, false);
    expect(a.spec).toBe(c.id);
    const snap = buildSnapshot(room, a, null);
    expect(snap.extra.spec).toBe(c.id);
    expect(snap.players.some((p) => p.id === c.id)).toBe(true);
  });

  it('visibility keeps an enemy for half a second after losing line of sight', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0).p;
    const e = addHuman(room, 'E', 1).p;
    forceAction(room);
    place(a, 5, 0, 5); place(e, 15, 0, 5);
    expect(buildSnapshot(room, a, null).players.some((p) => p.id === e.id)).toBe(true);
    // block the view with a static wall column
    const w = room.world;
    for (let l = 0; l < 6; l++) for (let z = 6; z <= 14; z++) w.vox[(l * w.nz + z) * w.nx + 25] = 1;
    expect(buildSnapshot(room, a, null).players.some((p) => p.id === e.id)).toBe(true);
    room.advance(600);
    expect(buildSnapshot(room, a, null).players.some((p) => p.id === e.id)).toBe(false);
  });
});

describe('timers and overtime', () => {
  function start(settings = {}) {
    const room = makeRoom({ settings });
    const a = addHuman(room, 'A', 0);
    const b = addHuman(room, 'B', 1);
    room.handleMessage(a.p, { t: 'START_MATCH' });
    room.advance(5100);
    room.advance(5100);
    return { room, a, b };
  }

  it('overtime lets a nearly finished capture complete', () => {
    const { room, a } = start({ mode: GameMode.SECURE, actionTime: 30, captureTime: 20 });
    const site = room.map.objectives[room.objectiveIdx]!;
    room.advance(12000);
    // the attacker enters the zone with 18 seconds left: 18 of the 20 capture seconds are done at the bell
    a.p.state.x = (site.minX + site.maxX) / 2;
    a.p.state.z = (site.minZ + site.maxZ) / 2;
    a.p.state.y = site.y;
    room.advance(17800);
    expect(room.phase).toBe(PhaseId.ACTION);
    room.advance(600);
    // timer expired while capturing with an attacker inside: overtime, not an immediate defender win
    expect(room.overtime).toBe(true);
    expect(room.phase).toBe(PhaseId.ACTION);
    room.advance(3000);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(0);
    expect(room.reason).toMatch(/Objective/);
  });

  it('without a capture in progress the bell ends the round for the defenders', () => {
    const { room } = start({ mode: GameMode.SECURE, actionTime: 10 });
    room.advance(10400);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(1);
  });

  it('elimination timeout goes to the team with more survivors, defenders on a tie', () => {
    const { room, b } = start({ mode: GameMode.ELIMINATION, actionTime: 10 });
    room.advance(10300);
    expect(room.phase).toBe(PhaseId.ROUND_END);
    expect(room.winnerTeam).toBe(b.p.team);
  });
});

describe('protocol sanity', () => {
  it('decodes server messages as typed objects', () => {
    const room = makeRoom();
    const a = addHuman(room, 'A', 0);
    room.advance(200);
    const snap = a.conn.last('SNAP');
    expect(snap).toBeDefined();
    const raw: ServerMsg | null = decodeServer(JSON.stringify({ t: 'PONG', c: 1, s: 2 }));
    expect(raw).toEqual({ t: 'PONG', c: 1, s: 2 });
  });
});
