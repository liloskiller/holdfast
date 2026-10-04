// A solo match: the human plus bots on both sides, started immediately.

import { clamp, type SoloOptions } from '@holdfast/shared';
import type { Player } from '../Player';
import type { Room } from '../Room';
import { startMatch } from '../systems/roundSystem';
import { addBot } from './botSystem';

export function setupSolo(room: Room, human: Player, solo: SoloOptions): string | null {
  const size = clamp(Math.round(solo.size), 2, 5);
  const difficulty = clamp(Math.round(solo.difficulty), 0, 2);
  // shorter than a human match: first to 3, sides swap every 2 rounds
  room.settings = { ...room.settings, roundsToWin: 3, swapEvery: 2 };
  human.team = solo.side === 1 ? 1 : 0;
  const enemy = human.team === 0 ? 1 : 0;
  for (let i = 0; i < size - 1; i++) addBot(room, human.team, difficulty);
  for (let i = 0; i < size; i++) addBot(room, enemy, difficulty);
  return startMatch(room);
}
