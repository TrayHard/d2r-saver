/**
 * D2S (character save) writer — Blizzless v105 only.
 *
 * Ported from d2planner/src/logic/binary/writed2s.js → writeCharacter().
 * Simplified: v105 only — all version conditionals removed.
 *
 * Uses GameData instead of global Data/Locale/Store singletons.
 * Accepts an explicit profile + items dict instead of reading from state.
 */
import { GameData } from '../game-data/game-data.js';
import type { D2SCharacterProfile } from './d2s-reader.js';
import type { BinaryParsedItem } from './item-parser.js';
/**
 * Options for writeD2S.
 * Only `profile`, `items`, and `gd` are required.
 * Everything else has sensible defaults for a Blizzless v105 character.
 */
export interface WriteD2SOptions {
    /** Character profile (as returned by readD2S). */
    profile: D2SCharacterProfile;
    /** All items keyed by item ID. */
    items: Record<number | string, BinaryParsedItem>;
    /** GameData instance for itemStatCost, charStats, etc. */
    gd: GameData;
    /** Override character name (uses profile.name by default). */
    name?: string;
    /**
     * Explicit character stats (base totals = base class + allocated).
     * If not supplied, stats are computed from profile.stats + charStats base.
     */
    charStats?: {
        strength: number;
        energy: number;
        dexterity: number;
        vitality: number;
        hitpoints: number;
        maxhp: number;
        mana: number;
        maxmana: number;
        stamina: number;
        maxstamina: number;
        statpts?: number;
        newskills?: number;
    };
}
/**
 * Write a complete .d2s character save file (Blizzless v105).
 *
 * @returns Raw file bytes ready to be saved.
 */
export declare function writeD2S(opts: WriteD2SOptions): Uint8Array;
//# sourceMappingURL=d2s-writer.d.ts.map