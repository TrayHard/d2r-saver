/**
 * Strings generator.
 * Builds the locale strings.json from JSON string files + TBL text files.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_PATH, writeJson } from './files.js';

export async function generateStrings(): Promise<void> {
  const map = new Map<string, string>();

  // JSON strings first (blizzless-specific)
  const jsonFiles = [
    'item-gems', 'item-modifiers', 'item-nameaffixes', 'item-names',
    'item-runes', 'skills', 'mercenaries', 'monsters', 'npcs',
  ];
  for (const name of jsonFiles) {
    const raw = await readFile(
      resolve(DATA_PATH, `txt/strings/${name}.json`),
      { encoding: 'utf-8' },
    );
    for (const [key, value] of readJSONStrings(raw)) {
      map.set(key.trim(), value.trim());
    }
  }

  // TBL files fill in missing keys only
  for (const file of ['string.txt', 'expansionstring.txt', 'patchstring.txt']) {
    const raw = await readFile(
      resolve(DATA_PATH, `txt/${file}`),
      { encoding: 'utf-8' },
    );
    for (const [key, value] of readTBLStrings(raw)) {
      if (!map.has(key)) {
        map.set(key, value);
      }
    }
  }

  const result = [...map.entries()];
  await writeJson('strings', result);
  // Also write to data/ root for direct consumption
  await writeFile(
    resolve(DATA_PATH, 'strings.json'),
    JSON.stringify(result),
  );
}

function readTBLStrings(file: string): [string, string][] {
  // Remove BOM
  if (file.charCodeAt(0) === 0xfeff) {
    file = file.slice(1);
  }
  const result: [string, string][] = [];
  for (const line of file.split('\n').slice(1)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const key = line.substring(0, tab).trim();
    const value = line.substring(tab + 1).trim();
    if (key && !key.startsWith('//')) {
      result.push([key, value]);
    }
  }
  return result;
}

function readJSONStrings(file: string): [string, string][] {
  // Remove BOM
  if (file.charCodeAt(0) === 0xfeff) {
    file = file.slice(1);
  }
  const data = JSON.parse(file) as Array<{ Key: string; enUS?: string }>;
  const result: [string, string][] = [];
  for (const str of data) {
    result.push([str.Key, str.enUS?.replace(/ÿc./g, '') ?? '']);
  }
  return result;
}
