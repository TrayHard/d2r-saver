/**
 * Regenerate `test/fixtures/MaterialsTabSeller.d2i` and `test/fixtures/MaterialsTabBuyer.d2i`
 * from the materials sector of the public fixture `SharedStashComplete.d2i` (0.4.0).
 *
 * Run: `npm run build:fixtures:materials` (or `npx tsx test/fixtures/build-materials-fixtures.ts`).
 * The build is deterministic; `test/materials-d2i.test.ts` fails if a committed file drifts from
 * what this script produces. See `test/helpers/materials-fixtures.ts` for the contents.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../../src/game-data/game-data.js';
import { readMaterialsD2I } from '../../src/operations/materials-d2i.js';
import {
  buildMaterialsFixtures,
  MATERIALS_SOURCE_FILE,
  MATERIALS_SELLER_FIXTURE,
  MATERIALS_BUYER_FIXTURE,
} from '../helpers/materials-fixtures.js';

const ROOT = resolve(import.meta.dirname!, '..', '..');
const FIXTURES = resolve(ROOT, 'test', 'fixtures');

const gd = GameData.fromRaw(
  JSON.parse(readFileSync(resolve(ROOT, 'data', 'data.json'), 'utf-8')),
  JSON.parse(readFileSync(resolve(ROOT, 'data', 'strings.json'), 'utf-8')),
);

const source = new Uint8Array(readFileSync(resolve(FIXTURES, MATERIALS_SOURCE_FILE)));
const { seller, buyer } = buildMaterialsFixtures(source, gd);
for (const [name, buffer] of [[MATERIALS_SELLER_FIXTURE, seller], [MATERIALS_BUYER_FIXTURE, buyer]] as const) {
  const out = resolve(FIXTURES, name);
  writeFileSync(out, buffer);
  const report = readMaterialsD2I(buffer, gd, { sectorOffset: 0 });
  console.log(`${out}: ${buffer.length} bytes, sha256 ${createHash('sha256').update(buffer).digest('hex')}`);
  console.log(`  ${report.records.map(r => `${r.code}=${r.quantity}`).join(' ')}; complete=${report.complete}`);
}
