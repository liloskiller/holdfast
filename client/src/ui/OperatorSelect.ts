// Operator pick screen shown during the OPERATOR_SELECT phase.

import { OPERATORS, defaultThrowable, throwDef, throwablesForSide, weaponDef, type OperatorDef, type RoomState, type WeaponDef } from '@holdfast/shared';
import { btn, clear, el } from './dom';

export interface OperatorHooks {
  onPick(op: number, primary: number, secondary: number, throwable: number): void;
}

export class OperatorSelect {
  readonly root: HTMLDivElement;
  private title: HTMLElement;
  private timer: HTMLElement;
  private grid: HTMLElement;
  private detail: HTMLElement;
  private selected = -1;
  private primary = -1;
  private secondary = -1;
  private throwable = -1;
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
    this.secondary = -1;
    this.throwable = -1;
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
    const key = [...takenBy.entries()].join('|') + '#' + this.selected + '#' + this.primary + '#' + this.secondary + '#' + this.throwable;
    if (key === this.lastKey) return;
    this.lastKey = key;

    clear(this.grid);
    // the recruit (always available) goes last
    for (const op of OPERATORS.filter((o) => o.side === this.side).sort((a, b) => Number(!a.unique) - Number(!b.unique))) {
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
        this.secondary = op.secondaries[0];
        if (this.throwable < 0) this.throwable = defaultThrowable(this.side);
        this.lastKey = '';
        this.hooks.onPick(op.id, this.primary, this.secondary, this.throwable);
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
    const pick = (): void => {
      this.lastKey = '';
      this.hooks.onPick(def.id, this.primary, this.secondary, this.throwable);
      this.update(room, myId);
    };
    const weaponRow = (label: string, list: readonly number[], current: number, set: (w: number) => void): void => {
      el('div', 'ops-d-label', label, this.detail);
      const row = el('div', 'ops-weapons', undefined, this.detail);
      for (const w of list) {
        const wd = weaponDef(w);
        btn(`${wd.name}  (${wd.role})`, 'btn small' + (w === current ? ' primary' : ''), () => {
          set(w);
          pick();
        }, row);
      }
    };
    weaponRow('PRIMARY', def.primaries, this.primary, (w) => { this.primary = w; });
    weaponRow('SIDEARM', def.secondaries, this.secondary, (w) => { this.secondary = w; });
    el('div', 'ops-d-label', 'SECONDARY GADGET', this.detail);
    const trow = el('div', 'ops-weapons', undefined, this.detail);
    for (const t of throwablesForSide(this.side)) {
      btn(`${t.name}  x${t.count}`, 'btn small' + (t.id === this.throwable ? ' primary' : ''), () => {
        this.throwable = t.id;
        pick();
      }, trow);
    }
    el('div', 'ops-d-text dim', throwDef(this.throwable).desc, this.detail);
    const bars = el('div', 'ops-stats', undefined, this.detail);
    this.statBlock(bars, weaponDef(this.primary));
    this.statBlock(bars, weaponDef(this.secondary));
    el('div', 'ops-d-text dim', 'Your choice is locked in as soon as you tap.', this.detail);
  }

  /** Small stat card: damage, fire rate, range, control and mobility as bars. */
  private statBlock(parent: HTMLElement, w: WeaponDef): void {
    const card = el('div', 'stat-card', undefined, parent);
    const tags = [w.mode === 'auto' ? 'AUTO' : w.mode === 'burst' ? `BURST x${w.burst}` : w.kind === 'shotgun' ? 'PUMP' : 'SEMI'];
    if (w.suppressed) tags.push('SUPPRESSED');
    el('div', 'stat-name', `${w.name}  -  ${tags.join('  ')}`, card);
    const per = w.damage * (w.pellets > 1 ? w.pellets * 0.6 : 1);
    const rate = w.mode === 'burst' ? w.rpm * w.burst : w.rpm;
    const bars: [string, number][] = [
      ['DAMAGE', per / 62],
      ['FIRE RATE', rate / 900],
      ['RANGE', w.falloffStart / 50],
      ['CONTROL', 1 - w.kickPitch / 0.06],
      ['MOBILITY', (w.moveMul - 0.85) / 0.2],
    ];
    for (const [label, v] of bars) {
      const row = el('div', 'stat-row', undefined, card);
      el('span', 'stat-label', label, row);
      const bar = el('span', 'stat-bar', undefined, row);
      const fill = el('span', 'fill', undefined, bar);
      fill.style.width = Math.round(Math.max(0.06, Math.min(1, v)) * 100) + '%';
    }
  }
}
