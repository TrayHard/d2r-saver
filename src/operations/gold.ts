/**
 * Gold amounts read and written in place — 0.4.17.
 *
 * Where the game keeps gold in a v105 save:
 *
 * - `.d2s` character: stat 14 `gold` (carried in the inventory) and stat 15 `goldbank` (the personal stash) in the
 *   bit-packed stats section at byte 833 (`gf`, then 9-bit stat id + `CSvBits` value pairs in ascending id order, ended
 *   by id 511 and padded with zero bits to a byte). The game omits a stat whose value is 0, so a gold value going from
 *   0 to non-zero inserts 9 + 25 bits and going to 0 removes them: the section and the file change length.
 * - `.d2i` shared stash: a u32 at byte 12 of every sector header. Only normal sectors (type 0) hold gold; the
 *   materials sector (type 1) never does. The file has no checksum.
 *
 * Caps of the game (D2R 3.3 client, recovered in server-from-scratch `analysis/debug-client-330/full-recovery/RECOVERY.md`,
 * "Gold, sound and hotkey follow-through", and `poc/d2r_shared_stash.py`): carried gold up to level × 10,000
 * (0x27d410); the personal stash and every normal shared tab up to 2,500,000. A larger value is reset by the game on
 * load, so the writer refuses it.
 *
 * Every write changes only the gold bits (and, for a character, the derived size and checksum), proves it bit by bit and
 * re-reads the result.
 */

import { computeChecksum } from '../core/checksum.js';
import type { GameData } from '../game-data/game-data.js';
import { walkD2I } from '../formats/item-walker.js';
import { readD2S } from '../formats/d2s-reader.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import { BLIZZLESS_VERSION, D2S_MAGIC } from '../types/constants.js';

/** Carried gold per character level. */
export const GOLD_PER_CHARACTER_LEVEL = 10_000;
/** Gold the personal stash of a character holds. */
export const CHARACTER_STASH_GOLD_MAX = 2_500_000;
/** Gold one normal shared-stash tab holds. */
export const SHARED_TAB_GOLD_MAX = 2_500_000;

/** The most gold a character of this level carries in the inventory. */
export function characterGoldMax(level: number): number {
  return Number.isSafeInteger(level) && level > 0 ? level * GOLD_PER_CHARACTER_LEVEL : 0;
}

const STATS_OFFSET = 833;
const STAT_GOLD = 14;
const STAT_GOLDBANK = 15;
const STAT_LEVEL = 12;
const STAT_END = 0x1ff;
const SIZE_OFFSET = 8;
const CHECKSUM_OFFSET = 12;
const D2I_GOLD_OFFSET = 12;

// ─── Bits ───────────────────────────────────────────────────────

function bitAt(bytes: Uint8Array, bit: number): number {
  return (bytes[bit >> 3] >> (bit & 7)) & 1;
}

function readBits(bytes: Uint8Array, bit: number, width: number): number {
  if (bit + width > bytes.length * 8) throw new D2RSaverError(ErrorCode.BUFFER_OVERRUN, 'stats section runs past the file');
  let value = 0;
  for (let i = 0; i < width; i++) value += bitAt(bytes, bit + i) * 2 ** i;
  return value;
}

function writeBits(bytes: Uint8Array, bit: number, width: number, value: number): void {
  for (let i = 0; i < width; i++) {
    const on = Math.floor(value / 2 ** i) % 2;
    if (on) bytes[(bit + i) >> 3] |= 1 << ((bit + i) & 7);
    else bytes[(bit + i) >> 3] &= ~(1 << ((bit + i) & 7));
  }
}

function u32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

// ─── Character stats section ────────────────────────────────────

interface StatEntry {
  id: number;
  width: number;
  value: number;
  /** Bit of the 9-bit id, absolute in the file. */
  bit: number;
}

interface StatsSection {
  entries: StatEntry[];
  /** Bit of the terminating 511 id. */
  endBit: number;
  /** First byte after the padded section. */
  endByte: number;
}

function statWidths(gd: GameData): Map<number, number> {
  const widths = new Map<number, number>();
  for (const key in gd.itemStatCost) {
    const stat = gd.itemStatCost[key] as { id: number; csvbits?: number };
    if (Number.isInteger(stat.csvbits) && stat.csvbits! > 0 && stat.csvbits! <= 32) widths.set(stat.id, stat.csvbits!);
  }
  return widths;
}

function requireD2S(d2s: Uint8Array): void {
  if (d2s.length < STATS_OFFSET + 4 || u32(d2s, 0) !== D2S_MAGIC) throw new D2RSaverError(ErrorCode.INVALID_FORMAT, 'not a .d2s character file');
  if (u32(d2s, 4) !== BLIZZLESS_VERSION) {
    throw new D2RSaverError(ErrorCode.UNSUPPORTED_VERSION, `stats layout is known for v105 only, got v${u32(d2s, 4)}`);
  }
  if (u32(d2s, SIZE_OFFSET) !== d2s.length) {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, `file size field ${u32(d2s, SIZE_OFFSET)} differs from ${d2s.length} bytes`);
  }
  if (u32(d2s, CHECKSUM_OFFSET) !== computeChecksum(d2s)) {
    throw new D2RSaverError(ErrorCode.CHECKSUM_MISMATCH, 'character file checksum does not match its bytes');
  }
}

/** Walks the stats section; every id must be known, strictly ascending and the padding zero. */
function readStats(d2s: Uint8Array, widths: Map<number, number>): StatsSection {
  if (d2s[STATS_OFFSET] !== 0x67 || d2s[STATS_OFFSET + 1] !== 0x66) throw new D2RSaverError(ErrorCode.PARSE_ERROR, 'no "gf" stats header at byte 833');
  const entries: StatEntry[] = [];
  let bit = (STATS_OFFSET + 2) * 8;
  for (;;) {
    const id = readBits(d2s, bit, 9);
    if (id === STAT_END) break;
    const width = widths.get(id);
    if (width === undefined) throw new D2RSaverError(ErrorCode.PARSE_ERROR, `unknown character stat ${id}`);
    if (entries.length && entries[entries.length - 1].id >= id) {
      throw new D2RSaverError(ErrorCode.PARSE_ERROR, `character stats are not in ascending order at stat ${id}`);
    }
    entries.push({ id, width, value: readBits(d2s, bit + 9, width), bit });
    bit += 9 + width;
  }
  const endByte = Math.ceil((bit + 9) / 8);
  for (let b = bit + 9; b < endByte * 8; b++) {
    if (bitAt(d2s, b)) throw new D2RSaverError(ErrorCode.PARSE_ERROR, 'stats padding is not zero');
  }
  if (d2s[endByte] !== 0x69 || d2s[endByte + 1] !== 0x66) throw new D2RSaverError(ErrorCode.PARSE_ERROR, 'no "if" skills header after the stats');
  return { entries, endBit: bit, endByte };
}

export interface CharacterGold {
  /** Carried in the inventory (stat `gold`). */
  gold: number;
  /** In the personal stash (stat `goldbank`). */
  goldbank: number;
  level: number;
}

/** Gold of a v105 character file and the level its carried gold is capped by. */
export function readCharacterGold(d2s: Uint8Array, gd: GameData): CharacterGold {
  requireD2S(d2s);
  const { entries } = readStats(d2s, statWidths(gd));
  const value = (id: number) => entries.find(entry => entry.id === id)?.value ?? 0;
  return { gold: value(STAT_GOLD), goldbank: value(STAT_GOLDBANK), level: value(STAT_LEVEL) };
}

export interface SetCharacterGoldResult {
  bytes: Uint8Array;
  before: CharacterGold;
  after: CharacterGold;
}

function checkAmount(name: string, value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `${name} must be an integer in [0, ${max}], got ${String(value)}`);
  }
}

/**
 * Set the carried and/or personal stash gold of a character. The input is not modified.
 *
 * The stats are rebuilt from the same entries with only stat 14 and 15 changed: a stat set to 0 is left out and a stat
 * set from 0 is inserted at its id, as the game writes them. Every byte before the stats section (except the size and
 * checksum fields) and every byte after it is copied, which the function proves, then re-reads the whole file.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` for an amount outside the game's cap (carried: level × 10,000; personal
 *   stash: 2,500,000) or no change requested; the format errors of the stats walk; `WRITE_ERROR` if a self-check fails.
 */
export function setCharacterGold(d2s: Uint8Array, gd: GameData, next: { gold?: number; goldbank?: number }): SetCharacterGoldResult {
  requireD2S(d2s);
  const widths = statWidths(gd);
  const section = readStats(d2s, widths);
  const value = (id: number) => section.entries.find(entry => entry.id === id)?.value ?? 0;
  const before: CharacterGold = { gold: value(STAT_GOLD), goldbank: value(STAT_GOLDBANK), level: value(STAT_LEVEL) };
  if (next.gold === undefined && next.goldbank === undefined) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'no gold amount to set');
  const after: CharacterGold = { gold: next.gold ?? before.gold, goldbank: next.goldbank ?? before.goldbank, level: before.level };
  // Only a changed amount is checked: a value the file already holds is copied as it is.
  if (after.gold !== before.gold) checkAmount('gold', after.gold, characterGoldMax(before.level));
  if (after.goldbank !== before.goldbank) checkAmount('goldbank', after.goldbank, CHARACTER_STASH_GOLD_MAX);
  for (const id of [STAT_GOLD, STAT_GOLDBANK]) {
    if (!widths.has(id) || after[id === STAT_GOLD ? 'gold' : 'goldbank'] >= 2 ** widths.get(id)!) {
      throw new D2RSaverError(ErrorCode.WRITE_ERROR, `stat ${id} has no room for the amount`);
    }
  }

  // Rebuild the stat list: same ids, widths and values, gold stats replaced, inserted or left out.
  const wanted = new Map<number, number>([[STAT_GOLD, after.gold], [STAT_GOLDBANK, after.goldbank]]);
  const list = section.entries.filter(entry => !wanted.has(entry.id)).map(entry => ({ id: entry.id, width: entry.width, value: entry.value }));
  for (const [id, amount] of wanted) if (amount > 0) list.push({ id, width: widths.get(id)!, value: amount });
  list.sort((a, b) => a.id - b.id);
  const bits = 16 + list.reduce((sum, entry) => sum + 9 + entry.width, 0) + 9;
  const stats = new Uint8Array(Math.ceil(bits / 8));
  stats[0] = 0x67;
  stats[1] = 0x66;
  let bit = 16;
  for (const entry of list) {
    writeBits(stats, bit, 9, entry.id);
    writeBits(stats, bit + 9, entry.width, entry.value);
    bit += 9 + entry.width;
  }
  writeBits(stats, bit, 9, STAT_END);

  const tail = d2s.subarray(section.endByte);
  const bytes = new Uint8Array(STATS_OFFSET + stats.length + tail.length);
  bytes.set(d2s.subarray(0, STATS_OFFSET), 0);
  bytes.set(stats, STATS_OFFSET);
  bytes.set(tail, STATS_OFFSET + stats.length);
  writeU32(bytes, SIZE_OFFSET, bytes.length);
  writeU32(bytes, CHECKSUM_OFFSET, computeChecksum(bytes));

  // Self-check 1: the header and the tail are byte-identical, the size and checksum are right.
  for (let i = 0; i < STATS_OFFSET; i++) {
    const derived = (i >= SIZE_OFFSET && i < SIZE_OFFSET + 4) || (i >= CHECKSUM_OFFSET && i < CHECKSUM_OFFSET + 4);
    if (!derived && bytes[i] !== d2s[i]) throw new D2RSaverError(ErrorCode.WRITE_ERROR, `setCharacterGold changed header byte ${i}`);
  }
  for (let i = 0; i < tail.length; i++) {
    if (bytes[STATS_OFFSET + stats.length + i] !== tail[i]) throw new D2RSaverError(ErrorCode.WRITE_ERROR, `setCharacterGold changed byte ${section.endByte + i} after the stats`);
  }
  // Self-check 2: the new section reads back with every other stat as it was and the gold as asked.
  const reread = readStats(bytes, widths);
  const others = (entries: StatEntry[]) => JSON.stringify(entries.filter(entry => !wanted.has(entry.id)).map(({ id, width, value: v }) => [id, width, v]));
  const golds = (entries: StatEntry[]) => JSON.stringify(entries.filter(entry => wanted.has(entry.id)).map(({ id, value: v }) => [id, v]));
  const expectedGolds = JSON.stringify([...wanted].filter(([, amount]) => amount > 0).map(([id, amount]) => [id, amount]));
  if (others(reread.entries) !== others(section.entries) || golds(reread.entries) !== expectedGolds) {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'character stats do not read back with only the gold changed');
  }
  // Self-check 3: the whole file still parses, with the same item lists.
  try {
    const was = readD2S(d2s, gd);
    const now = readD2S(bytes, gd);
    if (now.profile.attributes?.gold !== (after.gold || undefined) || now.profile.attributes?.goldbank !== (after.goldbank || undefined)
      || comparable(now.lists) !== comparable(shiftLists(was.lists, bytes.length - d2s.length))) {
      throw new Error('lists differ');
    }
  } catch (error) {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, `character does not re-read after the gold edit: ${(error as Error).message}`);
  }
  return { bytes, before, after };
}

/** Reports as text; an error names the bit it stopped at, which moves with the stats. */
const comparable = (lists: unknown) => JSON.stringify(lists, (key, value) => (key === 'error' && value ? value.replace(/[0-9]+/g, '#') : value));

/** The item list reports of a file whose bytes after the stats moved by `delta`. */
function shiftLists(lists: unknown, delta: number): unknown {
  const offsetKey = /offset$|^expectedEnd$/i;
  const shift = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map(entry => shift(entry));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shift(v, k)]));
    }
    return typeof value === 'number' && offsetKey.test(key) ? value + delta : value;
  };
  return shift(lists);
}

// ─── Shared stash tabs ──────────────────────────────────────────

export interface SharedTabGold {
  /** Byte offset of the sector header. */
  sectorOffset: number;
  gold: number;
}

/** Gold of every normal sector (type 0) of a v105 `.d2i`, in file order. The file must tile into sectors. */
export function readSharedTabGold(d2i: Uint8Array, gd: GameData): SharedTabGold[] {
  const walk = walkD2I(d2i, gd);
  if (!walk.tiled || !walk.reachedEof || !walk.sectors.length) throw new D2RSaverError(ErrorCode.PARSE_ERROR, 'shared stash does not tile into sectors');
  return walk.sectors.filter(sector => sector.type === 0).map(sector => ({ sectorOffset: sector.offset, gold: sector.gold }));
}

export interface SetSharedTabGoldResult {
  bytes: Uint8Array;
  sectorOffset: number;
  before: number;
  after: number;
}

/**
 * Set the gold of one normal sector of a `.d2i`. The input is not modified. Only the four gold bytes of that sector
 * header change, which the function proves, then re-walks the file.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` for an amount outside [0, 2,500,000] or an offset that is not a normal
 *   sector; `PARSE_ERROR` for a file that does not tile; `WRITE_ERROR` if a self-check fails.
 */
export function setSharedTabGold(d2i: Uint8Array, gd: GameData, sectorOffset: number, gold: number): SetSharedTabGoldResult {
  checkAmount('gold', gold, SHARED_TAB_GOLD_MAX);
  const tabs = readSharedTabGold(d2i, gd);
  const tab = tabs.find(entry => entry.sectorOffset === sectorOffset);
  if (!tab) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `no normal sector at byte ${String(sectorOffset)}`);
  const bytes = new Uint8Array(d2i);
  writeU32(bytes, sectorOffset + D2I_GOLD_OFFSET, gold);
  for (let i = 0; i < bytes.length; i++) {
    const allowed = i >= sectorOffset + D2I_GOLD_OFFSET && i < sectorOffset + D2I_GOLD_OFFSET + 4;
    if (!allowed && bytes[i] !== d2i[i]) throw new D2RSaverError(ErrorCode.WRITE_ERROR, `setSharedTabGold changed byte ${i}`);
  }
  const reread = readSharedTabGold(bytes, gd);
  if (reread.length !== tabs.length || reread.some((entry, index) =>
    entry.sectorOffset !== tabs[index].sectorOffset || entry.gold !== (entry.sectorOffset === sectorOffset ? gold : tabs[index].gold))) {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'shared stash does not read back with only the gold changed');
  }
  return { bytes, sectorOffset, before: tab.gold, after: gold };
}
