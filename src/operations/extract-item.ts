/**
 * Extract item from a save file — removes an item and returns a patched buffer.
 *
 * Works with both .d2s and .d2i files.
 */

import { GameData } from '../game-data/game-data.js';
import { readD2S, type D2SCharacterProfile } from '../formats/d2s-reader.js';
import { writeD2S } from '../formats/d2s-writer.js';
import { readD2I, type D2IStashPage } from '../formats/d2i-reader.js';
import { patchStashPage, buildStashWritePages, writeStash, type WriteStashPage } from '../formats/d2i-writer.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
import type { ItemWriteEntry, ItemWriteLocation } from '../formats/item-writer.js';

// ─── Types ──────────────────────────────────────────────────────

/** Result of extracting an item from a save. */
export interface ExtractResult {
  /** Patched file buffer with the item removed. */
  newBuffer: Uint8Array;
  /** The extracted item (with socketed sub-items). */
  extractedItem: BinaryParsedItem;
  /** All items dict including socketed sub-items of the extracted item. */
  extractedAllItems: Record<number | string, BinaryParsedItem>;
}

// ─── extractItemD2S ─────────────────────────────────────────────

/**
 * Extract an item from a .d2s save by its item ID.
 *
 * Removes the item (and its socketed sub-items) from the character,
 * rewrites the save with a corrected checksum, and returns the patched file
 * plus the extracted item.
 *
 * @param buffer   Original .d2s file bytes.
 * @param itemId   The item ID to extract (numeric or string key in items dict).
 * @param gd       GameData instance.
 */
export function extractItemD2S(
  buffer: Uint8Array,
  itemId: number | string,
  gd: GameData,
): ExtractResult {
  const { profile, items } = readD2S(buffer, gd);
  const allItems = items as Record<number | string, BinaryParsedItem>;

  const item = allItems[itemId];
  if (!item) {
    throw new Error(`ITEM_NOT_FOUND: item '${itemId}' not found in d2s`);
  }

  // Collect all IDs to remove (item + its socketed sub-items)
  const removeIds = collectItemAndSockets(item, allItems);

  // Remove from profile arrays
  removeFromSlotArray(profile.stash, removeIds);
  removeFromSlotArray(profile.inventory, removeIds);
  removeFromSlotArray(profile.cube, removeIds);
  removeFromSlotArray(profile.belt, removeIds);
  if (profile.items) removeFromStringRecord(profile.items, removeIds);
  if (profile.mercItems) removeFromStringRecord(profile.mercItems, removeIds);
  if (profile.ironGolem !== undefined && removeIds.has(profile.ironGolem)) {
    profile.ironGolem = undefined;
  }

  // Build clean items dict
  const cleanItems = { ...allItems };
  for (const rid of removeIds) {
    delete cleanItems[rid];
  }

  // Rebuild extracted items dict
  const extractedAllItems: Record<number | string, BinaryParsedItem> = {};
  for (const rid of removeIds) {
    if (allItems[rid]) extractedAllItems[rid] = allItems[rid];
  }

  // Rewrite D2S
  const newBuffer = writeD2S({ profile: profile as D2SCharacterProfile, items: cleanItems, gd });

  return { newBuffer, extractedItem: item, extractedAllItems };
}

// ─── extractItemD2I ─────────────────────────────────────────────

/**
 * Extract an item from a .d2i stash by page and position.
 *
 * @param buffer     Original .d2i file bytes.
 * @param pageIndex  Zero-based page index.
 * @param x          Column in the stash grid.
 * @param y          Row in the stash grid.
 * @param gd         GameData instance.
 */
export function extractItemD2I(
  buffer: Uint8Array,
  pageIndex: number,
  x: number,
  y: number,
  gd: GameData,
): ExtractResult {
  const parsed = readD2I(buffer, gd);
  const { pages } = parsed;
  const items = parsed.items as Record<number | string, BinaryParsedItem>;

  const page = pages[pageIndex];
  if (!page) {
    throw new Error(`PAGE_NOT_FOUND: page ${pageIndex} not found`);
  }

  // Find item at (x, y) in this page's stash array
  const columns = getPageColumns(page);
  const slotIndex = y * columns + x;
  const itemIdAtSlot = page.stash[slotIndex];

  if (itemIdAtSlot == null) {
    throw new Error(`ITEM_NOT_FOUND: no item at page ${pageIndex}, (${x}, ${y})`);
  }

  const item = items[itemIdAtSlot];
  if (!item) {
    throw new Error(`ITEM_NOT_FOUND: item ${itemIdAtSlot} not in items dict`);
  }

  // Collect IDs to remove
  const removeIds = collectItemAndSockets(item, items);

  // Remove from the page's stash array
  removeFromSlotArray(page.stash, removeIds);

  // Build clean items dict
  const cleanItems: Record<number | string, BinaryParsedItem> = { ...items };
  for (const rid of removeIds) {
    delete cleanItems[rid];
  }

  // Extracted items
  const extractedAllItems: Record<number | string, BinaryParsedItem> = {};
  for (const rid of removeIds) {
    if (items[rid]) extractedAllItems[rid] = items[rid];
  }

  // Rebuild the page using patchStashPage
  const writePage = buildWritePageFromD2I(page, cleanItems, gd, columns);
  const newBuffer = patchStashPage(buffer, findRawPageIndex(pages, pageIndex), writePage, cleanItems, gd);

  return { newBuffer, extractedItem: item, extractedAllItems };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Collect an item and all its socketed sub-item IDs. */
function collectItemAndSockets(
  item: BinaryParsedItem,
  allItems: Record<number | string, BinaryParsedItem>,
): Set<number | string> {
  const ids = new Set<number | string>();
  ids.add(item.itemId);

  if (item.socketedItems) {
    for (const sid of item.socketedItems) {
      ids.add(sid);
      // Recursively, though sockets-in-sockets doesn't exist in D2R
      const sub = allItems[sid];
      if (sub?.socketedItems) {
        for (const ssid of sub.socketedItems) ids.add(ssid);
      }
    }
  }

  return ids;
}

/** Remove item IDs from a slot array (set matching slots to undefined). */
function removeFromSlotArray(
  slots: (number | undefined)[],
  removeIds: Set<number | string>,
): void {
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== undefined && removeIds.has(slots[i]!)) {
      slots[i] = undefined;
    }
  }
}

/** Remove item IDs from a string-keyed record (profile.items / profile.mercItems). */
function removeFromStringRecord(
  record: Record<string, number>,
  removeIds: Set<number | string>,
): void {
  for (const [key, val] of Object.entries(record)) {
    if (removeIds.has(val)) {
      delete record[key];
    }
  }
}

/** Get the number of columns for a stash page. */
function getPageColumns(page: D2IStashPage): number {
  if (page.pageType === 'gems' || page.pageType === 'runes') return 16;
  if (page.pageType === 'misc') return 10;
  return 16; // Normal stash page
}

/**
 * Build a WriteStashPage from a D2IStashPage for patching.
 *
 * For normal pages (pageType=0), we build entries from the stash array.
 * For extended/virtual pages, we delegate to buildStashWritePages.
 */
function buildWritePageFromD2I(
  page: D2IStashPage,
  items: Record<number | string, BinaryParsedItem>,
  gd: GameData,
  columns: number,
): WriteStashPage {
  const entries: ItemWriteEntry[] = [];

  for (let slot = 0; slot < page.stash.length; slot++) {
    const id = page.stash[slot];
    if (id == null) continue;
    const item = items[id];
    if (!item) continue;

    // Skip socketed sub-items — they're part of their parent
    const isSocketed = Object.values(items).some(
      i => i.socketedItems?.includes(id as number),
    );
    if (isSocketed) continue;

    const x = slot % columns;
    const y = Math.floor(slot / columns);
    const location: ItemWriteLocation = { loc: 0, equip: 0, x, y, storage: 5 };
    entries.push({ item, location });
  }

  return {
    pageType: typeof page.pageType === 'number' ? page.pageType : 0,
    gold: page.gold,
    entries,
  };
}

/**
 * Find the raw page index for patchStashPage.
 *
 * For normal d2i pages (pageType=0), the raw index matches the page index.
 * For extended virtual sub-pages (gems/runes/misc), we need the index of
 * the original extended page in the raw sector order.
 *
 * Since we only extract from normal pages and the raw d2i file has sequential
 * sectors, the page's own index (in the parsed pages array) maps to the
 * raw sector order after accounting for extended page splits.
 */
function findRawPageIndex(pages: D2IStashPage[], targetPageIndex: number): number {
  // The page stores its byte offset. Count unique offsets up to this page
  // to find the raw sector index.
  const targetOffset = pages[targetPageIndex].offset;
  const seenOffsets = new Set<number>();
  for (let i = 0; i < pages.length; i++) {
    const off = pages[i].offset;
    if (off === targetOffset) return seenOffsets.size;
    seenOffsets.add(off);
  }
  // Fallback: the page's own index
  return targetPageIndex;
}
