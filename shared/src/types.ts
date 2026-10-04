// Shared types: input commands, simulated player state, network messages and events.

import type { GameMode, PhaseId, RoomSettings, WeaponId } from './constants';
import { PLAYER } from './constants';
import { wrapAngle } from './math';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const Btn = {
  FIRE: 1 << 0,
  RELOAD: 1 << 1,
  CROUCH: 1 << 2,
  SPRINT: 1 << 3,
  INTERACT: 1 << 4,
  GADGET: 1 << 5,
  SWITCH: 1 << 6,
  MELEE: 1 << 7,
  DRONE: 1 << 8,
  ADS: 1 << 9,
  UP: 1 << 10, // hop (drone only)
  DOWN: 1 << 11, // unused, kept so the wire format stays stable
  CAMERA: 1 << 12,
  LEAN_L: 1 << 13,
  LEAN_R: 1 << 14,
} as const;

export interface InputCmd {
  seq: number;
  dt: number;
  moveX: number; // -1..1 strafe (right positive)
  moveZ: number; // -1..1 forward positive
  yaw: number; // absolute radians
  pitch: number; // absolute radians
  buttons: number;
  clientTime: number; // estimated server time (ms) when sampled
  slot: number; // desired weapon slot 0 or 1
}

export function makeCmd(): InputCmd {
  return { seq: 0, dt: 1 / 60, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, clientTime: 0, slot: 0 };
}

/** Round an input command to wire precision so client prediction matches the server exactly. */
export function quantizeCmd(c: InputCmd): InputCmd {
  c.moveX = Math.round(c.moveX * 100) / 100;
  c.moveZ = Math.round(c.moveZ * 100) / 100;
  c.yaw = Math.round(wrapAngle(c.yaw) * 10000) / 10000;
  const lim = PLAYER.pitchLimit;
  c.pitch = Math.round(Math.max(-lim, Math.min(lim, c.pitch)) * 10000) / 10000;
  c.clientTime = Math.round(c.clientTime);
  c.slot = c.slot ? 1 : 0;
  return c;
}

// ---------------------------------------------------------------------------
// Player state (simulated identically on client and server)
// ---------------------------------------------------------------------------

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  onGround: boolean;
  sprint: boolean;
  ads: boolean;
  // vault
  vault: number; // seconds remaining, 0 when not vaulting
  vfx: number;
  vfy: number;
  vfz: number;
  vtx: number;
  vty: number;
  vtz: number;
  // weapons
  slot: number;
  w0: number; // primary weapon id
  w1: number; // sidearm weapon id
  ammo0: number;
  ammo1: number;
  res0: number;
  res1: number;
  reloading: boolean;
  reload: number; // seconds left
  reloadMax: number; // total duration of the reload in progress (for animation)
  reloadTac: boolean; // the reload in progress started with rounds in the gun (tactical)
  cooldown: number;
  shotIdx: number;
  // gunplay: aim down sights blend, recoil (the aim really moves), bloom, spray counter
  adsAmt: number; // 0 hip .. 1 fully aimed
  rcP: number; // accumulated upward kick (rad), added to the aim pitch when firing and to the view
  rcY: number; // accumulated sideways kick (rad)
  bloom: number; // extra spread (degrees) from sustained fire
  sinceShot: number; // seconds since the last shot
  spray: number; // consecutive shots in the current spray
  burstLeft: number; // shots still to fire in the current burst
  fireBuf: number; // a click made during the cooldown is remembered for a moment
  lean: number; // -1 full left .. 1 full right
  // use button tracking
  useHeld: number;
  prevButtons: number;
  // drone
  dDeployed: boolean;
  dCtl: boolean;
  dx: number;
  dy: number;
  dz: number;
  dvx: number;
  dvy: number;
  dvz: number;
  dhp: number;
  /** Viewing a security camera: body is frozen. Set by the server. */
  cam: boolean;
  // modifiers (set by the server)
  slow: number; // seconds of slow remaining
  confined: boolean; // attackers during prep
  spdMul: number;
  alive: boolean;
  hp: number;
}

const BOOL_KEYS: readonly (keyof PlayerState)[] = [
  'crouch', 'onGround', 'sprint', 'ads', 'reloading', 'reloadTac', 'dDeployed', 'dCtl', 'cam', 'confined', 'alive',
];

const STATE_KEYS: readonly (keyof PlayerState)[] = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'crouch', 'onGround', 'sprint', 'ads',
  'vault', 'vfx', 'vfy', 'vfz', 'vtx', 'vty', 'vtz',
  'slot', 'w0', 'w1', 'ammo0', 'ammo1', 'res0', 'res1', 'reloading', 'reload', 'reloadMax', 'reloadTac', 'cooldown', 'shotIdx',
  'adsAmt', 'rcP', 'rcY', 'bloom', 'sinceShot', 'spray', 'burstLeft', 'fireBuf', 'lean',
  'useHeld', 'prevButtons',
  'dDeployed', 'dCtl', 'dx', 'dy', 'dz', 'dvx', 'dvy', 'dvz', 'dhp', 'cam',
  'slow', 'confined', 'spdMul', 'alive', 'hp',
];

const BOOL_SET = new Set<keyof PlayerState>(BOOL_KEYS);

export function createPlayerState(): PlayerState {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    crouch: false, onGround: false, sprint: false, ads: false,
    vault: 0, vfx: 0, vfy: 0, vfz: 0, vtx: 0, vty: 0, vtz: 0,
    slot: 0, w0: 0, w1: 4, ammo0: 0, ammo1: 0, res0: 0, res1: 0,
    reloading: false, reload: 0, reloadMax: 0, reloadTac: false, cooldown: 0, shotIdx: 0,
    adsAmt: 0, rcP: 0, rcY: 0, bloom: 0, sinceShot: 9, spray: 0, burstLeft: 0, fireBuf: 0, lean: 0,
    useHeld: 0, prevButtons: 0,
    dDeployed: false, dCtl: false, dx: 0, dy: 0, dz: 0, dvx: 0, dvy: 0, dvz: 0, dhp: 0, cam: false,
    slow: 0, confined: false, spdMul: 1, alive: true, hp: PLAYER.maxHp,
  };
}

export function copyPlayerState(dst: PlayerState, src: PlayerState): PlayerState {
  const d = dst as unknown as Record<string, number | boolean>;
  const s = src as unknown as Record<string, number | boolean>;
  for (let i = 0; i < STATE_KEYS.length; i++) {
    const k = STATE_KEYS[i] as string;
    d[k] = s[k] as number | boolean;
  }
  return dst;
}

export function stateToArray(s: PlayerState): number[] {
  const a: number[] = new Array(STATE_KEYS.length);
  const r = s as unknown as Record<string, number | boolean>;
  for (let i = 0; i < STATE_KEYS.length; i++) {
    const v = r[STATE_KEYS[i] as string] as number | boolean;
    a[i] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return a;
}

export function stateFromArray(a: readonly number[], dst: PlayerState): PlayerState {
  const r = dst as unknown as Record<string, number | boolean>;
  for (let i = 0; i < STATE_KEYS.length; i++) {
    const k = STATE_KEYS[i] as keyof PlayerState;
    const v = a[i] ?? 0;
    r[k as string] = BOOL_SET.has(k) ? v !== 0 : v;
  }
  return dst;
}

export function eyeHeight(s: { crouch: boolean }): number {
  return s.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
}

export function bodyHeight(s: { crouch: boolean }): number {
  return s.crouch ? PLAYER.heightCrouch : PLAYER.heightStand;
}

// ---------------------------------------------------------------------------
// Rooms and lobby
// ---------------------------------------------------------------------------

/** A solo match against computer players. */
export interface SoloOptions {
  /** Players per team including you (2 to 5). */
  size: number;
  /** 0 easy, 1 normal, 2 hard. */
  difficulty: number;
  /** 0: you start as an attacker, 1: you start as a defender. */
  side: 0 | 1;
}

export interface RoomPlayerInfo {
  id: number;
  name: string;
  team: 0 | 1;
  ready: boolean;
  op: number;
  primary: number;
  secondary: number;
  host: boolean;
  connected: boolean;
  kills: number;
  deaths: number;
  objective: number; // seconds spent capturing
  alive: boolean;
  ping: number;
  /** A computer controlled player. */
  bot: boolean;
}

export interface RoomState {
  code: string;
  hostId: number;
  settings: RoomSettings;
  players: RoomPlayerInfo[];
  phase: PhaseId;
  mapName: string;
}

export interface PhaseInfo {
  phase: PhaseId;
  endsAt: number; // server time ms, 0 when untimed
  round: number; // 1 based round number
  scores: [number, number]; // per team (0 and 1)
  attackerTeam: 0 | 1;
  objective: number; // index into map objectives, -1 for none
  mode: GameMode;
  /** Set on ROUND_END and MATCH_END */
  winnerTeam: number; // -1 none, 0 or 1
  reason: string;
  captureProgress: number;
}

// ---------------------------------------------------------------------------
// World replication
// ---------------------------------------------------------------------------

/** [cellId, hp, reinforced 0/1] */
export type CellDiff = [number, number, number];
/** [openingId, flags, hp, barricadeHp] flags: 1 open, 2 destroyed, 4 barricaded */
export type OpeningDiff = [number, number, number, number];

export interface WorldDiff {
  c: CellDiff[];
  o: OpeningDiff[];
}

// ---------------------------------------------------------------------------
// Snapshots and events
// ---------------------------------------------------------------------------

export const PFlag = {
  CROUCH: 1,
  ALIVE: 2,
  SPRINT: 4,
  VAULT: 8,
  ADS: 16,
  TAGGED: 32,
  DRONE: 64,
  RELOAD: 128,
  LEAN_L: 256,
  LEAN_R: 512,
} as const;

export interface PlayerSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
  hp: number; // 0 if unknown (enemies)
}

export const EntityKind = {
  DRONE: 0,
  BREACH: 1,
  SHIELD: 2,
  TRAP: 3,
  JAMMER: 4,
  CAMERA: 5,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export interface EntitySnap {
  id: number;
  kind: EntityKind;
  team: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  /** yaw for oriented things */
  a: number;
  hp: number;
  /** extra: shield axis, camera pitch, charge armed flag, ... */
  b: number;
}

export type SoundKind =
  | 'shot' | 'step' | 'door' | 'glass' | 'wall' | 'breach' | 'barricade' | 'reinforce'
  | 'reload' | 'melee' | 'drone' | 'boom' | 'vault' | 'gadget' | 'metal' | 'trap' | 'ping';

export type GameEvent =
  | { k: 'shot'; id: number; w: number; ox: number; oy: number; oz: number; ends: number[] }
  | { k: 'hit'; head: boolean; kill: boolean; dmg: number }
  | { k: 'hurt'; dx: number; dz: number; dmg: number }
  | { k: 'kill'; killer: number; victim: number; w: number; head: boolean }
  | { k: 'snd'; s: SoundKind; x: number; y: number; z: number; v: number; src: number; exact: boolean }
  | { k: 'boom'; x: number; y: number; z: number; r: number }
  | { k: 'msg'; text: string }
  | { k: 'melee'; id: number }
  | { k: 'tag'; id: number }
  | { k: 'sense'; pts: number[] }
  | { k: 'spawn'; id: number; yaw: number }
  | { k: 'reset' };

export interface SelfExtra {
  reinf: number; // reinforcement charges left
  gadget: number; // gadget uses left
  gadgetCd: number; // seconds until gadget usable again
  act: number; // 0 none, 1 reinforce, 2 barricade
  actP: number; // 0..1 progress
  droneCd: number;
  tagCd: number;
  spec: number; // spectated player id, 0 if none
  op: number;
  camIdx: number; // active security camera index, -1 for none
  camCount: number;
  sensorT: number;
  prompt: number; // contextual interact prompt id
  charges: number; // armed breach charges
  cap: number; // objective capture progress 0..1
  jam: number; // 1 when jammed (static on the drone feed)
}

export interface Snapshot {
  tick: number;
  time: number; // server ms
  ack: number; // last processed input seq
  self: number[]; // PlayerState array
  extra: SelfExtra;
  players: PlayerSnap[];
  entities: EntitySnap[];
  world: WorldDiff | null;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ClientMsg =
  | { t: 'CREATE_ROOM'; name: string; mode?: GameMode; sandbox?: boolean; solo?: SoloOptions }
  | { t: 'JOIN_ROOM'; code: string; name: string; token?: string }
  | { t: 'SET_TEAM'; team: 0 | 1 }
  | { t: 'SET_READY'; ready: boolean }
  | { t: 'PICK_OPERATOR'; op: number; primary: WeaponId; secondary?: WeaponId }
  | { t: 'SET_SETTINGS'; settings: Partial<RoomSettings> }
  | { t: 'START_MATCH' }
  | { t: 'INPUT'; cmds: InputCmd[] }
  | { t: 'CHAT'; text: string }
  | { t: 'PING'; c: number }
  | { t: 'SPECTATE'; dir: number }
  | { t: 'DEBUG'; cmd: string; arg?: number }
  | { t: 'LEAVE' };

export type ServerMsg =
  | {
      t: 'JOINED';
      playerId: number;
      token: string;
      code: string;
      mapText: string;
      room: RoomState;
      phase: PhaseInfo;
      world: WorldDiff;
      serverTime: number;
    }
  | { t: 'ROOM'; room: RoomState }
  | { t: 'PHASE'; phase: PhaseInfo; reset?: boolean; world?: WorldDiff }
  | { t: 'SNAP'; snap: Snapshot }
  | { t: 'CHAT'; from: string; team: number; text: string }
  | { t: 'PONG'; c: number; s: number }
  | { t: 'ERR'; msg: string; fatal?: boolean };
