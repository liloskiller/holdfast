// Per bot state and the difficulty table. The behaviour lives in botSystem.ts.

import { Rng, type NavPath } from '@holdfast/shared';
import type { Player } from '../Player';

export interface BotSkill {
  name: string;
  /** Seconds between first seeing an enemy and the first shot. */
  reaction: number;
  /** Fastest the view can turn while tracking (rad/s). */
  aimSpeed: number;
  /** Aim error (rad) at 10 m, grows with the square root of distance and with target speed. */
  aimError: number;
  /** Shots per burst with automatic weapons, and the pause after a burst (s). */
  burstMin: number;
  burstMax: number;
  pause: number;
  /** Chance to strafe while fighting at close range. */
  strafe: number;
  /** Fraction of the weapon kick the bot pulls back down. */
  recoilControl: number;
  /** How far the bot notices an enemy standing still in its field of view (m). */
  sight: number;
}

export const BOT_SKILLS: readonly BotSkill[] = [
  { name: 'Easy', reaction: 0.65, aimSpeed: 3.0, aimError: 0.04, burstMin: 2, burstMax: 4, pause: 0.55, strafe: 0.2, recoilControl: 0.25, sight: 38 },
  { name: 'Normal', reaction: 0.4, aimSpeed: 5.0, aimError: 0.022, burstMin: 3, burstMax: 6, pause: 0.35, strafe: 0.5, recoilControl: 0.55, sight: 55 },
  { name: 'Hard', reaction: 0.22, aimSpeed: 8.0, aimError: 0.011, burstMin: 4, burstMax: 8, pause: 0.22, strafe: 0.8, recoilControl: 0.85, sight: 70 },
];

export interface BotTask {
  kind: 'reinforce' | 'barricade';
  /** Panel id or opening id. */
  id: number;
  /** Where to stand, and the point to look at. */
  node: number;
  fx: number;
  fy: number;
  fz: number;
  workedFor: number;
}

export class BotMind {
  readonly rng: Rng;
  readonly seed: number;

  mode: 'move' | 'fight' | 'search' | 'work' | 'hold' | 'cautious' = 'move';
  wantAds = false;
  wantSlot: number | undefined = undefined;
  /** Set by door work: look at (faceX, faceY, faceZ) this tick (kicking a barricade). */
  facing = false;
  faceX = 0;
  faceY = 0;
  faceZ = 0;

  // navigation
  goalNode = -1;
  goalX = 0;
  goalZ = 0;
  path: NavPath | null = null;
  wp = 0;
  repathAt = 0;
  /** Heading the bot wants to walk in (world space), or null when it has nothing to follow. */
  moveX = 0;
  moveZ = 0;
  moving = false;

  // view (the mouse): what goes into the commands
  yaw = 0;
  pitch = 0;
  yawInit = false;

  // perception
  target: Player | null = null;
  targetSince = 0;
  lastSeenX = 0;
  lastSeenY = 0;
  lastSeenZ = 0;
  lastSeenT = -99;
  alertX = 0;
  alertZ = 0;
  alertT = -99;
  lastSerial = 0;
  lastHp = 100;
  nextThink = 0;

  // fighting
  burstLeft = 0;
  pauseUntil = 0;
  strafeDir = 1;
  strafeUntil = 0;
  errX = 0;
  errY = 0;
  errUntil = 0;
  lastShots = 0;
  triggerHeld = false;
  crouchUntil = 0;
  standUntil = 0;

  // door handling, stuck recovery
  tapTicks = 0;
  tapCooldown = 0;
  meleeAt = 0;
  lastProgX = 0;
  lastProgZ = 0;
  lastProgT = 0;
  sidestepUntil = 0;
  sidestepDir = 1;
  stuckCount = 0;

  // round plan
  pickAt = 0;
  planned = -1; // round number the plan was made for
  tasks: BotTask[] = [];
  task: BotTask | null = null;
  anchorNode = -1;
  nextRoamAt = 0;
  scanDir = 1;
  scanUntil = 0;
  scanBase = 0;

  constructor(seed: number, readonly skill: BotSkill) {
    this.seed = seed;
    this.rng = new Rng(seed);
  }
}
