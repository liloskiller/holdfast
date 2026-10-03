// Minimal transport abstraction so the same Lobby/Room code runs behind a real WebSocket
// (Node) or a loopback (browser practice mode).

export interface Conn {
  send(data: string): void;
  close(): void;
}

export interface ConnState {
  conn: Conn;
  /** room code the connection is in, if any */
  roomCode: string | null;
  playerId: number;
  /** rate limiter */
  windowStart: number;
  windowCount: number;
}
