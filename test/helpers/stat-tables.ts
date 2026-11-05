/**
 * Game data with the stat table a fixture was written with (`test/fixtures/stat-tables.json`):
 * `d2r` for the saves made without the mod, `blizzless-s2` for the Blizzless season 2 save.
 * Everything but `itemStatCost` stays the current data.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawGameData } from '../../src/game-data/types.js';
import type { LocaleArray } from '../../src/game-data/loader.js';

const ROOT = resolve(import.meta.dirname!, '..', '..');

export type StatTable = 'd2r' | 'blizzless-s2';

export const rawData = (): RawGameData => JSON.parse(readFileSync(resolve(ROOT, 'data/data.json'), 'utf8'));
export const locale = (): LocaleArray => JSON.parse(readFileSync(resolve(ROOT, 'data/strings.json'), 'utf8'));

/** `data.json` with `itemStatCost` replaced by `table`. */
export function rawDataWith(table: StatTable): RawGameData {
  const tables = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/stat-tables.json'), 'utf8')) as Record<string, Record<string, number[]>>;
  const itemStatCost = Object.fromEntries(Object.entries(tables[table]).map(
    ([stat, [id, savebits, saveadd, saveparambits, csvbits]]) => [stat, { id, savebits, saveadd, saveparambits, csvbits }],
  ));
  return { ...rawData(), itemStatCost } as RawGameData;
}
