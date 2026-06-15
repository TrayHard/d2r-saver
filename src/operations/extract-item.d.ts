/**
 * Extract item from a save file — removes an item and returns a patched buffer.
 *
 * Works with both .d2s and .d2i files.
 */
import { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
/** Result of extracting an item from a save. */
export interface ExtractResult {
    /** Patched file buffer with the item removed. */
    newBuffer: Uint8Array;
    /** The extracted item (with socketed sub-items). */
    extractedItem: BinaryParsedItem;
    /** All items dict including socketed sub-items of the extracted item. */
    extractedAllItems: Record<number | string, BinaryParsedItem>;
}
/**
 * Extract an item from a .d2s save by its item ID.
 *
 * Removes the item (and its socketed sub-items) from the character,
 * rewrites the save with a corrected checksum, and returns the patched file
 * plus the extracted item.
 *
 * @param buffer   Original .d2s file bytes.
 * @param itemId   The item ID to extract (numeric or string key in items dict).
 * @param gd       GameData instance.
 */
export declare function extractItemD2S(buffer: Uint8Array, itemId: number | string, gd: GameData): ExtractResult;
/**
 * Extract an item from a .d2i stash by page and position.
 *
 * @param buffer     Original .d2i file bytes.
 * @param pageIndex  Zero-based page index.
 * @param x          Column in the stash grid.
 * @param y          Row in the stash grid.
 * @param gd         GameData instance.
 */
export declare function extractItemD2I(buffer: Uint8Array, pageIndex: number, x: number, y: number, gd: GameData): ExtractResult;
//# sourceMappingURL=extract-item.d.ts.map