import { describe, it, expect, beforeAll } from 'vitest';
import { GameData } from '../src/game-data/game-data.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');

describe('GameData', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  describe('loading', () => {
    it('items contains armor + weapons + misc', () => {
      expect(Object.keys(gd.items).length).toBeGreaterThan(500);
      // Check some well-known items exist
      expect(gd.items['cap']).toBeDefined();  // cap (armor)
      expect(gd.items['hax']).toBeDefined();  // hand axe (weapon)
      expect(gd.items['hp1']).toBeDefined();  // minor healing potion (misc)
    });

    it('itemStatCost has entries', () => {
      expect(Object.keys(gd.itemStatCost).length).toBeGreaterThan(200);
      expect(gd.itemStatCost['strength']).toBeDefined();
      expect(gd.itemStatCost['strength'].savebits).toBeGreaterThan(0);
    });

    it('itemTypes has entries', () => {
      expect(Object.keys(gd.itemTypes).length).toBeGreaterThan(50);
      expect(gd.itemTypes['helm']).toBeDefined();
    });

    it('uniqueItems has entries', () => {
      expect(Object.keys(gd.uniqueItems).length).toBeGreaterThan(100);
    });

    it('setItems has entries', () => {
      expect(Object.keys(gd.setItems).length).toBeGreaterThan(50);
    });

    it('sets has entries', () => {
      expect(Object.keys(gd.sets).length).toBeGreaterThan(10);
    });

    it('runes (runewords) has entries', () => {
      expect(Object.keys(gd.runes).length).toBeGreaterThan(50);
    });

    it('skills has entries', () => {
      expect(Object.keys(gd.skills).length).toBeGreaterThan(100);
    });

    it('properties has entries', () => {
      expect(Object.keys(gd.properties).length).toBeGreaterThan(100);
    });
  });

  describe('derived data', () => {
    it('mods is populated', () => {
      expect(Object.keys(gd.mods).length).toBeGreaterThan(1000);
    });

    it('staffMods is populated', () => {
      expect(Object.keys(gd.staffMods).length).toBeGreaterThan(10);
    });

    it('skillByName lookup works', () => {
      expect(Object.keys(gd.skillByName).length).toBeGreaterThan(100);
      // "Frozen Orb" should be found as "frozen orb"
      const frozenOrb = gd.skillByName['frozen orb'];
      expect(frozenOrb).toBeDefined();
      expect(frozenOrb.charclass).toBe('sor');
    });

    it('stateByName is populated', () => {
      expect(Object.keys(gd.stateByName).length).toBeGreaterThan(50);
    });

    it('missileByName is populated', () => {
      expect(Object.keys(gd.missileByName).length).toBeGreaterThan(100);
    });

    it('monsterById is populated', () => {
      expect(gd.monsterById.length).toBeGreaterThan(0);
    });
  });

  describe('stat priority reorder', () => {
    it('descpriority is contiguous starting from 0', () => {
      const priorities = Object.values(gd.itemStatCost).map(s => s.descpriority);
      expect(priorities.includes(0)).toBe(true);
      const maxP = Math.max(...priorities);
      expect(maxP).toBe(priorities.length - 1);
    });
  });

  describe('locale', () => {
    it('locale.strings has entries', () => {
      expect(Object.keys(gd.locale.strings).length).toBeGreaterThan(1000);
    });

    it('locale.istrings has entries', () => {
      expect(gd.locale.istrings.length).toBeGreaterThan(0);
    });

    it('locale.stringi has entries', () => {
      expect(Object.keys(gd.locale.stringi).length).toBeGreaterThan(1000);
    });
  });

  describe('info', () => {
    it('info.stash has Blizzless dimensions', () => {
      expect(gd.info.stash).toBeDefined();
      // This might be set by the data or by our default
      expect(gd.info.stash!.rows).toBeGreaterThan(0);
      expect(gd.info.stash!.columns).toBeGreaterThan(0);
    });
  });

  describe('item entry shape', () => {
    it('armor entry has expected fields', () => {
      const cap = gd.items['cap'];
      expect(cap).toBeDefined();
      expect(cap.code).toBe('cap');
      expect(cap.invwidth).toBeGreaterThan(0);
      expect(cap.invheight).toBeGreaterThan(0);
      expect(typeof cap.hd).toBe('string');
    });

    it('weapon entry has expected fields', () => {
      const hax = gd.items['hax'];
      expect(hax).toBeDefined();
      expect(hax.code).toBe('hax');
      expect(hax.invwidth).toBeGreaterThan(0);
    });

    it('misc entry has expected fields', () => {
      const hp1 = gd.items['hp1'];
      expect(hp1).toBeDefined();
      expect(hp1.code).toBe('hp1');
    });
  });
});
