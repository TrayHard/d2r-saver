/**
 * Item icon path resolution — determines the HD icon key for an item.
 *
 * Ported from d2planner/src/logic/item.js → itemGetIconHD().
 */
import type { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
/**
 * Get the HD icon path key for an item.
 *
 * Returns the icon identifier used in hditemlib.json for HD rendering.
 * The result can be passed to the frontend for icon display.
 *
 * @param item  The parsed item.
 * @param gd    GameData instance.
 * @returns Icon path string, or `null` if no icon is available.
 */
export declare function getItemIconPath(item: BinaryParsedItem, gd: GameData): string | null;
/**
 * Get the inventory file icon name for an item (SD, non-HD).
 *
 * @param item  The parsed item.
 * @param gd    GameData instance.
 * @returns Icon name string, or `null` if not found.
 */
export declare function getItemIconSD(item: BinaryParsedItem, gd: GameData): string | null;
//# sourceMappingURL=item-icon.d.ts.map