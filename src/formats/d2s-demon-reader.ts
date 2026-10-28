import type { GameData } from '../game-data/game-data.js';
import { BinaryReader } from '../core/binary-reader.js';
import type { ByteRange } from './item-parser.js';

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
 * Strict v105 bridge + lf reader. No marker scanning or fixed 116-byte shortcut.
 * Wire evidence: D2SSharp/src/D2SSharp/Model/DemonSection.cs (DemonData.Read/ReadDemonStats),
 * https://github.com/ResurrectedTrader/D2SSharp/blob/main/src/D2SSharp/Model/DemonSection.cs
 * The 92-byte descriptor starts with the gf blob length, not an entry length.
 * Only count 0/1 and the zero-CsvParam base stats (IDs 0..15) are certified here.
 * Unknown record types, stat schemas, nonzero padding and trailing bytes fail closed.
 */
export function readD2SDemonSection(data: Uint8Array, headerOffset: number, gd: GameData): D2SDemonSectionReport {
  const report: D2SDemonSectionReport = { headerOffset, endOffset: headerOffset, declared: 0, parsed: 0,
    records: [], complete: false, reachedEof: false, error: null };
  const reader = new BinaryReader(data);
  try {
    if (!Number.isSafeInteger(headerOffset) || headerOffset < 0 || headerOffset > data.length) throw Error('invalid demon section offset');
    reader.seek(headerOffset);
    if (reader.read16() !== 1 || reader.read16() !== 0x666c) throw Error('unknown demon section version or marker');
    report.declared = reader.read16();
    if (report.declared > 1) throw Error('unsupported demon count or header padding');
    if (report.declared === 1) {
      const start = reader.bitpos / 8;
      // A bounded descriptor is metadata, never an item stream. Preserve all its unknown fields.
      if (start + 92 > data.length) throw Error('truncated demon descriptor');
      const statDataSize = reader.read16();
      const demonType = reader.read16();
      const classId = reader.read16();
      if (demonType !== 1 && demonType !== 2) throw Error('unknown demon type');
      if (classId === 0) throw Error('invalid demon class');
      reader.seek(start + 92);
      const statsStart = reader.bitpos / 8;
      const statsEnd = statsStart + statDataSize;
      if (statDataSize < 4 || statsEnd > data.length) throw Error('invalid demon stat data size');
      // Bound every bit read to the declared blob, not the whole character save.
      const statsReader = new BinaryReader(data.subarray(statsStart, statsEnd));
      if (statsReader.read16() !== 0x6667) throw Error('invalid demon stats marker');
      const stats: D2SDemonStat[] = [];
      const seen = new Set<number>();
      const knownBaseStats = new Set(Object.values(gd.itemStatCost).filter(stat => stat.id >= 0 && stat.id <= 15).map(stat => stat.id));
      while (true) {
        const id = statsReader.bits(9);
        if (id === 0x1ff) break;
        if (!knownBaseStats.has(id)) throw Error('unsupported demon stat schema');
        if (seen.has(id)) throw Error('duplicate demon stat');
        seen.add(id);
        stats.push({ id, value: statsReader.bits(32) >>> 0 });
      }
      const padding = (8 - (statsReader.bitpos % 8)) % 8;
      if (statsReader.bits(padding) !== 0 || statsReader.bitpos !== statDataSize * 8) throw Error('unconsumed demon stat bytes or nonzero padding');
      reader.seek(statsEnd);
      report.records.push({ descriptor: { start, end: start + 92 }, statsRange: { start: statsStart, end: statsEnd },
        statDataSize, demonType, classId, stats });
      report.parsed = 1;
    }
    report.endOffset = reader.bitpos / 8;
    report.reachedEof = report.endOffset === data.length;
    if (!report.reachedEof) throw Error('unknown trailing character data');
    report.complete = report.parsed === report.declared;
  } catch (error) {
    report.endOffset = reader.bitpos / 8;
    report.error = error instanceof Error ? error.message : 'demon section parse failure';
  }
  return report;
}
