/**
 * Every fixture reads to its end with the stat table it was written with. The Warlock and shared
 * stash fixtures come from D2R without the mod and BlizzlessTest.d2s from Blizzless season 2, so
 * the current Blizzless table in data/data.json stops them at "unknown stat" codes: their stat ids
 * and widths differ (item_singleskill is 3 bits in D2R and 5 in Blizzless, the season 2 custom
 * stats sat at 361-369). test/fixtures/stat-tables.json holds those older tables.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { D2RSaver } from '../src/index.js';
import { locale, rawData, rawDataWith, type StatTable } from './helpers/stat-tables.js';

const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

const current = D2RSaver.fromData(rawData(), locale());
const savers: Partial<Record<StatTable, D2RSaver>> = {};
const saverFor = (table: StatTable | null) => (table ? (savers[table] ??= D2RSaver.fromData(rawDataWith(table), locale())) : current);

/** Fixture → stat table it was written with; `null` is the current table. */
const FIXTURES: Record<string, StatTable | null> = {
  'BlizzlessTest.d2s': 'blizzless-s2',
  'WarlockTest.d2s': 'd2r',
  'WarlockShards.d2s': 'd2r',
  'SharedStashComplete.d2i': 'd2r',
  'SharedStashSoftCoreV2V105.d2i': 'd2r',
  'SharedStashSoftCoreV2V105_.d2i': 'd2r',
  'MaterialsTabBuyer.d2i': null,
  'MaterialsTabSeller.d2i': null,
};

/** Whether the save reads to its end: every list complete, nothing left over. */
function readsCompletely(saver: D2RSaver, name: string): boolean {
  const bytes = fixture(name);
  if (name.endsWith('.d2s')) {
    const legacy = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) === 99;
    const read = legacy ? saver.readLegacyD2S(bytes, { resolveMods: false }) : saver.readD2S(bytes, { resolveMods: false });
    return read.warnings.length === 0 && read.coverage.complete;
  }
  const walk = saver.walkD2I(bytes, { resolveMods: false });
  const read = saver.readD2I(bytes, { resolveMods: false });
  return walk.tiled && walk.sectors.every((sector) => !sector.walk || sector.walk.report.complete) && read.warnings.length === 0;
}

describe('fixtures', () => {
  it('lists every save in test/fixtures', () => {
    const saves = readdirSync('test/fixtures').filter((name) => /\.d2[si]$/.test(name)).sort();
    expect(saves).toEqual(Object.keys(FIXTURES).sort());
  });

  for (const [name, table] of Object.entries(FIXTURES)) {
    it(`${name} reads completely with the ${table ?? 'current'} stat table`, () => {
      expect(readsCompletely(saverFor(table), name)).toBe(true);
      if (table) expect(readsCompletely(current, name)).toBe(false);
    });
  }
});
