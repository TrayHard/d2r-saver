/**
 * Builder of the synthetic fixture `test/fixtures/SharedStashComplete.d2i`.
 *
 * Why it exists: every non-empty normal (type 0) sector of the real fixtures stops parsing on a
 * Blizzless-specific stat code after 0–7 items, so none of them is a valid target for the
 * in-place INSERT path (which requires a fully understood list). This builder makes one such
 * sector out of the items the parser CAN walk, using only the public in-place API:
 *
 * 1. `extractInPlaceD2I(..., { requireCompleteList: false })` cuts the walkable prefix of
 *    three truncated sectors: the first item of sector @0 (`cm1`) and of sector @989 (`ci2`)
 *    of `SharedStashSoftCoreV2V105.d2i`, and the seven items of sector @1210 of
 *    `SharedStashSoftCoreV2V105_.d2i` (two amulets, five rings).
 * 2. `insertInPlaceD2I` pastes all nine into the first empty sector of the (now shrunk)
 *    `SharedStashSoftCoreV2V105.d2i`, each at the cell it originally occupied (none overlap).
 *
 * The result is `SharedStashSoftCoreV2V105.d2i` with its two walkable items moved out of the
 * truncated tabs into a formerly empty tab, plus seven items from the other file; the truncated
 * tabs, the two remaining empty tabs, the extended tab and the metadata sector are untouched
 * except for the moved bytes, the counters and the sector sizes. The complete-sector walk is
 * self-checked: the walker both builds the tab and verifies it (9/9, `complete: true`).
 *
 * The committed fixture must equal this build byte for byte (`shared-stash-complete.test.ts`).
 */

import type { GameData } from '../../src/game-data/game-data.js';
import { walkD2I } from '../../src/formats/item-walker.js';
import { extractInPlaceD2I, insertInPlaceD2I, type InsertInPlaceD2IItem } from '../../src/operations/inplace-d2i.js';

/** Name of the synthetic fixture. */
export const SHARED_STASH_COMPLETE = 'SharedStashComplete.d2i';

/** Provenance of one item in the synthetic complete sector. */
export interface PlacedItem {
  /** Source fixture file name. */
  source: string;
  /** Sector offset in the source file. */
  sourceSector: number;
  /** Top-level index in the source sector list. */
  sourceIndex: number;
  base: string | null;
  col: number;
  row: number;
  /** Raw bytes (position bits zeroed), as returned by `extractInPlaceD2I`. */
  bytes: Uint8Array;
}

/** Result of `buildSharedStashComplete`. */
export interface SharedStashCompleteBuild {
  buffer: Uint8Array;
  /** Byte offset of the complete sector in `buffer`. */
  sectorOffset: number;
  /** Items in the complete sector, in list order. */
  placed: PlacedItem[];
  /** The two source files after their walkable items were cut out (for tests that need them). */
  shrunkPlain: Uint8Array;
  shrunkUnderscore: Uint8Array;
}

/**
 * Build the synthetic fixture in memory from the two real fixtures.
 *
 * @param gd          GameData.
 * @param plain       Bytes of `SharedStashSoftCoreV2V105.d2i`.
 * @param underscore  Bytes of `SharedStashSoftCoreV2V105_.d2i`.
 */
export function buildSharedStashComplete(gd: GameData, plain: Uint8Array, underscore: Uint8Array): SharedStashCompleteBuild {
  const placed: PlacedItem[] = [];

  // 1a. SharedStashSoftCoreV2V105.d2i: the first (only walkable) item of sector @0 and of @989.
  let shrunkPlain = plain;
  for (const sourceSector of [0, 989]) {
    // Sector offsets shift as earlier sectors shrink; re-walk and address by original order.
    const chain = walkD2I(shrunkPlain, gd).sectors;
    const sector = chain[sourceSector === 0 ? 0 : 1];
    const { newBuffer, removed } = extractInPlaceD2I(
      shrunkPlain,
      { sectorOffset: sector.offset, indexes: [0] },
      gd,
      { requireCompleteList: false },
    );
    const [item] = removed;
    placed.push({
      source: 'SharedStashSoftCoreV2V105.d2i',
      sourceSector,
      sourceIndex: item.index,
      base: item.head.base,
      col: item.head.col,
      row: item.head.row,
      bytes: item.bytes,
    });
    shrunkPlain = newBuffer;
  }

  // 1b. SharedStashSoftCoreV2V105_.d2i: the seven walkable items of sector @1210 in one cut.
  const underscoreSector = walkD2I(underscore, gd).sectors[1];
  const cutSeven = extractInPlaceD2I(
    underscore,
    { sectorOffset: underscoreSector.offset, indexes: underscoreSector.walk!.entries.map(e => e.index) },
    gd,
    { requireCompleteList: false },
  );
  for (const item of cutSeven.removed) {
    placed.push({
      source: 'SharedStashSoftCoreV2V105_.d2i',
      sourceSector: underscoreSector.offset,
      sourceIndex: item.index,
      base: item.head.base,
      col: item.head.col,
      row: item.head.row,
      bytes: item.bytes,
    });
  }

  // 2. Paste all nine into the first empty normal sector of the shrunk plain file, at the
  //    cells they came from. The raw grid inside insertInPlaceD2I gates every cell.
  const target = walkD2I(shrunkPlain, gd).sectors.find(s => s.type === 0 && s.walk!.report.declared === 0);
  if (!target) throw new Error('no empty normal sector to build the complete tab in');
  const items: InsertInPlaceD2IItem[] = placed.map(p => ({ bytes: p.bytes, col: p.col, row: p.row }));
  const { newBuffer } = insertInPlaceD2I(shrunkPlain, { sectorOffset: target.offset }, items, gd);

  return {
    buffer: newBuffer,
    sectorOffset: target.offset,
    placed,
    shrunkPlain,
    shrunkUnderscore: cutSeven.newBuffer,
  };
}
