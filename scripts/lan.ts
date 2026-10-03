// One command LAN mode: builds the client, creates a self signed certificate for your LAN IPs
// (needs openssl), and serves the game plus websocket over HTTPS on a single port.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrEncode, qrToTerminal } from '@holdfast/shared';
import { startServer } from '../server/src/app';
import { lanAddresses } from './net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env['PORT'] ?? 8443);
const ips = lanAddresses();

console.log('[lan] building the client...');
const build = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: path.join(root, 'client'),
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const certDir = path.join(root, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');
const ipsPath = path.join(certDir, 'ips.json');

function ensureCert(): boolean {
  const wanted = JSON.stringify(ips);
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(ipsPath) && fs.readFileSync(ipsPath, 'utf8') === wanted) return true;
  fs.mkdirSync(certDir, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  const r = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '825', '-subj', '/CN=holdfast', '-addext', `subjectAltName=${san}`],
    { stdio: 'pipe' },
  );
  if (r.status !== 0) return false;
  fs.writeFileSync(ipsPath, wanted);
  return true;
}

const haveCert = ensureCert();
const tls = haveCert ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : null;
if (!tls) {
  console.log('[lan] openssl was not found, serving plain HTTP. Wake lock, gyro and PWA install need HTTPS.');
  console.log('[lan] Install mkcert/openssl, or use a Cloudflare Tunnel: cloudflared tunnel --url http://localhost:' + port);
}

const running = await startServer({ port, tls, quiet: true });
const proto = tls ? 'https' : 'http';
console.log(`\n[lan] HOLDFAST is running on ${proto}://localhost:${running.port}`);
if (!ips.length) console.log('[lan] No LAN address found. Are you connected to Wi-Fi?');
for (const ip of ips) console.log(`[lan] Friends on this network: ${proto}://${ip}:${running.port}`);
if (ips[0]) {
  console.log('\nScan with your phone camera:\n');
  console.log(qrToTerminal(qrEncode(`${proto}://${ips[0]}:${running.port}/`)));
}
if (tls) console.log('\nThe browser shows a certificate warning once (self signed): Advanced > Proceed.');
console.log('Tip: on iPhone use Share > Add to Home Screen for fullscreen play.\n');

process.on('SIGINT', () => void running.close().then(() => process.exit(0)));
