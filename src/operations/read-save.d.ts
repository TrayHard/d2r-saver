/**
 * Universal save file reader — auto-detects format and parses.
 */
import { type D2SReadResult } from '../formats/d2s-reader.js';
import { type D2IReadResult } from '../formats/d2i-reader.js';
import type { GameData } from '../game-data/game-data.js';
export interface ReadSaveD2SResult {
    type: 'd2s';
    data: D2SReadResult;
}
export interface ReadSaveD2IResult {
    type: 'd2i';
    data: D2IReadResult;
}
export type ReadSaveResult = ReadSaveD2SResult | ReadSaveD2IResult;
/**
 * Detect format and parse a save file buffer.
 *
 * @param buffer  Raw file bytes.
 * @param gd      GameData instance.
 * @returns Discriminated union with `type` and parsed `data`.
 * @throws {D2RSaverError} INVALID_FORMAT if file cannot be detected.
 */
export declare function readSave(buffer: Uint8Array, gd: GameData): ReadSaveResult;
//# sourceMappingURL=read-save.d.ts.map