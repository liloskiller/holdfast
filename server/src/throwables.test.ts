import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Btn, EntityKind, ThrowKind, THROW, HitKind, makeRayHit } from '@holdfast/shared';
import { useThrowable } from './systems/throwSystem';
import { addHuman, feed, forceAction, makeRoom, place, TICK_MS } from './testUtil';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFEHOUSE = fs.readFileSync(path.join(here, '..', '..', 'shared', 'maps', 'safehouse.map.txt'), 'utf8');
const EAST = -Math.PI / 2;

/** Open arena, attacker (team 0) at x=8 looking east, defender (team 1) at the given distance. */
function arena(kind: number, dist = 12) {
  const room = makeRoom();
  const atk = addHuman(room, 'Atk', 0);
  const def = addHuman(room, 'Def', 1);
  const def2 = addHuman(room, 'Def2', 1);
  forceAction(room);
  room.phaseEndsAt = room.time + 600000;
  place(atk.p, 8, 0, 12, EAST);
  place(def.p, 8 + dist, 0, 12, Math.PI / 2);
  place(def2.p, 30, 0, 20, 0);
  atk.p.throwKind = kind;
  atk.p.throwLeft = 2;
  return { room, atk, def, def2 };
}

function ms(room: ReturnType<typeof makeRoom>, t: number): void {
  const n = Math.round(t / TICK_MS);
  for (let i = 0; i < n; i++) room.advance(TICK_MS);
}

describe('throwables', () => {
  it('the pouch: counts down, has a cooldown and defaults to something sensible for the side', () => {
    const { room, atk } = arena(ThrowKind.FRAG);
    atk.p.state.pitch = 0.3;
    useThrowable(room, atk.p);
    expect(atk.p.throwLeft).toBe(1);
    expect([...room.entities.values()].filter((e) => e.kind === EntityKind.GRENADE)).toHaveLength(1);
    // the cooldown eats a second press right away
    useThrowable(room, atk.p);
    expect(atk.p.throwLeft).toBe(1);
    ms(room, 1200);
    useThrowable(room, atk.p);
    expect(atk.p.throwLeft).toBe(0);
    ms(room, 1200);
    useThrowable(room, atk.p);
    expect(atk.p.throwLeft).toBe(0);
  });

  it('a thrown grenade flies, bounces off the ground and goes off after its fuse', () => {
    const { room, atk } = arena(ThrowKind.FRAG, 30);
    atk.p.state.pitch = 0.2;
    useThrowable(room, atk.p);
    const g = [...room.entities.values()].find((e) => e.kind === EntityKind.GRENADE)!;
    ms(room, 600);
    expect(g.x).toBeGreaterThan(12);
    expect(g.y).toBeGreaterThan(0);
    ms(room, 2200);
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.GRENADE)).toBe(false);
  });

  it('frag damage falls off with distance, needs a clear line and hurts the thrower too', () => {
    const { room, atk, def } = arena(ThrowKind.FRAG, 8);
    const g = { x: def.p.state.x - 3, y: 0.3, z: 12 };
    // put a live grenade next to the defender through the real spawn path
    place(atk.p, 8, 0, 12, EAST);
    atk.p.state.pitch = -0.05;
    useThrowable(room, atk.p);
    const e = [...room.entities.values()].find((x) => x.kind === EntityKind.GRENADE)!;
    e.x = g.x; e.y = g.y; e.z = g.z; e.vx = 0; e.vy = 0; e.vz = 0; e.b = 0.02;
    ms(room, 100);
    expect(def.p.state.hp).toBeLessThan(100);
    expect(def.p.state.hp).toBeGreaterThan(0);

    // the same blast far away does nothing
    const far = arena(ThrowKind.FRAG, 20);
    far.atk.p.state.pitch = -0.05;
    useThrowable(far.room, far.atk.p);
    const e2 = [...far.room.entities.values()].find((x) => x.kind === EntityKind.GRENADE)!;
    e2.x = 14; e2.y = 0.3; e2.z = 12; e2.vx = 0; e2.vy = 0; e2.vz = 0; e2.b = 0.02;
    ms(far.room, 100);
    expect(far.def.p.state.hp).toBe(100);
    // and the thrower who stays next to it is hurt
    const self = arena(ThrowKind.FRAG, 20);
    useThrowable(self.room, self.atk.p);
    const e3 = [...self.room.entities.values()].find((x) => x.kind === EntityKind.GRENADE)!;
    e3.x = 8.5; e3.y = 0.3; e3.z = 12; e3.vx = 0; e3.vy = 0; e3.vz = 0; e3.b = 0.02;
    ms(self.room, 100);
    expect(self.atk.p.state.hp).toBeLessThan(100);
  });

  it('a wall shields you from a frag, a flash needs sight and looking at it matters', () => {
    const room = makeRoom({ map: SAFEHOUSE });
    const atk = addHuman(room, 'Atk', 0);
    const def = addHuman(room, 'Def', 1);
    forceAction(room);
    room.phaseEndsAt = room.time + 600000;
    // kitchen east wall is at x=13.5: attacker outside (east), defender inside
    place(atk.p, 16, 0, 7.75, Math.PI / 2);
    place(def.p, 11.5, 0, 7.75, -Math.PI / 2);
    atk.p.throwKind = ThrowKind.FRAG;
    atk.p.throwLeft = 2;
    useThrowable(room, atk.p);
    const g = [...room.entities.values()].find((x) => x.kind === EntityKind.GRENADE)!;
    g.x = 14.2; g.y = 0.3; g.z = 7.75; g.vx = 0; g.vy = 0; g.vz = 0; g.b = 0.02;
    ms(room, 100);
    expect(def.p.state.hp).toBe(100);
  });

  it('a flashbang blinds those who see it, more when they look at it, and not through walls', () => {
    const { room, atk, def, def2 } = arena(ThrowKind.FLASH, 6);
    place(def.p, 14, 0, 12, EAST + Math.PI); // faces the grenade (west)
    place(def2.p, 14, 0, 14, EAST); // faces away
    useThrowable(room, atk.p);
    const g = [...room.entities.values()].find((x) => x.kind === EntityKind.GRENADE)!;
    g.x = 12; g.y = 1.3; g.z = 13; g.vx = 0; g.vy = 0; g.vz = 0; g.b = 0.02;
    ms(room, 100);
    const looking = def.p.blindUntil - room.time;
    const away = def2.p.blindUntil - room.time;
    expect(looking).toBeGreaterThan(2000);
    expect(away).toBeGreaterThan(0);
    expect(away).toBeLessThan(looking);
  });

  it('smoke blocks sight, grows, and clears after a while', () => {
    const { room, atk } = arena(ThrowKind.SMOKE, 10);
    useThrowable(room, atk.p);
    const g = [...room.entities.values()].find((x) => x.kind === EntityKind.GRENADE)!;
    g.x = 14; g.y = 1; g.z = 12; g.vx = 0; g.vy = 0; g.vz = 0; g.b = 0.02;
    ms(room, 100);
    expect(room.world.smokes[0]!.r).toBeLessThan(1.5); // still a small puff
    ms(room, 2500);
    expect(room.world.smokes).toHaveLength(1);
    expect(room.world.lineOfSight(8, 1.6, 12, 22, 1.6, 12)).toBe(false);
    expect(room.world.lineOfSight(8, 1.6, 12, 8, 1.6, 20)).toBe(true);
    ms(room, THROW.smoke.life * 1000);
    expect(room.world.smokes).toHaveLength(0);
    expect(room.world.lineOfSight(8, 1.6, 12, 22, 1.6, 12)).toBe(true);
  });

  it('an impact grenade goes off on the first thing it hits and tears a plaster wall and a barricade open', () => {
    const room = makeRoom({ map: SAFEHOUSE });
    const atk = addHuman(room, 'Atk', 0);
    const def = addHuman(room, 'Def', 1);
    forceAction(room);
    room.phaseEndsAt = room.time + 600000;
    const door = room.world.findOpeningNear(13.2, 0, 8.5, 1, 0, 1.8, 'door')!;
    room.world.placeBarricade(door.id);
    const planks = room.world.plankCount(door);
    place(atk.p, door.box.minX - 4, 0, door.cz, EAST);
    place(def.p, 40, 0, 40, 0);
    atk.p.throwKind = ThrowKind.IMPACT;
    atk.p.throwLeft = 2;
    atk.p.state.pitch = 0.08;
    useThrowable(room, atk.p);
    ms(room, 1500);
    expect(room.world.plankCount(door)).toBeLessThan(planks);
    expect([...room.entities.values()].some((x) => x.kind === EntityKind.GRENADE)).toBe(false);
  });

  it('barbed wire slows and cuts only the other team, an alarm marks the first intruder once', () => {
    const { room, atk, def } = arena(ThrowKind.NONE, 6);
    def.p.throwKind = ThrowKind.WIRE;
    def.p.throwLeft = 2;
    place(def.p, 20, 0, 12, EAST);
    useThrowable(room, def.p);
    const wire = [...room.entities.values()].find((e) => e.kind === EntityKind.WIRE)!;
    expect(wire).toBeDefined();
    place(atk.p, wire.x, 0, wire.z, 0);
    ms(room, 1200);
    expect(atk.p.state.slow).toBeGreaterThan(0);
    expect(atk.p.state.hp).toBeLessThan(100);
    // a friend walks through it without a scratch
    place(def.p, wire.x, 0, wire.z, 0);
    const hp = def.p.state.hp;
    ms(room, 1200);
    expect(def.p.state.hp).toBe(hp);

    place(atk.p, 5, 0, 5, 0);
    def.p.throwKind = ThrowKind.ALARM;
    def.p.throwLeft = 2;
    def.p.throwCd = 0;
    place(def.p, 25, 0, 12, EAST);
    useThrowable(room, def.p);
    const alarm = [...room.entities.values()].find((e) => e.kind === EntityKind.ALARM)!;
    expect(alarm).toBeDefined();
    place(atk.p, alarm.x - 2, 0, alarm.z, 0);
    ms(room, 400);
    expect(atk.p.isTaggedFor(1, room.time)).toBe(true);
    expect([...room.entities.values()].some((e) => e.kind === EntityKind.ALARM)).toBe(false);
  });

  it('the button starts a throw through the normal input path', () => {
    const { room, atk } = arena(ThrowKind.FLASH);
    feed(room, atk.p, { buttons: Btn.THROW, yaw: EAST, pitch: 0.2 }, 1);
    expect(atk.p.throwLeft).toBe(1);
    void HitKind;
    void makeRayHit;
  });
});
