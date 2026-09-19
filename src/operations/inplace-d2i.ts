/**
 * In-place editing of `.d2i` shared stashes — move raw item bytes without re-encoding the file.
 *
 * The classic `extractItemD2I` / `insertItemD2I` rebuild the whole file through the item
 * writer, which drops every item the parser could not understand and re-synthesises the rest.
 * The operations here never touch the writer: they locate an item's exact bytes with the walker
 * (the parser as a length oracle), splice those bytes out of or into the sector, and patch the
 * three things the format ties to the list — the 16-bit item count, the 32-bit `sectorSize`,
 * and the position bits of the moved item. Every other byte of the file is copied as-is, and
 * each operation proves that claim on its own output with `verifyExactDiff` before returning.
 *
 * Rules (from the offline-trade design, section 6.1):
 * - a sector is addressed by its byte offset from the header chain, never by page index;
 * - only normal (type 0) sectors are edited; extended (1) and metadata (2) are `INVALID_PAGE`;
 * - `insertInPlaceD2I` requires a COMPLETE target list (parsed to the declared count and to
 *   the sector end): with an unparsed tail, the occupancy of the tab is unknown;
 * - `extractInPlaceD2I` requires the same by default; `requireCompleteList: false` allows
 *   cutting an item out of the parsed prefix of a truncated list (tests, phase 6);
 * - there is no automatic placement: the caller names the cell, the raw grid gates it.
 */

import type { GameData } from '../game-data/game-data.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import type { ByteRange, ItemListReport } from '../formats/item-parser.js';
import {
  walkItemList,
  readItemHead,
  patchItemPosition,
  zeroItemPosition,
  type ItemHead,
  type WalkResult,
} from '../formats/item-walker.js';
import { buildRawGrid } from '../inventory/raw-grid.js';
import {
  D2I_SECTOR_HEADER_SIZE,
  D2I_SECTOR_SIZE_OFFSET,
  D2I_LIST_COUNT_OFFSET,
  findD2ISector,
  findNormalD2ISector,
  readU16,
  readU32,
  writeU16,
  writeU32,
  assertExactDiff,
  type DiffSpec,
  type D2ISectorHeader,
} from './verify-diff.js';

// ─── Types ──────────────────────────────────────────────────────

/** Which items to cut out of which sector. */
export interface ExtractInPlaceD2IRef {
  /** Byte offset of the sector header (from `walkD2I(...).sectors[n].offset`). */
  sectorOffset: number;
  /** Zero-based indexes of top-level items in the sector list (`WalkedItem.index`). */
  indexes: number[];
}

/** Options for `extractInPlaceD2I`. */
export interface ExtractInPlaceD2IOptions {
  /**
   * Refuse a sector whose list is not fully understood (default `true`). With `false`, items
   * from the parsed prefix of a truncated list can still be cut out byte-exactly; the
   * truncation point simply moves up by the removed items.
   */
  requireCompleteList?: boolean;
}

/** One item cut out by `extractInPlaceD2I`. */
export interface ExtractedInPlaceItem {
  /** Index the item had in the original list. */
  index: number;
  /**
   * The item's raw bytes together with its socketed children, with the position bits (35–52)
   * of the top-level item cleared by `zeroItemPosition`. Feed them to `insertInPlaceD2I` (which
   * sets a new position) or hash them for a cell-independent fingerprint.
   */
  bytes: Uint8Array;
  /** Where the bytes sat in the ORIGINAL buffer (`WalkedItem.full`). */
  range: ByteRange;
  /** Decoded head of the item as it was in the original buffer (original position included). */
  head: ItemHead;
}

/** Result of `extractInPlaceD2I`. */
export interface ExtractInPlaceD2IResult {
  /** The file with the items removed; every byte outside the declared edit is identical. */
  newBuffer: Uint8Array;
  /** The removed items, in ascending order of their original index. */
  removed: ExtractedInPlaceItem[];
  /** Report of the sector list before the edit. */
  listBefore: ItemListReport;
  /** Report of the sector list after the edit, walked on `newBuffer`. */
  listAfter: ItemListReport;
  /** The edit as `verifyExactDiff` understands it, already proven on `newBuffer`. */
  diff: DiffSpec;
}

/** Where to put items with `insertInPlaceD2I`. */
export interface InsertInPlaceD2ITarget {
  /** Byte offset of the target sector header. */
  sectorOffset: number;
  /**
   * Position in the sector's item list where the items are spliced in, `0..parsed` (default
   * `0`, the head of the list). Inserted items keep their given order. The game does not care
   * about list order; an explicit index lets a cut-and-paste restore the original file byte for
   * byte.
   */
  listIndex?: number;
}

/** One item to insert: raw bytes (with children) and the target cell. */
export interface InsertInPlaceD2IItem {
  /** Raw item bytes including socketed children, as returned by `extractInPlaceD2I`. */
  bytes: Uint8Array;
  /** Column of the item's top-left cell in the stash grid. */
  col: number;
  /** Row of the item's top-left cell in the stash grid. */
  row: number;
}

/** One item placed by `insertInPlaceD2I`. */
export interface InsertedInPlaceItem {
  /** Index the item has in the new list. */
  index: number;
  /** Where the bytes sit in `newBuffer`. */
  range: ByteRange;
  /** Decoded head of the inserted item (new position bits). */
  head: ItemHead;
}

/** Result of `insertInPlaceD2I`. */
export interface InsertInPlaceD2IResult {
  /** The file with the items added; every byte outside the declared edit is identical. */
  newBuffer: Uint8Array;
  /** The inserted items, in list order. */
  inserted: InsertedInPlaceItem[];
  /** Report of the sector list before the edit. */
  listBefore: ItemListReport;
  /** Report of the sector list after the edit, walked on `newBuffer`; always complete. */
  listAfter: ItemListReport;
  /** The edit as `verifyExactDiff` understands it (with the inserted bytes), already proven. */
  diff: DiffSpec;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Position bits every item stored in a shared-stash page carries. */
const STASH_PAGE_POSITION = { loc: 0, bodyloc: 0, storage: 5 } as const;

function requireInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `${name} must be an integer in [${min}, ${max}], got ${String(value)}`,
    );
  }
}

/** Walk the list of a normal sector; the walk covers the whole sector when `complete`. */
function walkSector(buffer: Uint8Array, sector: D2ISectorHeader, gd: GameData): WalkResult {
  return walkItemList(buffer, sector.offset + D2I_SECTOR_HEADER_SIZE, gd, {
    initialId: 1,
    expectedEnd: sector.offset + sector.size,
  });
}

function truncatedMessage(sectorOffset: number, report: ItemListReport): string {
  const reason = report.error ?? (report.reachedEnd === false
    ? `list ends at byte ${report.endOffset} but the sector ends at byte ${report.expectedEnd}`
    : 'unknown');
  return `sector at byte ${sectorOffset}: item list is not complete (${report.parsed}/${report.declared} parsed): ${reason}`;
}

/** Grid size of an item by its head; ears are 1x1. */
function headSize(head: ItemHead, gd: GameData, what: string): { w: number; h: number } {
  if (head.base === null) return { w: 1, h: 1 };
  const base = gd.items[head.base];
  const w = base?.invwidth;
  const h = base?.invheight;
  if (!base || typeof w !== 'number' || typeof h !== 'number' || w < 1 || h < 1) {
    throw new D2RSaverError(ErrorCode.UNKNOWN_BASE, `${what}: unknown base "${head.base}", cannot size it`);
  }
  return { w, h };
}

/**
 * Prove that `bytes` hold exactly one top-level item (plus its children) and nothing else, by
 * parsing them as a one-item list.
 */
function requireStandaloneItem(bytes: Uint8Array, gd: GameData, what: string): void {
  const wrapped = new Uint8Array(4 + bytes.length);
  wrapped[0] = 0x4a; wrapped[1] = 0x4d; wrapped[2] = 1; wrapped[3] = 0;
  wrapped.set(bytes, 4);
  let report: ItemListReport;
  try {
    report = walkItemList(wrapped, 0, gd, { initialId: 1, expectedEnd: wrapped.length }).report;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `${what}: bytes do not parse as an item: ${reason}`);
  }
  if (!report.complete) {
    const reason = report.error ?? `item ends at byte ${report.endOffset - 4} of ${bytes.length}`;
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `${what}: bytes do not parse as exactly one item: ${reason}`);
  }
}

// ─── fixD2ISectorSize ───────────────────────────────────────────

/**
 * Add `delta` to the 32-bit `sectorSize` field of the sector header at `sectorOffset`,
 * in place. This is the only header field `.d2i` ties to the list length (there is no
 * checksum). The buffer must already have been spliced so that the new size fits it.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` when the header does not fit the buffer or the
 *   new size would be smaller than a header or larger than the buffer; `INVALID_FORMAT` when
 *   the bytes at `sectorOffset` are not a Blizzless `.d2i` sector header.
 */
export function fixD2ISectorSize(buffer: Uint8Array, sectorOffset: number, delta: number): void {
  requireInt('sectorOffset', sectorOffset, 0, Number.MAX_SAFE_INTEGER);
  requireInt('delta', delta, -0xffffffff, 0xffffffff);
  if (sectorOffset + D2I_SECTOR_HEADER_SIZE > buffer.length) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `sector header at byte ${sectorOffset} runs past the end of a ${buffer.length}-byte buffer`,
    );
  }
  const magic = readU32(buffer, sectorOffset);
  const version = readU32(buffer, sectorOffset + 8);
  if (magic !== 0xaa55aa55 || version !== 105) {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, `no Blizzless .d2i sector header at byte ${sectorOffset}`);
  }
  const size = readU32(buffer, sectorOffset + D2I_SECTOR_SIZE_OFFSET);
  const next = size + delta;
  if (next < D2I_SECTOR_HEADER_SIZE || sectorOffset + next > buffer.length) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `sectorSize ${size} ${delta >= 0 ? '+' : '-'} ${Math.abs(delta)} = ${next} does not fit a ${buffer.length}-byte buffer at byte ${sectorOffset}`,
    );
  }
  writeU32(buffer, sectorOffset + D2I_SECTOR_SIZE_OFFSET, next);
}

// ─── extractInPlaceD2I ──────────────────────────────────────────

/**
 * Cut one or more top-level items (each with its socketed children) out of a normal stash
 * sector. The removed byte ranges are spliced out, the sector's item count drops by the number
 * of items and its `sectorSize` by the number of bytes; every other byte of the file is copied
 * unchanged, which the function proves on its result before returning.
 *
 * @param buffer  The original `.d2i` bytes (not modified).
 * @param ref     Sector offset and the list indexes of the items to remove.
 * @param gd      GameData for the walker.
 * @param opts    `requireCompleteList` (default `true`).
 * @throws {D2RSaverError} `INVALID_FORMAT` (not a tiled `.d2i`), `INVALID_PAGE` (no sector at
 *   that offset, or not a normal page), `LIST_TRUNCATED` (list not complete and the option
 *   requires it), `ITEM_NOT_FOUND` (an index beyond the parsed items), `INVALID_ARGUMENT`
 *   (empty or duplicated indexes), `RANGE_MISMATCH` (self-check failed).
 */
export function extractInPlaceD2I(
  buffer: Uint8Array,
  ref: ExtractInPlaceD2IRef,
  gd: GameData,
  opts?: ExtractInPlaceD2IOptions,
): ExtractInPlaceD2IResult {
  if (!Array.isArray(ref.indexes) || ref.indexes.length === 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'extractInPlaceD2I: at least one item index is required');
  }
  ref.indexes.forEach((index, i) => requireInt(`indexes[${i}]`, index, 0, 0xffff));
  if (new Set(ref.indexes).size !== ref.indexes.length) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `extractInPlaceD2I: duplicated item index in [${ref.indexes.join(', ')}]`);
  }

  const sector = findNormalD2ISector(buffer, ref.sectorOffset);
  const walk = walkSector(buffer, sector, gd);
  const listBefore = walk.report;
  if ((opts?.requireCompleteList ?? true) && !listBefore.complete) {
    throw new D2RSaverError(ErrorCode.LIST_TRUNCATED, truncatedMessage(sector.offset, listBefore));
  }

  const indexes = [...ref.indexes].sort((a, b) => a - b);
  const entries = indexes.map(index => {
    const entry = walk.entries[index];
    if (!entry) {
      throw new D2RSaverError(
        ErrorCode.ITEM_NOT_FOUND,
        `sector at byte ${sector.offset}: no parsed item with index ${index} (${walk.entries.length} of ${listBefore.declared} parsed)`,
      );
    }
    return entry;
  });

  // Splice the ranges out, ascending, in one pass.
  const ranges = entries.map(e => ({ start: e.full.start, end: e.full.end }));
  const removedBytes = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
  const newBuffer = new Uint8Array(buffer.length - removedBytes);
  let src = 0;
  let dst = 0;
  for (const r of ranges) {
    newBuffer.set(buffer.subarray(src, r.start), dst);
    dst += r.start - src;
    src = r.end;
  }
  newBuffer.set(buffer.subarray(src), dst);

  const countOffset = sector.offset + D2I_LIST_COUNT_OFFSET;
  writeU16(newBuffer, countOffset, readU16(buffer, countOffset) - entries.length);
  fixD2ISectorSize(newBuffer, sector.offset, -removedBytes);

  const diff: DiffSpec = { kind: 'd2i-remove', sectorOffset: sector.offset, ranges };
  assertExactDiff(buffer, newBuffer, diff);

  const listAfter = walkSector(newBuffer, findD2ISector(newBuffer, sector.offset), gd).report;
  if (listAfter.parsed !== listBefore.parsed - entries.length || listAfter.complete !== listBefore.complete) {
    throw new D2RSaverError(
      ErrorCode.RANGE_MISMATCH,
      `sector at byte ${sector.offset}: after removing ${entries.length} item(s) the list parses ` +
        `${listAfter.parsed}/${listAfter.declared} (complete=${listAfter.complete}), expected ` +
        `${listBefore.parsed - entries.length}/${listAfter.declared} (complete=${listBefore.complete})`,
    );
  }

  const removed: ExtractedInPlaceItem[] = entries.map(e => ({
    index: e.index,
    bytes: zeroItemPosition(buffer.slice(e.full.start, e.full.end)),
    range: { start: e.full.start, end: e.full.end },
    head: e.head,
  }));

  return { newBuffer, removed, listBefore, listAfter, diff };
}

// ─── insertInPlaceD2I ───────────────────────────────────────────

/**
 * Paste one or more items (raw bytes with children) into a normal stash sector at explicit
 * cells. The target list must be complete; the raw occupancy grid of the sector must have the
 * cells free (for every item, including the ones inserted earlier in the same call); each
 * item's bytes must parse as exactly one item. The position bits of every item are set to the
 * stash page (`loc 0`, `bodyloc 0`, `storage 5`) and the given cell; children are untouched.
 * The count and `sectorSize` grow accordingly; every other byte is copied unchanged, which the
 * function proves on its result before returning.
 *
 * @param buffer  The original `.d2i` bytes (not modified).
 * @param target  Sector offset and, optionally, the list position (default: head of the list).
 * @param items   Items with their target cells, in the order they should appear in the list.
 * @param gd      GameData for the walker and item sizes.
 * @throws {D2RSaverError} `INVALID_FORMAT`, `INVALID_PAGE`, `LIST_TRUNCATED` (target list not
 *   complete — always, there is no override), `UNKNOWN_BASE` (an item, or one already in the
 *   sector, has no grid size), `NO_FREE_SLOT` (the cell is taken or outside the grid),
 *   `INVALID_ARGUMENT` (bad cell, list index, or bytes that are not exactly one item),
 *   `RANGE_MISMATCH` (self-check failed).
 */
export function insertInPlaceD2I(
  buffer: Uint8Array,
  target: InsertInPlaceD2ITarget,
  items: InsertInPlaceD2IItem[],
  gd: GameData,
): InsertInPlaceD2IResult {
  if (!Array.isArray(items) || items.length === 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'insertInPlaceD2I: at least one item is required');
  }

  const sector = findNormalD2ISector(buffer, target.sectorOffset);
  const walk = walkSector(buffer, sector, gd);
  const listBefore = walk.report;
  if (!listBefore.complete) {
    throw new D2RSaverError(ErrorCode.LIST_TRUNCATED, truncatedMessage(sector.offset, listBefore));
  }
  if (listBefore.declared + items.length > 0xffff) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `sector at byte ${sector.offset}: ${listBefore.declared} + ${items.length} item(s) overflow the 16-bit list counter`,
    );
  }

  const listIndex = target.listIndex ?? 0;
  requireInt('listIndex', listIndex, 0, walk.entries.length);
  const at = listIndex < walk.entries.length ? walk.entries[listIndex].full.start : listBefore.endOffset;

  // Occupancy from the position bits of every item already in the sector (throws on unknown
  // bases and overlaps: such a page must not be written into).
  const grid = buildRawGrid(walk, gd);
  const patched: Uint8Array[] = [];
  items.forEach((item, i) => {
    const what = `items[${i}]`;
    if (!(item.bytes instanceof Uint8Array)) {
      throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `${what}.bytes must be a Uint8Array`);
    }
    requireInt(`${what}.col`, item.col, 0, 15);
    requireInt(`${what}.row`, item.row, 0, 15);
    let head: ItemHead;
    try {
      head = readItemHead(item.bytes);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `${what}: bytes do not start with an item head: ${reason}`);
    }
    const { w, h } = headSize(head, gd, what);
    if (!grid.isFree(item.col, item.row, w, h)) {
      throw new D2RSaverError(
        ErrorCode.NO_FREE_SLOT,
        `${what} (${head.base ?? 'ear'}, ${w}x${h}) does not fit at column ${item.col}, row ${item.row} ` +
          `of the ${grid.columns}x${grid.rows} grid of the sector at byte ${sector.offset}: cell taken or outside the grid`,
      );
    }
    grid.occupy(item.col, item.row, w, h, walk.entries.length + i + 1);
    const moved = patchItemPosition(item.bytes, { ...STASH_PAGE_POSITION, col: item.col, row: item.row });
    requireStandaloneItem(moved, gd, what);
    patched.push(moved);
  });

  const addedBytes = patched.reduce((sum, b) => sum + b.length, 0);
  const newBuffer = new Uint8Array(buffer.length + addedBytes);
  newBuffer.set(buffer.subarray(0, at), 0);
  let dst = at;
  const inserts: Array<{ at: number; length: number; bytes: Uint8Array }> = [];
  const ranges: ByteRange[] = [];
  for (const bytes of patched) {
    newBuffer.set(bytes, dst);
    inserts.push({ at, length: bytes.length, bytes });
    ranges.push({ start: dst, end: dst + bytes.length });
    dst += bytes.length;
  }
  newBuffer.set(buffer.subarray(at), dst);

  const countOffset = sector.offset + D2I_LIST_COUNT_OFFSET;
  writeU16(newBuffer, countOffset, readU16(buffer, countOffset) + patched.length);
  fixD2ISectorSize(newBuffer, sector.offset, addedBytes);

  const diff: DiffSpec = { kind: 'd2i-insert', sectorOffset: sector.offset, inserts };
  assertExactDiff(buffer, newBuffer, diff);

  const walkAfter = walkSector(newBuffer, findD2ISector(newBuffer, sector.offset), gd);
  const listAfter = walkAfter.report;
  if (!listAfter.complete || listAfter.parsed !== listBefore.parsed + patched.length) {
    throw new D2RSaverError(
      ErrorCode.RANGE_MISMATCH,
      `sector at byte ${sector.offset}: after inserting ${patched.length} item(s) the list parses ` +
        `${listAfter.parsed}/${listAfter.declared} (complete=${listAfter.complete}): ${listAfter.error ?? 'list end mismatch'}`,
    );
  }
  for (let i = 0; i < ranges.length; i++) {
    const entry = walkAfter.entries[listIndex + i];
    if (entry.full.start !== ranges[i].start || entry.full.end !== ranges[i].end) {
      throw new D2RSaverError(
        ErrorCode.RANGE_MISMATCH,
        `sector at byte ${sector.offset}: inserted item ${i} was written at [${ranges[i].start}, ${ranges[i].end}) ` +
          `but walks as [${entry.full.start}, ${entry.full.end})`,
      );
    }
  }

  const inserted: InsertedInPlaceItem[] = ranges.map((range, i) => ({
    index: listIndex + i,
    range,
    head: walkAfter.entries[listIndex + i].head,
  }));

  return { newBuffer, inserted, listBefore, listAfter, diff };
}
