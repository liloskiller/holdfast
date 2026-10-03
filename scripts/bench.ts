// Server tick benchmark: 10 players on Safehouse with scripted movement and shooting.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Btn, GameMode, PhaseId, cmdFor, decodeServer, encodeServer } from '@holdfast/shared';
import { Room } from '../server/src/Room';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapText = fs.readFileSync(path.join(root, 'shared', 'maps', 'safehouse.map.txt'), 'utf8');

let bytes = 0;
let msgs = 0;
const room = new Room('BENCH', mapText, { settings: { mode: GameMode.ELIMINATION, prepTime: 5, actionTime: 600, operatorSelectTime: 5, roundsToWin: 9 }, clock: () => 0 });
const players = [];
for (let i = 0; i < 10; i++) {
  const conn = {
    send: (d: string): void => {
      bytes += d.length;
      msgs++;
    },
    close: (): void => undefined,
  };
  const p = room.addPlayer('P' + i, conn);
  if (!p) throw new Error('full');
  p.team = (i % 2) as 0 | 1;
  players.push(p);
}
room.handleMessage(players[0]!, { t: 'START_MATCH' });
room.advance(5100);
room.advance(5100);
if (room.phase !== PhaseId.ACTION) throw new Error('not in action: ' + room.phase);

const times: number[] = [];
bytes = 0;
msgs = 0;
const ticks = 60 * 30;
let seq = 0;
for (let t = 0; t < ticks; t++) {
  for (const [i, p] of players.entries()) {
    const cmd = cmdFor(p.state, {
      moveZ: 1,
      moveX: Math.sin((t + i * 40) / 50),
      yaw: p.state.yaw + Math.sin((t + i * 13) / 70) * 0.03,
      buttons: (t + i * 7) % 90 < 20 ? Btn.FIRE : 0,
    });
    cmd.seq = ++seq;
    cmd.clientTime = room.time;
    p.queue.push(cmd);
    p.lastQueuedSeq = cmd.seq;
  }
  const t0 = performance.now();
  room.advance(1000 / 60);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const snapshots = msgs;
console.log(`players 10, ticks ${ticks}`);
console.log(`tick ms: avg ${avg.toFixed(3)}  p50 ${times[Math.floor(times.length * 0.5)]!.toFixed(3)}  p99 ${times[Math.floor(times.length * 0.99)]!.toFixed(3)}  max ${times[times.length - 1]!.toFixed(3)}`);
console.log(`downstream per player: ${(bytes / 10 / 30 / 1024).toFixed(1)} KB/s  (${(bytes / snapshots).toFixed(0)} bytes per message)`);
void decodeServer;
void encodeServer;
