/**
 * File I/O utilities for the data parser.
 * Reads TSV game files and writes JSON output.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the data directory (d2r-saver/data). */
export const DATA_PATH = resolve(__dirname, '../../data');

/** Read a TSV game file, skip header row and "Expansion" rows. */
export async function readGameFile(filename: string): Promise<string[][]> {
  const raw = await readFile(`${DATA_PATH}/txt/${filename}.txt`, { encoding: 'utf-8' });
  return raw
    .trim()
    .split('\n')
    .slice(1)
    .filter((line) => !line.startsWith('Expansion'))
    .map((line) => line.split('\t'));
}

/** Trim a field value (identity for now, kept for d2planner compat). */
export function getString(code: string): string {
  return code.trim();
}

/** Write a JSON file into data/json/. */
export async function writeJson(filename: string, data: unknown): Promise<void> {
  const outPath = `${DATA_PATH}/json/${filename}.json`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(data, undefined, 2));
}
