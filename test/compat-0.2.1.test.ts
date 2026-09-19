/**
 * Backward-compatibility guard: `readD2S` / `readD2I` must keep returning exactly what
 * d2r-saver 0.2.1 (commit d5d75d6) returned for every fixture.
 *
 * The snapshots under `test/__snapshots__/compat-0.2.1/` were generated on the unmodified
 * 0.2.1 sources BEFORE the in-place editing work started. The projection below strips only the
 * fields that 0.3.0 ADDS (`byteRange`, `fullByteRange`, `socketedByteRanges` on items;
 * `lists` on the d2s result; `sectors`, `tiled`, `reachedEof` on the d2i result and
 * `list`, `rawType` on pages), so any change to a pre-existing field or value fails the test.
 * If you add another field on purpose, add it to the strip list AND regenerate deliberately.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { readD2I } from '../src/formats/d2i-reader.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const SNAPSHOTS = resolve(import.meta.dirname!, '__snapshots__', 'compat-0.2.1');

/** Fields that did not exist in 0.2.1. Everything else must match byte for byte. */
const ITEM_FIELDS_ADDED_IN_0_3 = new Set(['byteRange', 'fullByteRange', 'socketedByteRanges']);
const D2S_RESULT_FIELDS_ADDED_IN_0_3 = new Set(['lists']);
const D2I_RESULT_FIELDS_ADDED_IN_0_3 = new Set(['sectors', 'tiled', 'reachedEof']);
const D2I_PAGE_FIELDS_ADDED_IN_0_3 = new Set(['list', 'rawType']);

function omit<T extends object>(obj: T, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.has(k)) out[k] = v;
  return out;
}

function legacyItems(items: Record<string | number, object>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(items)) out[key] = omit(items[key], ITEM_FIELDS_ADDED_IN_0_3);
  return out;
}

/** Sparse arrays (`stash[slot] = id`) serialise as nulls; keep them as-is to catch index shifts. */
function stable(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

describe('0.2.1 compatibility snapshots', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  for (const file of ['WarlockTest.d2s', 'WarlockShards.d2s']) {
    it(`readD2S(${file}) matches the 0.2.1 snapshot`, async () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, file)));
      const result = readD2S(data, gd);
      const view = {
        ...omit(result, D2S_RESULT_FIELDS_ADDED_IN_0_3),
        items: legacyItems(result.items),
      };
      await expect(stable(view)).toMatchFileSnapshot(resolve(SNAPSHOTS, `${file}.json`));
    });
  }

  for (const file of ['SharedStashSoftCoreV2V105.d2i', 'SharedStashSoftCoreV2V105_.d2i']) {
    it(`readD2I(${file}) matches the 0.2.1 snapshot`, async () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, file)));
      const result = readD2I(data, gd);
      const view = {
        ...omit(result, D2I_RESULT_FIELDS_ADDED_IN_0_3),
        pages: result.pages.map(p => omit(p, D2I_PAGE_FIELDS_ADDED_IN_0_3)),
        items: legacyItems(result.items),
      };
      await expect(stable(view)).toMatchFileSnapshot(resolve(SNAPSHOTS, `${file}.json`));
    });
  }
});
