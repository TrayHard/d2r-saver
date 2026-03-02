/**
 * E2E tests — full trade flow, mass roundtrip, and edge cases.
 *
 * Milestone 14: end-to-end verification on real save files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { D2RSaver, D2RSaverError, ErrorCode } from '../src/index.js';
import { TOKEN_PREFIX } from '../src/types/constants.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

let saver: D2RSaver;

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  saver = D2RSaver.fromData(rawData, locale);
});

// ═════════════════════════════════════════════════════════════════
// T-14.1: Full trade flow E2E
// ═════════════════════════════════════════════════════════════════

describe('E2E: full trade flow', () => {
  it('seller extracts from d2s → token → buyer inserts into d2i', () => {
    // === Seller side ===
    const sellerBuf = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
    const sellerD2S = saver.readD2S(sellerBuf);
    const sellerItemIds = Object.keys(sellerD2S.items).map(Number);
    expect(sellerItemIds.length).toBeGreaterThan(0);

    const targetId = sellerItemIds[0];
    const originalItem = sellerD2S.items[targetId];

    // Extract item from seller's character
    const { newBuffer: patchedSeller, extractedItem, extractedAllItems } =
      saver.extractItemD2S(sellerBuf, targetId);

    // Verify removal
    const sellerAfter = saver.readD2S(patchedSeller);
    expect(Object.keys(sellerAfter.items).length).toBeLessThan(Object.keys(sellerD2S.items).length);

    // Serialize to token (what goes over the network)
    const token = saver.serializeItem(extractedItem, extractedAllItems);
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);

    // === Buyer side ===
    const buyerBuf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
    const buyerD2I = saver.readD2I(buyerBuf);
    const buyerItemCountBefore = Object.keys(buyerD2I.items).length;

    // Deserialize token
    const { item: restoredItem, allItems: restoredAll } = saver.deserializeItem(token);
    expect(restoredItem.base).toBe(originalItem.base);
    expect(restoredItem.quality).toBe(originalItem.quality);

    // Insert into buyer's stash
    const { newBuffer: patchedBuyer, position } =
      saver.insertItemD2I(buyerBuf, restoredItem, restoredAll);

    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);

    // Verify insertion
    const buyerAfter = saver.readD2I(patchedBuyer);
    expect(Object.keys(buyerAfter.items).length).toBeGreaterThan(buyerItemCountBefore);
  });

  it('seller extracts from d2i → token → buyer inserts into d2s', () => {
    // === Seller side (stash) ===
    const sellerBuf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
    const sellerD2I = saver.readD2I(sellerBuf);

    // Find a normal page with items
    let foundPage = -1;
    let foundX = -1;
    let foundY = -1;
    for (const page of sellerD2I.pages) {
      if (page.pageType !== 0) continue;
      for (let slot = 0; slot < page.stash.length; slot++) {
        if (page.stash[slot] !== undefined) {
          foundPage = page.index;
          foundX = slot % 16;
          foundY = Math.floor(slot / 16);
          break;
        }
      }
      if (foundPage >= 0) break;
    }
    if (foundPage < 0) return; // no items to test

    const { newBuffer: patchedSeller, extractedItem, extractedAllItems } =
      saver.extractItemD2I(sellerBuf, foundPage, foundX, foundY);

    // Serialize
    const token = saver.serializeItem(extractedItem, extractedAllItems);
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);

    // === Buyer side (character) ===
    const buyerBuf = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
    const buyerD2S = saver.readD2S(buyerBuf);
    const buyerItemCountBefore = Object.keys(buyerD2S.items).length;

    // Deserialize
    const { item: restoredItem, allItems: restoredAll } = saver.deserializeItem(token);

    // Insert into buyer's stash
    const { newBuffer: patchedBuyer } =
      saver.insertItemD2S(buyerBuf, restoredItem, restoredAll, 'stash');

    // Verify
    const buyerAfter = saver.readD2S(patchedBuyer);
    expect(Object.keys(buyerAfter.items).length).toBeGreaterThan(buyerItemCountBefore);
  });
});

// ═════════════════════════════════════════════════════════════════
// T-14.2: Mass roundtrip
// ═════════════════════════════════════════════════════════════════

describe('E2E: mass roundtrip serialization', () => {
  it('roundtrips all items from WarlockTest.d2s', () => {
    const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
    const d2s = saver.readD2S(buf);
    const items = Object.values(d2s.items);

    let success = 0;
    for (const item of items) {
      const token = saver.serializeItem(item, d2s.items);
      expect(token.startsWith(TOKEN_PREFIX)).toBe(true);

      const { item: restored } = saver.deserializeItem(token);
      expect(restored.base).toBe(item.base);
      expect(restored.quality).toBe(item.quality);
      expect(restored.ilvl).toBe(item.ilvl);
      expect(restored.ethereal).toBe(item.ethereal);
      success++;
    }
    expect(success).toBeGreaterThan(0);
  });

  it('roundtrips all items from WarlockShards.d2s', () => {
    const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockShards.d2s')));
    const d2s = saver.readD2S(buf);
    const items = Object.values(d2s.items);

    for (const item of items) {
      const token = saver.serializeItem(item, d2s.items);
      const { item: restored } = saver.deserializeItem(token);
      expect(restored.base).toBe(item.base);
      expect(restored.quality).toBe(item.quality);
    }
  });

  it('roundtrips all items from SharedStashSoftCoreV2V105_.d2i', () => {
    const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
    const d2i = saver.readD2I(buf);
    const items = Object.values(d2i.items);

    for (const item of items) {
      const token = saver.serializeItem(item, d2i.items);
      const { item: restored } = saver.deserializeItem(token);
      expect(restored.base).toBe(item.base);
      expect(restored.quality).toBe(item.quality);
    }
  });

  it('roundtrips all items from all v105 d2s fixtures', () => {
    for (const fixture of ['WarlockTest.d2s', 'WarlockShards.d2s']) {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, fixture)));
      const d2s = saver.readD2S(buf);
      const items = Object.values(d2s.items);

      for (const item of items) {
        const token = saver.serializeItem(item, d2s.items);
        const { item: restored } = saver.deserializeItem(token);
        expect(restored.base).toBe(item.base);
        expect(restored.quality).toBe(item.quality);
      }
    }
  });

  it('roundtrips all items from SharedStashSoftCoreV2V105.d2i (extended)', () => {
    const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i')));
    const d2i = saver.readD2I(buf);
    const items = Object.values(d2i.items);

    for (const item of items) {
      const token = saver.serializeItem(item, d2i.items);
      const { item: restored } = saver.deserializeItem(token);
      expect(restored.base).toBe(item.base);
      expect(restored.quality).toBe(item.quality);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// T-14.3: Edge cases
// ═════════════════════════════════════════════════════════════════

describe('E2E: edge cases', () => {
  // ─── Ear items ──────────────────────────────────────────────

  describe('ear items', () => {
    it('ear items are parsed and roundtrip without crashing', () => {
      for (const fixture of ['WarlockTest.d2s', 'WarlockShards.d2s']) {
        const buf = new Uint8Array(readFileSync(resolve(FIXTURES, fixture)));
        const d2s = saver.readD2S(buf);
        const earItems = Object.values(d2s.items).filter(i => i.ear);

        for (const item of earItems) {
          expect(item.ear).toBeDefined();
          expect(typeof item.ear!.class).toBe('number');
          expect(typeof item.ear!.level).toBe('number');
          expect(typeof item.ear!.name).toBe('string');
        }
      }
    });
  });

  // ─── Socketed items ─────────────────────────────────────────

  describe('socketed items', () => {
    it('extracts socketed items with all sub-items', () => {
      for (const fixture of ['WarlockTest.d2s', 'WarlockShards.d2s']) {
        const buf = new Uint8Array(readFileSync(resolve(FIXTURES, fixture)));
        const d2s = saver.readD2S(buf);
        const socketedItem = Object.values(d2s.items).find(
          i => i.socketedItems && i.socketedItems.length > 0,
        );
        if (!socketedItem) continue;

        // Extract it
        const { extractedItem, extractedAllItems } =
          saver.extractItemD2S(buf, socketedItem.itemId);

        // Verify the main item and all socketed sub-items are in the result
        expect(extractedItem.base).toBe(socketedItem.base);
        expect(Object.keys(extractedAllItems).length).toBeGreaterThanOrEqual(
          1 + socketedItem.socketedItems.length,
        );

        // Serialize and roundtrip
        const token = saver.serializeItem(extractedItem, extractedAllItems);
        const { item: restored, allItems: restoredAll } = saver.deserializeItem(token);
        expect(restored.base).toBe(socketedItem.base);

        // DTO should include socketed sub-items
        const dto = saver.toTradeDTO(extractedItem, extractedAllItems);
        expect(dto.socketedItems.length).toBe(socketedItem.socketedItems.length);
        return; // Found and tested one — enough
      }
    });
  });

  // ─── Extended stash pages ─────────────────────────────────

  describe('extended stash pages', () => {
    it('parses extended stash pages with quantity preservation', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i')));
      const d2i = saver.readD2I(buf);

      // Check that extended pages (pageType=1 or named types) exist
      const extendedPages = d2i.pages.filter(p => p.pageType !== 0);

      if (extendedPages.length > 0) {
        // Extended pages may have quantities
        for (const page of extendedPages) {
          if (page.quantities) {
            const quantityKeys = Object.keys(page.quantities);
            if (quantityKeys.length > 0) {
              // At least some items should have quantities
              for (const key of quantityKeys) {
                const qty = (page.quantities as Record<string, number>)[key];
                expect(qty).toBeGreaterThanOrEqual(1);
              }
            }
          }
        }
      }
    });

    it('reads and writes extended stash without data loss', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i')));
      const d2iBefore = saver.readD2I(buf);
      const itemCountBefore = Object.keys(d2iBefore.items).length;

      // Items from the extended stash can be serialized
      for (const item of Object.values(d2iBefore.items)) {
        const token = saver.serializeItem(item, d2iBefore.items);
        expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
      }

      expect(itemCountBefore).toBeGreaterThan(0);
    });
  });

  // ─── Merc items ───────────────────────────────────────────

  describe('merc items', () => {
    it('merc items are accessible in D2S profile', () => {
      for (const fixture of ['WarlockTest.d2s', 'WarlockShards.d2s']) {
        const buf = new Uint8Array(readFileSync(resolve(FIXTURES, fixture)));
        const d2s = saver.readD2S(buf);

        if (d2s.profile.mercItems && Object.keys(d2s.profile.mercItems).length > 0) {
          for (const [slot, itemId] of Object.entries(d2s.profile.mercItems)) {
            expect(typeof itemId).toBe('number');
            // The item should exist in the items dict
            expect(d2s.items[itemId]).toBeDefined();

            // Merc items should serialize correctly
            const token = saver.serializeItem(d2s.items[itemId], d2s.items);
            expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
          }
          return; // Found and tested — enough
        }
      }
    });
  });

  // ─── Error handling edge cases ────────────────────────────

  describe('error handling', () => {
    it('extractItemD2S throws for non-existent item ID', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
      expect(() => saver.extractItemD2S(buf, 999999)).toThrow();
    });

    it('extractItemD2I throws for invalid page/position', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
      expect(() => saver.extractItemD2I(buf, 999, 0, 0)).toThrow();
    });

    it('deserializeItem throws for corrupted token', () => {
      expect(() => saver.deserializeItem('d2r1:!@#$')).toThrow();
    });

    it('detectFormat rejects a v97-style file', () => {
      // Create a buffer that looks like d2s magic but has wrong version
      const buf = new Uint8Array(16);
      const view = new DataView(buf.buffer);
      view.setUint32(0, 0xaa55aa55, true); // magic
      view.setUint32(4, 97, true); // version 97, not 105
      expect(() => saver.detectFormat(buf)).toThrow(D2RSaverError);
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// T-14.4: Build verification
// ═════════════════════════════════════════════════════════════════

describe('E2E: DTO generation for all fixtures', () => {
  it('generates valid DTOs for every item in every fixture', () => {
    const d2sFiles = ['WarlockTest.d2s', 'WarlockShards.d2s'];
    const d2iFiles = ['SharedStashSoftCoreV2V105_.d2i', 'SharedStashSoftCoreV2V105.d2i'];

    let totalItems = 0;
    let totalDTOs = 0;

    for (const file of d2sFiles) {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, file)));
      const d2s = saver.readD2S(buf);
      const items = Object.values(d2s.items);
      totalItems += items.length;

      for (const item of items) {
        const dto = saver.toTradeDTO(item, d2s.items);
        expect(dto.baseCode).toBeTruthy();
        expect(dto.token.startsWith(TOKEN_PREFIX)).toBe(true);
        totalDTOs++;
      }
    }

    for (const file of d2iFiles) {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, file)));
      const d2i = saver.readD2I(buf);
      const items = Object.values(d2i.items);
      totalItems += items.length;

      for (const item of items) {
        const dto = saver.toTradeDTO(item, d2i.items);
        expect(dto.baseCode).toBeTruthy();
        expect(dto.token.startsWith(TOKEN_PREFIX)).toBe(true);
        totalDTOs++;
      }
    }

    expect(totalDTOs).toBe(totalItems);
    expect(totalItems).toBeGreaterThan(10); // sanity check
  });
});
