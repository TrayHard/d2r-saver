/**
 * File-system loader for game data (data.json + strings.json).
 * Reads from the local filesystem — no browser / HTTP dependencies.
 */

import type { RawGameData } from './types.js';

/** Locale entry: [key, value] tuples array. */
export type LocaleArray = ([string, string] | null)[];

export interface LoadedData {
  rawData: RawGameData;
  locale: LocaleArray;
}

/**
 * Load game data from the filesystem.
 *
 * @param dataPath   Path to `data.json`.
 * @param stringsPath  Path to `strings.json` (locale array).
 */
export async function loadDataFromFile(dataPath: string, stringsPath: string): Promise<LoadedData> {
  // Lazy-load node builtins INSIDE the function so this module carries no
  // top-level node: import. That keeps loader.ts import-safe in browser
  // bundlers (Vite/Rollup/Webpack) — the node: deps resolve only at runtime
  // when a Node consumer actually calls this (browser consumers use fromRaw).
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const [rawText, localeText] = await Promise.all([
    readFile(resolve(dataPath), 'utf-8'),
    readFile(resolve(stringsPath), 'utf-8'),
  ]);

  const rawData: RawGameData = JSON.parse(rawText);
  const locale: LocaleArray = JSON.parse(localeText);

  return { rawData, locale };
}

/**
 * Load game data from pre-parsed objects (e.g. when data is already in memory).
 */
export function loadDataFromJSON(rawData: RawGameData, locale: LocaleArray): LoadedData {
  return { rawData, locale };
}
