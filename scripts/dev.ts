// Starts the game server (tsx watch) and the Vite dev server together.
// Vite serves over HTTPS (self signed) and proxies /ws to the game server, so phones on the LAN
// get a secure context (needed for wake lock, gyro and installing the PWA).

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrEncode, qrToTerminal } from '@holdfast/shared';
import { lanAddresses } from './net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPort = process.env['HOLDFAST_SERVER_PORT'] ?? '8787';
const children: ChildProcess[] = [];

function run(name: string, args: string[], cwd: string, env: Record<string, string>): void {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

function shutdown(code: number): void {
  for (const c of children) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch', 'server/src/index.ts'], root, { PORT: serverPort, HTTPS: '0' });
run('client', [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], path.join(root, 'client'), { HOLDFAST_SERVER_PORT: serverPort });

setTimeout(() => {
  const ips = lanAddresses();
  console.log('\n[dev] Desktop:  https://localhost:5173');
  if (ips.length) {
    const url = `https://${ips[0]}:5173/`;
    console.log(`[dev] Phones on the same Wi-Fi: ${url}`);
    console.log('[dev] The browser warns about the self signed certificate once: Advanced > Proceed.\n');
    console.log(qrToTerminal(qrEncode(url)));
  }
}, 2500);
