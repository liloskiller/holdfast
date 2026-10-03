import { describe, expect, it } from 'vitest';
import { qrEncode, qrToTerminal } from './qr';

describe('qr', () => {
  it('has finder patterns, the right size and is deterministic', () => {
    const q = qrEncode('https://192.168.1.23:8443/?room=ABCD');
    expect(q.size).toBe(q.version * 4 + 17);
    expect(q.version).toBeGreaterThanOrEqual(3);
    // finder pattern: dark 7x7 ring in each of three corners
    for (const [ox, oy] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]] as const) {
      for (let i = 0; i < 7; i++) {
        expect(q.modules[oy]![ox + i]).toBe(true);
        expect(q.modules[oy + 6]![ox + i]).toBe(true);
        expect(q.modules[oy + i]![ox]).toBe(true);
        expect(q.modules[oy + i]![ox + 6]).toBe(true);
      }
      expect(q.modules[oy + 3]![ox + 3]).toBe(true);
      expect(q.modules[oy + 1]![ox + 1]).toBe(false);
    }
    expect(JSON.stringify(qrEncode('same'))).toBe(JSON.stringify(qrEncode('same')));
    expect(qrToTerminal(q).split('\n').length).toBeGreaterThan(10);
  });

  it('grows with the payload and rejects oversize input', () => {
    expect(qrEncode('a').version).toBe(1);
    expect(qrEncode('x'.repeat(100)).version).toBeGreaterThan(4);
    expect(() => qrEncode('x'.repeat(400))).toThrow();
  });
});
