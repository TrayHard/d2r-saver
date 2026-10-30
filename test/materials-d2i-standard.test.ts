/**
 * Standard of Heroes (`std`) in the materials tab: the game stores it as a complex record in a
 * unique form (quality 7, unique id 0xFFF). Its record must read, re-encode, patch and append like
 * any other, and an emptied record stays in the list with quantity 0.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import {
  readMaterialsD2I,
  editMaterialsD2I,
  encodeMaterialRecord,
  materialEncodingVerified,
} from '../src/operations/materials-d2i.js';
import { D2I_LIST_COUNT_OFFSET, D2I_SECTOR_SIZE_OFFSET, readU16, readU32, writeU16, writeU32 } from '../src/operations/verify-diff.js';

const ROOT = resolve(import.meta.dirname!, '..');
/** An emptied record as the game wrote it: quantity 0, guid 2992162800, ilvl 99. */
const GAME_RECORD = '10008000050094cc18e08fb164c7c7fff33f00';
const GAME_RECORD_INPUT = { family: 'complex', code: 'std', quantity: 0, guid: 2992162800, ilvl: 99 } as const;

let gd: GameData;
let buyer: Uint8Array;

beforeAll(() => {
  gd = GameData.fromRaw(
    JSON.parse(readFileSync(resolve(ROOT, 'data', 'data.json'), 'utf-8')),
    JSON.parse(readFileSync(resolve(ROOT, 'data', 'strings.json'), 'utf-8')),
  );
  buyer = new Uint8Array(readFileSync(resolve(ROOT, 'test', 'fixtures', 'MaterialsTabBuyer.d2i')));
});

/** The buyer tab with raw record bytes appended to its list. */
function withRecord(record: Uint8Array): Uint8Array {
  const out = new Uint8Array(buyer.length + record.length);
  out.set(buyer, 0);
  out.set(record, buyer.length);
  writeU16(out, D2I_LIST_COUNT_OFFSET, readU16(buyer, D2I_LIST_COUNT_OFFSET) + 1);
  writeU32(out, D2I_SECTOR_SIZE_OFFSET, readU32(buyer, D2I_SECTOR_SIZE_OFFSET) + record.length);
  return out;
}

const gameRecord = () => new Uint8Array(Buffer.from(GAME_RECORD, 'hex'));
const std = (bytes: Uint8Array) => readMaterialsD2I(bytes, gd, { sectorOffset: 0 }).records.find(r => r.code === 'std')!;

describe('Standard of Heroes record', () => {
  it('the encoder reproduces the bytes the game wrote', () => {
    expect(Buffer.from(encodeMaterialRecord(gd, GAME_RECORD_INPUT)).toString('hex')).toBe(GAME_RECORD);
  });

  it('an emptied record reads as valid and keeps the family encoding proof', () => {
    const tab = withRecord(gameRecord());
    expect(std(tab)).toMatchObject({ family: 'complex', quantity: 0, guid: 2992162800, ilvl: 99, uniqueForm: true, layoutOk: true, layoutIssue: null });
    const report = readMaterialsD2I(tab, gd, { sectorOffset: 0 });
    expect(report.issues).toEqual([]);
    expect(materialEncodingVerified(tab, gd, report, 'complex')).toBe(true);
  });

  it('a withdrawal fills the emptied record and changes only its counter', () => {
    const tab = withRecord(gameRecord());
    const before = std(tab);
    const { newBuffer } = editMaterialsD2I(tab, gd, { sectorOffset: 0, patches: [{ code: 'std', from: 0, to: 3 }], appends: [] });
    expect(std(newBuffer)).toMatchObject({ quantity: 3, positionQuantity: 0, uniqueForm: true, layoutOk: true });
    expect(newBuffer.length).toBe(tab.length);
    const changed = [...newBuffer].flatMap((value, index) => (value === tab[index] ? [] : [index]));
    expect(changed.every(index => index >= before.recordStart && index < before.recordEnd)).toBe(true);
  });

  it('a new record for an absent code is written in the same form, beside other complex records', () => {
    const { newBuffer } = editMaterialsD2I(buyer, gd, { sectorOffset: 0, patches: [],
      appends: [{ code: 'std', family: 'complex', quantity: 2, guid: 1234, ilvl: 99 }] });
    expect(std(newBuffer)).toMatchObject({ quantity: 2, guid: 1234, uniqueForm: true, layoutOk: true });
    const next = editMaterialsD2I(newBuffer, gd, { sectorOffset: 0, patches: [],
      appends: [{ code: 'pk2', family: 'complex', quantity: 1, guid: 5678, ilvl: 1 }] });
    expect(next.after.records.at(-1)).toMatchObject({ code: 'pk2', quantity: 1, uniqueForm: false, layoutOk: true });
  });

  it('other quality or another unique id stays refused, and no other code gets the form', () => {
    const otherId = gameRecord();
    otherId[14] ^= 0x40; // record bit 118, the first bit of the 12-bit unique id
    expect(std(withRecord(otherId))).toMatchObject({ uniqueForm: false, layoutOk: false, layoutIssue: 'quality' });
    expect(() => encodeMaterialRecord(gd, { family: 'complex', code: 'pk1', quantity: 1, guid: 1, ilvl: 1, uniqueForm: true })).toThrow(/no unique form/);
  });
});
