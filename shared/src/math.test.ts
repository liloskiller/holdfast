import { describe, expect, it } from 'vitest';
import { Rng, angleDiff, clamp, hash32, lerpAngle, rand01, wrapAngle } from './math';

describe('math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('wraps angles into [-PI, PI]', () => {
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2, 6);
    expect(angleDiff(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 6);
    expect(lerpAngle(3.1, -3.1, 0.5)).toBeCloseTo(3.1 + (2 * Math.PI - 6.2) / 2, 6);
  });

  it('hash and rng are deterministic', () => {
    expect(hash32(1, 2)).toBe(hash32(1, 2));
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    for (let i = 0; i < 1000; i++) {
      const v = rand01(7, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shuffle keeps all elements', () => {
    const r = new Rng(9);
    const arr = [1, 2, 3, 4, 5, 6];
    r.shuffle(arr);
    expect([...arr].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
