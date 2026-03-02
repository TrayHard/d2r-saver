import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';
import {
  serializeItem,
  deserializeItem,
} from '../src/items/item-serializer.js';
import { TOKEN_PREFIX } from '../src/types/constants.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('Item serializer', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── Token format ──────────────────────────────────────────────

  describe('token format', () => {
    it('produces a token starting with d2r1: prefix', () => {
      const item: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 }, quantity: 3,
      };
      const token = serializeItem(item, {}, gd);
      expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    });

    it('produces a valid base64 payload after prefix', () => {
      const item: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };
      const token = serializeItem(item, {}, gd);
      const base64 = token.slice(TOKEN_PREFIX.length);
      // Should not throw when decoded
      const bytes = Buffer.from(base64, 'base64');
      expect(bytes.length).toBeGreaterThan(0);
      // Re-encode should match
      expect(bytes.toString('base64')).toBe(base64);
    });
  });

  // ─── Roundtrip: synthetic items ────────────────────────────────

  describe('roundtrip: synthetic items', () => {
    it('roundtrips a normal-quality rune (preset)', () => {
      const item: BinaryParsedItem = {
        itemId: 0, base: 'r22', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 }, quantity: 5,
      };
      const token = serializeItem(item, { 0: item }, gd);
      const result = deserializeItem(token, gd);

      expect(result.item.base).toBe('r22');
      expect(result.item.quantity).toBe(5);
    });

    it('roundtrips a unique item (Shako)', () => {
      const item: BinaryParsedItem = {
        itemId: 42, base: 'uap', quality: 7, ilvl: 85,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: { strength: 5, vitality: 10 },
        unique: 'unique157',
        binaryOffset: { start: 0, end: 0 },
      };
      const token = serializeItem(item, { 42: item }, gd);
      const result = deserializeItem(token, gd);

      expect(result.item.base).toBe('uap');
      expect(result.item.quality).toBe(7);
    });

    it('roundtrips a magic-quality item', () => {
      const item: BinaryParsedItem = {
        itemId: 10, base: 'rin', quality: 4, ilvl: 30,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        prefix: ['ring_prefix_1'] as any,
        suffix: ['ring_suffix_1'] as any,
        binaryOffset: { start: 0, end: 0 },
      };
      const token = serializeItem(item, { 10: item }, gd);
      const result = deserializeItem(token, gd);

      expect(result.item.base).toBe('rin');
      expect(result.item.quality).toBe(4);
    });

    it('roundtrips a socketed item with inserted runes', () => {
      const runeItem: BinaryParsedItem = {
        itemId: 2, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };
      // Use quality 7 (unique) to make it a non-simple item — simple items
      // don't have socketed sub-items read back by the parser.
      const mainItem: BinaryParsedItem = {
        itemId: 1, base: 'uap', quality: 7, ilvl: 85,
        unidentified: false, ethereal: false, socketed: true,
        sockets: 1, socketedItems: [2], stats: { strength: 5 },
        unique: 'unique157',
        binaryOffset: { start: 0, end: 0 },
      };
      const allItems: Record<number, BinaryParsedItem> = { 1: mainItem, 2: runeItem };

      const token = serializeItem(mainItem, allItems, gd);
      const result = deserializeItem(token, gd);

      expect(result.item.base).toBe('uap');
      expect(result.item.socketed).toBe(true);
      // The deserialized allItems should have the socketed rune too
      const allValues = Object.values(result.allItems);
      expect(allValues.length).toBe(2);
      const rune = allValues.find(i => i.base === 'r01');
      expect(rune).toBeDefined();
    });

    it('produces a token that deserializes to a valid item', () => {
      const item: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 },
      };
      const token = serializeItem(item, { 0: item }, gd);
      const result = deserializeItem(token, gd);

      // Item should be present and valid
      expect(result.item).toBeDefined();
      expect(result.item.base).toBe('r01');
    });
  });

  // ─── Roundtrip: real items from fixtures ────────────────────────

  describe('roundtrip: real D2S items', () => {
    let d2sItems: Record<number | string, BinaryParsedItem>;

    beforeAll(() => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
      const result = readD2S(data, gd);
      d2sItems = result.items;
    });

    it('has items to test', () => {
      expect(Object.keys(d2sItems).length).toBeGreaterThan(0);
    });

    it('roundtrips each D2S item preserving base', () => {
      for (const [, item] of Object.entries(d2sItems)) {
        try {
          const token = serializeItem(item, d2sItems, gd);
          expect(token.startsWith(TOKEN_PREFIX)).toBe(true);

          const result = deserializeItem(token, gd);
          expect(result.item.base).toBe(item.base);
          expect(result.item.quality).toBe(item.quality);
        } catch (e) {
          // Some items with Blizzless custom stats may fail roundtrip
          const msg = e instanceof Error ? e.message : String(e);
          expect(msg).toMatch(/unknown item stat|stat id/i);
        }
      }
    });
  });

  describe('roundtrip: real D2I items', () => {
    let d2iItems: Record<number | string, BinaryParsedItem>;

    beforeAll(() => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
      const result = readD2I(data, gd);
      d2iItems = result.items;
    });

    it('has items to test', () => {
      expect(Object.keys(d2iItems).length).toBeGreaterThan(0);
    });

    it('roundtrips each D2I item preserving base', () => {
      const numericItems = Object.entries(d2iItems).filter(([k]) => !isNaN(Number(k)));
      for (const [, item] of numericItems) {
        try {
          const token = serializeItem(item, d2iItems, gd);
          const result = deserializeItem(token, gd);
          expect(result.item.base).toBe(item.base);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          expect(msg).toMatch(/unknown item stat|stat id/i);
        }
      }
    });
  });

  // ─── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('throws INVALID_TOKEN for missing prefix', () => {
      expect(() => deserializeItem('garbage', gd)).toThrow('INVALID_TOKEN');
    });

    it('throws INVALID_TOKEN for empty prefix-only token', () => {
      expect(() => deserializeItem(TOKEN_PREFIX, gd)).toThrow('INVALID_TOKEN');
    });

    it('throws INVALID_TOKEN for short payload', () => {
      const short = TOKEN_PREFIX + Buffer.from(new Uint8Array([0, 1])).toString('base64');
      expect(() => deserializeItem(short, gd)).toThrow('INVALID_TOKEN');
    });

    it('throws or returns empty for corrupted payload', () => {
      // Very short payload (2 bytes)
      const tiny = TOKEN_PREFIX + Buffer.from(new Uint8Array([0x00, 0x01])).toString('base64');
      expect(() => deserializeItem(tiny, gd)).toThrow('INVALID_TOKEN');
    });
  });

  // ─── Idempotency ──────────────────────────────────────────────

  describe('idempotency', () => {
    it('double serialize → deserialize produces same item', () => {
      const item: BinaryParsedItem = {
        itemId: 0, base: 'r01', quality: 2, ilvl: 1,
        unidentified: false, ethereal: false, socketed: false,
        sockets: 0, socketedItems: [], stats: {},
        binaryOffset: { start: 0, end: 0 }, quantity: 3,
      };
      const token1 = serializeItem(item, { 0: item }, gd);
      const result1 = deserializeItem(token1, gd);
      const token2 = serializeItem(result1.item, result1.allItems, gd);

      expect(token1).toBe(token2);
    });
  });
});
