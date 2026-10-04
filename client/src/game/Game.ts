// The client game: fixed step simulation with prediction, remote interpolation, rendering,
// effects, audio and HUD feeding. Owns everything below it.

import * as THREE from 'three';
import {
  COLORS, DRONE, GameMode, MaterialId, PFlag, PhaseId, SIM_DT, Btn, EntityKind, HitKind,
  activeWeapon, activeWeaponId, buildShotRays, clamp, eyeHeight, lerp, makeCmd, makeRayHit, makeStepOut, operatorDef,
  parseMap, quantizeCmd, raySphere, rayAabb, stateFromArray, wrapAngle, World, weaponDef, MAX_PELLETS, PLAYER,
  type ClientMsg, type GameEvent, type InputCmd, type PhaseInfo, type RoomState, type SelfExtra,
  type ServerMsg, type Snapshot, createPlayerState, type PlayerState, makeExtra, type SoundKind,
} from '@holdfast/shared';
import type { GameAudio } from '../audio/Audio';
import type { InputState } from '../input/InputState';
import type { ClockSync } from '../net/ClockSync';
import { Interpolator, makePose, type Pose } from '../net/Interpolation';
import { Prediction } from '../net/Prediction';
import { isTouchDevice, settings } from '../settings';
import { emptyModel, type CompassMarker, type Hud, type HudModel } from '../ui/Hud';
import { Effects } from './Effects';
import { EntityViews } from './EntityViews';
import { PlayerView } from './PlayerView';
import { Renderer } from './Renderer';
import { Viewmodel } from './Viewmodel';
import { WorldView } from './WorldView';

type JoinedMsg = Extract<ServerMsg, { t: 'JOINED' }>;

export interface GameHost {
  send(msg: ClientMsg): void;
  clock: ClockSync;
  audio: GameAudio;
  input: InputState;
  hud: Hud;
  practice: boolean;
  /** true while a menu overlay captures input */
  isPaused(): boolean;
  onPhaseUi(prev: PhaseInfo | null, next: PhaseInfo): void;
  haptic(ms: number): void;
  isTouchActive(): boolean;
}

interface PingMarker {
  x: number;
  z: number;
  born: number;
  exact: boolean;
}

const FAR_SHOT = 160;
const PROMPTS = ['', 'E  Open door', 'E  Close door', 'E  Vault', 'Hold E  Reinforce wall', 'Hold E  Barricade', 'F  Detonate charge'];
const EYE_SMOOTH = 12;

export class Game {
  readonly renderer: Renderer;
  readonly world: World;
  private worldView: WorldView;
  private effects: Effects;
  private entityViews: EntityViews;
  private viewmodel: Viewmodel;
  private pred = new Prediction();
  private interp = new Interpolator();
  private playerViews = new Map<number, PlayerView>();
  private lastPoses = new Map<number, Pose>();
  private pose = makePose();

  myId: number;
  room: RoomState;
  phase: PhaseInfo;
  extra: SelfExtra = makeExtra();

  // aim
  yaw = 0;
  pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private recoilVP = 0;
  private recoilVY = 0;
  private seq = 0;
  private acc = 0;
  private stepCount = 0;
  private lastFrame = 0;
  private stepOut = makeStepOut();
  private eyeH = PLAYER.eyeStand;
  private adsT = 0;
  private rayBuf = new Float64Array(MAX_PELLETS * 3);
  private hitTmp = makeRayHit();
  private tmpV = new THREE.Vector3();

  // state tracking for UI/audio
  private snapCount = 0;
  private snapRate = 0;
  private snapRateT = 0;
  private fpsMs = 16;
  private lastBeepSec = -1;
  private pings: PingMarker[] = [];
  private sensePts: { x: number; y: number; z: number; born: number }[] = [];
  private senseMeshes: THREE.Mesh[] = [];
  private droneHum = false;
  private droneBob = 0;
  private droneRoll = 0;
  private disposed = false;
  private tagged = new Set<number>();
  private unsent: InputCmd[] = [];
  private spectateId = 0;
  private shotsFiredVisual = 0;
  private nextNameSync = 0;
  attackerTeam: number;
  private modelCache: HudModel = emptyModel();

  constructor(canvas: HTMLCanvasElement, private host: GameHost, joined: JoinedMsg, renderer?: Renderer) {
    this.myId = joined.playerId;
    this.room = joined.room;
    this.phase = joined.phase;
    this.attackerTeam = joined.phase.attackerTeam;
    this.renderer = renderer ?? new Renderer(canvas);
    this.renderer.resetScene();
    this.world = new World(parseMap(joined.mapText));
    this.world.applyDiff(joined.world);
    this.worldView = new WorldView(this.world, this.renderer.scene);
    this.effects = new Effects(this.renderer.scene);
    this.worldView.onDebris = (x, y, z, m): void => this.effects.debris(x, y, z, m);
    this.entityViews = new EntityViews(this.renderer.scene, () => this.phase.attackerTeam);
    this.viewmodel = new Viewmodel(this.renderer.vmScene, COLORS.attackers);
    this.host.clock.init(joined.serverTime);

    const sense = new THREE.SphereGeometry(0.22, 10, 8);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(sense, new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, depthTest: false, opacity: 0.7 }));
      m.visible = false;
      m.renderOrder = 998;
      this.renderer.scene.add(m);
      this.senseMeshes.push(m);
    }
    this.recountTeams();
    this.setPhase(joined.phase, false);
    this.lastFrame = performance.now();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    this.host.audio.setHum(false);
    this.worldView.dispose();
    this.entityViews.clear();
    for (const v of this.playerViews.values()) this.renderer.scene.remove(v.root);
    this.playerViews.clear();
  }

  get myTeam(): number {
    return this.room.players.find((p) => p.id === this.myId)?.team ?? 0;
  }

  get sandbox(): boolean {
    return this.phase.mode === GameMode.SANDBOX;
  }

  get role(): 'attack' | 'defend' | 'free' {
    if (this.sandbox) return 'free';
    return this.myTeam === this.phase.attackerTeam ? 'attack' : 'defend';
  }

  private get playing(): boolean {
    return this.phase.phase === PhaseId.PREP || this.phase.phase === PhaseId.ACTION || this.phase.phase === PhaseId.ROUND_END;
  }

  private teamColor(team: number): number {
    if (this.sandbox) return team === this.myTeam ? COLORS.attackers : COLORS.defenders;
    return team === this.phase.attackerTeam ? COLORS.attackers : COLORS.defenders;
  }

  // -------------------------------------------------------------------------
  // Server messages
  // -------------------------------------------------------------------------

  onRoom(room: RoomState): void {
    this.room = room;
    this.recountTeams();
  }

  private recountTeams(): void {
    const mine = this.myTeam;
    let ft = 0, fe = 0, fa = 0, ea = 0;
    for (const p of this.room.players) {
      if (!p.connected) continue;
      if (p.team === mine) {
        ft++;
        if (p.alive) fa++;
      } else {
        fe++;
        if (p.alive) ea++;
      }
    }
    this.friendTotal = ft;
    this.foeTotal = fe;
    this.friendAlive = fa;
    this.foeAlive = ea;
  }

  setPhase(next: PhaseInfo, reset: boolean, worldDiff?: import('@holdfast/shared').WorldDiff): void {
    const prev = this.phase;
    this.phase = next;
    this.attackerTeam = next.attackerTeam;
    this.recountTeams();
    if (reset) {
      this.world.reset();
      if (worldDiff) this.world.applyDiff(worldDiff);
      this.worldView.refresh();
      this.entityViews.clear();
      this.interp.clear();
      for (const v of this.playerViews.values()) this.renderer.scene.remove(v.root);
      this.playerViews.clear();
      this.pings.length = 0;
      this.host.hud.reset();
    }
    const showObj = next.objective >= 0 && (next.phase === PhaseId.PREP || next.phase === PhaseId.ACTION);
    this.worldView.setObjective(showObj ? next.objective : -1);
    if (prev.phase !== next.phase || reset) {
      this.lastBeepSec = -1;
      this.host.onPhaseUi(prev, next);
    }
    this.viewmodel.setAccent(this.role === 'defend' ? COLORS.defenders : COLORS.attackers);
  }

  onSnapshot(s: Snapshot): void {
    if (this.disposed) return;
    this.snapCount++;
    if (s.world) this.world.applyDiff(s.world);
    const wasReady = this.pred.ready;
    this.pred.reconcile(s.self, s.ack, this.world);
    if (!wasReady) {
      this.yaw = this.pred.state.yaw;
      this.pitch = this.pred.state.pitch;
    }
    this.extra = s.extra;
    this.tagged.clear();
    for (const p of s.players) if (p.flags & PFlag.TAGGED) this.tagged.add(p.id);
    this.interp.push(s.time, s.players, s.entities);
    this.latestEntities = s.entities;
    for (const ev of s.events) this.handleEvent(ev);
  }

  private latestEntities: Snapshot['entities'] = [];

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private playerName(id: number): string {
    if (id === 0) return 'World';
    const p = this.room.players.find((x) => x.id === id);
    return p ? p.name : id >= 100 && id < 200 ? 'Target ' + (id - 99) : 'Player';
  }

  private playerTeam(id: number): number {
    const p = this.room.players.find((x) => x.id === id);
    if (p) return p.team;
    return 1 - this.myTeam;
  }

  private handleEvent(ev: GameEvent): void {
    const audio = this.host.audio;
    const hud = this.host.hud;
    switch (ev.k) {
      case 'shot': {
        const mine = ev.id === this.myId;
        const def = weaponDef(ev.w);
        const view = this.playerViews.get(ev.id);
        if (view) view.fired();
        let ox = ev.ox;
        let oy = ev.oy;
        let oz = ev.oz;
        if (!mine) {
          // start the tracer near the muzzle rather than the eye
          const pose = this.lastPoses.get(ev.id);
          if (pose) {
            ox = pose.x - Math.sin(pose.yaw) * 0.5;
            oz = pose.z - Math.cos(pose.yaw) * 0.5;
            oy = pose.y + 1.3;
          }
        }
        for (let i = 0; i + 3 < ev.ends.length; i += 4) {
          const ex = ev.ends[i] as number;
          const ey = ev.ends[i + 1] as number;
          const ez = ev.ends[i + 2] as number;
          const kind = ev.ends[i + 3] as number;
          if (!mine) this.effects.tracer(ox, oy, oz, ex, ey, ez);
          if (kind === 2) this.effects.impact(ex, ey, ez, 0, 0.5, 0, true);
          else if (kind === 1 && !mine) this.effects.impact(ex, ey, ez, 0, 0.6, 0, false);
        }
        if (!mine) {
          audio.play('shot_' + def.name.toLowerCase(), { pos: { x: ev.ox, y: ev.oy, z: ev.oz }, gain: 0.9, occluded: this.occluded(ev.ox, ev.oy, ev.oz) });
        }
        break;
      }
      case 'hit':
        hud.hitMarker(ev.head, ev.kill);
        audio.ui(ev.kill ? 'kill' : ev.head ? 'headshot' : 'hit', ev.head ? 0.9 : 0.7);
        break;
      case 'hurt': {
        hud.damageIndicator(ev.dx, ev.dz, this.yaw);
        audio.ui('hurt', 0.8);
        this.host.haptic(40);
        this.effects.addShake(0.2);
        break;
      }
      case 'kill': {
        const kt = this.playerTeam(ev.killer);
        const vt = this.playerTeam(ev.victim);
        const names = ['Carbine', 'Rattler', 'Hammer', 'Marksman', 'Sidearm', 'Breach', 'Trap'];
        hud.killEntry(
          this.playerName(ev.killer), this.playerName(ev.victim), names[ev.w] ?? 'Weapon', ev.head,
          ev.killer === this.myId, ev.killer ? this.cssColor(this.teamColor(kt)) : '#aaa', this.cssColor(this.teamColor(vt)),
        );
        const pose = this.lastPoses.get(ev.victim);
        if (pose) this.effects.burst(pose.x, pose.y + 1, pose.z, this.teamColor(vt), 14);
        break;
      }
      case 'snd':
        this.handleSound(ev);
        break;
      case 'boom': {
        this.effects.boom(ev.x, ev.y, ev.z, ev.r);
        const cam = this.renderer.camera.position;
        const d = Math.hypot(cam.x - ev.x, cam.y - ev.y, cam.z - ev.z);
        this.effects.addShake(Math.max(0, 1 - d / 22) * 0.9);
        if (d < 22) this.host.haptic(80);
        break;
      }
      case 'msg':
        hud.toast(ev.text);
        break;
      case 'melee': {
        const v = this.playerViews.get(ev.id);
        if (v) v.melee();
        break;
      }
      case 'spawn':
        if (ev.id === this.myId) {
          this.yaw = ev.yaw;
          this.pitch = 0;
          this.recoilPitch = this.recoilYaw = this.recoilVP = this.recoilVY = 0;
        }
        break;
      case 'tag':
        hud.toast('Enemy tagged');
        audio.ui('ping', 0.7);
        break;
      case 'sense':
        this.sensePts.length = 0;
        for (let i = 0; i + 2 < ev.pts.length && this.sensePts.length < 8; i += 3) {
          this.sensePts.push({ x: ev.pts[i] as number, y: ev.pts[i + 1] as number, z: ev.pts[i + 2] as number, born: performance.now() });
        }
        if (ev.pts.length) audio.ui('ping', 0.35);
        break;
      default:
        break;
    }
  }

  private cssColor(c: number): string {
    return '#' + c.toString(16).padStart(6, '0');
  }

  private occluded(x: number, y: number, z: number): boolean {
    const p = this.renderer.camera.position;
    return !this.world.lineOfSight(p.x, p.y, p.z, x, y, z);
  }

  private surfaceAt(x: number, y: number, z: number): 'wood' | 'concrete' | 'metal' {
    const b = this.world.map.building;
    const inside = x >= b.x0 * 0.5 && x <= b.x1 * 0.5 && z >= b.z0 * 0.5 && z <= b.z1 * 0.5;
    if (!inside) return 'concrete';
    if (y > 2.5) return 'wood';
    const top = this.world.stairTop[Math.floor(z / 0.5) * this.world.nx + Math.floor(x / 0.5)] as number;
    if (top > 0) return 'metal';
    return 'wood';
  }

  private handleSound(ev: Extract<GameEvent, { k: 'snd' }>): void {
    const mine = ev.src === this.myId;
    const myTeam = this.myTeam;
    const srcTeam = ev.src === 0 ? -1 : this.playerTeam(ev.src);
    const enemy = srcTeam !== -1 && srcTeam !== myTeam;
    // compass pings for enemy noises
    if (enemy && (ev.s === 'step' || ev.s === 'shot' || ev.s === 'breach' || ev.s === 'door' || ev.s === 'barricade' || ev.s === 'reinforce' || ev.s === 'boom' || ev.s === 'wall' || ev.s === 'glass')) {
      this.pings.push({ x: ev.x, z: ev.z, born: performance.now(), exact: ev.exact });
      if (this.pings.length > 12) this.pings.shift();
    }
    const localOnly: SoundKind[] = ['shot', 'reload', 'melee', 'vault', 'gadget'];
    if (mine && localOnly.includes(ev.s)) return;
    let name: string;
    switch (ev.s) {
      case 'step': name = 'step_' + this.surfaceAt(ev.x, ev.y, ev.z); break;
      case 'door': name = Math.random() < 0.5 ? 'door_open' : 'door_close'; break;
      case 'shot': name = 'shot_carbine'; break;
      case 'boom': name = 'boom'; break;
      default: name = ev.s;
    }
    const gain = ev.s === 'step' ? 0.55 : ev.s === 'breach' ? 1.2 : 0.8;
    this.host.audio.play(name, { pos: { x: ev.x, y: ev.y, z: ev.z }, gain, occluded: !ev.exact || this.occluded(ev.x, ev.y, ev.z), maxDist: ev.v });
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  /** Called from requestAnimationFrame. */
  frame(now: number): void {
    if (this.disposed) return;
    const dtMs = now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(0.1, dtMs / 1000);
    this.fpsMs += (dtMs - this.fpsMs) * 0.05;
    this.renderer.adapt(this.fpsMs, dt);

    const input = this.host.input;
    const active = this.playing && !this.host.isPaused() && this.pred.ready;
    const look = input.consumeLook();
    if (active) {
      this.applyLook(look.dx, look.dy, dt);
      this.noteLook(look.dx, look.dy);
    }

    if (this.pred.ready) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 6) {
        this.simStep(active);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
    }
    this.pred.decay(dt);
    this.updateScene(dt, now);
    this.renderer.render(this.viewmodelVisible);
  }

  private viewmodelVisible = false;
  /** Debug: override the camera (screenshots, map inspection). */
  freeCam: { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number } | null = null;

  private applyLook(dx: number, dy: number, dt: number): void {
    const s = this.pred.state;
    const touch = this.host.isTouchActive();
    const base = touch ? 0.0042 : 0.0022;
    const fovScale = this.renderer.fovCurrent / this.baseVFov();
    const k = base * settings.sens * fovScale;
    this.yaw = wrapAngle(this.yaw - dx * k);
    this.pitch = clamp(this.pitch - dy * k * (settings.invertY ? -1 : 1), -PLAYER.pitchLimit, PLAYER.pitchLimit);

    if (touch && settings.aimAssist && s.alive && (this.host.input.held & Btn.FIRE || s.ads)) this.aimAssist(dt);
  }

  /** Gentle magnetism toward the nearest enemy head within a narrow cone. */
  private aimAssist(dt: number): void {
    const s = this.pred.state;
    const ex = s.x;
    const ey = s.y + eyeHeight(s);
    const ez = s.z;
    let bestErr = 0.09;
    let by = 0;
    let bp = 0;
    for (const [id, pose] of this.lastPoses) {
      if (this.playerTeam(id) === this.myTeam) continue;
      const hy = pose.y + ((pose.flags & PFlag.CROUCH) !== 0 ? 1.0 : 1.5);
      const dx = pose.x - ex;
      const dz = pose.z - ez;
      const dy = hy - ey;
      const horiz = Math.hypot(dx, dz);
      if (horiz < 0.5 || horiz > 40) continue;
      const ty = Math.atan2(-dx, -dz);
      const tp = Math.atan2(dy, horiz);
      const ey2 = wrapAngle(ty - this.yaw);
      const ep = tp - this.pitch;
      const err = Math.hypot(ey2, ep);
      if (err < bestErr) {
        bestErr = err;
        by = ey2;
        bp = ep;
      }
    }
    if (bestErr < 0.09) {
      const f = Math.min(1, dt * 5) * 0.55;
      this.yaw = wrapAngle(this.yaw + by * f);
      this.pitch = clamp(this.pitch + bp * f, -PLAYER.pitchLimit, PLAYER.pitchLimit);
    }
  }

  private simStep(active: boolean): void {
    const input = this.host.input;
    const cmd = makeCmd();
    cmd.seq = ++this.seq;
    cmd.dt = SIM_DT;
    const alive = this.pred.state.alive;
    if (active) {
      let mx = input.moveX;
      let mz = input.moveZ;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
      cmd.moveX = mx;
      cmd.moveZ = mz;
      cmd.buttons = input.sampleButtons();
      cmd.slot = input.slot;
    } else {
      cmd.buttons = 0;
      cmd.slot = this.pred.state.slot;
      input.sampleButtons();
    }
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
    cmd.clientTime = this.host.clock.now();
    quantizeCmd(cmd);
    const prevSlot = this.pred.state.slot;
    this.pred.step(cmd, this.world, this.stepOut);
    this.stepCount++;
    const s = this.pred.state;
    if (alive && s.alive) this.onLocalOutputs(prevSlot);
    this.unsent.push(cmd);
    if (this.unsent.length > 8) this.unsent.shift();
    if (this.stepCount % 2 === 0 && !document.hidden) {
      this.host.send({ t: 'INPUT', cmds: this.unsent.slice(-6) });
      this.unsent.length = 0;
    }
  }

  private onLocalOutputs(prevSlot: number): void {
    const out = this.stepOut;
    const s = this.pred.state;
    const audio = this.host.audio;
    if (out.fired) this.onLocalShot(out.shotIdx, out.weapon);
    else if (out.firePressed && !s.dCtl && !s.cam && s.vault <= 0) {
      const ammo = s.slot === 0 ? s.ammo0 : s.ammo1;
      if (ammo <= 0 && !s.reloading) audio.ui('empty', 0.6);
    }
    if (out.reloadStarted) audio.ui('reload', 0.8);
    if (out.switched || prevSlot !== s.slot) this.viewmodel.setWeapon(activeWeaponId(s));
    if (out.vaultStarted) audio.ui('vault', 0.8);
    if (out.meleePressed && !s.dCtl && !s.cam && s.vault <= 0) {
      this.viewmodel.meleeSwing();
      audio.ui('melee', 0.7);
    }
    if (out.gadgetPressed) audio.ui('gadget', 0.5);
    if (out.droneToggled) audio.ui('ui', 0.5);
    if (out.droneHop && s.dCtl) {
      audio.ui('drone', 0.55);
      this.effects.shake = Math.max(this.effects.shake, 0.15);
    }
    if (out.droneLand > 1.5 && s.dCtl) {
      audio.ui('drone_land', Math.min(0.8, 0.3 + out.droneLand * 0.06));
      this.effects.shake = Math.max(this.effects.shake, Math.min(1, out.droneLand * 0.08));
    }
  }

  private onLocalShot(shotIdx: number, weaponId: number): void {
    const def = weaponDef(weaponId);
    const s = this.pred.state;
    buildShotRays(s, this.myId, shotIdx, def, this.rayBuf);
    const ox = s.x;
    const oy = s.y + eyeHeight(s);
    const oz = s.z;
    // tracer start near the muzzle: slightly right/below/forward of the eye
    const cam = this.renderer.camera;
    const m = this.viewmodel.muzzleLocal(this.tmpV);
    cam.localToWorld(m);
    const mx = m.x, my = m.y, mz = m.z;
    for (let p = 0; p < def.pellets; p++) {
      const dx = this.rayBuf[p * 3] as number;
      const dy = this.rayBuf[p * 3 + 1] as number;
      const dz = this.rayBuf[p * 3 + 2] as number;
      let t = FAR_SHOT;
      let wallHit = false;
      let wallN: [number, number, number] = [0, 1, 0];
      if (this.world.raycast(ox, oy, oz, dx, dy, dz, FAR_SHOT, this.hitTmp)) {
        t = this.hitTmp.t;
        wallHit = true;
        wallN = [this.hitTmp.nx, this.hitTmp.ny, this.hitTmp.nz];
        // glass does not stop the tracer
        if (this.hitTmp.kind === HitKind.CELL && this.world.materialOf(this.hitTmp.id) === MaterialId.GLASS) {
          wallHit = false;
        }
      }
      // enemies in front of the wall stop the tracer
      let flesh = false;
      for (const [id, pose] of this.lastPoses) {
        if (this.playerTeam(id) === this.myTeam) continue;
        const crouch = (pose.flags & PFlag.CROUCH) !== 0;
        const eye = crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
        const th = raySphere(ox, oy, oz, dx, dy, dz, pose.x, pose.y + eye - 0.1, pose.z, 0.2, t);
        const tb = rayAabb(ox, oy, oz, dx, dy, dz, pose.x - 0.3, pose.y, pose.z - 0.3, pose.x + 0.3, pose.y + eye - 0.3, pose.z + 0.3, t);
        const tt = th >= 0 && (tb < 0 || th < tb) ? th : tb;
        if (tt >= 0 && tt < t) {
          t = tt;
          flesh = true;
          wallHit = false;
        }
      }
      const ex = ox + dx * t;
      const ey = oy + dy * t;
      const ez = oz + dz * t;
      this.effects.tracer(mx, my, mz, ex, ey, ez);
      if (wallHit) this.effects.impact(ex, ey, ez, wallN[0], wallN[1], wallN[2], false);
      else if (flesh) this.effects.impact(ex, ey, ez, 0, 0.4, 0, true);
    }
    this.viewmodel.fire(def.recoilPitch);
    const adsK = s.ads ? 0.55 : 1;
    this.recoilVP += def.recoilPitch * 26 * adsK;
    this.recoilVY += (Math.random() - 0.5) * def.recoilYaw * 26;
    this.host.audio.ui('shot_' + def.name.toLowerCase(), 0.95);
    this.host.haptic(def.pellets > 1 ? 30 : 12);
    this.shotsFiredVisual++;
  }

  // -------------------------------------------------------------------------
  // Scene update
  // -------------------------------------------------------------------------

  private updateScene(dt: number, now: number): void {
    const r = this.renderer;
    const s = this.pred.state;
    const audio = this.host.audio;
    const t = this.host.clock.now();
    const renderTime = t - this.interp.delayMs;

    // remote players
    this.updateRemotePlayers(dt, renderTime);
    this.entityViews.sync(this.latestEntities, (id, out) => this.interp.sampleEntity(id, renderTime, out), dt, (owner) => owner === this.myId && s.dCtl);
    this.worldView.update(dt);
    this.effects.update(dt);

    // recoil springs (cosmetic only), sub stepped so low frame rates stay stable
    for (let left = dt; left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.recoilVP += (-this.recoilPitch * 160 - this.recoilVP * 16) * h;
      this.recoilPitch += this.recoilVP * h;
      this.recoilVY += (-this.recoilYaw * 160 - this.recoilVY * 16) * h;
      this.recoilYaw += this.recoilVY * h;
    }

    // camera
    const inLobby = this.phase.phase === PhaseId.LOBBY || this.phase.phase === PhaseId.OPERATOR_SELECT || this.phase.phase === PhaseId.MATCH_END;
    const cam = r.camera;
    let viewYaw = this.yaw;
    let viewPitch = this.pitch;
    let ex = 0, ey = 0, ez = 0;
    let fp = true; // first person body view with viewmodel

    if (this.freeCam) {
      const f = this.freeCam;
      cam.position.set(f.x, f.y, f.z);
      cam.rotation.set(f.pitch, f.yaw, 0);
      viewYaw = f.yaw;
      viewPitch = f.pitch;
      ex = f.x; ey = f.y; ez = f.z;
      fp = false;
      r.setFov(f.fov ?? 70);
    } else if (inLobby || !this.pred.ready) {
      const b = this.worldView.bounds();
      const a = now / 1000 * 0.08;
      const rad = b.radius * 1.15;
      ex = b.cx + Math.sin(a) * rad;
      ez = b.cz + Math.cos(a) * rad;
      ey = 13;
      cam.position.set(ex, ey, ez);
      cam.lookAt(b.cx, 1.5, b.cz);
      viewYaw = Math.atan2(-(b.cx - ex), -(b.cz - ez));
      viewPitch = -0.45;
      fp = false;
      r.setFov(this.baseVFov() * 0.85);
    } else if (!s.alive) {
      // spectate a teammate, or hover at the place of death
      const specId = this.extra.spec || this.spectateId;
      let pose: Pose | null = null;
      if (specId && this.interp.samplePlayer(specId, renderTime, this.pose)) pose = this.pose;
      if (pose) {
        const crouch = (pose.flags & PFlag.CROUCH) !== 0;
        ex = pose.x;
        ey = pose.y + (crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand);
        ez = pose.z;
        viewYaw = pose.yaw;
        viewPitch = pose.pitch;
      } else {
        const a = this.pred.state;
        ex = a.x;
        ey = a.y + 2.4;
        ez = a.z;
      }
      cam.position.set(ex, ey, ez);
      cam.rotation.set(viewPitch, viewYaw, 0);
      fp = false;
      r.setFov(this.baseVFov());
    } else if (s.dCtl) {
      // drone view: a camera a hand's breadth above the floor that bounces along with the chassis
      const a = this.acc / SIM_DT;
      const p = this.pred.prev;
      const sp = Math.hypot(s.dvx, s.dvz);
      this.droneBob += dt * (7 + sp * 6);
      const lateral = s.dvx * Math.cos(this.yaw) - s.dvz * Math.sin(this.yaw);
      this.droneRoll += (-lateral * 0.025 - this.droneRoll) * Math.min(1, dt * 8);
      const roll = clamp(this.droneRoll, -0.12, 0.12);
      ex = lerp(p.dx, s.dx, a);
      ey = lerp(p.dy, s.dy, a) + DRONE.camUp + Math.sin(this.droneBob) * 0.005 * Math.min(1, sp / DRONE.speed);
      ez = lerp(p.dz, s.dz, a);
      const sh = this.effects.shake * 0.04;
      cam.position.set(ex + (Math.random() - 0.5) * sh, ey + (Math.random() - 0.5) * sh, ez + (Math.random() - 0.5) * sh);
      cam.rotation.set(clamp(this.pitch, -1.5, 1.5), this.yaw, roll);
      fp = false;
      r.setFov(this.baseVFov() * 1.12);
    } else if (s.cam && this.extra.camIdx >= 0) {
      const camEnt = this.latestEntities.filter((e) => e.kind === EntityKind.CAMERA && e.owner === this.myId)[this.extra.camIdx];
      if (camEnt) {
        ex = camEnt.x; ey = camEnt.y; ez = camEnt.z;
        cam.position.set(ex, ey, ez);
        cam.rotation.set(camEnt.b, camEnt.a, 0);
        viewYaw = camEnt.a;
        viewPitch = camEnt.b;
      }
      fp = false;
      r.setFov(this.baseVFov() * 1.2);
    } else {
      const a = this.acc / SIM_DT;
      const p = this.pred.prev;
      ex = lerp(p.x, s.x, a) + this.pred.offX;
      const targetEye = s.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
      this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * EYE_SMOOTH);
      ey = lerp(p.y, s.y, a) + this.pred.offY + this.eyeH;
      ez = lerp(p.z, s.z, a) + this.pred.offZ;
      const shake = this.effects.shake;
      cam.position.set(
        ex + (Math.random() - 0.5) * shake * 0.12,
        ey + (Math.random() - 0.5) * shake * 0.12,
        ez + (Math.random() - 0.5) * shake * 0.12,
      );
      viewYaw = this.yaw + this.recoilYaw;
      viewPitch = clamp(this.pitch + this.recoilPitch, -1.55, 1.55);
      cam.rotation.set(viewPitch, viewYaw, 0);
      // fov and ads
      const def = activeWeapon(s);
      this.adsT += ((s.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
      const base = this.baseVFov();
      const adsFov = def.adsFov * (base / 59);
      const fov = lerp(base * (s.sprint ? 1.06 : 1), adsFov, this.adsT);
      r.setFov(fov);
      if (s.vault > 0) cam.rotation.z = Math.sin((1 - s.vault / PLAYER.vaultTime) * Math.PI) * 0.05;
    }
    cam.updateMatrixWorld();

    // viewmodel
    this.viewmodelVisible = fp && s.alive && s.vault <= 0 && this.playing;
    const prog = s.reloading ? clamp(1 - s.reload / Math.max(0.1, activeWeapon(s).reload), 0, 1) : 0;
    this.viewmodel.update(dt, {
      speed: Math.hypot(s.vx, s.vz), ads: s.ads, sprint: s.sprint, reloading: s.reloading, reloadProgress: prog,
      lookDX: this.lastLookDX, lookDY: this.lastLookDY, onGround: s.onGround, crouch: s.crouch,
    }, this.viewmodelVisible);
    this.lastLookDX *= 0.8;
    this.lastLookDY *= 0.8;

    // audio listener and hum
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, viewYaw, viewPitch);
    const humWanted = s.dCtl && s.alive;
    if (humWanted !== this.droneHum) {
      this.droneHum = humWanted;
      audio.setHum(humWanted);
    }
    if (humWanted) audio.setHumLevel(Math.min(1, Math.hypot(s.dvx, s.dvz) / DRONE.speed));

    // sense markers
    for (let i = 0; i < this.senseMeshes.length; i++) {
      const m = this.senseMeshes[i] as THREE.Mesh;
      const pt = this.sensePts[i];
      const age = pt ? (performance.now() - pt.born) / 1000 : 99;
      if (!pt || age > 1.5) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(pt.x, pt.y, pt.z);
      const pulse = 1 + 0.25 * Math.sin(age * 12);
      m.scale.setScalar(pulse);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - age / 1.5);
    }

    this.updateHud(dt, viewYaw, ex, ez);
  }

  private seenScratch = new Set<number>();
  private friendTotal = 0;
  private foeTotal = 0;
  private friendAlive = 0;
  private foeAlive = 0;
  private markerPool: CompassMarker[] = [];
  private baseVFov(): number {
    return this.renderer.verticalFov(settings.fov);
  }

  private lastLookDX = 0;
  private lastLookDY = 0;
  noteLook(dx: number, dy: number): void {
    this.lastLookDX += dx;
    this.lastLookDY += dy;
  }

  private updateRemotePlayers(dt: number, renderTime: number): void {
    const present = this.interp.presentPlayers;
    const seen = this.seenScratch;
    seen.clear();
    for (const id of present) {
      let ok = this.interp.samplePlayer(id, renderTime, this.pose);
      if (!ok) continue;
      seen.add(id);
      let view = this.playerViews.get(id);
      if (!view) {
        const team = this.playerTeam(id);
        view = new PlayerView(id, this.playerName(id), team === this.myTeam, this.teamColor(team));
        this.playerViews.set(id, view);
        this.renderer.scene.add(view.root);
      }
      ok = true;
      view.update(this.pose, dt);
      let lp = this.lastPoses.get(id);
      if (!lp) {
        lp = makePose();
        this.lastPoses.set(id, lp);
      }
      Object.assign(lp, this.pose);
      // hide the model of the player we spectate
      view.root.visible = !(!this.pred.state.alive && (this.extra.spec === id));
    }
    for (const [id, v] of this.playerViews) {
      if (!seen.has(id)) {
        this.renderer.scene.remove(v.root);
        v.dispose();
        this.playerViews.delete(id);
        this.lastPoses.delete(id);
      }
    }
    // keep colors in sync when roles swap
    if (performance.now() > this.nextNameSync) {
      this.nextNameSync = performance.now() + 1000;
      for (const [id, v] of this.playerViews) v.setTeamColor(this.teamColor(this.playerTeam(id)));
    }
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  private updateHud(_dt: number, viewYaw: number, ex: number, ez: number): void {
    const hud = this.host.hud;
    const s = this.pred.state;
    const m = this.modelCache;
    const ph = this.phase;
    const showHud = this.playing && this.pred.ready;
    hud.show(showHud);
    if (!showHud) return;

    const def = activeWeapon(s);
    const op = operatorDef(this.extra.op);
    m.alive = s.alive;
    m.hp = s.hp;
    m.maxHp = 100 + (op.id === 3 ? 10 : 0);
    m.weaponName = def.name;
    m.ammo = s.slot === 0 ? s.ammo0 : s.ammo1;
    m.reserve = s.slot === 0 ? s.res0 : s.res1;
    m.magSize = def.mag;
    m.reloading = s.reloading;
    m.gadgetLabel = op.gadgetName !== 'None' && op.gadgetUses > 0 ? op.gadgetName : '';
    m.gadgetUses = this.extra.charges > 0 ? this.extra.charges : this.extra.gadget;
    if (this.extra.charges > 0) m.gadgetLabel = 'DETONATE';
    m.gadgetCd = this.extra.gadgetCd;
    m.reinf = this.extra.reinf;
    m.showReinf = this.role !== 'attack' && (this.extra.reinf > 0 || this.sandbox);
    m.role = this.role;

    if (this.sandbox) {
      m.timer = '';
      m.phaseLabel = 'PRACTICE';
      m.timerHot = false;
    } else {
      const left = ph.endsAt > 0 ? Math.max(0, (ph.endsAt - this.host.clock.now()) / 1000) : 0;
      m.timer = ph.endsAt > 0 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '';
      m.timerHot = left < 10 && ph.phase === PhaseId.ACTION;
      m.phaseLabel = ph.phase === PhaseId.PREP ? 'PREP' : ph.phase === PhaseId.ACTION ? `ROUND ${ph.round}` : ph.phase === PhaseId.ROUND_END ? 'ROUND OVER' : '';
      if (ph.phase === PhaseId.PREP || ph.phase === PhaseId.ACTION) {
        const sec = Math.ceil(left);
        if (sec <= 5 && sec > 0 && sec !== this.lastBeepSec) {
          this.lastBeepSec = sec;
          this.host.audio.ui('beep', 0.5);
        }
      }
    }
    const mine = this.myTeam;
    m.scoreFriend = ph.scores[mine === 0 ? 0 : 1];
    m.scoreFoe = ph.scores[mine === 0 ? 1 : 0];
    m.friendTotal = this.sandbox ? 0 : this.friendTotal;
    m.foeTotal = this.sandbox ? 0 : this.foeTotal;
    m.friendAlive = this.friendAlive;
    m.foeAlive = this.foeAlive;

    m.prompt = s.alive && !s.dCtl ? (PROMPTS[this.extra.prompt] ?? '') : '';
    m.actProgress = this.extra.act ? this.extra.actP : 0;
    m.captureProgress = ph.phase === PhaseId.ACTION ? this.extra.cap : 0;
    m.crosshair = 5 + (s.ads ? 0 : 5) + clamp(Math.hypot(s.vx, s.vz) * 1.6, 0, 9) + Math.abs(this.recoilPitch) * 420;
    m.ads = s.ads;
    m.inDrone = s.dCtl && s.alive;
    m.droneHp = s.dhp;
    m.jammed = this.extra.jam === 1;
    m.inCamera = s.cam;
    m.sensor = this.extra.sensorT;
    m.hideCrosshair = false;
    const specId = this.extra.spec;
    m.spectating = !s.alive && specId ? this.playerName(specId) : '';

    // compass
    const now = performance.now();
    let mc = 0;
    const put = (x: number, z: number, kind: CompassMarker['kind'], alpha: number): void => {
      let mk = this.markerPool[mc];
      if (!mk) {
        mk = { rel: 0, kind, alpha };
        this.markerPool[mc] = mk;
      }
      mc++;
      mk.rel = wrapAngle(viewYaw - Math.atan2(-(x - ex), -(z - ez)));
      mk.kind = kind;
      mk.alpha = alpha;
    };
    for (const [id, pose] of this.lastPoses) {
      const team = this.playerTeam(id);
      if (team === mine) put(pose.x, pose.z, 'mate', 1);
      else if (this.tagged.has(id)) put(pose.x, pose.z, 'tag', 1);
      else if (this.sandbox) put(pose.x, pose.z, 'enemy', 0.9);
    }
    if (this.pings.length) this.pings = this.pings.filter((p) => now - p.born < 1800);
    for (const p of this.pings) put(p.x, p.z, 'ping', 1 - (now - p.born) / 1800);
    const site = this.world.map.objectives[ph.objective];
    if (site && (ph.phase === PhaseId.PREP || ph.phase === PhaseId.ACTION)) {
      put((site.minX + site.maxX) / 2, (site.minZ + site.maxZ) / 2, 'obj', 1);
    }
    m.markers = this.markerPool;
    m.markerCount = mc;

    if (settings.showFps || new URLSearchParams(location.search).has('debug')) {
      const i = this.renderer.info();
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const nowMs = performance.now();
      if (nowMs - this.snapRateT >= 1000) {
        this.snapRate = (this.snapCount * 1000) / (nowMs - this.snapRateT);
        this.snapCount = 0;
        this.snapRateT = nowMs;
      }
      m.debug =
        `${Math.round(1000 / this.fpsMs)} fps  ${this.fpsMs.toFixed(1)} ms  scale ${this.renderer.renderScale.toFixed(2)}\n` +
        `calls ${i.calls}  tris ${i.triangles}\n` +
        `ping ${Math.round(this.host.clock.rtt)} ms  snaps ${this.snapRate.toFixed(1)}/s  interp ${Math.round(this.interp.delayMs)} ms\n` +
        `pred err ${(this.pred.lastError * 100).toFixed(1)} cm  pending ${this.pred.pending.length}\n` +
        `players ${this.playerViews.size} (tagged ${this.tagged.size})  ents ${this.latestEntities.length}` + (mem ? `  heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '');
    } else {
      m.debug = '';
    }
    hud.update(m);
  }

  // -------------------------------------------------------------------------
  // Commands from the UI
  // -------------------------------------------------------------------------

  spectate(dir: number): void {
    if (!this.pred.state.alive) this.host.send({ t: 'SPECTATE', dir });
  }

  get predicted(): PlayerState {
    return this.pred.state;
  }

  get ping(): number {
    return this.host.clock.rtt;
  }

  /** Offline sanity helper for tests. */
  get ready(): boolean {
    return this.pred.ready;
  }

  /** Reset the predicted player when joining anew. */
  resetPrediction(): void {
    this.pred.reset();
    this.pred.state = createPlayerState();
  }

  /** For tests: decode a raw auth array. */
  static decodeState(arr: number[]): PlayerState {
    return stateFromArray(arr, createPlayerState());
  }

  /** Debug: clip everything above a height (cutaway views), or null to disable. */
  setClipHeight(y: number | null): void {
    const gl = this.renderer.gl;
    gl.localClippingEnabled = false;
    gl.clippingPlanes = y === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)];
  }

  get touch(): boolean {
    return isTouchDevice();
  }
}
