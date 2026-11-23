/**
 * Universal save file reader — detects the format, the save version and the stat table, and parses.
 */

import { readD2S, readLegacyD2S, type D2SReadResult } from '../formats/d2s-reader.js';
import { readD2I, type D2IReadResult } from '../formats/d2i-reader.js';
import { walkLegacyD2I, type D2IParseReport } from '../formats/item-walker.js';
import type { GameData } from '../game-data/game-data.js';
import { withStatTable } from '../game-data/stat-tables.js';
import type { StatTable } from '../game-data/types.js';
import type { ReadOptions } from '../formats/item-parser.js';
import { BLIZZLESS_VERSION, D2S_MAGIC } from '../types/constants.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';

// ─── Types ──────────────────────────────────────────────────────

/** `current` is the game data of the reader; the others come from its `olderStatTables` or the caller. */
export type StatTableName = 'current' | 'blizzless-s2' | 'd2r' | (string & {});

export interface ReadSaveOptions extends ReadOptions {
  /**
   * Stat tables of other mods by the name `statTable` should give (see `parseStatTable`). They are
   * tried after the current table and before the older ones; a name of an older table replaces it (1.2.0).
   */
  statTables?: Record<string, StatTable>;
}

/** What `readSave` found out about the file (1.1.0). */
export interface ReadSaveSource {
  /** The save version in the file's header. */
  version: 99 | 105;
  /**
   * The stat table the file reads to its end with. `null` when none does; `data` is then the read
   * with the current table, its errors included.
   */
  statTable: StatTableName | null;
}

export interface ReadSaveD2SResult extends ReadSaveSource {
  type: 'd2s';
  data: D2SReadResult;
}

export interface ReadSaveD2IResult extends ReadSaveSource {
  type: 'd2i';
  data: D2IReadResult;
}

/** A v99 shared stash has no page layout to split: its sectors come walked (1.1.0). */
export interface ReadSaveLegacyD2IResult extends ReadSaveSource {
  type: 'd2i-v99';
  data: D2IParseReport;
}

export type ReadSaveResult = ReadSaveD2SResult | ReadSaveD2IResult | ReadSaveLegacyD2IResult;

type Parsed =
  | Pick<ReadSaveD2SResult, 'type' | 'data'>
  | Pick<ReadSaveD2IResult, 'type' | 'data'>
  | Pick<ReadSaveLegacyD2IResult, 'type' | 'data'>;

// ─── Public API ─────────────────────────────────────────────────

const LEGACY_VERSION = 99;
const METADATA_SECTOR = 2;

function parse(buffer: Uint8Array, type: 'd2s' | 'd2i', legacy: boolean, gd: GameData, options?: ReadOptions): Parsed {
  if (type === 'd2s') return { type, data: legacy ? readLegacyD2S(buffer, gd, options) : readD2S(buffer, gd, options) };
  return legacy ? { type: 'd2i-v99', data: walkLegacyD2I(buffer, gd, options) } : { type, data: readD2I(buffer, gd, options) };
}

/** Every byte of the file belongs to a list that parsed to its declared count. */
function isComplete(read: Parsed): boolean {
  switch (read.type) {
    case 'd2s': return read.data.coverage.complete;
    case 'd2i': return read.data.tiled && read.data.sectors.every(s => s.type === METADATA_SECTOR || !!s.list?.complete);
    case 'd2i-v99': return read.data.tiled && read.data.sectors.every(s => !s.walk || s.walk.report.complete);
  }
}

/**
 * Read a save file of any version and season: detects the format, the save version (99 or 105) and
 * the stat table the file was written with. The current table is tried first, then `options.statTables`,
 * then the `olderStatTables` of the game data. For reading only: never write a file that was read
 * with another table.
 *
 * @param buffer  Raw file bytes.
 * @param gd      GameData instance.
 * @returns Discriminated union with `type`, parsed `data`, `version` and `statTable`.
 * @throws {D2RSaverError} INVALID_FORMAT if file cannot be detected.
 */
export function readSave(buffer: Uint8Array, gd: GameData, options?: ReadSaveOptions): ReadSaveResult {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = buffer.length >= 16 && view.getUint32(0, true) === D2S_MAGIC;
  const isSave = (offset: number) => [LEGACY_VERSION, BLIZZLESS_VERSION].includes(view.getUint32(offset, true));
  const type = magic && isSave(4) ? 'd2s' : magic && isSave(8) ? 'd2i' : null;
  if (!type) {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, 'File is not a d2s or d2i of save version 99 or 105.');
  }
  const version = view.getUint32(type === 'd2s' ? 4 : 8, true) as 99 | 105;
  const read = (data: GameData) => parse(buffer, type, version === LEGACY_VERSION, data, options);

  let current: Parsed | undefined;
  let failure: unknown;
  const tables = { ...options?.statTables, ...gd.olderStatTables, ...options?.statTables };
  for (const [statTable, table] of [['current', null] as const, ...Object.entries(tables)]) {
    try {
      const parsed = read(table ? withStatTable(gd, table) : gd);
      if (isComplete(parsed)) return { ...parsed, version, statTable };
      if (!table) current = parsed;
    } catch (error) {
      // A table the core refuses is the caller's mistake, not the file's.
      if (error instanceof D2RSaverError && error.code === ErrorCode.DATA_NOT_LOADED) throw error;
      // A file no table reads throws what the current one did.
      if (!table) failure = error;
    }
  }
  if (!current) throw failure;
  return { ...current, version, statTable: null };
}
