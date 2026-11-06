import type { GameData } from '../game-data/game-data.js';
import type { ByteRange } from './item-parser.js';
import { engineReadDemons } from '../engine/engine.js';

export interface D2SDemonStat { id: number; value: number; }
export interface D2SDemonRecord {
  descriptor: ByteRange;
  statsRange: ByteRange;
  statDataSize: number;
  demonType: number;
  classId: number;
  stats: D2SDemonStat[];
}
export interface D2SDemonSectionReport {
  headerOffset: number;
  endOffset: number;
  declared: number;
  parsed: number;
  records: D2SDemonRecord[];
  complete: boolean;
  reachedEof: boolean;
  error: string | null;
}

/**
 * Strict v105 bridge + lf reader, read by the Rust core (`read_demons` in
 * `rust/core/src/character.rs`). No marker scanning or fixed 116-byte shortcut.
 * Wire evidence: D2SSharp/src/D2SSharp/Model/DemonSection.cs (DemonData.Read/ReadDemonStats),
 * https://github.com/ResurrectedTrader/D2SSharp/blob/main/src/D2SSharp/Model/DemonSection.cs
 * The 92-byte descriptor starts with the gf blob length, not an entry length.
 * Only count 0/1 and the zero-CsvParam base stats (IDs 0..15) are certified here.
 * Unknown record types, stat schemas, nonzero padding and trailing bytes fail closed.
 */
export function readD2SDemonSection(data: Uint8Array, headerOffset: number, gd: GameData): D2SDemonSectionReport {
  if (!Number.isSafeInteger(headerOffset) || headerOffset < 0 || headerOffset > data.length) {
    return { headerOffset, endOffset: 0, declared: 0, parsed: 0, records: [], complete: false, reachedEof: false,
      error: 'invalid demon section offset' };
  }
  return engineReadDemons(gd, data, headerOffset);
}
