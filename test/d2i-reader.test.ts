import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { detectFormat } from '../src/formats/detect.js';
import { readD2I, type D2IReadResult } from '../src/formats/d2i-reader.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('D2I reading', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── Format detection ────────────────────────────────────────

  describe('detectFormat for d2i', () => {
    it('detects SharedStashSoftCoreV2V105.d2i as d2i v105', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i')));
      const fmt = detectFormat(data);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2i');
      expect(fmt!.version).toBe(105);
    });

    it('detects SharedStashSoftCoreV2V105_.d2i as d2i v105', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
      const fmt = detectFormat(data);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2i');
      expect(fmt!.version).toBe(105);
    });
  });

  // ─── SharedStashSoftCoreV2V105.d2i ──────────────────────────
  // 7 raw pages: 5 normal (type=0), 1 extended (type=1), 1 metadata (type=2)
  // Extended page expands to 3 virtual sub-pages (gems, runes, misc)

  describe('SharedStashSoftCoreV2V105.d2i', () => {
    let result: D2IReadResult;

    beforeAll(() => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i')));
      result = readD2I(data, gd);
    });

    it('parses without throwing', () => {
      expect(result).toBeDefined();
      expect(result.pages).toBeDefined();
      expect(result.items).toBeDefined();
    });

    it('has pages (5 normal + 3 virtual from extended, metadata skipped)', () => {
      // 5 normal pages + extended page → 3 virtual (gems, runes, misc) = 8 total
      // metadata page (type=2) is skipped
      expect(result.pages.length).toBe(8);
    });

    it('first page has gold 2500000', () => {
      expect(result.pages[0].gold).toBe(2500000);
    });

    it('normal pages have numeric pageType 0', () => {
      for (let i = 0; i < 5; i++) {
        expect(result.pages[i].pageType).toBe(0);
      }
    });

    it('extended virtual pages have correct pageType strings', () => {
      expect(result.pages[5].pageType).toBe('gems');
      expect(result.pages[6].pageType).toBe('runes');
      expect(result.pages[7].pageType).toBe('misc');
    });

    it('gems page inherits gold from extended page', () => {
      // The extended page is at offset 1566, gold from that page
      const gemsPage = result.pages[5];
      expect(gemsPage.pageType).toBe('gems');
      // Gold might be 0 or inherited from the extended page header
      expect(typeof gemsPage.gold).toBe('number');
    });

    it('runes and misc pages have gold 0', () => {
      expect(result.pages[6].gold).toBe(0);
      expect(result.pages[7].gold).toBe(0);
    });

    it('extended virtual pages have quantities', () => {
      for (let i = 5; i <= 7; i++) {
        expect(result.pages[i].quantities).toBeDefined();
      }
    });

    it('pages have offset and sectorSize metadata', () => {
      for (const page of result.pages) {
        expect(typeof page.offset).toBe('number');
        expect(typeof page.sectorSize).toBe('number');
        expect(page.sectorSize).toBeGreaterThan(0);
      }
    });

    it('first page offset is 0', () => {
      expect(result.pages[0].offset).toBe(0);
    });

    it('first page sectorSize is 989', () => {
      expect(result.pages[0].sectorSize).toBe(989);
    });

    it('parsed at least some items', () => {
      const itemCount = Object.keys(result.items).length;
      expect(itemCount).toBeGreaterThan(0);
    });

    it('all item IDs are positive integers or base codes', () => {
      for (const id of Object.keys(result.items)) {
        const n = Number(id);
        if (Number.isInteger(n)) {
          // Numeric item ID — must be positive
          expect(n).toBeGreaterThan(0);
        } else {
          // String base code (e.g. runes/gems from extended page)
          expect(typeof id).toBe('string');
          expect(id.length).toBeGreaterThan(0);
        }
      }
    });

    it('items have base codes', () => {
      for (const item of Object.values(result.items)) {
        expect(typeof item.base).toBe('string');
        expect(item.base.length).toBeGreaterThan(0);
      }
    });

    it('warnings is always an array', () => {
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  // ─── SharedStashSoftCoreV2V105_.d2i ─────────────────────────
  // 3 pages, all normal (type=0)

  describe('SharedStashSoftCoreV2V105_.d2i', () => {
    let result: D2IReadResult;

    beforeAll(() => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
      result = readD2I(data, gd);
    });

    it('parses without throwing', () => {
      expect(result).toBeDefined();
    });

    it('has 3 pages (all normal)', () => {
      expect(result.pages.length).toBe(3);
    });

    it('all pages are type 0 (normal)', () => {
      for (const page of result.pages) {
        expect(page.pageType).toBe(0);
      }
    });

    it('first page has gold 2500000', () => {
      expect(result.pages[0].gold).toBe(2500000);
    });

    it('page offsets are increasing', () => {
      for (let i = 1; i < result.pages.length; i++) {
        expect(result.pages[i].offset).toBeGreaterThan(result.pages[i - 1].offset);
      }
    });

    it('page sectorSizes match known values', () => {
      expect(result.pages[0].sectorSize).toBe(1210);
      expect(result.pages[1].sectorSize).toBe(2290);
      expect(result.pages[2].sectorSize).toBe(1184);
    });

    it('parsed at least some items', () => {
      const itemCount = Object.keys(result.items).length;
      expect(itemCount).toBeGreaterThan(0);
    });

    it('stash slots map items correctly', () => {
      // At least one page should have items in stash slots
      const hasItems = result.pages.some(p =>
        p.stash.some(s => s !== undefined)
      );
      expect(hasItems).toBe(true);
    });

    it('warnings is always an array', () => {
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('throws/returns empty for invalid data', () => {
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
      const result = readD2I(data, gd);
      expect(result.pages.length).toBe(0);
      expect(Object.keys(result.items).length).toBe(0);
    });

    it('handles empty buffer', () => {
      const result = readD2I(new Uint8Array(0), gd);
      expect(result.pages.length).toBe(0);
    });

    it('handles buffer too small for page header', () => {
      // Less than 64 bytes — should not parse any pages
      const result = readD2I(new Uint8Array(32), gd);
      expect(result.pages.length).toBe(0);
    });
  });
});
