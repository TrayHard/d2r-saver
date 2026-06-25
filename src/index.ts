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

// ─── Re-exports ─────────────────────────────────────────────────

export { GameData } from './game-data/game-data.js';
export { D2RSaverError, ErrorCode } from './types/errors.js';
export type { DetectedFormat } from './formats/detect.js';
export type { D2SReadResult, D2SCharacterProfile } from './formats/d2s-reader.js';
export type { D2IReadResult, D2IStashPage, ExtendedPageType } from './formats/d2i-reader.js';
export type { BinaryParsedItem, ItemHandler } from './formats/item-parser.js';
export type { ExtractResult } from './operations/extract-item.js';
export type { InsertResult, InsertD2IResult, InsertD2STarget } from './operations/insert-item.js';
export type { ReadSaveResult, ReadSaveD2SResult, ReadSaveD2IResult } from './operations/read-save.js';
export type { DeserializedItem } from './items/item-serializer.js';
export type { TradeItemDTO, ItemQuality } from './items/item-dto.js';
export type { PlacementItem } from './inventory/placement.js';
export { StashGrid } from './inventory/grid.js';
export type { WriteD2SOptions } from './formats/d2s-writer.js';
export type { WriteStashPage } from './formats/d2i-writer.js';

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
