// Lobby: room code, QR of the join link, teams, ready state and host settings.

import { GameMode, qrEncode, type RoomSettings, type RoomState } from '@holdfast/shared';
import { btn, clear, el } from './dom';

export interface LobbyHooks {
  onTeam(team: 0 | 1): void;
  onReady(ready: boolean): void;
  onStart(): void;
  onLeave(): void;
  onSettings(partial: Partial<RoomSettings>): void;
}

const TEAM_NAMES = ['ALPHA', 'BRAVO'];

export class LobbyScreen {
  readonly root: HTMLDivElement;
  private code: HTMLElement;
  private link: HTMLElement;
  private qr: HTMLCanvasElement;
  private teams: HTMLElement[] = [];
  private actions: HTMLElement;
  private settingsBox: HTMLElement;
  private hint: HTMLElement;
  private lastUrl = '';
  private lastSettingsKey = '';

  constructor(parent: HTMLElement, private hooks: LobbyHooks) {
    const root = el('div', 'screen lobby hidden', undefined, parent);
    this.root = root;
    const head = el('div', 'lobby-head', undefined, root);
    const left = el('div', 'lobby-code-box', undefined, head);
    el('div', 'label', 'ROOM CODE', left);
    this.code = el('div', 'lobby-code', '----', left);
    this.link = el('div', 'lobby-link', '', left);
    this.link.addEventListener('click', () => {
      try {
        void navigator.clipboard.writeText(this.lastUrl);
        this.hint.textContent = 'Link copied. Friends can open it or scan the code.';
      } catch {
        /* ignore */
      }
    });
    this.qr = el('canvas', 'lobby-qr', undefined, head);

    const cols = el('div', 'lobby-teams', undefined, root);
    for (let t = 0; t < 2; t++) {
      const col = el('div', 'team-col team' + t, undefined, cols);
      el('div', 'team-title', 'TEAM ' + TEAM_NAMES[t], col);
      const list = el('div', 'team-list', undefined, col);
      this.teams.push(list);
      btn('JOIN TEAM ' + TEAM_NAMES[t], 'btn small', () => hooks.onTeam(t as 0 | 1), col);
    }

    this.settingsBox = el('div', 'lobby-settings', undefined, root);
    this.hint = el('div', 'lobby-hint', '', root);
    this.actions = el('div', 'lobby-actions', undefined, root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  private drawQr(url: string): void {
    if (url === this.lastUrl) return;
    this.lastUrl = url;
    try {
      const q = qrEncode(url);
      const scale = 5;
      const quiet = 3;
      const n = (q.size + quiet * 2) * scale;
      this.qr.width = n;
      this.qr.height = n;
      const g = this.qr.getContext('2d');
      if (!g) return;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, n, n);
      g.fillStyle = '#000';
      for (let y = 0; y < q.size; y++) {
        for (let x = 0; x < q.size; x++) {
          if (q.modules[y]![x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    } catch {
      this.qr.width = 0;
    }
  }

  update(room: RoomState, myId: number): void {
    const me = room.players.find((p) => p.id === myId);
    const isHost = room.hostId === myId;
    this.code.textContent = room.code;
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    this.link.textContent = url.replace(/^https?:\/\//, '') + '  (tap to copy)';
    this.drawQr(url);

    this.teams.forEach((list, t) => {
      clear(list);
      for (const p of room.players.filter((x) => x.team === t)) {
        const row = el('div', 'player-row' + (p.id === myId ? ' me' : '') + (p.connected ? '' : ' away'), undefined, list);
        el('span', 'pname', p.name + (p.host ? '  (host)' : ''), row);
        el('span', 'pready' + (p.ready ? ' on' : ''), p.ready ? 'READY' : '', row);
      }
    });

    clear(this.actions);
    btn(me?.ready ? 'NOT READY' : 'READY', 'btn' + (me?.ready ? '' : ' primary'), () => this.hooks.onReady(!me?.ready), this.actions);
    if (isHost) {
      const start = btn('START MATCH', 'btn primary big', () => this.hooks.onStart(), this.actions);
      start.disabled = room.players.filter((p) => p.connected).length < 2;
    }
    btn('LEAVE', 'btn', () => this.hooks.onLeave(), this.actions);
    if (!this.hint.textContent) {
      this.hint.textContent = isHost
        ? 'Share the code or QR. You need at least 2 players to start.'
        : 'Waiting for the host to start the match.';
    }
    this.renderSettings(room.settings, isHost);
  }

  private renderSettings(s: RoomSettings, isHost: boolean): void {
    const key = JSON.stringify(s) + isHost;
    if (key === this.lastSettingsKey) return;
    this.lastSettingsKey = key;
    clear(this.settingsBox);
    el('div', 'label', 'MATCH SETTINGS', this.settingsBox);
    const grid = el('div', 'settings-grid', undefined, this.settingsBox);

    const select = (label: string, value: number, options: [number, string][], apply: (v: number) => void): void => {
      const row = el('label', 'srow', undefined, grid);
      el('span', '', label, row);
      const sel = el('select', 'input', undefined, row);
      for (const [v, text] of options) {
        const o = el('option', '', text, sel);
        o.value = String(v);
        if (v === value) o.selected = true;
      }
      sel.disabled = !isHost;
      sel.addEventListener('change', () => apply(Number(sel.value)));
    };
    select('Mode', s.mode, [[GameMode.SECURE, 'Secure Area'], [GameMode.ELIMINATION, 'Elimination']], (v) => this.hooks.onSettings({ mode: v as GameMode }));
    select('Rounds to win', s.roundsToWin, [1, 2, 3, 4, 5, 6, 7].map((n) => [n, String(n)] as [number, string]), (v) => this.hooks.onSettings({ roundsToWin: v }));
    select('Prep time', s.prepTime, [15, 30, 45, 60, 90].map((n) => [n, n + ' s'] as [number, string]), (v) => this.hooks.onSettings({ prepTime: v }));
    select('Action time', s.actionTime, [60, 120, 180, 240, 300].map((n) => [n, n + ' s'] as [number, string]), (v) => this.hooks.onSettings({ actionTime: v }));
    select('Friendly fire', s.friendlyFire ? 1 : 0, [[0, 'Off'], [1, 'On']], (v) => this.hooks.onSettings({ friendlyFire: v === 1 }));
  }

  resetHint(): void {
    this.hint.textContent = '';
  }
}
