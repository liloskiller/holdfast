// Tunable constants. Units: 1 world unit = 1 meter. Y is up.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const SNAPSHOT_HZ = 20;
export const INPUT_SEND_HZ = 30;

// ---- Grid ----
export const TILE = 0.5; // horizontal tile size (m)
export const CELL = 0.5; // vertical cell size (m)
export const FLOOR_H = 3.0; // floor height including slab (m)
export const LAYERS_PER_FLOOR = Math.round(FLOOR_H / CELL); // 6
export const WALL_LAYERS = LAYERS_PER_FLOOR - 1; // 5 clear layers, the 6th is the slab above

// ---- Player ----
export const PLAYER = {
  radius: 0.35,
  heightStand: 1.8,
  heightCrouch: 1.3,
  eyeStand: 1.65,
  eyeCrouch: 1.15,
  walk: 3.4,
  sprint: 5.0,
  crouchSpeed: 1.8,
  accel: 32, // m/s^2 toward target velocity
  decel: 40, // m/s^2 when no input
  airControl: 0.25,
  gravity: 18,
  terminalVel: 30,
  stepUp: 0.3,
  stepDown: 0.3,
  skin: 0.001,
  maxHp: 100,
  vaultTime: 0.6,
  vaultReach: 1.1,
  useTapMax: 0.3, // INTERACT released before this many seconds counts as a tap
  useHoldStart: 0.3, // INTERACT held this long begins a hold action
  pitchLimit: 1.5,
  adsMoveMul: 0.6,
} as const;

// The attacker drone is a small wheeled RC car, not a flyer: it drives on the floor, falls with gravity,
// rolls over tiny lips and can hop (about 0.6 m) to get onto low furniture or up stair steps.
// Its position (dx, dy, dz) is the centre of the chassis.
/** Landing harder than this (m/s, about a 1.4 m drop) hurts. */
export const FALL = {
  safe: 7,
  perMps: 11, // hp per m/s over the safe speed
} as const;

export const LEAN = {
  offset: 0.34, // how far the head moves sideways at full lean (m)
  drop: 0.05, // and how far it sinks
  rate: 7, // lean per second (full lean in about 0.14 s)
  roll: 0.26, // camera roll at full lean (rad)
  speedMul: 0.7, // walking speed while fully leaned
  headClear: 0.12, // half size of the head probe used against walls
} as const;

export const DRONE = {
  halfW: 0.2, // half footprint of the chassis
  halfH: 0.12, // half height of the chassis
  camUp: 0.07, // the camera sits this far above the centre
  hitRadius: 0.26, // bullets use a slightly generous sphere
  speed: 2.7,
  accel: 16,
  decel: 24,
  airControl: 0.35,
  gravity: 18,
  terminalVel: 25,
  hopSpeed: 4.6, // m/s upward, apex = hopSpeed^2 / (2 * gravity) = 0.59 m
  stepUp: 0.1, // wheels roll over lips up to this high
  fallSafe: 7, // landing faster than this (m/s) damages the drone
  fallDamage: 5, // hp per m/s over the safe speed
  hp: 25,
  tagCooldown: 1.0,
  tagDuration: 8.0,
  respawnCooldown: 30, // seconds after loss during ACTION
  maxRange: 80,
} as const;

// ---- Hit boxes ----
export const HITBOX = {
  headRadius: 0.15,
  headDropFromEye: 0.1,
  bodyHalf: 0.3,
  bodyTopFromEye: 0.3, // neck height is eye minus this
  legTopStand: 0.85, // hits below this height above the feet are leg hits
  legTopCrouch: 0.6,
  legMul: 0.8,
} as const;

// ---- Materials ----
export const MaterialId = {
  NONE: 0,
  WOOD: 1,
  PLASTER: 2,
  BRICK: 3,
  CONCRETE: 4,
  GLASS: 5,
  METAL: 6, // only used as render id for reinforced cells
  FLOOR_WOOD: 7,
  FLOOR_CONCRETE: 8,
} as const;
export type MaterialId = (typeof MaterialId)[keyof typeof MaterialId];

export const MATERIAL_HP: Record<number, number> = {
  [MaterialId.WOOD]: 30,
  [MaterialId.PLASTER]: 40,
  [MaterialId.BRICK]: 120,
  [MaterialId.CONCRETE]: 100000,
  [MaterialId.GLASS]: 10,
  [MaterialId.METAL]: 100000,
  [MaterialId.FLOOR_WOOD]: 40,
  [MaterialId.FLOOR_CONCRETE]: 100000,
};

// ---- Siege mechanics ----
export const SIEGE = {
  reinforceTime: 2.0,
  reinforceTimeWarden: 1.5,
  reinforceCharges: 2,
  reinforceChargesWarden: 3,
  reinforceReach: 2.2,
  /** Barricades are a grid of planks (plankSize square, bottom row first); each has its own hit points. */
  plankHp: 30,
  plankSize: 0.25,
  /** A kick wrecks the planks within this reach of where it lands. */
  meleePlankRadius: 0.32,
  /** Bullets also hurt planks this close to the hit, a little. */
  bulletPlankRadius: 0.06,
  barricadeTime: 1.2,
  barricadeTimeWarden: 0.8,
  barricadeReach: 2.0,
  doorHp: 100,
  doorReach: 1.8,
  meleeRange: 1.5,
  meleeDamage: 40,
  meleeBarricadeDamage: 40,
  meleeCooldown: 0.7,
  penetrationEnabled: true,
  penetrationMaxWalls: 1,
} as const;

// ---- Weapons ----
export const WeaponId = {
  CARBINE: 0,
  RATTLER: 1,
  HAMMER: 2,
  MARKSMAN: 3,
  SIDEARM: 4,
  ANVIL: 5,
  WHISPER: 6,
  TALON: 7,
  MAGNUM: 8,
} as const;
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];

/** Kill feed causes that are not guns. Weapon ids are always below 40. */
export const KillCause = {
  MELEE: 40,
  BREACH: 41,
  TRAP: 42,
  FALL: 43,
  BOMB: 44,
  GRENADE: 45,
  WIRE: 46,
  NITRO: 47,
  BURN: 48,
} as const;

export type FireMode = 'auto' | 'semi' | 'burst';
export type GunKind = 'rifle' | 'smg' | 'shotgun' | 'dmr' | 'pistol' | 'lmg' | 'revolver';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  role: string;
  kind: GunKind;
  damage: number; // per pellet, body
  pellets: number;
  headMul: number;
  rpm: number; // rounds per minute (burst weapons: bursts per minute)
  mode: FireMode;
  burst: number; // shots per burst (burst mode)
  burstRpm: number; // rate inside a burst
  burstGap: number; // seconds after the last shot of a burst before the next burst may start
  mag: number;
  reserveMags: number;
  reload: number; // tactical reload (rounds left in the magazine), seconds. Per shell for shotguns.
  reloadEmpty: number; // reload from an empty gun (includes working the action)
  perShell: boolean;
  chamber: boolean; // a tactical reload leaves one in the chamber (mag + 1)
  spreadHip: number; // degrees, half angle of the cone
  spreadAds: number;
  bloomShot: number; // extra spread degrees added per shot
  bloomMax: number;
  bloomDecay: number; // degrees per second
  kickPitch: number; // radians of upward view kick per shot (real: the aim moves)
  kickYaw: number; // radians of sideways kick, mixed pattern and randomness
  kickRamp: number; // shots until the kick reaches full strength
  recoverDelay: number; // seconds after the last shot before the view starts to settle
  recoverRate: number; // exponential settle rate per second
  adsTime: number; // seconds to fully aim down sights
  adsFov: number; // vertical degrees when aiming (hip is about 59 at the default 90 degree horizontal FOV)
  adsMoveMul: number;
  moveMul: number; // carry weight
  drawTime: number; // seconds before the gun can fire after switching to it
  sprintOut: number; // seconds before the gun can fire after a sprint ends
  wallDamage: number; // per pellet, against structures
  pen: number; // damage kept after going through a soft wall (0.5 = half)
  falloffStart: number; // m
  falloffEnd: number; // m
  minDamageMul: number;
  suppressed: boolean;
  loudness: number; // radius (m) of the gunshot sound ping
  color: number;
  length: number; // viewmodel length
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: WeaponId.CARBINE, name: 'Carbine', role: 'Rifle', kind: 'rifle',
    damage: 27, pellets: 1, headMul: 2.5, rpm: 650, mode: 'auto', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 30, reserveMags: 3, reload: 2.2, reloadEmpty: 2.9, perShell: false, chamber: true,
    spreadHip: 1.8, spreadAds: 0.45, bloomShot: 0.1, bloomMax: 1.4, bloomDecay: 4,
    kickPitch: 0.017, kickYaw: 0.0045, kickRamp: 8, recoverDelay: 0.095, recoverRate: 7,
    adsTime: 0.17, adsFov: 44, adsMoveMul: 0.6, moveMul: 1, drawTime: 0.4, sprintOut: 0.2,
    wallDamage: 12, pen: 0.55, falloffStart: 30, falloffEnd: 80, minDamageMul: 0.6,
    suppressed: false, loudness: 60, color: 0x3a3f46, length: 0.62,
  },
  {
    id: WeaponId.RATTLER, name: 'Rattler', role: 'SMG', kind: 'smg',
    damage: 20, pellets: 1, headMul: 2.2, rpm: 850, mode: 'auto', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 35, reserveMags: 3, reload: 1.9, reloadEmpty: 2.5, perShell: false, chamber: true,
    spreadHip: 2.2, spreadAds: 0.8, bloomShot: 0.08, bloomMax: 1.1, bloomDecay: 4.5,
    kickPitch: 0.0108, kickYaw: 0.006, kickRamp: 10, recoverDelay: 0.075, recoverRate: 8,
    adsTime: 0.12, adsFov: 50, adsMoveMul: 0.72, moveMul: 1.04, drawTime: 0.3, sprintOut: 0.12,
    wallDamage: 8, pen: 0.4, falloffStart: 15, falloffEnd: 50, minDamageMul: 0.5,
    suppressed: false, loudness: 55, color: 0x4a4540, length: 0.5,
  },
  {
    id: WeaponId.HAMMER, name: 'Hammer', role: 'Shotgun', kind: 'shotgun',
    damage: 11, pellets: 8, headMul: 1.5, rpm: 70, mode: 'semi', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 6, reserveMags: 4, reload: 0.55, reloadEmpty: 0.55, perShell: true, chamber: false,
    spreadHip: 6, spreadAds: 4, bloomShot: 0, bloomMax: 0, bloomDecay: 4,
    kickPitch: 0.055, kickYaw: 0.008, kickRamp: 1, recoverDelay: 0.12, recoverRate: 5.5,
    adsTime: 0.2, adsFov: 54, adsMoveMul: 0.75, moveMul: 0.98, drawTime: 0.5, sprintOut: 0.25,
    wallDamage: 6, pen: 0.2, falloffStart: 8, falloffEnd: 25, minDamageMul: 0.25,
    suppressed: false, loudness: 65, color: 0x5a4a38, length: 0.7,
  },
  {
    id: WeaponId.MARKSMAN, name: 'Marksman', role: 'DMR', kind: 'dmr',
    damage: 55, pellets: 1, headMul: 2.5, rpm: 180, mode: 'semi', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 10, reserveMags: 3, reload: 2.6, reloadEmpty: 3.2, perShell: false, chamber: true,
    spreadHip: 1.0, spreadAds: 0.08, bloomShot: 0.35, bloomMax: 1.2, bloomDecay: 2.5,
    kickPitch: 0.034, kickYaw: 0.004, kickRamp: 1, recoverDelay: 0.14, recoverRate: 6,
    adsTime: 0.26, adsFov: 26, adsMoveMul: 0.5, moveMul: 0.96, drawTime: 0.55, sprintOut: 0.3,
    wallDamage: 25, pen: 0.75, falloffStart: 50, falloffEnd: 120, minDamageMul: 0.7,
    suppressed: false, loudness: 75, color: 0x2f3a33, length: 0.78,
  },
  {
    id: WeaponId.SIDEARM, name: 'Sidearm', role: 'Pistol', kind: 'pistol',
    damage: 38, pellets: 1, headMul: 3.0, rpm: 400, mode: 'semi', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 12, reserveMags: 4, reload: 1.5, reloadEmpty: 1.9, perShell: false, chamber: true,
    spreadHip: 1.5, spreadAds: 0.5, bloomShot: 0.3, bloomMax: 1.2, bloomDecay: 4,
    kickPitch: 0.023, kickYaw: 0.004, kickRamp: 1, recoverDelay: 0.08, recoverRate: 9,
    adsTime: 0.1, adsFov: 54, adsMoveMul: 0.85, moveMul: 1, drawTime: 0.25, sprintOut: 0.08,
    wallDamage: 6, pen: 0.4, falloffStart: 15, falloffEnd: 45, minDamageMul: 0.5,
    suppressed: false, loudness: 45, color: 0x30343a, length: 0.28,
  },
  {
    id: WeaponId.ANVIL, name: 'Anvil', role: 'LMG', kind: 'lmg',
    damage: 24, pellets: 1, headMul: 2.2, rpm: 580, mode: 'auto', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 60, reserveMags: 2, reload: 4.6, reloadEmpty: 5.4, perShell: false, chamber: false,
    spreadHip: 2.4, spreadAds: 0.7, bloomShot: 0.09, bloomMax: 2.2, bloomDecay: 3.5,
    kickPitch: 0.0165, kickYaw: 0.006, kickRamp: 16, recoverDelay: 0.105, recoverRate: 5,
    adsTime: 0.3, adsFov: 46, adsMoveMul: 0.45, moveMul: 0.9, drawTime: 0.7, sprintOut: 0.35,
    wallDamage: 22, pen: 0.7, falloffStart: 35, falloffEnd: 90, minDamageMul: 0.6,
    suppressed: false, loudness: 70, color: 0x3d4238, length: 0.74,
  },
  {
    id: WeaponId.WHISPER, name: 'Whisper', role: 'Suppressed SMG', kind: 'smg',
    damage: 18, pellets: 1, headMul: 2.2, rpm: 780, mode: 'auto', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 30, reserveMags: 3, reload: 1.9, reloadEmpty: 2.5, perShell: false, chamber: true,
    spreadHip: 2.0, spreadAds: 0.7, bloomShot: 0.07, bloomMax: 1.0, bloomDecay: 4.5,
    kickPitch: 0.0095, kickYaw: 0.005, kickRamp: 10, recoverDelay: 0.08, recoverRate: 8,
    adsTime: 0.13, adsFov: 50, adsMoveMul: 0.72, moveMul: 1.03, drawTime: 0.32, sprintOut: 0.12,
    wallDamage: 7, pen: 0.35, falloffStart: 12, falloffEnd: 45, minDamageMul: 0.5,
    suppressed: true, loudness: 14, color: 0x2a2d31, length: 0.52,
  },
  {
    id: WeaponId.TALON, name: 'Talon', role: 'Burst rifle', kind: 'rifle',
    damage: 30, pellets: 1, headMul: 2.5, rpm: 300, mode: 'burst', burst: 3, burstRpm: 950, burstGap: 0.2,
    mag: 24, reserveMags: 3, reload: 2.1, reloadEmpty: 2.8, perShell: false, chamber: true,
    spreadHip: 1.6, spreadAds: 0.4, bloomShot: 0.12, bloomMax: 1.2, bloomDecay: 4.5,
    kickPitch: 0.021, kickYaw: 0.004, kickRamp: 3, recoverDelay: 0.1, recoverRate: 8,
    adsTime: 0.17, adsFov: 44, adsMoveMul: 0.62, moveMul: 1, drawTime: 0.4, sprintOut: 0.2,
    wallDamage: 14, pen: 0.6, falloffStart: 35, falloffEnd: 85, minDamageMul: 0.6,
    suppressed: false, loudness: 60, color: 0x39424a, length: 0.6,
  },
  {
    id: WeaponId.MAGNUM, name: 'Magnum', role: 'Heavy pistol', kind: 'revolver',
    damage: 62, pellets: 1, headMul: 2.4, rpm: 150, mode: 'semi', burst: 0, burstRpm: 0, burstGap: 0,
    mag: 6, reserveMags: 4, reload: 2.3, reloadEmpty: 2.7, perShell: false, chamber: false,
    spreadHip: 1.6, spreadAds: 0.35, bloomShot: 0.6, bloomMax: 1.8, bloomDecay: 3,
    kickPitch: 0.056, kickYaw: 0.007, kickRamp: 1, recoverDelay: 0.12, recoverRate: 7,
    adsTime: 0.13, adsFov: 52, adsMoveMul: 0.85, moveMul: 0.99, drawTime: 0.35, sprintOut: 0.12,
    wallDamage: 20, pen: 0.6, falloffStart: 20, falloffEnd: 60, minDamageMul: 0.55,
    suppressed: false, loudness: 62, color: 0x40382e, length: 0.32,
  },
];

export const RECOIL_MAX = 0.3; // radians (about 17 degrees) cap on accumulated kick

// ---- Round flow ----
export const PhaseId = {
  LOBBY: 0,
  OPERATOR_SELECT: 1,
  PREP: 2,
  ACTION: 3,
  ROUND_END: 4,
  MATCH_END: 5,
} as const;
export type PhaseId = (typeof PhaseId)[keyof typeof PhaseId];

export const GameMode = {
  SECURE: 0,
  ELIMINATION: 1,
  SANDBOX: 2,
  /** Attackers plant a defuser on the site, defenders disable it. */
  BOMB: 3,
} as const;
export type GameMode = (typeof GameMode)[keyof typeof GameMode];

export interface RoomSettings {
  mode: GameMode;
  roundsToWin: number;
  prepTime: number;
  actionTime: number;
  operatorSelectTime: number;
  roundEndTime: number;
  swapEvery: number;
  captureTime: number;
  friendlyFire: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: GameMode.SECURE,
  roundsToWin: 4,
  prepTime: 45,
  actionTime: 180,
  operatorSelectTime: 20,
  roundEndTime: 6,
  swapEvery: 3,
  captureTime: 10,
  friendlyFire: false,
};

/** Bomb mode tuning. */
export const BOMB = {
  /** Seconds the defuser needs to be planted, and to be disabled. */
  plantTime: 4,
  defuseTime: 7,
  /** From the plant to the blast (replaces the round timer). */
  timer: 45,
  /** How close a defender has to stand to disable it (m). */
  defuseReach: 1.8,
  /** The blast. */
  radius: 6,
  damage: 300,
} as const;

/** 0 no bomb yet, 1 planted and counting down, 2 disabled, 3 went off. */
export const BombState = { NONE: 0, PLANTED: 1, DEFUSED: 2, EXPLODED: 3 } as const;

export const NET = {
  maxPlayers: 10,
  interpDelayMs: 100,
  interpDelayMaxMs: 200,
  lagCompMaxMs: 250,
  historyMs: 500,
  roomCodeLen: 4,
  roomCodeChars: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  roomIdleMs: 60000,
  reconnectMs: 60000,
  pingIntervalMs: 15000,
  maxMsgPerSec: 240,
  maxInputsPerMsg: 12,
  visibilityHysteresis: 0.5,
} as const;

export const COLORS = {
  attackers: 0xff7a1a,
  defenders: 0x18c8ff,
  tagged: 0xff3030,
} as const;
