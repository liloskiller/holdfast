import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// shared code runs on both sides and must be deterministic and environment free.
describe('shared purity', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const banned: [RegExp, string][] = [
    [/Math\.random\(/, 'Math.random'],
    [/Date\.now\(/, 'Date.now'],
    [/new Date\(/, 'new Date'],
    [/performance\.now\(/, 'performance.now'],
    [/\bdocument\./, 'document'],
    [/\bwindow\./, 'window'],
    [/from 'three'/, 'three'],
    [/—/, 'em dash'],
  ];
  for (const f of files) {
    it(`${f} has no banned tokens`, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const [re, name] of banned) expect(re.test(src), `${f} uses ${name}`).toBe(false);
    });
  }
});
