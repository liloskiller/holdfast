// Computer controlled players. A bot is a normal Player whose input commands are produced here every
// tick, so it obeys exactly the same movement, weapon, recoil and hit rules as a human. It has no
// special senses: it sees what has line of sight inside its field of view and hears sounds that reach it.

import {
  Btn, FLOOR_H, NavGrid, OperatorId, PhaseId, SIEGE, SIM_DT, TILE, clamp, eyeHeight, makeCmd, operatorDef,
  quantizeCmd, wrapAngle, weaponDef, type InputCmd, type NavPath,
} from '@holdfast/shared';
import type { Player } from '../Player';
import type { Room, SoundRec } from '../Room';
import { applyPick } from '../systems/roundSystem';
import { BOT_SKILLS, BotMind, type BotSkill, type BotTask } from './BotMind';

const THINK_EVERY = 6; // ticks between perception / decision updates (10 Hz)
const TURN_EASE = 14;
const NAV_CACHE = new WeakMap<Room, NavGrid>();
const vaultTmp = { x: 0, y: 0, z: 0 };

const ATTACK_OPS = [OperatorId.RECRUIT_A, OperatorId.PING, OperatorId.AEGIS, OperatorId.RAM, OperatorId.MEND];
const DEFEND_OPS = [OperatorId.RECRUIT_D, OperatorId.WARDEN, OperatorId.SNARE, OperatorId.JAM, OperatorId.EYE];

const NAMES = [
  'Vega', 'Rook', 'Sable', 'Quill', 'Marlow', 'Tern', 'Brick', 'Nova', 'Cinder', 'Hale',
  'Juno', 'Pike', 'Wren', 'Atlas', 'Moss', 'Drift', 'Echo', 'Flint', 'Gale', 'Onyx',
];

function navFor(room: Room): NavGrid {
  let n = NAV_CACHE.get(room);
  if (!n) {
    n = new NavGrid(room.world);
    NAV_CACHE.set(room, n);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Creating bots
// ---------------------------------------------------------------------------

/** Add a bot to a team. Returns null when the room is full. */
export function addBot(room: Room, team: 0 | 1, difficulty: number): Player | null {
  const taken = new Set(room.humans().map((p) => p.name));
  let name = '';
  const start = Math.floor(room.rand() * NAMES.length);
  for (let i = 0; i < NAMES.length; i++) {
    const n = 'Bot ' + (NAMES[(start + i) % NAMES.length] as string);
    if (!taken.has(n)) {
      name = n;
      break;
    }
  }
  if (!name) name = 'Bot ' + room.nextPlayerId;
  const p = room.addBotPlayer(name, team);
  if (!p) return null;
  const skill = BOT_SKILLS[clamp(Math.round(difficulty), 0, BOT_SKILLS.length - 1)] as BotSkill;
  p.bot = new BotMind(0x9e3779b1 ^ (p.id * 7919) ^ Math.floor(room.rand() * 1e9), skill);
  return p;
}

// ---------------------------------------------------------------------------
// Per tick
// ---------------------------------------------------------------------------

export function updateBots(room: Room): void {
  for (const p of room.players.values()) {
    if (!p.isBot || !p.bot) continue;
    const m = p.bot;
    if (room.phase === PhaseId.OPERATOR_SELECT) {
      handlePicking(room, p, m);
      continue;
    }
    if (!p.state.alive || (room.phase !== PhaseId.PREP && room.phase !== PhaseId.ACTION)) {
      m.target = null;
      continue;
    }
    drive(room, p, m);
  }
}

function sideOf(room: Room, p: Player): 'attack' | 'defend' {
  return p.team === room.attackerTeam ? 'attack' : 'defend';
}

function handlePicking(room: Room, p: Player, m: BotMind): void {
  if (p.picked) return;
  if (m.pickAt === 0) m.pickAt = room.time + 900 + m.rng.next() * 4500;
  if (room.time < m.pickAt && room.phaseEndsAt - room.time > 2500) return;
  const list = [...(sideOf(room, p) === 'attack' ? ATTACK_OPS : DEFEND_OPS)];
  m.rng.shuffle(list);
  for (const op of list) {
    const def = operatorDef(op);
    const primary = m.rng.pick(def.primaries);
    const secondary = m.rng.pick(def.secondaries);
    if (applyPick(room, p, op, primary, false, secondary) === null) {
      m.pickAt = 0;
      return;
    }
  }
  // every unique operator is taken: fall back to the recruit
  const fallback = sideOf(room, p) === 'attack' ? OperatorId.RECRUIT_A : OperatorId.RECRUIT_D;
  applyPick(room, p, fallback, operatorDef(fallback).primaries[0], true);
}

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

function eyeY(p: Player): number {
  return p.state.y + eyeHeight(p.state);
}

function canSee(room: Room, p: Player, o: Player): boolean {
  const s = p.state;
  const t = o.state;
  const ey = eyeY(p);
  const h = eyeHeight(t);
  const w = room.world;
  return w.lineOfSight(s.x, ey, s.z, t.x, t.y + h - 0.1, t.z) || w.lineOfSight(s.x, ey, s.z, t.x, t.y + h * 0.55, t.z);
}

function perceive(room: Room, p: Player, m: BotMind): void {
  const s = p.state;
  const now = room.time / 1000;
  let best: Player | null = null;
  let bestD = Infinity;
  for (const o of room.players.values()) {
    if (o.team === p.team || !o.state.alive) continue;
    if (o.isDummy && !room.sandbox) continue;
    const dx = o.state.x - s.x;
    const dz = o.state.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > m.skill.sight || Math.abs(o.state.y - s.y) > 4.5) continue;
    // standing still in the dark corner of the eye is harder to notice than something that moves
    const moving = Math.hypot(o.state.vx, o.state.vz) > 1.2;
    if (!moving && d > m.skill.sight * 0.6) continue;
    if (d > 3.5) {
      const bearing = Math.atan2(-dx, -dz);
      if (Math.abs(wrapAngle(bearing - m.yaw)) > 1.3) continue;
    }
    if (!canSee(room, p, o)) continue;
    // keep the current target while it stays visible and is not much farther than another one
    const score = d - (o === m.target ? 3 : 0);
    if (score < bestD) {
      bestD = score;
      best = o;
    }
  }
  if (best) {
    if (best !== m.target) m.targetSince = now;
    m.target = best;
    m.lastSeenX = best.state.x;
    m.lastSeenY = best.state.y;
    m.lastSeenZ = best.state.z;
    m.lastSeenT = now;
  } else if (m.target) {
    // lost sight: remember where we last saw it
    m.target = null;
  }
}

function hear(room: Room, p: Player, m: BotMind): void {
  const s = p.state;
  const now = room.time / 1000;
  let latest = m.lastSerial;
  for (const snd of room.sounds as SoundRec[]) {
    if (snd.serial <= m.lastSerial) continue;
    if (snd.serial > latest) latest = snd.serial;
    if (snd.team === p.team || snd.src === p.id) continue;
    if (snd.s === 'ping' || snd.s === 'gadget') continue;
    const d = Math.hypot(snd.x - s.x, snd.y - s.y, snd.z - s.z);
    // sound carries less far through floors
    const reach = snd.radius * (Math.abs(snd.y - s.y) > 2 ? 0.6 : 1);
    if (d > reach) continue;
    // an alert far from the current one is only taken when nothing fresher is known
    if (now - m.alertT < 1.5 && Math.hypot(snd.x - m.alertX, snd.z - m.alertZ) < 4) continue;
    const jit = Math.min(3, d * 0.12);
    m.alertX = snd.x + (m.rng.next() - 0.5) * 2 * jit;
    m.alertZ = snd.z + (m.rng.next() - 0.5) * 2 * jit;
    m.alertT = now;
  }
  m.lastSerial = latest;
  // being shot by something unseen turns the bot toward the shooter
  if (s.hp < m.lastHp - 0.5 && p.lastDamageFrom) {
    const a = room.players.get(p.lastDamageFrom);
    if (a && a.state.alive) {
      m.alertX = a.state.x;
      m.alertZ = a.state.z;
      m.alertT = now;
    }
  }
  m.lastHp = s.hp;
}

// ---------------------------------------------------------------------------
// Round plans: defenders reinforce and barricade, everyone picks a place to be
// ---------------------------------------------------------------------------

function siteCenter(room: Room): { x: number; y: number; z: number; floor: number } | null {
  const site = room.map.objectives[room.objectiveIdx];
  if (!site) return null;
  return { x: (site.minX + site.maxX) / 2, y: site.y, z: (site.minZ + site.maxZ) / 2, floor: site.floor };
}

/** Claims shared between bots of one room so two defenders do not reinforce the same wall. */
const CLAIMS = new WeakMap<Room, { round: number; panels: Set<number>; openings: Set<number> }>();

function claimsFor(room: Room): { round: number; panels: Set<number>; openings: Set<number> } {
  let c = CLAIMS.get(room);
  if (!c || c.round !== room.round) {
    c = { round: room.round, panels: new Set(), openings: new Set() };
    CLAIMS.set(room, c);
  }
  return c;
}

/** A walkable node from which a point on a wall can be worked on. */
function standNode(room: Room, nav: NavGrid, x: number, y: number, z: number, floorY: number): number {
  let best = -1;
  let bestScore = Infinity;
  const b = room.map.building;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (const r of [1.2, 1.6]) {
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const node = nav.nearest(px, floorY, pz, 1);
      if (node < 0) continue;
      const pos = { x: 0, y: 0, z: 0 };
      nav.posOf(node, pos);
      const d = Math.hypot(pos.x - x, pos.z - z);
      if (d > 1.9 || d < 0.6) continue;
      // the work point is inside the wall, so test sight to the surface on this side of it
      const ux = pos.x - x;
      const uz = pos.z - z;
      const ul = Math.hypot(ux, uz) || 1;
      if (!room.world.lineOfSight(pos.x, floorY + 1.55, pos.z, x + (ux / ul) * 0.4, y, z + (uz / ul) * 0.4)) continue;
      const inside = pos.x >= b.x0 * TILE && pos.x <= b.x1 * TILE && pos.z >= b.z0 * TILE && pos.z <= b.z1 * TILE;
      const score = (inside ? 0 : 5) + Math.abs(d - 1.4);
      if (score < bestScore) {
        bestScore = score;
        best = node;
      }
    }
  }
  return best;
}

function planRound(room: Room, p: Player, m: BotMind): void {
  m.planned = room.round;
  m.tasks = [];
  m.task = null;
  m.target = null;
  m.path = null;
  m.goalNode = -1;
  m.anchorNode = -1;
  m.nextRoamAt = 0;
  const nav = navFor(room);
  const site = siteCenter(room);
  const defender = sideOf(room, p) === 'defend';
  if (defender && site) {
    const claims = claimsFor(room);
    const floorY = site.floor * FLOOR_H;
    // reinforce the walls closest to the objective
    const panels = room.world.panels
      .filter((pn) => pn.floor === site.floor && !pn.reinforced && pn.cellIds.length > 0 && !claims.panels.has(pn.id))
      .map((pn) => ({ pn, d: Math.hypot(pn.cx - site.x, pn.cz - site.z) }))
      .filter((e) => e.d < 12)
      .sort((a, b) => a.d - b.d);
    for (const e of panels) {
      if (m.tasks.filter((t) => t.kind === 'reinforce').length >= p.reinf) break;
      const node = standNode(room, nav, e.pn.cx, e.pn.cy, e.pn.cz, floorY);
      if (node < 0) continue;
      claims.panels.add(e.pn.id);
      m.tasks.push({ kind: 'reinforce', id: e.pn.id, node, fx: e.pn.cx, fy: e.pn.cy, fz: e.pn.cz, workedFor: 0 });
    }
    // barricade a couple of the doors that lead to it
    const openings = room.world.openings
      .filter((op) => op.floor === site.floor && !op.destroyed && op.barricadeHp <= 0 && !claims.openings.has(op.id))
      .map((op) => ({ op, d: Math.hypot(op.cx - site.x, op.cz - site.z) }))
      .filter((e) => e.d < 16)
      .sort((a, b) => a.d - b.d);
    for (const e of openings) {
      if (m.tasks.filter((t) => t.kind === 'barricade').length >= 2) break;
      const node = standNode(room, nav, e.op.cx, floorY + 1.2, e.op.cz, floorY);
      if (node < 0) continue;
      claims.openings.add(e.op.id);
      m.tasks.push({ kind: 'barricade', id: e.op.id, node, fx: e.op.cx, fy: floorY + 1.2, fz: e.op.cz, workedFor: 0 });
    }
    m.anchorNode = nav.randomNear(site.x, site.y, site.z, 5, () => m.rng.next());
  }
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

interface Wish {
  buttons: number;
  moveX: number;
  moveZ: number;
}

function drive(room: Room, p: Player, m: BotMind): void {
  const s = p.state;
  const now = room.time / 1000;
  if (!m.yawInit) {
    m.yaw = s.yaw;
    m.pitch = 0;
    m.yawInit = true;
    m.lastProgX = s.x;
    m.lastProgZ = s.z;
    m.lastProgT = now;
  }
  if (m.planned !== room.round) planRound(room, p, m);

  if ((room.tick + p.id) % THINK_EVERY === 0) {
    perceive(room, p, m);
    hear(room, p, m);
    decide(room, p, m, now);
  } else if (m.target && !m.target.state.alive) {
    m.target = null;
  }

  const wish: Wish = { buttons: 0, moveX: 0, moveZ: 0 };
  steer(room, p, m, now, wish);
  aimAndShoot(p, m, now, wish);
  handleWeapon(p, m, now, wish);

  const cmd: InputCmd = makeCmd();
  cmd.seq = ++p.lastQueuedSeq;
  cmd.dt = SIM_DT;
  cmd.moveX = wish.moveX;
  cmd.moveZ = wish.moveZ;
  cmd.yaw = m.yaw;
  cmd.pitch = m.pitch;
  cmd.buttons = wish.buttons;
  cmd.clientTime = 0; // no lag compensation rewind: a bot is on the server clock
  cmd.slot = s.slot;
  if (m.wantSlot !== undefined) cmd.slot = m.wantSlot;
  quantizeCmd(cmd);
  p.queue.push(cmd);
  if (p.queue.length > 6) p.queue.splice(0, p.queue.length - 6);
}

// ----- decisions at 10 Hz: where to go, what to do -----

function decide(room: Room, p: Player, m: BotMind, now: number): void {
  const s = p.state;
  const attacker = sideOf(room, p) === 'attack';
  const nav = navFor(room);
  const site = siteCenter(room);
  m.mode = 'move';
  m.wantAds = false;

  if (m.target) {
    m.mode = 'fight';
    return;
  }

  // chase the last known position for a few seconds after losing sight
  if (now - m.lastSeenT < 4 && m.lastSeenT > 0) {
    m.mode = 'search';
    setGoal(room, p, m, m.lastSeenX, m.lastSeenY, m.lastSeenZ, now);
    return;
  }

  // PREP tasks of defenders
  if (room.phase === PhaseId.PREP && !attacker && m.tasks.length) {
    if (!m.task) m.task = m.tasks[0] as BotTask;
    const t = m.task;
    const pos = { x: 0, y: 0, z: 0 };
    nav.posOf(t.node, pos);
    const dist = Math.hypot(pos.x - s.x, pos.z - s.z);
    m.mode = dist < 0.55 ? 'work' : 'move';
    if (dist >= 0.55) setGoalNode(room, p, m, t.node, now);
    // done, or tried for long enough
    const done = t.kind === 'reinforce' ? !!room.world.panels[t.id]?.reinforced : (room.world.openings[t.id]?.barricadeHp ?? 0) > 0;
    if (done || t.workedFor > 4.5 || (t.kind === 'reinforce' && p.reinf <= 0)) {
      m.tasks.shift();
      m.task = null;
    }
    return;
  }

  if (attacker) {
    if (room.phase === PhaseId.PREP) {
      m.mode = 'hold';
      return;
    }
    if (site) {
      const inside = s.x >= (room.map.objectives[room.objectiveIdx]?.minX ?? 0) - 0.5 && s.x <= (room.map.objectives[room.objectiveIdx]?.maxX ?? 0) + 0.5 &&
        s.z >= (room.map.objectives[room.objectiveIdx]?.minZ ?? 0) - 0.5 && s.z <= (room.map.objectives[room.objectiveIdx]?.maxZ ?? 0) + 0.5 &&
        Math.abs(s.y - site.y) < 1.5;
      if (inside) {
        m.mode = 'hold'; // capturing: stay and watch
        m.path = null;
      } else {
        setGoal(room, p, m, site.x + (m.rng.next() - 0.5) * 2, site.y, site.z + (m.rng.next() - 0.5) * 2, now);
      }
    } else {
      // elimination: hunt toward the defender spawn area
      const sp = room.map.defenderSpawns[(p.id * 3) % Math.max(1, room.map.defenderSpawns.length)];
      if (sp) setGoal(room, p, m, sp.x, sp.y, sp.z, now);
    }
    // an alert nearby slows the approach
    if (now - m.alertT < 5) m.mode = m.mode === 'hold' ? 'hold' : 'cautious';
    return;
  }

  // defenders: hold an anchor near the objective, roam between a few, turn toward noises
  if (room.phase === PhaseId.PREP) {
    m.mode = 'hold';
    if (m.anchorNode >= 0) setGoalNode(room, p, m, m.anchorNode, now);
    return;
  }
  if (now - m.alertT < 5) {
    m.mode = 'hold';
    return;
  }
  if (site) {
    // when the attackers are taking the objective, go and contest it
    if (room.capture > 0.15) {
      setGoal(room, p, m, site.x, site.y, site.z, now);
      m.mode = 'move';
      return;
    }
    if (m.anchorNode < 0 || now > m.nextRoamAt) {
      m.anchorNode = nav.randomNear(site.x, site.y, site.z, 6, () => m.rng.next());
      m.nextRoamAt = now + 12 + m.rng.next() * 14;
    }
    if (m.anchorNode >= 0) setGoalNode(room, p, m, m.anchorNode, now);
    const pos = { x: 0, y: 0, z: 0 };
    if (m.anchorNode >= 0) nav.posOf(m.anchorNode, pos);
    m.mode = m.anchorNode >= 0 && Math.hypot(pos.x - s.x, pos.z - s.z) < 0.7 ? 'hold' : 'move';
  } else {
    m.mode = 'hold';
  }
}

function setGoal(room: Room, p: Player, m: BotMind, x: number, y: number, z: number, now: number): void {
  const node = navFor(room).nearest(x, y, z, 6);
  if (node < 0) return;
  setGoalNode(room, p, m, node, now);
}

function setGoalNode(room: Room, p: Player, m: BotMind, node: number, now: number): void {
  const nav = navFor(room);
  if (node === m.goalNode && m.path && now < m.repathAt) return;
  m.goalNode = node;
  m.path = nav.pathFrom(p.state.x, p.state.y, p.state.z, node, m.seed);
  m.wp = m.path ? firstWaypoint(m.path, p.state.x, p.state.z) : 1;
  m.repathAt = now + 3 + m.rng.next() * 2;
}

/**
 * Where to start on a fresh path. A path begins at the walkable node nearest to the bot, which can be
 * behind it (typically halfway up a staircase), so start at the waypoint it has not passed yet.
 */
function firstWaypoint(path: NavPath, x: number, z: number): number {
  const lim = Math.min(path.n - 1, 10);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= lim; i++) {
    const d = Math.hypot((path.xz[i * 2] as number) - x, (path.xz[i * 2 + 1] as number) - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < path.n - 1) {
    const ax = path.xz[best * 2] as number;
    const az = path.xz[best * 2 + 1] as number;
    const bx = path.xz[(best + 1) * 2] as number;
    const bz = path.xz[(best + 1) * 2 + 1] as number;
    if (Math.hypot(bx - x, bz - z) < Math.hypot(bx - ax, bz - az)) best++;
  }
  return Math.max(1, Math.min(best, path.n - 1));
}

// ----- movement, 60 Hz -----

function steer(room: Room, p: Player, m: BotMind, now: number, wish: Wish): void {
  const s = p.state;
  m.moving = false;
  let wantX = 0;
  let wantZ = 0;

  const fighting = m.mode === 'fight' && m.target !== null;
  const working = m.mode === 'work' && m.task !== null;
  const holding = m.mode === 'hold';

  // follow the path unless holding or working
  if (!working && !holding && m.path && m.wp < m.path.n) {
    const px = m.path.xz;
    // advance through the waypoints we are close to
    while (m.wp < m.path.n) {
      const tx = px[m.wp * 2] as number;
      const tz = px[m.wp * 2 + 1] as number;
      const d = Math.hypot(tx - s.x, tz - s.z);
      const last = m.wp === m.path.n - 1;
      if (d < (last ? 0.5 : 0.45)) m.wp++;
      else break;
    }
    if (m.wp < m.path.n) {
      const tx = px[m.wp * 2] as number;
      const tz = px[m.wp * 2 + 1] as number;
      const dx = tx - s.x;
      const dz = tz - s.z;
      const d = Math.hypot(dx, dz) || 1;
      wantX = dx / d;
      wantZ = dz / d;
      m.moving = true;
    }
  }

  // fighters stop to shoot unless they are still far away and pushing (attackers)
  let speedMul = 1;
  if (fighting) {
    const t = (m.target as Player).state;
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    const attacker = sideOf(room, p) === 'attack';
    if (!attacker || d < 11) {
      wantX = 0;
      wantZ = 0;
      m.moving = false;
    } else {
      speedMul = 0.8;
    }
  } else if (m.mode === 'cautious') {
    speedMul = 0.75;
  }

  // doors: open one that is in the way, break a barricade that blocks the attackers
  if (m.moving) doorWork(room, p, m, now, wantX, wantZ, wish);

  // stuck detection while trying to move
  if (m.moving && !fighting) {
    if (now - m.lastProgT > 1.1) {
      const moved = Math.hypot(s.x - m.lastProgX, s.z - m.lastProgZ);
      m.lastProgX = s.x;
      m.lastProgZ = s.z;
      m.lastProgT = now;
      if (moved < 0.25) {
        m.stuckCount++;
        m.sidestepUntil = now + 0.5;
        m.sidestepDir = m.rng.next() < 0.5 ? -1 : 1;
        if (m.stuckCount >= 3) {
          // give up this route: recompute with other costs
          m.path = null;
          m.repathAt = 0;
          m.stuckCount = 0;
        }
      } else {
        m.stuckCount = 0;
      }
    }
  } else {
    m.lastProgX = s.x;
    m.lastProgZ = s.z;
    m.lastProgT = now;
  }

  // teammates in the way: push away a little
  for (const o of room.players.values()) {
    if (o === p || !o.state.alive || o.team !== p.team) continue;
    const dx = s.x - o.state.x;
    const dz = s.z - o.state.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8 && d > 0.01 && Math.abs(o.state.y - s.y) < 1.5) {
      wantX += (dx / d) * 0.6;
      wantZ += (dz / d) * 0.6;
      m.moving = true;
    }
  }
  if (now < m.sidestepUntil) {
    // step sideways relative to the heading to get around whatever is in the way
    const sx = -wantZ;
    const sz = wantX;
    wantX += sx * 0.8 * m.sidestepDir;
    wantZ += sz * 0.8 * m.sidestepDir;
    m.moving = true;
  }

  // convert the wished world direction into the view frame
  const len = Math.hypot(wantX, wantZ);
  if (len > 0.01) {
    wantX /= Math.max(1, len);
    wantZ /= Math.max(1, len);
    const sy = Math.sin(m.yaw);
    const cy = Math.cos(m.yaw);
    // forward = (-sin, -cos), right = (cos, -sin) in the (x, z) plane
    const fwd = wantX * -sy + wantZ * -cy;
    const right = wantX * cy + wantZ * -sy;
    wish.moveZ = clamp(fwd, -1, 1) * speedMul;
    wish.moveX = clamp(right, -1, 1) * speedMul;
  }

  // strafing while fighting at close range
  if (fighting) {
    const t = (m.target as Player).state;
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    if (now > m.strafeUntil) {
      m.strafeUntil = now + 0.5 + m.rng.next() * 0.9;
      m.strafeDir = m.rng.next() < 0.5 ? -1 : 1;
      if (m.rng.next() > m.skill.strafe || d > 16) m.strafeDir = 0;
    }
    if (!m.moving && m.strafeDir !== 0 && !m.wantAds) wish.moveX = m.strafeDir * 0.9;
  }

  // sprint when pushing along a long way and nothing is going on
  const attacker = sideOf(room, p) === 'attack';
  if (m.moving && m.mode === 'move' && attacker && room.phase === PhaseId.ACTION && wish.moveZ > 0.7 && m.path && now - m.alertT > 5 && !fighting) {
    let remaining = 0;
    for (let i = m.wp; i < m.path.n - 1; i++) {
      remaining += Math.hypot((m.path.xz[(i + 1) * 2] as number) - (m.path.xz[i * 2] as number), (m.path.xz[(i + 1) * 2 + 1] as number) - (m.path.xz[i * 2 + 1] as number));
    }
    if (remaining > 10) wish.buttons |= Btn.SPRINT;
  }
}

function doorWork(room: Room, p: Player, m: BotMind, now: number, wx: number, wz: number, wish: Wish): void {
  const s = p.state;
  const len = Math.hypot(wx, wz);
  if (len < 0.01) return;
  const fx = wx / len;
  const fz = wz / len;
  const door = room.world.findOpeningNear(s.x, s.y, s.z, fx, fz, 1.5, 'door');
  if (!door || door.destroyed) {
    m.tapTicks = 0;
    return;
  }
  const attacker = sideOf(room, p) === 'attack';
  if (door.barricadeHp > 0) {
    if (!attacker) {
      // a defender who barricaded the way is not going through it: pick another route
      m.path = null;
      m.repathAt = now + 2;
      return;
    }
    // face it and kick until it breaks
    m.faceX = door.cx;
    m.faceZ = door.cz;
    m.faceY = s.y + 1.1;
    m.facing = true;
    if (now >= m.meleeAt) {
      m.meleeAt = now + SIEGE.meleeCooldown + 0.05;
      wish.buttons |= Btn.MELEE;
    }
    return;
  }
  // a tap next to something vaultable would hop over it instead of working the door: do not press then
  if (room.world.findVault(s.x, s.y, s.z, m.yaw, vaultTmp)) {
    m.tapTicks = 0;
    return;
  }
  if (!door.open && now >= m.tapCooldown) {
    // a short press and release is a tap (open or close)
    m.tapTicks = 3;
    m.tapCooldown = now + 0.9;
  }
  if (m.tapTicks > 0) {
    m.tapTicks--;
    wish.buttons |= Btn.INTERACT;
  }
}

// ----- aiming and firing, 60 Hz -----

function turnToward(m: BotMind, wantYaw: number, wantPitch: number, dt: number, maxRate: number): void {
  const dy = wrapAngle(wantYaw - m.yaw);
  const dp = wantPitch - m.pitch;
  const k = Math.min(1, TURN_EASE * dt);
  const maxStep = maxRate * dt;
  m.yaw = wrapAngle(m.yaw + clamp(dy * k, -maxStep, maxStep));
  m.pitch = clamp(m.pitch + clamp(dp * k, -maxStep, maxStep), -1.4, 1.4);
}

function aimAndShoot(p: Player, m: BotMind, now: number, wish: Wish): void {
  const s = p.state;
  const dt = SIM_DT;
  const def = weaponDef(s.slot === 0 ? s.w0 : s.w1);
  const skill = m.skill;
  const ey = eyeY(p);
  const facingTarget = m.facing;
  m.facing = false;

  // working on a wall: look at it and hold the interact button
  if (m.mode === 'work' && m.task) {
    const t = m.task;
    const dx = t.fx - s.x;
    const dz = t.fz - s.z;
    turnToward(m, Math.atan2(-dx, -dz), Math.atan2(t.fy - ey, Math.hypot(dx, dz)), dt, 6);
    const ready = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - m.yaw)) < 0.12;
    if (ready && Math.hypot(s.vx, s.vz) < 0.8) {
      wish.buttons |= Btn.INTERACT;
      t.workedFor += dt;
    }
    return;
  }

  if (m.target && m.mode === 'fight') {
    const t = m.target.state;
    const dx = t.x - s.x;
    const dz = t.z - s.z;
    const d = Math.hypot(dx, dz);
    // re-roll the aim error now and then: bigger when far away or when the target runs
    if (now > m.errUntil) {
      const speed = Math.hypot(t.vx, t.vz);
      const sd = skill.aimError * Math.sqrt(Math.max(1, d) / 10) * (1 + speed * 0.12);
      m.errX = gauss(m) * sd;
      m.errY = gauss(m) * sd * 0.8;
      m.errUntil = now + 0.25 + m.rng.next() * 0.35;
    }
    const aimH = t.crouch ? 0.9 : 1.3 + (skill.aimError < 0.015 ? 0.12 : 0);
    const wantYaw = Math.atan2(-dx, -dz) + m.errX - s.rcY * skill.recoilControl;
    const wantPitch = Math.atan2(t.y + aimH - ey, d) + m.errY - s.rcP * skill.recoilControl;
    turnToward(m, wantYaw, wantPitch, dt, skill.aimSpeed);

    // the shot is lined up when the view is inside the (shrinking with distance) body width
    const errAng = Math.hypot(wrapAngle(wantYaw - m.errX + s.rcY * skill.recoilControl - m.yaw), wantPitch - m.errY + s.rcP * skill.recoilControl - m.pitch);
    const tolerance = Math.atan2(0.3, Math.max(2, d)) + 0.012;
    const lined = errAng < tolerance * 1.2;
    const seenFor = now - m.targetSince;

    // aim down sights at range (the shotgun never does, the sidearms only a little)
    const adsRange = def.kind === 'shotgun' ? 999 : def.kind === 'pistol' || def.kind === 'revolver' ? 15 : def.kind === 'smg' ? 14 : def.kind === 'dmr' ? 9 : 17;
    m.wantAds = d > adsRange && !s.reloading;
    if (m.wantAds) wish.buttons |= Btn.ADS;
    const aimed = !m.wantAds || s.adsAmt > 0.75;

    // crouch to steady the aim when shooting far
    if (d > 16 && now > m.standUntil) {
      if (now > m.crouchUntil && m.rng.next() < 0.02) m.crouchUntil = now + 1.5 + m.rng.next() * 2.5;
    }
    if (now < m.crouchUntil && !s.sprint) wish.buttons |= Btn.CROUCH;

    const inRange = def.kind !== 'shotgun' || d < 14;
    if (seenFor >= skill.reaction && lined && aimed && inRange && !s.reloading) {
      pullTrigger(m, s, def, now, wish);
    } else {
      m.triggerHeld = false;
    }
    return;
  }

  m.triggerHeld = false;

  // kicking a barricade: look at it
  if (facingTarget) {
    const dx = m.faceX - s.x;
    const dz = m.faceZ - s.z;
    turnToward(m, Math.atan2(-dx, -dz), Math.atan2(m.faceY - ey, Math.hypot(dx, dz)), dt, 7);
    return;
  }

  // alert: turn toward a noise, otherwise face the way we are walking, otherwise scan
  let wantYaw = m.yaw;
  let wantPitch = 0;
  if (now - m.alertT < 4) {
    const dx = m.alertX - s.x;
    const dz = m.alertZ - s.z;
    wantYaw = Math.atan2(-dx, -dz);
    wantPitch = 0.02;
    turnToward(m, wantYaw, wantPitch, dt, 4.5);
    return;
  }
  if (m.moving && m.path && m.wp < m.path.n) {
    const tx = m.path.xz[m.wp * 2] as number;
    const tz = m.path.xz[m.wp * 2 + 1] as number;
    // look a little further ahead than the next waypoint
    const look = Math.min(m.path.n - 1, m.wp + 1);
    const lx = m.path.xz[look * 2] as number;
    const lz = m.path.xz[look * 2 + 1] as number;
    const dx = (tx + lx) / 2 - s.x;
    const dz = (tz + lz) / 2 - s.z;
    if (Math.hypot(dx, dz) > 0.2) {
      wantYaw = Math.atan2(-dx, -dz);
      turnToward(m, wantYaw, wantPitch, dt, 5.5);
    }
    return;
  }
  // idle: sweep the view back and forth
  if (now > m.scanUntil) {
    m.scanUntil = now + 1.2 + m.rng.next() * 2;
    m.scanBase = m.yaw;
    m.scanDir = m.rng.next() < 0.5 ? -1 : 1;
  }
  turnToward(m, m.scanBase + m.scanDir * 0.7, 0, dt, 0.9);
}

function pullTrigger(m: BotMind, s: Player['state'], def: ReturnType<typeof weaponDef>, now: number, wish: Wish): void {
  // sprinting stops the moment the trigger is pulled, so this just fires
  if (def.mode === 'auto') {
    if (now < m.pauseUntil) {
      m.triggerHeld = false;
      return;
    }
    if (m.burstLeft <= 0) m.burstLeft = m.skill.burstMin + m.rng.int(m.skill.burstMax - m.skill.burstMin + 1);
    wish.buttons |= Btn.FIRE;
    m.triggerHeld = true;
    // count shots as they are fired
    if (s.shotIdx !== m.lastShots) {
      m.burstLeft -= s.shotIdx - m.lastShots;
      m.lastShots = s.shotIdx;
      if (m.burstLeft <= 0) {
        m.pauseUntil = now + m.skill.pause * (0.6 + m.rng.next() * 0.8);
        m.burstLeft = 0;
      }
    }
    return;
  }
  // semi automatic and burst weapons need a fresh press each time: press for one tick, release for the next
  if (m.triggerHeld) {
    m.triggerHeld = false;
    return;
  }
  if (s.cooldown <= 0.02 && s.burstLeft === 0 && now >= m.pauseUntil) {
    wish.buttons |= Btn.FIRE;
    m.triggerHeld = true;
    m.pauseUntil = now + 0.03 + m.rng.next() * m.skill.pause * 0.4;
  }
  m.lastShots = s.shotIdx;
}

function handleWeapon(p: Player, m: BotMind, now: number, wish: Wish): void {
  const s = p.state;
  const def = weaponDef(s.slot === 0 ? s.w0 : s.w1);
  const ammo = s.slot === 0 ? s.ammo0 : s.ammo1;
  const res = s.slot === 0 ? s.res0 : s.res1;
  m.wantSlot = undefined;
  if (s.reloading) return;
  if (ammo <= 0) {
    // empty: switch to the other gun when it has rounds, otherwise reload
    const otherAmmo = s.slot === 0 ? s.ammo1 : s.ammo0;
    if (m.target && otherAmmo > 0) {
      m.wantSlot = s.slot === 0 ? 1 : 0;
      return;
    }
    if (res > 0) wish.buttons |= Btn.RELOAD;
    return;
  }
  // top up when nothing is happening
  if (!m.target && now - m.lastSeenT > 1.5 && now - m.alertT > 3 && ammo < def.mag * 0.4 && res > 0) wish.buttons |= Btn.RELOAD;
  // go back to the primary when out of the fight
  if (!m.target && s.slot === 1 && s.ammo0 > 0) m.wantSlot = 0;
}

function gauss(m: BotMind): number {
  let u = 0;
  for (let i = 0; i < 4; i++) u += m.rng.next();
  return (u - 2) / 0.577;
}

