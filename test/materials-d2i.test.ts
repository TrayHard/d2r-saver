/**
 * Materials tab (`.d2i` sector type 1), 0.4.0: reading every record with both quantity copies,
 * the deterministic record encoder, in-place quantity patches, appended records, and the
 * synthetic single-sector fixtures. All on public fixtures; the optional last block reads a local
 * copy of a real tab only when `STASH_MATERIALS_OWNER_COPY` points to it (nothing is committed).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../src/game-data/game-data.js';
import { BitWriter } from '../src/core/binary-writer.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import {
  readMaterialsD2I,
  editMaterialsD2I,
  encodeMaterialRecord,
  materialRecordEncodeInput,
  materialEncodingVerified,
  MATERIAL_COMPLEX_FLAGS,
  type MaterialRecord,
  type MaterialsSectorReport,
} from '../src/operations/materials-d2i.js';
import {
  verifyExactDiff,
  readD2ISectorChain,
  readU16,
  readU32,
  writeU16,
  writeU32,
  D2I_LIST_COUNT_OFFSET,
  D2I_SECTOR_SIZE_OFFSET,
  D2I_FIRST_ITEM_OFFSET,
} from '../src/operations/verify-diff.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';
import {
  buildMaterialsFixtures,
  extractMaterialsSector,
  MATERIALS_SELLER_FIXTURE,
  MATERIALS_BUYER_FIXTURE,
  MATERIALS_SOURCE_SECTOR,
  MATERIALS_SOURCE_SECTOR_SIZE,
} from './helpers/materials-fixtures.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** SHA-256 of the committed synthetic fixtures (regenerate with `npm run build:fixtures:materials`). */
const SELLER_SHA256 = '3d0c7ad4ef004a023e794ba506fc048585c9c330b73143e9af2680ad546f96b3';
const BUYER_SHA256 = 'c85d0f2e2ecf7d627eb46e731590dbc472473f46f0a799c303da5dbb6b0fd311';

const SECTOR = MATERIALS_SOURCE_SECTOR; // 1780 in SharedStashComplete.d2i

let gd: GameData;
let complete: Uint8Array;
let report: MaterialsSectorReport;

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
  complete = fixture('SharedStashComplete.d2i');
  report = readMaterialsD2I(complete, gd, { sectorOffset: SECTOR });
});

// ─── Independent bit helpers (not the library's) ────────────────

function bit(buf: Uint8Array, b: number): number {
  return (buf[b >> 3] >> (b & 7)) & 1;
}
function bits(buf: Uint8Array, b: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v |= bit(buf, b + i) << i;
  return v;
}
function setBits(buf: Uint8Array, b: number, n: number, value: number): void {
  for (let i = 0; i < n; i++) {
    const p = b + i;
    if ((value >> i) & 1) buf[p >> 3] |= 1 << (p & 7);
    else buf[p >> 3] &= ~(1 << (p & 7));
  }
}
/** Hand-made patch of one record: col, row and the 8-bit quantity. */
function handPatch(buf: Uint8Array, r: MaterialRecord, q: number): Uint8Array {
  const out = new Uint8Array(buf);
  const s = r.recordStart * 8;
  setBits(out, s + 42, 4, q & 15);
  setBits(out, s + 46, 4, q >> 4);
  setBits(out, s + r.quantityFlagBit! + 1, 8, q);
  return out;
}
function changedBytes(a: Uint8Array, b: Uint8Array): number[] {
  expect(b.length).toBe(a.length);
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}
function expectCode(fn: () => unknown, code: ErrorCode): D2RSaverError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
  return caught as D2RSaverError;
}
const rec = (r: MaterialsSectorReport, code: string) => r.records.find(x => x.code === code)!;

/** A single-sector file holding `records` after a copy of the source header. */
function sectorWith(records: Uint8Array[]): Uint8Array {
  const size = D2I_FIRST_ITEM_OFFSET + records.reduce((s, r) => s + r.length, 0);
  const out = new Uint8Array(size);
  out.set(complete.subarray(SECTOR, SECTOR + D2I_FIRST_ITEM_OFFSET), 0);
  let at = D2I_FIRST_ITEM_OFFSET;
  for (const r of records) { out.set(r, at); at += r.length; }
  writeU16(out, D2I_LIST_COUNT_OFFSET, records.length);
  writeU32(out, D2I_SECTOR_SIZE_OFFSET, size);
  return out;
}
const recordBytes = (code: string) => {
  const r = rec(report, code);
  return complete.slice(r.recordStart, r.recordEnd);
};

// ─── Read ───────────────────────────────────────────────────────

describe('readMaterialsD2I on the public fixture', () => {
  it('reads all 56 records of the type-1 sector, complete, no duplicates, every layout ok', () => {
    expect(report.sectorOffset).toBe(SECTOR);
    expect(report.size).toBe(MATERIALS_SOURCE_SECTOR_SIZE);
    expect(report.declared).toBe(56);
    expect(report.parsed).toBe(56);
    expect(report.complete).toBe(true);
    expect(report.records).toHaveLength(56);
    expect(report.duplicateCodes).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.records.every(r => r.layoutOk && r.layoutIssue === null)).toBe(true);
    // Records tile the list exactly up to the sector end.
    let at = SECTOR + D2I_FIRST_ITEM_OFFSET;
    for (const r of report.records) { expect(r.recordStart).toBe(at); at = r.recordEnd; }
    expect(at).toBe(SECTOR + MATERIALS_SOURCE_SECTOR_SIZE);
  });

  it('families: 35 simple (runes, glb, potions) and 21 complex (keys, statuettes, shards, essences, organs, token)', () => {
    const simple = report.records.filter(r => r.family === 'simple');
    const cx = report.records.filter(r => r.family === 'complex');
    expect(simple).toHaveLength(35);
    expect(cx).toHaveLength(21);
    expect(cx.map(r => r.code).sort()).toEqual(
      ['bet', 'bey', 'ceh', 'dhn', 'fed', 'mbr', 'pk1', 'pk2', 'pk3', 'tes', 'toa',
        'ua1', 'ua2', 'ua3', 'ua4', 'ua5', 'xa1', 'xa2', 'xa3', 'xa4', 'xa5'],
    );
    for (const r of simple) {
      expect(r.guid).toBeNull();
      expect(r.ilvl).toBeNull();
      expect([10, 11]).toContain(r.recordEnd - r.recordStart);
    }
    for (const r of cx) {
      expect(r.recordEnd - r.recordStart).toBe(18);
      expect(r.guid).toBe(0);
      expect([13, 41]).toContain(r.ilvl);
      expect(r.flags).toBe(MATERIAL_COMPLEX_FLAGS);
    }
  });

  it('both quantity copies agree, independently read: flag bit 1, 8-bit value == col + 16*row', () => {
    for (const r of report.records) {
      const s = r.recordStart * 8;
      expect(r.quantityFlag).toBe(1);
      expect(bit(complete, s + r.quantityFlagBit!)).toBe(1);
      const q = bits(complete, s + r.quantityFlagBit! + 1, 8);
      const pos = bits(complete, s + 42, 4) + 16 * bits(complete, s + 46, 4);
      expect(q).toBe(r.quantity);
      expect(pos).toBe(r.quantity);
      expect(r.positionQuantity).toBe(r.quantity);
      expect(r.loc).toBe(0);
    }
    expect(rec(report, 'rvl')).toMatchObject({ quantity: 99 });
    expect(bits(complete, rec(report, 'rvl').recordStart * 8 + 42, 4)).toBe(3);
    expect(bits(complete, rec(report, 'rvl').recordStart * 8 + 46, 4)).toBe(6);
    expect(rec(report, 'pk1')).toMatchObject({ quantity: 21, positionQuantity: 21 });
  });

  it('lists the zero-quantity glb record that readD2I hides', () => {
    const glb = rec(report, 'glb');
    expect(glb.quantity).toBe(0);
    expect(glb.quantityFlag).toBe(1);
    expect(glb.layoutOk).toBe(true);
    // readD2I's virtual pages skip zero-quantity records; r01 (quantity 1) is listed, glb is not.
    const pages = JSON.stringify(readD2I(complete, gd).pages);
    expect(pages).toContain('"r01"');
    expect(pages).not.toContain('"glb"');
  });

  it('reads the same sector at its offset in the original two-sector-later file (SharedStashSoftCoreV2V105.d2i @1566)', () => {
    const other = readMaterialsD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd, { sectorOffset: 1566 });
    expect(other.records.map(r => [r.code, r.quantity])).toEqual(report.records.map(r => [r.code, r.quantity]));
  });

  it('refuses a non-type-1 sector (INVALID_PAGE) and a non-sector offset', () => {
    expectCode(() => readMaterialsD2I(complete, gd, { sectorOffset: 0 }), ErrorCode.INVALID_PAGE);
    expectCode(() => readMaterialsD2I(complete, gd, { sectorOffset: 2610 }), ErrorCode.INVALID_PAGE);
    expectCode(() => readMaterialsD2I(complete, gd, { sectorOffset: 1781 }), ErrorCode.INVALID_PAGE);
  });
});

// ─── Encode ─────────────────────────────────────────────────────

describe('encodeMaterialRecord', () => {
  it('re-encodes every one of the 56 records byte for byte', () => {
    for (const r of report.records) {
      const bytes = encodeMaterialRecord(gd, materialRecordEncodeInput(r));
      expect(Array.from(bytes), `${r.index} ${r.code}`).toEqual(Array.from(complete.subarray(r.recordStart, r.recordEnd)));
    }
    expect(materialEncodingVerified(complete, gd, report, 'simple')).toBe(true);
    expect(materialEncodingVerified(complete, gd, report, 'complex')).toBe(true);
  });

  it('is deterministic and uses the default flags, loc 0, col/row from the quantity', () => {
    const a = encodeMaterialRecord(gd, { family: 'simple', code: 'gpv', quantity: 37 });
    const b = encodeMaterialRecord(gd, { family: 'simple', code: 'gpv', quantity: 37 });
    expect(a).toEqual(b);
    expect(a.length).toBe(11);
    expect(bits(a, 0, 32)).toBe(0x00a00010);
    expect(bits(a, 32, 3)).toBe(5);
    expect(bits(a, 35, 3)).toBe(0);
    expect(bits(a, 42, 4)).toBe(37 & 15);
    expect(bits(a, 46, 4)).toBe(37 >> 4);
    expect(bits(a, 50, 3)).toBe(5);
    const k = encodeMaterialRecord(gd, { family: 'complex', code: 'pk1', quantity: 0, guid: 0xdeadbeef, ilvl: 1 });
    expect(k.length).toBe(18);
    const r = readMaterialsD2I(sectorWith([k]), gd, { sectorOffset: 0 }).records[0];
    expect(r).toMatchObject({ code: 'pk1', family: 'complex', quantity: 0, positionQuantity: 0, quantityFlag: 1, guid: 0xdeadbeef, ilvl: 1, layoutOk: true });
  });

  it('refuses bad input', () => {
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'zzz', quantity: 1 }), ErrorCode.UNKNOWN_BASE);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'r01', quantity: 256 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'r01', quantity: -1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'complex', code: 'pk1', quantity: 1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'complex', code: 'pk1', quantity: 1, guid: 1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'complex', code: 'pk1', quantity: 1, guid: 1, ilvl: 128 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'r01', quantity: 1, guid: 1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'r01', quantity: 1, loc: 1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'r01', quantity: 1, flags: MATERIAL_COMPLEX_FLAGS }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'r01', quantity: 1, flags: 0x00a00010 | (1 << 22) }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => encodeMaterialRecord(gd, { family: 'simple', code: 'R01', quantity: 1 }), ErrorCode.INVALID_ARGUMENT);
    // A base whose record carries extra fields (armor: defense, durability) is never encoded.
    expectCode(() => encodeMaterialRecord(gd, { family: 'complex', code: 'cap', quantity: 1, guid: 1, ilvl: 1 }), ErrorCode.INVALID_ARGUMENT);
  });
});

// ─── Patch ──────────────────────────────────────────────────────

describe('editMaterialsD2I patches', () => {
  const cases: Array<[string, number, number]> = [['r01', 1, 0], ['r01', 1, 99], ['pk1', 21, 20], ['rvl', 99, 98]];
  for (const [code, from, to] of cases) {
    it(`${code} ${from} -> ${to} changes only the bytes of the changed col/row/quantity bits`, () => {
      const r = rec(report, code);
      const res = editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code, from, to }], appends: [] });
      expect(res.newBuffer.length).toBe(complete.length);
      expect(Array.from(res.newBuffer)).toEqual(Array.from(handPatch(complete, r, to)));
      const changed = changedBytes(complete, res.newBuffer);
      expect(changed.length).toBeGreaterThan(0);
      const allowed = new Set<number>();
      for (const b of [42, 43, 44, 45, 46, 47, 48, 49]) allowed.add(r.recordStart + (b >> 3));
      for (let b = r.quantityFlagBit! + 1; b <= r.quantityFlagBit! + 8; b++) allowed.add(r.recordStart + (b >> 3));
      for (const c of changed) expect(allowed.has(c), `byte ${c}`).toBe(true);
      expect(readU16(res.newBuffer, SECTOR + D2I_LIST_COUNT_OFFSET)).toBe(56);
      expect(readU32(res.newBuffer, SECTOR + D2I_SECTOR_SIZE_OFFSET)).toBe(830);
      const after = rec(res.after, code);
      expect(after).toMatchObject({ quantity: to, positionQuantity: to, quantityFlag: 1, recordStart: r.recordStart, recordEnd: r.recordEnd });
      expect(res.diff).toEqual({
        kind: 'd2i-materials',
        sectorOffset: SECTOR,
        patches: [{ recordStart: r.recordStart, recordEnd: r.recordEnd, quantityFlagBit: r.quantityFlagBit, before: from, after: to }],
        appends: [],
      });
      expect(verifyExactDiff(complete, res.newBuffer, res.diff).ok).toBe(true);
    });
  }

  it('rvl 99 -> 98 touches record bytes 5 and 9 only; quantity 0 keeps the record', () => {
    const r = rec(report, 'rvl');
    const res = editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'rvl', from: 99, to: 98 }], appends: [] });
    expect(changedBytes(complete, res.newBuffer).map(b => b - r.recordStart)).toEqual([5, 9]);
    const zero = editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 1, to: 0 }], appends: [] });
    expect(zero.after.records).toHaveLength(56);
    expect(rec(zero.after, 'r01')).toMatchObject({ quantity: 0, quantityFlag: 1, layoutOk: true });
  });

  it('every record, every quantity 0..255: patch and reverse patch restore the file byte for byte', () => {
    const original = report.records.map(r => ({ code: r.code, q: r.quantity! }));
    for (let q = 0; q <= 255; q++) {
      const there = editMaterialsD2I(complete, gd, {
        sectorOffset: SECTOR,
        patches: original.map(o => ({ code: o.code, from: o.q, to: q })),
        appends: [],
      }, { maxQuantity: 255 });
      expect(there.newBuffer.length).toBe(complete.length);
      for (const r of there.after.records) {
        if (r.quantity !== q || r.positionQuantity !== q || r.quantityFlag !== 1) throw new Error(`q=${q} ${r.code}`);
      }
      const back = editMaterialsD2I(there.newBuffer, gd, {
        sectorOffset: SECTOR,
        patches: original.map(o => ({ code: o.code, from: q, to: o.q })),
        appends: [],
      }, { maxQuantity: 255 });
      if (sha256(back.newBuffer) !== sha256(complete)) throw new Error(`reverse patch from ${q} differs`);
    }
  });

  it('caps the quantity: 100 with the default cap of 99 is MATERIAL_RANGE; a cap above 255 is INVALID_ARGUMENT', () => {
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 1, to: 100 }], appends: [] }), ErrorCode.MATERIAL_RANGE);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 1, to: -1 }], appends: [] }), ErrorCode.MATERIAL_RANGE);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 1, to: 1.5 }], appends: [] }), ErrorCode.MATERIAL_RANGE);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 1, to: 2 }], appends: [] }, { maxQuantity: 256 }), ErrorCode.INVALID_ARGUMENT);
    expect(editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 1, to: 99 }], appends: [] }).after.records.find(r => r.code === 'r01')!.quantity).toBe(99);
  });

  it('refuses a stale read, an unknown code, an empty edit and a code named twice', () => {
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'r01', from: 2, to: 0 }], appends: [] }), ErrorCode.MATERIAL_STALE);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [{ code: 'gpv', from: 0, to: 1 }], appends: [] }), ErrorCode.MATERIAL_NOT_FOUND);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [], appends: [] }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => editMaterialsD2I(complete, gd, {
      sectorOffset: SECTOR,
      patches: [{ code: 'r01', from: 1, to: 0 }, { code: 'r01', from: 1, to: 2 }],
      appends: [],
    }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => editMaterialsD2I(complete, gd, {
      sectorOffset: SECTOR,
      patches: [{ code: 'r01', from: 1, to: 0 }],
      appends: [{ code: 'r01', family: 'simple', quantity: 1 }],
    }), ErrorCode.INVALID_ARGUMENT);
  });

  it('refuses a type-0 sector (INVALID_PAGE)', () => {
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 1, to: 0 }], appends: [] }), ErrorCode.INVALID_PAGE);
  });

  it('refuses a truncated list (LIST_TRUNCATED): count too high, count too low, cut record', () => {
    const base = sectorWith([recordBytes('r01'), recordBytes('pk1'), recordBytes('glb')]);
    const tooHigh = new Uint8Array(base);
    writeU16(tooHigh, D2I_LIST_COUNT_OFFSET, 4);
    expectCode(() => editMaterialsD2I(tooHigh, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 1, to: 0 }], appends: [] }), ErrorCode.LIST_TRUNCATED);
    const tooLow = new Uint8Array(base);
    writeU16(tooLow, D2I_LIST_COUNT_OFFSET, 2);
    expectCode(() => editMaterialsD2I(tooLow, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 1, to: 0 }], appends: [] }), ErrorCode.LIST_TRUNCATED);
    const cut = sectorWith([recordBytes('r01'), recordBytes('pk1').subarray(0, 12)]);
    expect(readMaterialsD2I(cut, gd, { sectorOffset: 0 }).complete).toBe(false);
    expectCode(() => editMaterialsD2I(cut, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 1, to: 0 }], appends: [] }), ErrorCode.LIST_TRUNCATED);
  });

  it('refuses a duplicate code (MATERIAL_DUPLICATE_CODE)', () => {
    const dup = sectorWith([recordBytes('r01'), recordBytes('pk1'), recordBytes('r01')]);
    const r = readMaterialsD2I(dup, gd, { sectorOffset: 0 });
    expect(r.duplicateCodes).toEqual(['r01']);
    expectCode(() => editMaterialsD2I(dup, gd, { sectorOffset: 0, patches: [{ code: 'pk1', from: 21, to: 20 }], appends: [] }), ErrorCode.MATERIAL_DUPLICATE_CODE);
  });

  it('refuses the whole sector when any record has a broken layout (MATERIAL_LAYOUT)', () => {
    // col bit flipped: the two quantity copies disagree.
    const badCol = sectorWith([recordBytes('r01'), recordBytes('pk1'), recordBytes('glb')]);
    badCol[D2I_FIRST_ITEM_OFFSET + 5] ^= 1 << (43 & 7); // record bit 43 (col bit 1) of r01
    expect(readMaterialsD2I(badCol, gd, { sectorOffset: 0 }).records[0]).toMatchObject({ layoutOk: false, layoutIssue: 'quantity_mismatch' });
    expectCode(() => editMaterialsD2I(badCol, gd, { sectorOffset: 0, patches: [{ code: 'pk1', from: 21, to: 20 }], appends: [] }), ErrorCode.MATERIAL_LAYOUT);

    // Quantity flag 0: the record has no quantity field (the record is shorter accordingly).
    const r01 = rec(report, 'r01');
    const noFlag = recordBytes('r01');
    setBits(noFlag, r01.quantityFlagBit!, 9, 0);
    setBits(noFlag, 42, 8, 0);
    const shortened = noFlag.subarray(0, Math.ceil((r01.quantityFlagBit! + 1) / 8));
    const s1 = sectorWith([shortened, recordBytes('pk1')]);
    expect(readMaterialsD2I(s1, gd, { sectorOffset: 0 }).records[0]).toMatchObject({ layoutOk: false, layoutIssue: 'no_quantity_field', quantity: null, quantityFlag: 0 });
    expectCode(() => editMaterialsD2I(s1, gd, { sectorOffset: 0, patches: [{ code: 'pk1', from: 21, to: 20 }], appends: [] }), ErrorCode.MATERIAL_LAYOUT);

    // Pre-stats quantity (1 + 9 bits before the stats) instead of the post-stats field.
    const pre = complexWith({ preQuantity: 7, postQuantity: null });
    const s2 = sectorWith([pre, recordBytes('r01')]);
    expect(readMaterialsD2I(s2, gd, { sectorOffset: 0 }).records[0]).toMatchObject({ layoutOk: false, layoutIssue: 'pre_stats_quantity' });
    expectCode(() => editMaterialsD2I(s2, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 1, to: 2 }], appends: [] }), ErrorCode.MATERIAL_LAYOUT);

    // Both fields present: the post-stats field is no longer where the family puts it.
    const both = complexWith({ preQuantity: 7, postQuantity: 7 });
    const s3 = sectorWith([both, recordBytes('r01')]);
    expect(readMaterialsD2I(s3, gd, { sectorOffset: 0 }).records[0]).toMatchObject({ layoutOk: false, layoutIssue: 'unexpected_layout' });

    // storage other than 5.
    const st = recordBytes('glb');
    setBits(st, 50, 3, 1);
    expect(readMaterialsD2I(sectorWith([st]), gd, { sectorOffset: 0 }).records[0].layoutIssue).toBe('storage');
  });
});

/** A complex pk1 record built by hand with a pre-stats and/or post-stats quantity field. */
function complexWith(o: { preQuantity: number | null; postQuantity: number | null }): Uint8Array {
  const q = o.postQuantity ?? o.preQuantity ?? 0;
  const w = new BitWriter(256);
  w.writeUInt32(MATERIAL_COMPLEX_FLAGS, 32);
  w.writeUInt8(5, 3);
  w.writeUInt8(0, 3);
  w.writeUInt8(0, 4);
  w.writeUInt8(q & 15, 4);
  w.writeUInt8(q >> 4, 4);
  w.writeUInt8(5, 3);
  for (const ch of 'pk1 ') w.writeChar(ch);
  w.writeUInt8(0, 3);
  w.writeUInt32(0, 32);
  w.writeUInt8(13, 7);
  w.writeUInt8(2, 4);
  w.writeBit(0);
  w.writeBit(0);
  w.writeBit(0);
  if (o.preQuantity !== null) { w.writeBit(1); w.writeUInt16(o.preQuantity, 9); } else w.writeBit(0);
  w.writeUInt16(0x1ff, 9);
  if (o.postQuantity !== null) { w.writeBit(1); w.writeUInt8(o.postQuantity, 8); } else w.writeBit(0);
  w.align();
  return w.toArray();
}

// ─── Append ─────────────────────────────────────────────────────

describe('editMaterialsD2I appends', () => {
  it('appends gpv (+11), gpb (+10) and std (+18) at the end of the sector; the type-2 sector after it moves unchanged', () => {
    const res = editMaterialsD2I(complete, gd, {
      sectorOffset: SECTOR,
      patches: [],
      appends: [
        { code: 'gpv', family: 'simple', quantity: 4 },
        { code: 'gpb', family: 'simple', quantity: 1 },
        { code: 'std', family: 'complex', quantity: 2, guid: 0x12345678, ilvl: 90 },
      ],
    });
    const out = res.newBuffer;
    expect(out.length).toBe(complete.length + 39);
    expect(readU16(out, SECTOR + D2I_LIST_COUNT_OFFSET)).toBe(59);
    expect(readU32(out, SECTOR + D2I_SECTOR_SIZE_OFFSET)).toBe(830 + 39);
    expect(res.diff.appends.map(a => a.bytes.length)).toEqual([11, 10, 18]);
    // Everything before the sector end is identical except the count and the size.
    const end = SECTOR + 830;
    for (let i = 0; i < end; i++) {
      if (i >= SECTOR + 16 && i < SECTOR + 20) continue;
      if (i >= SECTOR + 66 && i < SECTOR + 68) continue;
      if (out[i] !== complete[i]) throw new Error(`byte ${i} changed`);
    }
    expect(Array.from(out.subarray(end + 39))).toEqual(Array.from(complete.subarray(end)));
    expect(readD2ISectorChain(out).map(s => [s.offset, s.size, s.type])).toEqual([
      [0, 949, 0], [949, 336, 0], [1285, 359, 0], [1644, 68, 0], [1712, 68, 0], [1780, 869, 1], [2649, 168, 2],
    ]);
    const tail = res.after.records.slice(56);
    expect(tail.map(r => [r.code, r.family, r.quantity, r.positionQuantity, r.guid, r.ilvl, r.layoutOk])).toEqual([
      ['gpv', 'simple', 4, 4, null, null, true],
      ['gpb', 'simple', 1, 1, null, null, true],
      ['std', 'complex', 2, 2, 0x12345678, 90, true],
    ]);
    expect(verifyExactDiff(complete, out, res.diff).ok).toBe(true);
  });

  it('patches and appends in one edit (buyer fixture: pk1 and gpv absent, r10 98 -> 99)', () => {
    const buyer = fixture(MATERIALS_BUYER_FIXTURE);
    const res = editMaterialsD2I(buyer, gd, {
      sectorOffset: 0,
      patches: [{ code: 'r10', from: 98, to: 99 }],
      appends: [
        { code: 'pk1', family: 'complex', quantity: 3, guid: 0x0badf00d, ilvl: 1 },
        { code: 'gpv', family: 'simple', quantity: 4 },
      ],
    });
    expect(res.after.records.map(r => `${r.code}=${r.quantity}`)).toEqual(['rvl=99', 'glb=0', 'r01=0', 'r10=99', 'tes=1', 'pk1=3', 'gpv=4']);
    expect(readU32(res.newBuffer, D2I_SECTOR_SIZE_OFFSET)).toBe(res.newBuffer.length);
    expect(verifyExactDiff(buyer, res.newBuffer, res.diff).ok).toBe(true);
    expectCode(() => editMaterialsD2I(buyer, gd, { sectorOffset: 0, patches: [{ code: 'r10', from: 98, to: 100 }], appends: [] }), ErrorCode.MATERIAL_RANGE);
    expectCode(() => editMaterialsD2I(buyer, gd, { sectorOffset: 0, patches: [{ code: 'pk1', from: 0, to: 1 }], appends: [] }), ErrorCode.MATERIAL_NOT_FOUND);
  });

  it('refuses an append for a present code, a zero or over-cap quantity, and a missing guid', () => {
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [], appends: [{ code: 'r01', family: 'simple', quantity: 1 }] }), ErrorCode.MATERIAL_ALREADY_PRESENT);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [], appends: [{ code: 'gpv', family: 'simple', quantity: 0 }] }), ErrorCode.MATERIAL_RANGE);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [], appends: [{ code: 'gpv', family: 'simple', quantity: 100 }] }), ErrorCode.MATERIAL_RANGE);
    expectCode(() => editMaterialsD2I(complete, gd, { sectorOffset: SECTOR, patches: [], appends: [{ code: 'std', family: 'complex', quantity: 1 }] }), ErrorCode.INVALID_ARGUMENT);
  });

  it('LAYOUT_UNVERIFIED: no record of the family in the sector, or one that the encoder does not reproduce', () => {
    const onlySimple = sectorWith([recordBytes('r01'), recordBytes('glb'), recordBytes('rvl')]);
    expectCode(() => editMaterialsD2I(onlySimple, gd, {
      sectorOffset: 0, patches: [], appends: [{ code: 'pk1', family: 'complex', quantity: 1, guid: 1, ilvl: 1 }],
    }), ErrorCode.LAYOUT_UNVERIFIED);
    const onlyComplex = sectorWith([recordBytes('pk1'), recordBytes('tes')]);
    expectCode(() => editMaterialsD2I(onlyComplex, gd, {
      sectorOffset: 0, patches: [], appends: [{ code: 'gpv', family: 'simple', quantity: 1 }],
    }), ErrorCode.LAYOUT_UNVERIFIED);

    // glb with the ethereal flag: still a well-formed quantity record (patchable), but the encoder
    // refuses that flag, so simple records cannot be proven and no simple append is allowed.
    const eth = recordBytes('glb');
    setBits(eth, 22, 1, 1);
    const s = sectorWith([recordBytes('r01'), eth, recordBytes('pk1')]);
    expect(readMaterialsD2I(s, gd, { sectorOffset: 0 }).records[1].layoutOk).toBe(true);
    expectCode(() => editMaterialsD2I(s, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'gpv', family: 'simple', quantity: 1 }] }), ErrorCode.LAYOUT_UNVERIFIED);
    expect(editMaterialsD2I(s, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 1, to: 2 }], appends: [] }).after.records[0].quantity).toBe(2);
    // Complex appends are still proven by pk1.
    expect(editMaterialsD2I(s, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'pk2', family: 'complex', quantity: 1, guid: 9, ilvl: 1 }] }).after.records).toHaveLength(4);
  });
});

// ─── Memory ─────────────────────────────────────────────────────

describe('caller memory', () => {
  it('never modifies the input (Uint8Array or Node Buffer) and never aliases it', () => {
    for (const input of [new Uint8Array(complete), Buffer.from(complete)]) {
      const snapshot = sha256(input);
      const res = editMaterialsD2I(input, gd, {
        sectorOffset: SECTOR,
        patches: [{ code: 'r01', from: 1, to: 50 }],
        appends: [{ code: 'gpv', family: 'simple', quantity: 2 }],
      });
      expect(sha256(input)).toBe(snapshot);
      expect(res.newBuffer.buffer).not.toBe(input.buffer);
      res.newBuffer[0] ^= 0xff;
      expect(sha256(input)).toBe(snapshot);
    }
  });
});

// ─── Synthetic single-sector fixtures ───────────────────────────

describe('MaterialsTabSeller.d2i / MaterialsTabBuyer.d2i', () => {
  it('match the deterministic build and their pinned SHA-256', () => {
    const built = buildMaterialsFixtures(complete, gd);
    const seller = fixture(MATERIALS_SELLER_FIXTURE);
    const buyer = fixture(MATERIALS_BUYER_FIXTURE);
    expect(sha256(seller)).toBe(SELLER_SHA256);
    expect(sha256(buyer)).toBe(BUYER_SHA256);
    expect(sha256(built.seller)).toBe(SELLER_SHA256);
    expect(sha256(built.buyer)).toBe(BUYER_SHA256);
  });

  it('are one type-1 sector at offset 0 whose size is the file length', () => {
    for (const name of [MATERIALS_SELLER_FIXTURE, MATERIALS_BUYER_FIXTURE]) {
      const buf = fixture(name);
      expect(readD2ISectorChain(buf)).toEqual([{ offset: 0, size: buf.length, type: 1 }]);
      const r = readMaterialsD2I(buf, gd, { sectorOffset: 0 });
      expect(r.complete).toBe(true);
      expect(r.issues).toEqual([]);
      expect(materialEncodingVerified(buf, gd, r, 'simple')).toBe(true);
      expect(materialEncodingVerified(buf, gd, r, 'complex')).toBe(true);
    }
  });

  it('hold the documented quantities', () => {
    const q = (name: string) => readMaterialsD2I(fixture(name), gd, { sectorOffset: 0 }).records.map(r => `${r.code}=${r.quantity}`);
    expect(q(MATERIALS_SELLER_FIXTURE)).toEqual(['rvl=99', 'glb=0', 'r01=5', 'r10=3', 'pk1=3', 'tes=2', 'ua1=1', 'gpv=4']);
    expect(q(MATERIALS_BUYER_FIXTURE)).toEqual(['rvl=99', 'glb=0', 'r01=0', 'r10=98', 'tes=1']);
  });

  it('extractMaterialsSector copies source bytes verbatim apart from count and size', () => {
    const one = extractMaterialsSector(complete, gd, SECTOR, ['pk1']);
    const pk1 = rec(report, 'pk1');
    expect(Array.from(one.subarray(D2I_FIRST_ITEM_OFFSET))).toEqual(Array.from(complete.subarray(pk1.recordStart, pk1.recordEnd)));
  });
});

// ─── Optional: a local read-only copy of a real materials tab ───

const OWNER_COPY = process.env.STASH_MATERIALS_OWNER_COPY;
const hasOwnerCopy = !!OWNER_COPY && existsSync(OWNER_COPY);

describe.skipIf(!hasOwnerCopy)('local real-tab copy (STASH_MATERIALS_OWNER_COPY, read-only, never committed)', () => {
  it('72 records, layout ok, encoder reproduces 60 simple and 12 complex, rvl/jwd patches touch the expected bytes', () => {
    const buf = new Uint8Array(readFileSync(OWNER_COPY!));
    const before = sha256(buf);
    const r = readMaterialsD2I(buf, gd, { sectorOffset: 0 });
    expect(readD2ISectorChain(buf)).toHaveLength(1);
    expect(r.complete).toBe(true);
    expect(r.records).toHaveLength(72);
    expect(r.records.every(x => x.layoutOk)).toBe(true);
    expect(r.duplicateCodes).toEqual([]);
    const simple = r.records.filter(x => x.family === 'simple');
    const cx = r.records.filter(x => x.family === 'complex');
    expect(simple).toHaveLength(60);
    expect(cx).toHaveLength(12);
    expect(materialEncodingVerified(buf, gd, r, 'simple')).toBe(true);
    expect(materialEncodingVerified(buf, gd, r, 'complex')).toBe(true);
    const rvl = rec(r, 'rvl');
    const jwd = rec(r, 'jwd');
    const a = editMaterialsD2I(buf, gd, { sectorOffset: 0, patches: [{ code: 'rvl', from: rvl.quantity!, to: rvl.quantity! - 1 }], appends: [] });
    const b = editMaterialsD2I(buf, gd, { sectorOffset: 0, patches: [{ code: 'jwd', from: jwd.quantity!, to: jwd.quantity! - 1 }], appends: [] });
    const rel = (x: Uint8Array, start: number) => changedBytes(buf, x).map(i => i - start);
    // Only counts and hashes go to the log; no bytes of the copy.
    console.log(`owner copy sha256 ${before}: records ${r.records.length}, simple ${simple.length}, complex ${cx.length}, ` +
      `rvl ${rvl.quantity}->${rvl.quantity! - 1} bytes [${rel(a.newBuffer, rvl.recordStart)}], jwd ${jwd.quantity}->${jwd.quantity! - 1} bytes [${rel(b.newBuffer, jwd.recordStart)}]`);
    if (rvl.quantity === 87) expect(rel(a.newBuffer, rvl.recordStart)).toEqual([5, 9]);
    if (jwd.quantity === 42) expect(rel(b.newBuffer, jwd.recordStart)).toEqual([5, 16, 17]);
    expect(sha256(buf)).toBe(before);
  });
});
