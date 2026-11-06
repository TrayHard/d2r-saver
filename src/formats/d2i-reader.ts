/**
 * D2I (shared stash) reader — Blizzless v105.
 *
 * The Rust core reads the sectors and splits extended sectors into pages (`read_d2i` in
 * `rust/core/src/stash.rs`); this module builds the result objects from its document.
 */

import type { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem, ItemListReport, ReadOptions } from './item-parser.js';
import { dictOf, engineReadD2I, itemsOf, sparse, type ItemsDoc } from '../engine/engine.js';

// ─── Types ──────────────────────────────────────────────────────

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
  stash: (number | string | undefined)[];
  /** Per-slot quantities for extended page items (keyed by slot index). */
  quantities?: Record<number, number> | number[];
  /** Number of rows for the misc virtual page. */
  rows?: number;
  /** Byte offset of the raw sector in the original d2i file. */
  offset: number;
  /** Byte size of the raw sector. */
  sectorSize: number;
  /**
   * Parse report of this sector's `JM` list (0.3.0). The three virtual sub-pages of one
   * extended sector share the same report object. `null` only when the list header itself
   * was not `JM` (the page then carries a parsing-error warning).
   */
  list: ItemListReport | null;
  /** The raw sector type byte (0 normal, 1 extended), unlike `pageType` which is virtualised. */
  rawType: number;
}

/** One raw sector of a `.d2i` as laid out in the file. */
export interface D2ISectorSummary {
  /** Absolute byte offset of the sector header. */
  offset: number;
  /** `sectorSize` from the header: bytes including the 64-byte header. */
  size: number;
  /** Sector type byte: 0 normal, 1 extended (gems/runes/materials), 2 metadata. */
  type: number;
  /** Gold from the header. */
  gold: number;
  /** List report; `null` for a metadata sector (not parsed) or when the list header was not `JM`. */
  list: ItemListReport | null;
}

/** Result of parsing a .d2i shared stash file. */
export interface D2IReadResult {
  /** Parsed stash pages (extended pages are split into virtual sub-pages). */
  pages: D2IStashPage[];
  /** All parsed items keyed by item ID. */
  items: Record<number, BinaryParsedItem>;
  /** Warnings from parsing (e.g. unknown stats, partial failures). */
  warnings: string[];
  /** Every sector the reader recognised, in file order, including metadata sectors (0.3.0). */
  sectors: D2ISectorSummary[];
  /**
   * The sector sizes add up to exactly the buffer length: no trailing bytes outside a sector
   * and no sector claiming bytes past the end.
   */
  tiled: boolean;
  /**
   * The sector loop ran to the end of the buffer without stopping on an unrecognised or
   * malformed sector. `tiled && reachedEof` means every byte of the file belongs to a sector.
   */
  reachedEof: boolean;
}

/** The stash document of the read core (`rust/core/src/doc.rs`). */
interface StashDoc extends ItemsDoc {
  pages: Array<{
    pageType: number | ExtendedPageType;
    gold: number;
    stash: Array<[number, number | string]>;
    quantities?: Record<number, number> | number[];
    rows?: number;
    offset: number;
    sectorSize: number;
    /** The sector whose list the page shares. */
    sector: number;
    rawType: number;
  }>;
  sectors: D2ISectorSummary[];
  warnings: string[];
  tiled: boolean;
  reachedEof: boolean;
}

// ─── Reader ─────────────────────────────────────────────────────

/**
 * Parse a .d2i shared stash file.
 *
 * @param data Raw file bytes
 * @param gd   GameData instance
 */
export function readD2I(data: Uint8Array, gd: GameData, options?: ReadOptions): D2IReadResult {
  const doc = engineReadD2I<StashDoc>(gd, data, options?.resolveMods ?? true);
  const items = itemsOf(doc, gd);
  const pages = doc.pages.map((p, index) => {
    const page: Partial<D2IStashPage> = { index, pageType: p.pageType, gold: p.gold, stash: sparse(p.stash) };
    if (p.quantities !== undefined) page.quantities = p.quantities;
    if (p.rows !== undefined) page.rows = p.rows;
    page.offset = p.offset;
    page.sectorSize = p.sectorSize;
    page.list = doc.sectors[p.sector].list;
    page.rawType = p.rawType;
    return page as D2IStashPage;
  });
  return {
    pages,
    items: dictOf(items, doc.traces),
    warnings: doc.warnings,
    sectors: doc.sectors,
    tiled: doc.tiled,
    reachedEof: doc.reachedEof,
  };
}
