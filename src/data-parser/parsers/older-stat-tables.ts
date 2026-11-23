import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseStatTable } from '../../game-data/stat-tables.js';
import type { StatTable } from '../../game-data/types.js';
import { DATA_PATH, writeJson } from '../files.js';

/** data/txt/older/<name>.txt → the stat table `<name>`; the file names give the order `readSave` tries them in. */
export async function olderStatTablesToJson(): Promise<Record<string, StatTable>> {
  const folder = `${DATA_PATH}/txt/older`;
  const tables: Record<string, StatTable> = {};
  for (const file of (await readdir(folder)).sort()) {
    tables[basename(file, '.txt')] = parseStatTable(await readFile(`${folder}/${file}`, 'utf-8'));
  }
  await writeJson('olderStatTables', tables);
  return tables;
}
