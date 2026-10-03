// Node bootstrap: starts the HOLDFAST server (static client + WebSocket on one port).
import { loadTlsFromEnv, startServer } from './app';

const port = Number(process.env['PORT'] ?? 8787);
const running = await startServer({ port, tls: loadTlsFromEnv() });

function shutdown(): void {
  void running.close().then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
