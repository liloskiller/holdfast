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

export const DRONE = {
  radius: 0.15,
  speed: 3.0,
  vertSpeed: 2.2,
  accel: 14,
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
  barricadeHp: 150,
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
  penetrationDamageMul: 0.5,
  penetrationMaxWalls: 1,
} as const;

// ---- Weapons ----
export const WeaponId = {
  CARBINE: 0,
  RATTLER: 1,
  HAMMER: 2,
  MARKSMAN: 3,
  SIDEARM: 4,
} as const;
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  role: string;
  damage: number; // per pellet, body
  pellets: number;
  headMul: number;
  rpm: number;
  mag: number;
  reserveMags: number;
  reload: number; // seconds (per shell when perShell)
  perShell: boolean;
  auto: boolean;
  spreadHip: number; // degrees
  spreadAds: number; // degrees
  wallDamage: number; // per pellet
  falloffStart: number; // m
  falloffEnd: number; // m
  minDamageMul: number;
  recoilPitch: number; // radians of camera kick per shot (cosmetic)
  recoilYaw: number;
  adsFov: number; // vertical degrees when aiming (hip is about 59 at the default 90 degree horizontal FOV)
  adsMoveMul: number;
  color: number;
  length: number; // viewmodel length
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: WeaponId.CARBINE, name: 'Carbine', role: 'Rifle', damage: 27, pellets: 1, headMul: 2.5,
    rpm: 650, mag: 30, reserveMags: 3, reload: 2.3, perShell: false, auto: true,
    spreadHip: 1.8, spreadAds: 0.5, wallDamage: 12, falloffStart: 30, falloffEnd: 80, minDamageMul: 0.6,
    recoilPitch: 0.011, recoilYaw: 0.004, adsFov: 44, adsMoveMul: 0.6, color: 0x3a3f46, length: 0.62,
  },
  {
    id: WeaponId.RATTLER, name: 'Rattler', role: 'SMG', damage: 20, pellets: 1, headMul: 2.2,
    rpm: 850, mag: 35, reserveMags: 3, reload: 2.0, perShell: false, auto: true,
    spreadHip: 2.2, spreadAds: 0.8, wallDamage: 8, falloffStart: 15, falloffEnd: 50, minDamageMul: 0.5,
    recoilPitch: 0.008, recoilYaw: 0.005, adsFov: 50, adsMoveMul: 0.72, color: 0x4a4540, length: 0.5,
  },
  {
    id: WeaponId.HAMMER, name: 'Hammer', role: 'Shotgun', damage: 11, pellets: 8, headMul: 1.5,
    rpm: 70, mag: 6, reserveMags: 4, reload: 0.6, perShell: true, auto: false,
    spreadHip: 6, spreadAds: 4, wallDamage: 6, falloffStart: 8, falloffEnd: 25, minDamageMul: 0.25,
    recoilPitch: 0.035, recoilYaw: 0.006, adsFov: 54, adsMoveMul: 0.75, color: 0x5a4a38, length: 0.7,
  },
  {
    id: WeaponId.MARKSMAN, name: 'Marksman', role: 'DMR', damage: 55, pellets: 1, headMul: 2.5,
    rpm: 180, mag: 10, reserveMags: 3, reload: 2.8, perShell: false, auto: false,
    spreadHip: 1.0, spreadAds: 0.1, wallDamage: 25, falloffStart: 50, falloffEnd: 120, minDamageMul: 0.7,
    recoilPitch: 0.022, recoilYaw: 0.003, adsFov: 26, adsMoveMul: 0.5, color: 0x2f3a33, length: 0.78,
  },
  {
    id: WeaponId.SIDEARM, name: 'Sidearm', role: 'Pistol', damage: 38, pellets: 1, headMul: 3.0,
    rpm: 400, mag: 12, reserveMags: 4, reload: 1.6, perShell: false, auto: false,
    spreadHip: 1.5, spreadAds: 0.5, wallDamage: 6, falloffStart: 15, falloffEnd: 45, minDamageMul: 0.5,
    recoilPitch: 0.014, recoilYaw: 0.003, adsFov: 54, adsMoveMul: 0.85, color: 0x30343a, length: 0.28,
  },
];

export const SWITCH_TIME = 0.35;

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
