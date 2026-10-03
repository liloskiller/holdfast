import { settings, saveSettings, isTouchDevice, type Quality } from '../settings';
import { btn, clear, el } from './dom';

export interface SettingsHooks {
  onClose(): void;
  onGyro(on: boolean): Promise<boolean>;
}

export class SettingsScreen {
  readonly root: HTMLDivElement;
  private body: HTMLElement;

  constructor(parent: HTMLElement, private hooks: SettingsHooks) {
    this.root = el('div', 'screen settings hidden', undefined, parent);
    const card = el('div', 'panel', undefined, this.root);
    el('div', 'panel-title', 'SETTINGS', card);
    this.body = el('div', 'panel-body', undefined, card);
    btn('DONE', 'btn primary', () => this.hooks.onClose(), card);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (on) this.render();
  }

  private slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): void {
    const row = el('label', 'srow', undefined, this.body);
    el('span', '', label, row);
    const val = el('span', 'sval', fmt(get()), row);
    const inp = el('input', 'range', undefined, row);
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(get());
    inp.addEventListener('input', () => {
      set(Number(inp.value));
      val.textContent = fmt(get());
      saveSettings();
    });
  }

  private toggle(label: string, get: () => boolean, set: (v: boolean) => Promise<boolean> | boolean | void): void {
    const row = el('label', 'srow', undefined, this.body);
    el('span', '', label, row);
    const cb = el('input', 'check', undefined, row);
    cb.type = 'checkbox';
    cb.checked = get();
    cb.addEventListener('change', async () => {
      const r = await set(cb.checked);
      if (r === false) cb.checked = false;
      saveSettings();
    });
  }

  private render(): void {
    clear(this.body);
    el('div', 'sgroup', 'LOOK AND AIM', this.body);
    this.slider('Look sensitivity', 0.2, 3, 0.05, () => settings.sens, (v) => (settings.sens = v), (v) => v.toFixed(2));
    this.slider('Field of view (horizontal)', 70, 110, 1, () => settings.fov, (v) => (settings.fov = v), (v) => String(Math.round(v)));
    this.toggle('Invert Y', () => settings.invertY, (v) => { settings.invertY = v; });
    this.toggle('Toggle aim (instead of hold)', () => settings.adsToggle, (v) => { settings.adsToggle = v; });
    this.toggle('Aim assist (touch)', () => settings.aimAssist, (v) => { settings.aimAssist = v; });
    el('div', 'sgroup', 'GRAPHICS', this.body);
    const row = el('label', 'srow', undefined, this.body);
    el('span', '', 'Quality', row);
    const sel = el('select', 'input', undefined, row);
    for (const q of ['low', 'medium', 'high'] as Quality[]) {
      const o = el('option', '', q.toUpperCase(), sel);
      o.value = q;
      if (settings.quality === q) o.selected = true;
    }
    sel.addEventListener('change', () => {
      settings.quality = sel.value as Quality;
      saveSettings();
    });
    this.toggle('Show FPS / stats', () => settings.showFps, (v) => { settings.showFps = v; });
    el('div', 'sgroup', 'AUDIO', this.body);
    this.slider('Master volume', 0, 1, 0.05, () => settings.master, (v) => (settings.master = v), (v) => Math.round(v * 100) + '%');
    this.slider('Effects volume', 0, 1, 0.05, () => settings.sfx, (v) => (settings.sfx = v), (v) => Math.round(v * 100) + '%');
    if (isTouchDevice()) {
      el('div', 'sgroup', 'TOUCH', this.body);
      this.slider('Button size', 0.8, 1.4, 0.05, () => settings.touchScale, (v) => (settings.touchScale = v), (v) => Math.round(v * 100) + '%');
      this.toggle('Left handed layout', () => settings.leftHanded, (v) => { settings.leftHanded = v; });
      this.toggle('Vibration', () => settings.haptics, (v) => { settings.haptics = v; });
      this.toggle('Gyro aim (experimental)', () => settings.gyro, async (v) => {
        if (v) {
          const ok = await this.hooks.onGyro(true);
          settings.gyro = ok;
          return ok;
        }
        settings.gyro = false;
        return true;
      });
    }
  }
}
