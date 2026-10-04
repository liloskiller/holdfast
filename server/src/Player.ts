// Server side player: simulated state, input queue, hitbox history and round bookkeeping.

import {
  NET, OperatorId, createPlayerState, type Aabb, type EntityKind, type InputCmd, type PlayerState,
} from '@holdfast/shared';
import type { Conn } from './transport';
import type { BotMind } from './bots/BotMind';

const HIST = 64; // ticks of history, > 500 ms at 60 Hz

export interface Rewound {
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  lean: number;
  yaw: number;
}

export class Player {
  id: number;
  name: string;
  team: 0 | 1 = 0;
  ready = false;
  connected = true;
  isDummy = false;
  /** Computer controlled. Bots are full players for the round logic but have no connection. */
  isBot = false;
  bot: BotMind | null = null;
  token = '';
  conn: Conn | null = null;
  disconnectedAt = 0;

  op: number = OperatorId.RECRUIT_A;
  primary = 0;
  secondary = 4;

  state: PlayerState = createPlayerState();

  // input
  queue: InputCmd[] = [];
  lastQueuedSeq = 0;
  lastSeq = 0;
  lastCmdTime = 0;
  heldButtons = 0;

  // hitbox history ring
  private histT = new Float64Array(HIST);
  private histX = new Float32Array(HIST);
  private histY = new Float32Array(HIST);
  private histZ = new Float32Array(HIST);
  private histC = new Uint8Array(HIST);
  private histL = new Float32Array(HIST);
  private histYaw = new Float32Array(HIST);
  private histHead = 0;
  private histCount = 0;

  // stats
  kills = 0;
  deaths = 0;
  objTime = 0;
  ping = 0;

  // per round
  reinf = 0;
  gadgetUses = 0;
  gadgetCd = 0;
  droneCd = 0;
  tagCd = 0;
  sensorT = 0;
  /** Seconds of stim speed left. */
  stimT = 0;
  healLeft = 0;
  healRate = 0;
  meleeCd = 0;
  charges: number[] = []; // armed breach entity ids
  cameras: number[] = []; // camera entity ids
  camIdx = -1;
  actKind = 0; // 0 none, 1 reinforce, 2 barricade
  actT = 0;
  actTarget = -1;
  tagUntil: [number, number] = [0, 0];
  seen = new Map<number, number>();
  spec = 0;
  stepDist = 0;
  respawnAt = 0;
  /** Secondary gadget: what was picked, what is in the pouch now, and the throw cooldown (s). */
  throwPick = 0;
  markAt = 0;
  throwKind = 0;
  throwLeft = 0;
  throwCd = 0;
  /** Flash blindness lasts until this server time (ms). */
  blindUntil = 0;
  jammed = false;
  lastDamageFrom = 0;
  prompt = 0;
  picked = false;
  dLastX = 0;
  dLastY = 0;
  dLastZ = 0;
  // dummy behaviour
  dummyToggleAt = 0;

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }

  get alive(): boolean {
    return this.state.alive;
  }

  pushHistory(t: number): void {
    const i = this.histHead;
    const s = this.state;
    this.histT[i] = t;
    this.histX[i] = s.x;
    this.histY[i] = s.y;
    this.histZ[i] = s.z;
    this.histC[i] = s.crouch ? 1 : 0;
    this.histL[i] = s.lean;
    this.histYaw[i] = s.yaw;
    this.histHead = (i + 1) % HIST;
    if (this.histCount < HIST) this.histCount++;
  }

  clearHistory(): void {
    this.histCount = 0;
    this.histHead = 0;
  }

  /** Position at server time t (ms), interpolated between history samples. Falls back to current state. */
  rewind(t: number, out: Rewound): Rewound {
    const s = this.state;
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.crouch = s.crouch;
    out.lean = s.lean;
    out.yaw = s.yaw;
    const n = this.histCount;
    if (n === 0) return out;
    const newest = (this.histHead - 1 + HIST) % HIST;
    if (t >= (this.histT[newest] as number)) return out;
    for (let k = 0; k < n - 1; k++) {
      const hi = (this.histHead - 1 - k + HIST * 2) % HIST;
      const lo = (hi - 1 + HIST) % HIST;
      const t1 = this.histT[hi] as number;
      const t0 = this.histT[lo] as number;
      if (t >= t0 && t <= t1) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        out.x = (this.histX[lo] as number) + ((this.histX[hi] as number) - (this.histX[lo] as number)) * f;
        out.y = (this.histY[lo] as number) + ((this.histY[hi] as number) - (this.histY[lo] as number)) * f;
        out.z = (this.histZ[lo] as number) + ((this.histZ[hi] as number) - (this.histZ[lo] as number)) * f;
        out.crouch = f < 0.5 ? this.histC[lo] === 1 : this.histC[hi] === 1;
        out.lean = (this.histL[lo] as number) + ((this.histL[hi] as number) - (this.histL[lo] as number)) * f;
        out.yaw = f < 0.5 ? (this.histYaw[lo] as number) : (this.histYaw[hi] as number);
        return out;
      }
    }
    // older than the whole history: use the oldest sample
    const oldest = (this.histHead - n + HIST) % HIST;
    out.x = this.histX[oldest] as number;
    out.y = this.histY[oldest] as number;
    out.z = this.histZ[oldest] as number;
    out.crouch = this.histC[oldest] === 1;
    out.lean = this.histL[oldest] as number;
    out.yaw = this.histYaw[oldest] as number;
    return out;
  }

  isTaggedFor(team: number, now: number): boolean {
    return (this.tagUntil[team] ?? 0) > now;
  }
}

/** A placed gadget (or drone) in the world. */
export interface Entity {
  id: number;
  kind: EntityKind;
  team: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  a: number;
  b: number;
  hp: number;
  maxHp: number;
  box: Aabb;
  nx: number;
  ny: number;
  nz: number;
  /** Velocity of things in flight. */
  vx: number;
  vy: number;
  vz: number;
  born: number;
  dynId: number;
  armed: boolean;
  lastCheck: number;
}

export const HISTORY_MS = NET.historyMs;
