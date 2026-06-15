/**
 * Item stat parser — determines mod sources for parsed items.
 *
 * Ported from d2planner/src/logic/parser.js.
 * Provides: parseModStats, parseUniqueStats, parseRunewordStats.
 *
 * These functions analyze item stats read from the binary save file
 * and determine which affixes (mods) produced those stats, along with
 * the variable values (uniqueValues) for unique/set/runeword items.
 *
 * Uses GameData instead of global Data singleton.
 */
import { GameData } from '../game-data/game-data.js';
import type { StatValue } from './item.js';
interface ParsedItem {
    base: string;
    quality: number;
    unique?: string;
    [key: string]: unknown;
}
type StatsGetter = (src: Record<string, StatValue>) => Record<string, StatValue> | null;
/**
 * Post-process binary stats into a format suitable for mod matching.
 * Handles descfunc 13/27 stats (class skill bonuses, single-skill bonuses).
 * Ported from d2planner binary/index.js → parseParamStats().
 */
export declare function parseParamStats(gd: GameData, stats: Record<string, number>, src: Record<string, StatValue>): Record<string, StatValue> | null;
/**
 * Determine the variable values for a unique/set item by analyzing binary stats.
 * Returns array of uniqueValues or null if stats don't match.
 */
export declare function parseUniqueStats(gd: GameData, item: ParsedItem, getStats: StatsGetter): number[] | null;
/**
 * Determine the mod sources and uniqueValues for a runeword item.
 */
export declare function parseRunewordStats(gd: GameData, item: ParsedItem, socketStats: Record<string, StatValue> | null, getStats: StatsGetter, presetMods?: string[]): Record<string, unknown> | null;
/**
 * Determine the mod sources for a magic/rare/crafted/superior item.
 */
export declare function parseModStats(gd: GameData, item: ParsedItem, magic: {
    prefix?: string;
    suffix?: string;
} | null, socketStats: Record<string, StatValue> | null, levelreq: number | null, getStats: StatsGetter, presetMods?: string[]): Record<string, unknown> | null;
export {};
//# sourceMappingURL=item-stats-parser.d.ts.map