// Room codes, create/join, reconnect tokens and per connection rate limiting.

import {
  GameMode, NET, decodeClient, encodeServer, type ClientMsg, type ServerMsg,
} from '@holdfast/shared';
import { Room, type RoomOptions } from './Room';
import type { Player } from './Player';
import type { Conn, ConnState } from './transport';

export interface LobbyOptions {
  clock?: () => number;
  /** Do not start real timers (tests drive rooms manually). */
  manual?: boolean;
  /** Extra room options, e.g. a custom clock. */
  room?: RoomOptions;
}

export class Lobby {
  rooms = new Map<string, Room>();
  private tokens = new Map<string, { code: string; playerId: number }>();
  private clock: () => number;
  private manual: boolean;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private codeRng = 1;

  constructor(private mapText: string, private opts: LobbyOptions = {}) {
    this.clock = opts.clock ?? ((): number => performance.now());
    this.manual = !!opts.manual;
    this.codeRng = Math.floor(this.clock()) % 100000 + 7;
    if (!this.manual) this.sweepTimer = setInterval(() => this.sweep(), 5000);
  }

  open(conn: Conn): ConnState {
    return { conn, roomCode: null, playerId: 0, windowStart: this.clock(), windowCount: 0 };
  }

  private sendRaw(cs: ConnState, msg: ServerMsg): void {
    cs.conn.send(encodeServer(msg));
  }

  private makeCode(): string {
    const chars = NET.roomCodeChars;
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < NET.roomCodeLen; i++) {
        this.codeRng = (Math.imul(this.codeRng, 1103515245) + 12345 + Math.floor(Math.random() * 1e6)) >>> 0;
        code += chars.charAt((this.codeRng >>> 8) % chars.length);
      }
      if (!this.rooms.has(code)) return code;
    }
    return 'ZZZZ';
  }

  message(cs: ConnState, raw: string): void {
    // rate limit
    const now = this.clock();
    if (now - cs.windowStart > 1000) {
      cs.windowStart = now;
      cs.windowCount = 0;
    }
    cs.windowCount++;
    if (cs.windowCount > NET.maxMsgPerSec * 3) {
      cs.conn.close();
      return;
    }
    if (cs.windowCount > NET.maxMsgPerSec) return;

    const msg = decodeClient(raw);
    if (!msg) return;
    const room = cs.roomCode ? this.rooms.get(cs.roomCode) : undefined;
    const player = room ? room.players.get(cs.playerId) : undefined;

    if (room && player) {
      if (msg.t === 'LEAVE') {
        this.leave(cs);
        return;
      }
      room.handleMessage(player, msg);
      return;
    }
    if (msg.t === 'PING') {
      this.sendRaw(cs, { t: 'PONG', c: msg.c, s: 0 });
      return;
    }
    if (msg.t === 'CREATE_ROOM') this.create(cs, msg);
    else if (msg.t === 'JOIN_ROOM') this.join(cs, msg);
  }

  private create(cs: ConnState, msg: Extract<ClientMsg, { t: 'CREATE_ROOM' }>): void {
    if (this.rooms.size >= 200) {
      this.sendRaw(cs, { t: 'ERR', msg: 'Server is full, try again later', fatal: true });
      return;
    }
    const code = this.makeCode();
    const roomOpts: RoomOptions = { ...(this.opts.room ?? {}), clock: this.clock };
    if (msg.sandbox) roomOpts.sandbox = true;
    if (msg.mode !== undefined && !msg.sandbox) roomOpts.mode = msg.mode as GameMode;
    const room = new Room(code, this.mapText, roomOpts);
    this.rooms.set(code, room);
    if (!this.manual) room.startLoop();
    this.attach(cs, room, msg.name);
  }

  private join(cs: ConnState, msg: Extract<ClientMsg, { t: 'JOIN_ROOM' }>): void {
    const room = this.rooms.get(msg.code);
    if (!room) {
      this.sendRaw(cs, { t: 'ERR', msg: 'Room ' + msg.code + ' not found' });
      return;
    }
    if (msg.token) {
      const ref = this.tokens.get(msg.token);
      if (ref && ref.code === room.code) {
        const existing = room.players.get(ref.playerId);
        if (existing && !existing.isDummy) {
          if (existing.connected && existing.conn) existing.conn.close();
          room.attachConn(existing, cs.conn);
          this.finishJoin(cs, room, existing);
          return;
        }
      }
    }
    this.attach(cs, room, msg.name);
  }

  private attach(cs: ConnState, room: Room, name: string): void {
    const player = room.addPlayer(name, cs.conn);
    if (!player) {
      this.sendRaw(cs, { t: 'ERR', msg: 'Room is full' });
      return;
    }
    this.tokens.set(player.token, { code: room.code, playerId: player.id });
    this.finishJoin(cs, room, player);
  }

  private finishJoin(cs: ConnState, room: Room, player: Player): void {
    cs.roomCode = room.code;
    cs.playerId = player.id;
    this.sendRaw(cs, {
      t: 'JOINED',
      playerId: player.id,
      token: player.token,
      code: room.code,
      mapText: room.mapText,
      room: room.roomState(),
      phase: room.phaseInfo(),
      world: room.world.fullDiff(),
      serverTime: room.time,
    });
    room.markRoomDirty();
  }

  private leave(cs: ConnState): void {
    const room = cs.roomCode ? this.rooms.get(cs.roomCode) : undefined;
    const player = room?.players.get(cs.playerId);
    if (room && player) {
      this.tokens.delete(player.token);
      room.removePlayer(player);
    }
    cs.roomCode = null;
    cs.playerId = 0;
  }

  close(cs: ConnState): void {
    const room = cs.roomCode ? this.rooms.get(cs.roomCode) : undefined;
    const player = room?.players.get(cs.playerId);
    if (room && player && player.conn === cs.conn) room.disconnect(player);
    cs.roomCode = null;
  }

  sweep(): void {
    for (const [code, room] of this.rooms) {
      if (room.emptySince > 0 && room.time - room.emptySince > NET.roomIdleMs) {
        room.close();
        this.rooms.delete(code);
        for (const [tok, ref] of this.tokens) if (ref.code === code) this.tokens.delete(tok);
      }
    }
  }

  shutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const r of this.rooms.values()) r.close();
    this.rooms.clear();
  }
}
