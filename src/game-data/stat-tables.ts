/**
 * The stat table a save is read with. An item stores its stats as bare bits; their ids and widths
 * come from the game's `itemstatcost.txt`, so a save reads only with the table of its own game.
 * The tables live in `data/data.json`: `itemStatCost` is the current one, `olderStatTables` the
 * ones before it, built from `data/txt/older/`.
 */

import type { StatTable } from './types.js';
import { GameData } from './game-data.js';

/** The columns of `itemstatcost.txt` that decide how a save is read. */
const COLUMNS = { id: '*id', savebits: 'save bits', saveadd: 'save add', saveparambits: 'save param bits', csvbits: 'csvbits' } as const;

/**
 * The stat table of a game or a mod from the text of its `itemstatcost.txt` (1.2.0). Columns are
 * found by name, so the column order of the game version does not matter.
 *
 * @throws {Error} when the text has no `Stat`, `*ID` or save column, or a stat has no id.
 */
export function parseStatTable(itemStatCostTxt: string): StatTable {
  const [header, ...lines] = itemStatCostTxt.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  const names = (header ?? '').split('\t').map(name => name.trim().toLowerCase());
  for (const name of ['stat', ...Object.values(COLUMNS)]) {
    if (!names.includes(name)) throw new Error(`itemstatcost.txt has no column "${name}"`);
  }
  const table: StatTable = {};
  for (const line of lines) {
    const cells = line.split('\t');
    const cell = (name: string) => (cells[names.indexOf(name)] ?? '').trim();
    const stat = cell('stat');
    if (!stat) continue;
    if (!/^\d+$/.test(cell(COLUMNS.id))) throw new Error(`itemstatcost.txt: ${stat} has no id`);
    table[stat] = {
      id: Number(cell(COLUMNS.id)),
      savebits: Number(cell(COLUMNS.savebits)),
      saveadd: Number(cell(COLUMNS.saveadd)),
      saveparambits: Number(cell(COLUMNS.saveparambits)),
      csvbits: Number(cell(COLUMNS.csvbits)),
    };
  }
  return table;
}

const variants = new WeakMap<GameData, WeakMap<StatTable, GameData>>();

/** `gd` with another stat table; every other table stays. For reading only. */
export function withStatTable(gd: GameData, table: StatTable): GameData {
  let known = variants.get(gd);
  if (!known) variants.set(gd, known = new WeakMap());
  let variant = known.get(table);
  if (!variant) {
    const now = gd.itemStatCost as Record<string, object | undefined>;
    // The display fields come from the current table where it has the stat.
    const itemStatCost = Object.fromEntries(Object.entries(table).map(
      ([stat, { id, savebits = 0, saveadd = 0, saveparambits = 0, csvbits = 0 }]) => [stat, { ...now[stat], id, savebits, saveadd, saveparambits, csvbits }],
    ));
    variant = Object.assign(Object.create(GameData.prototype) as GameData, gd, { itemStatCost });
    known.set(table, variant);
  }
  return variant;
}
