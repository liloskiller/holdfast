import { arenaMapText, cmdFor, decodeServer, resetLoadout, type RunOpts, type ServerMsg, type RoomSettings, GameMode } from '@holdfast/shared';
import { Room } from './Room';
import type { Player } from './Player';
import type { Conn } from './transport';

export class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  send(data: string): void {
    const m = decodeServer(data);
    if (m) this.msgs.push(m);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i] as ServerMsg;
      if (m.t === t) return m as Extract<ServerMsg, { t: T }>;
    }
    return undefined;
  }
}

export const FAST: Partial<RoomSettings> = {
  prepTime: 5, actionTime: 30, operatorSelectTime: 5, roundEndTime: 3, roundsToWin: 2, mode: GameMode.ELIMINATION,
};

export function makeRoom(opts: { map?: string; settings?: Partial<RoomSettings>; sandbox?: boolean } = {}): Room {
  const ro: import('./Room').RoomOptions = { settings: { ...FAST, ...(opts.settings ?? {}) }, clock: () => 0 };
  if (opts.sandbox) ro.sandbox = true;
  const room = new Room('TEST', opts.map ?? arenaMapText(), ro);
  room.debugNoVisibility = false;
  return room;
}

export function addHuman(room: Room, name: string, team: 0 | 1): { p: Player; conn: FakeConn } {
  const conn = new FakeConn();
  const p = room.addPlayer(name, conn);
  if (!p) throw new Error('room full');
  p.team = team;
  return { p, conn };
}

export const TICK_MS = 1000 / 60;

/** Queue n identical input commands for the player and advance the room n ticks. */
export function feed(room: Room, p: Player, o: RunOpts, n: number): void {
  for (let i = 0; i < n; i++) {
    const cmd = cmdFor(p.state, o);
    cmd.seq = ++p.lastQueuedSeq;
    cmd.clientTime = room.time;
    p.queue.push(cmd);
    room.advance(TICK_MS);
  }
}

/** Force a quick running state for unit tests: ACTION phase with the given spawn positions. */
export function forceAction(room: Room): void {
  room.phase = 3; // PhaseId.ACTION
  room.phaseEndsAt = room.time + 600000;
  room.round = 1;
}

export function place(p: Player, x: number, y: number, z: number, yaw = 0): void {
  const s = p.state;
  s.x = x; s.y = y; s.z = z; s.yaw = yaw; s.pitch = 0;
  s.alive = true;
  s.hp = 100;
  s.onGround = true;
  s.vx = 0; s.vz = 0; s.vy = 0;
  resetLoadout(s, 0);
  p.clearHistory();
}

/** Pitch that aims at the target's chest from the shooter's eye. */
export function aimChest(a: Player, b: Player): number {
  const dx = b.state.x - a.state.x;
  const dz = b.state.z - a.state.z;
  return Math.atan2(0.9 - 1.65, Math.hypot(dx, dz));
}
