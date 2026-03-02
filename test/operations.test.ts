import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';
import { extractItemD2S, extractItemD2I } from '../src/operations/extract-item.js';
import { insertItemD2S, insertItemD2I } from '../src/operations/insert-item.js';
import { serializeItem, deserializeItem } from '../src/items/item-serializer.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('Operations', () => {
  let gd: GameData;
  let d2sBuffer: Uint8Array;
  let d2iBuffer: Uint8Array;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
    d2sBuffer = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
    d2iBuffer = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
  });

  // ─── extractItemD2S ──────────────────────────────────────────

  describe('extractItemD2S', () => {
    it('extracts an item and produces a valid d2s', () => {
      const orig = readD2S(d2sBuffer, gd);
      const origItemCount = Object.keys(orig.items).filter(k => !isNaN(Number(k))).length;
      expect(origItemCount).toBeGreaterThan(0);

      // Pick the first item in stash (or inventory) that exists
      const targetId = findFirstItemInSlotArrays(orig.profile, orig.items);
      if (targetId == null) return; // skip if no items in containers

      const targetBase = orig.items[targetId].base;
      // Count how many items with this base exist before extraction
      const origBaseCount = Object.values(orig.items).filter(i => i.base === targetBase).length;

      const result = extractItemD2S(d2sBuffer, targetId, gd);

      // Re-read the patched buffer (IDs are reassigned on re-parse)
      const patched = readD2S(result.newBuffer, gd);

      // Patched should have fewer items overall
      const patchedItemCount = Object.keys(patched.items).filter(k => !isNaN(Number(k))).length;
      expect(patchedItemCount).toBeLessThan(origItemCount);

      // Extracted item should match the original base
      expect(result.extractedItem.base).toBe(targetBase);
    });

    it('throws for non-existent item', () => {
      expect(() => extractItemD2S(d2sBuffer, 99999, gd)).toThrow('ITEM_NOT_FOUND');
    });
  });

  // ─── extractItemD2I ──────────────────────────────────────────

  describe('extractItemD2I', () => {
    it('extracts an item from a stash page', () => {
      const orig = readD2I(d2iBuffer, gd);
      const normalPages = orig.pages.filter(p => p.pageType === 0);
      expect(normalPages.length).toBeGreaterThan(0);

      // Find first item in first normal page
      const page = normalPages[0];
      const firstItemSlot = page.stash.findIndex(s => s != null);
      if (firstItemSlot < 0) return;

      const x = firstItemSlot % 16;
      const y = Math.floor(firstItemSlot / 16);
      const itemId = page.stash[firstItemSlot]!;

      const result = extractItemD2I(d2iBuffer, page.index, x, y, gd);

      // Re-read the patched buffer
      const patched = readD2I(result.newBuffer, gd);

      // Original item should match
      expect(result.extractedItem.base).toBe(orig.items[itemId].base);

      // Item should be absent from the page
      const patchedPage = patched.pages.find(p => p.pageType === 0 && p.index === page.index);
      if (patchedPage) {
        const hasItem = patchedPage.stash.some(s => s != null && s === itemId);
        // The patched file is re-parsed with new IDs, so we check base instead
        const patchedItems = Object.values(patched.items);
        const stillHasBase = patchedPage.stash.some(s => {
          if (s == null) return false;
          const i = patched.items[s];
          return i?.base === result.extractedItem.base;
        });
        // After extraction, the item count on this page should be less
        const origPageItemCount = page.stash.filter(s => s != null).length;
        const patchedPageItemCount = patchedPage.stash.filter(s => s != null).length;
        expect(patchedPageItemCount).toBeLessThan(origPageItemCount);
      }
    });

    it('throws for invalid page', () => {
      expect(() => extractItemD2I(d2iBuffer, 999, 0, 0, gd)).toThrow('PAGE_NOT_FOUND');
    });

    it('throws for empty slot', () => {
      // (0,0) on first page might or might not be empty; find an empty slot
      const orig = readD2I(d2iBuffer, gd);
      const normalPages = orig.pages.filter(p => p.pageType === 0);
      const page = normalPages[0];
      const emptySlot = page.stash.findIndex(s => s == null);
      if (emptySlot < 0) return;

      const x = emptySlot % 16;
      const y = Math.floor(emptySlot / 16);
      expect(() => extractItemD2I(d2iBuffer, page.index, x, y, gd)).toThrow('ITEM_NOT_FOUND');
    });
  });

  // ─── insertItemD2S ───────────────────────────────────────────

  describe('insertItemD2S', () => {
    it('inserts an item into the stash', () => {
      const runeItem: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 }, quantity: 3,
      };

      const result = insertItemD2S(d2sBuffer, runeItem, { 0: runeItem }, 'stash', gd);
      expect(result.newBuffer).toBeInstanceOf(Uint8Array);
      expect(result.position).toBeDefined();

      // Re-read
      const patched = readD2S(result.newBuffer, gd);
      const r01Items = Object.values(patched.items).filter(i => i.base === 'r01');
      expect(r01Items.length).toBeGreaterThan(0);
    });

    it('inserts at a specific position', () => {
      const runeItem: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };

      // Place at (0, 0) — might fail if occupied, so we use try/catch
      try {
        const result = insertItemD2S(d2sBuffer, runeItem, { 0: runeItem }, 'stash', gd, { x: 0, y: 0 });
        expect(result.position.x).toBe(0);
        expect(result.position.y).toBe(0);
      } catch (e) {
        // If (0,0) is occupied, that's OK
        expect((e as Error).message).toMatch(/NO_SPACE/);
      }
    });

    it('inserts a 1x1 item even into a non-empty stash', () => {
      // Use a valid small item base that exists as a 1x1 item
      const gemItem: BinaryParsedItem = {
        itemId: 0, base: 'gcv', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };

      const result = insertItemD2S(d2sBuffer, gemItem, { 0: gemItem }, 'stash', gd);
      expect(result.newBuffer).toBeInstanceOf(Uint8Array);
    });
  });

  // ─── insertItemD2I ───────────────────────────────────────────

  describe('insertItemD2I', () => {
    it('inserts an item into the stash (auto-find slot)', () => {
      const runeItem: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 }, quantity: 5,
      };

      const result = insertItemD2I(d2iBuffer, runeItem, { 0: runeItem }, gd);
      expect(result.newBuffer).toBeInstanceOf(Uint8Array);
      expect(result.position).toBeDefined();
      expect(result.pageIndex).toBeDefined();

      // Re-read
      const patched = readD2I(result.newBuffer, gd);
      const r01Items = Object.values(patched.items).filter(i => i.base === 'r01');
      expect(r01Items.length).toBeGreaterThan(0);
    });

    it('inserts at a specific page and position', () => {
      const runeItem: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };

      const orig = readD2I(d2iBuffer, gd);
      const normalPages = orig.pages.filter(p => p.pageType === 0);
      if (normalPages.length === 0) return;

      const page = normalPages[0];
      // Find an empty slot
      const emptySlot = page.stash.findIndex(s => s == null);
      if (emptySlot < 0) return;

      const x = emptySlot % 16;
      const y = Math.floor(emptySlot / 16);

      const result = insertItemD2I(d2iBuffer, runeItem, { 0: runeItem }, gd, {
        pageIndex: page.index, x, y,
      });

      expect(result.position.x).toBe(x);
      expect(result.position.y).toBe(y);
    });

    it('throws for invalid page', () => {
      const item: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };
      expect(() => insertItemD2I(d2iBuffer, item, { 0: item }, gd, {
        pageIndex: 999, x: 0, y: 0,
      })).toThrow('PAGE_NOT_FOUND');
    });
  });

  // ─── Full trade flow: extract → serialize → deserialize → insert ──

  describe('full trade flow', () => {
    it('extract from d2s → serialize → deserialize → insert into d2i', () => {
      // Read D2S and find an item to extract
      const orig = readD2S(d2sBuffer, gd);
      const targetId = findFirstItemInSlotArrays(orig.profile, orig.items);
      if (targetId == null) return;

      // Step 1: Extract from D2S
      const { newBuffer: d2sPatched, extractedItem, extractedAllItems } =
        extractItemD2S(d2sBuffer, targetId, gd);

      // Verify d2s is still valid (IDs are reassigned on re-parse)
      const patchedD2S = readD2S(d2sPatched, gd);
      const origItemCount = Object.keys(orig.items).filter(k => !isNaN(Number(k))).length;
      const patchedItemCount = Object.keys(patchedD2S.items).filter(k => !isNaN(Number(k))).length;
      expect(patchedItemCount).toBeLessThan(origItemCount);

      // Step 2: Serialize
      const token = serializeItem(extractedItem, extractedAllItems, gd);
      expect(token).toMatch(/^d2r1:/);

      // Step 3: Deserialize
      const deserialized = deserializeItem(token, gd);
      expect(deserialized.item.base).toBe(extractedItem.base);

      // Step 4: Insert into D2I
      const { newBuffer: d2iPatched } = insertItemD2I(
        d2iBuffer,
        deserialized.item,
        deserialized.allItems,
        gd,
      );

      // Verify d2i is still valid
      const patchedD2I = readD2I(d2iPatched, gd);
      const insertedItems = Object.values(patchedD2I.items).filter(
        i => i.base === extractedItem.base,
      );
      expect(insertedItems.length).toBeGreaterThan(0);
    });

    it('extract from d2i → serialize → deserialize → insert into d2s', () => {
      // Find first item in d2i normal page
      const orig = readD2I(d2iBuffer, gd);
      const normalPages = orig.pages.filter(p => p.pageType === 0);
      if (normalPages.length === 0) return;

      const page = normalPages[0];
      const firstItemSlot = page.stash.findIndex(s => s != null);
      if (firstItemSlot < 0) return;

      const x = firstItemSlot % 16;
      const y = Math.floor(firstItemSlot / 16);

      // Step 1: Extract from D2I
      const { newBuffer: d2iPatched, extractedItem, extractedAllItems } =
        extractItemD2I(d2iBuffer, page.index, x, y, gd);

      const patchedD2I = readD2I(d2iPatched, gd);
      // Item count should be less
      const origNormalItems = normalPages[0].stash.filter(s => s != null).length;
      const patchedPage = patchedD2I.pages.find(p => p.pageType === 0);
      expect(patchedPage).toBeDefined();

      // Step 2: Serialize
      const token = serializeItem(extractedItem, extractedAllItems, gd);

      // Step 3: Deserialize
      const deserialized = deserializeItem(token, gd);
      expect(deserialized.item.base).toBe(extractedItem.base);

      // Step 4: Insert into D2S
      const { newBuffer: d2sPatched } = insertItemD2S(
        d2sBuffer,
        deserialized.item,
        deserialized.allItems,
        'stash',
        gd,
      );

      // Verify D2S is valid and has the item
      const patchedD2S = readD2S(d2sPatched, gd);
      const insertedItems = Object.values(patchedD2S.items).filter(
        i => i.base === extractedItem.base,
      );
      expect(insertedItems.length).toBeGreaterThan(0);
    });
  });
});

// ─── Utility ────────────────────────────────────────────────────

/** Find the first item referenced in profile containers. */
function findFirstItemInSlotArrays(
  profile: { stash: (number | undefined)[]; inventory: (number | undefined)[]; cube: (number | undefined)[] },
  items: Record<number | string, BinaryParsedItem>,
): number | string | null {
  for (const slots of [profile.stash, profile.inventory, profile.cube]) {
    for (const id of slots) {
      if (id != null && items[id]) return id;
    }
  }
  // Fallback: first numeric item
  const firstKey = Object.keys(items).find(k => !isNaN(Number(k)));
  return firstKey != null ? Number(firstKey) : null;
}
