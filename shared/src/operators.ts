import { WeaponId } from './constants';

export const OperatorId = {
  RAM: 0,
  PING: 1,
  MEND: 2,
  AEGIS: 3,
  WARDEN: 4,
  SNARE: 5,
  JAM: 6,
  EYE: 7,
  RECRUIT_A: 8,
  RECRUIT_D: 9,
  BURN: 10,
  RUSH: 11,
  NITRO: 12,
  PATCH: 13,
} as const;
export type OperatorId = (typeof OperatorId)[keyof typeof OperatorId];

export const GadgetKind = {
  NONE: 0,
  BREACH: 1, // Ram
  SENSOR: 2, // Ping
  DART: 3, // Mend
  SHIELD: 4, // Aegis
  REINFORCE: 5, // Warden (passive extra charges)
  TRAP: 6, // Snare
  JAMMER: 7, // Jam
  CAMERA: 8, // Eye
  THERMITE: 9, // Burn
  STIM: 10, // Rush
  NITRO: 11, // Nitro
  STATION: 12, // Patch
} as const;
export type GadgetKind = (typeof GadgetKind)[keyof typeof GadgetKind];

export interface OperatorDef {
  id: OperatorId;
  name: string;
  side: 'attack' | 'defend';
  /** Two primary weapon choices. */
  primaries: [WeaponId, WeaponId];
  /** Two sidearm choices. */
  secondaries: [WeaponId, WeaponId];
  gadget: GadgetKind;
  gadgetName: string;
  gadgetUses: number;
  gadgetDesc: string;
  passive: string;
  /** Movement speed multiplier (passive). */
  speedMul: number;
  /** Extra reinforcement charges (defenders). */
  reinforceCharges: number;
  /** Faster reinforcing / barricading (multiplier on time). */
  buildTimeMul: number;
  /** Multiplier on melee damage dealt to barricades and doors. */
  meleeStructureMul: number;
  /** Unique pick per team. Recruits are not unique. */
  unique: boolean;
  /** Extra (or fewer) hit points at the start of a round. */
  hpBonus: number;
}

export const OPERATORS: readonly OperatorDef[] = [
  {
    id: OperatorId.RAM, name: 'Ram', side: 'attack',
    primaries: [WeaponId.CARBINE, WeaponId.HAMMER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.BREACH, gadgetName: 'Hard breach charge', gadgetUses: 2,
    gadgetDesc: 'Stick to a wall or hatch, press again to detonate. Destroys reinforced walls.',
    passive: 'Heavy boots: kicks do 50% more damage to barricades.',
    speedMul: 0.97, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1.5, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.PING, name: 'Ping', side: 'attack',
    primaries: [WeaponId.RATTLER, WeaponId.MARKSMAN],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.SENSOR, gadgetName: 'Pulse sensor', gadgetUses: 3,
    gadgetDesc: 'Shows enemy heartbeats within 12 m through walls for 6 s. Blocked by jammers.',
    passive: 'Light footed: moves 4% faster.',
    speedMul: 1.04, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.MEND, name: 'Mend', side: 'attack',
    primaries: [WeaponId.TALON, WeaponId.RATTLER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.DART, gadgetName: 'Heal darts', gadgetUses: 4,
    gadgetDesc: 'Shoot a teammate (or yourself) to heal 40 HP over 4 s. Cannot revive.',
    passive: 'Steady hands: nothing extra, but heals are 25% stronger.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.AEGIS, name: 'Aegis', side: 'attack',
    primaries: [WeaponId.ANVIL, WeaponId.RATTLER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.SHIELD, gadgetName: 'Deployable shield', gadgetUses: 2,
    gadgetDesc: 'Place a 1.2 m wide shield with 400 HP. Blocks bullets, can be vaulted.',
    passive: 'Plated vest: starts with 110 HP.',
    speedMul: 0.98, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 10,
  },
  {
    id: OperatorId.WARDEN, name: 'Warden', side: 'defend',
    primaries: [WeaponId.HAMMER, WeaponId.TALON],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.REINFORCE, gadgetName: 'Extra reinforcement', gadgetUses: 0,
    gadgetDesc: 'Carries 3 reinforcement charges instead of 2, and places them in 1.5 s.',
    passive: 'Quick hands: barricades go up faster.',
    speedMul: 1, reinforceCharges: 1, buildTimeMul: 0.75, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.SNARE, name: 'Snare', side: 'defend',
    primaries: [WeaponId.WHISPER, WeaponId.HAMMER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.TRAP, gadgetName: 'Spike traps', gadgetUses: 3,
    gadgetDesc: 'Floor trap, only your team sees it. Slows an attacker 70% for 3 s and deals 25 damage.',
    passive: 'Cat feet: footsteps are quieter.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.JAM, name: 'Jam', side: 'defend',
    primaries: [WeaponId.CARBINE, WeaponId.ANVIL],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.JAMMER, gadgetName: 'Signal jammers', gadgetUses: 2,
    gadgetDesc: 'Disables sensors, heal darts and drones within 8 m. 60 HP each.',
    passive: 'Static: nothing extra.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.EYE, name: 'Eye', side: 'defend',
    primaries: [WeaponId.MARKSMAN, WeaponId.CARBINE],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.CAMERA, gadgetName: 'Security cameras', gadgetUses: 2,
    gadgetDesc: 'Place cameras on walls or ceilings. Cycle through them with the camera button. They tag attackers in view.',
    passive: 'Watchful: nothing extra.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.RECRUIT_A, name: 'Recruit', side: 'attack',
    primaries: [WeaponId.CARBINE, WeaponId.RATTLER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.NONE, gadgetName: 'None', gadgetUses: 0,
    gadgetDesc: 'No gadget. Just a rifle and a drone.',
    passive: 'None.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: false, hpBonus: 0,
  },
  {
    id: OperatorId.RECRUIT_D, name: 'Recruit', side: 'defend',
    primaries: [WeaponId.CARBINE, WeaponId.HAMMER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.NONE, gadgetName: 'None', gadgetUses: 0,
    gadgetDesc: 'No gadget. Just reinforcements and a rifle.',
    passive: 'None.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: false, hpBonus: 0,
  },
  {
    id: OperatorId.BURN, name: 'Burn', side: 'attack',
    primaries: [WeaponId.RATTLER, WeaponId.HAMMER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.THERMITE, gadgetName: 'Burn charge', gadgetUses: 2,
    gadgetDesc: 'Stick to a wall or hatch. After 3 seconds it burns a person sized hole, reinforced or not, and everybody close gets scorched. Quiet and slow compared to a hard breach.',
    passive: 'Heat suit: starts with 105 HP.',
    speedMul: 0.98, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 5,
  },
  {
    id: OperatorId.RUSH, name: 'Rush', side: 'attack',
    primaries: [WeaponId.RATTLER, WeaponId.CARBINE],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.STIM, gadgetName: 'Stim shots', gadgetUses: 2,
    gadgetDesc: 'Inject for 5 seconds of 30% more speed and 25 HP of healing. Loud footsteps while it lasts.',
    passive: 'Sprinter: moves 6% faster, starts with 95 HP.',
    speedMul: 1.06, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: -5,
  },
  {
    id: OperatorId.NITRO, name: 'Nitro', side: 'defend',
    primaries: [WeaponId.CARBINE, WeaponId.HAMMER],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.NITRO, gadgetName: 'Nitro cell', gadgetUses: 2,
    gadgetDesc: 'Throw it, it sticks to whatever it hits. Press again to blow it up: wrecks barricades and soft walls and hurts anybody nearby. Enemies can see it.',
    passive: 'Demolitionist: barricades go up a little faster.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 0.9, meleeStructureMul: 1, unique: true, hpBonus: 0,
  },
  {
    id: OperatorId.PATCH, name: 'Patch', side: 'defend',
    primaries: [WeaponId.TALON, WeaponId.CARBINE],
    secondaries: [WeaponId.SIDEARM, WeaponId.MAGNUM],
    gadget: GadgetKind.STATION, gadgetName: 'Med station', gadgetUses: 2,
    gadgetDesc: 'Set it on the floor. Teammates within 2.5 m heal 6 HP per second until its 120 HP of supplies are used up.',
    passive: 'Field medic: starts with 105 HP.',
    speedMul: 1, reinforceCharges: 0, buildTimeMul: 1, meleeStructureMul: 1, unique: true, hpBonus: 5,
  },
];

export function operatorDef(id: number): OperatorDef {
  return (OPERATORS[id] ?? OPERATORS[OperatorId.RECRUIT_A]) as OperatorDef;
}

export function operatorsForSide(side: 'attack' | 'defend'): OperatorDef[] {
  return OPERATORS.filter((o) => o.side === side);
}

export function defaultOperator(side: 'attack' | 'defend'): OperatorId {
  return side === 'attack' ? OperatorId.RECRUIT_A : OperatorId.RECRUIT_D;
}

// ---- Gadget tuning ----
export const GADGET = {
  breachBox: { w: 1.5, h: 2.0, d: 1.5 },
  breachDamageRadius: 3.0,
  breachDamage: 120,
  breachKnockback: 9,
  breachFuse: 0.0,
  breachReach: 3.0,
  sensorRange: 12,
  sensorDuration: 6,
  sensorCooldown: 20,
  dartHeal: 40,
  dartHealTime: 4,
  dartRange: 30,
  shieldHp: 400,
  shieldWidth: 1.2,
  shieldHeight: 1.5,
  shieldThickness: 0.12,
  trapSlowTime: 3,
  trapDamage: 25,
  trapRadius: 0.6,
  jammerHp: 60,
  jammerRange: 8,
  cameraHp: 30,
  /** Burn charge: seconds before it burns through, size of the hole, scorch radius and damage. */
  burnFuse: 3,
  burnBox: { w: 0.9, h: 1.3, d: 1.2 },
  burnRadius: 1.4,
  burnDamage: 45,
  stimTime: 5,
  stimSpeed: 1.3,
  stimHeal: 25,
  /** Nitro cell blast. */
  nitroRadius: 4.5,
  nitroDamage: 150,
  nitroWallRadius: 2.4,
  nitroWallDamage: 220,
  /** Med station: radius, heal per second, total supplies. */
  stationRadius: 2.5,
  stationRate: 6,
  stationSupply: 120,
  placeReach: 3.2,
  placeTime: 0.5,
} as const;
