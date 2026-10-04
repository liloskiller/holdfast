// Application shell: screens, session (connect / reconnect), phase driven UI, pointer lock, wake lock.

import {
  GameMode, PhaseId, type ClientMsg, type PhaseInfo, type RoomSettings, type SoloOptions, type RoomState, type ServerMsg,
} from '@holdfast/shared';
import { GameAudio } from './audio/Audio';
import { Game, type GameHost } from './game/Game';
import { Renderer } from './game/Renderer';
import { InputState } from './input/InputState';
import { KeyboardMouse } from './input/KeyboardMouse';
import { TouchControls } from './input/TouchControls';
import { ClockSync } from './net/ClockSync';
import { LoopbackConnection, WsConnection, type Transport } from './net/Connection';
import { isTouchDevice, loadSettings, onSettingsChange, saveSettings, sessionGet, sessionSet, settings } from './settings';
import { GamepadControls } from './input/Gamepad';
import { Hud } from './ui/Hud';
import { LobbyScreen } from './ui/LobbyScreen';
import { Menu } from './ui/Menu';
import { OperatorSelect } from './ui/OperatorSelect';
import { ClickToPlay, HelpScreen, PauseMenu, RoundEnd, StatusOverlay } from './ui/Overlays';
import { Scoreboard } from './ui/Scoreboard';
import { SettingsScreen } from './ui/SettingsScreen';
import safehouseText from '../../shared/maps/safehouse.map.txt?raw';

type Joined = Extract<ServerMsg, { t: 'JOINED' }>;

export class App {
  private canvas: HTMLCanvasElement;
  private uiRoot: HTMLElement;
  private renderer: Renderer;
  private audio = new GameAudio();
  private input = new InputState();
  private clock = new ClockSync();
  private kbm: KeyboardMouse;
  private pad: GamepadControls;
  private lastLoopT = 0;
  private touch: TouchControls;
  private touchDevice = isTouchDevice() || new URLSearchParams(location.search).has('touch');

  private hud: Hud;
  private menu: Menu;
  private lobby: LobbyScreen;
  private opsel: OperatorSelect;
  private scoreboard: Scoreboard;
  private settingsScreen: SettingsScreen;
  private pause: PauseMenu;
  private help: HelpScreen;
  private status: StatusOverlay;
  private ctp: ClickToPlay;
  private roundEnd: RoundEnd;
  private rotate: HTMLElement;

  private transport: Transport | null = null;
  private game: Game | null = null;
  private practice = false;
  private myId = 0;
  private token = '';
  private code = '';
  private room: RoomState | null = null;
  private phase: PhaseInfo | null = null;
  private intentional = false;
  private reconnecting = false;
  private pingTimer = 0;
  private modalOpen: 'none' | 'pause' | 'settings' | 'help' = 'none';
  private settingsReturn: 'menu' | 'pause' = 'menu';
  private wakeLock: { release(): Promise<void> } | null = null;
  private scoreHeld = false;
  private lastSlot = 0;

  constructor(root: HTMLElement) {
    loadSettings();
    root.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gl';
    root.appendChild(this.canvas);
    this.uiRoot = document.createElement('div');
    this.uiRoot.id = 'ui';

    this.renderer = new Renderer(this.canvas);
    this.hud = new Hud(root);
    root.appendChild(this.uiRoot);

    this.kbm = new KeyboardMouse(this.input, this.canvas, {
      onScoreboard: (show) => this.holdScoreboard(show),
      onPause: () => this.togglePause(),
      onDebug: (cmd) => this.send({ t: 'DEBUG', cmd }),
      onLockChange: (locked) => this.onLockChange(locked),
      onSpectate: (dir) => this.game?.spectate(dir),
      onMark: () => this.sendMark(),
    });
    this.pad = new GamepadControls(this.input, {
      onPause: () => this.togglePause(),
      onScoreboard: (show) => this.holdScoreboard(show),
      onUsed: () => this.updateInputMode(),
    });
    this.touch = new TouchControls(this.input, root, {
      onScoreboard: (show) => this.holdScoreboard(show),
      onPause: () => this.togglePause(),
      onMark: () => this.sendMark(),
      haptic: (ms) => this.haptic(ms),
    });

    this.menu = new Menu(this.uiRoot, {
      onPractice: () => void this.startPractice(),
      onSolo: (opts) => this.startSolo(opts),
      onCreate: () => void this.createRoom(),
      onJoin: (code) => void this.joinRoom(code),
      onSettings: () => this.openSettings('menu'),
      onHelp: () => this.openHelp(),
    });
    this.lobby = new LobbyScreen(this.uiRoot, {
      onTeam: (team) => this.send({ t: 'SET_TEAM', team }),
      onReady: (ready) => this.send({ t: 'SET_READY', ready }),
      onStart: () => this.send({ t: 'START_MATCH' }),
      onLeave: () => this.leave(),
      onSettings: (partial: Partial<RoomSettings>) => this.send({ t: 'SET_SETTINGS', settings: partial }),
    });
    this.opsel = new OperatorSelect(this.uiRoot, {
      onPick: (op, primary, secondary, throwable) => {
        this.audio.ui('ui');
        this.send({ t: 'PICK_OPERATOR', op, primary: primary as 0, secondary: secondary as 0, throwable });
      },
    });
    this.scoreboard = new Scoreboard(this.uiRoot);
    this.settingsScreen = new SettingsScreen(this.uiRoot, {
      onClose: () => this.closeSettings(),
      onGyro: (on) => (on ? this.touch.enableGyro() : Promise.resolve(true)),
    });
    this.help = new HelpScreen(this.uiRoot, () => this.closeHelp());
    this.pause = new PauseMenu(this.uiRoot, {
      onResume: () => this.resume(),
      onSettings: () => this.openSettings('pause'),
      onHelp: () => this.openHelp(),
      onLeave: () => this.leave(),
      onDebug: (cmd) => this.send({ t: 'DEBUG', cmd }),
      onPick: (op, primary, secondary, throwable) => this.send({ t: 'PICK_OPERATOR', op, primary: primary as 0, secondary: secondary as 0, throwable }),
    });
    this.status = new StatusOverlay(this.uiRoot);
    this.ctp = new ClickToPlay(this.uiRoot, () => this.resume());
    this.roundEnd = new RoundEnd(this.uiRoot);
    this.rotate = document.createElement('div');
    this.rotate.className = 'rotate-hint hidden';
    this.rotate.textContent = 'Rotate your phone to landscape';
    root.appendChild(this.rotate);

    onSettingsChange(() => {
      this.sendAssist();
      this.renderer.applyQuality();
      this.audio.applyVolumes();
      this.touch.applySettings();
    });

    const code = new URLSearchParams(location.search).get('room');
    const lastCode = sessionGet('hf.code');
    if (code) this.menu.setCode(code.toUpperCase().slice(0, 4));
    else if (lastCode) {
      this.menu.setCode(lastCode);
      this.menu.setError('Tap JOIN to rejoin your last room');
    }
    this.menu.show(true);
    this.registerGlobalGestures();
    requestAnimationFrame((t) => this.loop(t));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.requestWakeLock();
    });
    (window as unknown as { holdfast?: App }).holdfast = this;
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private registerGlobalGestures(): void {
    // block browser gestures during play
    const block = (e: Event): void => {
      if (this.game && this.playing) e.preventDefault();
    };
    document.addEventListener('gesturestart', block as EventListener);
    document.addEventListener('dblclick', block);
    document.addEventListener('touchmove', (e) => { if (this.game && this.playing) e.preventDefault(); }, { passive: false });
    // first gesture unlocks audio
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  }

  private get playing(): boolean {
    const p = this.phase?.phase;
    return p === PhaseId.PREP || p === PhaseId.ACTION || p === PhaseId.ROUND_END;
  }

  private get host(): GameHost {
    return {
      send: (m) => this.send(m),
      clock: this.clock,
      audio: this.audio,
      input: this.input,
      hud: this.hud,
      practice: this.practice,
      isPaused: () => this.modalOpen !== 'none' || (!this.touchDevice && !this.kbm.isLocked) || this.scoreboard.visible && false,
      onPhaseUi: (prev, next) => this.onPhaseUi(prev, next),
      haptic: (ms) => this.haptic(ms),
      isTouchActive: () => this.touch.isActive,
    };
  }

  haptic(ms: number): void {
    if (!settings.haptics) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* unsupported */
    }
  }

  private send(msg: ClientMsg): void {
    this.transport?.send(msg);
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const nav = navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } };
      if (nav.wakeLock && this.game && !document.hidden) this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      /* not allowed */
    }
  }

  private releaseWakeLock(): void {
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  private tryFullscreen(): void {
    if (!this.touchDevice) return;
    try {
      const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
      if (el.requestFullscreen && !document.fullscreenElement) {
        void el.requestFullscreen().then(() => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          void o.lock?.('landscape').catch(() => undefined);
        }).catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Connecting
  // -------------------------------------------------------------------------

  private name(): string {
    return this.menu.playerName;
  }

  private async startPractice(): Promise<void> {
    this.audio.unlock();
    this.tryFullscreen();
    this.practice = true;
    this.intentional = false;
    // ?netpractice runs the sandbox on the real server instead (used to test netcode under ?lag=...)
    if (new URLSearchParams(location.search).has('netpractice')) {
      try {
        const ws = await WsConnection.open();
        this.attachTransport(ws);
        ws.send({ t: 'CREATE_ROOM', name: this.name(), sandbox: true });
      } catch (e) {
        this.menu.setError((e as Error).message || 'Could not connect');
      }
      return;
    }
    const conn = new LoopbackConnection(safehouseText);
    this.attachTransport(conn);
    conn.send({ t: 'CREATE_ROOM', name: this.name(), sandbox: true });
  }

  /** A full match against bots, running in the page (no server, works offline). */
  private startSolo(opts: SoloOptions): void {
    this.audio.unlock();
    this.tryFullscreen();
    this.practice = false;
    this.intentional = false;
    const conn = new LoopbackConnection(safehouseText);
    this.attachTransport(conn);
    conn.send({ t: 'CREATE_ROOM', name: this.name(), solo: opts });
  }

  private sendMark(): void {
    if (this.game && this.transport?.connected) this.send({ t: 'MARK' });
  }

  /** Tell the server how strong our recoil should be (it simulates it, so it has to know). */
  private sendAssist(): void {
    if (this.transport?.connected) this.transport.send({ t: 'SET_ASSIST', recoil: settings.recoilAssist ? 0.6 : 1 });
  }

  private async createRoom(): Promise<void> {
    this.audio.unlock();
    this.tryFullscreen();
    await this.connectWs((t) => t.send({ t: 'CREATE_ROOM', name: this.name(), mode: GameMode.SECURE }));
  }

  private async joinRoom(code: string): Promise<void> {
    this.audio.unlock();
    this.tryFullscreen();
    const tok = sessionGet('hf.token');
    const savedCode = sessionGet('hf.code');
    await this.connectWs((t) => t.send({ t: 'JOIN_ROOM', code, name: this.name(), ...(tok && savedCode === code ? { token: tok } : {}) }));
  }

  private async connectWs(first: (t: Transport) => void): Promise<void> {
    this.menu.setBusy(true);
    this.menu.setError('');
    this.practice = false;
    this.intentional = false;
    try {
      const conn = await WsConnection.open();
      this.attachTransport(conn);
      first(conn);
    } catch (e) {
      this.menu.setError((e as Error).message || 'Could not connect');
      this.menu.setBusy(false);
    }
  }

  private attachTransport(t: Transport): void {
    this.transport?.close();
    this.transport = t;
    t.onMessage = (m): void => this.onMessage(m);
    t.onClose = (): void => this.onTransportClosed(t);
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.send({ t: 'PING', c: performance.now() }), 1000);
  }

  private onTransportClosed(t: Transport): void {
    if (t !== this.transport) return;
    window.clearInterval(this.pingTimer);
    if (this.intentional || !this.game || this.practice) {
      if (!this.intentional && this.game) this.teardown('Connection closed');
      return;
    }
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.status.show('Connection lost. Reconnecting...');
    for (let attempt = 0; attempt < 25 && !this.intentional; attempt++) {
      try {
        const conn = await WsConnection.open();
        this.attachTransport(conn);
        conn.send({ t: 'JOIN_ROOM', code: this.code, name: this.name(), token: this.token });
        this.reconnecting = false;
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    this.reconnecting = false;
    this.teardown('Could not reconnect to the server');
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'JOINED':
        this.onJoined(m);
        break;
      case 'ROOM':
        this.room = m.room;
        this.game?.onRoom(m.room);
        this.refreshRoomUi();
        break;
      case 'PHASE':
        this.phase = m.phase;
        if (this.game) this.game.setPhase(m.phase, !!m.reset, m.world);
        this.refreshRoomUi();
        break;
      case 'SNAP':
        this.game?.onSnapshot(m.snap);
        break;
      case 'PONG':
        this.clock.onPong(m.c, m.s);
        break;
      case 'ERR':
        this.onError(m.msg, !!m.fatal);
        break;
      case 'CHAT':
        this.hud.toast(`${m.from}: ${m.text}`);
        break;
      default:
        break;
    }
  }

  private onError(msg: string, fatal: boolean): void {
    if (!this.game) {
      this.menu.setError(msg);
      this.menu.setBusy(false);
      return;
    }
    this.hud.toast(msg);
    if (fatal) this.teardown(msg);
  }

  private onJoined(m: Joined): void {
    this.myId = m.playerId;
    this.token = m.token;
    this.code = m.code;
    this.room = m.room;
    this.phase = m.phase;
    this.sendAssist();
    if (!this.practice) {
      sessionSet('hf.token', m.token);
      sessionSet('hf.code', m.code);
    }
    this.game?.dispose();
    this.game = new Game(this.canvas, this.host, m, this.renderer);
    this.status.hide();
    this.menu.show(false);
    this.menu.setBusy(false);
    this.lobby.resetHint();
    this.touch.setActive(this.touchDevice);
    this.kbm.setEnabled(true);
    this.input.reset();
    void this.requestWakeLock();
    this.refreshRoomUi();
    this.onPhaseUi(null, m.phase);
  }

  private refreshRoomUi(): void {
    if (!this.room || !this.phase) return;
    const ph = this.phase.phase;
    this.lobby.show(ph === PhaseId.LOBBY);
    if (ph === PhaseId.LOBBY) this.lobby.update(this.room, this.myId);
    this.opsel.show(ph === PhaseId.OPERATOR_SELECT);
    if (ph === PhaseId.OPERATOR_SELECT) this.opsel.update(this.room, this.myId);
    this.scoreboard.update(this.room, this.myId, this.phase.attackerTeam, this.phase.scores, this.practice);
    this.updateInputMode();
  }

  private onPhaseUi(prev: PhaseInfo | null, next: PhaseInfo): void {
    const hud = this.hud;
    const me = this.room?.players.find((p) => p.id === this.myId);
    const myTeam = me?.team ?? 0;
    const attacker = myTeam === next.attackerTeam;
    this.roundEnd.hide();
    if (!this.practice) this.scoreboard.show(false);
    switch (next.phase) {
      case PhaseId.OPERATOR_SELECT:
        this.opsel.begin(attacker ? 'attack' : 'defend');
        this.audio.ui('roundstart', 0.7);
        this.opsel.show(true);
        if (this.room) this.opsel.update(this.room, this.myId);
        break;
      case PhaseId.PREP: {
        const site = this.game?.world.map.objectives[next.objective];
        hud.showBanner('PREP PHASE', attacker ? 'Scout with your drone (X)' + (site ? '. Objective: ' + site.name : '') : 'Reinforce walls, barricade doors, set gadgets', 3200, attacker ? 'atk' : 'def');
        this.audio.ui('roundstart', 0.5);
        break;
      }
      case PhaseId.ACTION:
        if (prev && prev.phase !== PhaseId.ACTION) {
          hud.showBanner(this.practice ? 'PRACTICE' : 'GO GO GO', this.practice ? 'Shoot walls, find targets. Pause for tools.' : '', this.practice ? 3500 : 1600, attacker ? 'atk' : 'def');
          this.audio.ui('go', 0.8);
        } else if (!prev && this.practice) {
          hud.showBanner('PRACTICE', 'Shoot the walls and the targets inside. B blasts, N reinforces, M resets.', 5000, 'atk');
        }
        break;
      case PhaseId.ROUND_END: {
        const won = next.winnerTeam === myTeam;
        const draw = next.winnerTeam < 0;
        this.roundEnd.show(draw ? 'ROUND DRAW' : won ? 'ROUND WON' : 'ROUND LOST', next.reason, `${next.scores[myTeam]} : ${next.scores[myTeam === 0 ? 1 : 0]}`, draw ? '' : won ? 'win' : 'lose');
        this.audio.ui('roundend', 0.7);
        this.scoreboard.show(true);
        break;
      }
      case PhaseId.MATCH_END: {
        const won = next.winnerTeam === myTeam;
        this.roundEnd.show(next.winnerTeam < 0 ? 'MATCH DRAW' : won ? 'VICTORY' : 'DEFEAT', 'Final score', `${next.scores[myTeam]} : ${next.scores[myTeam === 0 ? 1 : 0]}`, won ? 'win' : 'lose');
        this.scoreboard.show(true);
        break;
      }
      case PhaseId.LOBBY:
        this.scoreboard.show(false);
        this.lobby.resetHint();
        break;
      default:
        break;
    }
    this.refreshRoomUi();
  }

  // -------------------------------------------------------------------------
  // Modals, pause and input mode
  // -------------------------------------------------------------------------

  private holdScoreboard(show: boolean): void {
    if (!this.playing && !show) return;
    this.scoreHeld = show;
    this.scoreboard.show(show || this.phase?.phase === PhaseId.ROUND_END || this.phase?.phase === PhaseId.MATCH_END);
  }

  private togglePause(): void {
    if (!this.game || !this.playing) return;
    if (this.modalOpen === 'pause') this.resume();
    else this.openPause();
  }

  private openPause(): void {
    this.modalOpen = 'pause';
    this.pause.show(true, this.practice);
    this.kbm.exitLock();
    this.input.reset();
    this.updateInputMode();
  }

  private resume(): void {
    this.modalOpen = 'none';
    this.pause.show(false);
    this.help.show(false);
    this.settingsScreen.show(false);
    this.audio.unlock();
    if (!this.touchDevice) this.kbm.requestLock();
    this.updateInputMode();
  }

  private onLockChange(locked: boolean): void {
    if (!locked && this.game && this.playing && this.modalOpen === 'none' && !this.touchDevice) {
      this.openPause();
    }
    this.updateInputMode();
  }

  private openSettings(from: 'menu' | 'pause'): void {
    this.settingsReturn = from;
    this.modalOpen = 'settings';
    this.pause.show(false);
    this.settingsScreen.show(true);
    this.updateInputMode();
  }

  private closeSettings(): void {
    saveSettings();
    this.settingsScreen.show(false);
    if (this.settingsReturn === 'pause' && this.game) {
      this.modalOpen = 'pause';
      this.pause.show(true, this.practice);
    } else {
      this.modalOpen = 'none';
    }
    this.updateInputMode();
  }

  private openHelp(): void {
    this.settingsReturn = this.game ? 'pause' : 'menu';
    this.modalOpen = 'help';
    this.pause.show(false);
    this.help.show(true);
    this.updateInputMode();
  }

  private closeHelp(): void {
    this.help.show(false);
    if (this.settingsReturn === 'pause' && this.game) {
      this.modalOpen = 'pause';
      this.pause.show(true, this.practice);
    } else {
      this.modalOpen = 'none';
    }
    this.updateInputMode();
  }

  private updateInputMode(): void {
    const playing = !!this.game && this.playing;
    const modal = this.modalOpen !== 'none';
    this.touch.setActive(this.touchDevice && playing && !modal);
    this.kbm.setEnabled(!!this.game);
    const showCtp = playing && !modal && !this.touchDevice && !this.kbm.isLocked && !this.pad.used;
    this.ctp.show(showCtp);
  }

  private leave(): void {
    this.intentional = true;
    this.send({ t: 'LEAVE' });
    this.teardown('');
  }

  private teardown(message: string): void {
    window.clearInterval(this.pingTimer);
    this.transport?.close();
    this.transport = null;
    this.game?.dispose();
    this.game = null;
    this.room = null;
    this.phase = null;
    this.modalOpen = 'none';
    sessionSet('hf.token', null);
    sessionSet('hf.code', null);
    this.kbm.exitLock();
    this.kbm.setEnabled(false);
    this.touch.setActive(false);
    this.lobby.show(false);
    this.opsel.show(false);
    this.scoreboard.show(false);
    this.pause.show(false);
    this.status.hide();
    this.ctp.show(false);
    this.roundEnd.hide();
    this.hud.show(false);
    this.releaseWakeLock();
    this.menu.setBusy(false);
    this.menu.show(true);
    this.menu.setError(message);
    this.renderer.resetScene();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const g = this.game;
    const dt = this.lastLoopT ? Math.min(0.1, (now - this.lastLoopT) / 1000) : 0;
    this.lastLoopT = now;
    this.pad.poll(dt, !!g && this.playing && this.modalOpen === 'none');
    if (g) {
      g.frame(now);
      this.tickUi();
    } else {
      // menu backdrop: just keep the canvas cleared
      this.renderer.gl.setClearColor(0x14171b, 1);
      this.renderer.gl.clear();
    }
    const portrait = window.innerHeight > window.innerWidth;
    this.rotate.classList.toggle('hidden', !(this.touchDevice && portrait && !!g && this.playing));
  }

  private tickUi(): void {
    const ph = this.phase;
    if (!ph) return;
    if (ph.phase === PhaseId.OPERATOR_SELECT) {
      const left = Math.max(0, (ph.endsAt - this.clock.now()) / 1000);
      this.opsel.setTimer(Math.ceil(left) + 's');
    }
    if (this.game && !this.game.predicted.alive && this.input.slot !== this.lastSlot) this.game.spectate(1);
    this.lastSlot = this.input.slot;
    if (this.game && this.touch.isActive) {
      const st = this.game.predicted;
      this.touch.setContext(st.dCtl && st.alive, this.game.extra.camCount, this.practice || this.game.role === 'attack');
    }
    if (this.scoreHeld && this.room) {
      // keep the open scoreboard fresh
      this.scoreboard.update(this.room, this.myId, ph.attackerTeam, ph.scores, this.practice);
    }
  }
}
