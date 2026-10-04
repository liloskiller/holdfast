// One match: players, world, phases and the fixed step loop.
// Platform neutral: no Node imports, so it also runs in the browser for Practice mode.

import {
  DEFAULT_SETTINGS, GameMode, NET, PhaseId, SIM_DT, SNAPSHOT_HZ,
  encodeServer, parseMap, World, quantizeCmd,
  type ClientMsg, type GameEvent, type InputCmd, type MapData, type PhaseInfo, type RoomSettings,
  type RoomState, type ServerMsg, type SoundKind,
} from '@holdfast/shared';
import { Player, type Entity } from './Player';
import type { Conn } from './transport';
import { processInputs } from './systems/movementSystem';
import { startMatch, updateRound, onPlayerLeft, applyPick, sandboxStart, spawnRoundPlayer } from './systems/roundSystem';
import { updateGadgets } from './systems/gadgetSystem';
import { updateThrowables } from './systems/throwSystem';
import { buildSnapshot } from './systems/visibilitySystem';
import { debugCommand } from './systems/destructionSystem';
import { updateBots } from './bots/botSystem';

export interface ShotRec {
  src: number;
  team: number;
  ev: GameEvent;
  x: number;
  y: number;
  z: number;
  ends: number[];
}

export interface SoundRec {
  /** Running number, so bots can tell new sounds from ones they already heard. */
  serial: number;
  s: SoundKind;
  x: number;
  y: number;
  z: number;
  radius: number;
  src: number;
  team: number;
}

export interface RoomOptions {
  mode?: GameMode;
  sandbox?: boolean;
  settings?: Partial<RoomSettings>;
  /** Override the clock (ms), used by tests. */
  clock?: () => number;
  seed?: number;
}

const TICK_MS = SIM_DT * 1000;
const DISCONNECT_GRACE_MS = 3000;

export class Room {
  code: string;
  settings: RoomSettings;
  mapText: string;
  map: MapData;
  world: World;
  sandbox: boolean;

  players = new Map<number, Player>();
  entities = new Map<number, Entity>();
  nextPlayerId = 1;
  nextEntityId = 10000;
  hostId = 0;

  phase: PhaseId = PhaseId.LOBBY;
  phaseEndsAt = 0;
  round = 0;
  scores: [number, number] = [0, 0];
  attackerTeam: 0 | 1 = 0;
  objectiveIdx = -1;
  capture = 0;
  winnerTeam = -1;
  reason = '';
  overtime = false;
  /** Bomb mode: where the defuser is and what state it is in (BombState). */
  bomb = { state: 0 as number, x: 0, y: 0, z: 0, entity: -1, nextBeep: 0 };
  matchOver = false;
  dummySpots: { x: number; y: number; z: number; yaw: number }[] = [];

  time = 0; // simulation clock in ms
  tick = 0;
  private acc = 0;
  private lastReal = -1;
  private loop: ReturnType<typeof setInterval> | null = null;
  private clock: () => number;
  private roomDirty = false;
  private lastRoomSend = 0;

  // event buffers, flushed at snapshot time
  pub: GameEvent[] = [];
  priv = new Map<number, GameEvent[]>();
  shots: ShotRec[] = [];
  sounds: SoundRec[] = [];

  emptySince = 0;
  closed = false;
  rngState: number;
  soundSerial = 0;
  /** For tests: skip visibility filtering. */
  debugNoVisibility = false;

  constructor(code: string, mapText: string, opts: RoomOptions = {}) {
    this.code = code;
    this.mapText = mapText;
    this.map = parseMap(mapText);
    this.world = new World(this.map);
    this.sandbox = !!opts.sandbox;
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings ?? {}) };
    if (opts.mode !== undefined) this.settings.mode = opts.mode;
    if (this.sandbox) this.settings.mode = GameMode.SANDBOX;
    this.clock = opts.clock ?? ((): number => performance.now());
    this.rngState = (opts.seed ?? 1234567) >>> 0;
    if (this.sandbox) sandboxStart(this);
  }

  // -------------------------------------------------------------------------
  // Small utilities used by the systems
  // -------------------------------------------------------------------------

  /** Server side random (not part of the shared simulation). */
  rand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  isAttacker(p: Player): boolean {
    return !this.sandbox && p.team === this.attackerTeam;
  }

  /** In sandbox every player may use every role ability. */
  canAttackerStuff(p: Player): boolean {
    return this.sandbox || p.team === this.attackerTeam;
  }

  canDefenderStuff(p: Player): boolean {
    return this.sandbox || p.team !== this.attackerTeam;
  }

  humans(): Player[] {
    const out: Player[] = [];
    for (const p of this.players.values()) if (!p.isDummy) out.push(p);
    return out;
  }

  connectedHumans(): Player[] {
    return this.humans().filter((p) => p.connected);
  }

  /** People (not bots) who are in the room right now. */
  livePeople(): Player[] {
    return this.humans().filter((p) => p.connected && !p.isBot);
  }

  alivePlayers(team?: number): Player[] {
    const out: Player[] = [];
    for (const p of this.players.values()) if (p.state.alive && (team === undefined || p.team === team)) out.push(p);
    return out;
  }

  pushEvent(pid: number, ev: GameEvent): void {
    let list = this.priv.get(pid);
    if (!list) {
      list = [];
      this.priv.set(pid, list);
    }
    list.push(ev);
  }

  msg(text: string, to?: number): void {
    if (to === undefined) this.pub.push({ k: 'msg', text });
    else this.pushEvent(to, { k: 'msg', text });
  }

  sound(s: SoundKind, x: number, y: number, z: number, radius: number, src = 0, team = -1): void {
    this.sounds.push({ serial: ++this.soundSerial, s, x, y, z, radius, src, team });
  }

  markRoomDirty(): void {
    this.roomDirty = true;
  }

  roomState(): RoomState {
    return {
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      phase: this.phase,
      mapName: this.map.name,
      players: [...this.players.values()]
        .filter((p) => !p.isDummy)
        .map((p) => ({
          id: p.id, name: p.name, team: p.team, ready: p.ready, op: p.op, primary: p.primary, secondary: p.secondary, throwable: p.throwPick,
          host: p.id === this.hostId, connected: p.connected, kills: p.kills, deaths: p.deaths,
          objective: Math.round(p.objTime), alive: p.state.alive, ping: p.ping, bot: p.isBot,
        })),
    };
  }

  phaseInfo(): PhaseInfo {
    return {
      phase: this.phase,
      endsAt: this.phaseEndsAt,
      round: this.round,
      scores: [this.scores[0], this.scores[1]],
      attackerTeam: this.attackerTeam,
      objective: this.objectiveIdx,
      mode: this.settings.mode,
      winnerTeam: this.winnerTeam,
      reason: this.reason,
      captureProgress: this.capture,
      bomb: this.bomb.state,
    };
  }

  send(p: Player, msg: ServerMsg): void {
    if (!p.conn || !p.connected) return;
    p.conn.send(encodeServer(msg));
  }

  broadcast(msg: ServerMsg): void {
    const raw = encodeServer(msg);
    for (const p of this.players.values()) if (p.conn && p.connected) p.conn.send(raw);
  }

  broadcastPhase(reset = false): void {
    const msg: ServerMsg = { t: 'PHASE', phase: this.phaseInfo() };
    if (reset) {
      msg.reset = true;
      msg.world = this.world.fullDiff();
    }
    this.broadcast(msg);
    this.markRoomDirty();
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  addPlayer(name: string, conn: Conn): Player | null {
    if (this.humans().length >= NET.maxPlayers) return null;
    const p = new Player(this.nextPlayerId++, name);
    p.conn = conn;
    p.token = Math.floor(this.rand() * 1e9).toString(36) + Math.floor(this.rand() * 1e9).toString(36) + p.id.toString(36);
    const count = [0, 0];
    for (const o of this.humans()) count[o.team]++;
    p.team = (count[0] ?? 0) <= (count[1] ?? 0) ? 0 : 1;
    p.state.alive = false;
    p.state.hp = 0;
    if (this.hostId === 0) this.hostId = p.id;
    this.players.set(p.id, p);
    this.emptySince = 0;
    if (this.sandbox) {
      p.team = 0;
      applyPick(this, p, 0, 0, true);
      spawnRoundPlayer(this, p);
    }
    this.markRoomDirty();
    return p;
  }

  /** Add a computer player (see bots/botSystem.ts). It has no connection and counts as a normal player in a round. */
  addBotPlayer(name: string, team: 0 | 1): Player | null {
    if (this.humans().length >= NET.maxPlayers) return null;
    const p = new Player(this.nextPlayerId++, name);
    p.isBot = true;
    p.connected = true;
    p.team = team;
    p.ready = true;
    p.state.alive = false;
    p.state.hp = 0;
    this.players.set(p.id, p);
    this.markRoomDirty();
    return p;
  }

  attachConn(p: Player, conn: Conn): void {
    p.conn = conn;
    p.connected = true;
    p.disconnectedAt = 0;
    this.emptySince = 0;
    this.markRoomDirty();
  }

  disconnect(p: Player): void {
    if (p.isDummy) return;
    p.conn = null;
    p.connected = false;
    p.disconnectedAt = this.time;
    if (this.phase === PhaseId.LOBBY || this.sandbox) {
      this.players.delete(p.id);
      this.migrateHost();
      this.markRoomDirty();
      return;
    }
    // After a short grace period (see step) a disconnected player counts as dead for the round.
    this.migrateHost();
    this.markRoomDirty();
  }

  removePlayer(p: Player): void {
    this.players.delete(p.id);
    this.migrateHost();
    onPlayerLeft(this, p);
    this.markRoomDirty();
  }

  private migrateHost(): void {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    const next = this.livePeople()[0];
    this.hostId = next ? next.id : 0;
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  handleMessage(p: Player, msg: ClientMsg): void {
    switch (msg.t) {
      case 'INPUT':
        this.enqueueInput(p, msg.cmds);
        break;
      case 'PING':
        this.send(p, { t: 'PONG', c: msg.c, s: this.time });
        break;
      case 'SET_TEAM':
        if (this.phase === PhaseId.LOBBY && !this.sandbox) {
          p.team = msg.team;
          p.ready = false;
          this.markRoomDirty();
        }
        break;
      case 'SET_READY':
        if (this.phase === PhaseId.LOBBY) {
          p.ready = msg.ready;
          this.markRoomDirty();
        }
        break;
      case 'PICK_OPERATOR':
        if (this.phase === PhaseId.OPERATOR_SELECT || this.sandbox) {
          const err = applyPick(this, p, msg.op, msg.primary, this.sandbox, msg.secondary, msg.throwable);
          if (err) this.send(p, { t: 'ERR', msg: err });
          else if (this.sandbox) spawnRoundPlayer(this, p, true);
        }
        break;
      case 'SET_SETTINGS':
        if (p.id === this.hostId && this.phase === PhaseId.LOBBY && !this.sandbox) {
          this.settings = { ...this.settings, ...msg.settings };
          this.markRoomDirty();
        }
        break;
      case 'START_MATCH':
        if (p.id === this.hostId && this.phase === PhaseId.LOBBY && !this.sandbox) {
          const err = startMatch(this);
          if (err) this.send(p, { t: 'ERR', msg: err });
        }
        break;
      case 'CHAT':
        this.broadcast({ t: 'CHAT', from: p.name, team: p.team, text: msg.text.slice(0, 120) });
        break;
      case 'SPECTATE':
        this.cycleSpectate(p, msg.dir);
        break;
      case 'SET_ASSIST':
        p.state.rcMul = Math.max(0.4, Math.min(1, msg.recoil));
        break;
      case 'DEBUG':
        if (this.sandbox) debugCommand(this, p, msg.cmd);
        break;
      case 'LEAVE':
        break;
      default:
        break;
    }
  }

  private enqueueInput(p: Player, cmds: InputCmd[]): void {
    for (const raw of cmds) {
      if (raw.seq <= p.lastQueuedSeq) continue;
      const c = quantizeCmd({ ...raw });
      p.queue.push(c);
      p.lastQueuedSeq = c.seq;
    }
    // bound the queue: never let a client bank more than ~0.4 s of inputs
    if (p.queue.length > 24) {
      const drop = p.queue.length - 24;
      p.queue.splice(0, drop);
    }
  }

  cycleSpectate(p: Player, dir: number): void {
    if (p.state.alive) return;
    const mates = this.alivePlayers(p.team).filter((o) => o.id !== p.id);
    if (!mates.length) {
      p.spec = 0;
      return;
    }
    mates.sort((a, b) => a.id - b.id);
    let idx = mates.findIndex((m) => m.id === p.spec);
    idx = idx < 0 ? 0 : (idx + dir + mates.length) % mates.length;
    p.spec = (mates[idx] as Player).id;
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  startLoop(intervalMs = 5): void {
    if (this.loop) return;
    this.lastReal = this.clock();
    this.loop = setInterval(() => this.update(this.clock()), intervalMs);
  }

  stopLoop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.closed = true;
  }

  /** Advance by real elapsed time. */
  update(nowMs: number): void {
    if (this.lastReal < 0) this.lastReal = nowMs;
    this.acc += Math.min(nowMs - this.lastReal, 250);
    this.lastReal = nowMs;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.step();
    }
  }

  /** Advance a fixed amount of simulated time (tests). */
  advance(ms: number): void {
    const ticks = Math.round(ms / TICK_MS);
    for (let i = 0; i < ticks; i++) this.step();
  }

  private step(): void {
    this.tick++;
    this.time += TICK_MS;
    updateBots(this);
    processInputs(this);
    updateGadgets(this);
    updateThrowables(this);
    updateRound(this);
    for (const p of this.players.values()) p.pushHistory(this.time);

    const every = Math.round(60 / SNAPSHOT_HZ);
    if (this.tick % every === 0) this.sendSnapshots();
    if (this.roomDirty && this.time - this.lastRoomSend > 250) {
      this.roomDirty = false;
      this.lastRoomSend = this.time;
      this.broadcast({ t: 'ROOM', room: this.roomState() });
    }
    for (const p of [...this.players.values()]) {
      if (p.isDummy || p.isBot || p.connected) continue;
      const away = this.time - p.disconnectedAt;
      // a blip shorter than the grace period keeps the player alive, longer means out for the round
      if (p.state.alive && away > DISCONNECT_GRACE_MS) {
        p.state.alive = false;
        p.state.hp = 0;
        p.state.dCtl = false;
        p.state.dDeployed = false;
        onPlayerLeft(this, p);
        this.markRoomDirty();
      }
      // the slot is released after the reconnect window
      if (away > NET.reconnectMs) this.removePlayer(p);
    }
    if (this.livePeople().length === 0 && this.emptySince === 0) this.emptySince = this.time;
  }

  private sendSnapshots(): void {
    const diff = this.world.flushDiff();
    for (const p of this.players.values()) {
      if (!p.conn || !p.connected) continue;
      const snap = buildSnapshot(this, p, diff);
      p.conn.send(encodeServer({ t: 'SNAP', snap }));
    }
    this.pub.length = 0;
    this.priv.clear();
    this.shots.length = 0;
    this.sounds.length = 0;
  }

  /** Close the room: stop timers. */
  close(): void {
    this.stopLoop();
    for (const p of this.players.values()) p.conn?.close();
  }
}
