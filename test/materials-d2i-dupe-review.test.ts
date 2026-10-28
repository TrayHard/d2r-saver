/**
 * Independent dupe/loss review of the materials edit (0.4.0), 2026-10-07.
 *
 * Bit-level whitelist of every quantity edit, empty and single-family sectors, and one documented
 * gap: the encoder proof checks every record with ITS OWN flags, so it does not prove the flags a
 * NEW record is written with (marked `it.fails`: it passes while the gap exists and starts failing
 * once appends are refused, or copy the sector's flags, when no same-family record has them).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import {
  readMaterialsD2I,
  editMaterialsD2I,
  materialEncodingVerified,
  MATERIAL_SIMPLE_FLAGS,
  type MaterialRecord,
} from '../src/operations/materials-d2i.js';
import { verifyExactDiff } from '../src/operations/verify-diff.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const ROOT = resolve(import.meta.dirname!, '..');
let gd: GameData;
let complete: Uint8Array;
let seller: Uint8Array;
let buyer: Uint8Array;

beforeAll(() => {
  gd = GameData.fromRaw(
    JSON.parse(readFileSync(resolve(ROOT, 'data', 'data.json'), 'utf-8')),
    JSON.parse(readFileSync(resolve(ROOT, 'data', 'strings.json'), 'utf-8')),
  );
  complete = new Uint8Array(readFileSync(resolve(ROOT, 'test', 'fixtures', 'SharedStashComplete.d2i')));
  seller = new Uint8Array(readFileSync(resolve(ROOT, 'test', 'fixtures', 'MaterialsTabSeller.d2i')));
  buyer = new Uint8Array(readFileSync(resolve(ROOT, 'test', 'fixtures', 'MaterialsTabBuyer.d2i')));
});

function changedBits(a: Uint8Array, b: Uint8Array): number[] {
  expect(b.length).toBe(a.length);
  const bits: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ^ b[i];
    if (x) for (let j = 0; j < 8; j++) if ((x >> j) & 1) bits.push(i * 8 + j);
  }
  return bits;
}

/** The only bits a quantity patch of `r` may flip: col (42–45), row (46–49), the 8-bit value after the flag. */
function allowedBits(r: MaterialRecord): Set<number> {
  const base = r.recordStart * 8;
  const allowed = new Set<number>();
  for (let i = 42; i < 50; i++) allowed.add(base + i);
  for (let i = 1; i <= 8; i++) allowed.add(base + r.quantityFlagBit! + i);
  return allowed;
}

function refusal(fn: () => unknown): string {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(D2RSaverError); return (e as D2RSaverError).code; }
  throw new Error('not refused');
}

/** A single-sector materials file holding exactly `records` (raw bytes copied from `source`). */
function sectorOf(source: Uint8Array, records: MaterialRecord[]): Uint8Array {
  const size = 68 + records.reduce((s, r) => s + (r.recordEnd - r.recordStart), 0);
  const out = new Uint8Array(size);
  out.set(source.subarray(0, 68), 0);
  let at = 68;
  for (const r of records) { out.set(source.subarray(r.recordStart, r.recordEnd), at); at += r.recordEnd - r.recordStart; }
  out[66] = records.length & 0xff; out[67] = records.length >> 8;
  new DataView(out.buffer).setUint32(16, size, true);
  return out;
}

describe('materials edit, review: nothing outside col/row/quantity ever changes', () => {
  it('every record of both fixtures and of the public sector (inside its 7-sector file), every quantity 0..99', () => {
    const files: Array<[Uint8Array, number]> = [[seller, 0], [buyer, 0], [complete, 1780]];
    let edits = 0;
    for (const [file, sectorOffset] of files) {
      const report = readMaterialsD2I(file, gd, { sectorOffset });
      for (const r of report.records) {
        const allowed = allowedBits(r);
        const flagBit = r.recordStart * 8 + r.quantityFlagBit!;
        for (let to = 0; to <= 99; to++) {
          const { newBuffer, diff } = editMaterialsD2I(file, gd, { sectorOffset, patches: [{ code: r.code, from: r.quantity!, to }], appends: [] });
          const bits = changedBits(file, newBuffer);
          expect(bits.filter(b => !allowed.has(b))).toEqual([]);
          expect(bits.includes(flagBit)).toBe(false);
          expect(verifyExactDiff(file, newBuffer, diff).ok).toBe(true);
          const back = readMaterialsD2I(newBuffer, gd, { sectorOffset }).records[r.index];
          expect([back.code, back.quantity, back.positionQuantity, back.quantityFlag, back.layoutOk]).toEqual([r.code, to, to, 1, true]);
          edits++;
        }
      }
    }
    expect(edits).toBe((8 + 5 + 56) * 100);
  });

  it('never writes above the cap or below zero, whatever the starting quantity', () => {
    const report = readMaterialsD2I(seller, gd, { sectorOffset: 0 });
    for (const r of report.records) {
      expect(refusal(() => editMaterialsD2I(seller, gd, { sectorOffset: 0, patches: [{ code: r.code, from: r.quantity!, to: 100 }], appends: [] })))
        .toBe(ErrorCode.MATERIAL_RANGE);
      expect(refusal(() => editMaterialsD2I(seller, gd, { sectorOffset: 0, patches: [{ code: r.code, from: r.quantity!, to: -1 }], appends: [] })))
        .toBe(ErrorCode.MATERIAL_RANGE);
      expect(refusal(() => editMaterialsD2I(seller, gd, { sectorOffset: 0, patches: [{ code: r.code, from: r.quantity!, to: 1.5 }], appends: [] })))
        .toBe(ErrorCode.MATERIAL_RANGE);
    }
  });
});

describe('materials edit, review: absent records and thin sectors', () => {
  it('an empty materials sector: nothing to patch and nothing to prove an append on', () => {
    const empty = sectorOf(seller, []);
    const report = readMaterialsD2I(empty, gd, { sectorOffset: 0 });
    expect([report.complete, report.records.length, report.declared]).toEqual([true, 0, 0]);
    expect(refusal(() => editMaterialsD2I(empty, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 0, to: 1 }], appends: [] })))
      .toBe(ErrorCode.MATERIAL_NOT_FOUND);
    expect(refusal(() => editMaterialsD2I(empty, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'gpv', family: 'simple', quantity: 1 }] })))
      .toBe(ErrorCode.LAYOUT_UNVERIFIED);
    expect(refusal(() => editMaterialsD2I(empty, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'pk2', family: 'complex', quantity: 1, guid: 7, ilvl: 1 }] })))
      .toBe(ErrorCode.LAYOUT_UNVERIFIED);
  });

  it('a single-family sector refuses an append of the other family', () => {
    const report = readMaterialsD2I(seller, gd, { sectorOffset: 0 });
    const simpleOnly = sectorOf(seller, report.records.filter(r => r.family === 'simple'));
    const complexOnly = sectorOf(seller, report.records.filter(r => r.family === 'complex'));
    expect(refusal(() => editMaterialsD2I(simpleOnly, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'pk2', family: 'complex', quantity: 1, guid: 7, ilvl: 1 }] })))
      .toBe(ErrorCode.LAYOUT_UNVERIFIED);
    expect(refusal(() => editMaterialsD2I(complexOnly, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'gpy', family: 'simple', quantity: 1 }] })))
      .toBe(ErrorCode.LAYOUT_UNVERIFIED);
    // Each family still appends where it is proven.
    expect(editMaterialsD2I(simpleOnly, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'gpy', family: 'simple', quantity: 1 }] }).after.records.length)
      .toBe(report.records.filter(r => r.family === 'simple').length + 1);
  });

  it('a zero-quantity record is patched in place and never duplicated by an append', () => {
    const glb = readMaterialsD2I(seller, gd, { sectorOffset: 0 }).records.find(r => r.code === 'glb')!;
    expect(glb.quantity).toBe(0);
    expect(refusal(() => editMaterialsD2I(seller, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'glb', family: 'simple', quantity: 1 }] })))
      .toBe(ErrorCode.MATERIAL_ALREADY_PRESENT);
    const { newBuffer } = editMaterialsD2I(seller, gd, { sectorOffset: 0, patches: [{ code: 'glb', from: 0, to: 3 }], appends: [] });
    expect(newBuffer.length).toBe(seller.length);
    expect(readMaterialsD2I(newBuffer, gd, { sectorOffset: 0 }).records.filter(r => r.code === 'glb').map(r => r.quantity)).toEqual([3]);
  });
});

describe('materials edit, review: what the encoder proof does not cover (documented gap, P3)', () => {
  /** Every simple record of the seller with flag bit 10 set, as the public fixture's potions carry it. */
  function simpleRecordsWithBit10(): Uint8Array {
    const buf = new Uint8Array(seller);
    for (const r of readMaterialsD2I(buf, gd, { sectorOffset: 0 }).records) if (r.family === 'simple') buf[r.recordStart + 1] |= 1 << 2;
    return buf;
  }

  it('the proof passes although no simple record of the sector has the flags a new record gets', () => {
    const buf = simpleRecordsWithBit10();
    const report = readMaterialsD2I(buf, gd, { sectorOffset: 0 });
    expect(report.records.every(r => r.layoutOk)).toBe(true);
    expect(report.records.filter(r => r.family === 'simple').every(r => r.flags === (MATERIAL_SIMPLE_FLAGS | (1 << 10)))).toBe(true);
    expect(materialEncodingVerified(buf, gd, report, 'simple')).toBe(true);
    const appended = editMaterialsD2I(buf, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'gpy', family: 'simple', quantity: 1 }] })
      .after.records.at(-1)!;
    expect(appended.flags).toBe(MATERIAL_SIMPLE_FLAGS);
  });

  it.fails('an append is refused (or copies the flags) when no same-family record of the sector has the flags the encoder writes', () => {
    const buf = simpleRecordsWithBit10();
    const result = editMaterialsD2I(buf, gd, { sectorOffset: 0, patches: [], appends: [{ code: 'gpy', family: 'simple', quantity: 1 }] });
    const sameFamilyFlags = new Set(result.before.records.filter(r => r.family === 'simple').map(r => r.flags));
    expect(sameFamilyFlags.has(result.after.records.at(-1)!.flags)).toBe(true);
  });
});
