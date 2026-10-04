// Secondary gadgets: grenades that are thrown and traps that are set down. One is picked per round,
// next to the operator and the guns. Shared so the picker and the server agree on the numbers.

export const ThrowKind = {
  NONE: 0,
  FRAG: 1,
  FLASH: 2,
  SMOKE: 3,
  IMPACT: 4,
  WIRE: 5,
  ALARM: 6,
} as const;
export type ThrowKind = (typeof ThrowKind)[keyof typeof ThrowKind];

export interface ThrowDef {
  id: ThrowKind;
  name: string;
  side: 'attack' | 'defend';
  count: number;
  /** Thrown through the air (true) or set down at your feet (false). */
  thrown: boolean;
  desc: string;
}

export const THROWABLES: readonly ThrowDef[] = [
  { id: ThrowKind.NONE, name: 'None', side: 'attack', count: 0, thrown: false, desc: 'Nothing.' },
  {
    id: ThrowKind.FRAG, name: 'Frag grenade', side: 'attack', count: 2, thrown: true,
    desc: 'Goes off 2.5 s after the throw. Kills or wounds everybody close and in the open, hurts you too.',
  },
  {
    id: ThrowKind.FLASH, name: 'Flashbang', side: 'attack', count: 2, thrown: true,
    desc: 'Blinds and deafens everybody who sees it go off, much less if they look away.',
  },
  {
    id: ThrowKind.SMOKE, name: 'Smoke grenade', side: 'attack', count: 2, thrown: true,
    desc: 'A cloud nobody can see through for 14 s. Cover a push or a plant.',
  },
  {
    id: ThrowKind.IMPACT, name: 'Impact grenade', side: 'defend', count: 2, thrown: true,
    desc: 'Goes off on the first thing it hits. Tears soft walls, barricades and doors open, and hurts anyone near.',
  },
  {
    id: ThrowKind.WIRE, name: 'Barbed wire', side: 'defend', count: 2, thrown: false,
    desc: 'Set on the floor, visible to all. Slows an attacker a lot and cuts for a little damage while they are in it.',
  },
  {
    id: ThrowKind.ALARM, name: 'Proximity alarm', side: 'defend', count: 2, thrown: false,
    desc: 'Set on the floor. The first attacker to come near is marked for your team for 3 s.',
  },
];

export function throwDef(id: number): ThrowDef {
  return (THROWABLES[id] ?? THROWABLES[0]) as ThrowDef;
}

export function throwablesForSide(side: 'attack' | 'defend'): ThrowDef[] {
  return THROWABLES.filter((t) => t.id !== ThrowKind.NONE && t.side === side);
}

export function defaultThrowable(side: 'attack' | 'defend'): ThrowKind {
  return side === 'attack' ? ThrowKind.FRAG : ThrowKind.IMPACT;
}

/** Tuning for thrown things. */
export const THROW = {
  /** Release speed along the look direction (m/s), and a little extra lift. */
  speed: 12,
  lift: 1.6,
  gravity: 16,
  /** Share of the thrower's own velocity that carries over. */
  inherit: 0.5,
  bounce: 0.42,
  friction: 0.7,
  radius: 0.08,
  cooldown: 1.1,
  /** Seconds from the release to the bang. */
  fuse: { frag: 2.5, flash: 1.7, smoke: 1.4, impact: 8 },
  frag: { radius: 5.5, damage: 140, wallRadius: 1.6, wallDamage: 30 },
  impact: { radius: 3.2, damage: 70, wallRadius: 2.3, wallDamage: 170 },
  flash: { radius: 14, maxTime: 5, minTime: 1.2, awayMul: 0.3 },
  smoke: { radius: 3, grow: 1.4, life: 14 },
  wire: { radius: 0.85, slow: 0.35, dps: 6, hp: 40 },
  alarm: { radius: 3.2, mark: 3 },
} as const;
