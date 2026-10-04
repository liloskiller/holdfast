import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GameMode, PhaseId, lookDir, makeRayHit, spotDistance, spreadPick } from '@holdfast/shared';
import { addBot } from './bots/botSystem';
import { startMatch } from './systems/roundSystem';
import { makeRoom } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

function houseRoom(seed: number, perSide: number): ReturnType<typeof makeRoom> {
  const room = makeRoom({
    map: SAFEHOUSE,
    settings: { prepTime: 30, actionTime: 100, operatorSelectTime: 1, roundEndTime: 3, roundsToWin: 2, mode: GameMode.SECURE },
  });
  room.rngState = seed >>> 0;
  for (let i = 0; i < perSide; i++) {
    addBot(room, 0, 1);
    addBot(room, 1, 1);
  }
  startMatch(room);
  // stop on the very tick the round is dealt out, before the bots start walking
  for (let i = 0; i < 400 && room.phase !== PhaseId.PREP; i++) room.advance(1000 / 60);
  return room;
}

describe('spawn placement', () => {
  it('spreadPick chooses points that are far apart', () => {
    const line = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ x, y: 0, z: 0 }));
    const picks = spreadPick(line, 3, [], 0);
    const spots = picks.map((i) => line[i] as (typeof line)[number]);
    expect(new Set(picks).size).toBe(3);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) expect(spotDistance(spots[i]!, spots[j]!)).toBeGreaterThanOrEqual(5);
    }
  });

  it('spreadPick keeps away from spots that are already taken', () => {
    const line = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ x, y: 0, z: 0 }));
    const [pick] = spreadPick(line, 1, [{ x: 0, y: 0, z: 0 }], 4);
    expect(pick).toBe(10);
  });

  it('five attackers never start closer than a body width and a half', () => {
    for (const seed of [1, 7, 42, 99, 12345]) {
      const room = houseRoom(seed, 5);
      expect(room.phase).toBe(PhaseId.PREP);
      const att = [...room.players.values()].filter((p) => p.team === room.attackerTeam);
      expect(att).toHaveLength(5);
      for (let i = 0; i < att.length; i++) {
        for (let j = i + 1; j < att.length; j++) {
          const a = att[i]!.state;
          const b = att[j]!.state;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(1.4);
        }
      }
    }
  });

  it('defenders start apart from each other and look into open space', () => {
    const hit = makeRayHit();
    const d = { x: 0, y: 0, z: 0 };
    for (const seed of [3, 8, 21, 500]) {
      const room = houseRoom(seed, 5);
      const def = [...room.players.values()].filter((p) => p.team !== room.attackerTeam);
      expect(def).toHaveLength(5);
      for (let i = 0; i < def.length; i++) {
        const a = def[i]!.state;
        for (let j = i + 1; j < def.length; j++) {
          const b = def[j]!.state;
          expect(spotDistance(a, b)).toBeGreaterThanOrEqual(3);
        }
        lookDir(a.yaw, 0, d);
        const blocked = room.world.raycast(a.x, a.y + 1.5, a.z, d.x, d.y, d.z, 2.5, hit, { seeThroughGlass: true });
        expect(blocked, `defender ${i} (seed ${seed}) faces a wall ${hit.t.toFixed(2)} m away`).toBe(false);
      }
    }
  });

  it('every spawn point is standing room', () => {
    const room = houseRoom(5, 1);
    for (const sp of [...room.map.attackerSpawns, ...room.map.defenderSpawns]) {
      expect(room.world.standingFree(sp.x, sp.y, sp.z), `${sp.name} at ${sp.tx},${sp.tz}`).toBe(true);
    }
  });
});
