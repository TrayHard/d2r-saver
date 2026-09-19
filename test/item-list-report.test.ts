/**
 * ItemListReport (declared vs parsed per `JM` list) and absolute byte ranges on parsed items.
 * Expected numbers come from the reconnaissance probe
 * (docs/offline-trade/notes/scout-saver-probe.out.txt in the trade repo), measured on 0.2.1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S, type D2SReadResult } from '../src/formats/d2s-reader.js';
import { readD2I, type D2IReadResult } from '../src/formats/d2i-reader.js';
import { BinaryReader } from '../src/core/binary-reader.js';
import { createItemParser, type BinaryParsedItem } from '../src/formats/item-parser.js';
import { ErrorCode } from '../src/types/errors.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

let gd: GameData;
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

describe('D2SReadResult.lists', () => {
  it('WarlockTest.d2s: main list declares 26, parses 5, stops on stat 508', () => {
    const { lists } = readD2S(fixture('WarlockTest.d2s'), gd);
    expect(lists.main).toEqual({
      headerOffset: 914,
      declared: 26,
      parsed: 5,
      firstItemOffset: 918,
      endOffset: 1197, // end of item 5 (rin [1134,1197)); item 6 is the one that fails
      expectedEnd: null,
      reachedEnd: null,
      truncated: true,
      complete: false,
      error: 'item 6/26: unknown item stat code 508',
      errorCode: ErrorCode.PARSE_ERROR,
    });
    // The main-list desync makes the corpse header unreadable, so nothing after it is reached.
    expect(lists.corpses).toEqual([]);
    expect(lists.merc).toBeNull();
    expect(lists.golem).toBeNull();
  });

  it('WarlockShards.d2s: main list declares 17, parses 6, stops on stat 504', () => {
    const { lists } = readD2S(fixture('WarlockShards.d2s'), gd);
    expect(lists.main).toMatchObject({
      headerOffset: 903,
      declared: 17,
      parsed: 6,
      firstItemOffset: 907,
      endOffset: 966,
      truncated: true,
      complete: false,
      error: 'item 7/17: unknown item stat code 504',
      errorCode: ErrorCode.PARSE_ERROR,
    });
  });

  it('a truncated file reports errorCode BUFFER_OVERRUN', () => {
    const { lists } = readD2S(fixture('WarlockTest.d2s').slice(0, 1100), gd);
    expect(lists.main).toMatchObject({
      declared: 26,
      parsed: 3,
      endOffset: 1081,
      truncated: true,
      errorCode: ErrorCode.BUFFER_OVERRUN,
    });
    expect(lists.main!.error).toMatch(/^item 4\/26: buffer overrun/);
  });
});

describe('D2IReadResult.sectors / tiled / reachedEof', () => {
  let underscore: D2IReadResult;
  let plain: D2IReadResult;

  beforeAll(() => {
    underscore = readD2I(fixture('SharedStashSoftCoreV2V105_.d2i'), gd);
    plain = readD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd);
  });

  it('SharedStashSoftCoreV2V105_.d2i: three normal sectors, 0/31, 7/62, 0/42', () => {
    expect(underscore.tiled).toBe(true);
    expect(underscore.reachedEof).toBe(true);
    expect(underscore.sectors.map(s => [s.offset, s.size, s.type])).toEqual([
      [0, 1210, 0], [1210, 2290, 0], [3500, 1184, 0],
    ]);
    expect(underscore.sectors.map(s => `${s.list!.parsed}/${s.list!.declared}`)).toEqual(['0/31', '7/62', '0/42']);
    expect(underscore.sectors[1].list).toEqual({
      headerOffset: 1274,
      declared: 62,
      parsed: 7,
      firstItemOffset: 1278,
      endOffset: 1492,
      expectedEnd: 3500,
      reachedEnd: false,
      truncated: true,
      complete: false,
      error: 'item 8/62: unknown item stat code 489',
      errorCode: ErrorCode.PARSE_ERROR,
    });
    expect(underscore.sectors[0].list!.error).toBe('item 1/31: unknown item stat code 508');
    expect(underscore.sectors[2].list!.error).toBe('item 1/42: unknown item stat code 506');
    // Offsets are absolute even though each sector is parsed through a sub-array.
    expect(underscore.sectors[2].list!.headerOffset).toBe(3564);
    expect(underscore.sectors[2].list!.firstItemOffset).toBe(3568);
  });

  it('SharedStashSoftCoreV2V105.d2i: 1/15, 1/7, three empty complete, extended 56/56 complete, metadata unparsed', () => {
    expect(plain.tiled).toBe(true);
    expect(plain.reachedEof).toBe(true);
    expect(plain.sectors.map(s => [s.offset, s.size, s.type])).toEqual([
      [0, 989, 0], [989, 373, 0], [1362, 68, 0], [1430, 68, 0], [1498, 68, 0], [1566, 830, 1], [2396, 168, 2],
    ]);
    const summary = plain.sectors.map(s => (s.list ? `${s.list.parsed}/${s.list.declared}:${s.list.complete}` : 'none'));
    expect(summary).toEqual(['1/15:false', '1/7:false', '0/0:true', '0/0:true', '0/0:true', '56/56:true', 'none']);
    expect(plain.sectors[0].list!.error).toBe('item 2/15: unknown item stat code 482');
    expect(plain.sectors[1].list!.error).toBe('item 2/7: unknown item stat code 480');
    // The extended sector is the only non-empty list the parser walks to the very end.
    expect(plain.sectors[5].list).toMatchObject({
      headerOffset: 1630,
      firstItemOffset: 1634,
      endOffset: 2396,
      expectedEnd: 2396,
      reachedEnd: true,
      truncated: false,
      error: null,
      errorCode: null,
    });
    // An empty sector is complete: 0 declared, 0 parsed, reader at the sector end.
    expect(plain.sectors[2].list).toMatchObject({ headerOffset: 1426, endOffset: 1430, expectedEnd: 1430, reachedEnd: true });
  });

  it('pages carry the sector report and the raw type; virtual sub-pages share one report', () => {
    expect(plain.pages.map(p => p.rawType)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
    expect(plain.pages[0].list).toBe(plain.sectors[0].list);
    expect(plain.pages[5].list).toBe(plain.pages[6].list);
    expect(plain.pages[6].list).toBe(plain.pages[7].list);
    expect(plain.pages[7].list).toBe(plain.sectors[5].list);
    expect(underscore.pages.map(p => p.list!.parsed)).toEqual([0, 7, 0]);
  });

  it('a file cut inside the last sector is not tiled but the loop still reaches the end', () => {
    const cut = readD2I(fixture('SharedStashSoftCoreV2V105_.d2i').slice(0, 1360), gd);
    expect(cut.sectors.length).toBe(2);
    expect(cut.reachedEof).toBe(true);
    expect(cut.tiled).toBe(false);
    expect(cut.sectors[1].list).toMatchObject({ parsed: 2, errorCode: ErrorCode.BUFFER_OVERRUN, reachedEnd: false });
  });

  it('trailing garbage after the last sector: not tiled, loop stopped early', () => {
    const src = fixture('SharedStashSoftCoreV2V105_.d2i');
    const withTail = new Uint8Array(src.length + 100);
    withTail.set(src);
    withTail.fill(0xee, src.length);
    const res = readD2I(withTail, gd);
    expect(res.sectors.length).toBe(3);
    expect(res.reachedEof).toBe(false);
    expect(res.tiled).toBe(false);
  });

  it('empty buffer: no sectors, not tiled', () => {
    const res = readD2I(new Uint8Array(0), gd);
    expect(res.sectors).toEqual([]);
    expect(res.tiled).toBe(false);
  });
});

describe('byte ranges on parsed items', () => {
  let warlock: D2SReadResult;
  let shards: D2SReadResult;

  beforeAll(() => {
    warlock = readD2S(fixture('WarlockTest.d2s'), gd);
    shards = readD2S(fixture('WarlockShards.d2s'), gd);
  });

  it('own range excludes socketed children, full range includes them', () => {
    const helm = warlock.items[3];
    expect(helm.base).toBe('fhl');
    expect(helm.byteRange).toEqual({ start: 1081, end: 1112 });
    expect(helm.fullByteRange).toEqual({ start: 1081, end: 1134 });
    expect(helm.socketedByteRanges).toEqual([{ start: 1112, end: 1123 }, { start: 1123, end: 1134 }]);
    expect(helm.socketedItems).toEqual(['r09', 'r12']);
    // The legacy bit field is unchanged: it still ends before the children.
    expect(helm.binaryOffset).toEqual({ start: 1081 * 8, end: 1112 * 8 });
  });

  it('socketed children are byte-ranged like top-level items', () => {
    expect(warlock.items['r09' as unknown as number].byteRange).toEqual({ start: 1112, end: 1123 });
    expect(warlock.items['r12' as unknown as number].byteRange).toEqual({ start: 1123, end: 1134 });
    expect(warlock.items['r09' as unknown as number].fullByteRange).toEqual({ start: 1112, end: 1123 });
    expect(warlock.items['r09' as unknown as number].socketedByteRanges).toEqual([]);
  });

  it('every parsed top-level item of WarlockTest.d2s is contiguous with the next one', () => {
    const ranges = [0, 1, 2, 3, 6].map(k => warlock.items[k].fullByteRange!);
    expect(ranges).toEqual([
      { start: 918, end: 954 }, { start: 954, end: 1000 }, { start: 1000, end: 1081 },
      { start: 1081, end: 1134 }, { start: 1134, end: 1197 },
    ]);
    expect(ranges[0].start).toBe(warlock.lists.main!.firstItemOffset);
    expect(ranges[ranges.length - 1].end).toBe(warlock.lists.main!.endOffset);
  });

  it('a preset key holds the LAST instance: hp1 of WarlockShards.d2s is the fourth potion', () => {
    // Four hp1 occupy [907,917) [917,927) [927,937) [937,947); the dict keeps one entry per code.
    expect(shards.items['hp1' as unknown as number].byteRange).toEqual({ start: 937, end: 947 });
    expect(shards.items['tsc' as unknown as number].byteRange).toEqual({ start: 947, end: 956 });
    expect(shards.items['isc' as unknown as number].byteRange).toEqual({ start: 956, end: 966 });
  });

  it('.d2i ranges are absolute file offsets (sector offset included)', () => {
    const res = readD2I(fixture('SharedStashSoftCoreV2V105_.d2i'), gd);
    const amulet = Object.values(res.items).find(i => i.guid === 3740327953 && i.byteRange!.start < 1400)!;
    expect(amulet.base).toBe('amu');
    expect(amulet.byteRange).toEqual({ start: 1278, end: 1315 });
    // The legacy bit offset stays relative to the sector (1278 - 1210 = 68 bytes = 544 bits).
    expect(amulet.binaryOffset.start).toBe(544);

    const plain = readD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd);
    expect(plain.items[1].base).toBe('cm1');
    expect(plain.items[1].byteRange).toEqual({ start: 68, end: 108 });
    expect(plain.items[2].base).toBe('ci2');
    expect(plain.items[2].byteRange).toEqual({ start: 1057, end: 1094 });
    const rvl = plain.items['rvl' as unknown as number];
    expect(rvl.byteRange).toEqual({ start: 1634, end: 1645 });
    expect(rvl.quantity).toBe(99);
  });

  it('every item of every fixture has byte-aligned, ordered ranges nested correctly', () => {
    const results: Array<Record<string | number, BinaryParsedItem>> = [
      warlock.items, shards.items,
      readD2I(fixture('SharedStashSoftCoreV2V105_.d2i'), gd).items,
      readD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).items,
    ];
    let checked = 0;
    for (const items of results) {
      for (const item of Object.values(items)) {
        const own = item.byteRange!;
        const full = item.fullByteRange!;
        expect(own.start).toBeLessThan(own.end);
        expect(full.start).toBe(own.start);
        expect(full.end).toBeGreaterThanOrEqual(own.end);
        let cursor = own.end;
        for (const child of item.socketedByteRanges!) {
          expect(child.start).toBe(cursor);
          expect(child.end).toBeGreaterThan(child.start);
          cursor = child.end;
        }
        expect(cursor).toBe(full.end);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe('parseItemList report on a hand-built list', () => {
  function listOf(...items: Uint8Array[]): Uint8Array {
    const total = items.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(4 + total);
    out[0] = 0x4a; out[1] = 0x4d; out[2] = items.length & 0xff; out[3] = items.length >> 8;
    let at = 4;
    for (const b of items) { out.set(b, at); at += b.length; }
    return out;
  }

  it('reports complete=true when parsed === declared and the reader stops at expectedEnd', () => {
    const potion = fixture('WarlockShards.d2s').slice(907, 917); // one hp1, 10 bytes
    const list = listOf(potion, potion, potion);
    const reader = new BinaryReader(list);
    const ctx = createItemParser(reader, gd, 0, { baseOffset: 1000 });
    const report = ctx.parseItemList(() => {}, { expectedEnd: 1000 + list.length });
    expect(report).toEqual({
      headerOffset: 1000,
      declared: 3,
      parsed: 3,
      firstItemOffset: 1004,
      endOffset: 1034,
      expectedEnd: 1034,
      reachedEnd: true,
      truncated: false,
      complete: true,
      error: null,
      errorCode: null,
    });
  });

  it('reports complete=false when the declared count is larger than the bytes present', () => {
    const potion = fixture('WarlockShards.d2s').slice(907, 917);
    const list = listOf(potion, potion);
    list[2] = 3; // claim three items, provide two
    const ctx = createItemParser(new BinaryReader(list), gd);
    const report = ctx.parseItemList(() => {});
    expect(report).toMatchObject({ declared: 3, parsed: 2, endOffset: 24, truncated: true, complete: false, errorCode: ErrorCode.BUFFER_OVERRUN });
    expect(report.error).toMatch(/^item 3\/3: buffer overrun/);
  });

  it('reports complete=false when the list ends before expectedEnd (trailing bytes)', () => {
    const potion = fixture('WarlockShards.d2s').slice(907, 917);
    const list = listOf(potion);
    const padded = new Uint8Array(list.length + 5);
    padded.set(list);
    const ctx = createItemParser(new BinaryReader(padded), gd);
    const report = ctx.parseItemList(() => {}, { expectedEnd: padded.length });
    expect(report).toMatchObject({ declared: 1, parsed: 1, endOffset: 14, expectedEnd: 19, reachedEnd: false, truncated: false, complete: false, error: null });
  });

  it('onItem fires for every item, children before parents, with registration keys', () => {
    const helmWithRunes = fixture('WarlockTest.d2s').slice(1081, 1134);
    const trace: Array<[string, number, number | string | null]> = [];
    const ctx = createItemParser(new BinaryReader(listOf(helmWithRunes)), gd, 0, {
      onItem: t => trace.push([t.item.base, t.depth, t.registeredKey]),
    });
    ctx.parseItemList(() => {});
    expect(trace).toEqual([['r09', 1, 'r09'], ['r12', 1, 'r12'], ['fhl', 0, 0]]);
  });
});
