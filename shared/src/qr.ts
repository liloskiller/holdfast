// Minimal QR code encoder (byte mode, error correction level M, versions 1 to 10).
// Used for the lobby join link and the terminal output of `npm run lan`.

interface VersionInfo {
  dataCodewords: number;
  ecPerBlock: number;
  /** [blockCount, dataPerBlock] groups */
  groups: [number, number][];
}

// Level M
const VERSIONS: (VersionInfo | null)[] = [
  null,
  { dataCodewords: 16, ecPerBlock: 10, groups: [[1, 16]] },
  { dataCodewords: 28, ecPerBlock: 16, groups: [[1, 28]] },
  { dataCodewords: 44, ecPerBlock: 26, groups: [[1, 44]] },
  { dataCodewords: 64, ecPerBlock: 18, groups: [[2, 32]] },
  { dataCodewords: 86, ecPerBlock: 24, groups: [[2, 43]] },
  { dataCodewords: 108, ecPerBlock: 16, groups: [[4, 27]] },
  { dataCodewords: 124, ecPerBlock: 18, groups: [[4, 31]] },
  { dataCodewords: 154, ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { dataCodewords: 182, ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { dataCodewords: 216, ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
];

const ALIGN: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// ---- Reed-Solomon over GF(256), primitive polynomial 0x11D ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] as number) ^ gfMul(poly[j] as number, 1);
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j] as number, EXP[i] as number);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGenerator(ecCount);
  const res = new Array<number>(ecCount).fill(0);
  for (const d of data) {
    const factor = d ^ (res.shift() as number);
    res.push(0);
    for (let i = 0; i < ecCount; i++) res[i] = (res[i] as number) ^ gfMul(gen[i + 1] as number, factor);
  }
  return res;
}

function utf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function bchFormat(data: number): number {
  let v = data << 10;
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
  return ((data << 10) | v) ^ 0x5412;
}

function bchVersion(ver: number): number {
  let v = ver << 12;
  for (let i = 17; i >= 12; i--) if ((v >> i) & 1) v ^= 0x1f25 << (i - 12);
  return (ver << 12) | v;
}

export interface QrCode {
  size: number;
  /** modules[y][x] true = dark */
  modules: boolean[][];
  version: number;
}

export function qrEncode(text: string): QrCode {
  const bytes = utf8(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const info = VERSIONS[v] as VersionInfo;
    const lenBits = v < 10 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= info.dataCodewords * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error('QR payload too long (max 213 bytes)');
  const info = VERSIONS[version] as VersionInfo;

  // ---- data bits ----
  const bits: number[] = [];
  const put = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = info.dataCodewords * 8;
  put(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] as number);
    data.push(b);
  }
  for (let pad = 0; data.length < info.dataCodewords; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);

  // ---- blocks + error correction ----
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let pos = 0;
  for (const [count, size] of info.groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(pos, pos + size);
      pos += size;
      blocks.push(block);
      ecBlocks.push(rsEncode(block, info.ecPerBlock));
    }
  }
  const codewords: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) codewords.push(b[i] as number);
  for (let i = 0; i < info.ecPerBlock; i++) for (const b of ecBlocks) codewords.push(b[i] as number);

  // ---- matrix ----
  const size = version * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setM = (x: number, y: number, dark: boolean, reserve = true): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    mod[y]![x] = dark;
    if (reserve) reserved[y]![x] = true;
  };

  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setM(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 8; i < size - 8; i++) {
    setM(i, 6, i % 2 === 0);
    setM(6, i, i % 2 === 0);
  }
  const al = ALIGN[version] as number[];
  for (const ay of al) {
    for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ax === al[al.length - 1] && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setM(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  setM(8, size - 8, true); // dark module
  // reserve format areas
  for (let i = 0; i < 9; i++) {
    setM(8, i, false);
    setM(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    setM(size - 1 - i, 8, false);
    setM(8, size - 1 - i, false);
  }
  setM(8, size - 8, true);
  if (version >= 7) {
    const v = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setM(a, b, bit);
      setM(b, a, bit);
    }
  }

  // ---- place data bits (zigzag) ----
  const dataBits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);
  let bi = 0;
  let up = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (let dx = 0; dx < 2; dx++) {
        const xx = x - dx;
        if (reserved[y]![xx]) continue;
        mod[y]![xx] = bi < dataBits.length ? dataBits[bi++] === 1 : false;
      }
    }
    up = !up;
  }

  // ---- masking ----
  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  const build = (mask: number): boolean[][] => {
    const out = mod.map((row) => row.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y]![x] && (maskFn[mask] as (x: number, y: number) => boolean)(x, y)) out[y]![x] = !out[y]![x];
      }
    }
    // format info (level M = 0b00)
    const fmt = bchFormat((0b00 << 3) | mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((fmt >> i) & 1) === 1;
      // around the top left finder
      if (i < 6) out[i]![8] = bit;
      else if (i < 8) out[i + 1]![8] = bit;
      else if (i === 8) out[8]![7] = bit;
      else out[8]![14 - i] = bit;
      // split between top right and bottom left
      if (i < 8) out[8]![size - 1 - i] = bit;
      else out[size - 15 + i]![8] = bit;
    }
    out[size - 8]![8] = true;
    return out;
  };

  const penalty = (m: boolean[][]): number => {
    let p = 0;
    for (let y = 0; y < size; y++) {
      let runX = 1;
      let runY = 1;
      for (let x = 1; x < size; x++) {
        if (m[y]![x] === m[y]![x - 1]) runX++;
        else { if (runX >= 5) p += runX - 2; runX = 1; }
        if (m[x]![y] === m[x - 1]![y]) runY++;
        else { if (runY >= 5) p += runY - 2; runY = 1; }
      }
      if (runX >= 5) p += runX - 2;
      if (runY >= 5) p += runY - 2;
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3;
      }
    }
    const pat = [true, false, true, true, true, false, true];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x + 6 < size; x++) {
        let h = true;
        let v = true;
        for (let k = 0; k < 7; k++) {
          if (m[y]![x + k] !== pat[k]) h = false;
          if (m[x + k]![y] !== pat[k]) v = false;
        }
        if (h) p += 40;
        if (v) p += 40;
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y]![x]) dark++;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };

  let best = build(0);
  let bestScore = penalty(best);
  for (let mk = 1; mk < 8; mk++) {
    const cand = build(mk);
    const sc = penalty(cand);
    if (sc < bestScore) { best = cand; bestScore = sc; }
  }
  return { size, modules: best, version };
}

/** Render to a compact terminal string using half block characters. */
export function qrToTerminal(qr: QrCode, quiet = 2): string {
  const n = qr.size + quiet * 2;
  const dark = (x: number, y: number): boolean => {
    const xx = x - quiet;
    const yy = y - quiet;
    if (xx < 0 || yy < 0 || xx >= qr.size || yy >= qr.size) return false;
    return qr.modules[yy]![xx] === true;
  };
  const lines: string[] = [];
  for (let y = 0; y < n; y += 2) {
    let line = '';
    for (let x = 0; x < n; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      // white background terminals: invert so dark modules print as blocks
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
