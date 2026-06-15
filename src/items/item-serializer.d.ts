/**
 * Item serializer — portable base64 token for item transfer.
 *
 * Format: `d2r1:<base64>` where the payload is writeItem() output
 * with a zeroed-out location (loc=0, equip=0, x=0, y=0, storage=0).
 *
 * This allows items to be extracted from a save, serialized to a string token,
 * transmitted (e.g. via trade API), and deserialized back into binary form
 * for insertion into any save file.
 */
import { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
/**
 * Serialize an item (and its socketed sub-items) to a portable token string.
 *
 * @param item     The item to serialize.
 * @param allItems All items dict (needed to look up socketed items).
 * @param gd       GameData instance.
 * @returns Token string: `d2r1:<base64>`
 */
export declare function serializeItem(item: BinaryParsedItem, allItems: Record<number | string, BinaryParsedItem>, gd: GameData): string;
/**
 * Deserialize a token string back to a parsed item.
 *
 * @param token  Token string (must start with `d2r1:`).
 * @param gd     GameData instance.
 * @returns The parsed item and any socketed sub-items.
 * @throws If the token is invalid.
 */
export declare function deserializeItem(token: string, gd: GameData): DeserializedItem;
/** Result of deserializing a token. */
export interface DeserializedItem {
    /** The main item. */
    item: BinaryParsedItem;
    /** All items including socketed sub-items, keyed by ID. */
    allItems: Record<number, BinaryParsedItem>;
}
//# sourceMappingURL=item-serializer.d.ts.map