/** Blizzless mod 14.11.2026 (Bartuc patch): the new uniques, their new stats and the item containers. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameData } from '../src/game-data/game-data.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';
import { walkItemList } from '../src/formats/item-walker.js';
import { writeItemList, type ItemWriteLocation } from '../src/formats/item-writer.js';

const raw = JSON.parse(readFileSync('data/data.json', 'utf8'));
const gd = GameData.fromRaw(raw, JSON.parse(readFileSync('data/strings.json', 'utf8')));
const uniques = raw.uniqueItems as Record<string, Record<string, unknown>>;

describe('Bartuc patch data', () => {
  it('defines both Bartuc uniques on the rows the unused placeholders held', () => {
    expect(uniques.unique695).toMatchObject({ index: 'BloodforgedHelm', code: 'uh9', lvlreq: 80, prop7: 'miasma-chain', prop8: 'demon-max' });
    expect(uniques.unique696).toMatchObject({ index: 'BloodforgedArmor', code: 'uul', lvlreq: 80, prop6: 'abyss-nocd', prop7: 'apoc-dot' });
  });

  it('defines the seven containers on the bag base', () => {
    const containers = ['cont_bloodscroll', 'cont_bloodstone', 'cont_demonpaw', 'cont_elixirwealth', 'cont_elixirwisdom',
      'cont_elixirlifemana', 'cont_elixirfortune'];
    containers.forEach((index, n) => expect(uniques[`unique${735 + n}`]).toMatchObject({ index, code: 'bg1', prop1: 'Add_one' }));
  });

  it('names the HD art of the new items from the mod maps', () => {
    expect(uniques.unique696.hd).toEqual(['armor/bloodforged_armor', 'armor/bloodforged_armor', 'armor/bloodforged_armor']);
    expect(uniques.unique736.hd).toEqual(['quest/cont_bloodstone', 'quest/cont_bloodstone', 'quest/cont_bloodstone']);
    expect(raw.misc.p14).toMatchObject({ hd: 'quest/tattered_scroll', invwidth: 1, invheight: 1 });
    expect(raw.misc.p22.hd).toBe('potion/blizzless_luck_elixir');
  });

  it('reads an item carrying the new stats and the item after it', () => {
    const vessel: BinaryParsedItem = {
      itemId: 1, base: 'uul', quality: 7, ilvl: 95, unidentified: false, ethereal: false, socketed: false, sockets: 0,
      socketedItems: [], unique: 'unique696', binaryOffset: { start: 0, end: 0 },
      stats: { abyss_nocd: 1, apocalypse_dot: 1, demon_summon_bonus: 1, miasma_chain_bonus: 10, item_allskills: 3 },
    };
    const rune: BinaryParsedItem = {
      itemId: 2, base: 'r01', quality: 2, ilvl: 1, unidentified: false, ethereal: false, socketed: false, sockets: 0,
      socketedItems: [], stats: {}, binaryOffset: { start: 0, end: 0 }, quantity: 1,
    };
    const at = (x: number): ItemWriteLocation => ({ loc: 0, equip: 0, x, y: 0, storage: 5 });
    const bytes = writeItemList([{ item: vessel, location: at(0) }, { item: rune, location: at(3) }], { 1: vessel, 2: rune }, gd);

    const { report, entries } = walkItemList(bytes, 0, gd);
    expect(report).toMatchObject({ declared: 2, parsed: 2, complete: true });
    const [readVessel, readRune] = entries.map((entry) => entry.item);
    expect(readVessel).toMatchObject({ base: 'uul', unique: 'unique696' });
    expect(readVessel.stats).toMatchObject(vessel.stats);
    expect(readRune).toMatchObject({ base: 'r01' });
  });
});
