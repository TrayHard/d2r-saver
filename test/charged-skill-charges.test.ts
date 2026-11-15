import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';
import { serializeItem, deserializeItem } from '../src/items/item-serializer.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const KEY = 'item_charged_skill#226#5';

// A charged skill packs 16 bits of charges as (max << 8) | left (D2Common
// ITEMS_CalculateAdditionalCostsForChargedSkills). Real saves with spent charges
// (e.g. this ring at 11 of 27) always read left <= max with this order.
describe('charged skill charges', () => {
  let gd: GameData;
  let ring: BinaryParsedItem;
  let all: Record<number | string, BinaryParsedItem>;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
    const stash = readD2I(new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashComplete.d2i'))), gd);
    all = stash.items as Record<number | string, BinaryParsedItem>;
    ring = Object.values(all).find((item) => item.unique === 'unique300' && item.stats[KEY])!;
  });

  it('reads the charges left beside the maximum', () => {
    expect(ring.stats[KEY]).toBe(27);
    expect(ring.chargesLeft).toEqual({ [KEY]: 27 });
  });

  it('writes and reads back spent charges', () => {
    const token = serializeItem({ ...ring, chargesLeft: { [KEY]: 11 } }, all, gd);
    const back = deserializeItem(token, gd).item;
    expect(back.stats[KEY]).toBe(27);
    expect(back.chargesLeft).toEqual({ [KEY]: 11 });
  });

  it('packs the maximum into the high byte and the charges left into the low byte', () => {
    const token = serializeItem({ ...ring, chargesLeft: { [KEY]: 11 } }, all, gd);
    const bytes = Buffer.from(token.slice('d2r1:'.length), 'base64');
    // Find stat 204 (9 bits) + param (16 bits: level 5, skill 226) by scanning every bit offset.
    const bit = (i: number) => (bytes[i >> 3] >> (i & 7)) & 1;
    const read = (at: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v |= bit(at + i) << i; return v; };
    const param = (226 << 6) | 5;
    const at = [...Array(bytes.length * 8 - 41).keys()].find((i) => read(i, 9) === 204 && read(i + 9, 16) === param);
    expect(at).toBeDefined();
    expect(read(at! + 25, 16)).toBe((27 << 8) | 11);
  });

  it('writes an item without chargesLeft full and never above the maximum', () => {
    const { chargesLeft: _drop, ...plain } = ring;
    expect(deserializeItem(serializeItem(plain as BinaryParsedItem, all, gd), gd).item.chargesLeft).toEqual({ [KEY]: 27 });
    expect(deserializeItem(serializeItem({ ...ring, chargesLeft: { [KEY]: 99 } }, all, gd), gd).item.chargesLeft).toEqual({ [KEY]: 27 });
  });
});
