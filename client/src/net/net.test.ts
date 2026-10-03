import { describe, expect, it } from 'vitest';
import {
  SIM_DT, arenaMapText, cmdFor, copyPlayerState, makeStepOut, parseMap, stepPlayer, World, Btn,
  type PlayerState, type PlayerSnap,
} from '@holdfast/shared';
import { spawnState } from '@holdfast/shared';
import { stateToArray } from '@holdfast/shared';
import { Interpolator, makePose } from './Interpolation';
import { Prediction } from './Prediction';

const world = (): World => new World(parseMap(arenaMapText()));

function makeCmds(s: PlayerState, n: number) {
  const cmds = [];
  const probe = copyPlayerState({ ...s } as PlayerState, s);
  for (let i = 0; i < n; i++) {
    const c = cmdFor(probe, { moveZ: 1, yaw: -Math.PI / 2, buttons: i > 20 ? Btn.SPRINT : 0 });
    cmds.push(c);
  }
  return cmds;
}

describe('Prediction', () => {
  it('replays unacknowledged commands on top of the authoritative state without drifting', () => {
    const w = world();
    const pred = new Prediction();
    const start = spawnState(5, 0, 5, -Math.PI / 2);
    pred.reconcile(stateToArray(start), 0, w);
    const out = makeStepOut();
    const cmds = makeCmds(start, 40);
    cmds.forEach((c, i) => (c.seq = i + 1));
    for (const c of cmds) pred.step(c, w, out);
    const predictedX = pred.state.x;

    // the server has processed the first 25 commands
    const server = spawnState(5, 0, 5, -Math.PI / 2);
    for (let i = 0; i < 25; i++) stepPlayer(server, cmds[i]!, w, SIM_DT, out);
    const err = pred.reconcile(stateToArray(server), 25, w);
    expect(err).toBeLessThan(1e-9);
    expect(pred.state.x).toBeCloseTo(predictedX, 9);
    expect(pred.pending).toHaveLength(15);
    expect(pred.offX).toBe(0);
  });

  it('smooths small corrections and snaps big ones', () => {
    const w = world();
    const pred = new Prediction();
    const start = spawnState(5, 0, 5);
    pred.reconcile(stateToArray(start), 0, w);
    // server says we are 20 cm away from where we think we are
    const shifted = spawnState(5.2, 0, 5);
    const err = pred.reconcile(stateToArray(shifted), 0, w);
    expect(err).toBeCloseTo(0.2, 6);
    expect(pred.offX).toBeCloseTo(-0.2, 6);
    pred.decay(0.2);
    expect(Math.abs(pred.offX)).toBeLessThan(0.01);
    // a teleport snaps instead
    const far = spawnState(20, 0, 8);
    pred.reconcile(stateToArray(far), 0, w);
    expect(pred.offX).toBe(0);
    expect(pred.state.x).toBeCloseTo(20, 6);
  });
});

describe('Interpolator', () => {
  const snap = (id: number, x: number): PlayerSnap => ({ id, x, y: 0, z: 0, yaw: 0, pitch: 0, flags: 2, weapon: 0, hp: 100 });

  it('lerps between bracketing snapshots', () => {
    const it = new Interpolator();
    it.push(1000, [snap(1, 0)], []);
    it.push(1050, [snap(1, 1)], []);
    it.push(1100, [snap(1, 2)], []);
    const out = makePose();
    expect(it.samplePlayer(1, 1025, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.5, 6);
    expect(it.samplePlayer(1, 1075, out)).toBe(true);
    expect(out.x).toBeCloseTo(1.5, 6);
    // before the first snapshot clamps to it
    it.samplePlayer(1, 900, out);
    expect(out.x).toBe(0);
  });

  it('extrapolates at most 100 ms and forgets players that disappear', () => {
    const it = new Interpolator();
    it.push(1000, [snap(1, 0)], []);
    it.push(1050, [snap(1, 1)], []);
    const out = makePose();
    it.samplePlayer(1, 1100, out);
    expect(out.x).toBeCloseTo(2, 6);
    it.samplePlayer(1, 1500, out);
    expect(out.x).toBeCloseTo(1 + 2, 6); // 1 + (1/50ms * 100ms)
    it.push(1100, [], []);
    expect(it.samplePlayer(1, 1100, out)).toBe(false);
    expect(it.presentPlayers.has(1)).toBe(false);
  });
});
