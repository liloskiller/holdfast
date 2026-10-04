import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Btn, EntityKind, GADGET, OperatorId, operatorDef, arenaMapText } from '@holdfast/shared';
import { addHuman, feed, forceAction, makeRoom, place, TICK_MS } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');
const EAST = -Math.PI / 2;

function ms(room: ReturnType<typeof makeRoom>, t: number): void {
  for (let i = 0; i < Math.round(t / TICK_MS); i++) room.advance(TICK_MS);
}

function pickOp(p: { op: number; gadgetUses: number }, op: number): void {
  p.op = op;
  p.gadgetUses = operatorDef(op).gadgetUses;
}

describe('later operators', () => {
  it('Burn burns through a reinforced wall after a delay and leaves a way through', () => {
    const room = makeRoom({ map: SAFEHOUSE });
    const atk = addHuman(room, 'Atk', 0);
    const foe = addHuman(room, 'Def', 1);
    forceAction(room);
    pickOp(atk.p, OperatorId.BURN);
    place(foe.p, 60, 0, 50, 0);
    // a reinforced panel, approached from the side where it is open
    const panel = room.world.panels[0]!;
    room.world.reinforcePanel(panel.id);
    const c = { x: 0, y: 0, z: 0 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const id of panel.cellIds) {
      room.world.cellCenter(id, c);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    const wallAlongZ = maxZ - minZ > maxX - minX;
    const px = (minX + maxX) / 2;
    const pz = (minZ + maxZ) / 2;
    const py = panel.cy;
    // stand 1.4 m off the wall on the +x (or +z) side and look at its middle
    const sx = wallAlongZ ? px + 1.4 : px;
    const sz = wallAlongZ ? pz : pz + 1.4;
    const yaw = wallAlongZ ? Math.PI / 2 : 0;
    place(atk.p, sx, 0, sz, yaw);
    atk.p.state.pitch = Math.atan2(py - 1.65, 1.4);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw, pitch: atk.p.state.pitch }, 1);
    const burner = [...room.entities.values()].find((e) => e.kind === EntityKind.BURNER);
    expect(burner).toBeDefined();
    expect(atk.p.gadgetUses).toBe(1);
    const alive = (): number => panel.cellIds.filter((id) => room.world.cellAlive[id]).length;
    const before = alive();
    ms(room, 1500);
    expect(alive()).toBe(before); // still counting down
    ms(room, 2000);
    expect(alive()).toBeLessThan(before);
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.BURNER)).toBe(false);
  });

  it('Rush runs faster and heals for a few seconds with the stim', () => {
    const room = makeRoom({ map: arenaMapText({ nx: 120, nz: 60 }) });
    const atk = addHuman(room, 'Atk', 0);
    const foe = addHuman(room, 'Def', 1);
    forceAction(room);
    pickOp(atk.p, OperatorId.RUSH);
    place(atk.p, 5, 0, 12, EAST);
    place(foe.p, 40, 0, 20, 0);
    atk.p.state.hp = 50;
    const base = operatorDef(OperatorId.RUSH).speedMul;
    ms(room, 100);
    expect(atk.p.state.spdMul).toBeCloseTo(base, 3);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    ms(room, 200);
    expect(atk.p.state.spdMul).toBeCloseTo(base * GADGET.stimSpeed, 3);
    ms(room, 5200);
    expect(atk.p.state.spdMul).toBeCloseTo(base, 3);
    expect(atk.p.state.hp).toBeGreaterThan(70);
    expect(atk.p.gadgetUses).toBe(1);
  });

  it('a Nitro cell sticks where it lands and goes off when the owner presses the button again', () => {
    const room = makeRoom({ map: arenaMapText({ nx: 120, nz: 60 }) });
    addHuman(room, 'Atk', 0);
    const def = addHuman(room, 'Def', 1);
    const foe = addHuman(room, 'Foe', 0);
    forceAction(room);
    pickOp(def.p, OperatorId.NITRO);
    place(def.p, 5, 0, 12, EAST);
    place(foe.p, 14, 0, 12, 0);
    def.p.state.pitch = -0.1;
    feed(room, def.p, { buttons: Btn.GADGET, yaw: EAST, pitch: -0.1 }, 1);
    const cell = [...room.entities.values()].find((e) => e.kind === EntityKind.NITRO)!;
    expect(cell).toBeDefined();
    expect(def.p.charges).toContain(cell.id);
    ms(room, 2000);
    expect(cell.b).toBe(1); // stuck
    const restX = cell.x;
    ms(room, 500);
    expect(cell.x).toBe(restX);
    // park the enemy next to it and blow it
    place(foe.p, cell.x + 1.5, 0, cell.z, 0);
    feed(room, def.p, { buttons: 0, yaw: EAST }, 2);
    feed(room, def.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    expect(foe.p.state.hp).toBeLessThan(60);
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.NITRO)).toBe(false);
  });

  it('a Patch station heals teammates in range, only as long as the supplies last', () => {
    const room = makeRoom({ map: arenaMapText({ nx: 120, nz: 60 }) });
    const def = addHuman(room, 'Def', 1);
    const mate = addHuman(room, 'Mate', 1);
    const foe = addHuman(room, 'Foe', 0);
    forceAction(room);
    pickOp(def.p, OperatorId.PATCH);
    place(def.p, 20, 0, 12, EAST);
    place(mate.p, 10, 0, 40, 0);
    place(foe.p, 50, 0, 40, 0);
    feed(room, def.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    const st = [...room.entities.values()].find((e) => e.kind === EntityKind.STATION)!;
    expect(st).toBeDefined();
    place(mate.p, st.x, 0, st.z, 0);
    place(foe.p, st.x + 1, 0, st.z, 0);
    mate.p.state.hp = 20;
    foe.p.state.hp = 20;
    ms(room, 5000);
    expect(mate.p.state.hp).toBeGreaterThan(45);
    expect(foe.p.state.hp).toBe(20);
    // 120 HP of supplies are used up eventually
    mate.p.state.hp = 1;
    for (let i = 0; i < 6; i++) {
      ms(room, 20000);
      mate.p.state.hp = 1;
      if (![...room.entities.values()].some((e) => e.kind === EntityKind.STATION)) break;
    }
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.STATION)).toBe(false);
  });
});
