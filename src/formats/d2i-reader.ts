/**
 * D2I (shared stash) reader — Blizzless v105 only.
 *
 * Ported from d2planner/src/logic/binary/index.js → parseStash().
 * Simplified: v105 only — all version branches removed.
 *
 * Uses GameData instead of global Data singleton.
 */

import { BinaryReader } from '../core/binary-reader.js';
import { GameData } from '../game-data/game-data.js';
import { detectFormat } from './detect.js';
import {
  createItemParser,
  type BinaryParsedItem,
  type ItemHandler,
  type ItemListReport,
} from './item-parser.js';
import { isSubType } from '../items/item-types.js';

// Minimum bytes a single D2I page occupies (header + item-list start at byte 64). A sector
// smaller than this can't be a real page; we treat it as corruption and stop. This also
// guarantees the page cursor strictly advances each iteration — without it a malformed file
// reporting sectorSize 0 (or any value < 64) would loop forever (CPU/hang DoS). Mirrors the
// identical guard in the writer (`d2i-writer.ts`).
const PAGE_HEADER_SIZE = 64;

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

// ─── Reader ─────────────────────────────────────────────────────

/**
 * Parse a .d2i shared stash file.
 *
 * @param data Raw file bytes
 * @param gd   GameData instance
 */
export function readD2I(data: Uint8Array, gd: GameData): D2IReadResult {
  const buffer = new Uint8Array(data);
  const pages: D2IStashPage[] = [];
  const allItems: Record<number, BinaryParsedItem> = {};
  const warnings: string[] = [];
  const sectors: D2ISectorSummary[] = [];
  let offset = 0;
  let nextItemId = 1;
  let stoppedEarly = false;

  while (offset < buffer.length) {
    if (offset + PAGE_HEADER_SIZE > buffer.length) { stoppedEarly = true; break; }

    const pageData = buffer.subarray(offset);
    const reader = new BinaryReader(pageData);

    const fmt = detectFormat(pageData);
    if (!fmt || fmt.type !== 'd2i') { stoppedEarly = true; break; }

    // D2I page header: magic(4) + ?(4) + version(4) + gold(4) + sectorSize(4) + pageType(1)
    reader.seek(12);
    const gold = reader.read32();
    const sectorSize = reader.read32();
    const pageType = reader.read8();

    // Guard against a malformed/hostile sector size: a value below one page header would
    // never advance `offset`, hanging the parser in an infinite loop (CPU/hang DoS). Stop
    // and surface a warning instead — we keep whatever pages parsed cleanly before it.
    if (sectorSize < PAGE_HEADER_SIZE) {
      warnings.push(
        `Malformed D2I page at offset ${offset}: sectorSize ${sectorSize} < ${PAGE_HEADER_SIZE}; stopping parse.`,
      );
      stoppedEarly = true;
      break;
    }

    const sector: D2ISectorSummary = { offset, size: sectorSize, type: pageType, gold, list: null };
    sectors.push(sector);

    if (pageType === 2) {
      // Metadata page — skip entirely
      offset += sectorSize;
      continue;
    }

    // Items start at byte 64
    reader.seek(64);

    if (pageType === 1) {
      // Extended page: split into 3 virtual tabs (gems, runes, materials)
      sector.list = parseExtendedPage(reader, gd, gold, offset, sectorSize, pages, allItems, warnings, nextItemId);
      // Update nextItemId from the items that were just parsed
      for (const key of Object.keys(allItems)) {
        const id = Number(key);
        if (id >= nextItemId) nextItemId = id + 1;
      }
    } else {
      // Normal stash page
      sector.list = parseNormalPage(reader, gd, gold, pageType, offset, sectorSize, pages, allItems, warnings, nextItemId);
      for (const key of Object.keys(allItems)) {
        const id = Number(key);
        if (id >= nextItemId) nextItemId = id + 1;
      }
    }

    offset += sectorSize;
  }

  return {
    pages,
    items: allItems,
    warnings,
    sectors,
    tiled: sectors.length > 0 && offset === buffer.length && !stoppedEarly,
    reachedEof: !stoppedEarly,
  };
}

// ─── Normal page ────────────────────────────────────────────────

function parseNormalPage(
  reader: BinaryReader,
  gd: GameData,
  gold: number,
  pageType: number,
  offset: number,
  sectorSize: number,
  pages: D2IStashPage[],
  allItems: Record<number, BinaryParsedItem>,
  warnings: string[],
  nextItemId: number,
): ItemListReport | null {
  const stash: (number | string | undefined)[] = [];
  // `baseOffset` makes the item byte ranges and the report absolute even though the reader
  // wraps `buffer.subarray(offset)`; `expectedEnd` lets the report tell a fully parsed list
  // (reader stopped exactly at the sector end) from one that merely counted to `declared`.
  const ctx = createItemParser(reader, gd, nextItemId, { baseOffset: offset });
  let list: ItemListReport | null = null;
  try {
    list = ctx.parseItemList((id, location, slot) => {
      if (location === 'stash' && slot !== undefined) {
        stash[slot as number] = id;
      }
    }, { expectedEnd: offset + sectorSize });
    // A mid-list failure truncates this page's items SILENTLY (parseItemList swallows it into
    // `error`) — surface it so consumers can log the exact item/reason.
    if (ctx.error) warnings.push(`Stash page ${pages.length}: item list truncated: ${ctx.error}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const warning = `Stash page ${pages.length} parsing error: ${msg}`;
    warnings.push(warning);
  } finally {
    Object.assign(allItems, ctx.items);
  }
  pages.push({
    index: pages.length,
    pageType,
    gold,
    stash,
    offset,
    sectorSize,
    list,
    rawType: pageType,
  });
  return list;
}

// ─── Extended page ──────────────────────────────────────────────

function parseExtendedPage(
  reader: BinaryReader,
  gd: GameData,
  gold: number,
  offset: number,
  sectorSize: number,
  pages: D2IStashPage[],
  allItems: Record<number, BinaryParsedItem>,
  warnings: string[],
  nextItemId: number,
): ItemListReport | null {
  const gems: (number | string)[] = [];
  const runes: (number | string)[] = [];
  const misc: Array<{ id: number | string; qty: number }> = [];
  const gemQty: number[] = [];
  const runeQty: number[] = [];

  const ctx = createItemParser(reader, gd, nextItemId, { baseOffset: offset });
  let list: ItemListReport | null = null;
  try {
    const handler: ItemHandler = (id, location, _slot, item) => {
      if (location === 'stash') {
        const base = item?.base || (typeof id === 'number' ? ctx.items[id]?.base : undefined);
        if (!base) return;
        const itemEntry = gd.items[base] as unknown as Record<string, unknown> | undefined;
        const type = itemEntry?.type as string | undefined;
        const qty = item?.quantity || ctx.items[id]?.quantity || 0;
        if (!qty) return;
        if (type && isSubType(gd, type, 'gem')) {
          gems.push(id);
          gemQty.push(qty);
        } else if (type && isSubType(gd, type, 'rune')) {
          runes.push(id);
          runeQty.push(qty);
        } else {
          misc.push({ id, qty });
        }
      }
    };
    list = ctx.parseItemList(handler, { expectedEnd: offset + sectorSize });
    if (ctx.error) {
      warnings.push(`Stash page ${pages.length} (extended): item list truncated: ${ctx.error}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const warning = `Stash page ${pages.length} (extended) parsing error: ${msg}`;
    warnings.push(warning);
  } finally {
    Object.assign(allItems, ctx.items);
  }

  // Pack misc items into a grid respecting actual item sizes
  const miscStash: (number | string | undefined)[] = [];
  const miscQty: Record<number, number> = {};
  const miscCols = 10;
  const occupied = new Set<number>();
  let miscMaxRow = 0;

  for (const { id, qty } of misc) {
    const baseCode = (allItems as Record<number | string, BinaryParsedItem>)[id]?.base;
    const baseItem = baseCode
      ? (gd.items[baseCode] as unknown as Record<string, unknown> | undefined)
      : undefined;
    const w = (baseItem?.invwidth as number) || 1;
    const h = (baseItem?.invheight as number) || 1;

    for (let slot = 0; ; slot++) {
      const x = slot % miscCols;
      const y = Math.floor(slot / miscCols);
      if (x + w > miscCols) continue;
      let fits = true;
      for (let dy = 0; dy < h && fits; dy++) {
        for (let dx = 0; dx < w && fits; dx++) {
          if (occupied.has((y + dy) * miscCols + (x + dx))) fits = false;
        }
      }
      if (fits) {
        miscStash[slot] = id;
        miscQty[slot] = qty;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            occupied.add((y + dy) * miscCols + (x + dx));
            miscMaxRow = Math.max(miscMaxRow, y + dy);
          }
        }
        break;
      }
    }
  }

  const miscRows = misc.length ? miscMaxRow + 1 : 1;

  pages.push({
    index: pages.length,
    pageType: 'gems',
    gold,
    stash: gems,
    quantities: gemQty,
    offset,
    sectorSize,
    list,
    rawType: 1,
  });
  pages.push({
    index: pages.length,
    pageType: 'runes',
    gold: 0,
    stash: runes,
    quantities: runeQty,
    offset,
    sectorSize,
    list,
    rawType: 1,
  });
  pages.push({
    index: pages.length,
    pageType: 'misc',
    gold: 0,
    stash: miscStash,
    quantities: miscQty,
    rows: miscRows,
    offset,
    sectorSize,
    list,
    rawType: 1,
  });
  return list;
}
