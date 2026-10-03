// Generates the PWA icons (pure Node, no dependencies). Run: npx tsx scripts/make-icons.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'client', 'public');

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] as number;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Rgb = [number, number, number];
const BG: Rgb = [16, 18, 20];
const ORANGE: Rgb = [255, 122, 26];
const CYAN: Rgb = [24, 200, 255];
const WHITE: Rgb = [236, 240, 243];

/** Shapes in a 0..1 square. Returns a color or null. */
function sample(u: number, v: number, maskable: boolean): Rgb | null {
  // rounded square background (maskable icons fill the whole square)
  if (!maskable) {
    const r = 0.2;
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return null;
  }
  const s = maskable ? 0.74 : 1; // keep the mark inside the safe zone for maskable
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;
  // letter H built from bars, with an orange crossbar breach gap and a cyan marker
  const inRect = (x0: number, y0: number, x1: number, y1: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (inRect(0.24, 0.24, 0.35, 0.76) || inRect(0.65, 0.24, 0.76, 0.76)) return WHITE;
  if (inRect(0.35, 0.44, 0.65, 0.56)) return ORANGE;
  if (inRect(0.24, 0.8, 0.76, 0.86)) return CYAN;
  return BG;
}

function render(size: number, maskable: boolean): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const ss = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
        rgba[o + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return png(size, rgba);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, false));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), render(512, true));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, true));
console.log('icons written to', out);
