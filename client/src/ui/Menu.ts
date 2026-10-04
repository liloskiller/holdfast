// Main menu: name, practice, create room, join room, settings.

import { settings, saveSettings } from '../settings';
import type { SoloOptions } from '@holdfast/shared';
import { btn, el } from './dom';

export interface MenuHooks {
  onPractice(): void;
  onSolo(opts: SoloOptions): void;
  onCreate(): void;
  onJoin(code: string): void;
  onSettings(): void;
  onHelp(): void;
}

export class Menu {
  readonly root: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private err: HTMLElement;
  private busy = false;
  private buttons: HTMLButtonElement[] = [];
  private solo: HTMLDivElement;

  constructor(parent: HTMLElement, hooks: MenuHooks) {
    const root = el('div', 'screen menu hidden', undefined, parent);
    this.root = root;
    const card = el('div', 'menu-card', undefined, root);
    const logo = el('div', 'logo', undefined, card);
    el('span', 'logo-a', 'HOLD', logo);
    el('span', 'logo-b', 'FAST', logo);
    el('div', 'tagline', 'Breach. Reinforce. Outsmart.', card);

    const nameRow = el('label', 'field', undefined, card);
    el('span', 'field-label', 'CALLSIGN', nameRow);
    this.nameInput = el('input', 'input', undefined, nameRow);
    this.nameInput.maxLength = 16;
    this.nameInput.placeholder = 'Your name';
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.value = settings.name;
    this.nameInput.addEventListener('input', () => {
      settings.name = this.nameInput.value.slice(0, 16);
      saveSettings();
    });

    this.buttons.push(btn('SOLO MATCH vs BOTS  (offline)', 'btn primary', () => this.toggleSolo(), card));
    this.solo = el('div', 'solo-panel hidden', undefined, card);
    this.buildSolo(hooks);
    this.buttons.push(btn('PRACTICE  (shooting range)', 'btn', () => this.guard(hooks.onPractice), card));
    this.buttons.push(btn('CREATE ROOM  (friends)', 'btn', () => this.guard(hooks.onCreate), card));

    const joinRow = el('div', 'join-row', undefined, card);
    this.codeInput = el('input', 'input code', undefined, joinRow);
    this.codeInput.maxLength = 4;
    this.codeInput.placeholder = 'CODE';
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.inputMode = 'text';
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join(hooks);
    });
    this.buttons.push(btn('JOIN', 'btn', () => this.join(hooks), joinRow));

    const row = el('div', 'menu-row', undefined, card);
    btn('SETTINGS', 'btn small', hooks.onSettings, row);
    btn('HOW TO PLAY', 'btn small', hooks.onHelp, row);

    this.err = el('div', 'menu-error', '', card);
    el('div', 'menu-foot', 'Original game. Local friends only.', card);
  }

  private toggleSolo(): void {
    this.solo.classList.toggle('hidden');
  }

  /** Options of a solo match: your side, team size and the bot difficulty. */
  private buildSolo(hooks: MenuHooks): void {
    const row = (label: string, names: string[], get: () => number, set: (v: number) => void): void => {
      const r = el('div', 'solo-row', undefined, this.solo);
      el('span', 'solo-label', label, r);
      const group = el('div', 'solo-group', undefined, r);
      const bs: HTMLButtonElement[] = [];
      const paint = (): void => bs.forEach((b, i) => b.classList.toggle('on', i === get()));
      names.forEach((n, i) => {
        bs.push(btn(n, 'btn small', () => { set(i); saveSettings(); paint(); }, group));
      });
      paint();
    };
    row('START AS', ['ATTACKER', 'DEFENDER'], () => settings.soloSide, (v) => { settings.soloSide = v; });
    row('TEAM SIZE', ['2', '3', '4', '5'], () => settings.soloSize - 2, (v) => { settings.soloSize = v + 2; });
    row('BOTS', ['EASY', 'NORMAL', 'HARD'], () => settings.soloDiff, (v) => { settings.soloDiff = v; });
    el('div', 'solo-note', 'You and your bot teammates against bots. First to 3 rounds. Works with no internet.', this.solo);
    this.buttons.push(btn('START MATCH', 'btn primary', () => this.guard(() => hooks.onSolo({
      size: settings.soloSize, difficulty: settings.soloDiff, side: settings.soloSide === 1 ? 1 : 0,
    })), this.solo));
  }

  private join(hooks: MenuHooks): void {
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      this.setError('Enter the 4 letter room code');
      return;
    }
    this.guard(() => hooks.onJoin(code));
  }

  private guard(fn: () => void): void {
    if (this.busy) return;
    settings.name = this.nameInput.value.slice(0, 16);
    saveSettings();
    this.setError('');
    fn();
  }

  get playerName(): string {
    const n = this.nameInput.value.trim();
    return n || 'Player' + Math.floor(Math.random() * 90 + 10);
  }

  setCode(code: string): void {
    this.codeInput.value = code;
  }

  setBusy(b: boolean): void {
    this.busy = b;
    for (const x of this.buttons) x.disabled = b;
  }

  setError(msg: string): void {
    this.err.textContent = msg;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (on) this.nameInput.value = settings.name;
  }
}
