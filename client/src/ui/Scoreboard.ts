import type { RoomState } from '@holdfast/shared';
import { clear, el } from './dom';

export class Scoreboard {
  readonly root: HTMLDivElement;
  private body: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'scoreboard hidden', undefined, parent);
    this.body = el('div', 'sb-body', undefined, this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  update(room: RoomState, myId: number, attackerTeam: number, scores: [number, number], sandbox: boolean): void {
    clear(this.body);
    el('div', 'sb-title', sandbox ? 'PRACTICE' : `SCOREBOARD   ${scores[0]} : ${scores[1]}`, this.body);
    for (let t = 0; t < 2; t++) {
      const players = room.players.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills);
      if (!players.length && sandbox) continue;
      const side = t === attackerTeam ? 'atk' : 'def';
      const table = el('div', 'sb-team ' + side, undefined, this.body);
      const head = el('div', 'sb-row sb-head', undefined, table);
      el('span', 'c-name', (t === attackerTeam ? 'ATTACKERS' : 'DEFENDERS') + '  (team ' + (t === 0 ? 'ALPHA' : 'BRAVO') + ')', head);
      el('span', 'c-num', 'K', head);
      el('span', 'c-num', 'D', head);
      el('span', 'c-num', 'OBJ', head);
      for (const p of players) {
        const row = el('div', 'sb-row' + (p.id === myId ? ' me' : '') + (p.alive ? '' : ' dead'), undefined, table);
        el('span', 'c-name', p.name + (p.connected ? '' : ' (away)'), row);
        el('span', 'c-num', String(p.kills), row);
        el('span', 'c-num', String(p.deaths), row);
        el('span', 'c-num', p.objective ? p.objective + 's' : '-', row);
      }
    }
  }
}
