/**
 * Walker, item heads and position patching. Expected numbers were measured by the
 * reconnaissance probe (scout-saver-probe.out.txt) on 0.2.1 and must not drift.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../src/game-data/game-data.js';
import { BinaryReader } from '../src/core/binary-reader.js';
import { createItemParser } from '../src/formats/item-parser.js';
import {
  walkItemList,
  walkD2I,
  readItemHead,
  readItemPosition,
  patchItemPosition,
  zeroItemPosition,
  type ItemHead,
  type WalkResult,
} from '../src/formats/item-walker.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

let gd: GameData;
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const range = (e: { start: number; end: number }) => [e.start, e.end];

function expectCode(fn: () => unknown, code: ErrorCode): D2RSaverError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
  return caught as D2RSaverError;
}

/** Wrap raw item bytes in a one-item JM list and parse it with the regular parser. */
function parseStandalone(bytes: Uint8Array) {
  const wrapped = new Uint8Array(4 + bytes.length);
  wrapped[0] = 0x4a; wrapped[1] = 0x4d; wrapped[2] = 1; wrapped[3] = 0;
  wrapped.set(bytes, 4);
  const reader = new BinaryReader(wrapped);
  const ctx = createItemParser(reader, gd);
  let placed: { id: number | string; location?: string; slot?: number | string } | null = null;
  const report = ctx.parseItemList((id, location, slot) => { placed = { id, location, slot }; });
  return { report, placed: placed as { id: number | string; location?: string; slot?: number | string } | null, items: ctx.items, consumed: (reader.bitpos >> 3) - 4 };
}

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

// ─── walkItemList on .d2s main lists ─────────────────────────────

describe('walkItemList', () => {
  let warlock: WalkResult;
  let shards: WalkResult;

  beforeAll(() => {
    warlock = walkItemList(fixture('WarlockTest.d2s'), 914, gd);
    shards = walkItemList(fixture('WarlockShards.d2s'), 903, gd);
  });

  it('WarlockTest.d2s main list: 5 of 26 walked, ranges as measured', () => {
    expect(warlock.report).toMatchObject({ headerOffset: 914, declared: 26, parsed: 5, firstItemOffset: 918, endOffset: 1197, truncated: true });
    expect(warlock.entries.length).toBe(5);
    expect(warlock.entries.map(e => range(e.full))).toEqual([
      [918, 954], [954, 1000], [1000, 1081], [1081, 1134], [1134, 1197],
    ]);
    expect(warlock.entries.map(e => e.head.base)).toEqual(['lbl', 'mbt', 'rin', 'fhl', 'rin']);
    expect(warlock.entries.map(e => e.index)).toEqual([0, 1, 2, 3, 4]);
    expect(warlock.entries.map(e => e.registeredKey)).toEqual([0, 1, 2, 3, 6]);
  });

  it('a socketed parent has an own range, a wider full range and ranged children', () => {
    const helm = warlock.entries[3];
    expect(range(helm.own)).toEqual([1081, 1112]);
    expect(range(helm.full)).toEqual([1081, 1134]);
    expect(helm.head).toMatchObject({ base: 'fhl', socketed: true, runeword: true, loc: 1, bodyloc: 1 });
    expect(helm.item.guid).toBe(2731174711);
    expect(helm.children.map(c => range(c.own))).toEqual([[1112, 1123], [1123, 1134]]);
    expect(helm.children.map(c => c.head.base)).toEqual(['r09', 'r12']);
    expect(helm.children.map(c => c.head.loc)).toEqual([6, 6]);
    expect(helm.children.map(c => c.index)).toEqual([0, 1]);
    expect(helm.children.map(c => c.registeredKey)).toEqual(['r09', 'r12']);
    expect(helm.children.every(c => c.children.length === 0)).toBe(true);
  });

  it('heads of worn items carry loc=1 and the body slot', () => {
    expect(warlock.entries[0].head).toMatchObject({ base: 'lbl', loc: 1, bodyloc: 8, col: 8, row: 0, storage: 0, simple: false, identified: true });
    expect(warlock.entries[4].head).toMatchObject({ base: 'rin', loc: 1, bodyloc: 6 });
    expect(warlock.entries[4].hasQuantity).toBe(true); // this ring carries a quantity field (1)
    expect(warlock.entries[0].hasQuantity).toBe(false);
  });

  it('WarlockShards.d2s: four hp1 are four entries of 10 bytes, not one dictionary key', () => {
    expect(shards.report).toMatchObject({ declared: 17, parsed: 6, error: 'item 7/17: unknown item stat code 504' });
    const potions = shards.entries.filter(e => e.head.base === 'hp1');
    expect(potions.length).toBe(4);
    expect(potions.map(e => range(e.own))).toEqual([[907, 917], [917, 927], [927, 937], [937, 947]]);
    expect(potions.map(e => e.head.col)).toEqual([0, 1, 2, 3]);
    expect(potions.every(e => e.head.loc === 2 && e.head.simple)).toBe(true);
    expect(potions.every(e => e.registeredKey === 'hp1')).toBe(true);
    // The dictionary keeps only the last one.
    expect(Object.keys(shards.items).sort()).toEqual(['hp1', 'isc', 'tsc']);
    expect(shards.items['hp1'].byteRange).toEqual({ start: 937, end: 947 });
    expect(shards.entries[4].head).toMatchObject({ base: 'tsc', loc: 0, storage: 1, col: 9, row: 3 });
    expect(shards.entries[5].head).toMatchObject({ base: 'isc', loc: 0, storage: 1, col: 9, row: 2 });
  });

  it('entries are contiguous from firstItemOffset to endOffset', () => {
    for (const walk of [warlock, shards]) {
      let cursor = walk.report.firstItemOffset;
      for (const e of walk.entries) {
        expect(e.full.start).toBe(cursor);
        cursor = e.full.end;
      }
      expect(cursor).toBe(walk.report.endOffset);
    }
  });

  it('each walked range re-parses standalone as exactly one item consuming exactly its bytes', () => {
    const buf = fixture('WarlockTest.d2s');
    for (const e of warlock.entries) {
      const cut = buf.slice(e.full.start, e.full.end);
      const { report, consumed, items } = parseStandalone(cut);
      expect(report.parsed).toBe(1);
      expect(report.error).toBeNull();
      expect(consumed).toBe(cut.length);
      const parsed = Object.values(items).find(i => i.base === e.head.base)!;
      expect(parsed.guid).toBe(e.item.guid);
      expect(parsed.stats).toEqual(e.item.stats);
    }
  });

  it('honours expectedEnd and initialId', () => {
    const buf = fixture('WarlockShards.d2s');
    const walk = walkItemList(buf, 903, gd, { initialId: 100, expectedEnd: 966 });
    expect(walk.report.expectedEnd).toBe(966);
    expect(walk.report.reachedEnd).toBe(true); // ends after item 6, but 7/17 failed
    expect(walk.report.complete).toBe(false);
  });

  it('rejects a non-JM offset and an offset past the end', () => {
    const buf = fixture('WarlockTest.d2s');
    expectCode(() => walkItemList(buf, 918, gd), ErrorCode.PARSE_ERROR);
    expectCode(() => walkItemList(buf, buf.length - 2, gd), ErrorCode.BUFFER_OVERRUN);
    expectCode(() => walkItemList(buf, -1, gd), ErrorCode.INVALID_ARGUMENT);
  });

  it('a list cut mid-item stops with BUFFER_OVERRUN in the report, entries intact before it', () => {
    const walk = walkItemList(fixture('WarlockTest.d2s').slice(0, 1100), 914, gd);
    expect(walk.report).toMatchObject({ parsed: 3, endOffset: 1081, errorCode: ErrorCode.BUFFER_OVERRUN });
    expect(walk.entries.map(e => range(e.full))).toEqual([[918, 954], [954, 1000], [1000, 1081]]);
  });
});

// ─── walkD2I ───────────────────────────────────────────────────────

describe('walkD2I', () => {
  it('SharedStashSoftCoreV2V105_.d2i: 0/31, 7/62, 0/42; tiled', () => {
    const r = walkD2I(fixture('SharedStashSoftCoreV2V105_.d2i'), gd);
    expect(r.tiled).toBe(true);
    expect(r.reachedEof).toBe(true);
    expect(r.sectors.map(s => [s.offset, s.size, s.type, s.gold])).toEqual([
      [0, 1210, 0, 2500000], [1210, 2290, 0, 2500000], [3500, 1184, 0, 2500000],
    ]);
    expect(r.sectors.map(s => `${s.walk!.report.parsed}/${s.walk!.report.declared}`)).toEqual(['0/31', '7/62', '0/42']);
    expect(r.sectors.every(s => s.walk!.report.complete === false)).toBe(true);

    const walk = r.sectors[1].walk!;
    expect(walk.report).toMatchObject({ headerOffset: 1274, firstItemOffset: 1278, endOffset: 1492, expectedEnd: 3500, reachedEnd: false });
    expect(walk.entries.map(e => range(e.own))).toEqual([
      [1278, 1315], [1315, 1346], [1346, 1377], [1377, 1403], [1403, 1429], [1429, 1466], [1466, 1492],
    ]);
    expect(walk.entries.map(e => e.head.base)).toEqual(['amu', 'rin', 'rin', 'rin', 'rin', 'amu', 'rin']);
    expect(walk.entries.map(e => [e.head.col, e.head.row])).toEqual([[8, 0], [7, 2], [6, 2], [7, 3], [6, 3], [7, 0], [5, 3]]);
    expect(walk.entries.every(e => e.head.loc === 0 && e.head.storage === 5)).toBe(true);
    expect(walk.entries[0].item.guid).toBe(3740327953);
    expect(walk.entries[3].item.guid).toBe(4198596071);
    expect(walk.entries.map(e => e.registeredKey)).toEqual([1, 2, 3, 4, 5, 6, 7]); // ids restart at 1 per sector
  });

  it('SharedStashSoftCoreV2V105.d2i: 1/15, 1/7, three empty complete sectors, extended 56/56, metadata null', () => {
    const r = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd);
    expect(r.tiled).toBe(true);
    expect(r.reachedEof).toBe(true);
    expect(r.sectors.map(s => [s.offset, s.size, s.type])).toEqual([
      [0, 989, 0], [989, 373, 0], [1362, 68, 0], [1430, 68, 0], [1498, 68, 0], [1566, 830, 1], [2396, 168, 2],
    ]);
    const summary = r.sectors.map(s => (s.walk ? `${s.walk.report.parsed}/${s.walk.report.declared}:${s.walk.report.complete}` : 'none'));
    expect(summary).toEqual(['1/15:false', '1/7:false', '0/0:true', '0/0:true', '0/0:true', '56/56:true', 'none']);
    expect(r.sectors[6].type).toBe(2);

    expect(r.sectors[0].walk!.entries[0]).toMatchObject({ own: { start: 68, end: 108 }, registeredKey: 1 });
    expect(r.sectors[0].walk!.entries[0].head).toMatchObject({ base: 'cm1', col: 9, row: 7, storage: 5 });
    expect(r.sectors[0].walk!.entries[0].item.guid).toBe(2620541511);
    expect(r.sectors[1].walk!.entries[0]).toMatchObject({ own: { start: 1057, end: 1094 } });
    expect(r.sectors[1].walk!.entries[0].head).toMatchObject({ base: 'ci2', socketed: true, col: 0, row: 0 });

    // Empty sectors: nothing to walk, reader already at the sector end.
    expect(r.sectors[2].walk!.entries).toEqual([]);
    expect(r.sectors[2].walk!.report).toMatchObject({ headerOffset: 1426, firstItemOffset: 1430, endOffset: 1430, expectedEnd: 1430, reachedEnd: true, complete: true });

    // The extended sector is fully walked to its end: stacked simple items with quantities.
    const ext = r.sectors[5].walk!;
    expect(ext.report).toMatchObject({ headerOffset: 1630, firstItemOffset: 1634, endOffset: 2396, expectedEnd: 2396, reachedEnd: true, complete: true, error: null });
    expect(ext.entries.length).toBe(56);
    expect(ext.entries.slice(0, 4).map(e => [e.head.base, range(e.own), e.item.quantity])).toEqual([
      ['rvl', [1634, 1645], 99], ['rvs', [1645, 1656], 1], ['r08', [1656, 1667], 3], ['r14', [1667, 1678], 2],
    ]);
    // Every stack carries a quantity; 35 are simple items (runes, gems, potions), 21 are
    // extended-format stacks of 18 bytes (keys, essences, organs) with guid 0.
    expect(ext.entries.every(e => e.hasQuantity)).toBe(true);
    expect(ext.entries.filter(e => e.head.simple).length).toBe(35);
    expect(ext.entries.filter(e => !e.head.simple).map(e => e.own.end - e.own.start).every(n => n === 18)).toBe(true);
    expect(ext.entries[8]).toMatchObject({ own: { start: 1722, end: 1740 }, registeredKey: 'pk1' });
    expect(ext.entries[8].item.quantity).toBe(21);
    expect(ext.entries[ext.entries.length - 1].full.end).toBe(2396);
  });

  it('a truncated file is not tiled; entries before the cut survive', () => {
    const r = walkD2I(fixture('SharedStashSoftCoreV2V105_.d2i').slice(0, 1360), gd);
    expect(r.sectors.length).toBe(2);
    expect(r.tiled).toBe(false);
    expect(r.reachedEof).toBe(true);
    expect(r.sectors[1].walk!.report).toMatchObject({ parsed: 2, errorCode: ErrorCode.BUFFER_OVERRUN });
    expect(r.sectors[1].walk!.entries.map(e => range(e.own))).toEqual([[1278, 1315], [1315, 1346]]);
  });

  it('a file with trailing garbage stops early and is not tiled', () => {
    const src = fixture('SharedStashSoftCoreV2V105.d2i');
    const padded = new Uint8Array(src.length + 70);
    padded.set(src);
    padded.fill(0x11, src.length);
    const r = walkD2I(padded, gd);
    expect(r.sectors.length).toBe(7);
    expect(r.reachedEof).toBe(false);
    expect(r.tiled).toBe(false);
  });

  it('a normal sector without a JM header is a PARSE_ERROR', () => {
    const src = fixture('SharedStashSoftCoreV2V105.d2i').slice();
    src[1362 + 64] = 0x00; // break the JM of the empty sector @1362
    expectCode(() => walkD2I(src, gd), ErrorCode.PARSE_ERROR);
  });

  it('empty buffer: no sectors, not tiled', () => {
    expect(walkD2I(new Uint8Array(0), gd)).toEqual({ sectors: [], tiled: false, reachedEof: true });
  });
});

// ─── readItemHead ───────────────────────────────────────────────

describe('readItemHead', () => {
  it('decodes flags, position and base of an extended socketed item', () => {
    const helm = fixture('WarlockTest.d2s').slice(1081, 1134);
    expect(readItemHead(helm)).toEqual<ItemHead>({
      identified: true, socketed: true, ear: false, simple: false, ethereal: false,
      personalized: false, runeword: true, extras: false,
      loc: 1, bodyloc: 1, col: 1, row: 0, storage: 0, base: 'fhl',
    });
  });

  it('decodes a simple item and honours the offset argument', () => {
    const shards = fixture('WarlockShards.d2s');
    expect(readItemHead(shards, 907)).toMatchObject({ simple: true, base: 'hp1', loc: 2, col: 0, row: 0, storage: 0 });
    expect(readItemHead(shards, 917)).toMatchObject({ simple: true, base: 'hp1', loc: 2, col: 1 });
    expect(readItemHead(shards, 947)).toMatchObject({ base: 'tsc', loc: 0, storage: 1, col: 9, row: 3 });
    expect(readItemHead(shards.slice(956, 966))).toMatchObject({ base: 'isc', loc: 0, storage: 1, col: 9, row: 2 });
  });

  it('agrees with the parser on every walked item of every fixture', () => {
    const d2i = ['SharedStashSoftCoreV2V105_.d2i', 'SharedStashSoftCoreV2V105.d2i'];
    let checked = 0;
    for (const f of d2i) {
      const buf = fixture(f);
      for (const s of walkD2I(buf, gd).sectors) {
        for (const e of s.walk?.entries ?? []) {
          const head = readItemHead(buf, e.own.start);
          expect(head.base).toBe(e.item.base);
          expect(head.socketed).toBe(e.item.socketed);
          expect(head.ethereal).toBe(e.item.ethereal);
          expect(head.identified).toBe(!e.item.unidentified);
          expect(head.personalized).toBe(e.item.personalized !== undefined);
          expect(head.runeword).toBe(e.item.quality === 9);
          checked++;
        }
      }
    }
    expect(checked).toBe(7 + 1 + 1 + 56);
  });

  it('throws BUFFER_OVERRUN on a cut prefix and PARSE_ERROR on a non-item', () => {
    const helm = fixture('WarlockTest.d2s').slice(1081, 1134);
    expectCode(() => readItemHead(helm.slice(0, 6)), ErrorCode.BUFFER_OVERRUN);
    expectCode(() => readItemHead(helm, 60), ErrorCode.BUFFER_OVERRUN);
    expectCode(() => readItemHead(new Uint8Array(16)), ErrorCode.PARSE_ERROR); // zeros never decode to "xxx "
    expectCode(() => readItemHead(helm, -1), ErrorCode.INVALID_ARGUMENT);
  });

  it('readItemPosition returns just the position block', () => {
    const shards = fixture('WarlockShards.d2s');
    expect(readItemPosition(shards, 947)).toEqual({ loc: 0, bodyloc: 0, col: 9, row: 3, storage: 1 });
    expectCode(() => readItemPosition(shards, shards.length - 3), ErrorCode.BUFFER_OVERRUN);
  });
});

// ─── patchItemPosition / zeroItemPosition ───────────────────────

describe('patchItemPosition', () => {
  const target = { loc: 0, bodyloc: 0, col: 9, row: 7, storage: 5 };

  it('rewrites only bits 35–52, returns a copy, leaves children untouched', () => {
    const helm = fixture('WarlockTest.d2s').slice(1081, 1134);
    const before = helm.slice();
    const patched = patchItemPosition(helm, target);
    expect(patched).not.toBe(helm);
    expect(helm).toEqual(before); // input untouched
    expect(patched.length).toBe(helm.length);
    expect(readItemHead(patched)).toMatchObject({ ...target, base: 'fhl', socketed: true, runeword: true });

    // Every bit outside [35, 53) is identical.
    for (let bit = 0; bit < helm.length * 8; bit++) {
      if (bit >= 35 && bit < 53) continue;
      const a = (helm[bit >> 3] >> (bit & 7)) & 1;
      const b = (patched[bit >> 3] >> (bit & 7)) & 1;
      expect(b).toBe(a);
    }
    // The socketed runes (bytes 31..53 of the cut) are byte-identical.
    expect(patched.subarray(31)).toEqual(helm.subarray(31));
  });

  it('the parser sees the patched item in the new stash cell with the same guid and stats', () => {
    const buf = fixture('WarlockTest.d2s');
    const helm = buf.slice(1081, 1134);
    const original = parseStandalone(helm);
    const moved = parseStandalone(patchItemPosition(helm, target));
    expect(moved.report.parsed).toBe(1);
    expect(moved.consumed).toBe(helm.length);
    expect(moved.placed).toEqual({ id: 0, location: 'stash', slot: 7 * 16 + 9 });
    const a = Object.values(original.items).find(i => i.base === 'fhl')!;
    const b = Object.values(moved.items).find(i => i.base === 'fhl')!;
    expect(b.guid).toBe(a.guid);
    expect(b.stats).toEqual(a.stats);
    expect(b.socketedItems).toEqual(['r09', 'r12']);
  });

  it('a simple item moves the same way', () => {
    const potion = fixture('WarlockShards.d2s').slice(907, 917);
    const moved = parseStandalone(patchItemPosition(potion, { loc: 0, bodyloc: 0, col: 15, row: 12, storage: 5 }));
    expect(moved.placed).toEqual({ id: 'hp1', location: 'stash', slot: 12 * 16 + 15 });
    expect(moved.consumed).toBe(10);
  });

  it('round-trips: patching back to the original position restores the original bytes', () => {
    const buf = fixture('SharedStashSoftCoreV2V105_.d2i');
    const amulet = buf.slice(1278, 1315);
    const pos = readItemPosition(amulet);
    const there = patchItemPosition(amulet, { loc: 0, bodyloc: 0, col: 3, row: 11, storage: 5 });
    expect(there).not.toEqual(amulet);
    expect(patchItemPosition(there, pos)).toEqual(amulet);
  });

  it('rejects out-of-range fields and too-short buffers with INVALID_ARGUMENT', () => {
    const potion = fixture('WarlockShards.d2s').slice(907, 917);
    expectCode(() => patchItemPosition(potion, { ...target, col: 16 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => patchItemPosition(potion, { ...target, row: -1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => patchItemPosition(potion, { ...target, loc: 8 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => patchItemPosition(potion, { ...target, storage: 8 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => patchItemPosition(potion, { ...target, bodyloc: 1.5 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => patchItemPosition(potion.slice(0, 6), target), ErrorCode.INVALID_ARGUMENT);
  });
});

describe('zeroItemPosition (fingerprint)', () => {
  it('the same item in two different cells hashes to the same value', () => {
    const amulet = fixture('SharedStashSoftCoreV2V105_.d2i').slice(1278, 1315);
    const a = patchItemPosition(amulet, { loc: 0, bodyloc: 0, col: 1, row: 1, storage: 5 });
    const b = patchItemPosition(amulet, { loc: 0, bodyloc: 0, col: 14, row: 12, storage: 5 });
    expect(sha256(a)).not.toBe(sha256(b));
    expect(sha256(zeroItemPosition(a))).toBe(sha256(zeroItemPosition(b)));
    expect(readItemPosition(zeroItemPosition(a))).toEqual({ loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
    expect(zeroItemPosition(a)).not.toBe(a);
  });

  it('an item with its socketed children and the same item alone hash differently', () => {
    const buf = fixture('WarlockTest.d2s');
    const withRunes = buf.slice(1081, 1134);
    const alone = buf.slice(1081, 1112);
    expect(sha256(zeroItemPosition(withRunes))).not.toBe(sha256(zeroItemPosition(alone)));
  });

  it('two different items hash differently after zeroing', () => {
    const shards = fixture('WarlockShards.d2s');
    const p1 = zeroItemPosition(shards.slice(907, 917));
    const p2 = zeroItemPosition(shards.slice(917, 927));
    const tsc = zeroItemPosition(shards.slice(947, 956));
    expect(sha256(p1)).toBe(sha256(p2)); // two identical potions in belt slots 0 and 1
    expect(sha256(p1)).not.toBe(sha256(tsc));
  });
});
