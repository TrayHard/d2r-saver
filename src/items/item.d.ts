/**
 * Item stat computation — computing stats from mods, properties, gems, etc.
 *
 * Ported from d2planner/src/logic/item.js.
 * Provides: addProp, modsToStats, uniqueStats, runewordStats, gemStats, formatStr, addValues.
 *
 * Uses GameData instead of global Data singleton.
 */
import type { GameData } from '../game-data/game-data.js';
/** A stat value that can be a number or a {min,max} range (for variable mods). */
export type StatValue = number | string | {
    min: number;
    max: number;
};
/**
 * Format a localized string template with positional %d/%s/%i/%N replacements.
 */
export declare function formatStr(fmt: string | undefined, ...values: unknown[]): string;
/**
 * Add two stat values (numbers or ranges), returning the sum.
 */
export declare function addValues(dst: StatValue | undefined, src: StatValue | undefined): StatValue | undefined;
/**
 * Apply a property (from Properties.txt) to the stats object.
 * Ported from d2planner addProp().
 */
export declare function addProp(gd: GameData, stats: Record<string, StatValue>, id: string, param: unknown, min: number, max: number, value: StatValue, item?: {
    ilvl?: number;
    base?: string;
}): void;
/**
 * Compute stats from a set of mods (affix id → array of values).
 * Ported from d2planner modsToStats().
 */
export declare function modsToStats(gd: GameData, stats: Record<string, StatValue>, mods: Record<string, StatValue[]>, item?: {
    ilvl?: number;
    base?: string;
}): Record<string, StatValue>;
/**
 * Compute stats from a unique/set item definition.
 * Ported from d2planner uniqueStats().
 */
export declare function uniqueStats(gd: GameData, stats: Record<string, StatValue>, uniq: Record<string, unknown>, values: StatValue[] | undefined, item?: {
    ilvl?: number;
    base?: string;
}): Record<string, StatValue>;
/**
 * Compute stats from a runeword definition.
 * Ported from d2planner runewordStats().
 */
export declare function runewordStats(gd: GameData, stats: Record<string, StatValue>, uniq: Record<string, unknown>, values: StatValue[] | undefined, item?: {
    ilvl?: number;
    base?: string;
}): Record<string, StatValue>;
/**
 * Apply gem/rune/jewel stats to the stat object based on the equipment slot type.
 * Ported from d2planner gemStats().
 */
export declare function gemStats(gd: GameData, stats: Record<string, StatValue>, code: string, types: Set<string>): Record<string, StatValue>;
//# sourceMappingURL=item.d.ts.map