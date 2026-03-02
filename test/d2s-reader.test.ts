import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { detectFormat } from '../src/formats/detect.js';
import { readD2S } from '../src/formats/d2s-reader.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('D2S reading', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── Format detection ────────────────────────────────────────

  describe('detectFormat', () => {
    it('detects WarlockTest.d2s as d2s v105', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
      const fmt = detectFormat(data);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2s');
      expect(fmt!.version).toBe(105);
    });

    it('detects WarlockShards.d2s as d2s v105', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockShards.d2s')));
      const fmt = detectFormat(data);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2s');
    });

    it('rejects BlizzlessTest.d2s (v99, unsupported)', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'BlizzlessTest.d2s')));
      const fmt = detectFormat(data);
      // v99 is not supported, detectFormat returns null
      expect(fmt).toBeNull();
    });

    it('detects .d2i files as d2i', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105.d2i')));
      const fmt = detectFormat(data);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2i');
      expect(fmt!.version).toBe(105);
    });

    it('returns null for random data', () => {
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      expect(detectFormat(data)).toBeNull();
    });

    it('returns null for too-small buffers', () => {
      expect(detectFormat(new Uint8Array([0xaa, 0x55]))).toBeNull();
    });
  });

  // ─── readD2S: WarlockTest.d2s ────────────────────────────────

  describe('WarlockTest.d2s', () => {
    let result: ReturnType<typeof readD2S>;

    beforeAll(() => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
      result = readD2S(data, gd);
    });

    it('parses without throwing', () => {
      expect(result).toBeDefined();
      expect(result.profile).toBeDefined();
    });

    it('has character name WarTest', () => {
      expect(result.profile.name).toBe('WarTest');
    });

    it('class is war (Barbarian)', () => {
      expect(result.profile.class).toBe('war');
      expect(GameData.classes).toContain(result.profile.class);
    });

    it('level is 75', () => {
      expect(result.profile.level).toBe(75);
    });

    it('has stats', () => {
      expect(result.profile.stats).toBeDefined();
      expect(typeof result.profile.stats.str).toBe('number');
      expect(typeof result.profile.stats.dex).toBe('number');
      expect(typeof result.profile.stats.int).toBe('number');
      expect(typeof result.profile.stats.vit).toBe('number');
    });

    it('has quest data for 3 difficulties', () => {
      expect(result.profile.quests).toHaveLength(3);
      for (const q of result.profile.quests) {
        expect(q).toHaveProperty('denofevil');
        expect(q).toHaveProperty('prisonofice');
      }
    });

    it('has skills', () => {
      expect(result.profile.skills).toBeDefined();
    });

    it('has items (at least some before data-limited stats)', () => {
      // Items parse until a Blizzless-specific stat is encountered.
      // With current data files, at least 2 items parse successfully.
      expect(Object.keys(result.items).length).toBeGreaterThanOrEqual(2);
    });

    it('parsed items have valid base and quality', () => {
      for (const item of Object.values(result.items)) {
        expect(item.base).toBeTruthy();
        expect(item.base.length).toBeGreaterThanOrEqual(2);
        expect(item.base.length).toBeLessThanOrEqual(4);
        expect(item.quality).toBeGreaterThanOrEqual(1);
        expect(item.quality).toBeLessThanOrEqual(9);
      }
    });

    it('reports warnings for items with unsupported stats', () => {
      // Blizzless v105 has custom stats not in the standard data files
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // ─── readD2S: WarlockShards.d2s ──────────────────────────────

  describe('WarlockShards.d2s', () => {
    let result: ReturnType<typeof readD2S>;

    beforeAll(() => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockShards.d2s')));
      result = readD2S(data, gd);
    });

    it('parses without throwing', () => {
      expect(result).toBeDefined();
      expect(result.profile).toBeDefined();
    });

    it('has character name WarlockI', () => {
      expect(result.profile.name).toBe('WarlockI');
    });

    it('class is war', () => {
      expect(result.profile.class).toBe('war');
    });

    it('has level', () => {
      expect(result.profile.level).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── readD2S: BlizzlessTest.d2s (v99 — unsupported) ─────────

  describe('BlizzlessTest.d2s (v99)', () => {
    it('throws for unsupported v99 format', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'BlizzlessTest.d2s')));
      expect(() => readD2S(data, gd)).toThrow('invalid d2s header');
    });
  });

  // ─── All v105 .d2s fixtures parse without fatal errors ───────

  describe('all v105 d2s fixtures parse', () => {
    const files = ['WarlockTest.d2s', 'WarlockShards.d2s'];

    for (const file of files) {
      it(`${file} produces no fatal errors`, () => {
        const data = new Uint8Array(readFileSync(resolve(FIXTURES, file)));
        const result = readD2S(data, gd);
        expect(result.profile.name).toBeTruthy();
        expect(result.profile.class).toBeTruthy();
        expect(result.profile.level).toBeGreaterThanOrEqual(1);
      });
    }
  });
});
