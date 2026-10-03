// Wire format. JSON today, behind this module so a binary format can replace it later
// without touching game code. Game code only sees the friendly types from types.ts.

import { TAU, wrapAngle } from './math';
import type {
  ClientMsg, EntitySnap, GameEvent, InputCmd, PlayerSnap, SelfExtra, ServerMsg, Snapshot, WorldDiff,
} from './types';
import { DEFAULT_SETTINGS, type RoomSettings } from './constants';

const EXTRA_KEYS: readonly (keyof SelfExtra)[] = [
  'reinf', 'gadget', 'gadgetCd', 'act', 'actP', 'droneCd', 'tagCd', 'spec', 'op', 'camIdx', 'camCount',
  'sensorT', 'prompt', 'charges', 'cap', 'jam',
];

export function makeExtra(): SelfExtra {
  return {
    reinf: 0, gadget: 0, gadgetCd: 0, act: 0, actP: 0, droneCd: 0, tagCd: 0, spec: 0, op: 0,
    camIdx: -1, camCount: 0, sensorT: 0, prompt: 0, charges: 0, cap: 0, jam: 0,
  };
}

function q100(v: number): number {
  return Math.round(v * 100);
}

function encodePlayer(p: PlayerSnap): number[] {
  const yaw16 = Math.round((wrapAngle(p.yaw) / TAU + 0.5) * 65535);
  const pitch16 = Math.round(((p.pitch + 1.6) / 3.2) * 65535);
  return [p.id, q100(p.x), q100(p.y), q100(p.z), yaw16, pitch16, p.flags, p.weapon, Math.round(p.hp)];
}

function decodePlayer(a: number[]): PlayerSnap {
  return {
    id: a[0] as number,
    x: (a[1] as number) / 100,
    y: (a[2] as number) / 100,
    z: (a[3] as number) / 100,
    yaw: ((a[4] as number) / 65535 - 0.5) * TAU,
    pitch: ((a[5] as number) / 65535) * 3.2 - 1.6,
    flags: a[6] as number,
    weapon: a[7] as number,
    hp: a[8] as number,
  };
}

function encodeEntity(e: EntitySnap): number[] {
  return [e.id, e.kind, e.team, e.owner, q100(e.x), q100(e.y), q100(e.z), q100(e.a), Math.round(e.hp), q100(e.b)];
}

function decodeEntity(a: number[]): EntitySnap {
  return {
    id: a[0] as number,
    kind: a[1] as EntitySnap['kind'],
    team: a[2] as number,
    owner: a[3] as number,
    x: (a[4] as number) / 100,
    y: (a[5] as number) / 100,
    z: (a[6] as number) / 100,
    a: (a[7] as number) / 100,
    hp: a[8] as number,
    b: (a[9] as number) / 100,
  };
}

function encodeSnapshot(s: Snapshot): unknown {
  const o: Record<string, unknown> = {
    t: 'SNAP',
    k: s.tick,
    s: Math.round(s.time * 10) / 10,
    a: s.ack,
    me: s.self,
    x: EXTRA_KEYS.map((k) => Math.round(s.extra[k] * 100) / 100),
    p: s.players.map(encodePlayer),
    e: s.entities.map(encodeEntity),
  };
  if (s.world) o['w'] = s.world;
  if (s.events.length) o['v'] = s.events;
  return o;
}

function decodeSnapshot(o: Record<string, unknown>): Snapshot {
  const extra = makeExtra();
  const xs = o['x'] as number[];
  EXTRA_KEYS.forEach((k, i) => {
    extra[k] = xs[i] ?? 0;
  });
  return {
    tick: o['k'] as number,
    time: o['s'] as number,
    ack: o['a'] as number,
    self: o['me'] as number[],
    extra,
    players: (o['p'] as number[][]).map(decodePlayer),
    entities: (o['e'] as number[][]).map(decodeEntity),
    world: (o['w'] as WorldDiff | undefined) ?? null,
    events: (o['v'] as GameEvent[] | undefined) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export function encodeServer(msg: ServerMsg): string {
  if (msg.t === 'SNAP') return JSON.stringify(encodeSnapshot(msg.snap));
  return JSON.stringify(msg);
}

export function decodeServer(raw: string): ServerMsg | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const rec = o as Record<string, unknown>;
  if (rec['t'] === 'SNAP') return { t: 'SNAP', snap: decodeSnapshot(rec) };
  if (typeof rec['t'] !== 'string') return null;
  return o as ServerMsg;
}

// ---------------------------------------------------------------------------
// Client -> server (validated: the server must not trust any of this)
// ---------------------------------------------------------------------------

function encodeCmd(c: InputCmd): number[] {
  return [
    c.seq,
    Math.round(c.moveX * 100),
    Math.round(c.moveZ * 100),
    Math.round(c.yaw * 10000),
    Math.round(c.pitch * 10000),
    c.buttons,
    c.clientTime,
    c.slot,
  ];
}

function decodeCmd(a: unknown): InputCmd | null {
  if (!Array.isArray(a) || a.length < 8) return null;
  for (let i = 0; i < 8; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return null;
  const n = a as number[];
  return {
    seq: n[0] as number,
    dt: 1 / 60,
    moveX: Math.max(-1, Math.min(1, (n[1] as number) / 100)),
    moveZ: Math.max(-1, Math.min(1, (n[2] as number) / 100)),
    yaw: (n[3] as number) / 10000,
    pitch: Math.max(-1.5, Math.min(1.5, (n[4] as number) / 10000)),
    buttons: (n[5] as number) & 0x1fff,
    clientTime: n[6] as number,
    slot: n[7] ? 1 : 0,
  };
}

export function encodeClient(msg: ClientMsg): string {
  if (msg.t === 'INPUT') return JSON.stringify({ t: 'INPUT', c: msg.cmds.map(encodeCmd) });
  return JSON.stringify(msg);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  return v.slice(0, max);
}

function num(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(lo, Math.min(hi, v));
}

export function sanitizeName(raw: string): string {
  const s = raw.replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return s.length ? s : 'Player';
}

export function sanitizeSettings(p: Record<string, unknown>): Partial<RoomSettings> {
  const out: Partial<RoomSettings> = {};
  const d = DEFAULT_SETTINGS;
  const n = (k: keyof RoomSettings, lo: number, hi: number): void => {
    const v = num(p[k], lo, hi);
    if (v !== null) (out as Record<string, number>)[k] = Math.round(v);
  };
  if (p['mode'] !== undefined) {
    const v = num(p['mode'], 0, 2);
    if (v !== null) out.mode = Math.round(v) as RoomSettings['mode'];
  }
  n('roundsToWin', 1, 10);
  n('prepTime', 5, 120);
  n('actionTime', 30, 600);
  n('operatorSelectTime', 5, 60);
  n('roundEndTime', 3, 20);
  n('swapEvery', 1, 10);
  n('captureTime', 3, 30);
  if (typeof p['friendlyFire'] === 'boolean') out.friendlyFire = p['friendlyFire'];
  void d;
  return out;
}

/** Parse and validate a client message. Returns null for anything malformed. */
export function decodeClient(raw: string): ClientMsg | null {
  if (raw.length > 4096) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  switch (r['t']) {
    case 'INPUT': {
      if (!Array.isArray(r['c']) || r['c'].length > 16) return null;
      const cmds: InputCmd[] = [];
      for (const a of r['c']) {
        const c = decodeCmd(a);
        if (!c) return null;
        cmds.push(c);
      }
      return { t: 'INPUT', cmds };
    }
    case 'PING': {
      const c = num(r['c'], 0, 1e12);
      return c === null ? null : { t: 'PING', c };
    }
    case 'CREATE_ROOM': {
      const name = str(r['name'], 40);
      if (name === null) return null;
      const m: ClientMsg = { t: 'CREATE_ROOM', name: sanitizeName(name) };
      const mode = num(r['mode'], 0, 2);
      if (mode !== null) m.mode = Math.round(mode) as 0 | 1 | 2;
      if (r['sandbox'] === true) m.sandbox = true;
      return m;
    }
    case 'JOIN_ROOM': {
      const code = str(r['code'], 8);
      const name = str(r['name'], 40);
      if (code === null || name === null) return null;
      const m: ClientMsg = { t: 'JOIN_ROOM', code: code.toUpperCase().replace(/[^A-Z]/g, ''), name: sanitizeName(name) };
      const token = str(r['token'], 64);
      if (token) m.token = token;
      return m;
    }
    case 'SET_TEAM': return r['team'] === 0 || r['team'] === 1 ? { t: 'SET_TEAM', team: r['team'] } : null;
    case 'SET_READY': return typeof r['ready'] === 'boolean' ? { t: 'SET_READY', ready: r['ready'] } : null;
    case 'PICK_OPERATOR': {
      const op = num(r['op'], 0, 20);
      const primary = num(r['primary'], 0, 10);
      if (op === null || primary === null) return null;
      return { t: 'PICK_OPERATOR', op: Math.round(op), primary: Math.round(primary) as 0 };
    }
    case 'SET_SETTINGS': {
      if (typeof r['settings'] !== 'object' || r['settings'] === null) return null;
      return { t: 'SET_SETTINGS', settings: sanitizeSettings(r['settings'] as Record<string, unknown>) };
    }
    case 'START_MATCH': return { t: 'START_MATCH' };
    case 'LEAVE': return { t: 'LEAVE' };
    case 'CHAT': {
      const text = str(r['text'], 120);
      return text === null ? null : { t: 'CHAT', text };
    }
    case 'SPECTATE': {
      const dir = num(r['dir'], -1, 1);
      return dir === null ? null : { t: 'SPECTATE', dir: dir < 0 ? -1 : 1 };
    }
    case 'DEBUG': {
      const cmd = str(r['cmd'], 20);
      if (cmd === null) return null;
      const arg = num(r['arg'], -1e6, 1e6);
      const m: ClientMsg = { t: 'DEBUG', cmd };
      if (arg !== null) m.arg = arg;
      return m;
    }
    default:
      return null;
  }
}
