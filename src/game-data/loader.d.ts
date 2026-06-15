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
export declare function loadDataFromFile(dataPath: string, stringsPath: string): Promise<LoadedData>;
/**
 * Load game data from pre-parsed objects (e.g. when data is already in memory).
 */
export declare function loadDataFromJSON(rawData: RawGameData, locale: LocaleArray): LoadedData;
//# sourceMappingURL=loader.d.ts.map