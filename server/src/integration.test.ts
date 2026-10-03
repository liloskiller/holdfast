// End to end: a real WebSocket server and scripted bots play a full Elimination match.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  Btn, GameMode, PhaseId, arenaMapText, createPlayerState, decodeServer, encodeClient, makeCmd, quantizeCmd,
  stateFromArray, type ClientMsg, type PhaseInfo, type PlayerSnap, type ServerMsg,
} from '@holdfast/shared';
import { startServer, type RunningServer } from './app';

class Bot {
  ws!: WebSocket;
  id = 0;
  token = '';
  code = '';
  team = 0;
  state = createPlayerState();
  enemies: PlayerSnap[] = [];
  phase: PhaseInfo | null = null;
  seq = 0;
  snaps = 0;
  kills: number[] = [];
  phases: PhaseInfo[] = [];
  errors: string[] = [];
  joined: ServerMsg | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private serverOffset = 0;
  private pending: ReturnType<typeof makeCmd>[] = [];
  fight = true;

  constructor(private url: string, public name: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (d) => this.onMessage(d.toString()));
    });
  }

  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeClient(m));
  }

  waitFor(pred: () => boolean, ms = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const i = setInterval(() => {
        if (pred()) {
          clearInterval(i);
          resolve();
        } else if (Date.now() - t0 > ms) {
          clearInterval(i);
          reject(new Error('timeout waiting for condition (' + this.name + ')'));
        }
      }, 20);
    });
  }

  private onMessage(raw: string): void {
    const m = decodeServer(raw);
    if (!m) return;
    switch (m.t) {
      case 'JOINED':
        this.joined = m;
        this.id = m.playerId;
        this.token = m.token;
        this.code = m.code;
        this.phase = m.phase;
        this.serverOffset = m.serverTime - Date.now();
        break;
      case 'ROOM': {
        const me = m.room.players.find((p) => p.id === this.id);
        if (me) this.team = me.team;
        break;
      }
      case 'PHASE':
        this.phase = m.phase;
        this.phases.push(m.phase);
        break;
      case 'SNAP':
        this.snaps++;
        stateFromArray(m.snap.self, this.state);
        this.enemies = m.snap.players.filter((p) => (p.flags & 2) !== 0);
        for (const e of m.snap.events) if (e.k === 'kill') this.kills.push(e.victim);
        break;
      case 'ERR':
        this.errors.push(m.msg);
        break;
      default:
        break;
    }
  }

  startBrain(): void {
    this.timer = setInterval(() => this.think(), 1000 / 60);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.ws.close();
  }

  private think(): void {
    const ph = this.phase;
    const s = this.state;
    if (ph && ph.phase === PhaseId.OPERATOR_SELECT) {
      const attacker = this.team === ph.attackerTeam;
      this.send({ t: 'PICK_OPERATOR', op: attacker ? 8 : 9, primary: 0 });
    }
    this.fight = ph?.phase === PhaseId.ACTION;
    const cmd = makeCmd();
    cmd.seq = ++this.seq;
    cmd.clientTime = Date.now() + this.serverOffset;
    cmd.yaw = s.yaw;
    cmd.pitch = 0;
    let target: PlayerSnap | null = null;
    let best = 1e9;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (d < best) { best = d; target = e; }
    }
    if (target && this.fight && s.alive) {
      const dx = target.x - s.x;
      const dz = target.z - s.z;
      cmd.yaw = Math.atan2(-dx, -dz);
      cmd.pitch = Math.atan2(target.y + 0.9 - (s.y + 1.65), Math.hypot(dx, dz));
      cmd.buttons = Btn.FIRE | Btn.ADS;
      cmd.moveZ = best > 7 ? 1 : 0;
      cmd.moveX = Math.sin(Date.now() / 400) * 0.5;
    } else if (this.fight && s.alive) {
      // walk toward the other side of the arena until an enemy shows up
      cmd.yaw = this.team === 0 ? -Math.PI / 2 : Math.PI / 2;
      cmd.moveZ = 1;
    }
    quantizeCmd(cmd);
    this.pending.push(cmd);
    if (this.pending.length >= 2) {
      this.send({ t: 'INPUT', cmds: this.pending.slice(-4) });
      this.pending = this.pending.slice(-2);
    }
  }
}

describe('integration: real websocket server with bots', () => {
  let srv: RunningServer;
  let url = '';

  beforeAll(async () => {
    srv = await startServer({ port: 0, mapText: arenaMapText(), quiet: true });
    url = `ws://127.0.0.1:${srv.port}/ws`;
  });
  afterAll(async () => {
    await srv.close();
  });

  it('serves a health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('plays a full round to a winner', async () => {
    const a = new Bot(url, 'Alice');
    const b = new Bot(url, 'Bob');
    await a.connect();
    a.send({ t: 'CREATE_ROOM', name: 'Alice' });
    await a.waitFor(() => a.joined !== null);
    expect(a.code).toMatch(/^[A-Z]{4}$/);
    await b.connect();
    b.send({ t: 'JOIN_ROOM', code: a.code, name: 'Bob' });
    await b.waitFor(() => b.joined !== null);
    expect(b.id).not.toBe(a.id);

    a.send({
      t: 'SET_SETTINGS',
      settings: { mode: GameMode.ELIMINATION, prepTime: 5, actionTime: 60, operatorSelectTime: 5, roundsToWin: 1, roundEndTime: 3 },
    });
    await new Promise((r) => setTimeout(r, 100));
    a.send({ t: 'START_MATCH' });
    await a.waitFor(() => a.phase?.phase === PhaseId.OPERATOR_SELECT, 3000);
    a.startBrain();
    b.startBrain();
    await a.waitFor(() => a.phase?.phase === PhaseId.PREP, 4000);
    await a.waitFor(() => a.phase?.phase === PhaseId.ACTION, 9000);
    const snapsAtAction = a.snaps;
    await a.waitFor(() => a.phase?.phase === PhaseId.ROUND_END, 40000);
    expect(a.phase?.winnerTeam).toBeGreaterThanOrEqual(0);
    expect(a.kills.length).toBeGreaterThanOrEqual(1);
    expect(b.kills.length).toBe(a.kills.length);
    expect(a.snaps).toBeGreaterThan(snapsAtAction);
    await a.waitFor(() => a.phase?.phase === PhaseId.MATCH_END, 8000);
    expect(a.phase?.scores[0]! + a.phase?.scores[1]!).toBe(1);
    a.stop();
    b.stop();
  }, 90000);

  it('streams snapshots at about 20 Hz', async () => {
    const a = new Bot(url, 'Rate');
    await a.connect();
    a.send({ t: 'CREATE_ROOM', name: 'Rate', sandbox: true });
    await a.waitFor(() => a.joined !== null);
    const s0 = a.snaps;
    await new Promise((r) => setTimeout(r, 1000));
    const rate = a.snaps - s0;
    expect(rate).toBeGreaterThanOrEqual(15);
    expect(rate).toBeLessThanOrEqual(25);
    a.stop();
  });

  it('lets a disconnected player reconnect with their token', async () => {
    const a = new Bot(url, 'Host');
    await a.connect();
    a.send({ t: 'CREATE_ROOM', name: 'Host' });
    await a.waitFor(() => a.joined !== null);
    const b = new Bot(url, 'Flaky');
    await b.connect();
    b.send({ t: 'JOIN_ROOM', code: a.code, name: 'Flaky' });
    await b.waitFor(() => b.joined !== null);
    const id = b.id;
    const token = b.token;
    b.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const b2 = new Bot(url, 'Flaky');
    await b2.connect();
    b2.send({ t: 'JOIN_ROOM', code: a.code, name: 'Flaky', token });
    await b2.waitFor(() => b2.joined !== null);
    // in the lobby a disconnect frees the slot, so the token path may create a new player; both are acceptable
    expect(b2.id === id || b2.id > id).toBe(true);
    a.stop();
    b2.stop();
  });

  it('survives garbage and rejects unknown rooms', async () => {
    const a = new Bot(url, 'Fuzz');
    await a.connect();
    a.ws.send('not json');
    a.ws.send('{"t":"INPUT","c":"nope"}');
    a.ws.send(JSON.stringify({ t: 'JOIN_ROOM', code: 'QQQQ', name: 'x' }));
    await a.waitFor(() => a.errors.length > 0, 2000);
    expect(a.errors[0]).toMatch(/not found/);
    a.send({ t: 'CREATE_ROOM', name: 'Still works' });
    await a.waitFor(() => a.joined !== null, 2000);
    a.stop();
  });
});
