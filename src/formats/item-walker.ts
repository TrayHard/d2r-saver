/**
 * Item walker — byte-exact traversal of `JM` item lists for in-place editing.
 *
 * The walker runs the regular item parser as a LENGTH ORACLE and records, for every top-level
 * item, the byte range of the item alone and of the item together with its socketed children.
 * Nothing is re-encoded: a range can be cut out of, or pasted into, the original buffer as-is.
 * Items the parser drops from its dictionary (unknown uniques, non-tradeable base types) are
 * still walked, ranged and headed, so a raw layout built from a walk is complete for every item
 * the parser could get past.
 *
 * Facts this module relies on (verified on the fixtures, see the reconnaissance notes):
 * - every item starts and ends on a byte boundary (`parseItem` aligns at the end);
 * - the first 35 bits are flags, bits 35–52 are the position (`loc`, `bodyloc`, `col`, `row`,
 *   `storage`), the Huffman-coded base code starts at bit 53;
 * - socketed children follow their parent immediately and are consumed by the parent's
 *   `parseItem`, so "reader position before/after `parseItem`" is the parent's full range.
 */

import { BinaryReader } from '../core/binary-reader.js';
import type { GameData } from '../game-data/game-data.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import { detectFormat } from './detect.js';
import {
  createItemParser,
  type BinaryParsedItem,
  type ByteRange,
  type ItemListReport,
} from './item-parser.js';

// ─── Layout constants ───────────────────────────────────────────

/** First bit of the 18-bit position block (`loc` 3, `bodyloc` 4, `col` 4, `row` 4, `storage` 3). */
export const ITEM_POSITION_BIT = 35;
/** Number of bits in the position block: bits `[35, 53)`. */
export const ITEM_POSITION_BITS = 18;
/** First bit of the Huffman-coded base code (four characters, the fourth is a space). */
export const ITEM_BASE_BIT = 53;
/** Bytes needed to hold the flags and the position block (bits 0–52). */
const ITEM_HEAD_MIN_BYTES = 7;

/** Sector header size of a `.d2i` page; the `JM` list starts right after it. */
const SECTOR_HEADER_SIZE = 64;

// ─── Types ──────────────────────────────────────────────────────

/**
 * The fixed prefix of an item, decoded from its first bytes without parsing stats. Enough to
 * know what and where an item is, and to patch its position.
 */
export interface ItemHead {
  identified: boolean;
  socketed: boolean;
  ear: boolean;
  simple: boolean;
  ethereal: boolean;
  personalized: boolean;
  runeword: boolean;
  /** The D2R "extras" flag (bit 28): a 52/116-bit block follows the stats. */
  extras: boolean;
  /** 0 stored, 1 equipped, 2 belt, 4 Blizzless materials (also stored), 6 socketed into a parent. */
  loc: number;
  bodyloc: number;
  col: number;
  row: number;
  /** 1 inventory, 4 cube, 5 stash (also the shared stash). */
  storage: number;
  /** Three-letter base code, or `null` for an ear (ears carry a name instead of a code). */
  base: string | null;
}

/** Position fields of an item, the part `patchItemPosition` rewrites. */
export type ItemPosition = Pick<ItemHead, 'loc' | 'bodyloc' | 'col' | 'row' | 'storage'>;

/** One top-level item of a walked list, with its raw byte ranges. */
export interface WalkedItem {
  /** Zero-based position in the list (top-level items only). */
  index: number;
  /** The item alone, absolute bytes. */
  own: ByteRange;
  /** The item plus its socketed children, absolute bytes: what a raw cut/paste moves. */
  full: ByteRange;
  /** Socketed children in stream order (each with its own ranges), empty for most items. */
  children: WalkedItem[];
  /** Decoded fixed prefix (position bits, flags, base code). */
  head: ItemHead;
  /** The fully parsed item, present even when the parser did not register it. */
  item: BinaryParsedItem;
  /**
   * Key of the item in `WalkResult.items` (numeric id, or the base code for preset items such
   * as runes/gems/potions), or `null` when the parser dropped it (unknown unique/set/runeword,
   * or a base type outside the tradeable filter). Dropped items still have exact ranges.
   */
  registeredKey: number | string | null;
  /** The item carries a quantity (stack) field. */
  hasQuantity: boolean;
}

/** A walked `JM` list. */
export interface WalkResult {
  report: ItemListReport;
  /** Every top-level item up to the stop point; `entries.length === report.parsed`. */
  entries: WalkedItem[];
  /** The parser's dictionary for this list (registered items only), keyed as the readers key them. */
  items: Record<number | string, BinaryParsedItem>;
}

/** One raw sector of a walked `.d2i`. */
export interface D2IWalkedSector {
  /** Absolute byte offset of the sector header. */
  offset: number;
  /** `sectorSize` from the header, bytes including the 64-byte header. */
  size: number;
  /** 0 normal, 1 extended (gems/runes/materials), 2 metadata. */
  type: number;
  /** Gold from the header. */
  gold: number;
  /** The walked list; `null` for a metadata sector, which has no item list. */
  walk: WalkResult | null;
}

/** Result of `walkD2I`. */
export interface D2IParseReport {
  sectors: D2IWalkedSector[];
  /** The sector sizes add up to exactly the buffer length. */
  tiled: boolean;
  /** The sector loop ran to the end of the buffer without stopping on an unrecognised sector. */
  reachedEof: boolean;
}

/** Options for `walkItemList`. */
export interface WalkItemListOptions {
  /** First numeric item id the parser assigns (matches the readers' numbering when needed). */
  initialId?: number;
  /** Absolute byte offset where the list must end, if known (sector end for `.d2i`). */
  expectedEnd?: number;
}

// ─── Bit helpers (LSB-first, same convention as BinaryReader) ───

function bitsAt(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const p = bitOffset + i;
    value |= ((bytes[p >> 3] >> (p & 7)) & 1) << i;
  }
  return value;
}

function setBitsAt(bytes: Uint8Array, bitOffset: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) {
    const p = bitOffset + i;
    if ((value >> i) & 1) bytes[p >> 3] |= 1 << (p & 7);
    else bytes[p >> 3] &= ~(1 << (p & 7));
  }
}

function requireInt(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `${name} must be an integer in [0, ${max}], got ${String(value)}`,
    );
  }
}

// ─── Item head ──────────────────────────────────────────────────

/**
 * Decode the fixed prefix of the item that starts at `bytes[offset]`: flags, position bits and
 * the base code. Reads at most a few bytes; never touches the stats.
 *
 * @throws {D2RSaverError} `BUFFER_OVERRUN` when the prefix is cut off; `PARSE_ERROR` when the
 *   fourth Huffman character is not the terminating space (not an item start).
 */
export function readItemHead(bytes: Uint8Array, offset = 0): ItemHead {
  requireInt('offset', offset, Number.MAX_SAFE_INTEGER);
  const reader = new BinaryReader(bytes);
  reader.bitpos = offset * 8;

  // Same reads, in the same order, as the item parser's flag block (35 bits).
  reader.skipbits(4);
  const identified = !!reader.bits(1);
  reader.skipbits(6);
  const socketed = !!reader.bits(1);
  reader.skipbits(4);
  const ear = !!reader.bits(1);
  reader.skipbits(4);
  const simple = !!reader.bits(1);
  const ethereal = !!reader.bits(1);
  reader.skipbits(1);
  const personalized = !!reader.bits(1);
  reader.skipbits(1);
  const runeword = !!reader.bits(1);
  reader.skipbits(1);
  const extras = !!reader.bits(1);
  reader.skipbits(6);

  const loc = reader.bits(3);
  const bodyloc = reader.bits(4);
  const col = reader.bits(4);
  const row = reader.bits(4);
  const storage = reader.bits(3);

  let base: string | null = null;
  if (!ear) {
    const a = reader.char();
    const b = reader.char();
    const c = reader.char();
    const terminator = reader.char();
    if (terminator !== ' ') {
      throw new D2RSaverError(
        ErrorCode.PARSE_ERROR,
        `invalid item code at byte ${offset}: expected a space after "${a}${b}${c}", got "${terminator}"`,
      );
    }
    base = a + b + c;
  }

  return { identified, socketed, ear, simple, ethereal, personalized, runeword, extras, loc, bodyloc, col, row, storage, base };
}

/**
 * Return a copy of `bytes` with the top-level item's position bits (35–52) replaced. The rest of
 * the bytes, including any socketed children after the item, are copied untouched. The input is
 * not modified.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` when a field is out of range or the buffer is
 *   shorter than the position block.
 */
export function patchItemPosition(bytes: Uint8Array, pos: ItemPosition): Uint8Array {
  if (bytes.length < ITEM_HEAD_MIN_BYTES) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `item bytes too short to hold a position block: ${bytes.length} < ${ITEM_HEAD_MIN_BYTES}`,
    );
  }
  requireInt('loc', pos.loc, 7);
  requireInt('bodyloc', pos.bodyloc, 15);
  requireInt('col', pos.col, 15);
  requireInt('row', pos.row, 15);
  requireInt('storage', pos.storage, 7);

  const out = bytes.slice();
  setBitsAt(out, ITEM_POSITION_BIT, 3, pos.loc);
  setBitsAt(out, ITEM_POSITION_BIT + 3, 4, pos.bodyloc);
  setBitsAt(out, ITEM_POSITION_BIT + 7, 4, pos.col);
  setBitsAt(out, ITEM_POSITION_BIT + 11, 4, pos.row);
  setBitsAt(out, ITEM_POSITION_BIT + 15, 3, pos.storage);
  return out;
}

/**
 * Return a copy of `bytes` with the top-level item's position bits (35–52) cleared. Use it to
 * fingerprint an item independently of the cell it sits in: the same item in two cells hashes
 * to the same value, while its socketed children (whose bytes follow) still count.
 */
export function zeroItemPosition(bytes: Uint8Array): Uint8Array {
  return patchItemPosition(bytes, { loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
}

/** Read only the position bits of the item starting at `bytes[offset]`. */
export function readItemPosition(bytes: Uint8Array, offset = 0): ItemPosition {
  if (offset < 0 || offset + ITEM_HEAD_MIN_BYTES > bytes.length) {
    throw new D2RSaverError(
      ErrorCode.BUFFER_OVERRUN,
      `item position block at byte ${offset} runs past the end of a ${bytes.length}-byte buffer`,
    );
  }
  const bit = offset * 8 + ITEM_POSITION_BIT;
  return {
    loc: bitsAt(bytes, bit, 3),
    bodyloc: bitsAt(bytes, bit + 3, 4),
    col: bitsAt(bytes, bit + 7, 4),
    row: bitsAt(bytes, bit + 11, 4),
    storage: bitsAt(bytes, bit + 15, 3),
  };
}

// ─── List walk ──────────────────────────────────────────────────

/**
 * Walk one `JM` item list that starts at absolute byte `headerOffset` of `buffer`.
 *
 * Stops at the first item the parser cannot get past; `report` says how far it got. The
 * entries cover exactly the parsed items, each with byte-exact ranges taken from the reader
 * position before and after its parse.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` for an offset outside the buffer, `PARSE_ERROR`
 *   when the bytes at `headerOffset` are not a `JM` header.
 */
export function walkItemList(
  buffer: Uint8Array,
  headerOffset: number,
  gd: GameData,
  options?: WalkItemListOptions,
): WalkResult {
  requireInt('headerOffset', headerOffset, Number.MAX_SAFE_INTEGER);
  if (headerOffset + 4 > buffer.length) {
    throw new D2RSaverError(
      ErrorCode.BUFFER_OVERRUN,
      `item list header at byte ${headerOffset} runs past the end of a ${buffer.length}-byte buffer`,
    );
  }
  if (buffer[headerOffset] !== 0x4a || buffer[headerOffset + 1] !== 0x4d) {
    throw new D2RSaverError(ErrorCode.PARSE_ERROR, `no "JM" item list header at byte ${headerOffset}`);
  }

  const reader = new BinaryReader(buffer);
  reader.seek(headerOffset);

  // Children finish before their parent, so collect per depth and hand the pending children
  // to the next item that completes one level up.
  const pending: WalkedItem[][] = [];
  const ctx = createItemParser(reader, gd, options?.initialId ?? 0, {
    onItem: ({ item, depth, registeredKey }) => {
      const children = pending[depth + 1] ?? [];
      pending[depth + 1] = [];
      const own = item.byteRange!;
      const entry: WalkedItem = {
        index: -1,
        own,
        full: item.fullByteRange!,
        children,
        head: readItemHead(buffer, own.start),
        item,
        registeredKey,
        hasQuantity: item.quantity !== undefined,
      };
      (pending[depth] ??= []).push(entry);
    },
  });

  const report = ctx.parseItemList(() => {}, { expectedEnd: options?.expectedEnd });
  const entries = pending[0] ?? [];
  if (entries.length !== report.parsed) {
    throw new D2RSaverError(
      ErrorCode.PARSE_ERROR,
      `walker recorded ${entries.length} top-level items but the parser reports ${report.parsed}`,
    );
  }
  numberEntries(entries);
  return { report, entries, items: ctx.items };
}

/** Assign `index` per level: position among siblings (top-level list, or a parent's sockets). */
function numberEntries(entries: WalkedItem[]): void {
  entries.forEach((entry, i) => {
    entry.index = i;
    if (entry.children.length) numberEntries(entry.children);
  });
}

// ─── .d2i walk ──────────────────────────────────────────────────

function readU32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

/**
 * Walk every sector of a `.d2i` shared stash. Sectors are addressed by their byte offset from
 * the header chain (never by index), which is what the in-place operations need.
 *
 * Normal (type 0) and extended (type 1) sectors are walked; metadata (type 2) sectors are
 * listed with `walk: null`. Item ids restart at 1 in every sector.
 *
 * @throws {D2RSaverError} `PARSE_ERROR` when a normal/extended sector has no `JM` list header;
 *   `BUFFER_OVERRUN` when a sector header claims bytes the buffer does not have for its list header.
 */
export function walkD2I(buffer: Uint8Array, gd: GameData): D2IParseReport {
  const sectors: D2IWalkedSector[] = [];
  let offset = 0;
  let stoppedEarly = false;

  while (offset < buffer.length) {
    if (offset + SECTOR_HEADER_SIZE > buffer.length) { stoppedEarly = true; break; }
    const fmt = detectFormat(buffer.subarray(offset));
    if (!fmt || fmt.type !== 'd2i') { stoppedEarly = true; break; }

    const gold = readU32(buffer, offset + 12);
    const size = readU32(buffer, offset + 16);
    const type = buffer[offset + 20];
    if (size < SECTOR_HEADER_SIZE) { stoppedEarly = true; break; }

    let walk: WalkResult | null = null;
    if (type !== 2) {
      walk = walkItemList(buffer, offset + SECTOR_HEADER_SIZE, gd, {
        initialId: 1,
        expectedEnd: offset + size,
      });
    }
    sectors.push({ offset, size, type, gold, walk });
    offset += size;
  }

  return {
    sectors,
    tiled: sectors.length > 0 && offset === buffer.length && !stoppedEarly,
    reachedEof: !stoppedEarly,
  };
}
