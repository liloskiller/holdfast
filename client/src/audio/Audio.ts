// Fully synthesized audio. Sound effects are generated into AudioBuffers at boot (no files),
// played through PannerNodes for positional audio, with a low pass filter when a wall is in the way.

import { settings, isTouchDevice } from '../settings';

type Gen = (sr: number) => Float32Array;

// ---------------------------------------------------------------------------
// Tiny DSP toolkit
// ---------------------------------------------------------------------------

let noiseSeed = 987654321;
function rnd(): number {
  noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
  return noiseSeed / 2147483648 - 1;
}


function noise(n: number): Float32Array {
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = rnd();
  return o;
}

function expEnv(n: number, sr: number, decayMs: number, attackMs = 1): Float32Array {
  const o = new Float32Array(n);
  const a = Math.max(1, (attackMs / 1000) * sr);
  const d = (decayMs / 1000) * sr;
  for (let i = 0; i < n; i++) o[i] = (i < a ? i / a : 1) * Math.exp(-(i - Math.min(i, a)) / d);
  return o;
}

function lowpass(x: Float32Array, fc: number, sr: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    y += a * ((x[i] as number) - y);
    o[i] = y;
  }
  return o;
}

function highpass(x: Float32Array, fc: number, sr: number): Float32Array {
  const lp = lowpass(x, fc, sr);
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = (x[i] as number) - (lp[i] as number);
  return o;
}

function bandpass(x: Float32Array, lo: number, hi: number, sr: number): Float32Array {
  return lowpass(highpass(x, lo, sr), hi, sr);
}

function osc(n: number, sr: number, freq: (t: number) => number, shape: 'sine' | 'saw' | 'square' = 'sine'): Float32Array {
  const o = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * freq(i / sr)) / sr;
    if (shape === 'sine') o[i] = Math.sin(ph);
    else if (shape === 'saw') o[i] = ((ph / Math.PI) % 2) - 1;
    else o[i] = Math.sin(ph) > 0 ? 1 : -1;
  }
  return o;
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const n = Math.min(a.length, b.length);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = (a[i] as number) * (b[i] as number);
  return o;
}

function mix(len: number, parts: [Float32Array, number][], offsets: number[] = []): Float32Array {
  const o = new Float32Array(len);
  parts.forEach(([p, g], k) => {
    const off = offsets[k] ?? 0;
    for (let i = 0; i < p.length && i + off < len; i++) o[i + off] = (o[i + off] as number) + (p[i] as number) * g;
  });
  // soft clip
  for (let i = 0; i < len; i++) o[i] = Math.tanh((o[i] as number) * 1.1);
  return o;
}

function tone(sr: number, ms: number, freq: number, decayMs: number, gain = 0.5): Float32Array {
  const n = Math.floor((ms / 1000) * sr);
  return mix(n, [[mul(osc(n, sr, () => freq), expEnv(n, sr, decayMs, 2)), gain]]);
}

function gunshot(sr: number, o: { crack: number; body: number; thump: number; decay: number; tail: number; hp: number; lpc: number }): Float32Array {
  const n = Math.floor(sr * (o.decay + o.tail) / 1000 + sr * 0.05);
  const crack = mul(highpass(noise(n), o.hp, sr), expEnv(n, sr, 14));
  const body = mul(lowpass(noise(n), o.lpc, sr), expEnv(n, sr, o.decay));
  const thump = mul(osc(n, sr, (t) => 120 * Math.exp(-t * 18) + 42), expEnv(n, sr, o.decay * 0.9));
  const tail = mul(lowpass(noise(n), 500, sr), expEnv(n, sr, o.tail, 20));
  return mix(n, [[crack, o.crack], [body, o.body], [thump, o.thump], [tail, 0.25]]);
}

function stepSound(sr: number, kind: 'wood' | 'concrete' | 'metal'): Float32Array {
  const n = Math.floor(sr * 0.16);
  if (kind === 'metal') {
    const ring = mul(osc(n, sr, () => 520 + rnd() * 6), expEnv(n, sr, 70));
    const click = mul(highpass(noise(n), 2500, sr), expEnv(n, sr, 12));
    return mix(n, [[ring, 0.25], [click, 0.5]]);
  }
  if (kind === 'concrete') {
    const scuff = mul(bandpass(noise(n), 1200, 5000, sr), expEnv(n, sr, 28));
    const thud = mul(osc(n, sr, () => 95), expEnv(n, sr, 40));
    return mix(n, [[scuff, 0.55], [thud, 0.3]]);
  }
  const knock = mul(lowpass(noise(n), 900, sr), expEnv(n, sr, 35));
  const thud = mul(osc(n, sr, (t) => 140 * Math.exp(-t * 20) + 70), expEnv(n, sr, 55));
  return mix(n, [[knock, 0.6], [thud, 0.5]]);
}

const GENERATORS: Record<string, Gen> = {
  shot_carbine: (sr) => gunshot(sr, { crack: 0.9, body: 0.8, thump: 0.7, decay: 90, tail: 220, hp: 1800, lpc: 1600 }),
  shot_rattler: (sr) => gunshot(sr, { crack: 1.0, body: 0.55, thump: 0.45, decay: 60, tail: 140, hp: 2600, lpc: 2200 }),
  shot_hammer: (sr) => gunshot(sr, { crack: 0.7, body: 1.0, thump: 1.0, decay: 170, tail: 320, hp: 900, lpc: 1100 }),
  shot_marksman: (sr) => gunshot(sr, { crack: 1.0, body: 0.9, thump: 0.8, decay: 130, tail: 420, hp: 1500, lpc: 1400 }),
  shot_sidearm: (sr) => gunshot(sr, { crack: 1.0, body: 0.6, thump: 0.5, decay: 70, tail: 160, hp: 2200, lpc: 1900 }),
  reload: (sr) => {
    const n = Math.floor(sr * 0.5);
    const c1 = mul(highpass(noise(n), 2200, sr), expEnv(n, sr, 10));
    const c2 = mul(bandpass(noise(n), 800, 3200, sr), expEnv(n, sr, 18));
    const ping = mul(osc(n, sr, () => 1500), expEnv(n, sr, 30));
    return mix(n, [[c1, 0.6], [ping, 0.12], [c2, 0.7], [c1, 0.5]], [0, 0, Math.floor(sr * 0.18), Math.floor(sr * 0.34)]);
  },
  hit: (sr) => tone(sr, 70, 1900, 22, 0.55),
  headshot: (sr) => {
    const n = Math.floor(sr * 0.3);
    return mix(n, [[mul(osc(n, sr, () => 1250), expEnv(n, sr, 90)), 0.5], [mul(osc(n, sr, () => 2500), expEnv(n, sr, 70)), 0.3]]);
  },
  kill: (sr) => {
    const n = Math.floor(sr * 0.4);
    return mix(n, [[mul(osc(n, sr, () => 880), expEnv(n, sr, 110)), 0.5], [mul(osc(n, sr, () => 1320), expEnv(n, sr, 150)), 0.35]], [0, Math.floor(sr * 0.07)]);
  },
  hurt: (sr) => {
    const n = Math.floor(sr * 0.25);
    return mix(n, [[mul(osc(n, sr, (t) => 150 - t * 120), expEnv(n, sr, 80)), 0.8], [mul(lowpass(noise(n), 700, sr), expEnv(n, sr, 50)), 0.5]]);
  },
  step_wood: (sr) => stepSound(sr, 'wood'),
  step_concrete: (sr) => stepSound(sr, 'concrete'),
  step_metal: (sr) => stepSound(sr, 'metal'),
  door_open: (sr) => {
    const n = Math.floor(sr * 0.5);
    const creak = mul(osc(n, sr, (t) => 180 + 90 * Math.sin(t * 22) + t * 120, 'saw'), expEnv(n, sr, 260, 30));
    return mix(n, [[lowpass(creak, 900, sr), 0.35], [mul(lowpass(noise(n), 400, sr), expEnv(n, sr, 120)), 0.25]]);
  },
  door_close: (sr) => {
    const n = Math.floor(sr * 0.3);
    return mix(n, [[mul(osc(n, sr, (t) => 110 * Math.exp(-t * 12) + 55), expEnv(n, sr, 90)), 0.9], [mul(lowpass(noise(n), 600, sr), expEnv(n, sr, 40)), 0.6]]);
  },
  glass: (sr) => {
    const n = Math.floor(sr * 0.7);
    const parts: [Float32Array, number][] = [[mul(highpass(noise(n), 3000, sr), expEnv(n, sr, 160)), 0.7]];
    const offs: number[] = [0];
    for (let i = 0; i < 7; i++) {
      parts.push([mul(osc(n, sr, () => 2400 + rnd() * 2500), expEnv(n, sr, 60, 1)), 0.18]);
      offs.push(Math.floor(sr * (0.02 + i * 0.045 + Math.abs(rnd()) * 0.03)));
    }
    return mix(n, parts, offs);
  },
  wall: (sr) => {
    const n = Math.floor(sr * 0.45);
    return mix(n, [[mul(osc(n, sr, (t) => 90 * Math.exp(-t * 10) + 45), expEnv(n, sr, 160)), 0.9], [mul(lowpass(noise(n), 1500, sr), expEnv(n, sr, 110)), 0.7], [mul(highpass(noise(n), 2500, sr), expEnv(n, sr, 30)), 0.3]]);
  },
  breach: (sr) => {
    const n = Math.floor(sr * 1.6);
    return mix(n, [
      [mul(osc(n, sr, (t) => 70 * Math.exp(-t * 4) + 28), expEnv(n, sr, 520)), 1.0],
      [mul(lowpass(noise(n), 1400, sr), expEnv(n, sr, 380)), 0.9],
      [mul(highpass(noise(n), 1800, sr), expEnv(n, sr, 80)), 0.5],
      [mul(lowpass(noise(n), 300, sr), expEnv(n, sr, 900, 30)), 0.5],
    ]);
  },
  barricade: (sr) => {
    const n = Math.floor(sr * 0.28);
    return mix(n, [[mul(lowpass(noise(n), 1200, sr), expEnv(n, sr, 40)), 0.8], [mul(osc(n, sr, () => 190), expEnv(n, sr, 60)), 0.5]]);
  },
  reinforce: (sr) => {
    const n = Math.floor(sr * 0.25);
    return mix(n, [[mul(osc(n, sr, () => 760 + rnd() * 10), expEnv(n, sr, 55)), 0.4], [mul(highpass(noise(n), 3000, sr), expEnv(n, sr, 15)), 0.6]]);
  },
  metal: (sr) => {
    const n = Math.floor(sr * 0.35);
    return mix(n, [[mul(osc(n, sr, () => 1320), expEnv(n, sr, 120)), 0.35], [mul(osc(n, sr, () => 2050), expEnv(n, sr, 80)), 0.25], [mul(highpass(noise(n), 3500, sr), expEnv(n, sr, 12)), 0.6]]);
  },
  melee: (sr) => {
    const n = Math.floor(sr * 0.25);
    const sweep = mul(bandpass(noise(n), 500, 4000, sr), expEnv(n, sr, 70, 40));
    return mix(n, [[sweep, 0.7]]);
  },
  vault: (sr) => {
    const n = Math.floor(sr * 0.45);
    return mix(n, [[mul(bandpass(noise(n), 400, 2500, sr), expEnv(n, sr, 160, 80)), 0.5], [mul(osc(n, sr, () => 90), expEnv(n, sr, 60)), 0.4]], [0, Math.floor(sr * 0.25)]);
  },
  gadget: (sr) => {
    const n = Math.floor(sr * 0.2);
    return mix(n, [[mul(osc(n, sr, () => 1100, 'square'), expEnv(n, sr, 25)), 0.18], [mul(highpass(noise(n), 3000, sr), expEnv(n, sr, 12)), 0.5]]);
  },
  trap: (sr) => {
    const n = Math.floor(sr * 0.4);
    return mix(n, [[mul(osc(n, sr, () => 1760), expEnv(n, sr, 100)), 0.4], [mul(highpass(noise(n), 2500, sr), expEnv(n, sr, 40)), 0.7], [mul(osc(n, sr, () => 120), expEnv(n, sr, 120)), 0.5]]);
  },
  ping: (sr) => {
    const n = Math.floor(sr * 0.5);
    return mix(n, [[mul(osc(n, sr, () => 1480), expEnv(n, sr, 200)), 0.5], [mul(osc(n, sr, () => 740), expEnv(n, sr, 260)), 0.3]]);
  },
  boom: (sr) => GENERATORS['breach']!(sr),
  ui: (sr) => tone(sr, 50, 900, 18, 0.4),
  uiback: (sr) => tone(sr, 60, 520, 24, 0.4),
  beep: (sr) => tone(sr, 110, 880, 70, 0.5),
  go: (sr) => {
    const n = Math.floor(sr * 0.6);
    return mix(n, [[mul(osc(n, sr, () => 660, 'square'), expEnv(n, sr, 140)), 0.2], [mul(osc(n, sr, () => 990, 'square'), expEnv(n, sr, 220)), 0.2]], [0, Math.floor(sr * 0.14)]);
  },
  roundstart: (sr) => {
    const n = Math.floor(sr * 1.2);
    const notes = [392, 494, 587, 784];
    return mix(n, notes.map((f) => [mul(osc(n, sr, () => f, 'saw'), expEnv(n, sr, 260)), 0.16] as [Float32Array, number]), notes.map((_, i) => Math.floor(sr * i * 0.11)));
  },
  roundend: (sr) => {
    const n = Math.floor(sr * 1.2);
    const notes = [587, 494, 392, 294];
    return mix(n, notes.map((f) => [mul(osc(n, sr, () => f, 'saw'), expEnv(n, sr, 300)), 0.16] as [Float32Array, number]), notes.map((_, i) => Math.floor(sr * i * 0.14)));
  },
  empty: (sr) => tone(sr, 40, 300, 14, 0.3),
};

export type SoundName = keyof typeof GENERATORS | string;

export interface PlayOpts {
  pos?: { x: number; y: number; z: number };
  gain?: number;
  rate?: number;
  occluded?: boolean;
  /** Far away sounds get filtered. */
  maxDist?: number;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private pending: string[] = [];
  private voices = 0;
  private hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  private heart = false;
  ready = false;
  private touch = isTouchDevice();

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      this.pending = Object.keys(GENERATORS);
      this.generateNext();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  private generateNext(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < 12) {
      const name = this.pending.shift() as string;
      const data = (GENERATORS[name] as Gen)(ctx.sampleRate);
      const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(name, buf);
    }
    if (this.pending.length) setTimeout(() => this.generateNext(), 0);
    else this.ready = true;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.sfx.gain.value = settings.sfx;
  }

  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  play(name: SoundName, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf || this.voices > 28) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 1;
    let tail: AudioNode = src;
    if (opts.occluded) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 800;
      tail.connect(f);
      tail = f;
      gain.gain.value *= 0.6;
    }
    if (opts.pos) {
      const p = ctx.createPanner();
      p.panningModel = this.touch ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.maxDistance = opts.maxDist ?? 80;
      p.rolloffFactor = 1.25;
      if (p.positionX) {
        p.positionX.value = opts.pos.x;
        p.positionY.value = opts.pos.y;
        p.positionZ.value = opts.pos.z;
      } else {
        (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      }
      tail.connect(p);
      p.connect(gain);
    } else {
      tail.connect(gain);
    }
    gain.connect(this.sfx);
    this.voices++;
    src.onended = (): void => {
      this.voices--;
      src.disconnect();
      gain.disconnect();
    };
    src.start();
  }

  /** Non positional UI sound. */
  ui(name: SoundName, gain = 0.7): void {
    this.play(name, { gain });
  }

  /** Continuous drone propeller hum while piloting. */
  setHum(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.hum) {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'sawtooth';
      o1.frequency.value = 138;
      o2.frequency.value = 141.5;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      o1.start();
      o2.start();
      this.hum = { osc: o1, osc2: o2, gain: g };
    } else if (!on && this.hum) {
      this.hum.osc.stop();
      this.hum.osc2.stop();
      this.hum.gain.disconnect();
      this.hum = null;
    }
  }

  setHeart(on: boolean): void {
    this.heart = on;
  }

  get isHeart(): boolean {
    return this.heart;
  }
}
