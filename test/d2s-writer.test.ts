import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { writeD2S } from '../src/formats/d2s-writer.js';
import { computeChecksum } from '../src/core/checksum.js';
import { detectFormat } from '../src/formats/detect.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('D2S writer', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── Roundtrip: write from scratch ────────────────────────────

  describe('write from scratch', () => {
    it('produces a valid v105 d2s file', () => {
      const profile = makeMinimalProfile();
      const bytes = writeD2S({ profile, items: {}, gd });

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(800); // at least header + stats + items

      // Verify magic + version
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(dv.getUint32(0, true)).toBe(0xaa55aa55);
      expect(dv.getUint32(4, true)).toBe(105);
    });

    it('file size is correctly written at offset 0x08', () => {
      const profile = makeMinimalProfile();
      const bytes = writeD2S({ profile, items: {}, gd });
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(dv.getUint32(8, true)).toBe(bytes.length);
    });

    it('checksum is valid', () => {
      const profile = makeMinimalProfile();
      const bytes = writeD2S({ profile, items: {}, gd });
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const storedChecksum = dv.getUint32(0x0c, true);
      const computed = computeChecksum(bytes);
      expect(storedChecksum).toBe(computed);
    });

    it('is detected as a valid d2s v105 file', () => {
      const profile = makeMinimalProfile();
      const bytes = writeD2S({ profile, items: {}, gd });
      const fmt = detectFormat(bytes);
      expect(fmt).not.toBeNull();
      expect(fmt!.type).toBe('d2s');
      expect(fmt!.version).toBe(105);
    });

    it('can be parsed back by readD2S', () => {
      const profile = makeMinimalProfile();
      const bytes = writeD2S({ profile, items: {}, gd });
      const result = readD2S(bytes, gd);
      expect(result.profile.name).toBe('TestChar');
      expect(result.profile.class).toBe('war');
      expect(result.profile.level).toBe(10);
    });

    it('preserves stats through roundtrip', () => {
      const profile = makeMinimalProfile();
      profile.stats = { str: 50, dex: 30, int: 20, vit: 40 };
      profile.level = 25;
      const bytes = writeD2S({ profile, items: {}, gd });
      const result = readD2S(bytes, gd);
      expect(result.profile.stats.str).toBe(50);
      expect(result.profile.stats.dex).toBe(30);
      expect(result.profile.stats.int).toBe(20);
      expect(result.profile.stats.vit).toBe(40);
      expect(result.profile.level).toBe(25);
    });

    it('preserves skills through roundtrip', () => {
      const profile = makeMinimalProfile();
      // War class has skillBase = 373
      profile.skills = { 373: 5, 374: 10, 380: 20 };
      const bytes = writeD2S({ profile, items: {}, gd });
      const result = readD2S(bytes, gd);
      expect(result.profile.skills[373]).toBe(5);
      expect(result.profile.skills[374]).toBe(10);
      expect(result.profile.skills[380]).toBe(20);
    });

    it('preserves quest flags through roundtrip', () => {
      const profile = makeMinimalProfile();
      profile.quests = [
        { denofevil: true, radamentslair: true, thegoldenbird: false, lamessenstome: false, thefallenangel: false, prisonofice: false },
        { denofevil: false, radamentslair: false, thegoldenbird: false, lamessenstome: false, thefallenangel: false, prisonofice: false },
        { denofevil: false, radamentslair: false, thegoldenbird: false, lamessenstome: false, thefallenangel: false, prisonofice: false },
      ];
      const bytes = writeD2S({ profile, items: {}, gd });
      const result = readD2S(bytes, gd);
      expect(result.profile.quests[0].denofevil).toBe(true);
      expect(result.profile.quests[0].radamentslair).toBe(true);
      expect(result.profile.quests[0].thegoldenbird).toBe(false);
    });

    it('uses name override when provided', () => {
      const profile = makeMinimalProfile();
      const bytes = writeD2S({ profile, items: {}, gd, name: 'Override' });
      const result = readD2S(bytes, gd);
      expect(result.profile.name).toBe('Override');
    });
  });

  // ─── Roundtrip: read → write → read ──────────────────────────

  describe('read → write → read roundtrip', () => {
    it('WarlockTest.d2s preserves character identity', () => {
      const original = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const parsed = readD2S(new Uint8Array(original), gd);

      const bytes = writeD2S({
        profile: parsed.profile,
        items: parsed.items,
        gd,
      });

      const reparsed = readD2S(bytes, gd);
      expect(reparsed.profile.name).toBe(parsed.profile.name);
      expect(reparsed.profile.class).toBe(parsed.profile.class);
      expect(reparsed.profile.level).toBe(parsed.profile.level);
    });

    it('WarlockTest.d2s preserves stats', () => {
      const original = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const parsed = readD2S(new Uint8Array(original), gd);

      const bytes = writeD2S({
        profile: parsed.profile,
        items: parsed.items,
        gd,
      });

      const reparsed = readD2S(bytes, gd);
      expect(reparsed.profile.stats.str).toBe(parsed.profile.stats.str);
      expect(reparsed.profile.stats.dex).toBe(parsed.profile.stats.dex);
      expect(reparsed.profile.stats.int).toBe(parsed.profile.stats.int);
      expect(reparsed.profile.stats.vit).toBe(parsed.profile.stats.vit);
    });

    it('WarlockTest.d2s preserves skills', () => {
      const original = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const parsed = readD2S(new Uint8Array(original), gd);

      const bytes = writeD2S({
        profile: parsed.profile,
        items: parsed.items,
        gd,
      });

      const reparsed = readD2S(bytes, gd);
      // Compare all skill entries
      for (const [key, val] of Object.entries(parsed.profile.skills)) {
        expect(reparsed.profile.skills[Number(key)]).toBe(val);
      }
    });

    it('WarlockTest.d2s produces valid checksum', () => {
      const original = readFileSync(resolve(FIXTURES, 'WarlockTest.d2s'));
      const parsed = readD2S(new Uint8Array(original), gd);

      const bytes = writeD2S({
        profile: parsed.profile,
        items: parsed.items,
        gd,
      });

      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const stored = dv.getUint32(0x0c, true);
      const computed = computeChecksum(bytes);
      expect(stored).toBe(computed);
    });

    it('WarlockShards.d2s preserves character identity', () => {
      const original = readFileSync(resolve(FIXTURES, 'WarlockShards.d2s'));
      const parsed = readD2S(new Uint8Array(original), gd);

      const bytes = writeD2S({
        profile: parsed.profile,
        items: parsed.items,
        gd,
      });

      const reparsed = readD2S(bytes, gd);
      expect(reparsed.profile.name).toBe(parsed.profile.name);
      expect(reparsed.profile.class).toBe(parsed.profile.class);
      expect(reparsed.profile.level).toBe(parsed.profile.level);
    });
  });

  // ─── Different classes ────────────────────────────────────────

  describe('different character classes', () => {
    const classes = ['ama', 'sor', 'nec', 'pal', 'bar', 'dru', 'ass', 'war'] as const;

    for (const cls of classes) {
      it(`writes and reads back a ${cls} character`, () => {
        const profile = makeMinimalProfile();
        profile.class = cls;
        // Use a class-appropriate skill
        const skillBase = [6, 36, 66, 96, 126, 221, 251, 373][classes.indexOf(cls)];
        profile.skills = { [skillBase]: 3, [skillBase + 1]: 2 };

        const bytes = writeD2S({ profile, items: {}, gd });
        const result = readD2S(bytes, gd);
        expect(result.profile.class).toBe(cls);
        expect(result.profile.skills[skillBase]).toBe(3);
        expect(result.profile.skills[skillBase + 1]).toBe(2);
      });
    }
  });

  // ─── Explicit charStats override ──────────────────────────────

  describe('explicit charStats override', () => {
    it('uses explicit stats when provided', () => {
      const profile = makeMinimalProfile();
      profile.stats = { str: 100, dex: 50, int: 30, vit: 80 };
      profile.level = 50;

      const bytes = writeD2S({
        profile,
        items: {},
        gd,
        charStats: {
          strength: 200,
          energy: 130,
          dexterity: 150,
          vitality: 180,
          hitpoints: 500,
          maxhp: 500,
          mana: 300,
          maxmana: 300,
          stamina: 200,
          maxstamina: 200,
          statpts: 0,
          newskills: 0,
        },
      });

      const result = readD2S(bytes, gd);
      // With explicit stats, the written total stat values are as specified
      // The reader subtracts base class stats, so:
      // result.stats.str = 200 - base.str
      const base = gd.charStats['war'] as Record<string, number> | undefined;
      expect(result.profile.stats.str).toBe(200 - (base?.str ?? 0));
    });
  });
});

// ─── Helpers ────────────────────────────────────────────────────

function makeMinimalProfile() {
  return {
    name: 'TestChar',
    class: 'war',
    level: 10,
    stats: { str: 10, dex: 5, int: 5, vit: 10 },
    skills: {} as Record<number, number>,
    quests: [
      { denofevil: false, radamentslair: false, thegoldenbird: false, lamessenstome: false, thefallenangel: false, prisonofice: false },
      { denofevil: false, radamentslair: false, thegoldenbird: false, lamessenstome: false, thefallenangel: false, prisonofice: false },
      { denofevil: false, radamentslair: false, thegoldenbird: false, lamessenstome: false, thefallenangel: false, prisonofice: false },
    ],
    items: {} as Record<string, number>,
    mercItems: {} as Record<string, number>,
    inventory: [] as (number | undefined)[],
    cube: [] as (number | undefined)[],
    stash: [] as (number | undefined)[],
    belt: [] as (number | undefined)[],
  };
}
