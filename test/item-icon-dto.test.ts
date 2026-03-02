import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';
import { getItemIconPath, getItemIconSD } from '../src/items/item-icon.js';
import { toTradeDTO, type TradeItemDTO } from '../src/items/item-dto.js';
import { TOKEN_PREFIX } from '../src/types/constants.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

// ─── Helpers ────────────────────────────────────────────────────

function makeItem(overrides: Partial<BinaryParsedItem> & { base: string }): BinaryParsedItem {
  return {
    itemId: 0,
    quality: 2,
    ilvl: 1,
    unidentified: false,
    ethereal: false,
    socketed: false,
    sockets: 0,
    socketedItems: [],
    stats: {},
    binaryOffset: { start: 0, end: 0 },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════

describe('Item icons', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── getItemIconPath (HD) ──────────────────────────────────

  describe('getItemIconPath', () => {
    it('returns HD icon path for a normal armor item', () => {
      // 'qui' = Quilted Armor, a basic armor with an hd field
      const item = makeItem({ base: 'qui' });
      const icon = getItemIconPath(item, gd);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe('string');
    });

    it('returns HD icon path for a weapon', () => {
      // 'hax' = Hand Axe
      const item = makeItem({ base: 'hax' });
      const icon = getItemIconPath(item, gd);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe('string');
    });

    it('returns HD icon path for a misc item (rune)', () => {
      // 'r01' = El Rune
      const item = makeItem({ base: 'r01' });
      const icon = getItemIconPath(item, gd);
      expect(icon).toBeTruthy();
    });

    it('returns null for unknown base code', () => {
      const item = makeItem({ base: 'zzz' });
      const icon = getItemIconPath(item, gd);
      expect(icon).toBeNull();
    });

    it('returns base hd for normal quality item even when unique exists', () => {
      // Quality 2 (normal) should get base HD, not unique override
      const item = makeItem({ base: 'rin', quality: 2 });
      const baseHd = (gd.items['rin'] as unknown as Record<string, unknown>)?.hd as string;
      const icon = getItemIconPath(item, gd);
      // Should match base hd (possibly with varinvgfx suffix)
      expect(icon).toBeTruthy();
      if (baseHd) {
        expect(icon!.startsWith(baseHd)).toBe(true);
      }
    });

    it('resolves unique item HD override when available', () => {
      // Find a unique item in GameData that has an hd field
      const uniqueKey = Object.keys(gd.uniqueItems).find(k => {
        const entry = gd.uniqueItems[k] as unknown as Record<string, unknown>;
        return entry.hd && entry.code;
      });
      if (!uniqueKey) return; // Skip if no unique items with hd

      const entry = gd.uniqueItems[uniqueKey] as unknown as Record<string, unknown>;
      const baseCode = entry.code as string;
      const item = makeItem({ base: baseCode, quality: 7, unique: uniqueKey });
      const icon = getItemIconPath(item, gd);
      expect(icon).toBeTruthy();
    });

    it('resolves set item HD override when available', () => {
      const setKey = Object.keys(gd.setItems).find(k => {
        const entry = gd.setItems[k] as unknown as Record<string, unknown>;
        return entry.hd && entry.item;
      });
      if (!setKey) return;

      const entry = gd.setItems[setKey] as unknown as Record<string, unknown>;
      const baseCode = entry.item as string;
      const item = makeItem({ base: baseCode, quality: 5, unique: setKey });
      const icon = getItemIconPath(item, gd);
      expect(icon).toBeTruthy();
    });

    it('handles varinvgfx variant selection', () => {
      // Find an item type with varinvgfx > 0
      const typeKey = Object.keys(gd.itemTypes).find(k => gd.itemTypes[k].varinvgfx > 0);
      if (!typeKey) return;

      // Find a base item of that type
      const baseKey = Object.keys(gd.items).find(k => {
        const b = gd.items[k] as unknown as Record<string, unknown>;
        return b.type === typeKey && b.hd;
      });
      if (!baseKey) return;

      const item0 = makeItem({ base: baseKey, iconIndex: 0 });
      const item1 = makeItem({ base: baseKey, iconIndex: 1 });
      const icon0 = getItemIconPath(item0, gd);
      const icon1 = getItemIconPath(item1, gd);

      expect(icon0).toBeTruthy();
      expect(icon1).toBeTruthy();
      // Different iconIndex may produce different icon paths
      if (gd.itemTypes[typeKey].varinvgfx > 1) {
        expect(icon0).not.toBe(icon1);
      }
    });
  });

  // ─── getItemIconSD ─────────────────────────────────────────

  describe('getItemIconSD', () => {
    it('returns invfile for a normal item', () => {
      const item = makeItem({ base: 'qui' });
      const icon = getItemIconSD(item, gd);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe('string');
    });

    it('returns null for unknown base code', () => {
      const item = makeItem({ base: 'zzz' });
      const icon = getItemIconSD(item, gd);
      expect(icon).toBeNull();
    });

    it('returns unique invfile override for unique items', () => {
      // Find a unique item entry with its own invfile
      const uniqueKey = Object.keys(gd.uniqueItems).find(k => {
        const entry = gd.uniqueItems[k] as unknown as Record<string, unknown>;
        return entry.invfile && entry.code;
      });
      if (!uniqueKey) return;

      const entry = gd.uniqueItems[uniqueKey] as unknown as Record<string, unknown>;
      const baseCode = entry.code as string;
      const item = makeItem({ base: baseCode, quality: 7, unique: uniqueKey });
      const icon = getItemIconSD(item, gd);
      expect(icon).toBeTruthy();
      // Should be unique invfile, not the base invfile
      expect(icon).toBe(entry.invfile);
    });

    it('falls back to base uniqueinvfile when unique has no invfile', () => {
      // Find a base item that has uniqueinvfile set
      const baseKey = Object.keys(gd.items).find(k => {
        const b = gd.items[k];
        return b.uniqueinvfile;
      });
      if (!baseKey) return;

      // Create a unique item referencing that base but with no unique entry invfile
      const item = makeItem({ base: baseKey, quality: 7, unique: 'nonexistent_unique' });
      const icon = getItemIconSD(item, gd);
      expect(icon).toBe(gd.items[baseKey].uniqueinvfile);
    });
  });

  // ─── Real file icons ──────────────────────────────────────

  describe('real file item icons', () => {
    it('resolves icons for all items in WarlockTest.d2s', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = readD2S(new Uint8Array(buf), gd);
      const allItems = Object.values(d2s.items);

      let resolved = 0;
      for (const item of allItems) {
        const hd = getItemIconPath(item, gd);
        const sd = getItemIconSD(item, gd);
        // At least one should resolve for valid items
        if (hd || sd) resolved++;
      }

      // Most items should have at least one icon
      expect(resolved).toBeGreaterThan(0);
      expect(resolved / allItems.length).toBeGreaterThan(0.5);
    });

    it('resolves icons for items in SharedStashSoftCoreV2V105_.d2i', () => {
      const buf = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const d2i = readD2I(new Uint8Array(buf), gd);
      const allItems = Object.values(d2i.items);

      let resolved = 0;
      for (const item of allItems) {
        const hd = getItemIconPath(item, gd);
        const sd = getItemIconSD(item, gd);
        if (hd || sd) resolved++;
      }
      if (allItems.length > 0) {
        expect(resolved / allItems.length).toBeGreaterThan(0.5);
      }
    });
  });
});

// ═════════════════════════════════════════════════════════════════

describe('Item DTO', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── toTradeDTO basic ─────────────────────────────────────

  describe('toTradeDTO', () => {
    it('produces a valid DTO for a simple rune', () => {
      const item = makeItem({ base: 'r01', quality: 2, ilvl: 1, quantity: 3 });
      const dto = toTradeDTO(item, { 0: item }, gd);

      expect(dto.baseCode).toBe('r01');
      expect(dto.quality).toBe(2);
      expect(dto.ilvl).toBe(1);
      expect(dto.ethereal).toBe(false);
      expect(dto.sockets).toBe(0);
      expect(dto.token.startsWith(TOKEN_PREFIX)).toBe(true);
      expect(dto.width).toBeGreaterThanOrEqual(1);
      expect(dto.height).toBeGreaterThanOrEqual(1);
      expect(dto.socketedItems).toHaveLength(0);
    });

    it('includes correct dimensions from game data', () => {
      // 'qui' = Quilted Armor, should be 2x3
      const item = makeItem({ base: 'qui', quality: 2, ilvl: 10 });
      const dto = toTradeDTO(item, { 0: item }, gd);

      const baseEntry = gd.items['qui'];
      expect(dto.width).toBe(baseEntry.invwidth);
      expect(dto.height).toBe(baseEntry.invheight);
    });

    it('sets iconPath from getItemIconPath', () => {
      const item = makeItem({ base: 'r01', quality: 2 });
      const dto = toTradeDTO(item, { 0: item }, gd);

      // iconPath should match getItemIconPath result
      const expected = getItemIconPath(item, gd);
      expect(dto.iconPath).toBe(expected);
    });

    it('copies stats to DTO', () => {
      const item = makeItem({
        base: 'rin',
        quality: 4,
        ilvl: 30,
        stats: { strength: 10, vitality: 20 },
      });
      const dto = toTradeDTO(item, { 0: item }, gd);

      expect(dto.stats.strength).toBe(10);
      expect(dto.stats.vitality).toBe(20);
    });

    it('reports ethereal flag correctly', () => {
      const item = makeItem({ base: 'hax', quality: 2, ethereal: true });
      const dto = toTradeDTO(item, { 0: item }, gd);
      expect(dto.ethereal).toBe(true);
    });

    it('reports sockets count', () => {
      const item = makeItem({ base: 'hax', quality: 2, sockets: 3 });
      const dto = toTradeDTO(item, { 0: item }, gd);
      expect(dto.sockets).toBe(3);
    });

    it('includes uniqueId for unique items', () => {
      const item = makeItem({
        base: 'rin',
        quality: 7,
        unique: 'unique001',
        ilvl: 50,
      });
      const dto = toTradeDTO(item, { 0: item }, gd);
      expect(dto.uniqueId).toBe('unique001');
    });

    it('defaults to 1x1 for unknown base code', () => {
      const item = makeItem({ base: 'zzz', quality: 2 });
      const dto = toTradeDTO(item, { 0: item }, gd);
      expect(dto.width).toBe(1);
      expect(dto.height).toBe(1);
    });
  });

  // ─── Display name resolution ──────────────────────────────

  describe('displayName resolution', () => {
    it('uses item.name when present (rare/crafted)', () => {
      const item = makeItem({
        base: 'rin',
        quality: 6,
        name: 'Grim Ring',
      });
      const dto = toTradeDTO(item, { 0: item }, gd);
      expect(dto.displayName).toBe('Grim Ring');
    });

    it('resolves unique name from gd.uniqueItems', () => {
      // Find a real unique item key
      const uniqueKey = Object.keys(gd.uniqueItems)[0];
      if (!uniqueKey) return;

      const entry = gd.uniqueItems[uniqueKey];
      const baseCode = (entry as unknown as Record<string, unknown>).code as string;
      const item = makeItem({
        base: baseCode || 'rin',
        quality: 7,
        unique: uniqueKey,
      });
      const dto = toTradeDTO(item, { 0: item }, gd);

      // Should have a meaningful display name (not just the base code)
      expect(dto.displayName).toBeTruthy();
      expect(dto.displayName.length).toBeGreaterThan(0);
    });

    it('falls back to base namestr locale', () => {
      // A normal item should get its localized name or namestr
      const item = makeItem({ base: 'r01', quality: 2 });
      const dto = toTradeDTO(item, { 0: item }, gd);

      const baseNamestr = gd.items['r01']?.namestr;
      const localized = baseNamestr ? gd.locale.strings[baseNamestr] : undefined;
      if (localized) {
        expect(dto.displayName).toBe(localized);
      } else if (baseNamestr) {
        expect(dto.displayName).toBe(baseNamestr);
      } else {
        expect(dto.displayName).toBe('r01');
      }
    });

    it('falls back to base code for totally unknown items', () => {
      const item = makeItem({ base: 'zzz', quality: 2 });
      const dto = toTradeDTO(item, { 0: item }, gd);
      expect(dto.displayName).toBe('zzz');
    });
  });

  // ─── Socketed sub-items ───────────────────────────────────

  describe('socketed items in DTO', () => {
    it('includes socketed sub-item DTOs', () => {
      const rune = makeItem({ itemId: 1, base: 'r01', quality: 2, ilvl: 1 });
      const gem = makeItem({ itemId: 2, base: 'gcv', quality: 2, ilvl: 1 });
      const main = makeItem({
        itemId: 0,
        base: 'hax',
        quality: 2,
        sockets: 2,
        socketed: true,
        socketedItems: [1, 2],
      });

      const allItems: Record<number, BinaryParsedItem> = { 0: main, 1: rune, 2: gem };
      const dto = toTradeDTO(main, allItems, gd);

      expect(dto.socketedItems).toHaveLength(2);
      expect(dto.socketedItems[0].baseCode).toBe('r01');
      expect(dto.socketedItems[1].baseCode).toBe('gcv');
    });

    it('socketed sub-items also have valid tokens', () => {
      const rune = makeItem({ itemId: 1, base: 'r01', quality: 2, ilvl: 1 });
      const main = makeItem({
        itemId: 0,
        base: 'hax',
        quality: 2,
        sockets: 1,
        socketed: true,
        socketedItems: [1],
      });

      const allItems: Record<number, BinaryParsedItem> = { 0: main, 1: rune };
      const dto = toTradeDTO(main, allItems, gd);

      expect(dto.socketedItems[0].token.startsWith(TOKEN_PREFIX)).toBe(true);
    });

    it('skips missing socketed items gracefully', () => {
      const main = makeItem({
        itemId: 0,
        base: 'hax',
        quality: 2,
        sockets: 1,
        socketed: true,
        socketedItems: [999], // ID 999 doesn't exist
      });

      const allItems: Record<number, BinaryParsedItem> = { 0: main };
      const dto = toTradeDTO(main, allItems, gd);

      expect(dto.socketedItems).toHaveLength(0);
    });
  });

  // ─── Real file DTOs ───────────────────────────────────────

  describe('real file DTOs', () => {
    it('converts all WarlockTest.d2s items to DTOs', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = readD2S(new Uint8Array(buf), gd);
      const allItems = d2s.items;

      const dtos: TradeItemDTO[] = [];
      for (const item of Object.values(allItems)) {
        const dto = toTradeDTO(item, allItems as Record<number, BinaryParsedItem>, gd);
        dtos.push(dto);
      }

      expect(dtos.length).toBeGreaterThan(0);
      for (const dto of dtos) {
        expect(dto.token.startsWith(TOKEN_PREFIX)).toBe(true);
        expect(dto.baseCode).toBeTruthy();
        expect(dto.displayName).toBeTruthy();
        expect(dto.width).toBeGreaterThanOrEqual(1);
        expect(dto.height).toBeGreaterThanOrEqual(1);
        expect(typeof dto.quality).toBe('number');
        expect(typeof dto.ilvl).toBe('number');
        expect(typeof dto.ethereal).toBe('boolean');
        expect(typeof dto.sockets).toBe('number');
        expect(typeof dto.stats).toBe('object');
        expect(Array.isArray(dto.socketedItems)).toBe(true);
      }
    });

    it('converts all SharedStash items to DTOs', () => {
      const buf = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const d2i = readD2I(new Uint8Array(buf), gd);
      const allItems = d2i.items;

      const dtos: TradeItemDTO[] = [];
      for (const item of Object.values(allItems)) {
        const dto = toTradeDTO(item, allItems as Record<number, BinaryParsedItem>, gd);
        dtos.push(dto);
      }

      if (dtos.length > 0) {
        for (const dto of dtos) {
          expect(dto.token.startsWith(TOKEN_PREFIX)).toBe(true);
          expect(dto.baseCode).toBeTruthy();
          expect(dto.displayName).toBeTruthy();
        }
      }
    });
  });
});
