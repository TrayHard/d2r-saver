/**
 * Item type hierarchy — type checking and inheritance.
 *
 * Ported from d2planner/src/logic/itemTypes.js.
 * Provides:
 *  - isSubType(type, what) — recursive equiv1/equiv2 walk
 *  - itemGetTypes(id) — all types for an item (type + type2, extended)
 *  - presetItemIds — list of preset (stackable/consumable) item codes
 *
 * Uses GameData instead of global Data singleton.
 */
import type { GameData } from '../game-data/game-data.js';
/**
 * Check whether `type` is a subtype of `what` (recursive via equiv1/equiv2 chains).
 */
export declare function isSubType(gd: GameData, type: string, what: string): boolean;
/**
 * Get the full set of types (including parent chain) for a given item by base code.
 */
export declare function itemGetTypes(gd: GameData, id: string): Set<string>;
/**
 * Determine the item equipment "supertype" for quality-item matching.
 * Used for superior/runeword quality item lookup.
 */
export declare function itemGetType(types: Set<string>): string | undefined;
/**
 * Preset item codes — items that are identified by their base code alone
 * (consumables, gems, runes, quest items, etc.).
 */
export declare const presetItemIds: Set<string>;
/**
 * Check whether a mod/affix can be applied to an item.
 * Ported from d2planner/src/logic/item.js → itemCheckMod().
 */
export declare function itemCheckMod(gd: GameData, mod: Record<string, unknown>, item: Record<string, unknown>, types: Set<string>, quality: number): boolean;
/**
 * Get max sockets for a base item (accounting for quality).
 */
export declare function itemMaxSockets(gd: GameData, base: Record<string, unknown>, quality?: number): number;
//# sourceMappingURL=item-types.d.ts.map