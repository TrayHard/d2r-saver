/**
 * Regenerate `test/fixtures/SharedStashComplete.d2i` from the two real stash fixtures.
 *
 * Run: `npm run build:fixtures` (or `npx tsx test/fixtures/build-shared-stash-complete.ts`).
 * The build is deterministic; `test/shared-stash-complete.test.ts` fails if the committed file
 * drifts from what this script produces. See `test/helpers/shared-stash-complete.ts` for what
 * the fixture contains and why.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../../src/game-data/game-data.js';
import { walkD2I } from '../../src/formats/item-walker.js';
import { buildSharedStashComplete, SHARED_STASH_COMPLETE } from '../helpers/shared-stash-complete.js';

const ROOT = resolve(import.meta.dirname!, '..', '..');
const FIXTURES = resolve(ROOT, 'test', 'fixtures');
const read = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

const gd = GameData.fromRaw(
  JSON.parse(readFileSync(resolve(ROOT, 'data', 'data.json'), 'utf-8')),
  JSON.parse(readFileSync(resolve(ROOT, 'data', 'strings.json'), 'utf-8')),
);

const build = buildSharedStashComplete(gd, read('SharedStashSoftCoreV2V105.d2i'), read('SharedStashSoftCoreV2V105_.d2i'));
const out = resolve(FIXTURES, SHARED_STASH_COMPLETE);
writeFileSync(out, build.buffer);

const report = walkD2I(build.buffer, gd);
console.log(`${out}: ${build.buffer.length} bytes, sha256 ${createHash('sha256').update(build.buffer).digest('hex')}`);
console.log(`complete sector @${build.sectorOffset}: ${build.placed.map(p => `${p.base}@${p.col},${p.row}`).join(' ')}`);
for (const s of report.sectors) {
  const list = s.walk ? `${s.walk.report.parsed}/${s.walk.report.declared}${s.walk.report.complete ? ' complete' : ''}` : 'metadata';
  console.log(`  sector @${s.offset} size=${s.size} type=${s.type} ${list}`);
}
console.log(`tiled=${report.tiled} reachedEof=${report.reachedEof}`);
