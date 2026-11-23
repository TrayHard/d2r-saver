/**
 * Game data with the stat table a fixture was written with (`olderStatTables` of data.json):
 * `d2r` for the saves made without the mod, `blizzless-s2` for the Blizzless season 2 save.
 * Everything but `itemStatCost` stays the current data.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawGameData } from '../../src/game-data/types.js';
import type { LocaleArray } from '../../src/game-data/loader.js';

const ROOT = resolve(import.meta.dirname!, '..', '..');

export type StatTable = 'blizzless-s2' | 'd2r';

export const rawData = (): RawGameData => JSON.parse(readFileSync(resolve(ROOT, 'data/data.json'), 'utf8'));
export const locale = (): LocaleArray => JSON.parse(readFileSync(resolve(ROOT, 'data/strings.json'), 'utf8'));

/** `data.json` with `itemStatCost` replaced by `table`. */
export function rawDataWith(table: StatTable): RawGameData {
  const raw = rawData();
  return { ...raw, itemStatCost: raw.olderStatTables![table] } as RawGameData;
}
