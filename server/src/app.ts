// Node server factory: HTTP(S) static server for the built client plus the WebSocket endpoint at /ws.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, type LobbyOptions } from './Lobby';
import type { ConnState } from './transport';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..', '..');
export const defaultMapPath = path.join(projectRoot, 'shared', 'maps', 'safehouse.map.txt');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export interface ServerOptions {
  port?: number;
  mapText?: string;
  distDir?: string;
  tls?: { key: Buffer; cert: Buffer } | null;
  lobby?: LobbyOptions;
  quiet?: boolean;
}

export interface RunningServer {
  port: number;
  lobby: Lobby;
  close(): Promise<void>;
}

export function loadTlsFromEnv(): { key: Buffer; cert: Buffer } | null {
  if (process.env['HTTPS'] === '0') return null;
  const keyPath = process.env['HTTPS_KEY'] ?? path.join(projectRoot, 'certs', 'key.pem');
  const certPath = process.env['HTTPS_CERT'] ?? path.join(projectRoot, 'certs', 'cert.pem');
  const wanted = process.env['HTTPS'] === '1' || !!process.env['HTTPS_KEY'];
  if (wanted && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  return null;
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const mapText = opts.mapText ?? fs.readFileSync(defaultMapPath, 'utf8');
  const distDir = opts.distDir ?? path.join(projectRoot, 'client', 'dist');
  const lobby = new Lobby(mapText, opts.lobby);
  const tls = opts.tls ?? null;

  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size }));
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.normalize(path.join(distDir, rel));
    if (!file.startsWith(distDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(distDir, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('HOLDFAST server is running. Build the client with "npm run build" to serve it here, or use "npm run dev".');
      return;
    }
    const ext = path.extname(file);
    const immutable = file.includes(path.sep + 'assets' + path.sep);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  };

  const server = tls ? https.createServer(tls, serveStatic) : http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });

  type Live = WebSocket & { alive?: boolean };
  wss.on('connection', (ws: Live) => {
    const cs: ConnState = lobby.open({
      send: (data: string) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: () => ws.close(),
    });
    ws.alive = true;
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.on('message', (data) => {
      lobby.message(cs, data.toString());
    });
    ws.on('close', () => lobby.close(cs));
    ws.on('error', () => lobby.close(cs));
  });

  // protocol level keepalive (Cloudflare idles out around 100 s)
  const keepalive = setInterval(() => {
    for (const ws of wss.clients as Set<Live>) {
      if (ws.alive === false) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 15000);

  return new Promise((resolve) => {
    server.listen(opts.port ?? 8787, '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8787);
      if (!opts.quiet) {
        const proto = tls ? 'https' : 'http';
        console.log(`[holdfast] listening on ${proto}://0.0.0.0:${port}`);
        for (const list of Object.values(os.networkInterfaces())) {
          for (const ni of list ?? []) {
            if (ni.family === 'IPv4' && !ni.internal) console.log(`[holdfast] LAN: ${proto}://${ni.address}:${port}`);
          }
        }
      }
      resolve({
        port,
        lobby,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(keepalive);
            lobby.shutdown();
            for (const c of wss.clients) c.terminate();
            wss.close(() => server.close(() => res()));
          }),
      });
    });
  });
}
