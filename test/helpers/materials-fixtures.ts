/**
 * Builder of the synthetic single-sector materials fixtures `test/fixtures/MaterialsTabSeller.d2i`
 * and `test/fixtures/MaterialsTabBuyer.d2i` (0.4.0).
 *
 * A realm materials tab file is ONE `.d2i` sector of type 1 at offset 0. These fixtures have that
 * shape and are made only from the public fixture's materials sector (`SharedStashComplete.d2i`,
 * sector @1780, 830 bytes, 56 records), never from anyone's real save:
 *
 * 1. copy the sector's 64-byte header plus the 4-byte `JM` list header;
 * 2. copy the raw bytes of the chosen records, in the given order;
 * 3. fix the record count and `sectorSize`;
 * 4. set the quantities with `editMaterialsD2I` (patches) and add the codes the source does not
 *    have with `editMaterialsD2I` appends, whose encoder is first proven on the sector's records
 *    of the same family (runes, the zero-quantity `glb`, the potion `rvl`).
 *
 * Seller: r01 = 5, r10 = 3, pk1 = 3, tes = 2, ua1 = 1, gpv = 4 (appended), plus the foreign
 * records rvl (99) and glb (0).
 * Buyer: r01 = 0 (record present), r10 = 98 (one below the cap), tes = 1, rvl (99), glb (0);
 * pk1 and gpv are absent, so a withdrawal of either needs a new record of each family.
 *
 * The committed fixtures must equal this build byte for byte (`materials-d2i.test.ts`).
 */

import type { GameData } from '../../src/game-data/game-data.js';
import {
  readMaterialsD2I,
  editMaterialsD2I,
  type MaterialPatch,
  type MaterialAppend,
} from '../../src/operations/materials-d2i.js';
import {
  D2I_SECTOR_SIZE_OFFSET,
  D2I_LIST_COUNT_OFFSET,
  D2I_FIRST_ITEM_OFFSET,
  writeU16,
  writeU32,
} from '../../src/operations/verify-diff.js';

/** Source of the fixtures: the materials sector of the public synthetic stash. */
export const MATERIALS_SOURCE_FILE = 'SharedStashComplete.d2i';
/** Offset of the type-1 sector in `MATERIALS_SOURCE_FILE`. */
export const MATERIALS_SOURCE_SECTOR = 1780;
/** Size of that sector. */
export const MATERIALS_SOURCE_SECTOR_SIZE = 830;

export const MATERIALS_SELLER_FIXTURE = 'MaterialsTabSeller.d2i';
export const MATERIALS_BUYER_FIXTURE = 'MaterialsTabBuyer.d2i';

/** One record of a fixture: code and the quantity it must end up with. */
export interface MaterialsFixtureRecord {
  code: string;
  quantity: number;
}

/** Records copied from the source, in list order. */
export const SELLER_RECORDS: MaterialsFixtureRecord[] = [
  { code: 'rvl', quantity: 99 },
  { code: 'glb', quantity: 0 },
  { code: 'r01', quantity: 5 },
  { code: 'r10', quantity: 3 },
  { code: 'pk1', quantity: 3 },
  { code: 'tes', quantity: 2 },
  { code: 'ua1', quantity: 1 },
];
/** Records appended with the encoder (absent from the source). */
export const SELLER_APPENDS: MaterialAppend[] = [{ code: 'gpv', family: 'simple', quantity: 4 }];

export const BUYER_RECORDS: MaterialsFixtureRecord[] = [
  { code: 'rvl', quantity: 99 },
  { code: 'glb', quantity: 0 },
  { code: 'r01', quantity: 0 },
  { code: 'r10', quantity: 98 },
  { code: 'tes', quantity: 1 },
];

/**
 * Cut the chosen records out of a materials sector into a new single-sector file (offset 0) with
 * the source quantities. Every byte comes from the source except the count and `sectorSize`.
 */
export function extractMaterialsSector(
  source: Uint8Array,
  gd: GameData,
  sectorOffset: number,
  codes: string[],
): Uint8Array {
  const report = readMaterialsD2I(source, gd, { sectorOffset });
  if (!report.complete) throw new Error('source materials sector is not complete');
  const byCode = new Map(report.records.map(r => [r.code, r]));
  const parts = codes.map(code => {
    const r = byCode.get(code);
    if (!r) throw new Error(`source materials sector has no ${code}`);
    return source.subarray(r.recordStart, r.recordEnd);
  });
  const size = D2I_FIRST_ITEM_OFFSET + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  out.set(source.subarray(sectorOffset, sectorOffset + D2I_FIRST_ITEM_OFFSET), 0);
  let at = D2I_FIRST_ITEM_OFFSET;
  for (const p of parts) { out.set(p, at); at += p.length; }
  writeU16(out, D2I_LIST_COUNT_OFFSET, parts.length);
  writeU32(out, D2I_SECTOR_SIZE_OFFSET, size);
  return out;
}

function buildOne(source: Uint8Array, gd: GameData, records: MaterialsFixtureRecord[], appends: MaterialAppend[]): Uint8Array {
  let buffer = extractMaterialsSector(source, gd, MATERIALS_SOURCE_SECTOR, records.map(r => r.code));
  const current = new Map(readMaterialsD2I(buffer, gd, { sectorOffset: 0 }).records.map(r => [r.code, r.quantity]));
  const patches: MaterialPatch[] = records
    .filter(r => current.get(r.code) !== r.quantity)
    .map(r => ({ code: r.code, from: current.get(r.code)!, to: r.quantity }));
  if (patches.length > 0) buffer = editMaterialsD2I(buffer, gd, { sectorOffset: 0, patches, appends: [] }).newBuffer;
  if (appends.length > 0) buffer = editMaterialsD2I(buffer, gd, { sectorOffset: 0, patches: [], appends }).newBuffer;
  return buffer;
}

/** Build both fixtures in memory from the public fixture's bytes. Deterministic. */
export function buildMaterialsFixtures(source: Uint8Array, gd: GameData): { seller: Uint8Array; buyer: Uint8Array } {
  return {
    seller: buildOne(source, gd, SELLER_RECORDS, SELLER_APPENDS),
    buyer: buildOne(source, gd, BUYER_RECORDS, []),
  };
}
