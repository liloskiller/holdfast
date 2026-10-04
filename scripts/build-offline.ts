// Builds ONE self-contained html file (JS, CSS and icon inlined) for solo Practice with no server and
// no network. Open dist-offline/holdfast.html straight from disk, or copy it to a phone or USB stick.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = path.join(root, 'client');
const outDir = path.join(client, 'dist-offline');

fs.rmSync(outDir, { recursive: true, force: true });
const build = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: client,
  stdio: 'inherit',
  env: { ...process.env, HOLDFAST_OFFLINE: '1' },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const leftovers = fs.readdirSync(outDir).filter((f) => f !== 'index.html');
if (leftovers.length) {
  console.error('[offline] expected a single file but the build also produced: ' + leftovers.join(', '));
  process.exit(1);
}

const dest = path.join(root, 'dist-offline');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
const file = path.join(dest, 'holdfast.html');
fs.copyFileSync(path.join(outDir, 'index.html'), file);
fs.rmSync(outDir, { recursive: true, force: true });

const kb = Math.round(fs.statSync(file).size / 1024);
console.log(`\n[offline] wrote ${path.relative(root, file)} (${kb} KB)`);
console.log('[offline] Double click it (Chrome, Edge, Firefox, Safari) for a solo match vs bots or Practice. No server, no internet.');
console.log('[offline] Multiplayer still needs the server: npm run lan');
