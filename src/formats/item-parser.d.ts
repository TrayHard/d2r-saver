/**
 * Item binary parser — reads items from D2R v105 save files.
 *
 * Ported from d2planner/src/logic/binary/index.js → createItemParser().
 * Simplified: Blizzless v105 only (D2R=true, V105=true, version=105).
 *
 * All version branches removed — only the v105 path remains.
 * Uses GameData instead of global Data singleton.
 */
import type { BinaryReader } from '../core/binary-reader.js';
import type { GameData } from '../game-data/game-data.js';
/** Parsed item representation from the binary reader. */
export interface BinaryParsedItem {
    itemId: number;
    base: string;
    quality: number;
    ilvl: number;
    unidentified: boolean;
    ethereal: boolean;
    socketed: boolean;
    sockets: number;
    socketedItems: number[];
    stats: Record<string, number>;
    unique?: string;
    name?: string;
    uniqueValues?: number[];
    mods?: Record<string, number[]>;
    auto?: Record<string, number[]>;
    staff?: Record<string, number[]>;
    crafted?: Record<string, number[]>;
    superior?: Record<string, number[]>;
    defense?: number;
    quantity?: number;
    ear?: {
        class: number;
        level: number;
        name: string;
    };
    personalized?: string;
    iconIndex?: number;
    custom?: boolean;
    /** Bit range in the original buffer */
    binaryOffset: {
        start: number;
        end: number;
    };
}
/** Callback for item placement during parsing. */
export type ItemHandler = (id: number, location?: string, slot?: number | string, item?: BinaryParsedItem) => void;
/** Return type of createItemParser. */
export interface ItemParserContext {
    parseItem: (itemId: number, handler: ItemHandler) => void;
    parseItemList: (handler: ItemHandler) => void;
    items: Record<number, BinaryParsedItem>;
    nextId: () => number;
    readonly currentId: number;
}
/**
 * Create a parser context for reading items from a BinaryReader.
 * V105 only — no version branching.
 *
 * @param reader    BinaryReader positioned before item data
 * @param gd        GameData instance
 * @param initialId Starting item ID (default 0)
 * @param options   Parser options
 */
export declare function createItemParser(reader: BinaryReader, gd: GameData, initialId?: number, options?: {
    forceStackable?: boolean;
}): ItemParserContext;
//# sourceMappingURL=item-parser.d.ts.map