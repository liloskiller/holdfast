import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const serverPort = Number(process.env['HOLDFAST_SERVER_PORT'] ?? 8787);
const useHttps = process.env['HOLDFAST_HTTPS'] !== '0';

export default defineConfig({
  base: './',
  plugins: useHttps ? [basicSsl()] : [],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true, secure: false, changeOrigin: true },
      '/health': { target: `http://localhost:${serverPort}`, changeOrigin: true },
    },
  },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  resolve: { preserveSymlinks: false },
});
