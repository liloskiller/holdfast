// In game HUD. Pure DOM; every setter only writes when a value changed.

import { clear, el, setClass, setText } from './dom';

export interface CompassMarker {
  /** angle relative to the view direction, radians, positive to the right */
  rel: number;
  kind: 'mate' | 'ping' | 'obj' | 'tag' | 'enemy';
  alpha: number;
}

/** A team marker on the screen: x and y are fractions of the screen. */
export interface HudMark {
  x: number;
  y: number;
  dist: number;
  alpha: number;
  enemy: boolean;
  /** Off screen (or behind): pinned to the border. */
  edge: boolean;
}

export interface HudModel {
  alive: boolean;
  hp: number;
  maxHp: number;
  weaponName: string;
  fireMode: string;
  ammo: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  gadgetLabel: string;
  gadgetUses: number;
  gadgetCd: number;
  /** Secondary gadget (grenade or trap): label, how many are left, seconds to the next throw. */
  thrLabel: string;
  thrCount: number;
  thrCd: number;
  /** Flash blindness, 0 to 1 (1 is a white screen). */
  flash: number;
  reinf: number;
  showReinf: boolean;
  timer: string;
  timerHot: boolean;
  phaseLabel: string;
  scoreFriend: number;
  scoreFoe: number;
  friendAlive: number;
  foeAlive: number;
  friendTotal: number;
  foeTotal: number;
  role: 'attack' | 'defend' | 'free';
  prompt: string;
  actProgress: number;
  captureProgress: number;
  crosshair: number; // px offset
  ads: boolean;
  inDrone: boolean;
  droneHp: number;
  jammed: boolean;
  inCamera: boolean;
  charges: number;
  sensor: number;
  spectating: string;
  markers: CompassMarker[];
  markerCount: number;
  marks: HudMark[];
  markCount: number;
  hideCrosshair: boolean;
  debug: string;
}

export function emptyModel(): HudModel {
  return {
    alive: true, hp: 100, maxHp: 100, weaponName: '', fireMode: '', ammo: 0, reserve: 0, magSize: 0, reloading: false,
    gadgetLabel: '', gadgetUses: 0, gadgetCd: 0, thrLabel: '', thrCount: 0, thrCd: 0, flash: 0, reinf: 0, showReinf: false, timer: '', timerHot: false,
    phaseLabel: '', scoreFriend: 0, scoreFoe: 0, friendAlive: 0, foeAlive: 0, friendTotal: 0, foeTotal: 0,
    role: 'free', prompt: '', actProgress: 0, captureProgress: 0, crosshair: 6, ads: false, inDrone: false,
    droneHp: 0, jammed: false, inCamera: false, charges: 0, sensor: 0, spectating: '', markers: [], markerCount: 0, marks: [], markCount: 0,
    hideCrosshair: false, debug: '',
  };
}

const MAX_MARKERS = 24;

export class Hud {
  readonly root: HTMLDivElement;
  private n: Record<string, HTMLElement> = {};
  private worldMarks: HTMLElement[] = [];
  private markers: HTMLElement[] = [];
  private lastHp = -1;
  private killfeed: HTMLElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private bannerSub: HTMLElement;
  private hit: HTMLElement;
  private hitTimer = 0;
  private damageRoot: HTMLElement;
  private vignette: HTMLElement;
  private friendPips: HTMLElement;
  private foePips: HTMLElement;

  constructor(parent: HTMLElement) {
    const root = el('div', 'hud hidden', undefined, parent);
    this.root = root;

    // top bar
    const top = el('div', 'hud-top', undefined, root);
    const sf = el('div', 'hud-score friend', '0', top);
    this.n['sf'] = sf;
    const mid = el('div', 'hud-mid', undefined, top);
    this.n['phase'] = el('div', 'hud-phase', '', mid);
    this.n['timer'] = el('div', 'hud-timer', '', mid);
    const fo = el('div', 'hud-score foe', '0', top);
    this.n['so'] = fo;

    const alive = el('div', 'hud-alive', undefined, root);
    this.friendPips = el('div', 'pips friend', undefined, alive);
    this.foePips = el('div', 'pips foe', undefined, alive);

    const compass = el('div', 'hud-compass', undefined, root);
    this.n['compass'] = compass;
    el('div', 'compass-line', undefined, compass);
    for (let i = 0; i < MAX_MARKERS; i++) {
      const m = el('div', 'cmark hidden', undefined, compass);
      this.markers.push(m);
    }
    this.n['capture'] = el('div', 'hud-capture hidden', undefined, root);
    this.n['captureFill'] = el('div', 'fill', undefined, this.n['capture']);

    // crosshair
    const ch = el('div', 'crosshair', undefined, root);
    this.n['cross'] = ch;
    for (const side of ['t', 'b', 'l', 'r']) el('div', 'cl ' + side, undefined, ch);
    el('div', 'cdot', undefined, ch);
    this.hit = el('div', 'hitmarker hidden', undefined, root);
    for (let i = 0; i < 4; i++) el('div', 'hm hm' + i, undefined, this.hit);
    this.n['prompt'] = el('div', 'hud-prompt hidden', '', root);
    this.n['flash'] = el('div', 'hud-flash', undefined, root);
    for (let i = 0; i < 8; i++) {
      const mk = el('div', 'world-mark hidden', undefined, root);
      el('div', 'wm-icon', undefined, mk);
      el('div', 'wm-dist', '', mk);
      this.worldMarks.push(mk);
    }
    this.n['act'] = el('div', 'hud-act hidden', undefined, root);
    this.n['actFill'] = el('div', 'fill', undefined, this.n['act']);

    // bottom left: health
    const bl = el('div', 'hud-bl', undefined, root);
    this.n['hp'] = el('div', 'hp-num', '100', bl);
    const bar = el('div', 'hp-bar', undefined, bl);
    this.n['hpFill'] = el('div', 'fill', undefined, bar);
    this.n['role'] = el('div', 'hp-role', '', bl);

    // bottom right: ammo + gadgets
    const br = el('div', 'hud-br', undefined, root);
    this.n['weapon'] = el('div', 'w-name', '', br);
    const ammoRow = el('div', 'ammo-row', undefined, br);
    this.n['ammo'] = el('span', 'ammo', '0', ammoRow);
    this.n['reserve'] = el('span', 'reserve', '/ 0', ammoRow);
    this.n['gadget'] = el('div', 'gadget', '', br);
    this.n['thr'] = el('div', 'gadget thr', '', br);
    this.n['reinf'] = el('div', 'reinf hidden', '', br);

    // feeds
    this.killfeed = el('div', 'killfeed', undefined, root);
    this.toasts = el('div', 'toasts', undefined, root);
    this.banner = el('div', 'banner hidden', undefined, root);
    this.n['bannerMain'] = el('div', 'banner-main', '', this.banner);
    this.bannerSub = el('div', 'banner-sub', '', this.banner);

    // damage
    this.damageRoot = el('div', 'dmg-root', undefined, root);
    this.vignette = el('div', 'dmg-vignette', undefined, root);
    this.n['lowhp'] = el('div', 'lowhp', undefined, root);

    // drone overlay
    const drone = el('div', 'drone-overlay hidden', undefined, root);
    this.n['drone'] = drone;
    el('div', 'drone-rec', 'REC  DRONE', drone);
    el('div', 'drone-reticle', undefined, drone);
    this.n['droneHp'] = el('div', 'drone-hp', '', drone);
    this.n['droneStatic'] = el('div', 'drone-static hidden', 'SIGNAL JAMMED', drone);
    const cam = el('div', 'cam-overlay hidden', undefined, root);
    this.n['cam'] = cam;
    el('div', 'drone-rec', 'REC  CAMERA', cam);

    // spectate
    this.n['spec'] = el('div', 'spec-bar hidden', '', root);
    this.n['sense'] = el('div', 'sense hidden', 'PULSE SENSOR ACTIVE', root);
    this.n['debug'] = el('pre', 'hud-debug hidden', '', root);
  }

  show(on: boolean): void {
    setClass(this.root, 'hidden', !on);
  }

  update(m: HudModel): void {
    const n = this.n as Record<string, HTMLElement>;
    setText(n['sf'] as HTMLElement, String(m.scoreFriend));
    setText(n['so'] as HTMLElement, String(m.scoreFoe));
    setText(n['phase'] as HTMLElement, m.phaseLabel);
    setText(n['timer'] as HTMLElement, m.timer);
    setClass(n['timer'] as HTMLElement, 'hot', m.timerHot);

    this.syncPips(this.friendPips, m.friendAlive, m.friendTotal);
    this.syncPips(this.foePips, m.foeAlive, m.foeTotal);

    setText(n['hp'] as HTMLElement, String(Math.max(0, Math.ceil(m.hp))));
    (n['hpFill'] as HTMLElement).style.width = Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100)) + '%';
    setClass(n['hpFill'] as HTMLElement, 'low', m.hp < 35);
    setClass(n['lowhp'] as HTMLElement, 'on', m.alive && m.hp < 30 && m.hp > 0);
    setText(n['role'] as HTMLElement, m.role === 'attack' ? 'ATTACKER' : m.role === 'defend' ? 'DEFENDER' : 'PRACTICE');
    setClass(n['role'] as HTMLElement, 'atk', m.role === 'attack');
    setClass(n['role'] as HTMLElement, 'def', m.role === 'defend');

    setText(n['weapon'] as HTMLElement, m.weaponName + (m.fireMode ? '   ' + m.fireMode : ''));
    setText(n['ammo'] as HTMLElement, m.reloading ? '...' : m.ammo > m.magSize ? `${m.magSize}+${m.ammo - m.magSize}` : String(m.ammo));
    setClass(n['ammo'] as HTMLElement, 'low', m.ammo <= Math.max(2, m.magSize * 0.2) && !m.reloading);
    setText(n['reserve'] as HTMLElement, '/ ' + m.reserve);
    const gad = m.gadgetLabel ? `${m.gadgetLabel}  x${m.gadgetUses}${m.gadgetCd > 0.05 ? '  ' + Math.ceil(m.gadgetCd) + 's' : ''}` : '';
    setText(n['gadget'] as HTMLElement, gad);
    setClass(n['gadget'] as HTMLElement, 'hidden', gad === '');
    const thr = m.thrLabel ? `${m.thrLabel}  x${m.thrCount}${m.thrCd > 0.05 ? '  ' + m.thrCd.toFixed(1) + 's' : ''}` : '';
    setText(n['thr'] as HTMLElement, thr);
    setClass(n['thr'] as HTMLElement, 'hidden', thr === '');
    (n['flash'] as HTMLElement).style.opacity = String(Math.round(m.flash * 100) / 100);
    setText(n['reinf'] as HTMLElement, 'REINFORCEMENTS  x' + m.reinf);
    setClass(n['reinf'] as HTMLElement, 'hidden', !m.showReinf);

    const showCross = m.alive && !m.hideCrosshair && !m.inDrone && !m.inCamera;
    setClass(n['cross'] as HTMLElement, 'hidden', !showCross);
    if (showCross) {
      (n['cross'] as HTMLElement).style.setProperty('--gap', Math.round(m.crosshair) + 'px');
      setClass(n['cross'] as HTMLElement, 'ads', m.ads);
    }

    setText(n['prompt'] as HTMLElement, m.prompt);
    setClass(n['prompt'] as HTMLElement, 'hidden', m.prompt === '' || !m.alive);
    const actOn = m.actProgress > 0.001;
    setClass(n['act'] as HTMLElement, 'hidden', !actOn);
    if (actOn) (n['actFill'] as HTMLElement).style.width = Math.round(m.actProgress * 100) + '%';

    const capOn = m.captureProgress > 0.001;
    setClass(n['capture'] as HTMLElement, 'hidden', !capOn);
    if (capOn) (n['captureFill'] as HTMLElement).style.width = Math.round(m.captureProgress * 100) + '%';

    setClass(n['drone'] as HTMLElement, 'hidden', !m.inDrone);
    if (m.inDrone) {
      setText(n['droneHp'] as HTMLElement, 'DRONE HP ' + Math.max(0, Math.round(m.droneHp)));
      setClass(n['droneStatic'] as HTMLElement, 'hidden', !m.jammed);
    }
    setClass(n['cam'] as HTMLElement, 'hidden', !m.inCamera);
    setText(n['spec'] as HTMLElement, m.spectating ? 'SPECTATING  ' + m.spectating + '   (tap or arrows to switch)' : '');
    setClass(n['spec'] as HTMLElement, 'hidden', !m.spectating);
    setClass(n['sense'] as HTMLElement, 'hidden', m.sensor <= 0);
    setText(n['debug'] as HTMLElement, m.debug);
    setClass(n['debug'] as HTMLElement, 'hidden', m.debug === '');

    this.updateMarkers(m.markers, m.markerCount);
    for (let i = 0; i < this.worldMarks.length; i++) {
      const node = this.worldMarks[i] as HTMLElement;
      const wm = i < m.markCount && m.alive ? m.marks[i] : undefined;
      if (!wm) {
        if (!node.classList.contains('hidden')) node.classList.add('hidden');
        continue;
      }
      node.classList.remove('hidden');
      const cls = 'world-mark' + (wm.enemy ? ' enemy' : '') + (wm.edge ? ' edge' : '');
      if (node.className !== cls) node.className = cls;
      node.style.left = wm.x * 100 + '%';
      node.style.top = wm.y * 100 + '%';
      node.style.opacity = String(wm.alpha);
      setText(node.lastElementChild as HTMLElement, Math.round(wm.dist) + ' m');
    }
    this.lastHp = m.hp;
  }

  private syncPips(container: HTMLElement, alive: number, total: number): void {
    while (container.children.length < total) el('div', 'pip', undefined, container);
    while (container.children.length > total) container.removeChild(container.lastChild as Node);
    for (let i = 0; i < container.children.length; i++) {
      setClass(container.children[i] as HTMLElement, 'dead', i >= alive);
    }
  }

  private updateMarkers(list: CompassMarker[], count: number): void {
    const half = Math.PI / 2;
    for (let i = 0; i < this.markers.length; i++) {
      const node = this.markers[i] as HTMLElement;
      const m = i < count ? list[i] : undefined;
      if (!m || Math.abs(m.rel) > half) {
        if (!node.classList.contains('hidden')) node.classList.add('hidden');
        continue;
      }
      node.classList.remove('hidden');
      const cls = 'cmark ' + m.kind;
      if (node.className !== cls) node.className = cls;
      node.style.left = 50 + (m.rel / half) * 50 + '%';
      node.style.opacity = String(m.alpha);
    }
  }

  hitMarker(head: boolean, kill: boolean): void {
    this.hit.classList.remove('hidden');
    this.hit.classList.toggle('head', head);
    this.hit.classList.toggle('kill', kill);
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.hit.classList.add('hidden'), kill ? 380 : 160);
  }

  /** dx, dz is the direction to the attacker in world space; yaw is the player's view yaw. */
  damageIndicator(dx: number, dz: number, yaw: number): void {
    const worldAngle = Math.atan2(-dx, -dz); // yaw that looks at the attacker
    const rel = worldAngle - yaw;
    const ind = el('div', 'dmg-ind', undefined, this.damageRoot);
    ind.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
    setTimeout(() => ind.remove(), 900);
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }

  flashDamage(): void {
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }

  killEntry(killer: string, victim: string, weapon: string, head: boolean, mine: boolean, killerColor: string, victimColor: string): void {
    const row = el('div', 'kf' + (mine ? ' mine' : ''), undefined, this.killfeed);
    const k = el('span', 'kf-name', killer, row);
    k.style.color = killerColor;
    el('span', 'kf-weapon', (head ? '[HS] ' : '') + weapon, row);
    const v = el('span', 'kf-name', victim, row);
    v.style.color = victimColor;
    while (this.killfeed.children.length > 5) this.killfeed.removeChild(this.killfeed.firstChild as Node);
    setTimeout(() => row.remove(), 6000);
  }

  toast(text: string): void {
    const t = el('div', 'toast', text, this.toasts);
    while (this.toasts.children.length > 4) this.toasts.removeChild(this.toasts.firstChild as Node);
    setTimeout(() => t.remove(), 3200);
  }

  showBanner(main: string, sub = '', ms = 2600, cls = ''): void {
    this.banner.className = 'banner ' + cls;
    setText(this.n['bannerMain'] as HTMLElement, main);
    setText(this.bannerSub, sub);
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => this.banner.classList.add('hidden'), ms);
  }

  hideBanner(): void {
    this.banner.classList.add('hidden');
  }

  private bannerTimer = 0;

  reset(): void {
    clear(this.killfeed);
    clear(this.toasts);
    clear(this.damageRoot);
    this.hideBanner();
  }

  get lastHealth(): number {
    return this.lastHp;
  }
}
