/**
 * Universal save file reader — auto-detects format and parses.
 */

import { detectFormat } from '../formats/detect.js';
import { readD2S, type D2SReadResult } from '../formats/d2s-reader.js';
import { readD2I, type D2IReadResult } from '../formats/d2i-reader.js';
import type { GameData } from '../game-data/game-data.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ReadSaveD2SResult {
  type: 'd2s';
  data: D2SReadResult;
}

export interface ReadSaveD2IResult {
  type: 'd2i';
  data: D2IReadResult;
}

export type ReadSaveResult = ReadSaveD2SResult | ReadSaveD2IResult;

// ─── Public API ─────────────────────────────────────────────────

/**
 * Detect format and parse a save file buffer.
 *
 * @param buffer  Raw file bytes.
 * @param gd      GameData instance.
 * @returns Discriminated union with `type` and parsed `data`.
 * @throws {D2RSaverError} INVALID_FORMAT if file cannot be detected.
 */
export function readSave(buffer: Uint8Array, gd: GameData): ReadSaveResult {
  const format = detectFormat(buffer);
  if (!format) {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, 'File is not a valid Blizzless v105 d2s or d2i.');
  }

  if (format.type === 'd2s') {
    return { type: 'd2s', data: readD2S(buffer, gd) };
  }

  return { type: 'd2i', data: readD2I(buffer, gd) };
}
