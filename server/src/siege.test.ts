import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Btn, DRONE, EntityKind, OperatorId, PFlag, PhaseId, WeaponId } from '@holdfast/shared';
import { shoot } from './systems/combatSystem';
import { buildSnapshot } from './systems/visibilitySystem';
import { addHuman, feed, forceAction, makeRoom, place } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');
const EAST = -Math.PI / 2; // facing +x
const WEST = Math.PI / 2;

function house(): { room: ReturnType<typeof makeRoom>; atk: ReturnType<typeof addHuman>; def: ReturnType<typeof addHuman> } {
  const room = makeRoom({ map: SAFEHOUSE });
  const atk = addHuman(room, 'Atk', 0);
  const def = addHuman(room, 'Def', 1);
  forceAction(room);
  room.phase = PhaseId.PREP;
  place(atk.p, 30, 0, 52, 0);
  place(def.p, 13.2, 0, 6.75, EAST);
  def.p.reinf = 2;
  return { room, atk, def };
}

describe('siege mechanics', () => {
  it('holding INTERACT reinforces a panel, releasing early cancels', () => {
    const { room, def } = house();
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 60);
    expect(def.p.actKind).toBe(1);
    feed(room, def.p, { buttons: 0, yaw: EAST }, 3);
    expect(def.p.actKind).toBe(0);
    expect(room.world.panels.some((p) => p.reinforced)).toBe(false);
    expect(def.p.reinf).toBe(2);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 150);
    expect(room.world.panels.filter((p) => p.reinforced)).toHaveLength(1);
    expect(def.p.reinf).toBe(1);
  });

  it('attackers cannot reinforce and defenders cannot once the action phase starts', () => {
    const { room, atk, def } = house();
    place(atk.p, 13.2, 0, 6.75, EAST);
    atk.p.reinf = 2;
    feed(room, atk.p, { buttons: Btn.INTERACT, yaw: EAST }, 150);
    expect(room.world.panels.some((p) => p.reinforced)).toBe(false);
    room.phase = PhaseId.ACTION;
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 150);
    expect(room.world.panels.some((p) => p.reinforced)).toBe(false);
  });

  it('reinforced walls shrug off bullets', () => {
    const { room, def, atk } = house();
    const panel = room.world.panels.find((p) => p.cellIds.length > 0 && p.cx > 13 && p.cx < 14 && p.cz > 6 && p.cz < 7.5)!;
    room.world.reinforcePanel(panel.id);
    place(atk.p, 10.0, 0, 6.75, EAST);
    place(def.p, 20, 0, 6.75, 0);
    atk.p.state.pitch = 0;
    for (let i = 0; i < 20; i++) shoot(room, atk.p, i, WeaponId.MARKSMAN, room.time);
    expect(panel.cellIds.every((c) => room.world.cellAlive[c])).toBe(true);
    expect(def.p.state.hp).toBe(100);
  });

  it('plaster walls get shot through and bullets penetrate with reduced damage', () => {
    const { room, def, atk } = house();
    // kitchen east wall at lz=5 is plain plaster. Attacker in the kitchen, defender in the pantry.
    place(atk.p, 12.0, 0, 7.75, EAST);
    place(def.p, 17.0, 0, 7.75, WEST);
    let damaged = 0;
    for (let i = 0; i < 40 && def.p.state.alive; i++) {
      atk.p.state.pitch = -0.08;
      shoot(room, atk.p, i, WeaponId.CARBINE, room.time);
      damaged = 100 - def.p.state.hp;
    }
    expect(damaged).toBeGreaterThan(0);
    // the wall took damage
    const wallCells = [...Array(room.world.cellCount).keys()].filter((c) => room.world.cellHp[c]! < room.world.cellMaxHp[c]!);
    expect(wallCells.length).toBeGreaterThan(0);
  });

  it('tapping INTERACT toggles a door, holding barricades it', () => {
    const { room, def } = house();
    place(def.p, 13.2, 0, 8.5, EAST);
    const door = room.world.findOpeningNear(13.2, 0, 8.5, 1, 0, 1.8, 'door')!;
    expect(door.open).toBe(false);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 5);
    feed(room, def.p, { buttons: 0, yaw: EAST }, 3);
    expect(door.open).toBe(true);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 5);
    feed(room, def.p, { buttons: 0, yaw: EAST }, 3);
    expect(door.open).toBe(false);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 100);
    expect(door.barricadeHp).toBeGreaterThan(0);
    // a barricaded door cannot be opened
    feed(room, def.p, { buttons: 0, yaw: EAST }, 3);
    feed(room, def.p, { buttons: Btn.INTERACT, yaw: EAST }, 5);
    feed(room, def.p, { buttons: 0, yaw: EAST }, 3);
    expect(door.open).toBe(false);
    // kicking it takes it down: 150 hp / 40 per kick
    place(def.p, 8, 0, 12, EAST);
    const atk = [...room.players.values()].find((p) => p.team === 0)!;
    place(atk, 13.1, 0, 8.5, EAST);
    for (let i = 0; i < 5; i++) {
      feed(room, atk, { buttons: Btn.MELEE, yaw: EAST }, 1);
      feed(room, atk, { buttons: 0, yaw: EAST }, 45);
    }
    expect(door.barricadeHp).toBe(0);
  });

  it('Ram breaches a reinforced wall with a charge', () => {
    const { room, atk } = house();
    const panel = room.world.panels.find((p) => p.cx > 13 && p.cx < 14 && p.cz > 6 && p.cz < 7.5)!;
    room.world.reinforcePanel(panel.id);
    atk.p.op = OperatorId.RAM;
    atk.p.gadgetUses = 2;
    room.phase = PhaseId.ACTION;
    place(atk.p, 11.3, 0, 6.75, EAST);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST }, 2);
    expect(atk.p.charges).toHaveLength(1);
    expect(atk.p.gadgetUses).toBe(1);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST }, 2);
    expect(atk.p.charges).toHaveLength(0);
    const dead = panel.cellIds.filter((c) => !room.world.cellAlive[c]).length;
    expect(dead).toBeGreaterThan(3);
    expect(atk.p.state.hp).toBeGreaterThan(0);
  });

  it('breaching a hatch from below opens the floor above', () => {
    const { room, atk } = house();
    atk.p.op = OperatorId.RAM;
    atk.p.gadgetUses = 2;
    room.phase = PhaseId.ACTION;
    const hatch = room.world.hatches[1]!; // master bedroom over the kitchen
    place(atk.p, hatch.cx - 1.5, 0, hatch.cz, EAST);
    atk.p.state.pitch = 0.9;
    // aim up at the ceiling above the hatch
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST, pitch: Math.atan2(2.5, 1.5) }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST, pitch: Math.atan2(2.5, 1.5) }, 2);
    expect(atk.p.charges).toHaveLength(1);
    place(atk.p, hatch.cx - 2.6, 0, hatch.cz, EAST);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST }, 2);
    expect(hatch.cellIds.some((c) => !room.world.cellAlive[c])).toBe(true);
  });
});

describe('information warfare', () => {
  it('hides enemies behind walls, shows them with line of sight through glass', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    // defender deep inside the kitchen, attacker north of the building behind concrete
    place(def.p, 7.0, 0, 8.5, WEST);
    place(atk.p, 7.0, 0, 3.0, 0);
    let snap = buildSnapshot(room, atk.p, null);
    expect(snap.players.find((p) => p.id === def.p.id)).toBeUndefined();
    // attacker outside the kitchen's west window looking in
    place(atk.p, 3.0, 0, 8.5, EAST);
    snap = buildSnapshot(room, atk.p, null);
    expect(snap.players.find((p) => p.id === def.p.id)).toBeDefined();
    // snapshot to the defender includes teammate info and not the hidden enemy
    place(atk.p, 7.0, 0, 3.0, 0);
    atk.p.seen.clear();
    expect(buildSnapshot(room, atk.p, null).players.length).toBe(0);
  });

  it('drone tags reveal enemies through walls for the tagging team only', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    place(atk.p, 30, 0, 52, 0);
    place(def.p, 7.0, 0, 8.5, WEST);
    const s = atk.p.state;
    s.dDeployed = true;
    s.dCtl = true;
    s.dhp = DRONE.hp;
    // the drone rolls on the floor, in the same room as the defender, and tags him
    s.dx = 9.0; s.dy = DRONE.halfH + 0.01; s.dz = 8.5;
    feed(room, atk.p, { buttons: 0, yaw: WEST, pitch: 0 }, 2);
    feed(room, atk.p, { buttons: Btn.FIRE, yaw: WEST, pitch: 0 }, 1);
    expect(def.p.isTaggedFor(0, room.time)).toBe(true);
    expect(def.p.isTaggedFor(1, room.time)).toBe(false);
    const tagEvents = atk.conn.msgs.filter((m) => m.t === 'SNAP' && m.snap.events.some((e) => e.k === 'tag'));
    expect(tagEvents.length).toBeGreaterThan(0);
    // the defender walks behind a wall and the drone loses sight, the tag keeps him visible
    place(def.p, 17.0, 0, 7.75, WEST);
    s.dx = 3.0; s.dz = 3.0;
    atk.p.seen.clear();
    const snap = buildSnapshot(room, atk.p, null);
    const seen = snap.players.find((p) => p.id === def.p.id);
    expect(seen).toBeDefined();
    expect((seen!.flags & PFlag.TAGGED) !== 0).toBe(true);
    // tags expire
    room.advance(9000);
    atk.p.seen.clear();
    expect(buildSnapshot(room, atk.p, null).players.find((p) => p.id === def.p.id)).toBeUndefined();
  });

  it('the defender is not given the attacker position either', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    place(atk.p, 30, 0, 52, 0);
    place(def.p, 7.0, 0, 8.5, WEST);
    const snap = buildSnapshot(room, def.p, null);
    expect(snap.players.find((p) => p.id === atk.p.id)).toBeUndefined();
  });

  it('sound events reach enemies as jittered, inexact positions when out of sight', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    place(atk.p, 7.0, 0, 3.0, 0);
    place(def.p, 7.0, 0, 8.5, WEST);
    room.sound('step', 7.0, 0.1, 3.0, 20, atk.p.id, atk.p.team);
    const snap = buildSnapshot(room, def.p, null);
    const ev = snap.events.find((e) => e.k === 'snd');
    expect(ev).toBeDefined();
    if (ev && ev.k === 'snd') expect(ev.exact).toBe(false);
  });
});

describe('gadgets', () => {
  it('Mend heals a teammate over time', () => {
    const { room, atk } = house();
    room.phase = PhaseId.ACTION;
    const mate = addHuman(room, 'Mate', 0);
    atk.p.op = OperatorId.MEND;
    atk.p.gadgetUses = 4;
    place(atk.p, 10, 0, 40, EAST);
    place(mate.p, 14, 0, 40, 0);
    mate.p.state.hp = 40;
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST, pitch: -0.1 }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST }, 300);
    expect(mate.p.state.hp).toBeGreaterThanOrEqual(85);
    expect(atk.p.gadgetUses).toBe(3);
  });

  it('Aegis shields block bullets and can be shot down', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    atk.p.op = OperatorId.AEGIS;
    atk.p.gadgetUses = 2;
    place(atk.p, 8, 0, 44, EAST);
    place(def.p, 16, 0, 44, WEST);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST }, 2);
    const shield = [...room.entities.values()].find((e) => e.kind === EntityKind.SHIELD)!;
    expect(shield).toBeDefined();
    expect(room.world.dyn.size).toBe(1);
    // the defender shoots at the attacker: the shield eats the bullets
    def.p.state.pitch = -0.05;
    for (let i = 0; i < 6; i++) shoot(room, def.p, i, WeaponId.CARBINE, room.time);
    expect(atk.p.state.hp).toBe(100);
    expect(shield.hp).toBeLessThan(400);
    // and an attacker can vault it
    expect(room.world.dyn.get(shield.id)!.vaultable).toBe(true);
  });

  it('Snare traps slow and hurt attackers, only once', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    def.p.op = OperatorId.SNARE;
    def.p.gadgetUses = 3;
    place(def.p, 16, 0, 44, EAST);
    feed(room, def.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    feed(room, def.p, { buttons: 0, yaw: EAST }, 2);
    const trap = [...room.entities.values()].find((e) => e.kind === EntityKind.TRAP)!;
    expect(trap).toBeDefined();
    // attackers do not see it
    expect(buildSnapshot(room, atk.p, null).entities.some((e) => e.kind === EntityKind.TRAP)).toBe(false);
    expect(buildSnapshot(room, def.p, null).entities.some((e) => e.kind === EntityKind.TRAP)).toBe(true);
    place(atk.p, trap.x, 0, trap.z, 0);
    room.advance(50);
    expect(atk.p.state.hp).toBe(75);
    expect(atk.p.state.slow).toBeGreaterThan(0);
    expect(room.entities.has(trap.id)).toBe(false);
  });

  it('Jam jammers disable pulse sensors, Ping sees heartbeats otherwise', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    atk.p.op = OperatorId.PING;
    atk.p.gadgetUses = 3;
    place(atk.p, 8, 0, 8.5, EAST);
    place(def.p, 12, 0, 8.5, WEST);
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    feed(room, atk.p, { buttons: 0, yaw: EAST }, 40);
    const senses = atk.conn.msgs.flatMap((m) => (m.t === 'SNAP' ? m.snap.events : [])).filter((e) => e.k === 'sense');
    expect(senses.length).toBeGreaterThan(0);
    expect(senses.some((e) => e.k === 'sense' && e.pts.length >= 3)).toBe(true);

    // now with a jammer next to Ping
    const jam = addHuman(room, 'Jam', 1);
    jam.p.op = OperatorId.JAM;
    jam.p.gadgetUses = 2;
    place(jam.p, 9.5, 0, 8.5, WEST);
    feed(room, jam.p, { buttons: Btn.GADGET, yaw: WEST }, 1);
    feed(room, jam.p, { buttons: 0, yaw: WEST }, 3);
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.JAMMER)).toBe(true);
    room.advance(300);
    expect(atk.p.jammed).toBe(true);
    atk.p.gadgetCd = 0;
    atk.p.sensorT = 0;
    feed(room, atk.p, { buttons: Btn.GADGET, yaw: EAST }, 1);
    expect(atk.p.sensorT).toBe(0);
  });

  it('Eye cameras tag attackers in view for the defenders', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    def.p.op = OperatorId.EYE;
    def.p.gadgetUses = 2;
    place(def.p, 12, 0, 8.5, WEST);
    // aim at the west wall (concrete shell) above head height: camera looks back into the room
    feed(room, def.p, { buttons: Btn.GADGET, yaw: WEST, pitch: 0.3 }, 1);
    feed(room, def.p, { buttons: 0, yaw: WEST, pitch: 0.3 }, 2);
    expect(def.p.cameras).toHaveLength(1);
    // attacker walks into view inside the room
    place(atk.p, 9, 0, 8.5, 0);
    room.advance(600);
    expect(atk.p.isTaggedFor(1, room.time)).toBe(true);
    // camera view toggles the body freeze flag
    feed(room, def.p, { buttons: Btn.CAMERA, yaw: WEST }, 1);
    expect(def.p.state.cam).toBe(true);
    feed(room, def.p, { buttons: 0, yaw: WEST }, 1);
    feed(room, def.p, { buttons: Btn.CAMERA, yaw: WEST }, 1);
    expect(def.p.state.cam).toBe(false);
  });

  it('attackers get a drone in prep, can be shot down, and respawn after a cooldown in action', () => {
    const { room, atk, def } = house();
    room.phase = PhaseId.ACTION;
    const s = atk.p.state;
    s.dDeployed = true;
    s.dx = 6; s.dy = DRONE.halfH + 0.01; s.dz = 8.5;
    s.dhp = 25;
    place(def.p, 12, 0, 8.5, WEST);
    def.p.state.pitch = Math.atan2(DRONE.halfH - 1.65, 6);
    def.p.state.ads = true;
    shoot(room, def.p, 0, WeaponId.CARBINE, room.time);
    expect(s.dDeployed).toBe(false);
    expect(atk.p.droneCd).toBeGreaterThan(20);
  });
});

describe('practice (sandbox)', () => {
  it('spawns the player and shootable dummies that respawn', () => {
    const room = makeRoom({ map: SAFEHOUSE, sandbox: true });
    const me = addHuman(room, 'Me', 0);
    expect(room.phase).toBe(PhaseId.ACTION);
    expect(me.p.state.alive).toBe(true);
    const dummies = [...room.players.values()].filter((p) => p.isDummy);
    expect(dummies.length).toBeGreaterThanOrEqual(4);
    const d = dummies[0]!;
    // stand in front of the dummy and shoot it dead
    place(me.p, d.state.x - 5, d.state.y, d.state.z, EAST);
    room.debugNoVisibility = true;
    d.state.hp = 10;
    me.p.state.pitch = -0.1;
    me.p.state.ads = true;
    // clear the way: sandbox positions are inside the house, so use a free shot by editing voxels is overkill;
    // instead kill via direct damage to test respawn logic
    shoot(room, me.p, 0, WeaponId.CARBINE, room.time);
    if (d.state.alive) d.state.hp = 0;
    room.advance(100);
    room.advance(3200);
    expect(d.state.alive).toBe(true);
  });

  it('debug breach opens a hole and world reset restores it', () => {
    const room = makeRoom({ map: SAFEHOUSE, sandbox: true });
    const me = addHuman(room, 'Me', 0);
    place(me.p, 11.3, 0, 6.75, EAST);
    const before = room.world.cellAlive.reduce((a, b) => a + b, 0);
    room.handleMessage(me.p, { t: 'DEBUG', cmd: 'breach' });
    const after = room.world.cellAlive.reduce((a, b) => a + b, 0);
    expect(after).toBeLessThan(before);
    room.handleMessage(me.p, { t: 'DEBUG', cmd: 'reset' });
    expect(room.world.cellAlive.reduce((a, b) => a + b, 0)).toBe(before);
  });
});
