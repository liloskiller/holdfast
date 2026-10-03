import { describe, expect, it } from 'vitest';
import { clipAxis, rayAabb, raySphere } from './collision';

describe('rayAabb', () => {
  it('hits a box and reports the face normal', () => {
    const n = { nx: 0, ny: 0, nz: 0 };
    const t = rayAabb(0, 0.5, 0.5, 1, 0, 0, 2, 0, 0, 3, 1, 1, 100, n);
    expect(t).toBeCloseTo(2, 6);
    expect(n.nx).toBe(-1);
  });
  it('misses, respects max distance and ignores boxes containing the origin', () => {
    expect(rayAabb(0, 5, 0.5, 1, 0, 0, 2, 0, 0, 3, 1, 1, 100)).toBe(-1);
    expect(rayAabb(0, 0.5, 0.5, 1, 0, 0, 2, 0, 0, 3, 1, 1, 1)).toBe(-1);
    expect(rayAabb(2.5, 0.5, 0.5, 1, 0, 0, 2, 0, 0, 3, 1, 1, 100)).toBe(-1);
  });
  it('handles axis parallel rays', () => {
    expect(rayAabb(2.5, -1, 0.5, 0, 1, 0, 2, 0, 0, 3, 1, 1, 100)).toBeCloseTo(1, 6);
  });
});

describe('raySphere', () => {
  it('hits and misses', () => {
    expect(raySphere(0, 0, 0, 1, 0, 0, 5, 0, 0, 1, 100)).toBeCloseTo(4, 6);
    expect(raySphere(0, 0, 0, 1, 0, 0, 5, 2, 0, 1, 100)).toBe(-1);
  });
});

describe('clipAxis', () => {
  it('stops at the box leaving skin clearance', () => {
    const boxes = new Float64Array([2, 0, 0, 3, 1, 1]);
    const d = clipAxis(0, 0, 0, 1, 1, 1, 0, 5, boxes, 1, 0.001);
    expect(d).toBeCloseTo(0.999, 6);
  });
  it('ignores boxes that do not overlap on the other axes and boxes behind', () => {
    const boxes = new Float64Array([2, 5, 0, 3, 6, 1, -3, 0, 0, -2, 1, 1]);
    expect(clipAxis(0, 0, 0, 1, 1, 1, 0, 5, boxes, 2, 0.001)).toBe(5);
    expect(clipAxis(0, 0, 0, 1, 1, 1, 0, -1, boxes, 2, 0.001)).toBe(-1);
  });
});
