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
import { Buffer } from 'node:buffer';
import { BinaryReader } from '../core/binary-reader.js';
import { TOKEN_PREFIX } from '../types/constants.js';
import { writeItem } from '../formats/item-writer.js';
import { createItemParser } from '../formats/item-parser.js';
// ─── Public API ─────────────────────────────────────────────────
/**
 * Serialize an item (and its socketed sub-items) to a portable token string.
 *
 * @param item     The item to serialize.
 * @param allItems All items dict (needed to look up socketed items).
 * @param gd       GameData instance.
 * @returns Token string: `d2r1:<base64>`
 */
export function serializeItem(item, allItems, gd) {
    // Write item with zero location
    const zeroLoc = { loc: 0, equip: 0, x: 0, y: 0, storage: 0 };
    const bytes = writeItem(item, zeroLoc, allItems, gd);
    const base64 = uint8ToBase64(bytes);
    return TOKEN_PREFIX + base64;
}
/**
 * Deserialize a token string back to a parsed item.
 *
 * @param token  Token string (must start with `d2r1:`).
 * @param gd     GameData instance.
 * @returns The parsed item and any socketed sub-items.
 * @throws If the token is invalid.
 */
export function deserializeItem(token, gd) {
    if (!token.startsWith(TOKEN_PREFIX)) {
        throw new Error(`INVALID_TOKEN: token must start with '${TOKEN_PREFIX}'`);
    }
    const base64 = token.slice(TOKEN_PREFIX.length);
    const bytes = base64ToUint8(base64);
    if (bytes.length < 4) {
        throw new Error('INVALID_TOKEN: payload too short');
    }
    // Parse item using a JM-wrapped buffer so createItemParser works
    // We wrap: JM header (2 bytes) + count=1 (2 bytes) + item bytes
    const wrapped = new Uint8Array(4 + bytes.length);
    wrapped[0] = 0x4a; // 'J'
    wrapped[1] = 0x4d; // 'M'
    wrapped[2] = 1; // count = 1
    wrapped[3] = 0;
    wrapped.set(bytes, 4);
    const reader = new BinaryReader(wrapped);
    const ctx = createItemParser(reader, gd);
    // Parse items — the handler may not fire because we use a zeroed location
    // (location=0, storage=0), which doesn't match any known slot.
    // Instead, we collect items directly from ctx.items after parsing.
    ctx.parseItemList(() => { });
    const allParsed = Object.values(ctx.items);
    if (allParsed.length === 0) {
        throw new Error('INVALID_TOKEN: no item parsed from token');
    }
    // The first item in the dict is the main item
    const mainItem = allParsed[0];
    return {
        item: mainItem,
        allItems: ctx.items,
    };
}
// ─── Base64 helpers ─────────────────────────────────────────────
function uint8ToBase64(bytes) {
    // Node.js environment
    return Buffer.from(bytes).toString('base64');
}
function base64ToUint8(base64) {
    return new Uint8Array(Buffer.from(base64, 'base64'));
}
//# sourceMappingURL=item-serializer.js.map