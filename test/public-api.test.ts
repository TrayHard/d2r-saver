import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { D2RSaver, D2RSaverError, ErrorCode, StashGrid } from '../src/index.js';
import { TOKEN_PREFIX } from '../src/types/constants.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('D2RSaverError', () => {
  it('is an instance of Error', () => {
    const err = new D2RSaverError(ErrorCode.INVALID_FORMAT, 'bad file');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(D2RSaverError);
  });

  it('has correct name and code', () => {
    const err = new D2RSaverError(ErrorCode.ITEM_NOT_FOUND, 'not found');
    expect(err.name).toBe('D2RSaverError');
    expect(err.code).toBe(ErrorCode.ITEM_NOT_FOUND);
    expect(err.message).toBe('not found');
  });

  it('enumerates all error codes', () => {
    const codes: string[] = [
      'INVALID_FORMAT', 'UNSUPPORTED_VERSION', 'PARSE_ERROR',
      'CHECKSUM_MISMATCH', 'NO_FREE_SLOT', 'ITEM_NOT_FOUND',
      'WRITE_ERROR', 'INVALID_TOKEN', 'DATA_NOT_LOADED',
    ];
    for (const code of codes) {
      expect(ErrorCode[code as keyof typeof ErrorCode]).toBe(code);
    }
  });
});

describe('D2RSaver facade', () => {
  let saver: D2RSaver;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    saver = D2RSaver.fromData(rawData, locale);
  });

  // ─── Factory ──────────────────────────────────────────────

  describe('factory methods', () => {
    it('fromData creates a saver with valid gd', () => {
      expect(saver).toBeInstanceOf(D2RSaver);
      expect(saver.gd).toBeDefined();
      expect(saver.gd.items).toBeDefined();
    });

    it('create() loads from file paths', async () => {
      const s = await D2RSaver.create({
        dataPath: resolve(DATA_DIR, 'data.json'),
        stringsPath: resolve(DATA_DIR, 'strings.json'),
      });
      expect(s).toBeInstanceOf(D2RSaver);
      expect(Object.keys(s.gd.items).length).toBeGreaterThan(0);
    });
  });

  // ─── Format detection ─────────────────────────────────────

  describe('detectFormat', () => {
    it('detects d2s files', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const fmt = saver.detectFormat(new Uint8Array(buf));
      expect(fmt.type).toBe('d2s');
      expect(fmt.version).toBe(105);
    });

    it('detects d2i files', () => {
      const buf = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const fmt = saver.detectFormat(new Uint8Array(buf));
      expect(fmt.type).toBe('d2i');
    });

    it('throws INVALID_FORMAT for junk data', () => {
      expect(() => saver.detectFormat(new Uint8Array([0, 1, 2, 3]))).toThrow(D2RSaverError);
      try {
        saver.detectFormat(new Uint8Array([0, 1, 2, 3]));
      } catch (e) {
        expect((e as D2RSaverError).code).toBe(ErrorCode.INVALID_FORMAT);
      }
    });
  });

  // ─── Reading ──────────────────────────────────────────────

  describe('readD2S / readD2I / readSave', () => {
    it('readD2S returns character profile and items', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const result = saver.readD2S(new Uint8Array(buf));
      expect(result.profile).toBeDefined();
      expect(Object.keys(result.items).length).toBeGreaterThan(0);
    });

    it('readD2I returns pages and items', () => {
      const buf = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const result = saver.readD2I(new Uint8Array(buf));
      expect(result.pages.length).toBeGreaterThan(0);
      expect(Object.keys(result.items).length).toBeGreaterThan(0);
    });

    it('readSave auto-detects d2s', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const result = saver.readSave(new Uint8Array(buf));
      expect(result.type).toBe('d2s');
      if (result.type === 'd2s') {
        expect(result.data.profile).toBeDefined();
      }
    });

    it('readSave auto-detects d2i', () => {
      const buf = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));
      const result = saver.readSave(new Uint8Array(buf));
      expect(result.type).toBe('d2i');
      if (result.type === 'd2i') {
        expect(result.data.pages.length).toBeGreaterThan(0);
      }
    });

    it('readSave throws for invalid buffer', () => {
      expect(() => saver.readSave(new Uint8Array([0]))).toThrow(D2RSaverError);
    });
  });

  // ─── Serialization ────────────────────────────────────────

  describe('serializeItem / deserializeItem', () => {
    it('roundtrips a real item through the facade', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = saver.readD2S(new Uint8Array(buf));
      const items = Object.values(d2s.items);
      expect(items.length).toBeGreaterThan(0);

      const item = items[0];
      const token = saver.serializeItem(item, d2s.items);
      expect(token.startsWith(TOKEN_PREFIX)).toBe(true);

      const { item: restored } = saver.deserializeItem(token);
      expect(restored.base).toBe(item.base);
      expect(restored.quality).toBe(item.quality);
    });
  });

  // ─── Item size ────────────────────────────────────────────

  describe('getItemSize', () => {
    it('returns correct size for known item', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = saver.readD2S(new Uint8Array(buf));
      const item = Object.values(d2s.items)[0];
      const size = saver.getItemSize(item);
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
    });

    it('defaults to 1x1 for unknown base', () => {
      const fakeItem = { base: 'zzz' } as any;
      const size = saver.getItemSize(fakeItem);
      expect(size.width).toBe(1);
      expect(size.height).toBe(1);
    });
  });

  // ─── Placement ────────────────────────────────────────────

  describe('placement helpers', () => {
    it('canPlaceItem delegates correctly', () => {
      const grid = new StashGrid(16, 13);
      const item = { base: 'r01' }; // rune = 1x1
      expect(saver.canPlaceItem(grid, 0, 0, item)).toBe(true);
    });

    it('findFreeSlot delegates correctly', () => {
      const grid = new StashGrid(16, 13);
      const item = { base: 'r01' };
      const slot = saver.findFreeSlot(grid, item);
      expect(slot).toEqual({ x: 0, y: 0 });
    });

    it('findFreeSlotInStash searches across grids', () => {
      const grid1 = new StashGrid(2, 2);
      // Fill grid1 completely
      grid1.occupy(0, 0, 2, 2, 1);
      const grid2 = new StashGrid(2, 2);
      const item = { base: 'r01' };
      const slot = saver.findFreeSlotInStash([grid1, grid2], item);
      expect(slot).toEqual({ pageIndex: 1, x: 0, y: 0 });
    });
  });

  // ─── Icons ────────────────────────────────────────────────

  describe('icon helpers', () => {
    it('getItemIconPath delegates correctly', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = saver.readD2S(new Uint8Array(buf));
      const item = Object.values(d2s.items)[0];
      const icon = saver.getItemIconPath(item);
      // Should return string or null
      expect(icon === null || typeof icon === 'string').toBe(true);
    });

    it('getItemIconSD delegates correctly', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = saver.readD2S(new Uint8Array(buf));
      const item = Object.values(d2s.items)[0];
      const icon = saver.getItemIconSD(item);
      expect(icon === null || typeof icon === 'string').toBe(true);
    });
  });

  // ─── Trade DTO ────────────────────────────────────────────

  describe('toTradeDTO', () => {
    it('produces a DTO through the facade', () => {
      const buf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2s = saver.readD2S(new Uint8Array(buf));
      const item = Object.values(d2s.items)[0];
      const dto = saver.toTradeDTO(item, d2s.items);

      expect(dto.token.startsWith(TOKEN_PREFIX)).toBe(true);
      expect(dto.baseCode).toBe(item.base);
      expect(dto.displayName).toBeTruthy();
      expect(dto.width).toBeGreaterThanOrEqual(1);
      expect(dto.height).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Extract + Insert via facade ──────────────────────────

  describe('extract + insert roundtrip', () => {
    it('extracts from d2s and inserts into d2i via facade', () => {
      const d2sBuf = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const d2iBuf = readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i'));

      const d2s = saver.readD2S(new Uint8Array(d2sBuf));
      const firstItemId = Number(Object.keys(d2s.items)[0]);

      // Extract from d2s
      const { newBuffer: patchedD2S, extractedItem, extractedAllItems } =
        saver.extractItemD2S(new Uint8Array(d2sBuf), firstItemId);

      // Verify extraction
      const d2sAfter = saver.readD2S(patchedD2S);
      expect(Object.keys(d2sAfter.items).length).toBeLessThan(Object.keys(d2s.items).length);

      // Insert into d2i
      const { newBuffer: patchedD2I } =
        saver.insertItemD2I(new Uint8Array(d2iBuf), extractedItem, extractedAllItems);

      // Verify insertion
      const d2iAfter = saver.readD2I(patchedD2I);
      const d2iBefore = saver.readD2I(new Uint8Array(d2iBuf));
      expect(Object.keys(d2iAfter.items).length).toBeGreaterThan(Object.keys(d2iBefore.items).length);
    });
  });
});

describe('readSave standalone', () => {
  let saver: D2RSaver;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    saver = D2RSaver.fromData(rawData, locale);
  });

  it('throws D2RSaverError with INVALID_FORMAT for empty buffer', () => {
    try {
      saver.readSave(new Uint8Array(0));
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(D2RSaverError);
      expect((e as D2RSaverError).code).toBe(ErrorCode.INVALID_FORMAT);
    }
  });
});
