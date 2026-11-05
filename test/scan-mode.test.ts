/**
 * resolveMods: false skips only the affix solver. Everything read from the bits must match the
 * full read: item identity, quality, unique/set/runeword id, quantity, sockets, raw stats,
 * byte ranges and where every item sits.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { D2RSaver, type BinaryParsedItem } from '../src/index.js';

const saver = D2RSaver.fromData(JSON.parse(readFileSync('data/data.json', 'utf8')), JSON.parse(readFileSync('data/strings.json', 'utf8')));
const fixture = (name: string) => new Uint8Array(readFileSync(`test/fixtures/${name}`));

const SOLVER_FIELDS = ['uniqueValues', 'propertyIndex', 'mods', 'auto', 'staff', 'crafted', 'superior', 'custom'] as const;

/** The fields that come from the bits, without what the solver adds. */
function bitFields(items: Record<string | number, BinaryParsedItem>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(items)) {
    const copy: Record<string, unknown> = { ...item };
    for (const field of SOLVER_FIELDS) delete copy[field];
    out[key] = copy;
  }
  return out;
}

const solverFieldsIn = (items: Record<string | number, BinaryParsedItem>) =>
  Object.values(items).filter((item) => SOLVER_FIELDS.some((field) => (item as Record<string, unknown>)[field] !== undefined)).length;

describe('resolveMods: false', () => {
  // BlizzlessTest.d2s is a v99 save and goes through the legacy reader.
  for (const [name, read] of [
    ['BlizzlessTest.d2s', saver.readLegacyD2S.bind(saver)],
    ['WarlockTest.d2s', saver.readD2S.bind(saver)],
    ['WarlockShards.d2s', saver.readD2S.bind(saver)],
  ] as const) {
    it(`reads the same bits as the full read: ${name}`, () => {
      const full = read(fixture(name));
      const fast = read(fixture(name), { resolveMods: false });
      expect(bitFields(fast.items)).toEqual(bitFields(full.items));
      for (const slot of ['items', 'mercItems', 'inventory', 'cube', 'stash', 'belt'] as const) {
        expect(fast.profile[slot]).toEqual(full.profile[slot]);
      }
      expect(fast.warnings).toEqual(full.warnings);
      expect(solverFieldsIn(fast.items)).toBe(0);
    });
  }

  for (const name of ['SharedStashComplete.d2i', 'SharedStashSoftCoreV2V105.d2i', 'MaterialsTabBuyer.d2i', 'MaterialsTabSeller.d2i']) {
    it(`reads and walks the same bits as the full read: ${name}`, () => {
      const full = saver.readD2I(fixture(name));
      const fast = saver.readD2I(fixture(name), { resolveMods: false });
      expect(bitFields(fast.items)).toEqual(bitFields(full.items));
      expect(fast.pages.map((page) => [page.stash, page.quantities])).toEqual(full.pages.map((page) => [page.stash, page.quantities]));
      expect(solverFieldsIn(fast.items)).toBe(0);

      const walkFull = saver.walkD2I(fixture(name));
      const walkFast = saver.walkD2I(fixture(name), { resolveMods: false });
      const shape = (walk: typeof walkFull) => walk.sectors.map((sector) => sector.walk && {
        report: sector.walk.report,
        entries: sector.walk.entries.map((entry) => [entry.own, entry.full, entry.registeredKey, entry.item.base, entry.item.quantity, entry.children.length]),
      });
      expect(shape(walkFast)).toEqual(shape(walkFull));
    });
  }

  it('still fills the solver fields by default', () => {
    expect(solverFieldsIn(saver.readD2S(fixture('WarlockTest.d2s')).items)).toBeGreaterThan(0);
  });
});
