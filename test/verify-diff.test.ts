/**
 * verifyExactDiff: the result of an in-place edit differs from its source by exactly the
 * declared splice, the list counter and the sector size — and nothing else.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { walkD2I } from '../src/formats/item-walker.js';
import {
  verifyExactDiff,
  assertExactDiff,
  readD2ISectorChain,
  findD2ISector,
  findNormalD2ISector,
  findMaterialsD2ISector,
  readU16,
  readU32,
  writeU16,
  writeU32,
  MAX_REPORTED_MISMATCHES,
  D2I_LIST_COUNT_OFFSET,
  D2I_SECTOR_SIZE_OFFSET,
  type DiffSpec,
  type MaterialsDiffSpec,
} from '../src/operations/verify-diff.js';
import { readMaterialsD2I, editMaterialsD2I, encodeMaterialRecord } from '../src/operations/materials-d2i.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

let gd: GameData;
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

function expectCode(fn: () => unknown, code: ErrorCode): D2RSaverError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
  return caught as D2RSaverError;
}

/** Hand-rolled removal, independent of the library's operation. */
function spliceOut(buffer: Uint8Array, sectorOffset: number, ranges: Array<{ start: number; end: number }>): Uint8Array {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const removed = sorted.reduce((s, r) => s + r.end - r.start, 0);
  const out = new Uint8Array(buffer.length - removed);
  let src = 0;
  let dst = 0;
  for (const r of sorted) {
    out.set(buffer.subarray(src, r.start), dst);
    dst += r.start - src;
    src = r.end;
  }
  out.set(buffer.subarray(src), dst);
  writeU16(out, sectorOffset + D2I_LIST_COUNT_OFFSET, readU16(buffer, sectorOffset + D2I_LIST_COUNT_OFFSET) - ranges.length);
  writeU32(out, sectorOffset + D2I_SECTOR_SIZE_OFFSET, readU32(buffer, sectorOffset + D2I_SECTOR_SIZE_OFFSET) - removed);
  return out;
}

/** Hand-rolled insertion of `bytes` in front of `at`. */
function spliceIn(buffer: Uint8Array, sectorOffset: number, at: number, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(buffer.length + bytes.length);
  out.set(buffer.subarray(0, at), 0);
  out.set(bytes, at);
  out.set(buffer.subarray(at), at + bytes.length);
  writeU16(out, sectorOffset + D2I_LIST_COUNT_OFFSET, readU16(buffer, sectorOffset + D2I_LIST_COUNT_OFFSET) + 1);
  writeU32(out, sectorOffset + D2I_SECTOR_SIZE_OFFSET, readU32(buffer, sectorOffset + D2I_SECTOR_SIZE_OFFSET) + bytes.length);
  return out;
}

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

// ─── sector chain ───────────────────────────────────────────────

describe('readD2ISectorChain / findD2ISector', () => {
  it('lists the seven sectors of SharedStashSoftCoreV2V105.d2i by offset, size and type', () => {
    expect(readD2ISectorChain(fixture('SharedStashSoftCoreV2V105.d2i'))).toEqual([
      { offset: 0, size: 989, type: 0 },
      { offset: 989, size: 373, type: 0 },
      { offset: 1362, size: 68, type: 0 },
      { offset: 1430, size: 68, type: 0 },
      { offset: 1498, size: 68, type: 0 },
      { offset: 1566, size: 830, type: 1 },
      { offset: 2396, size: 168, type: 2 },
    ]);
    expect(readD2ISectorChain(fixture('SharedStashSoftCoreV2V105_.d2i'))).toEqual([
      { offset: 0, size: 1210, type: 0 },
      { offset: 1210, size: 2290, type: 0 },
      { offset: 3500, size: 1184, type: 0 },
    ]);
  });

  it('rejects a buffer cut inside a sector (INVALID_FORMAT) instead of parsing it', () => {
    const buf = fixture('SharedStashSoftCoreV2V105.d2i');
    expect(() => readD2ISectorChain(buf.slice(0, 1700))).toThrow(/does not fit/); // inside the extended sector
    expectCode(() => readD2ISectorChain(buf.slice(0, 1700)), ErrorCode.INVALID_FORMAT);
    expect(() => readD2ISectorChain(buf.slice(0, 1400))).toThrow(/38 trailing byte/); // less than a header left
    expectCode(() => readD2ISectorChain(buf.slice(0, 1400)), ErrorCode.INVALID_FORMAT);
    expectCode(() => readD2ISectorChain(new Uint8Array(0)), ErrorCode.INVALID_FORMAT);
    expectCode(() => readD2ISectorChain(fixture('WarlockTest.d2s')), ErrorCode.INVALID_FORMAT);
  });

  it('finds a sector only at an exact header offset', () => {
    const buf = fixture('SharedStashSoftCoreV2V105.d2i');
    expect(findD2ISector(buf, 1362)).toEqual({ offset: 1362, size: 68, type: 0 });
    expect(findD2ISector(buf, 2396).type).toBe(2);
    expectCode(() => findD2ISector(buf, 1363), ErrorCode.INVALID_PAGE);
    expectCode(() => findD2ISector(buf, 64), ErrorCode.INVALID_PAGE);
    expectCode(() => findD2ISector(buf, -1), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => findD2ISector(buf, 1.5), ErrorCode.INVALID_ARGUMENT);
  });

  it('findNormalD2ISector refuses extended and metadata sectors and a missing JM', () => {
    const buf = fixture('SharedStashSoftCoreV2V105.d2i');
    expect(findNormalD2ISector(buf, 989).type).toBe(0);
    expect(expectCode(() => findNormalD2ISector(buf, 1566), ErrorCode.INVALID_PAGE).message).toMatch(/type 1 \(extended\)/);
    expect(expectCode(() => findNormalD2ISector(buf, 2396), ErrorCode.INVALID_PAGE).message).toMatch(/type 2 \(metadata\)/);
    const noJm = buf.slice();
    noJm[1362 + 64] = 0x00;
    expect(expectCode(() => findNormalD2ISector(noJm, 1362), ErrorCode.INVALID_PAGE).message).toMatch(/no "JM"/);
  });
});

// ─── d2i-remove ─────────────────────────────────────────────────

describe('verifyExactDiff d2i-remove', () => {
  const SECTOR = 1210;
  let before: Uint8Array;
  let ranges: Array<{ start: number; end: number }>;

  beforeAll(() => {
    before = fixture('SharedStashSoftCoreV2V105_.d2i');
    const walk = walkD2I(before, gd).sectors[1].walk!;
    ranges = walk.entries.map(e => ({ start: e.full.start, end: e.full.end }));
  });

  it('accepts a hand-rolled removal of one, several and all walked items', () => {
    for (const pick of [[ranges[0]], [ranges[2], ranges[5]], ranges]) {
      const after = spliceOut(before, SECTOR, pick);
      const spec: DiffSpec = { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: pick };
      expect(verifyExactDiff(before, after, spec)).toEqual({
        ok: true, expectedLength: after.length, actualLength: after.length, mismatches: [], mismatchCount: 0,
      });
      expect(assertExactDiff(before, after, spec).ok).toBe(true);
    }
  });

  it('accepts ranges given in any order', () => {
    const pick = [ranges[4], ranges[1], ranges[6]];
    const after = spliceOut(before, SECTOR, pick);
    expect(verifyExactDiff(before, after, { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: pick }).ok).toBe(true);
  });

  it('catches every single stray byte in the result (mutation sweep over the whole file)', () => {
    const pick = [ranges[0], ranges[3]];
    const after = spliceOut(before, SECTOR, pick);
    const spec: DiffSpec = { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: pick };
    const mutated = after.slice();
    for (let offset = 0; offset < after.length; offset++) {
      mutated[offset] ^= 0x40;
      const result = verifyExactDiff(before, mutated, spec);
      expect(result.ok).toBe(false);
      expect(result.mismatchCount).toBe(1);
      expect(result.mismatches).toEqual([{ offset, expected: after[offset], actual: mutated[offset] }]);
      mutated[offset] = after[offset];
    }
    expect(verifyExactDiff(before, mutated, spec).ok).toBe(true);
  });

  it('catches a wrong counter, a wrong sector size and a wrong length', () => {
    const pick = [ranges[0]];
    const after = spliceOut(before, SECTOR, pick);
    const spec: DiffSpec = { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: pick };

    const badCount = after.slice();
    writeU16(badCount, SECTOR + D2I_LIST_COUNT_OFFSET, 62); // not decremented
    let r = verifyExactDiff(before, badCount, spec);
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]).toEqual({ offset: SECTOR + D2I_LIST_COUNT_OFFSET, expected: 61, actual: 62 });

    const badSize = after.slice();
    writeU32(badSize, SECTOR + D2I_SECTOR_SIZE_OFFSET, 2290);
    r = verifyExactDiff(before, badSize, spec);
    expect(r.ok).toBe(false);
    // 2290 - 37 = 2253: only the low byte of the size field differs (0xcd vs 0xf2).
    expect(r.mismatches).toEqual([{ offset: SECTOR + D2I_SECTOR_SIZE_OFFSET, expected: 2253 & 0xff, actual: 2290 & 0xff }]);

    const longer = new Uint8Array(after.length + 1);
    longer.set(after);
    r = verifyExactDiff(before, longer, spec);
    expect(r).toMatchObject({ ok: false, expectedLength: after.length, actualLength: after.length + 1, mismatchCount: 0 });

    r = verifyExactDiff(before, after.slice(0, -10), spec);
    expect(r).toMatchObject({ ok: false, expectedLength: after.length, actualLength: after.length - 10 });

    // The unchanged source is not a valid result either.
    r = verifyExactDiff(before, before, spec);
    expect(r.ok).toBe(false);
  });

  it('caps the listed mismatches but counts them all', () => {
    const pick = [ranges[0]];
    const after = spliceOut(before, SECTOR, pick);
    const garbage = after.slice();
    for (let i = 100; i < 300; i++) garbage[i] = ~garbage[i] & 0xff;
    const r = verifyExactDiff(before, garbage, { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: pick });
    expect(r.ok).toBe(false);
    expect(r.mismatchCount).toBe(200);
    expect(r.mismatches.length).toBe(MAX_REPORTED_MISMATCHES);
    expect(r.mismatches[0].offset).toBe(100);
  });

  it('assertExactDiff throws RANGE_MISMATCH with the first offsets in the message', () => {
    const pick = [ranges[0]];
    const after = spliceOut(before, SECTOR, pick);
    after[3000] ^= 0xff;
    const err = expectCode(
      () => assertExactDiff(before, after, { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: pick }),
      ErrorCode.RANGE_MISMATCH,
    );
    expect(err.message).toMatch(/d2i-remove/);
    expect(err.message).toMatch(/byte 3000/);
    expect(err.message).toMatch(/1 differing byte/);
  });

  it('rejects specs that do not describe a list edit of a normal sector', () => {
    const after = spliceOut(before, SECTOR, [ranges[0]]);
    const bad = (spec: DiffSpec, code: ErrorCode) => expectCode(() => verifyExactDiff(before, after, spec), code);
    bad({ kind: 'd2i-remove', sectorOffset: 1211, ranges: [ranges[0]] }, ErrorCode.INVALID_PAGE);
    bad({ kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [] }, ErrorCode.INVALID_ARGUMENT);
    bad({ kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [{ start: 1300, end: 1300 }] }, ErrorCode.INVALID_ARGUMENT);
    bad({ kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [{ start: 1300, end: 1290 }] }, ErrorCode.INVALID_ARGUMENT);
    bad({ kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [{ start: 1270, end: 1300 }] }, ErrorCode.INVALID_ARGUMENT); // inside the header
    bad({ kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [{ start: 3400, end: 3600 }] }, ErrorCode.INVALID_ARGUMENT); // past the sector
    bad({ kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [ranges[0], { start: ranges[0].start + 5, end: ranges[0].end + 5 }] }, ErrorCode.INVALID_ARGUMENT); // overlap
    // A normal sector with a 0 counter cannot lose an item.
    const plain = fixture('SharedStashSoftCoreV2V105.d2i');
    expectCode(
      () => verifyExactDiff(plain, plain, { kind: 'd2i-remove', sectorOffset: 1362, ranges: [{ start: 1430, end: 1430 }] }),
      ErrorCode.INVALID_ARGUMENT,
    );
    // Extended / metadata sectors are never edited.
    expectCode(
      () => verifyExactDiff(plain, plain, { kind: 'd2i-remove', sectorOffset: 1566, ranges: [{ start: 1634, end: 1645 }] }),
      ErrorCode.INVALID_PAGE,
    );
    expectCode(
      () => verifyExactDiff(plain, plain, { kind: 'd2i-insert', sectorOffset: 2396, inserts: [{ at: 2464, length: 1 }] }),
      ErrorCode.INVALID_PAGE,
    );
  });
});

// ─── d2i-insert ─────────────────────────────────────────────────

describe('verifyExactDiff d2i-insert', () => {
  const SECTOR = 1362; // empty sector of SharedStashSoftCoreV2V105.d2i: list at 1426, first item at 1430
  let before: Uint8Array;
  let item: Uint8Array;

  beforeAll(() => {
    before = fixture('SharedStashSoftCoreV2V105.d2i');
    const walk = walkD2I(before, gd).sectors[0].walk!;
    item = before.slice(walk.entries[0].full.start, walk.entries[0].full.end); // the 40-byte cm1
  });

  it('accepts an insert at the head of an empty list, with and without the bytes', () => {
    const after = spliceIn(before, SECTOR, 1430, item);
    expect(verifyExactDiff(before, after, { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40 }] }).ok).toBe(true);
    expect(verifyExactDiff(before, after, { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40, bytes: item }] }).ok).toBe(true);
  });

  it('without bytes the gap is a wildcard; with bytes it is checked', () => {
    const after = spliceIn(before, SECTOR, 1430, item);
    after[1430 + 7] ^= 0xff;
    expect(verifyExactDiff(before, after, { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40 }] }).ok).toBe(true);
    const r = verifyExactDiff(before, after, { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40, bytes: item }] });
    expect(r.ok).toBe(false);
    expect(r.mismatches).toEqual([{ offset: 1437, expected: item[7], actual: item[7] ^ 0xff }]);
  });

  it('accepts several inserts at the same point in the given order', () => {
    const a = item;
    const b = item.slice();
    b[10] ^= 0x01;
    let after = spliceIn(before, SECTOR, 1430, b);   // b first...
    after = spliceIn(after, SECTOR, 1430, a);        // ...then a in front of it: order a, b
    const spec: DiffSpec = { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40, bytes: a }, { at: 1430, length: 40, bytes: b }] };
    expect(verifyExactDiff(before, after, spec).ok).toBe(true);
    const swapped: DiffSpec = { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40, bytes: b }, { at: 1430, length: 40, bytes: a }] };
    expect(verifyExactDiff(before, after, swapped).ok).toBe(false);
  });

  it('catches every stray byte outside the gap (mutation sweep)', () => {
    const after = spliceIn(before, SECTOR, 1430, item);
    const spec: DiffSpec = { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40 }] };
    const mutated = after.slice();
    for (let offset = 0; offset < after.length; offset++) {
      mutated[offset] ^= 0x10;
      const r = verifyExactDiff(before, mutated, spec);
      const inGap = offset >= 1430 && offset < 1470;
      expect(r.ok).toBe(inGap);
      expect(r.mismatchCount).toBe(inGap ? 0 : 1);
      mutated[offset] = after[offset];
    }
  });

  it('rejects inserts outside the list, a zero length, a bytes/length mismatch and a counter overflow', () => {
    const after = spliceIn(before, SECTOR, 1430, item);
    const bad = (spec: DiffSpec, code: ErrorCode) => expectCode(() => verifyExactDiff(before, after, spec), code);
    bad({ kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [] }, ErrorCode.INVALID_ARGUMENT);
    bad({ kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1429, length: 40 }] }, ErrorCode.INVALID_ARGUMENT);
    bad({ kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1431, length: 40 }] }, ErrorCode.INVALID_ARGUMENT); // past the empty list end
    bad({ kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 0 }] }, ErrorCode.INVALID_ARGUMENT);
    bad({ kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 39, bytes: item }] }, ErrorCode.INVALID_ARGUMENT);
    const full = before.slice();
    writeU16(full, SECTOR + D2I_LIST_COUNT_OFFSET, 0xffff);
    expectCode(
      () => verifyExactDiff(full, after, { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: 1430, length: 40 }] }),
      ErrorCode.INVALID_ARGUMENT,
    );
  });
});

// ─── d2i-materials (0.4.0) ──────────────────────────────────────

describe('verifyExactDiff d2i-materials', () => {
  const SECTOR = 1780; // type-1 sector of SharedStashComplete.d2i
  let before: Uint8Array;
  let patched: ReturnType<typeof editMaterialsD2I>;
  let appended: ReturnType<typeof editMaterialsD2I>;

  beforeAll(() => {
    before = fixture('SharedStashComplete.d2i');
    patched = editMaterialsD2I(before, gd, {
      sectorOffset: SECTOR,
      patches: [{ code: 'rvl', from: 99, to: 98 }, { code: 'pk1', from: 21, to: 0 }, { code: 'r01', from: 1, to: 77 }],
      appends: [],
    });
    appended = editMaterialsD2I(before, gd, {
      sectorOffset: SECTOR,
      patches: [{ code: 'r01', from: 1, to: 2 }],
      appends: [{ code: 'gpv', family: 'simple', quantity: 4 }, { code: 'std', family: 'complex', quantity: 1, guid: 7, ilvl: 90 }],
    });
  });

  it('accepts the edits the library produced, and an equivalent hand-built spec', () => {
    expect(verifyExactDiff(before, patched.newBuffer, patched.diff).ok).toBe(true);
    expect(verifyExactDiff(before, appended.newBuffer, appended.diff).ok).toBe(true);
    // A spec rebuilt from an independent read and fresh encodes proves the same buffer.
    const report = readMaterialsD2I(before, gd, { sectorOffset: SECTOR });
    const r01 = report.records.find(r => r.code === 'r01')!;
    const spec: DiffSpec = {
      kind: 'd2i-materials',
      sectorOffset: SECTOR,
      patches: [{ recordStart: r01.recordStart, recordEnd: r01.recordEnd, quantityFlagBit: r01.quantityFlagBit!, before: 1, after: 2 }],
      appends: [
        { bytes: encodeMaterialRecord(gd, { family: 'simple', code: 'gpv', quantity: 4 }) },
        { bytes: encodeMaterialRecord(gd, { family: 'complex', code: 'std', quantity: 1, guid: 7, ilvl: 90 }) },
      ],
    };
    expect(verifyExactDiff(before, appended.newBuffer, spec).ok).toBe(true);
  });

  it('catches every single flipped byte of the result (mutation sweep, no mask)', () => {
    for (const res of [patched, appended]) {
      const mutated = new Uint8Array(res.newBuffer);
      for (let offset = 0; offset < mutated.length; offset++) {
        mutated[offset] ^= 0x01;
        const r = verifyExactDiff(before, mutated, res.diff);
        if (r.ok || r.mismatchCount !== 1 || r.mismatches[0].offset !== offset) throw new Error(`flip at ${offset} not caught`);
        mutated[offset] = res.newBuffer[offset];
      }
    }
  });

  it('a wrong after, a missing append or an extra append in the spec is not ok', () => {
    const p = patched.diff as MaterialsDiffSpec;
    const wrongAfter: DiffSpec = { ...p, patches: p.patches.map((x, i) => (i === 0 ? { ...x, after: x.after + 1 } : x)) };
    expect(verifyExactDiff(before, patched.newBuffer, wrongAfter).ok).toBe(false);
    const a = appended.diff as MaterialsDiffSpec;
    expect(verifyExactDiff(before, appended.newBuffer, { ...a, appends: a.appends.slice(0, 1) }).ok).toBe(false);
    expect(verifyExactDiff(before, appended.newBuffer, { ...a, appends: [...a.appends, { bytes: new Uint8Array([1]) }] }).ok).toBe(false);
  });

  it('refuses a stale spec, a flag bit outside the record, unsorted or overlapping patches, bad bytes, a bad value', () => {
    const p = patched.diff as MaterialsDiffSpec;
    const first = p.patches[0];
    const bad = (spec: DiffSpec, code: ErrorCode) => expectCode(() => verifyExactDiff(before, patched.newBuffer, spec), code);
    const one = (patch: Partial<typeof first>): DiffSpec => ({ ...p, patches: [{ ...first, ...patch }] });
    bad(one({ before: first.before + 1 }), ErrorCode.INVALID_ARGUMENT); // stale: the source holds another quantity
    bad(one({ quantityFlagBit: first.quantityFlagBit + 1 }), ErrorCode.INVALID_ARGUMENT); // not the flag
    bad(one({ quantityFlagBit: 67 }), ErrorCode.INVALID_ARGUMENT);
    bad(one({ quantityFlagBit: (first.recordEnd - first.recordStart) * 8 - 8 }), ErrorCode.INVALID_ARGUMENT); // value runs past the record
    bad(one({ after: 256 }), ErrorCode.INVALID_ARGUMENT);
    bad(one({ recordStart: SECTOR + 67 }), ErrorCode.INVALID_ARGUMENT); // inside the list header
    bad(one({ recordEnd: SECTOR + 831 }), ErrorCode.INVALID_ARGUMENT); // past the sector
    bad({ ...p, patches: [...p.patches].reverse() }, ErrorCode.INVALID_ARGUMENT);
    bad({ ...p, patches: [first, first] }, ErrorCode.INVALID_ARGUMENT);
    bad({ ...p, patches: [], appends: [] }, ErrorCode.INVALID_ARGUMENT);
    bad({ ...p, appends: [{ bytes: { 0: 1 } as unknown as Uint8Array }] }, ErrorCode.INVALID_ARGUMENT); // JSON round trip
    bad({ ...p, appends: [{ bytes: new Uint8Array(0) }] }, ErrorCode.INVALID_ARGUMENT);
    // The source's flag bit is 0 for the first patched record.
    const noFlag = new Uint8Array(before);
    const fb = first.recordStart * 8 + first.quantityFlagBit;
    noFlag[fb >> 3] &= ~(1 << (fb & 7));
    expectCode(() => verifyExactDiff(noFlag, patched.newBuffer, p), ErrorCode.INVALID_ARGUMENT);
    // col/row disagree with the 8-bit value in the source.
    const badCol = new Uint8Array(before);
    badCol[first.recordStart + 5] ^= 1 << 2; // record bit 42: col bit 0
    expectCode(() => verifyExactDiff(badCol, patched.newBuffer, p), ErrorCode.INVALID_ARGUMENT);
  });

  it('only a type-1 sector for d2i-materials; d2i-remove and d2i-insert still refuse type 1', () => {
    const p = patched.diff as MaterialsDiffSpec;
    expectCode(() => verifyExactDiff(before, patched.newBuffer, { ...p, sectorOffset: 0 }), ErrorCode.INVALID_PAGE);
    expectCode(() => verifyExactDiff(before, patched.newBuffer, { ...p, sectorOffset: 2610 }), ErrorCode.INVALID_PAGE);
    expect(findMaterialsD2ISector(before, SECTOR)).toEqual({ offset: SECTOR, size: 830, type: 1 });
    expectCode(() => findMaterialsD2ISector(before, 949), ErrorCode.INVALID_PAGE);
    const r = p.patches[0];
    expectCode(
      () => verifyExactDiff(before, before, { kind: 'd2i-remove', sectorOffset: SECTOR, ranges: [{ start: r.recordStart, end: r.recordEnd }] }),
      ErrorCode.INVALID_PAGE,
    );
    expectCode(
      () => verifyExactDiff(before, before, { kind: 'd2i-insert', sectorOffset: SECTOR, inserts: [{ at: SECTOR + 830, length: 11 }] }),
      ErrorCode.INVALID_PAGE,
    );
    expectCode(
      () => verifyExactDiff(before, before, { kind: 'bogus', sectorOffset: SECTOR } as unknown as DiffSpec),
      ErrorCode.INVALID_ARGUMENT,
    );
  });

  it('assertExactDiff reports a tampered materials result as RANGE_MISMATCH', () => {
    const tampered = new Uint8Array(patched.newBuffer);
    tampered[tampered.length - 1] ^= 0xff;
    expectCode(() => assertExactDiff(before, tampered, patched.diff), ErrorCode.RANGE_MISMATCH);
  });
});
