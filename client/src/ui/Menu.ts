// Main menu: name, practice, create room, join room, settings.

import { settings, saveSettings } from '../settings';
import { btn, el } from './dom';

export interface MenuHooks {
  onPractice(): void;
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

    this.buttons.push(btn('PRACTICE  (solo, offline)', 'btn primary', () => this.guard(hooks.onPractice), card));
    this.buttons.push(btn('CREATE ROOM', 'btn', () => this.guard(hooks.onCreate), card));

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
