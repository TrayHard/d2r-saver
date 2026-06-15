/**
 * d2r-saver — Blizzless D2R v105 save file reader/writer library.
 *
 * @packageDocumentation
 */
import { GameData } from './game-data/game-data.js';
import type { RawGameData } from './game-data/types.js';
import type { LocaleArray } from './game-data/loader.js';
import { type DetectedFormat } from './formats/detect.js';
import { type D2SReadResult } from './formats/d2s-reader.js';
import { type D2IReadResult } from './formats/d2i-reader.js';
import type { BinaryParsedItem } from './formats/item-parser.js';
import { type ExtractResult } from './operations/extract-item.js';
import { type InsertResult, type InsertD2IResult, type InsertD2STarget } from './operations/insert-item.js';
import { type ReadSaveResult } from './operations/read-save.js';
import { type DeserializedItem } from './items/item-serializer.js';
import { type TradeItemDTO } from './items/item-dto.js';
import { type PlacementItem } from './inventory/placement.js';
import { StashGrid } from './inventory/grid.js';
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
export declare class D2RSaver {
    /** Internal game data reference. */
    readonly gd: GameData;
    private constructor();
    /**
     * Create a D2RSaver by loading game data from file paths.
     *
     * @param options  Paths to data.json and strings.json.
     */
    static create(options: D2RSaverCreateOptions): Promise<D2RSaver>;
    /**
     * Create a D2RSaver from pre-parsed JSON objects.
     *
     * @param rawData   Parsed data.json content.
     * @param locale    Parsed strings.json content.
     */
    static fromData(rawData: RawGameData, locale: LocaleArray): D2RSaver;
    /**
     * Detect file format.
     *
     * @throws {D2RSaverError} INVALID_FORMAT if file is unrecognized.
     */
    detectFormat(buffer: Uint8Array): DetectedFormat;
    /** Read a .d2s character save file. */
    readD2S(buffer: Uint8Array): D2SReadResult;
    /** Read a .d2i shared stash file. */
    readD2I(buffer: Uint8Array): D2IReadResult;
    /** Auto-detect format and read a save file. */
    readSave(buffer: Uint8Array): ReadSaveResult;
    /** Serialize an item to a portable token (`d2r1:<base64>`). */
    serializeItem(item: BinaryParsedItem, allItems: Record<number | string, BinaryParsedItem>): string;
    /** Deserialize an item from a portable token. */
    deserializeItem(token: string): DeserializedItem;
    /** Get the grid size of an item in cells. */
    getItemSize(item: BinaryParsedItem): {
        width: number;
        height: number;
    };
    /** Check if an item can be placed at a position on a grid. */
    canPlaceItem(grid: StashGrid, x: number, y: number, item: PlacementItem): boolean;
    /** Find the first free slot for an item on a grid. */
    findFreeSlot(grid: StashGrid, item: PlacementItem): {
        x: number;
        y: number;
    } | null;
    /** Find the first free slot for an item across multiple stash grids. */
    findFreeSlotInStash(grids: StashGrid[], item: PlacementItem): {
        pageIndex: number;
        x: number;
        y: number;
    } | null;
    /**
     * Extract an item from a .d2s save file.
     *
     * @param buffer  Original file buffer.
     * @param itemId  Item ID to extract.
     */
    extractItemD2S(buffer: Uint8Array, itemId: number): ExtractResult;
    /**
     * Extract an item from a .d2i shared stash.
     *
     * @param buffer     Original file buffer.
     * @param pageIndex  Page index.
     * @param x          X position in grid.
     * @param y          Y position in grid.
     */
    extractItemD2I(buffer: Uint8Array, pageIndex: number, x: number, y: number): ExtractResult;
    /**
     * Insert an item into a .d2s save file.
     *
     * @param buffer          Original file buffer.
     * @param item            Item to insert.
     * @param allItemsForItem All related items (including socketed sub-items).
     * @param target          Target container: 'stash' | 'inventory' | 'cube'.
     * @param position        Optional specific position. Auto-finds if omitted.
     */
    insertItemD2S(buffer: Uint8Array, item: BinaryParsedItem, allItemsForItem: Record<number | string, BinaryParsedItem>, target: InsertD2STarget, position?: {
        x: number;
        y: number;
    }): InsertResult;
    /**
     * Insert an item into a .d2i shared stash.
     *
     * @param buffer          Original file buffer.
     * @param item            Item to insert.
     * @param allItemsForItem All related items (including socketed sub-items).
     * @param target          Optional specific target page and position.
     */
    insertItemD2I(buffer: Uint8Array, item: BinaryParsedItem, allItemsForItem: Record<number | string, BinaryParsedItem>, target?: {
        pageIndex: number;
        x: number;
        y: number;
    }): InsertD2IResult;
    /** Get the HD icon path key for an item. */
    getItemIconPath(item: BinaryParsedItem): string | null;
    /** Get the SD (invfile) icon name for an item. */
    getItemIconSD(item: BinaryParsedItem): string | null;
    /** Convert an item to a TradeItemDTO for the backend. */
    toTradeDTO(item: BinaryParsedItem, allItems: Record<number | string, BinaryParsedItem>): TradeItemDTO;
}
//# sourceMappingURL=index.d.ts.map