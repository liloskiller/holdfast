import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMap, parseMap } from '@holdfast/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'shared', 'maps');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.map.txt'));
let failed = false;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    const map = parseMap(text);
    const rep = checkMap(map);
    console.log(`\n== ${f} (${map.name}) ==`);
    console.log(JSON.stringify(rep.stats));
    for (const w of rep.warnings) console.log('  warn:', w);
    for (const e of rep.errors) console.log('  ERROR:', e);
    if (rep.errors.length) failed = true;
    else console.log('  ok');
  } catch (e) {
    failed = true;
    console.log(`\n== ${f} ==\n  PARSE ERROR: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
