/**
 * D2I (shared stash) reader — Blizzless v105 only.
 *
 * Ported from d2planner/src/logic/binary/index.js → parseStash().
 * Simplified: v105 only — all version branches removed.
 *
 * Uses GameData instead of global Data singleton.
 */
import { GameData } from '../game-data/game-data.js';
import { type BinaryParsedItem } from './item-parser.js';
/** Extended page item category. */
export type ExtendedPageType = 'gems' | 'runes' | 'misc';
/** A stash page as parsed from the binary d2i file. */
export interface D2IStashPage {
    /** Zero-based page index in result.pages[]. */
    index: number;
    /**
     * Page type:
     * - 0 = normal stash page
     * - 1 = extended page (the original binary page)
     * - 'gems' | 'runes' | 'misc' = virtual sub-page split from an extended page
     */
    pageType: number | ExtendedPageType;
    /** Gold on this page (only the first virtual sub-page inherits gold from extended). */
    gold: number;
    /** Slot array: `stash[slot] = itemId`. Slots use `row * columns + col`. */
    stash: (number | undefined)[];
    /** Per-slot quantities for extended page items (keyed by slot index). */
    quantities?: Record<number, number> | number[];
    /** Number of rows for the misc virtual page. */
    rows?: number;
    /** Byte offset of the raw sector in the original d2i file. */
    offset: number;
    /** Byte size of the raw sector. */
    sectorSize: number;
}
/** Result of parsing a .d2i shared stash file. */
export interface D2IReadResult {
    /** Parsed stash pages (extended pages are split into virtual sub-pages). */
    pages: D2IStashPage[];
    /** All parsed items keyed by item ID. */
    items: Record<number, BinaryParsedItem>;
    /** Warnings from parsing (e.g. unknown stats, partial failures). */
    warnings: string[];
}
/**
 * Parse a .d2i shared stash file.
 *
 * @param data Raw file bytes
 * @param gd   GameData instance
 */
export declare function readD2I(data: Uint8Array, gd: GameData): D2IReadResult;
//# sourceMappingURL=d2i-reader.d.ts.map