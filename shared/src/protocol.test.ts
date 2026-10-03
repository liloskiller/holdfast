import { describe, expect, it } from 'vitest';
import {
  decodeClient, decodeServer, encodeClient, encodeServer, makeExtra, sanitizeName,
} from './protocol';
import { Btn, EntityKind, createPlayerState, makeCmd, quantizeCmd, stateFromArray, stateToArray, type ClientMsg, type Snapshot } from './types';

describe('protocol', () => {
  it('round trips input commands exactly after quantization', () => {
    const cmds = [1, 2, 3].map((i) => {
      const c = makeCmd();
      c.seq = i;
      c.moveX = 0.123456 * i;
      c.moveZ = -0.7777;
      c.yaw = 3.14159 + i;
      c.pitch = -0.4321;
      c.buttons = Btn.FIRE | Btn.SPRINT | Btn.ADS;
      c.clientTime = 123456.7 + i;
      c.slot = 1;
      return quantizeCmd(c);
    });
    const msg: ClientMsg = { t: 'INPUT', cmds };
    const back = decodeClient(encodeClient(msg));
    expect(back).toEqual(msg);
  });

  it('round trips snapshots within quantization', () => {
    const s = createPlayerState();
    s.x = 12.345;
    s.alive = true;
    const snap: Snapshot = {
      tick: 99, time: 12345.6, ack: 77, self: stateToArray(s), extra: { ...makeExtra(), reinf: 2, actP: 0.5 },
      players: [{ id: 3, x: 1.234, y: 3, z: -0.5, yaw: 1.2, pitch: -0.3, flags: 3, weapon: 1, hp: 80 }],
      entities: [{ id: 9, kind: EntityKind.SHIELD, team: 0, owner: 3, x: 4, y: 0, z: 5, a: 1.5, hp: 400, b: 0 }],
      world: { c: [[1, 20, 0]], o: [] },
      events: [{ k: 'msg', text: 'hi' }],
    };
    const back = decodeServer(encodeServer({ t: 'SNAP', snap }));
    expect(back?.t).toBe('SNAP');
    if (back?.t !== 'SNAP') return;
    const b = back.snap;
    expect(b.tick).toBe(99);
    expect(b.ack).toBe(77);
    expect(b.players[0]!.x).toBeCloseTo(1.234, 2);
    expect(b.players[0]!.yaw).toBeCloseTo(1.2, 3);
    expect(b.players[0]!.pitch).toBeCloseTo(-0.3, 3);
    expect(b.players[0]!.hp).toBe(80);
    expect(b.entities[0]!.hp).toBe(400);
    expect(b.extra.reinf).toBe(2);
    expect(b.extra.actP).toBeCloseTo(0.5, 2);
    expect(b.world?.c[0]).toEqual([1, 20, 0]);
    expect(b.events).toEqual([{ k: 'msg', text: 'hi' }]);
    const st = stateFromArray(b.self, createPlayerState());
    expect(st.x).toBeCloseTo(12.345, 6);
    expect(st.alive).toBe(true);
  });

  it('rejects malformed client messages', () => {
    expect(decodeClient('not json')).toBeNull();
    expect(decodeClient('[]')).toBeNull();
    expect(decodeClient('{"t":"NOPE"}')).toBeNull();
    expect(decodeClient('{"t":"INPUT","c":"x"}')).toBeNull();
    expect(decodeClient('{"t":"INPUT","c":[[1,2,3]]}')).toBeNull();
    expect(decodeClient('{"t":"INPUT","c":[["a",0,0,0,0,0,0,0]]}')).toBeNull();
    expect(decodeClient('{"t":"JOIN_ROOM","code":5,"name":"x"}')).toBeNull();
    expect(decodeClient('{"t":"SET_TEAM","team":7}')).toBeNull();
    expect(decodeClient('x'.repeat(5000))).toBeNull();
  });

  it('sanitizes names, room codes and settings', () => {
    expect(sanitizeName('  <b>Bob</b>  ')).toBe('bBobb');
    expect(sanitizeName('')).toBe('Player');
    const m = decodeClient('{"t":"JOIN_ROOM","code":"ab-c d","name":"Zed"}');
    expect(m).toEqual({ t: 'JOIN_ROOM', code: 'ABCD', name: 'Zed' });
    const s = decodeClient('{"t":"SET_SETTINGS","settings":{"roundsToWin":99,"prepTime":1,"junk":5}}');
    expect(s).toEqual({ t: 'SET_SETTINGS', settings: { roundsToWin: 10, prepTime: 5 } });
  });
});
