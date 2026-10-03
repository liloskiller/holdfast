// Dev helper: serves the built client with the tiny test arena map on port 8788 (for browser tests).
import { arenaMapText } from '@holdfast/shared';
import { startServer } from '../server/src/app';

const s = await startServer({ port: Number(process.env['PORT'] ?? 8788), mapText: arenaMapText({ nx: 60, nz: 30 }) });
console.log('arena server on', s.port);
