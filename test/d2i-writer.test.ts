import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2I, type D2IStashPage } from '../src/formats/d2i-reader.js';
import {
  writeStash,
  buildStashWritePages,
  patchStashPage,
  type WriteStashPage,
} from '../src/formats/d2i-writer.js';
import { writeItemList, type ItemWriteEntry } from '../src/formats/item-writer.js';
import { detectFormat } from '../src/formats/detect.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('D2I writer', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── Write from scratch ───────────────────────────────────────

  describe('write from scratch', () => {
    it('writes a valid empty stash page', () => {
      const pages: WriteStashPage[] = [{
        pageType: 0,
        gold: 0,
        entries: [],
      }];
      const bytes = writeStash(pages, {}, gd);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThanOrEqual(64 + 4); // header + JM + count
    });

    it('produces valid d2i format header', () => {
      const pages: WriteStashPage[] = [{
        pageType: 0,
        gold: 100000,
        entries: [],
      }];
      const bytes = writeStash(pages, {}, gd);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(dv.getUint32(0, true)).toBe(0xaa55aa55);  // magic
      expect(dv.getUint32(4, true)).toBe(2);            // mode
      expect(dv.getUint32(8, true)).toBe(105);           // version
      expect(dv.getUint32(12, true)).toBe(100000);       // gold
      expect(dv.getUint32(16, true)).toBe(bytes.length); // sectorSize
      expect(bytes[20]).toBe(0);                          // pageType
    });

    it('is detected as valid d2i v105', () => {
      const pages: WriteStashPage[] = [{
        pageType: 0,
        gold: 0,
        entries: [],
      }];
      const bytes = writeStash(pages, {}, gd);
      const fmt = detectFormat(bytes);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2i');
      expect(fmt!.version).toBe(105);
    });

    it('empty stash can be parsed back', () => {
      const pages: WriteStashPage[] = [{
        pageType: 0,
        gold: 500000,
        entries: [],
      }];
      const bytes = writeStash(pages, {}, gd);
      const result = readD2I(bytes, gd);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].gold).toBe(500000);
      expect(result.pages[0].pageType).toBe(0);
    });

    it('writes multiple empty pages', () => {
      const pages: WriteStashPage[] = [
        { pageType: 0, gold: 100, entries: [] },
        { pageType: 0, gold: 200, entries: [] },
        { pageType: 0, gold: 300, entries: [] },
      ];
      const bytes = writeStash(pages, {}, gd);
      const result = readD2I(bytes, gd);
      expect(result.pages).toHaveLength(3);
      expect(result.pages[0].gold).toBe(100);
      expect(result.pages[1].gold).toBe(200);
      expect(result.pages[2].gold).toBe(300);
    });
  });

  // ─── Roundtrip: read → write → read ──────────────────────────

  describe('roundtrip: read → write → read', () => {
    it('SharedStashSoftCoreV2V105_.d2i preserves page count', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);
      const bytes = writeStash(writePages, parsed.items, gd);
      const reparsed = readD2I(bytes, gd);

      // The smaller fixture has 3 normal pages
      expect(reparsed.pages).toHaveLength(parsed.pages.length);
    });

    it('SharedStashSoftCoreV2V105_.d2i preserves gold values', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);
      const bytes = writeStash(writePages, parsed.items, gd);
      const reparsed = readD2I(bytes, gd);

      for (let i = 0; i < parsed.pages.length; i++) {
        expect(reparsed.pages[i].gold).toBe(parsed.pages[i].gold);
      }
    });

    it('SharedStashSoftCoreV2V105_.d2i preserves item count', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);
      const originalItemCount = Object.keys(parsed.items).length;

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);
      const bytes = writeStash(writePages, parsed.items, gd);
      const reparsed = readD2I(bytes, gd);
      const newItemCount = Object.keys(reparsed.items).length;

      expect(newItemCount).toBe(originalItemCount);
    });

    it('SharedStashSoftCoreV2V105.d2i normal pages preserve item count', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);

      // Count items only in normal pages
      const normalPages = parsed.pages.filter(p => p.pageType === 0);
      const normalItemIds = new Set<number>();
      for (const page of normalPages) {
        for (const id of page.stash) {
          if (id != null) normalItemIds.add(id);
        }
      }

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);
      const bytes = writeStash(writePages, parsed.items, gd);
      const reparsed = readD2I(bytes, gd);

      const newNormalPages = reparsed.pages.filter(p => p.pageType === 0);
      const newNormalItemIds = new Set<number>();
      for (const page of newNormalPages) {
        for (const id of page.stash) {
          if (id != null) newNormalItemIds.add(id);
        }
      }

      expect(newNormalItemIds.size).toBe(normalItemIds.size);
    });

    it('SharedStashSoftCoreV2V105_.d2i preserves item bases', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);

      // Collect all base codes from original parse
      const originalBases = new Map<number, string>();
      for (const [id, item] of Object.entries(parsed.items)) {
        originalBases.set(Number(id), item.base);
      }

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);
      const bytes = writeStash(writePages, parsed.items, gd);
      const reparsed = readD2I(bytes, gd);

      // Verify every item base matches (by position in reparsed)
      const reparsedBases = Object.values(reparsed.items).map(i => i.base).sort();
      const origBases = Object.values(parsed.items).map(i => i.base).sort();
      expect(reparsedBases).toEqual(origBases);
    });
  });

  // ─── patchStashPage ───────────────────────────────────────────

  describe('patchStashPage', () => {
    it('patches a page without affecting others', () => {
      // Create a 3-page stash
      const pages: WriteStashPage[] = [
        { pageType: 0, gold: 100, entries: [] },
        { pageType: 0, gold: 200, entries: [] },
        { pageType: 0, gold: 300, entries: [] },
      ];
      const original = writeStash(pages, {}, gd);

      // Patch page 1 with new gold
      const patched = patchStashPage(
        original,
        1,
        { pageType: 0, gold: 999, entries: [] },
        {},
        gd,
      );

      const result = readD2I(patched, gd);
      expect(result.pages).toHaveLength(3);
      expect(result.pages[0].gold).toBe(100);   // unchanged
      expect(result.pages[1].gold).toBe(999);    // patched
      expect(result.pages[2].gold).toBe(300);    // unchanged
    });

    it('patches a page in a real d2i file', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const buf = new Uint8Array(original);
      const parsed = readD2I(buf, gd);

      // Patch page 0 to be empty with different gold
      const patched = patchStashPage(
        buf,
        0,
        { pageType: 0, gold: 42, entries: [] },
        parsed.items,
        gd,
      );

      const result = readD2I(patched, gd);
      expect(result.pages[0].gold).toBe(42);
      expect(result.pages[0].stash.filter(Boolean)).toHaveLength(0);
      // Other pages should still be readable
      expect(result.pages.length).toBeGreaterThanOrEqual(2);
    });

    it('preserves other pages when patching middle page', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const buf = new Uint8Array(original);
      const parsedBefore = readD2I(buf, gd);

      // Count items on page 2 (index 2)
      const page2ItemsBefore = parsedBefore.pages[2]?.stash.filter(Boolean).length ?? 0;

      // Patch page 1
      const patched = patchStashPage(
        buf,
        1,
        { pageType: 0, gold: 0, entries: [] },
        parsedBefore.items,
        gd,
      );

      const parsedAfter = readD2I(patched, gd);
      const page2ItemsAfter = parsedAfter.pages[2]?.stash.filter(Boolean).length ?? 0;
      expect(page2ItemsAfter).toBe(page2ItemsBefore);
    });
  });

  // ─── buildStashWritePages ─────────────────────────────────────

  describe('buildStashWritePages', () => {
    it('converts normal pages correctly', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);
      expect(writePages.length).toBe(parsed.pages.length);
      for (const wp of writePages) {
        expect(wp.pageType).toBe(0);
      }
    });

    it('merges extended sub-pages back to one page', () => {
      const original = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i'));
      const parsed = readD2I(new Uint8Array(original), gd);

      // The main fixture has extended pages (gems/runes/misc)
      const hasExtended = parsed.pages.some(p => typeof p.pageType === 'string');
      if (!hasExtended) return; // skip if no extended pages

      const writePages = buildStashWritePages(parsed.pages, parsed.items, gd);

      // Extended sub-pages should be merged into a single pageType=1 page
      const extWritePages = writePages.filter(wp => wp.pageType === 1);
      expect(extWritePages.length).toBeGreaterThanOrEqual(1);

      // The total entries should cover all items from the 3 sub-pages
      const extSubPages = parsed.pages.filter(p => typeof p.pageType === 'string');
      let totalSubPageItems = 0;
      const missingIds: (number | undefined)[] = [];
      for (const sp of extSubPages) {
        for (const id of sp.stash) {
          if (id != null) {
            totalSubPageItems++;
            if (!parsed.items[id]) missingIds.push(id);
          }
        }
      }
      let totalWriteEntries = 0;
      for (const wp of extWritePages) {
        totalWriteEntries += wp.entries.length;
      }
      // Items that aren't in parsed.items can't be written back
      expect(totalWriteEntries).toBe(totalSubPageItems - missingIds.length);
    });
  });
});
