/**
 * D2S (character save) reader — Blizzless v105 only.
 *
 * Ported from d2planner/src/logic/binary/index.js → parseCharacter().
 * Simplified: v105 only — all offsets use v105 values.
 *
 * Uses GameData instead of global Data singleton.
 */
import { GameData } from '../game-data/game-data.js';
import { type BinaryParsedItem } from './item-parser.js';
export interface D2SCharacterProfile {
    name: string;
    class: string;
    level: number;
    stats: {
        str: number;
        dex: number;
        int: number;
        vit: number;
    };
    skills: Record<number, number>;
    quests: Array<{
        denofevil: boolean;
        radamentslair: boolean;
        thegoldenbird: boolean;
        lamessenstome: boolean;
        thefallenangel: boolean;
        prisonofice: boolean;
    }>;
    weaponSet?: number;
    mercName?: number;
    merc?: string;
    mercLevel?: number;
    items: Record<string, number>;
    mercItems: Record<string, number>;
    inventory: (number | undefined)[];
    cube: (number | undefined)[];
    stash: (number | undefined)[];
    belt: (number | undefined)[];
    ironGolem?: number;
}
export interface D2SReadResult {
    profile: D2SCharacterProfile;
    items: Record<number, BinaryParsedItem>;
    warnings: string[];
}
/**
 * Parse a .d2s character file.
 *
 * @param data Raw file bytes
 * @param gd   GameData instance
 */
export declare function readD2S(data: Uint8Array, gd: GameData): D2SReadResult;
//# sourceMappingURL=d2s-reader.d.ts.map