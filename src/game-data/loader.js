/**
 * File-system loader for game data (data.json + strings.json).
 * Reads from the local filesystem — no browser / HTTP dependencies.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
/**
 * Load game data from the filesystem.
 *
 * @param dataPath   Path to `data.json`.
 * @param stringsPath  Path to `strings.json` (locale array).
 */
export async function loadDataFromFile(dataPath, stringsPath) {
    const [rawText, localeText] = await Promise.all([
        readFile(resolve(dataPath), 'utf-8'),
        readFile(resolve(stringsPath), 'utf-8'),
    ]);
    const rawData = JSON.parse(rawText);
    const locale = JSON.parse(localeText);
    return { rawData, locale };
}
/**
 * Load game data from pre-parsed objects (e.g. when data is already in memory).
 */
export function loadDataFromJSON(rawData, locale) {
    return { rawData, locale };
}
//# sourceMappingURL=loader.js.map