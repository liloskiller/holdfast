import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { MaterialId } from './constants';
import { parseMap } from './mapFormat';
import { HitKind, Vox, World, makeRayHit } from './world';

const here = path.dirname(fileURLToPath(import.meta.url));
const text = fs.readFileSync(path.join(here, '..', 'maps', 'safehouse.map.txt'), 'utf8');
const map = parseMap(text);

// Kitchen east wall (lx=17 -> abs tile 27) at lz=5 (abs tile 15) is plain plaster.
const WALL_X = 27 * 0.5;
const WALL_Z = 15.5 * 0.5;

describe('World', () => {
  let w: World;
  beforeEach(() => {
    w = new World(map);
  });

  it('builds cells deterministically', () => {
    const w2 = new World(map);
    expect(w2.cellCount).toBe(w.cellCount);
    expect(Array.from(w2.cellMat)).toEqual(Array.from(w.cellMat));
    expect(w.cellCount).toBeGreaterThan(1000);
    expect(w.panels.length).toBe(8);
    expect(w.hatches.length).toBe(4);
  });

  it('raycast hits plaster, damage wears it down, concrete is indestructible', () => {
    const hit = makeRayHit();
    expect(w.raycast(WALL_X - 1, 1.0, WALL_Z, 1, 0, 0, 10, hit)).toBe(true);
    expect(hit.kind).toBe(HitKind.CELL);
    expect(hit.t).toBeCloseTo(1, 4);
    expect(w.materialOf(hit.id)).toBe(MaterialId.PLASTER);
    const id = hit.id;
    expect(w.damageCell(id, 12)).toBe(false);
    expect(w.cellHp[id]).toBeCloseTo(28, 4);
    expect(w.damageCell(id, 12)).toBe(false);
    expect(w.damageCell(id, 12)).toBe(false);
    expect(w.damageCell(id, 12)).toBe(true);
    expect(w.cellAlive[id]).toBe(0);
    // the bullet now passes through the hole and hits the next thing
    expect(w.raycast(WALL_X - 1, 0.5 * (hit.y / 0.5 | 0) + 0.25, WALL_Z, 1, 0, 0, 10, hit)).toBe(true);
    // outer shell is static concrete
    expect(w.raycast(11, 1.0, 5.2, 0, 0, -1, 10, hit)).toBe(true);
    expect(hit.kind).toBe(HitKind.STATIC);
  });

  it('reinforced panels ignore bullets but not hard breaches', () => {
    const panel = w.panels[0]!;
    expect(w.reinforcePanel(panel.id)).toBe(true);
    expect(w.reinforcePanel(panel.id)).toBe(false);
    const cid = panel.cellIds[0]!;
    expect(w.damageCell(cid, 1000)).toBe(false);
    expect(w.cellAlive[cid]).toBe(1);
    expect(w.damageCell(cid, 1000, true)).toBe(true);
    // box destruction respects the reinforced flag
    const c = { x: 0, y: 0, z: 0 };
    const other = panel.cellIds[1]!;
    w.cellCenter(other, c);
    const box = { minX: c.x - 0.2, maxX: c.x + 0.2, minY: c.y - 0.2, maxY: c.y + 0.2, minZ: c.z - 0.2, maxZ: c.z + 0.2 };
    expect(w.destroyBox(box, false)).toEqual([]);
    expect(w.destroyBox(box, true)).toContain(other);
  });

  it('doors toggle and block movement boxes', () => {
    const door = w.openings.find((o) => o.kind === 'door')!;
    const cx = door.cx;
    const cz = door.cz;
    const box = (): number => w.queryBoxes(cx - 0.1, door.box.minY + 0.1, cz - 0.1, cx + 0.1, door.box.minY + 1, cz + 0.1);
    expect(box()).toBeGreaterThan(0);
    expect(w.setDoorOpen(door.id, true)).toBe(true);
    expect(box()).toBe(0);
    w.setDoorOpen(door.id, false);
    expect(w.placeBarricade(door.id)).toBe(true);
    expect(w.setDoorOpen(door.id, true)).toBe(false);
    expect(w.damageOpening(door.id, 149)).toBe(false);
    expect(w.damageOpening(door.id, 5)).toBe(true);
    expect(door.barricadeHp).toBe(0);
  });

  it('diffs replicate to a second world and to late joiners', () => {
    const client = new World(map);
    const late = new World(map);
    const panel = w.panels[2]!;
    w.reinforcePanel(panel.id);
    w.damageCell(5, 15);
    w.damageCell(6, 1000);
    const door = w.openings.find((o) => o.kind === 'door')!;
    w.setDoorOpen(door.id, true);
    const diff = w.flushDiff();
    expect(diff).not.toBeNull();
    expect(w.flushDiff()).toBeNull();
    client.applyDiff(diff!);
    late.applyDiff(w.fullDiff());
    for (const other of [client, late]) {
      expect(Array.from(other.cellAlive)).toEqual(Array.from(w.cellAlive));
      expect(Array.from(other.cellReinf)).toEqual(Array.from(w.cellReinf));
      expect(other.openings[door.id]!.open).toBe(true);
      expect(other.vox[w.cellVox[6]!]).toBe(Vox.AIR);
    }
  });

  it('reset restores the pristine state', () => {
    w.damageCell(1, 1000);
    w.reinforcePanel(0);
    w.setDoorOpen(w.openings.find((o) => o.kind === 'door')!.id, true);
    w.reset();
    expect(w.cellAlive[1]).toBe(1);
    expect(w.panels[0]!.reinforced).toBe(false);
    expect(w.flushDiff()).toBeNull();
  });

  it('explosions damage cells with falloff', () => {
    const hit = makeRayHit();
    w.raycast(WALL_X - 1, 1.0, WALL_Z, 1, 0, 0, 10, hit);
    const destroyed = w.explode(hit.x, hit.y, hit.z, 1.0, 200);
    expect(destroyed.length).toBeGreaterThan(3);
  });

  it('line of sight sees through glass and not through walls', () => {
    const win = w.openings.find((o) => o.kind === 'window' && o.floor === 0)!;
    const outside = win.alongX ? [win.cx, 1.5, win.box.minZ - 2] : [win.box.minX - 2, 1.5, win.cz];
    const inside = win.alongX ? [win.cx, 1.5, win.box.maxZ + 2] : [win.box.maxX + 2, 1.5, win.cz];
    expect(w.lineOfSight(outside[0]!, outside[1]!, outside[2]!, inside[0]!, inside[1]!, inside[2]!)).toBe(true);
    // solid wall: through the kitchen/pantry plaster wall
    expect(w.lineOfSight(WALL_X - 1, 1.0, WALL_Z, WALL_X + 1, 1.0, WALL_Z)).toBe(false);
  });
});
