/**
 * Review additions (0.4.0): layout conditions that no other test pins down. A record whose `loc`
 * is not 0/4, or a complex record whose quality is not normal but whose bit length is otherwise
 * identical, must make the whole sector refuse edits (MATERIAL_LAYOUT).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readMaterialsD2I, editMaterialsD2I } from '../src/operations/materials-d2i.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const ROOT = resolve(import.meta.dirname!, '..');
let gd: GameData;
let seller: Uint8Array;

beforeAll(() => {
  gd = GameData.fromRaw(
    JSON.parse(readFileSync(resolve(ROOT, 'data', 'data.json'), 'utf-8')),
    JSON.parse(readFileSync(resolve(ROOT, 'data', 'strings.json'), 'utf-8')),
  );
  seller = new Uint8Array(readFileSync(resolve(ROOT, 'test', 'fixtures', 'MaterialsTabSeller.d2i')));
});

function setBits(buf: Uint8Array, b: number, n: number, value: number): void {
  for (let i = 0; i < n; i++) {
    const p = b + i;
    if ((value >> i) & 1) buf[p >> 3] |= 1 << (p & 7);
    else buf[p >> 3] &= ~(1 << (p & 7));
  }
}

function refused(buf: Uint8Array): D2RSaverError {
  try {
    editMaterialsD2I(buf, gd, { sectorOffset: 0, patches: [{ code: 'r01', from: 5, to: 4 }], appends: [] });
  } catch (e) {
    expect(e).toBeInstanceOf(D2RSaverError);
    return e as D2RSaverError;
  }
  throw new Error('edit was not refused');
}

describe('materials layout conditions (review)', () => {
  it('a record with loc outside {0, 4} is reported and blocks every edit', () => {
    for (const loc of [1, 2, 3, 5, 6, 7]) {
      const buf = new Uint8Array(seller);
      const rvl = readMaterialsD2I(buf, gd, { sectorOffset: 0 }).records.find(r => r.code === 'rvl')!;
      setBits(buf, rvl.recordStart * 8 + 35, 3, loc);
      const after = readMaterialsD2I(buf, gd, { sectorOffset: 0 }).records.find(r => r.code === 'rvl')!;
      expect(after.layoutOk).toBe(false);
      expect(after.layoutIssue).toBe('loc');
      expect(refused(buf).code).toBe(ErrorCode.MATERIAL_LAYOUT);
    }
  });

  it('a complex record with raw quality 0 (same bit length as normal) is reported and blocks every edit', () => {
    const buf = new Uint8Array(seller);
    const report = readMaterialsD2I(buf, gd, { sectorOffset: 0 });
    const tes = report.records.find(r => r.code === 'tes')!;
    // quality sits right after sockets (3), guid (32) and ilvl (7): record bit flagBit - 9 - 4 - 4.
    const qualityBit = tes.quantityFlagBit! - 9 - 4 - 4;
    setBits(buf, tes.recordStart * 8 + qualityBit, 4, 0);
    const after = readMaterialsD2I(buf, gd, { sectorOffset: 0 }).records.find(r => r.code === 'tes')!;
    expect(after.recordEnd - after.recordStart).toBe(tes.recordEnd - tes.recordStart);
    expect(after.quantity).toBe(tes.quantity);
    expect(after.layoutOk).toBe(false);
    expect(after.layoutIssue).toBe('quality');
    expect(refused(buf).code).toBe(ErrorCode.MATERIAL_LAYOUT);
  });
});
