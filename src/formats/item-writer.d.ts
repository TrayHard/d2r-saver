/**
 * Item binary writer — writes items to D2R v105 save format.
 *
 * Ported from d2planner/src/logic/binary/writed2s.js →
 *   writeItem(), writeItemList(), writeItemStats().
 * Simplified: Blizzless v105 only (D2R=true, V105=true).
 *
 * Uses GameData instead of global Data/Locale singletons.
 */
import { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from './item-parser.js';
/** Location descriptor for an item being written. */
export interface ItemWriteLocation {
    /** 3-bit location type (0=stored, 1=equipped, 2=belt, 6=socketed). */
    loc: number;
    /** 4-bit body slot for equipped, 0 otherwise. */
    equip: number;
    /** Grid column (x). */
    x: number;
    /** Grid row (y). */
    y: number;
    /** 3-bit storage type (0=none, 1=inventory, 3(cube in d2planner)→4(cube), 5=stash). */
    storage: number;
}
/** An item entry to be written. */
export interface ItemWriteEntry {
    item: BinaryParsedItem;
    location: ItemWriteLocation;
}
/**
 * Write a JM-prefixed item list.
 *
 * Takes an array of item entries (item + location) and all items
 * (for socketed item lookups). Returns the raw bytes.
 */
export declare function writeItemList(entries: ItemWriteEntry[], allItems: Record<number | string, BinaryParsedItem>, gd: GameData): Uint8Array;
/**
 * Write a single item to binary format.
 *
 * Returns raw bytes for the item (includes socketed sub-items).
 */
export declare function writeItem(item: BinaryParsedItem, loc: ItemWriteLocation, allItems: Record<number | string, BinaryParsedItem>, gd: GameData): Uint8Array;
/**
 * Build write entries from a profile's inventory layout (stash, inventory, cube, belt, body, merc).
 * This collects items from their slots and prepares them for writeItemList().
 */
export declare function buildWriteEntries(profile: {
    items?: Record<string, number | string>;
    mercItems?: Record<string, number | string>;
    inventory?: (number | string | undefined)[];
    cube?: (number | string | undefined)[];
    stash?: (number | string | undefined)[];
    belt?: (number | string | undefined)[];
}, allItems: Record<number | string, BinaryParsedItem>, gd: GameData, merc?: boolean): ItemWriteEntry[];
//# sourceMappingURL=item-writer.d.ts.map