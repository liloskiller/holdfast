// Transports: a WebSocket connection and an in-browser loopback to a local Lobby (Practice mode).
// Both implement Transport so the game does not care. Includes a lag/jitter/loss simulator for testing
// (query params ?lag=100&jitter=30&loss=2).

import { decodeServer, encodeClient, type ClientMsg, type ServerMsg } from '@holdfast/shared';
import { Lobby } from '@holdfast/server/engine';
import type { ConnState } from '@holdfast/server/engine';

export interface Transport {
  readonly kind: 'ws' | 'loopback';
  connected: boolean;
  onMessage: ((msg: ServerMsg) => void) | null;
  onClose: ((reason: string) => void) | null;
  send(msg: ClientMsg): void;
  close(): void;
}

export interface LagConfig {
  lag: number; // total round trip added, ms
  jitter: number; // ms
  loss: number; // percent, applied to INPUT up and SNAP down
}

export function lagFromQuery(): LagConfig {
  const q = new URLSearchParams(location.search);
  return { lag: Number(q.get('lag') ?? 0) || 0, jitter: Number(q.get('jitter') ?? 0) || 0, loss: Number(q.get('loss') ?? 0) || 0 };
}

/** Delays callbacks while preserving order (TCP like). */
class DelayLine {
  private lastDue = 0;
  constructor(private cfg: LagConfig) {}
  get active(): boolean {
    return this.cfg.lag > 0 || this.cfg.jitter > 0 || this.cfg.loss > 0;
  }
  run(fn: () => void, lossy: boolean): void {
    if (!this.active) {
      fn();
      return;
    }
    if (lossy && this.cfg.loss > 0 && Math.random() * 100 < this.cfg.loss) return;
    const now = performance.now();
    const delay = this.cfg.lag / 2 + Math.random() * this.cfg.jitter;
    const due = Math.max(this.lastDue, now + delay);
    this.lastDue = due;
    setTimeout(fn, Math.max(0, due - now));
  }
}

export class WsConnection implements Transport {
  readonly kind = 'ws' as const;
  connected = false;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private ws: WebSocket;
  private up: DelayLine;
  private down: DelayLine;

  private constructor(ws: WebSocket, cfg: LagConfig) {
    this.ws = ws;
    this.up = new DelayLine(cfg);
    this.down = new DelayLine(cfg);
    ws.addEventListener('message', (e) => {
      const raw = typeof e.data === 'string' ? e.data : '';
      const msg = decodeServer(raw);
      if (!msg) return;
      this.down.run(() => this.onMessage?.(msg), msg.t === 'SNAP');
    });
    ws.addEventListener('close', () => {
      this.connected = false;
      this.onClose?.('closed');
    });
  }

  static url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  static open(url: string = WsConnection.url(), cfg: LagConfig = lagFromQuery()): Promise<WsConnection> {
    return new Promise((resolve, reject) => {
      if (location.protocol === 'file:') {
        // the single file offline build has no server behind it
        reject(new Error('This offline file only does solo Practice. For multiplayer, run the server (npm run lan) and open its address.'));
        return;
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e as Error);
        return;
      }
      const conn = new WsConnection(ws, cfg);
      const timer = setTimeout(() => {
        reject(new Error('Connection timed out'));
        ws.close();
      }, 8000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        conn.connected = true;
        resolve(conn);
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not reach the server'));
      });
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const raw = encodeClient(msg);
    this.up.run(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    }, msg.t === 'INPUT');
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** Runs an authoritative Lobby/Room inside the page. Used for Practice (offline). */
export class LoopbackConnection implements Transport {
  readonly kind = 'loopback' as const;
  connected = true;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private lobby: Lobby;
  private cs: ConnState;
  private closed = false;

  constructor(mapText: string) {
    this.lobby = new Lobby(mapText);
    this.cs = this.lobby.open({
      send: (data: string) => {
        const msg = decodeServer(data);
        if (!msg || this.closed) return;
        // deliver outside of the room's tick to avoid re-entrancy
        queueMicrotask(() => {
          if (!this.closed) this.onMessage?.(msg);
        });
      },
      close: () => this.close(),
    });
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    // round trip through the real codec so Practice exercises the same wire path
    this.lobby.message(this.cs, encodeClient(msg));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.lobby.close(this.cs);
    this.lobby.shutdown();
    this.onClose?.('closed');
  }
}
