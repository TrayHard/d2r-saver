/**
 * D2I (shared stash) writer — Blizzless v105 only.
 *
 * **New functionality** — d2planner has no writeStash() equivalent.
 * Reverse-engineered from the parseStash() reader and the binary format:
 *
 *   [0x00] Magic:      0xAA55AA55  (4 bytes)
 *   [0x04] Mode:       uint32 = 2  (4 bytes)
 *   [0x08] Version:    uint32 = 105 (4 bytes)
 *   [0x0C] Gold:       uint32      (4 bytes)
 *   [0x10] SectorSize: uint32      (4 bytes) — patched after writing items
 *   [0x14] PageType:   uint8       (1 byte)
 *   [0x15] Padding:    zeros       (43 bytes → total header = 64 bytes)
 *   [0x40] Items:      JM header + items (via writeItemList)
 *
 * Supports:
 *   - writeStash()     — full rewrite of all pages
 *   - patchStashPage() — incremental patch: replace one page, leave rest as-is
 */
import { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from './item-parser.js';
import type { D2IStashPage } from './d2i-reader.js';
import { type ItemWriteEntry } from './item-writer.js';
/** Options for a single stash page to be written. */
export interface WriteStashPage {
    /** Page type for the binary header (0 = normal, 1 = extended). */
    pageType: number;
    /** Gold on this page. */
    gold: number;
    /** Item entries to write on this page. */
    entries: ItemWriteEntry[];
}
/**
 * Write a complete .d2i file from an array of pages.
 *
 * @param pages  Array of page descriptions with items.
 * @param allItems  All items (for socketed item lookups).
 * @param gd  GameData instance.
 * @returns  Raw file bytes.
 */
export declare function writeStash(pages: WriteStashPage[], allItems: Record<number | string, BinaryParsedItem>, gd: GameData): Uint8Array;
/**
 * Build WriteStashPage entries from parsed D2IStashPage + items.
 *
 * Converts the reader's page model back to writable entries.
 * Extended sub-pages (gems/runes/misc) are merged back into a single
 * extended page with pageType=1.
 */
export declare function buildStashWritePages(pages: D2IStashPage[], allItems: Record<number | string, BinaryParsedItem>, gd: GameData): WriteStashPage[];
/**
 * Incremental patch: replace one page in an existing .d2i file.
 *
 * Copies all sectors as-is, but re-writes the target page.
 *
 * @param originalBuffer  The original .d2i file bytes.
 * @param pageIndex  The zero-based page index to replace (in raw sector order, ignoring pageType=2 skips).
 * @param newPage  The new page content.
 * @param allItems  All items (for socketed item lookups).
 * @param gd  GameData instance.
 * @returns  New file bytes with the patched page.
 */
export declare function patchStashPage(originalBuffer: Uint8Array, pageIndex: number, newPage: WriteStashPage, allItems: Record<number | string, BinaryParsedItem>, gd: GameData): Uint8Array;
//# sourceMappingURL=d2i-writer.d.ts.map