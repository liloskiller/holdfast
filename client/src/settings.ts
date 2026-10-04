// Persistent user settings. localStorage may be unavailable (private mode), so every access is guarded.

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  name: string;
  sens: number; // 0.2 .. 3
  fov: number; // horizontal degrees, 70 .. 110
  invertY: boolean;
  quality: Quality;
  aimAssist: boolean;
  master: number; // 0..1
  sfx: number; // 0..1
  touchScale: number; // 0.8 .. 1.4
  leftHanded: boolean;
  gyro: boolean;
  haptics: boolean;
  showFps: boolean;
  adsToggle: boolean;
  /** Solo match against bots: players per team, difficulty 0..2, 0 attack first / 1 defend first. */
  soloSize: number;
  soloDiff: number;
  soloSide: number;
}

export function isTouchDevice(): boolean {
  try {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  const touch = isTouchDevice();
  return {
    name: '',
    sens: touch ? 1.0 : 1.0,
    fov: 90,
    invertY: false,
    quality: touch ? 'medium' : 'high',
    aimAssist: touch,
    master: 0.8,
    sfx: 0.9,
    touchScale: 1.0,
    leftHanded: false,
    gyro: false,
    haptics: true,
    showFps: false,
    adsToggle: touch,
    soloSize: 3,
    soloDiff: 1,
    soloSide: 0,
  };
}

const KEY = 'holdfast.settings.v1';

export const settings: Settings = defaultSettings();
const listeners = new Set<() => void>();

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw) as Partial<Settings>);
  } catch {
    /* ignore */
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
