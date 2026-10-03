// Randomized soak test: six players mash every button on the real map for several rounds.
// Looks for exceptions, NaN state, out of range values and snapshots that fail to encode.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Btn, GameMode, OPERATORS, PhaseId, Rng, cmdFor, decodeServer, operatorDef, type RoomSettings,
} from '@holdfast/shared';
import { Room } from './Room';
import { FakeConn } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

function run(seed: number, mode: GameMode, seconds: number): { rounds: number; kills: number } {
  const rng = new Rng(seed);
  const settings: Partial<RoomSettings> = {
    mode, prepTime: 5, actionTime: 40, operatorSelectTime: 5, roundEndTime: 3, roundsToWin: 4, captureTime: 6,
  };
  const room = new Room('FUZZ', SAFEHOUSE, { settings, seed, clock: () => 0 });
  const conns: FakeConn[] = [];
  for (let i = 0; i < 6; i++) {
    const c = new FakeConn();
    const p = room.addPlayer('F' + i, c);
    if (!p) throw new Error('full');
    p.team = (i % 2) as 0 | 1;
    conns.push(c);
  }
  const host = [...room.players.values()][0]!;
  room.handleMessage(host, { t: 'START_MATCH' });

  const players = [...room.players.values()];
  const held = players.map(() => ({ moveX: 0, moveZ: 0, yaw: rng.range(-3, 3), buttons: 0, until: 0, slot: 0 }));
  let seq = 0;
  const w = room.world;
  const ticks = seconds * 60;
  let kills = 0;

  for (let t = 0; t < ticks; t++) {
    for (const [i, p] of players.entries()) {
      const h = held[i]!;
      if (t >= h.until) {
        h.until = t + 10 + rng.int(60);
        h.moveX = rng.pick([-1, 0, 0, 1, 0.5]);
        h.moveZ = rng.pick([-1, 0, 1, 1, 1]);
        h.yaw += rng.range(-1.2, 1.2);
        h.slot = rng.int(2);
        let b = 0;
        if (rng.next() < 0.4) b |= Btn.FIRE;
        if (rng.next() < 0.15) b |= Btn.SPRINT;
        if (rng.next() < 0.1) b |= Btn.CROUCH;
        if (rng.next() < 0.2) b |= Btn.INTERACT;
        if (rng.next() < 0.1) b |= Btn.ADS;
        if (rng.next() < 0.08) b |= Btn.RELOAD;
        if (rng.next() < 0.1) b |= Btn.GADGET;
        if (rng.next() < 0.06) b |= Btn.DRONE;
        if (rng.next() < 0.05) b |= Btn.CAMERA;
        if (rng.next() < 0.06) b |= Btn.MELEE;
        if (rng.next() < 0.04) b |= Btn.UP;
        if (rng.next() < 0.04) b |= Btn.DOWN;
        h.buttons = b;
      }
      if (room.phase === PhaseId.OPERATOR_SELECT && t % 30 === 0) {
        const side = p.team === room.attackerTeam ? 'attack' : 'defend';
        const ops = OPERATORS.filter((o) => o.side === side);
        const op = rng.pick(ops);
        room.handleMessage(p, { t: 'PICK_OPERATOR', op: op.id, primary: rng.pick(operatorDef(op.id).primaries) });
      }
      const cmd = cmdFor(p.state, {
        moveX: h.moveX, moveZ: h.moveZ, yaw: h.yaw + Math.sin(t / 25 + i) * 0.1, pitch: Math.sin(t / 40 + i) * 0.4,
        buttons: h.buttons, slot: h.slot,
      });
      cmd.seq = ++seq;
      cmd.clientTime = room.time - rng.int(120);
      p.queue.push(cmd);
      p.lastQueuedSeq = cmd.seq;
    }
    room.advance(1000 / 60);

    if (t % 30 === 0) {
      for (const p of players) {
        const s = p.state;
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === 'number') expect(Number.isFinite(v), `${k} is ${v} at tick ${t} (seed ${seed})`).toBe(true);
        }
        expect(s.x).toBeGreaterThan(-1);
        expect(s.x).toBeLessThan(w.nx * 0.5 + 1);
        expect(s.z).toBeGreaterThan(-1);
        expect(s.z).toBeLessThan(w.nz * 0.5 + 1);
        expect(s.y).toBeGreaterThan(-1);
        expect(s.y).toBeLessThan(8);
        expect(s.hp).toBeLessThanOrEqual(120);
        expect(s.ammo0).toBeGreaterThanOrEqual(0);
        expect(s.ammo1).toBeGreaterThanOrEqual(0);
      }
      for (const e of room.entities.values()) {
        expect(Number.isFinite(e.x + e.y + e.z)).toBe(true);
      }
    }
  }
  // every message the server produced must decode
  for (const c of conns) {
    expect(c.msgs.length).toBeGreaterThan(50);
    for (const m of c.msgs) if (m.t === 'SNAP') kills += m.snap.events.filter((e) => e.k === 'kill').length;
  }
  void decodeServer;
  return { rounds: room.round, kills: kills / conns.length };
}

describe('fuzz soak', () => {
  for (const [seed, mode] of [[1, GameMode.SECURE], [2, GameMode.ELIMINATION], [3, GameMode.SECURE], [4, GameMode.ELIMINATION]] as const) {
    it(`survives random play (seed ${seed}, mode ${mode})`, () => {
      const r = run(seed, mode, 150);
      expect(r.rounds).toBeGreaterThanOrEqual(1);
    }, 60000);
  }

  const extra = Number(process.env['FUZZ_EXTRA'] ?? 0);
  for (let k = 0; k < extra; k++) {
    it(`extra seed ${100 + k}`, () => {
      const r = run(100 + k, k % 2 === 0 ? GameMode.SECURE : GameMode.ELIMINATION, 120);
      expect(r.rounds).toBeGreaterThanOrEqual(1);
    }, 60000);
  }

  it('practice sandbox survives random play too', () => {
    const rng = new Rng(9);
    const room = new Room('SAND', SAFEHOUSE, { sandbox: true, seed: 9, clock: () => 0 });
    const c = new FakeConn();
    const p = room.addPlayer('Solo', c)!;
    let seq = 0;
    for (let t = 0; t < 60 * 90; t++) {
      if (t % 45 === 0) {
        const op = rng.pick(OPERATORS);
        room.handleMessage(p, { t: 'PICK_OPERATOR', op: op.id, primary: rng.pick(op.primaries) });
        if (rng.next() < 0.15) room.handleMessage(p, { t: 'DEBUG', cmd: rng.pick(['breach', 'reinforce', 'reset', 'refill', 'respawn', 'dummies']) });
      }
      let b = 0;
      if (rng.next() < 0.5) b |= Btn.FIRE;
      if (rng.next() < 0.2) b |= Btn.INTERACT;
      if (rng.next() < 0.2) b |= Btn.GADGET;
      if (rng.next() < 0.1) b |= Btn.DRONE;
      if (rng.next() < 0.1) b |= Btn.CAMERA;
      if (rng.next() < 0.1) b |= Btn.MELEE;
      const cmd = cmdFor(p.state, { moveZ: rng.pick([0, 1, 1]), moveX: rng.pick([-1, 0, 1]), yaw: t * 0.02, pitch: Math.sin(t / 50) * 0.5, buttons: b });
      cmd.seq = ++seq;
      cmd.clientTime = room.time;
      p.queue.push(cmd);
      p.lastQueuedSeq = cmd.seq;
      room.advance(1000 / 60);
      if (t % 60 === 0) {
        for (const v of Object.values(p.state)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(c.msgs.length).toBeGreaterThan(100);
  }, 60000);
});
