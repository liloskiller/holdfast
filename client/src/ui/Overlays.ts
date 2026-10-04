// Small modal overlays: pause menu, help, reconnecting and click to play.

import { OPERATORS, defaultThrowable, throwablesForSide, weaponDef } from '@holdfast/shared';
import { btn, clear, el } from './dom';

export interface PauseHooks {
  onResume(): void;
  onSettings(): void;
  onHelp(): void;
  onLeave(): void;
  onDebug(cmd: string): void;
  onPick(op: number, primary: number, secondary: number, throwable: number): void;
}

export class PauseMenu {
  readonly root: HTMLDivElement;
  private practice: HTMLElement;

  constructor(parent: HTMLElement, hooks: PauseHooks) {
    this.root = el('div', 'screen pause hidden', undefined, parent);
    const card = el('div', 'panel', undefined, this.root);
    el('div', 'panel-title', 'PAUSED', card);
    btn('RESUME', 'btn primary', hooks.onResume, card);
    btn('SETTINGS', 'btn', hooks.onSettings, card);
    btn('HOW TO PLAY', 'btn', hooks.onHelp, card);
    this.practice = el('div', 'practice-tools', undefined, card);
    el('div', 'label', 'PRACTICE TOOLS', this.practice);
    const opRow = el('div', 'menu-row', undefined, this.practice);
    const opSel = el('select', 'input', undefined, opRow);
    for (const op of OPERATORS) {
      const o = el('option', '', `${op.name} (${op.side === 'attack' ? 'attack' : 'defend'}) - ${op.gadgetName}`, opSel);
      o.value = String(op.id);
    }
    const wSel = el('select', 'input', undefined, opRow);
    const fillWeapons = (): void => {
      clear(wSel);
      const def = OPERATORS[Number(opSel.value)];
      for (const w of def ? def.primaries : []) {
        const o = el('option', '', weaponDef(w).name, wSel);
        o.value = String(w);
      }
    };
    const sSel = el('select', 'input', undefined, opRow);
    const fillSecondary = (): void => {
      clear(sSel);
      const def = OPERATORS[Number(opSel.value)];
      for (const w of def ? def.secondaries : []) {
        const o = el('option', '', weaponDef(w).name, sSel);
        o.value = String(w);
      }
    };
    const tSel = el('select', 'input', undefined, opRow);
    const fillThrowables = (): void => {
      clear(tSel);
      const def = OPERATORS[Number(opSel.value)];
      for (const t of throwablesForSide(def ? def.side : 'attack')) {
        const o = el('option', '', t.name, tSel);
        o.value = String(t.id);
      }
    };
    fillWeapons();
    fillSecondary();
    fillThrowables();
    const send = (): void => {
      const od = OPERATORS[Number(opSel.value)];
      hooks.onPick(
        Number(opSel.value), Number(wSel.value), od ? Number(sSel.value || od.secondaries[0]) : 4,
        Number(tSel.value || defaultThrowable(od ? od.side : 'attack')),
      );
    };
    opSel.addEventListener('change', () => {
      fillWeapons();
      fillSecondary();
      fillThrowables();
      send();
    });
    tSel.addEventListener('change', send);
    wSel.addEventListener('change', send);
    sSel.addEventListener('change', send);
    const row = el('div', 'menu-row', undefined, this.practice);
    btn('Reset world', 'btn small', () => hooks.onDebug('reset'), row);
    btn('Refill', 'btn small', () => hooks.onDebug('refill'), row);
    btn('Respawn', 'btn small', () => hooks.onDebug('respawn'), row);
    btn('Targets', 'btn small', () => hooks.onDebug('dummies'), row);
    btn('LEAVE MATCH', 'btn danger', hooks.onLeave, card);
  }

  show(on: boolean, practice = false): void {
    this.root.classList.toggle('hidden', !on);
    this.practice.classList.toggle('hidden', !practice);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

export class HelpScreen {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.root = el('div', 'screen help hidden', undefined, parent);
    const card = el('div', 'panel wide', undefined, this.root);
    el('div', 'panel-title', 'HOW TO PLAY', card);
    const body = el('div', 'panel-body help-body', undefined, card);
    const sec = (title: string, lines: string[]): void => {
      el('div', 'sgroup', title, body);
      for (const l of lines) el('div', 'help-line', l, body);
    };
    sec('GOAL', [
      'One life per round. Attackers breach the house and secure the objective (hold the glowing zone for 10 seconds) or eliminate every defender.',
      'Defenders use the prep phase to reinforce walls, barricade doors and set gadgets, then hold out until time runs out.',
      'Bomb mode: attackers hold the interact key inside the glowing zone to plant the defuser (4 seconds). Defenders must stand next to it and hold interact for 7 seconds to disable it before the 45 second fuse runs out.',
    ]);
    sec('KEYBOARD AND MOUSE', [
      'WASD move   SHIFT sprint   C crouch   Q / E lean left / right (peek around corners)   mouse wheel or 1 / 2 swap weapon',
      'Mouse aim   LEFT fire   RIGHT aim   R reload   V kick / melee   MIDDLE click or Y mark where you look for your team',
      'F tap: open or close door, vault a broken window.   F hold: reinforce a marked wall (defenders, prep only) or barricade a door/window.',
      'G use gadget   T throw your grenade or set your trap   X launch or enter drone   Z cycle security cameras   TAB scoreboard   ESC pause',
      'Drone: a small RC car. WASD drive, mouse looks, SPACE hops (about knee high: over low furniture, up stairs), FIRE tags an enemy so your team sees them through walls. It can be shot, and a hard fall damages it.',
      'Practice only: B blast a hole where you look   N reinforce the panel you look at   M reset world   K refill',
    ]);
    sec('GAMEPAD', [
      'Sticks move and look, RT fire, LT aim, A use, B crouch, X reload, Y swap, LB / RB lean, R3 kick, D-pad up gadget, down drone, left cameras, right grenade, Back scoreboard, Start pause.',
    ]);
    sec('TOUCH', [
      'Left thumb: move (push the stick to the rim to sprint). Right thumb: drag to look. FIRE is the big button, dragging it also aims.',
      'AIM toggles sights, USE does door / reinforce / barricade (hold), KICK breaks barricades, GADGET uses your operator gadget, NADE throws your grenade or sets your trap, PING marks what you look at for your team.',
      'Add this page to your Home Screen for fullscreen play on iPhone.',
    ]);
    sec('TIPS', [
      'Plaster and wood walls can be shot out. Bullets pass through them at half damage. Reinforced (metal) walls only break to a hard breach charge.',
      'Pick a secondary gadget in operator select: frag, flashbang or smoke for attackers, impact grenade, barbed wire or proximity alarm for defenders. Flashes hurt less when you look away, smoke blocks sight, impact grenades open barricades and soft walls.',
      'Hatches in the floor are soft: shoot or breach them to drop in. Listen for footsteps, loud sprinting shows up on your compass.',
    ]);
    btn('CLOSE', 'btn primary', onClose, card);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}

export class StatusOverlay {
  readonly root: HTMLDivElement;
  private text: HTMLElement;
  private action: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'screen status hidden', undefined, parent);
    const card = el('div', 'panel', undefined, this.root);
    this.text = el('div', 'panel-title', '', card);
    this.action = btn('OK', 'btn primary hidden', () => undefined, card);
  }

  show(text: string, action?: { label: string; fn: () => void }): void {
    this.root.classList.remove('hidden');
    this.text.textContent = text;
    if (action) {
      this.action.classList.remove('hidden');
      this.action.textContent = action.label;
      this.action.onclick = action.fn;
    } else {
      this.action.classList.add('hidden');
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}

export class ClickToPlay {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onClick: () => void) {
    this.root = el('div', 'click-to-play hidden', undefined, parent);
    el('div', 'ctp-main', 'CLICK TO PLAY', this.root);
    el('div', 'ctp-sub', 'Mouse is captured. ESC to pause.', this.root);
    this.root.addEventListener('click', onClick);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}

export class RoundEnd {
  readonly root: HTMLDivElement;
  private main: HTMLElement;
  private sub: HTMLElement;
  private score: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'round-end hidden', undefined, parent);
    this.main = el('div', 're-main', '', this.root);
    this.sub = el('div', 're-sub', '', this.root);
    this.score = el('div', 're-score', '', this.root);
  }

  show(main: string, sub: string, score: string, cls: string): void {
    this.root.classList.remove('hidden');
    this.root.className = 'round-end ' + cls;
    this.main.textContent = main;
    this.sub.textContent = sub;
    this.score.textContent = score;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
