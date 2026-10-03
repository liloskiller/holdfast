// Small generated maps used by tests and by the integration bots.

import { LEGEND } from './mapFormat';

export interface ArenaOpts {
  nx?: number;
  nz?: number;
}

/**
 * A single floor open arena. Attackers spawn on the left, defenders on the right, with a bit of cover
 * in the middle. The "building" is a tiny rectangle in a corner so prep confinement does not matter.
 */
export function arenaMapText(opts: ArenaOpts = {}): string {
  const nx = opts.nx ?? 40;
  const nz = opts.nz ?? 24;
  const rows: string[][] = Array.from({ length: nz }, () => Array.from({ length: nx }, () => '.'));
  for (let x = 0; x < nx; x++) { rows[0]![x] = '#'; rows[nz - 1]![x] = '#'; }
  for (let z = 0; z < nz; z++) { rows[z]![0] = '#'; rows[z]![nx - 1] = '#'; }
  for (let z = 9; z <= 13; z++) rows[z]![4] = 'A';
  for (let z = 9; z <= 13; z++) rows[z]![nx - 5] = 'Y';
  for (let z = 10; z <= 12; z++) for (let x = nx - 10; x < nx - 7; x++) rows[z]![x] = 'O';
  for (const [x, z] of [[18, 6], [18, 7], [22, 16], [22, 17], [20, 11]] as const) rows[z]![x] = 'f';
  const text = rows.map((r) => r.join('')).join('\n');
  for (const ch of text) if (ch !== '\n' && !LEGEND.includes(ch)) throw new Error('bad arena char');
  return [
    'name: Arena',
    'tile: 0.5',
    'floor_height: 3.0',
    `size: ${nx} ${nz}`,
    'floors: 1',
    `building: ${nx - 4} ${nz - 4} ${nx - 2} ${nz - 2}`,
    'objective: Zone',
    'attacker: Left',
    'drone: D1 6 4',
    'drone: D2 6 20',
    'drone: D3 30 4',
    'drone: D4 30 20',
    '',
    '--- floor 0 ---',
    text,
    '',
  ].join('\n');
}
