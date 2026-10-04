// Round state machine: lobby, operator select, prep, action, round end, match end.

import {
  GameMode, PhaseId, operatorDef, OPERATORS, defaultOperator, resetLoadout, PLAYER, FLOOR_H,
  type SpawnPoint,
} from '@holdfast/shared';
import { Player } from '../Player';
import type { Room } from '../Room';
import { clearEntities, deployDronesForPrep } from './gadgetSystem';

const MATCH_END_MS = 15000;

function sideOf(room: Room, p: Player): 'attack' | 'defend' {
  return p.team === room.attackerTeam ? 'attack' : 'defend';
}

// ---------------------------------------------------------------------------
// Match / round lifecycle
// ---------------------------------------------------------------------------

export function ensureBalanced(room: Room): void {
  const humans = room.connectedHumans();
  const t0 = humans.filter((p) => p.team === 0);
  const t1 = humans.filter((p) => p.team === 1);
  if (t0.length === 0 || t1.length === 0) {
    humans.forEach((p, i) => {
      p.team = (i % 2) as 0 | 1;
    });
  }
}

export function startMatch(room: Room): string | null {
  const humans = room.connectedHumans();
  if (humans.length < 2) return 'Need at least 2 players to start. Use Practice to play alone.';
  ensureBalanced(room);
  room.scores = [0, 0];
  room.round = 0;
  for (const p of room.humans()) {
    p.kills = 0;
    p.deaths = 0;
    p.objTime = 0;
    p.ready = false;
  }
  startRound(room);
  return null;
}

function setPhase(room: Room, phase: PhaseId, seconds: number): void {
  room.phase = phase;
  room.phaseEndsAt = seconds > 0 ? room.time + seconds * 1000 : 0;
}

function startRound(room: Room): void {
  room.round++;
  const swap = Math.max(1, room.settings.swapEvery);
  room.attackerTeam = Math.floor((room.round - 1) / swap) % 2 === 0 ? 0 : 1;
  room.world.reset();
  clearEntities(room);
  room.capture = 0;
  room.winnerTeam = -1;
  room.reason = '';
  room.overtime = false;
  const sites = room.map.objectives.length;
  room.objectiveIdx = room.settings.mode === GameMode.SECURE && sites > 0 ? Math.floor(room.rand() * sites) : -1;

  // drop stale players, reset picks to a valid default for the new side
  for (const p of [...room.players.values()]) {
    if (p.isDummy) continue;
    if (!p.connected) {
      room.removePlayer(p);
      continue;
    }
    p.op = defaultOperator(sideOf(room, p));
    p.primary = (operatorDef(p.op).primaries[0] as number);
    p.secondary = (operatorDef(p.op).secondaries[0] as number);
    p.picked = false;
    p.state.alive = false;
    p.state.hp = 0;
    p.state.dCtl = false;
    p.state.dDeployed = false;
    p.state.cam = false;
    p.tagUntil = [0, 0];
  }
  setPhase(room, PhaseId.OPERATOR_SELECT, room.settings.operatorSelectTime);
  room.broadcastPhase(true);
}

function startPrep(room: Room): void {
  // fix any duplicate or invalid picks before spawning
  const taken = new Set<string>();
  for (const p of room.connectedHumans()) {
    const def = operatorDef(p.op);
    const key = p.team + ':' + p.op;
    const wrongSide = def.side !== sideOf(room, p);
    if (wrongSide || (def.unique && taken.has(key))) {
      p.op = defaultOperator(sideOf(room, p));
      p.primary = (operatorDef(p.op).primaries[0] as number);
      p.secondary = (operatorDef(p.op).secondaries[0] as number);
    }
    if (def.unique) taken.add(key);
  }
  assignSpawns(room);
  for (const p of room.connectedHumans()) {
    if (p.team === room.attackerTeam) p.state.confined = true;
  }
  deployDronesForPrep(room);
  setPhase(room, PhaseId.PREP, room.settings.prepTime);
  const site = room.map.objectives[room.objectiveIdx];
  room.msg(site ? 'Objective: ' + site.name : 'Eliminate the enemy team');
  room.broadcastPhase();
}

function startAction(room: Room): void {
  for (const p of room.players.values()) p.state.confined = false;
  setPhase(room, PhaseId.ACTION, room.settings.actionTime);
  room.msg('Attackers, go go go!');
  room.broadcastPhase();
}

function endRound(room: Room, winner: number, reason: string): void {
  room.winnerTeam = winner;
  room.reason = reason;
  if (winner === 0 || winner === 1) room.scores[winner]++;
  for (const p of room.players.values()) p.state.confined = false;
  const matchOver = (room.scores[0] >= room.settings.roundsToWin) || (room.scores[1] >= room.settings.roundsToWin);
  setPhase(room, PhaseId.ROUND_END, room.settings.roundEndTime);
  room.matchOver = matchOver;
  room.broadcastPhase();
}

function endMatch(room: Room): void {
  setPhase(room, PhaseId.MATCH_END, MATCH_END_MS / 1000);
  room.winnerTeam = (room.scores[0] > room.scores[1] ? 0 : room.scores[1] > room.scores[0] ? 1 : -1);
  room.reason = 'Match over';
  room.broadcastPhase();
}

function toLobby(room: Room): void {
  setPhase(room, PhaseId.LOBBY, 0);
  room.round = 0;
  room.scores = [0, 0];
  room.world.reset();
  clearEntities(room);
  for (const p of [...room.players.values()]) {
    if (p.isDummy) continue;
    if (!p.connected) {
      room.removePlayer(p);
      continue;
    }
    p.ready = false;
    p.state.alive = false;
  }
  room.broadcastPhase(true);
}

// ---------------------------------------------------------------------------
// Picks and spawns
// ---------------------------------------------------------------------------

/** Validate and apply an operator pick. Returns an error message or null. */
export function applyPick(room: Room, p: Player, op: number, primary: number, force: boolean, secondary?: number): string | null {
  if (op < 0 || op >= OPERATORS.length) return 'Unknown operator';
  const def = operatorDef(op);
  if (!force) {
    if (def.side !== sideOf(room, p)) return 'That operator is for the other side';
    if (def.unique) {
      for (const o of room.players.values()) {
        if (o !== p && !o.isDummy && o.team === p.team && o.op === op && o.picked) return def.name + ' is already taken';
      }
    }
  }
  p.op = op;
  p.primary = def.primaries.includes(primary as 0) ? primary : (def.primaries[0] as number);
  p.secondary = secondary !== undefined && def.secondaries.includes(secondary as 0) ? secondary : (def.secondaries[0] as number);
  p.picked = true;
  room.markRoomDirty();
  return null;
}

function setupState(room: Room, p: Player, spawn: SpawnPoint | { x: number; y: number; z: number; yaw: number }): void {
  const s = p.state;
  const def = operatorDef(p.op);
  s.x = spawn.x;
  s.y = spawn.y;
  s.z = spawn.z;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.yaw = spawn.yaw;
  s.pitch = 0;
  s.crouch = false;
  s.onGround = true;
  s.sprint = false;
  s.ads = false;
  s.vault = 0;
  s.alive = true;
  s.hp = PLAYER.maxHp + (def.id === 3 ? 10 : 0);
  s.slow = 0;
  s.cam = false;
  s.dCtl = false;
  s.dDeployed = false;
  s.dhp = 0;
  s.dvx = 0;
  s.dvy = 0;
  s.dvz = 0;
  s.spdMul = def.speedMul;
  s.useHeld = 0;
  s.confined = false;
  p.primary = def.primaries.includes(p.primary as 0) ? p.primary : (def.primaries[0] as number);
  p.secondary = def.secondaries.includes(p.secondary as 0) ? p.secondary : (def.secondaries[0] as number);
  resetLoadout(s, p.primary, p.secondary);

  const defender = room.canDefenderStuff(p);
  p.reinf = defender ? (room.sandbox ? 3 : 2) + def.reinforceCharges : 0;
  p.gadgetUses = def.gadgetUses;
  p.gadgetCd = 0;
  p.droneCd = 0;
  p.tagCd = 0;
  p.sensorT = 0;
  p.healLeft = 0;
  p.meleeCd = 0;
  p.charges = [];
  p.cameras = [];
  p.camIdx = -1;
  p.actKind = 0;
  p.actT = 0;
  p.tagUntil = [0, 0];
  p.seen.clear();
  p.spec = 0;
  p.jammed = false;
  p.dLastX = 0;
  p.dLastY = 0;
  p.dLastZ = 0;
  p.clearHistory();
  if (!p.isDummy) room.pushEvent(p.id, { k: 'spawn', id: p.id, yaw: spawn.yaw });
}

function assignSpawns(room: Room): void {
  const att = room.connectedHumans().filter((p) => p.team === room.attackerTeam);
  const def = room.connectedHumans().filter((p) => p.team !== room.attackerTeam);

  // attackers: spread across spawn groups
  const groups = new Map<string, SpawnPoint[]>();
  for (const sp of room.map.attackerSpawns) {
    let g = groups.get(sp.name);
    if (!g) {
      g = [];
      groups.set(sp.name, g);
    }
    g.push(sp);
  }
  const groupList = [...groups.values()];
  const used = new Map<number, number>();
  att.forEach((p, i) => {
    const gi = i % Math.max(1, groupList.length);
    const g = groupList[gi] ?? room.map.attackerSpawns;
    const n = used.get(gi) ?? 0;
    used.set(gi, n + 1);
    setupState(room, p, g[n % g.length] as SpawnPoint);
  });

  // defenders: shuffled distinct points
  const spots = [...room.map.defenderSpawns];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(room.rand() * (i + 1));
    const t = spots[i] as SpawnPoint;
    spots[i] = spots[j] as SpawnPoint;
    spots[j] = t;
  }
  def.forEach((p, i) => {
    const sp = spots[i % Math.max(1, spots.length)] as SpawnPoint;
    setupState(room, p, sp);
  });
}

/** (Re)spawn one player: used by Practice mode and dummies. */
export function spawnRoundPlayer(room: Room, p: Player, keepPos = false): void {
  if (p.isDummy) {
    const spot = room.dummySpots[p.id % Math.max(1, room.dummySpots.length)];
    if (spot) setupState(room, p, spot);
    p.state.alive = true;
    return;
  }
  if (keepPos && p.state.alive) {
    const { x, y, z, yaw } = p.state;
    setupState(room, p, { x, y, z, yaw });
    return;
  }
  const spawns = room.map.attackerSpawns.length ? room.map.attackerSpawns : room.map.defenderSpawns;
  const sp = spawns[Math.floor(room.rand() * spawns.length)];
  if (sp) setupState(room, p, sp);
}

export function sandboxStart(room: Room): void {
  room.round = 1;
  room.attackerTeam = 0;
  room.phase = PhaseId.ACTION;
  room.phaseEndsAt = 0;
  room.objectiveIdx = -1;
  // dummy targets inside the building
  const spots = room.map.defenderSpawns.length ? room.map.defenderSpawns : room.map.attackerSpawns;
  room.dummySpots = spots.slice(0, 7).map((s) => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw }));
  const count = Math.min(6, room.dummySpots.length);
  for (let i = 0; i < count; i++) {
    const d = new Player(100 + i, 'Target ' + (i + 1));
    d.isDummy = true;
    d.team = 1;
    d.op = defaultOperator('defend');
    d.primary = 0;
    d.secondary = 4;
    d.connected = true;
    room.players.set(d.id, d);
    spawnRoundPlayer(room, d);
  }
}

// ---------------------------------------------------------------------------
// Per tick
// ---------------------------------------------------------------------------

export function onPlayerLeft(room: Room, _p: Player): void {
  if (room.sandbox) return;
  if (room.livePeople().length === 0) return;
  if (room.phase === PhaseId.ACTION || room.phase === PhaseId.PREP) {
    checkWin(room, false);
  }
}

function objectiveCounts(room: Room): { att: number; def: number } {
  const site = room.map.objectives[room.objectiveIdx];
  let att = 0;
  let def = 0;
  if (!site) return { att, def };
  for (const p of room.players.values()) {
    const s = p.state;
    if (!s.alive) continue;
    if (s.x < site.minX || s.x > site.maxX || s.z < site.minZ || s.z > site.maxZ) continue;
    if (s.y < site.y - 0.3 || s.y > site.y + FLOOR_H - 0.5) continue;
    if (p.team === room.attackerTeam) att++;
    else def++;
  }
  return { att, def };
}

function checkWin(room: Room, timeUp: boolean): void {
  if (room.phase !== PhaseId.ACTION && room.phase !== PhaseId.PREP) return;
  const attAlive = room.alivePlayers(room.attackerTeam).length;
  const defAlive = room.alivePlayers(room.attackerTeam === 0 ? 1 : 0).length;
  const defTeam = room.attackerTeam === 0 ? 1 : 0;
  if (attAlive === 0) return endRound(room, defTeam, 'Attackers eliminated');
  if (defAlive === 0) return endRound(room, room.attackerTeam, 'Defenders eliminated');
  if (room.phase !== PhaseId.ACTION) return;
  if (room.settings.mode === GameMode.SECURE) {
    if (room.capture >= 1) return endRound(room, room.attackerTeam, 'Objective secured');
    if (timeUp) {
      const c = objectiveCounts(room);
      if (c.att > 0 && room.capture > 0 && !room.overtime) {
        room.overtime = true;
        room.phaseEndsAt = room.time + 15000;
        room.msg('Overtime!');
        room.broadcastPhase();
      } else {
        return endRound(room, defTeam, 'Time expired');
      }
    }
  } else if (timeUp) {
    // elimination timeout: team with more survivors wins, defenders on a tie
    if (attAlive > defAlive) return endRound(room, room.attackerTeam, 'Time expired');
    return endRound(room, defTeam, 'Time expired');
  }
}

export function updateRound(room: Room): void {
  const now = room.time;
  switch (room.phase) {
    case PhaseId.LOBBY:
      break;
    case PhaseId.OPERATOR_SELECT: {
      const humans = room.connectedHumans();
      const allPicked = humans.length > 0 && humans.every((p) => p.picked);
      if (now >= room.phaseEndsAt || allPicked) startPrep(room);
      break;
    }
    case PhaseId.PREP:
      if (now >= room.phaseEndsAt) startAction(room);
      else checkWin(room, false);
      break;
    case PhaseId.ACTION: {
      if (room.sandbox) break;
      if (room.settings.mode === GameMode.SECURE) {
        const c = objectiveCounts(room);
        const rate = 1 / Math.max(1, room.settings.captureTime);
        if (c.att > 0 && c.def === 0) {
          room.capture = Math.min(1, room.capture + rate / 60);
          for (const p of room.players.values()) {
            if (p.state.alive && p.team === room.attackerTeam && !p.isDummy) p.objTime += 1 / 60;
          }
        } else if (c.att === 0 && room.capture > 0) {
          room.capture = Math.max(0, room.capture - (rate / 60) * 0.5);
        }
      }
      const timeUp = now >= room.phaseEndsAt;
      checkWin(room, timeUp);
      break;
    }
    case PhaseId.ROUND_END:
      if (now >= room.phaseEndsAt) {
        if (room.matchOver) endMatch(room);
        else startRound(room);
      }
      break;
    case PhaseId.MATCH_END:
      if (now >= room.phaseEndsAt) toLobby(room);
      break;
    default:
      break;
  }
}
