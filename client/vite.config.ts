import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const serverPort = Number(process.env['HOLDFAST_SERVER_PORT'] ?? 8787);
const useHttps = process.env['HOLDFAST_HTTPS'] !== '0';
// HOLDFAST_OFFLINE=1 (npm run build:offline) builds ONE html file with everything inlined, for solo Practice.
const offline = process.env['HOLDFAST_OFFLINE'] === '1';

/** Normal build: tell the service worker exactly which files to cache so the game reopens with no network. */
function precachePlugin(): Plugin {
  let outDir = '';
  return {
    name: 'holdfast-precache',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    writeBundle() {
      const files: string[] = [];
      const walk = (dir: string, rel: string): void => {
        for (const f of fs.readdirSync(dir)) {
          const abs = path.join(dir, f);
          const r = rel ? `${rel}/${f}` : f;
          if (fs.statSync(abs).isDirectory()) walk(abs, r);
          else if (r !== 'sw.js') files.push(r);
        }
      };
      walk(outDir, '');
      files.sort();
      const hash = createHash('sha1');
      for (const f of files) hash.update(f).update(fs.readFileSync(path.join(outDir, f)));
      const swPath = path.join(outDir, 'sw.js');
      const sw = fs
        .readFileSync(swPath, 'utf8')
        .replace('/*__PRECACHE__*/[]', JSON.stringify(['./', ...files]))
        .replace('__BUILD__', hash.digest('hex').slice(0, 10));
      fs.writeFileSync(swPath, sw);
    },
  };
}

/** Offline build: inline the JS, the CSS and the favicon into index.html so it runs from file://. */
function singleFilePlugin(): Plugin {
  return {
    name: 'holdfast-single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const htmlKey = Object.keys(bundle).find((k) => k.endsWith('.html'));
      const html = htmlKey ? bundle[htmlKey] : undefined;
      if (!html || html.type !== 'asset') throw new Error('single-file: index.html not found in bundle');
      let src = String(html.source);
      for (const [key, out] of Object.entries(bundle)) {
        if (out.type === 'chunk' && out.isEntry) {
          // "</script" inside the code would end the inline tag early
          const code = out.code.replace(/<\/script/gi, '<\\/script');
          if (code.includes('<!--')) throw new Error('single-file: "<!--" in the bundle would confuse the HTML parser');
          const tag = new RegExp(`<script[^>]*src="[^"]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`);
          if (!tag.test(src)) throw new Error('single-file: entry script tag not found');
          src = src.replace(tag, () => '');
          src = src.replace('</body>', () => `<script type="module">${code}</script></body>`);
          delete bundle[key];
        } else if (out.type === 'asset' && key.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
          if (!tag.test(src)) throw new Error('single-file: stylesheet tag not found');
          src = src.replace(tag, () => `<style>${String(out.source)}</style>`);
          delete bundle[key];
        } else if (out.type === 'chunk') {
          throw new Error(`single-file: unexpected extra chunk ${key} (code splitting must be off)`);
        }
      }
      src = src.replace(/<link rel="(manifest|apple-touch-icon)"[^>]*>\s*/g, '');
      const icon = fs.readFileSync(path.resolve(import.meta.dirname, 'public/icon-192.png')).toString('base64');
      src = src.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="data:image/png;base64,${icon}" />`);
      html.source = src;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: offline ? [singleFilePlugin()] : [...(useHttps ? [basicSsl()] : []), precachePlugin()],
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
  publicDir: offline ? false : 'public',
  build: {
    outDir: offline ? 'dist-offline' : 'dist',
    ...(offline ? { assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false } : {}),
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  resolve: { preserveSymlinks: false },
});
