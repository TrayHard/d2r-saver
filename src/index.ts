/**
 * d2r-saver — Blizzless D2R v105 save file reader/writer library.
 *
 * @packageDocumentation
 */

import { GameData } from './game-data/game-data.js';
import type { RawGameData } from './game-data/types.js';
import type { LocaleArray } from './game-data/loader.js';
import { detectFormat, type DetectedFormat } from './formats/detect.js';
import { readD2S, type D2SReadResult, type D2SCharacterProfile } from './formats/d2s-reader.js';
import { readD2I, type D2IReadResult, type D2IStashPage } from './formats/d2i-reader.js';
import type { BinaryParsedItem } from './formats/item-parser.js';
import { writeD2S, type WriteD2SOptions } from './formats/d2s-writer.js';
import {
  writeStash,
  buildStashWritePages,
  patchStashPage,
  type WriteStashPage,
} from './formats/d2i-writer.js';
import {
  extractItemD2S,
  extractItemD2I,
  type ExtractResult,
} from './operations/extract-item.js';
import {
  insertItemD2S,
  insertItemD2I,
  type InsertResult,
  type InsertD2IResult,
  type InsertD2STarget,
} from './operations/insert-item.js';
import { readSave, type ReadSaveResult } from './operations/read-save.js';
import {
  serializeItem,
  deserializeItem,
  type DeserializedItem,
} from './items/item-serializer.js';
import { getItemIconPath, getItemIconSD } from './items/item-icon.js';
import { toTradeDTO, type TradeItemDTO } from './items/item-dto.js';
import { canPlaceItem, findFreeSlot, findFreeSlotInStash, type PlacementItem } from './inventory/placement.js';
import { StashGrid } from './inventory/grid.js';
import { D2RSaverError, ErrorCode } from './types/errors.js';
import {
  walkD2I,
  walkItemList,
  type D2IParseReport,
  type WalkItemListOptions,
  type WalkResult,
} from './formats/item-walker.js';
import { buildRawGrid } from './inventory/raw-grid.js';
import type { GridSize } from './inventory/dimensions.js';
import {
  extractInPlaceD2I,
  insertInPlaceD2I,
  type ExtractInPlaceD2IRef,
  type ExtractInPlaceD2IOptions,
  type ExtractInPlaceD2IResult,
  type InsertInPlaceD2ITarget,
  type InsertInPlaceD2IItem,
  type InsertInPlaceD2IResult,
} from './operations/inplace-d2i.js';
import {
  readMaterialsD2I,
  editMaterialsD2I,
  encodeMaterialRecord,
  type ReadMaterialsD2IOptions,
  type MaterialsSectorReport,
  type EncodeMaterialRecordInput,
  type EditMaterialsD2IEdit,
  type EditMaterialsD2IOptions,
  type EditMaterialsD2IResult,
} from './operations/materials-d2i.js';

// ─── Re-exports ─────────────────────────────────────────────────

export { GameData } from './game-data/game-data.js';
export { D2RSaverError, ErrorCode } from './types/errors.js';
export type { DetectedFormat } from './formats/detect.js';
export type { D2SReadResult, D2SCharacterProfile, D2SItemLists } from './formats/d2s-reader.js';
export type { D2IReadResult, D2IStashPage, D2ISectorSummary, ExtendedPageType } from './formats/d2i-reader.js';
export type {
  BinaryParsedItem,
  ItemHandler,
  ByteRange,
  ItemListReport,
  ParsedItemTrace,
  ParserOptions,
  ParseItemListOptions,
} from './formats/item-parser.js';
export type { ExtractResult } from './operations/extract-item.js';
export type { InsertResult, InsertD2IResult, InsertD2STarget } from './operations/insert-item.js';
export type { ReadSaveResult, ReadSaveD2SResult, ReadSaveD2IResult } from './operations/read-save.js';
export type { DeserializedItem } from './items/item-serializer.js';
export type { TradeItemDTO, ItemQuality } from './items/item-dto.js';
export type { PlacementItem } from './inventory/placement.js';
export { StashGrid } from './inventory/grid.js';
export type { WriteD2SOptions } from './formats/d2s-writer.js';
export type { WriteStashPage } from './formats/d2i-writer.js';

// ─── In-place editing building blocks (0.3.0) ───────────────────
// Byte-exact list walking, item heads and position patching. These never re-encode an item:
// the site-side gates and the in-place operations are built on them.
export {
  walkItemList,
  walkD2I,
  readItemHead,
  readItemPosition,
  patchItemPosition,
  zeroItemPosition,
  ITEM_POSITION_BIT,
  ITEM_POSITION_BITS,
  ITEM_BASE_BIT,
  ITEM_COL_BIT,
  ITEM_ROW_BIT,
} from './formats/item-walker.js';
export type {
  ItemHead,
  ItemPosition,
  WalkedItem,
  WalkResult,
  WalkItemListOptions,
  D2IWalkedSector,
  D2IParseReport,
} from './formats/item-walker.js';
export { buildRawGrid } from './inventory/raw-grid.js';
export type { GridSize } from './inventory/dimensions.js';

// ─── In-place operations on .d2i (0.3.0) ────────────────────────
// Cut/paste raw item bytes in a shared-stash sector; the item writer is never involved.
// `verifyExactDiff` proves that a result differs from its source by exactly the declared edit.
export {
  extractInPlaceD2I,
  insertInPlaceD2I,
  fixD2ISectorSize,
} from './operations/inplace-d2i.js';
export type {
  ExtractInPlaceD2IRef,
  ExtractInPlaceD2IOptions,
  ExtractedInPlaceItem,
  ExtractInPlaceD2IResult,
  InsertInPlaceD2ITarget,
  InsertInPlaceD2IItem,
  InsertedInPlaceItem,
  InsertInPlaceD2IResult,
} from './operations/inplace-d2i.js';
export {
  verifyExactDiff,
  assertExactDiff,
  readD2ISectorChain,
  findD2ISector,
  findMaterialsD2ISector,
  MAX_REPORTED_MISMATCHES,
  D2I_SECTOR_HEADER_SIZE,
  D2I_SECTOR_SIZE_OFFSET,
  D2I_SECTOR_TYPE_OFFSET,
  D2I_LIST_COUNT_OFFSET,
  D2I_FIRST_ITEM_OFFSET,
} from './operations/verify-diff.js';
export type {
  DiffSpec,
  DiffInsert,
  DiffMaterialPatch,
  MaterialsDiffSpec,
  DiffMismatch,
  ExactDiffResult,
  D2ISectorHeader,
} from './operations/verify-diff.js';

// ─── Materials tab (.d2i sector type 1) (0.4.0) ─────────────────
// Quantity records: read every record (zero quantities included), encode a record
// deterministically, and patch quantities / append records in place with a self-proven diff.
export {
  readMaterialsD2I,
  editMaterialsD2I,
  encodeMaterialRecord,
  materialRecordEncodeInput,
  materialEncodingVerified,
  MATERIAL_SIMPLE_FLAGS,
  MATERIAL_COMPLEX_FLAGS,
  MATERIAL_ITEM_VERSION,
  MATERIAL_STORAGE,
  MATERIAL_QUANTITY_FIELD_MAX,
  MATERIAL_DEFAULT_MAX_QUANTITY,
} from './operations/materials-d2i.js';
export type {
  MaterialFamily,
  MaterialLayoutIssue,
  MaterialRecord,
  MaterialsSectorReport,
  ReadMaterialsD2IOptions,
  EncodeMaterialRecordInput,
  MaterialPatch,
  MaterialAppend,
  EditMaterialsD2IEdit,
  EditMaterialsD2IOptions,
  EditMaterialsD2IResult,
} from './operations/materials-d2i.js';

// ─── D2RSaver facade ────────────────────────────────────────────

/** Options for `D2RSaver.create()`. */
export interface D2RSaverCreateOptions {
  /** Path to data.json. */
  dataPath: string;
  /** Path to strings.json. */
  stringsPath: string;
}

/**
 * Main facade for all d2r-saver operations.
 *
 * Holds a `GameData` instance and delegates to internal modules.
 *
 * @example
 * ```ts
 * const saver = await D2RSaver.create({ dataPath: './data/data.json', stringsPath: './data/strings.json' });
 * const result = saver.readD2S(buffer);
 * ```
 */
export class D2RSaver {
  /** Internal game data reference. */
  readonly gd: GameData;

  private constructor(gd: GameData) {
    this.gd = gd;
  }

  // ── Factory methods ─────────────────────────────────────────

  /**
   * Create a D2RSaver by loading game data from file paths.
   *
   * @param options  Paths to data.json and strings.json.
   */
  static async create(options: D2RSaverCreateOptions): Promise<D2RSaver> {
    const gd = await GameData.fromFile(options.dataPath, options.stringsPath);
    return new D2RSaver(gd);
  }

  /**
   * Create a D2RSaver from pre-parsed JSON objects.
   *
   * @param rawData   Parsed data.json content.
   * @param locale    Parsed strings.json content.
   */
  static fromData(rawData: RawGameData, locale: LocaleArray): D2RSaver {
    const gd = GameData.fromRaw(rawData, locale);
    return new D2RSaver(gd);
  }

  // ── Format detection ────────────────────────────────────────

  /**
   * Detect file format.
   *
   * @throws {D2RSaverError} INVALID_FORMAT if file is unrecognized.
   */
  detectFormat(buffer: Uint8Array): DetectedFormat {
    const result = detectFormat(buffer);
    if (!result) {
      throw new D2RSaverError(ErrorCode.INVALID_FORMAT, 'File is not a valid Blizzless v105 d2s or d2i.');
    }
    return result;
  }

  // ── Reading ─────────────────────────────────────────────────

  /** Read a .d2s character save file. */
  readD2S(buffer: Uint8Array): D2SReadResult {
    return readD2S(buffer, this.gd);
  }

  /** Read a .d2i shared stash file. */
  readD2I(buffer: Uint8Array): D2IReadResult {
    return readD2I(buffer, this.gd);
  }

  /** Auto-detect format and read a save file. */
  readSave(buffer: Uint8Array): ReadSaveResult {
    return readSave(buffer, this.gd);
  }

  // ── In-place editing: walking ───────────────────────────────

  /**
   * Walk every sector of a .d2i shared stash and record byte-exact item ranges (0.3.0).
   * Nothing is re-encoded; see `walkD2I` for the report shape.
   */
  walkD2I(buffer: Uint8Array): D2IParseReport {
    return walkD2I(buffer, this.gd);
  }

  /** Walk one `JM` item list that starts at absolute byte `headerOffset` (0.3.0). */
  walkItemList(buffer: Uint8Array, headerOffset: number, options?: WalkItemListOptions): WalkResult {
    return walkItemList(buffer, headerOffset, this.gd, options);
  }

  /**
   * Occupancy grid of a walked stash sector from the items' position bits (0.3.0).
   * @throws {D2RSaverError} UNKNOWN_BASE, INVALID_PAGE — see `buildRawGrid`.
   */
  buildRawGrid(walk: WalkResult, size?: GridSize): StashGrid {
    return buildRawGrid(walk, this.gd, size);
  }

  // ── In-place editing: operations on .d2i ────────────────────

  /**
   * Cut items (with their socketed children) out of a normal stash sector without rebuilding
   * the file (0.3.0). Only the removed bytes, the sector's item count and its `sectorSize`
   * change; the result is self-verified with `verifyExactDiff`.
   * @throws {D2RSaverError} LIST_TRUNCATED, INVALID_PAGE, ITEM_NOT_FOUND, … — see `extractInPlaceD2I`.
   */
  extractInPlaceD2I(
    buffer: Uint8Array,
    ref: ExtractInPlaceD2IRef,
    opts?: ExtractInPlaceD2IOptions,
  ): ExtractInPlaceD2IResult {
    return extractInPlaceD2I(buffer, ref, this.gd, opts);
  }

  /**
   * Paste raw item bytes into a normal stash sector at explicit free cells without rebuilding
   * the file (0.3.0). The target list must be complete; cells are checked on the raw grid.
   * @throws {D2RSaverError} LIST_TRUNCATED, INVALID_PAGE, NO_FREE_SLOT, UNKNOWN_BASE, … — see `insertInPlaceD2I`.
   */
  insertInPlaceD2I(
    buffer: Uint8Array,
    target: InsertInPlaceD2ITarget,
    items: InsertInPlaceD2IItem[],
  ): InsertInPlaceD2IResult {
    return insertInPlaceD2I(buffer, target, items, this.gd);
  }

  // ── Materials tab (.d2i sector type 1) ──────────────────────

  /**
   * Read a materials (type 1) sector record by record, zero-quantity records included (0.4.0).
   * Each record reports both copies of its quantity, the quantity flag's bit offset and whether
   * its layout allows an in-place edit.
   * @throws {D2RSaverError} INVALID_PAGE, INVALID_FORMAT — see `readMaterialsD2I`.
   */
  readMaterialsD2I(buffer: Uint8Array, options: ReadMaterialsD2IOptions): MaterialsSectorReport {
    return readMaterialsD2I(buffer, this.gd, options);
  }

  /**
   * Patch quantities of existing materials records and/or append records for absent codes
   * (0.4.0). Only `col`, `row` and the 8-bit quantity of a patched record change; appends go to
   * the end of the sector. The result is self-verified with `verifyExactDiff`.
   * @throws {D2RSaverError} LIST_TRUNCATED, MATERIAL_LAYOUT, MATERIAL_STALE, … — see `editMaterialsD2I`.
   */
  editMaterialsD2I(
    buffer: Uint8Array,
    edit: EditMaterialsD2IEdit,
    options?: EditMaterialsD2IOptions,
  ): EditMaterialsD2IResult {
    return editMaterialsD2I(buffer, this.gd, edit, options);
  }

  /**
   * Build the bytes of one materials record deterministically (0.4.0).
   * @throws {D2RSaverError} UNKNOWN_BASE, INVALID_ARGUMENT — see `encodeMaterialRecord`.
   */
  encodeMaterialRecord(input: EncodeMaterialRecordInput): Uint8Array {
    return encodeMaterialRecord(this.gd, input);
  }

  // ── Item serialization ──────────────────────────────────────

  /** Serialize an item to a portable token (`d2r1:<base64>`). */
  serializeItem(item: BinaryParsedItem, allItems: Record<number | string, BinaryParsedItem>): string {
    return serializeItem(item, allItems, this.gd);
  }

  /** Deserialize an item from a portable token. */
  deserializeItem(token: string): DeserializedItem {
    return deserializeItem(token, this.gd);
  }

  // ── Placement helpers ───────────────────────────────────────

  /** Get the grid size of an item in cells. */
  getItemSize(item: BinaryParsedItem): { width: number; height: number } {
    const base = this.gd.items[item.base];
    return {
      width: base?.invwidth ?? 1,
      height: base?.invheight ?? 1,
    };
  }

  /** Check if an item can be placed at a position on a grid. */
  canPlaceItem(grid: StashGrid, x: number, y: number, item: PlacementItem): boolean {
    return canPlaceItem(grid, x, y, item, this.gd);
  }

  /** Find the first free slot for an item on a grid. */
  findFreeSlot(grid: StashGrid, item: PlacementItem): { x: number; y: number } | null {
    return findFreeSlot(grid, item, this.gd);
  }

  /** Find the first free slot for an item across multiple stash grids. */
  findFreeSlotInStash(grids: StashGrid[], item: PlacementItem): { pageIndex: number; x: number; y: number } | null {
    return findFreeSlotInStash(grids, item, this.gd);
  }

  // ── Item operations ─────────────────────────────────────────

  /**
   * Extract an item from a .d2s save file.
   *
   * @param buffer  Original file buffer.
   * @param itemId  Item ID to extract.
   */
  extractItemD2S(buffer: Uint8Array, itemId: number): ExtractResult {
    return extractItemD2S(buffer, itemId, this.gd);
  }

  /**
   * Extract an item from a .d2i shared stash.
   *
   * @param buffer     Original file buffer.
   * @param pageIndex  Page index.
   * @param x          X position in grid.
   * @param y          Y position in grid.
   */
  extractItemD2I(buffer: Uint8Array, pageIndex: number, x: number, y: number): ExtractResult {
    return extractItemD2I(buffer, pageIndex, x, y, this.gd);
  }

  /**
   * Insert an item into a .d2s save file.
   *
   * @param buffer          Original file buffer.
   * @param item            Item to insert.
   * @param allItemsForItem All related items (including socketed sub-items).
   * @param target          Target container: 'stash' | 'inventory' | 'cube'.
   * @param position        Optional specific position. Auto-finds if omitted.
   */
  insertItemD2S(
    buffer: Uint8Array,
    item: BinaryParsedItem,
    allItemsForItem: Record<number | string, BinaryParsedItem>,
    target: InsertD2STarget,
    position?: { x: number; y: number },
  ): InsertResult {
    return insertItemD2S(buffer, item, allItemsForItem, target, this.gd, position);
  }

  /**
   * Insert an item into a .d2i shared stash.
   *
   * @param buffer          Original file buffer.
   * @param item            Item to insert.
   * @param allItemsForItem All related items (including socketed sub-items).
   * @param target          Optional specific target page and position.
   */
  insertItemD2I(
    buffer: Uint8Array,
    item: BinaryParsedItem,
    allItemsForItem: Record<number | string, BinaryParsedItem>,
    target?: { pageIndex: number; x: number; y: number },
  ): InsertD2IResult {
    return insertItemD2I(buffer, item, allItemsForItem, this.gd, target);
  }

  // ── Writing ─────────────────────────────────────────────────

  /**
   * Re-serialise a complete .d2s from a (possibly edited) profile + items.
   * Lossless: the parsed profile must carry rawHeader/attributes (from readD2S);
   * apply edits by mutating `profile.attributes` (raw values) before calling.
   */
  writeD2S(
    profile: D2SCharacterProfile,
    items: Record<number | string, BinaryParsedItem>,
    name?: string,
  ): Uint8Array {
    return writeD2S({ profile, items, gd: this.gd, name });
  }

  /** Convert parsed stash pages back to writable pages (for writeStash). */
  buildStashWritePages(
    pages: D2IStashPage[],
    allItems: Record<number | string, BinaryParsedItem>,
  ): WriteStashPage[] {
    return buildStashWritePages(pages, allItems, this.gd);
  }

  /** Re-serialise a complete .d2i shared stash from writable pages. */
  writeStash(
    pages: WriteStashPage[],
    allItems: Record<number | string, BinaryParsedItem>,
  ): Uint8Array {
    return writeStash(pages, allItems, this.gd);
  }

  /** Patch a single .d2i sector (e.g. to change its gold) by raw sector index. */
  patchStashPage(
    buffer: Uint8Array,
    pageIndex: number,
    newPage: WriteStashPage,
    allItems: Record<number | string, BinaryParsedItem>,
  ): Uint8Array {
    return patchStashPage(buffer, pageIndex, newPage, allItems, this.gd);
  }

  // ── Icons ───────────────────────────────────────────────────

  /** Get the HD icon path key for an item. */
  getItemIconPath(item: BinaryParsedItem): string | null {
    return getItemIconPath(item, this.gd);
  }

  /** Get the SD (invfile) icon name for an item. */
  getItemIconSD(item: BinaryParsedItem): string | null {
    return getItemIconSD(item, this.gd);
  }

  // ── Trade DTO ───────────────────────────────────────────────

  /** Convert an item to a TradeItemDTO for the backend. */
  toTradeDTO(
    item: BinaryParsedItem,
    allItems: Record<number | string, BinaryParsedItem>,
  ): TradeItemDTO {
    return toTradeDTO(item, allItems, this.gd);
  }
}

export { readD2SDemonSection, type D2SDemonSectionReport, type D2SDemonRecord, type D2SDemonStat } from './formats/d2s-demon-reader.js';
export type { D2SParseCoverage } from './formats/d2s-coverage.js';
