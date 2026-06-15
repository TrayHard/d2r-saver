/**
 * Insert item into a save file — places an item and returns a patched buffer.
 *
 * Works with both .d2s and .d2i files.
 */
import { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
/** Location types for D2S insertion. */
export type InsertD2STarget = 'stash' | 'inventory' | 'cube';
/** Result of inserting an item into a save. */
export interface InsertResult {
    /** Patched file buffer with the item inserted. */
    newBuffer: Uint8Array;
    /** Position where the item was placed. */
    position: {
        x: number;
        y: number;
    };
}
/** Result of inserting an item into a D2I stash. */
export interface InsertD2IResult extends InsertResult {
    /** Page index where the item was placed. */
    pageIndex: number;
}
/**
 * Insert an item into a .d2s character save.
 *
 * If `position` is provided, attempts to place at that exact location.
 * Otherwise, finds the first available slot.
 *
 * @param buffer  Original .d2s file bytes.
 * @param item    The item to insert.
 * @param allItemsForItem  All items for the item (e.g. socketed sub-items).
 * @param target  Where to place: 'stash', 'inventory', or 'cube'.
 * @param gd      GameData instance.
 * @param position  Optional specific position `{ x, y }`.
 */
export declare function insertItemD2S(buffer: Uint8Array, item: BinaryParsedItem, allItemsForItem: Record<number | string, BinaryParsedItem>, target: InsertD2STarget, gd: GameData, position?: {
    x: number;
    y: number;
}): InsertResult;
/**
 * Insert an item into a .d2i stash page.
 *
 * If `position` is provided, attempts to place at that exact location on the
 * specified page. Otherwise, finds the first available slot across normal pages.
 *
 * @param buffer  Original .d2i file bytes.
 * @param item    The item to insert.
 * @param allItemsForItem  All items for the item (e.g. socketed sub-items).
 * @param gd      GameData instance.
 * @param target  Optional { pageIndex, x, y } for exact placement.
 */
export declare function insertItemD2I(buffer: Uint8Array, item: BinaryParsedItem, allItemsForItem: Record<number | string, BinaryParsedItem>, gd: GameData, target?: {
    pageIndex: number;
    x: number;
    y: number;
}): InsertD2IResult;
//# sourceMappingURL=insert-item.d.ts.map