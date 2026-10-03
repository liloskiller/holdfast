// Operator pick screen shown during the OPERATOR_SELECT phase.

import { OPERATORS, weaponDef, type OperatorDef, type RoomState } from '@holdfast/shared';
import { btn, clear, el } from './dom';

export interface OperatorHooks {
  onPick(op: number, primary: number): void;
}

export class OperatorSelect {
  readonly root: HTMLDivElement;
  private title: HTMLElement;
  private timer: HTMLElement;
  private grid: HTMLElement;
  private detail: HTMLElement;
  private selected = -1;
  private primary = -1;
  private side: 'attack' | 'defend' = 'attack';
  private lastKey = '';

  constructor(parent: HTMLElement, private hooks: OperatorHooks) {
    const root = el('div', 'screen opsel hidden', undefined, parent);
    this.root = root;
    const head = el('div', 'ops-head', undefined, root);
    this.title = el('div', 'ops-title', 'SELECT OPERATOR', head);
    this.timer = el('div', 'ops-timer', '', head);
    this.grid = el('div', 'ops-grid', undefined, root);
    this.detail = el('div', 'ops-detail', undefined, root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (on) this.lastKey = '';
  }

  setTimer(text: string): void {
    if (this.timer.textContent !== text) this.timer.textContent = text;
  }

  /** Reset the selection for a new round. */
  begin(side: 'attack' | 'defend'): void {
    this.side = side;
    this.selected = -1;
    this.primary = -1;
    this.lastKey = '';
    this.title.textContent = side === 'attack' ? 'SELECT ATTACKER' : 'SELECT DEFENDER';
    this.title.className = 'ops-title ' + side;
  }

  update(room: RoomState, myId: number): void {
    const me = room.players.find((p) => p.id === myId);
    if (!me) return;
    const mates = room.players.filter((p) => p.team === me.team && p.id !== myId);
    const takenBy = new Map<number, string>();
    for (const m of mates) {
      const def = OPERATORS[m.op];
      if (def && def.unique && def.side === this.side) takenBy.set(m.op, m.name);
    }
    const key = [...takenBy.entries()].join('|') + '#' + this.selected + '#' + this.primary;
    if (key === this.lastKey) return;
    this.lastKey = key;

    clear(this.grid);
    for (const op of OPERATORS.filter((o) => o.side === this.side)) {
      const taken = takenBy.get(op.id);
      const card = el('button', 'op-card' + (op.id === this.selected ? ' sel' : '') + (taken ? ' taken' : ''), undefined, this.grid);
      card.type = 'button';
      el('div', 'op-name', op.name.toUpperCase(), card);
      el('div', 'op-gadget', op.gadgetName, card);
      el('div', 'op-passive', taken ? 'Taken by ' + taken : op.passive, card);
      card.disabled = !!taken;
      card.addEventListener('click', () => {
        this.selected = op.id;
        this.primary = op.primaries[0];
        this.lastKey = '';
        this.hooks.onPick(op.id, this.primary);
        this.update(room, myId);
      });
    }
    this.renderDetail(room, myId);
  }

  private renderDetail(room: RoomState, myId: number): void {
    clear(this.detail);
    const def = OPERATORS[this.selected] as OperatorDef | undefined;
    if (!def) {
      el('div', 'ops-hint', 'Pick an operator. Unpicked players get a Recruit.', this.detail);
      return;
    }
    el('div', 'ops-d-name', def.name.toUpperCase() + '  -  ' + def.gadgetName, this.detail);
    el('div', 'ops-d-text', def.gadgetDesc, this.detail);
    const row = el('div', 'ops-weapons', undefined, this.detail);
    for (const w of def.primaries) {
      const wd = weaponDef(w);
      btn(`${wd.name}  (${wd.role})`, 'btn small' + (w === this.primary ? ' primary' : ''), () => {
        this.primary = w;
        this.lastKey = '';
        this.hooks.onPick(def.id, w);
        this.update(room, myId);
      }, row);
    }
    el('div', 'ops-d-text dim', 'Sidearm: ' + weaponDef(4).name + '.  Locked in as soon as you tap.', this.detail);
  }
}
