/**
 * In-place .d2i operations (design section 6.4): extractInPlaceD2I, insertInPlaceD2I,
 * fixD2ISectorSize. The happy path runs on the synthetic complete sector of
 * SharedStashComplete.d2i (the only kind of sector the production path may write into);
 * the truncated sectors of the real fixtures cover extraction with `requireCompleteList: false`
 * and every refusal.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../src/game-data/game-data.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import { walkD2I, readItemHead, readItemPosition, zeroItemPosition, type WalkResult } from '../src/formats/item-walker.js';
import { extractInPlaceD2I, insertInPlaceD2I, fixD2ISectorSize } from '../src/operations/inplace-d2i.js';
import { verifyExactDiff, readU16, readU32, D2I_LIST_COUNT_OFFSET, D2I_SECTOR_SIZE_OFFSET } from '../src/operations/verify-diff.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';
import { D2RSaver } from '../src/index.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

const COMPLETE = 1285;        // the complete sector of SharedStashComplete.d2i
const EMPTY = 1644;           // first empty sector of SharedStashComplete.d2i
const PLAIN_EMPTY = 1362;     // first empty sector of SharedStashSoftCoreV2V105.d2i

let gd: GameData;
let complete: Uint8Array;
let plain: Uint8Array;
let underscore: Uint8Array;
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const sectorWalk = (buf: Uint8Array, offset: number): WalkResult => walkD2I(buf, gd).sectors.find(s => s.offset === offset)!.walk!;

function expectCode(fn: () => unknown, code: ErrorCode): D2RSaverError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
  return caught as D2RSaverError;
}

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
  complete = fixture('SharedStashComplete.d2i');
  plain = fixture('SharedStashSoftCoreV2V105.d2i');
  underscore = fixture('SharedStashSoftCoreV2V105_.d2i');
});

// ─── 6.4 §2: cut and paste back gives the original byte for byte ─

describe('extract → insert round trip on the complete sector', () => {
  it('every item: extract, then insert at the same list index and cell → byte-identical file', () => {
    const walk = sectorWalk(complete, COMPLETE);
    expect(walk.report.complete).toBe(true);
    for (const entry of walk.entries) {
      const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [entry.index] }, gd);
      expect(cut.newBuffer.length).toBe(complete.length - (entry.full.end - entry.full.start));
      expect(cut.listAfter).toMatchObject({ declared: 8, parsed: 8, complete: true });
      const [removed] = cut.removed;
      expect(removed.index).toBe(entry.index);
      expect(removed.range).toEqual(entry.full);
      expect(readItemPosition(removed.bytes)).toEqual({ loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
      expect(removed.head).toEqual(entry.head);

      const back = insertInPlaceD2I(
        cut.newBuffer,
        { sectorOffset: COMPLETE, listIndex: entry.index },
        [{ bytes: removed.bytes, col: entry.head.col, row: entry.head.row }],
        gd,
      );
      expect(same(back.newBuffer, complete)).toBe(true);
      expect(back.inserted).toEqual([{ index: entry.index, range: entry.full, head: entry.head }]);
      expect(back.listAfter).toMatchObject({ declared: 9, parsed: 9, complete: true });
    }
  });

  it('inserting at the head (default) moves the item first in the list; the bytes are the same', () => {
    const walk = sectorWalk(complete, COMPLETE);
    const entry = walk.entries[4];
    const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [4] }, gd);
    const back = insertInPlaceD2I(cut.newBuffer, { sectorOffset: COMPLETE }, [{ bytes: cut.removed[0].bytes, col: entry.head.col, row: entry.head.row }], gd);
    expect(back.newBuffer.length).toBe(complete.length);
    expect(same(back.newBuffer, complete)).toBe(false);
    const after = sectorWalk(back.newBuffer, COMPLETE);
    expect(after.entries[0].head).toEqual(entry.head);
    expect(after.entries[0].item.guid).toBe(entry.item.guid);
    expect(after.entries[0].item.stats).toEqual(entry.item.stats);
    // Same multiset of item bytes, only the order differs.
    const bytesOf = (buf: Uint8Array, w: WalkResult) => w.entries.map(e => sha256(buf.slice(e.full.start, e.full.end))).sort();
    expect(bytesOf(back.newBuffer, after)).toEqual(bytesOf(complete, walk));
    // Everything outside the sector's list is identical.
    expect(same(back.newBuffer.subarray(0, COMPLETE + 68), complete.subarray(0, COMPLETE + 68))).toBe(true);
    expect(same(back.newBuffer.subarray(EMPTY), complete.subarray(EMPTY))).toBe(true);
  });

  it('inserting into another cell changes only the position bits of that item', () => {
    const walk = sectorWalk(complete, COMPLETE);
    const entry = walk.entries[2]; // amu @8,0
    const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [2] }, gd);
    const moved = insertInPlaceD2I(cut.newBuffer, { sectorOffset: COMPLETE, listIndex: 2 }, [{ bytes: cut.removed[0].bytes, col: 15, row: 12 }], gd);
    expect(moved.newBuffer.length).toBe(complete.length);
    expect(same(moved.newBuffer, complete)).toBe(false);
    const diffs: number[] = [];
    for (let i = 0; i < complete.length; i++) if (moved.newBuffer[i] !== complete[i]) diffs.push(i);
    // Position bits 35–52 of the item live in bytes 4..6 of the item.
    expect(diffs.every(d => d >= entry.full.start + 4 && d <= entry.full.start + 6)).toBe(true);
    expect(diffs.length).toBeGreaterThan(0);
    expect(readItemHead(moved.newBuffer, entry.full.start)).toEqual({ ...entry.head, col: 15, row: 12 });
    expect(same(zeroItemPosition(moved.newBuffer.slice(entry.full.start, entry.full.end)), zeroItemPosition(complete.slice(entry.full.start, entry.full.end)))).toBe(true);
    expect(readD2I(moved.newBuffer, gd).pages.find(p => p.offset === COMPLETE)!.stash[12 * 16 + 15]).toBeDefined();
  });
});

// ─── 6.4 §3: several items in one cut ───────────────────────────

describe('extractInPlaceD2I: several items in one operation', () => {
  it('count drops by N, sectorSize by the sum, other sectors identical, verifyExactDiff ok', () => {
    const walk = sectorWalk(complete, COMPLETE);
    const picks = [7, 1, 4]; // any order in, ascending out
    const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: picks }, gd);
    const lengths = picks.map(i => walk.entries[i].full.end - walk.entries[i].full.start);
    const total = lengths.reduce((a, b) => a + b, 0);

    expect(cut.removed.map(r => r.index)).toEqual([1, 4, 7]);
    expect(cut.removed.map(r => r.bytes.length)).toEqual([37, 31, 37]);
    expect(cut.newBuffer.length).toBe(complete.length - total);
    expect(readU16(cut.newBuffer, COMPLETE + D2I_LIST_COUNT_OFFSET)).toBe(6);
    expect(readU32(cut.newBuffer, COMPLETE + D2I_SECTOR_SIZE_OFFSET)).toBe(359 - total);
    expect(cut.listBefore).toMatchObject({ declared: 9, parsed: 9, complete: true });
    expect(cut.listAfter).toMatchObject({ declared: 6, parsed: 6, complete: true, endOffset: EMPTY - total, expectedEnd: EMPTY - total });
    expect(cut.diff).toEqual({ kind: 'd2i-remove', sectorOffset: COMPLETE, ranges: [1, 4, 7].map(i => walk.entries[i].full) });
    expect(verifyExactDiff(complete, cut.newBuffer, cut.diff).ok).toBe(true);

    // Other sectors byte-identical (before the target, and after it shifted by `total`).
    expect(same(cut.newBuffer.subarray(0, COMPLETE), complete.subarray(0, COMPLETE))).toBe(true);
    expect(same(cut.newBuffer.subarray(EMPTY - total), complete.subarray(EMPTY))).toBe(true);
    // Sector header identical except sectorSize.
    expect(same(cut.newBuffer.subarray(COMPLETE, COMPLETE + 16), complete.subarray(COMPLETE, COMPLETE + 16))).toBe(true);
    expect(same(cut.newBuffer.subarray(COMPLETE + 20, COMPLETE + 66), complete.subarray(COMPLETE + 20, COMPLETE + 66))).toBe(true);

    // The remaining items are the same bytes, in the same order.
    const after = sectorWalk(cut.newBuffer, COMPLETE);
    const remaining = walk.entries.filter(e => !picks.includes(e.index));
    expect(after.entries.map(e => e.item.guid)).toEqual(remaining.map(e => e.item.guid));
    expect(after.entries.map(e => sha256(cut.newBuffer.slice(e.full.start, e.full.end)))).toEqual(remaining.map(e => sha256(complete.slice(e.full.start, e.full.end))));
    expect(readD2I(cut.newBuffer, gd).pages.length).toBe(readD2I(complete, gd).pages.length);

    // And the whole set of removed items can be pasted back at once.
    const back = insertInPlaceD2I(cut.newBuffer, { sectorOffset: COMPLETE, listIndex: 1 }, cut.removed.map(r => ({ bytes: r.bytes, col: r.head.col, row: r.head.row })), gd);
    expect(back.listAfter).toMatchObject({ declared: 9, parsed: 9, complete: true });
    expect(back.inserted.map(i => i.index)).toEqual([1, 2, 3]);
    expect(verifyExactDiff(cut.newBuffer, back.newBuffer, back.diff).ok).toBe(true);
  });

  it('cutting all nine items leaves an empty complete sector', () => {
    const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, gd);
    expect(cut.listAfter).toMatchObject({ declared: 0, parsed: 0, complete: true });
    expect(readU32(cut.newBuffer, COMPLETE + D2I_SECTOR_SIZE_OFFSET)).toBe(68);
    expect(cut.newBuffer.length).toBe(complete.length - 291);
  });
});

// ─── truncated sectors of the real fixtures ─────────────────────

describe('extractInPlaceD2I on truncated sectors (requireCompleteList: false)', () => {
  it('cuts the first item of sector @1210 of SharedStashSoftCoreV2V105_.d2i; the truncation point moves up by one', () => {
    const before = sectorWalk(underscore, 1210);
    expect(before.report).toMatchObject({ declared: 62, parsed: 7, error: 'item 8/62: unknown item stat code 489' });
    const cut = extractInPlaceD2I(underscore, { sectorOffset: 1210, indexes: [0] }, gd, { requireCompleteList: false });
    expect(cut.removed[0]).toMatchObject({ index: 0, range: { start: 1278, end: 1315 } });
    expect(cut.removed[0].head).toMatchObject({ base: 'amu', col: 8, row: 0, storage: 5 });
    expect(cut.removed[0].bytes.length).toBe(37);
    expect(cut.listAfter).toMatchObject({ declared: 61, parsed: 6, complete: false, error: 'item 7/61: unknown item stat code 489' });
    expect(verifyExactDiff(underscore, cut.newBuffer, cut.diff).ok).toBe(true);
    // Remaining ranges shifted by 37.
    const after = sectorWalk(cut.newBuffer, 1210);
    expect(after.entries.map(e => [e.full.start, e.full.end])).toEqual(before.entries.slice(1).map(e => [e.full.start - 37, e.full.end - 37]));
    // The readers agree.
    const read = readD2I(cut.newBuffer, gd);
    expect(read.pages.length).toBe(3);
    expect(read.warnings[1]).toBe('Stash page 1: item list truncated: item 7/61: unknown item stat code 489');
  });

  it('cuts the first item of sector @0 of SharedStashSoftCoreV2V105.d2i (cm1, 40 bytes)', () => {
    const cut = extractInPlaceD2I(plain, { sectorOffset: 0, indexes: [0] }, gd, { requireCompleteList: false });
    expect(cut.removed[0]).toMatchObject({ index: 0, range: { start: 68, end: 108 } });
    expect(cut.removed[0].head).toMatchObject({ base: 'cm1', col: 9, row: 7 });
    expect(cut.listAfter).toMatchObject({ declared: 14, parsed: 0, error: 'item 1/14: unknown item stat code 482' });
    expect(same(cut.newBuffer.subarray(949), plain.subarray(989))).toBe(true);
    expect(readD2I(cut.newBuffer, gd).warnings).toEqual([
      'Stash page 0: item list truncated: item 1/14: unknown item stat code 482',
      'Stash page 1: item list truncated: item 2/7: unknown item stat code 480',
    ]);
  });

  it('an item beyond the parsed prefix is ITEM_NOT_FOUND even with the option', () => {
    const err = expectCode(() => extractInPlaceD2I(underscore, { sectorOffset: 1210, indexes: [7] }, gd, { requireCompleteList: false }), ErrorCode.ITEM_NOT_FOUND);
    expect(err.message).toMatch(/7 of 62 parsed/);
    expectCode(() => extractInPlaceD2I(underscore, { sectorOffset: 0, indexes: [0] }, gd, { requireCompleteList: false }), ErrorCode.ITEM_NOT_FOUND);
  });
});

// ─── 6.4 §4: insert into another sector ─────────────────────────

describe('insertInPlaceD2I into an empty sector', () => {
  it('SharedStashSoftCoreV2V105.d2i @1362: the item parses first with the new position, same guid and stats', () => {
    const source = sectorWalk(underscore, 1210).entries[0]; // the amulet
    const cut = extractInPlaceD2I(underscore, { sectorOffset: 1210, indexes: [0] }, gd, { requireCompleteList: false });
    const ins = insertInPlaceD2I(plain, { sectorOffset: PLAIN_EMPTY }, [{ bytes: cut.removed[0].bytes, col: 15, row: 12 }], gd);

    expect(ins.newBuffer.length).toBe(plain.length + 37);
    expect(ins.listBefore).toMatchObject({ declared: 0, parsed: 0, complete: true });
    expect(ins.listAfter).toMatchObject({ declared: 1, parsed: 1, complete: true, endOffset: PLAIN_EMPTY + 68 + 37 });
    expect(ins.inserted).toEqual([{ index: 0, range: { start: 1430, end: 1467 }, head: { ...source.head, col: 15, row: 12, loc: 0, bodyloc: 0, storage: 5 } }]);
    expect(ins.diff).toEqual({ kind: 'd2i-insert', sectorOffset: PLAIN_EMPTY, inserts: [{ at: 1430, length: 37, bytes: ins.newBuffer.slice(1430, 1467) }] });
    expect(verifyExactDiff(plain, ins.newBuffer, ins.diff).ok).toBe(true);
    expect(readU16(ins.newBuffer, PLAIN_EMPTY + D2I_LIST_COUNT_OFFSET)).toBe(1);
    expect(readU32(ins.newBuffer, PLAIN_EMPTY + D2I_SECTOR_SIZE_OFFSET)).toBe(68 + 37);

    const after = sectorWalk(ins.newBuffer, PLAIN_EMPTY);
    expect(after.entries[0].item.guid).toBe(3740327953);
    expect(after.entries[0].item.stats).toEqual(source.item.stats);
    const read = readD2I(ins.newBuffer, gd);
    expect(read.pages.length).toBe(8);
    expect(read.tiled).toBe(true);
    const page = read.pages.find(p => p.offset === PLAIN_EMPTY)!;
    expect(page.stash[12 * 16 + 15]).toBeDefined();
    expect(read.items[page.stash[12 * 16 + 15] as number].base).toBe('amu');
    // Sectors before and after the target are byte-identical; the header except size and count too.
    expect(same(ins.newBuffer.subarray(0, PLAIN_EMPTY + 16), plain.subarray(0, PLAIN_EMPTY + 16))).toBe(true);
    expect(same(ins.newBuffer.subarray(PLAIN_EMPTY + 20, PLAIN_EMPTY + 66), plain.subarray(PLAIN_EMPTY + 20, PLAIN_EMPTY + 66))).toBe(true);
    expect(same(ins.newBuffer.subarray(1467), plain.subarray(1430))).toBe(true);
  });

  it('SharedStashComplete.d2i @1644: a 2x2 circlet and a ring in one call', () => {
    const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [1, 3] }, gd); // ci2, rin
    const ins = insertInPlaceD2I(cut.newBuffer, { sectorOffset: EMPTY - 68 }, [
      { bytes: cut.removed[0].bytes, col: 14, row: 11 },
      { bytes: cut.removed[1].bytes, col: 0, row: 0 },
    ], gd);
    expect(ins.listAfter).toMatchObject({ declared: 2, parsed: 2, complete: true });
    expect(ins.inserted.map(i => `${i.head.base}@${i.head.col},${i.head.row}`)).toEqual(['ci2@14,11', 'rin@0,0']);
    expect(verifyExactDiff(cut.newBuffer, ins.newBuffer, ins.diff).ok).toBe(true);
    expect(ins.newBuffer.length).toBe(complete.length);
    const report = walkD2I(ins.newBuffer, gd);
    expect(report.sectors.map(s => s.walk?.report.parsed ?? null)).toEqual([0, 0, 7, 2, 0, 56, null]);
    expect(report.sectors.map(s => s.walk?.report.complete ?? null)).toEqual([false, false, true, true, true, true, null]);
  });

  it('a stack (rune) with a quantity keeps it', () => {
    const extended = sectorWalk(plain, 1566); // extended sector: complete, but never a target
    const rune = extended.entries.find(e => e.head.base === 'r08')!;
    expect(rune.item.quantity).toBe(3);
    const ins = insertInPlaceD2I(complete, { sectorOffset: EMPTY }, [{ bytes: plain.slice(rune.full.start, rune.full.end), col: 3, row: 3 }], gd);
    const after = sectorWalk(ins.newBuffer, EMPTY);
    expect(after.entries[0].item).toMatchObject({ base: 'r08', quantity: 3 });
    expect(after.entries[0].head).toMatchObject({ col: 3, row: 3, loc: 0, storage: 5 });
  });
});

// ─── 6.4 §5: refusals ───────────────────────────────────────────

describe('refusals', () => {
  it('extract from a truncated sector with requireCompleteList (default) → LIST_TRUNCATED', () => {
    const err = expectCode(() => extractInPlaceD2I(underscore, { sectorOffset: 1210, indexes: [0] }, gd), ErrorCode.LIST_TRUNCATED);
    expect(err.message).toBe('sector at byte 1210: item list is not complete (7/62 parsed): item 8/62: unknown item stat code 489');
    expectCode(() => extractInPlaceD2I(underscore, { sectorOffset: 1210, indexes: [0] }, gd, { requireCompleteList: true }), ErrorCode.LIST_TRUNCATED);
    expectCode(() => extractInPlaceD2I(plain, { sectorOffset: 0, indexes: [0] }, gd), ErrorCode.LIST_TRUNCATED);
  });

  it('insert into a truncated sector → LIST_TRUNCATED, always', () => {
    const bytes = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [3] }, gd).removed[0].bytes;
    for (const [buf, offset] of [[underscore, 0], [underscore, 1210], [underscore, 3500], [plain, 0], [plain, 989]] as const) {
      expectCode(() => insertInPlaceD2I(buf, { sectorOffset: offset }, [{ bytes, col: 15, row: 12 }], gd), ErrorCode.LIST_TRUNCATED);
    }
  });

  it('extended (type 1) and metadata (type 2) sectors → INVALID_PAGE for both operations', () => {
    const bytes = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [3] }, gd).removed[0].bytes;
    for (const offset of [1780, 2610]) {
      expectCode(() => extractInPlaceD2I(complete, { sectorOffset: offset, indexes: [0] }, gd), ErrorCode.INVALID_PAGE);
      expectCode(() => extractInPlaceD2I(complete, { sectorOffset: offset, indexes: [0] }, gd, { requireCompleteList: false }), ErrorCode.INVALID_PAGE);
      expectCode(() => insertInPlaceD2I(complete, { sectorOffset: offset }, [{ bytes, col: 0, row: 0 }], gd), ErrorCode.INVALID_PAGE);
    }
    // An offset that is not a sector start is INVALID_PAGE too, never "the nearest sector".
    expectCode(() => extractInPlaceD2I(complete, { sectorOffset: COMPLETE + 1, indexes: [0] }, gd), ErrorCode.INVALID_PAGE);
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: 1353 }, [{ bytes, col: 0, row: 0 }], gd), ErrorCode.INVALID_PAGE);
  });

  it('a taken or out-of-grid cell → NO_FREE_SLOT (including cells taken by an earlier item of the same call)', () => {
    const bytes = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [3] }, gd).removed[0].bytes; // rin 1x1
    const ci2 = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [1] }, gd).removed[0].bytes; // 2x2
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: COMPLETE }, [{ bytes, col: 8, row: 0 }], gd), ErrorCode.NO_FREE_SLOT); // amu
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: COMPLETE }, [{ bytes, col: 1, row: 1 }], gd), ErrorCode.NO_FREE_SLOT); // inside ci2
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: EMPTY }, [{ bytes: ci2, col: 15, row: 12 }], gd), ErrorCode.NO_FREE_SLOT); // 2x2 leaves the grid
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: EMPTY }, [{ bytes, col: 2, row: 2 }, { bytes: ci2, col: 1, row: 1 }], gd), ErrorCode.NO_FREE_SLOT);
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: EMPTY }, [{ bytes, col: 16, row: 0 }], gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: EMPTY }, [{ bytes, col: 0, row: 13 }], gd), ErrorCode.NO_FREE_SLOT);
    // The buffer is never modified by a refused call.
    expect(sha256(complete)).toBe(sha256(fixture('SharedStashComplete.d2i')));
  });

  it('bytes that are not exactly one item → INVALID_ARGUMENT; a base without a size → UNKNOWN_BASE', () => {
    const item = extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [3] }, gd).removed[0].bytes;
    const two = new Uint8Array(item.length * 2);
    two.set(item); two.set(item, item.length);
    const at = { sectorOffset: EMPTY };
    expect(expectCode(() => insertInPlaceD2I(complete, at, [{ bytes: item.slice(0, 20), col: 0, row: 0 }], gd), ErrorCode.INVALID_ARGUMENT).message).toMatch(/exactly one item/);
    expect(expectCode(() => insertInPlaceD2I(complete, at, [{ bytes: two, col: 0, row: 0 }], gd), ErrorCode.INVALID_ARGUMENT).message).toMatch(/exactly one item/);
    expectCode(() => insertInPlaceD2I(complete, at, [{ bytes: new Uint8Array(3), col: 0, row: 0 }], gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => insertInPlaceD2I(complete, at, [{ bytes: new Uint8Array(40), col: 0, row: 0 }], gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => insertInPlaceD2I(complete, at, [], gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: EMPTY, listIndex: 1 }, [{ bytes: item, col: 0, row: 0 }], gd), ErrorCode.INVALID_ARGUMENT);
    // A GameData without the base cannot size the item.
    const blind = Object.create(gd) as GameData;
    Object.defineProperty(blind, 'items', { value: { ...gd.items, rin: undefined } });
    expectCode(() => insertInPlaceD2I(complete, at, [{ bytes: item, col: 0, row: 0 }], blind), ErrorCode.UNKNOWN_BASE);
    expectCode(() => insertInPlaceD2I(complete, { sectorOffset: COMPLETE }, [{ bytes: item, col: 12, row: 12 }], blind), ErrorCode.UNKNOWN_BASE); // the sector holds rings
  });

  it('bad indexes → INVALID_ARGUMENT / ITEM_NOT_FOUND', () => {
    expectCode(() => extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [] }, gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [1, 1] }, gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [-1] }, gd), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [9] }, gd), ErrorCode.ITEM_NOT_FOUND);
    expectCode(() => extractInPlaceD2I(complete, { sectorOffset: EMPTY, indexes: [0] }, gd), ErrorCode.ITEM_NOT_FOUND);
  });

  it('a file that is not a tiled .d2i → INVALID_FORMAT before anything is parsed', () => {
    const t0 = performance.now();
    expectCode(() => extractInPlaceD2I(complete.slice(0, 1400), { sectorOffset: COMPLETE, indexes: [0] }, gd), ErrorCode.INVALID_FORMAT);
    expectCode(() => insertInPlaceD2I(complete.slice(0, 2700), { sectorOffset: EMPTY }, [{ bytes: new Uint8Array(10), col: 0, row: 0 }], gd), ErrorCode.INVALID_FORMAT);
    expectCode(() => extractInPlaceD2I(fixture('WarlockTest.d2s'), { sectorOffset: 0, indexes: [0] }, gd), ErrorCode.INVALID_FORMAT);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

// ─── 6.4 §6: a truncated file fails fast ────────────────────────

describe('truncated SharedStashComplete.d2i (BUFFER_OVERRUN in milliseconds)', () => {
  it('walkD2I and readD2I report BUFFER_OVERRUN for a sector cut inside an item and return quickly', () => {
    const t0 = performance.now();
    // Cut points inside items 1, 2, 5 and 9 of the complete sector.
    // Item ends: 1393, 1430, 1467, 1498, 1529, 1555, 1581, 1618, 1644.
    for (const [cutAt, parsed] of [[COMPLETE + 70, 0], [COMPLETE + 100, 0], [COMPLETE + 120, 1], [COMPLETE + 200, 3], [EMPTY - 5, 8]] as const) {
      const cut = complete.slice(0, cutAt);
      const report = walkD2I(cut, gd);
      expect(report.tiled).toBe(false);
      expect(report.reachedEof).toBe(true); // the loop reached the end; the last sector just overran
      const sector = report.sectors[2];
      expect(sector.walk!.report).toMatchObject({ declared: 9, parsed, complete: false, truncated: true, errorCode: ErrorCode.BUFFER_OVERRUN });
      expect(sector.walk!.report.error).toMatch(/^item \d\/9: buffer overrun/);
      const read = readD2I(cut, gd);
      expect(read.tiled).toBe(false);
      expect(read.warnings.some(w => w.startsWith('Stash page 2: item list truncated: item') && /buffer overrun/.test(w))).toBe(true);
    }
    expect(performance.now() - t0).toBeLessThan(1000);
  }, 2000);

  it('every truncation point of the file terminates within the budget', () => {
    const t0 = performance.now();
    let overruns = 0;
    let thrown = 0;
    const boundaries = new Set([949, 1285, 1644, 1712, 1780, 2610]);
    for (let cutAt = 1; cutAt < complete.length; cutAt++) {
      let report;
      try {
        report = walkD2I(complete.slice(0, cutAt), gd);
      } catch (e) {
        // A sector whose header fits but whose JM list header does not: the walker throws.
        expect(e).toBeInstanceOf(D2RSaverError);
        expect((e as D2RSaverError).code).toBe(ErrorCode.BUFFER_OVERRUN);
        thrown++;
        continue;
      }
      // A cut exactly on a sector boundary is a shorter but well-formed stash.
      expect(report.tiled).toBe(boundaries.has(cutAt));
      for (const s of report.sectors) {
        if (s.walk?.report.errorCode === ErrorCode.BUFFER_OVERRUN) overruns++;
      }
    }
    expect(overruns).toBeGreaterThan(500);
    expect(thrown).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 5000);
});

// ─── fixD2ISectorSize ───────────────────────────────────────────

describe('fixD2ISectorSize', () => {
  it('patches only the four bytes of the size field', () => {
    const buf = complete.slice();
    fixD2ISectorSize(buf, COMPLETE, -100);
    expect(readU32(buf, COMPLETE + D2I_SECTOR_SIZE_OFFSET)).toBe(259);
    const diffs: number[] = [];
    for (let i = 0; i < buf.length; i++) if (buf[i] !== complete[i]) diffs.push(i);
    expect(diffs).toEqual([COMPLETE + D2I_SECTOR_SIZE_OFFSET]); // 359 = 0x167, 259 = 0x103: only the low byte
    fixD2ISectorSize(buf, COMPLETE, 100);
    expect(same(buf, complete)).toBe(true);
  });

  it('refuses a header outside the buffer, a non-sector, a size below a header or past the buffer', () => {
    const buf = complete.slice();
    expectCode(() => fixD2ISectorSize(buf, buf.length - 10, 0), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => fixD2ISectorSize(buf, COMPLETE + 4, 0), ErrorCode.INVALID_FORMAT);
    expectCode(() => fixD2ISectorSize(buf, COMPLETE, -300), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => fixD2ISectorSize(buf, COMPLETE, buf.length), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => fixD2ISectorSize(buf, COMPLETE, 1.5), ErrorCode.INVALID_ARGUMENT);
    expect(same(buf, complete)).toBe(true);
  });
});

// ─── facade ─────────────────────────────────────────────────────

describe('D2RSaver facade', () => {
  it('exposes extractInPlaceD2I / insertInPlaceD2I bound to its GameData', () => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    const saver = D2RSaver.fromData(rawData, locale);
    const cut = saver.extractInPlaceD2I(complete, { sectorOffset: COMPLETE, indexes: [0] });
    const back = saver.insertInPlaceD2I(cut.newBuffer, { sectorOffset: COMPLETE, listIndex: 0 }, [{ bytes: cut.removed[0].bytes, col: 9, row: 7 }]);
    expect(same(back.newBuffer, complete)).toBe(true);
    expectCode(() => saver.extractInPlaceD2I(underscore, { sectorOffset: 0, indexes: [0] }), ErrorCode.LIST_TRUNCATED);
  });
});
