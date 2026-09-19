/**
 * Exact-diff verification — proof that an in-place edit changed exactly what it declared.
 *
 * `verifyExactDiff` rebuilds the expected output from the ORIGINAL buffer and a declaration of
 * the edit (which sector, which byte ranges were cut out or which gaps were filled), then
 * compares that expectation with the actual output byte for byte. Anything outside the
 * declared splice, the list counter and the sector size must be identical; a single stray
 * byte is reported with its offset.
 *
 * The function is pure and needs no GameData: it reasons only about bytes and the `.d2i`
 * sector layout (64-byte header: `sectorSize` at +16, `JM` list at +64, 16-bit item count at
 * +66). The in-place operations run it on their own output before returning, and a caller can
 * run it again on the buffers it is about to persist (gate 6 of the offline-trade design).
 */

import { D2RSaverError, ErrorCode } from '../types/errors.js';
import type { ByteRange } from '../formats/item-parser.js';
import { detectFormat } from '../formats/detect.js';

// ─── .d2i sector layout ─────────────────────────────────────────

/** Size of a `.d2i` sector header; the `JM` item list starts right after it. */
export const D2I_SECTOR_HEADER_SIZE = 64;
/** Offset of the 32-bit `sectorSize` field inside a sector header. */
export const D2I_SECTOR_SIZE_OFFSET = 16;
/** Offset of the sector type byte (0 normal, 1 extended, 2 metadata) inside a sector header. */
export const D2I_SECTOR_TYPE_OFFSET = 20;
/** Offset of the 16-bit item count inside a sector (right after the `JM` marker at +64). */
export const D2I_LIST_COUNT_OFFSET = 66;
/** Offset of the first item of a sector's list. */
export const D2I_FIRST_ITEM_OFFSET = 68;

// ─── Types ──────────────────────────────────────────────────────

/** One gap filled by an insert: `at` is a position in the ORIGINAL buffer. */
export interface DiffInsert {
  /** Byte offset in `before` in front of which the bytes were inserted. */
  at: number;
  /** Number of bytes inserted. */
  length: number;
  /** The inserted bytes, when the caller wants them checked as well; unchecked if omitted. */
  bytes?: Uint8Array;
}

/** Declaration of an in-place edit of a `.d2i` buffer. Offsets refer to the ORIGINAL buffer. */
export type DiffSpec =
  | { kind: 'd2i-remove'; sectorOffset: number; ranges: ByteRange[] }
  | { kind: 'd2i-insert'; sectorOffset: number; inserts: DiffInsert[] };

/** A byte of the result that differs from the expectation. `offset` is in the RESULT buffer. */
export interface DiffMismatch {
  offset: number;
  expected: number;
  actual: number;
}

/** Result of `verifyExactDiff`. */
export interface ExactDiffResult {
  /** `true` only when lengths match and every compared byte matches. */
  ok: boolean;
  /** Length the result must have according to the spec. */
  expectedLength: number;
  /** Length the result actually has. */
  actualLength: number;
  /** Differing bytes, in offset order, capped at `MAX_REPORTED_MISMATCHES`. */
  mismatches: DiffMismatch[];
  /** Total number of differing bytes (may exceed `mismatches.length`). */
  mismatchCount: number;
}

/** Upper bound on the number of mismatches listed in an `ExactDiffResult`. */
export const MAX_REPORTED_MISMATCHES = 32;

// ─── Byte helpers ───────────────────────────────────────────────

/** Read a little-endian 16-bit value. */
export function readU16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

/** Read a little-endian 32-bit value. */
export function readU32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

/** Write a little-endian 16-bit value. */
export function writeU16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}

/** Write a little-endian 32-bit value. */
export function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function requireInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `${name} must be an integer in [${min}, ${max}], got ${String(value)}`,
    );
  }
}

// ─── Sector chain ───────────────────────────────────────────────

/** A sector header as found by walking the `.d2i` header chain. */
export interface D2ISectorHeader {
  offset: number;
  size: number;
  type: number;
}

/**
 * Walk the sector header chain of a `.d2i` buffer without parsing any item: each header must
 * carry the Blizzless magic and version, and the sizes must tile the buffer exactly.
 *
 * @throws {D2RSaverError} `INVALID_FORMAT` when the chain does not tile the buffer (a header
 *   is not recognised, a size is below the header size, or bytes are left over).
 */
export function readD2ISectorChain(buffer: Uint8Array): D2ISectorHeader[] {
  const sectors: D2ISectorHeader[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + D2I_SECTOR_HEADER_SIZE > buffer.length) {
      throw new D2RSaverError(
        ErrorCode.INVALID_FORMAT,
        `.d2i sector chain broken at byte ${offset}: ${buffer.length - offset} trailing byte(s) do not hold a sector header`,
      );
    }
    const fmt = detectFormat(buffer.subarray(offset));
    if (!fmt || fmt.type !== 'd2i') {
      throw new D2RSaverError(ErrorCode.INVALID_FORMAT, `.d2i sector chain broken at byte ${offset}: not a sector header`);
    }
    const size = readU32(buffer, offset + D2I_SECTOR_SIZE_OFFSET);
    if (size < D2I_SECTOR_HEADER_SIZE || offset + size > buffer.length) {
      throw new D2RSaverError(
        ErrorCode.INVALID_FORMAT,
        `.d2i sector at byte ${offset} declares ${size} byte(s), which does not fit a ${buffer.length}-byte buffer`,
      );
    }
    sectors.push({ offset, size, type: buffer[offset + D2I_SECTOR_TYPE_OFFSET] });
    offset += size;
  }
  if (sectors.length === 0) {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, 'empty buffer: no .d2i sector');
  }
  return sectors;
}

/**
 * Find the sector that starts exactly at `sectorOffset` in the header chain of `buffer`.
 *
 * @throws {D2RSaverError} `INVALID_PAGE` when no sector starts there; `INVALID_FORMAT` when
 *   the chain is broken.
 */
export function findD2ISector(buffer: Uint8Array, sectorOffset: number): D2ISectorHeader {
  requireInt('sectorOffset', sectorOffset, 0, Number.MAX_SAFE_INTEGER);
  const sector = readD2ISectorChain(buffer).find(s => s.offset === sectorOffset);
  if (!sector) {
    throw new D2RSaverError(ErrorCode.INVALID_PAGE, `no .d2i sector starts at byte ${sectorOffset}`);
  }
  return sector;
}

// ─── Expectation builder ────────────────────────────────────────

interface Expectation {
  bytes: Uint8Array;
  /** `1` where the byte must match, `0` inside an unchecked inserted gap. */
  mask: Uint8Array;
}

function sortedRanges(spec: Extract<DiffSpec, { kind: 'd2i-remove' }>, sector: D2ISectorHeader): ByteRange[] {
  if (spec.ranges.length === 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'd2i-remove: at least one range is required');
  }
  const listStart = sector.offset + D2I_FIRST_ITEM_OFFSET;
  const listEnd = sector.offset + sector.size;
  const ranges = spec.ranges.map((r, i) => {
    requireInt(`ranges[${i}].start`, r.start, listStart, listEnd);
    requireInt(`ranges[${i}].end`, r.end, listStart, listEnd);
    if (r.end <= r.start) {
      throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `ranges[${i}] is empty or reversed: [${r.start}, ${r.end})`);
    }
    return { start: r.start, end: r.end };
  });
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) {
      throw new D2RSaverError(
        ErrorCode.INVALID_ARGUMENT,
        `ranges overlap: [${ranges[i - 1].start}, ${ranges[i - 1].end}) and [${ranges[i].start}, ${ranges[i].end})`,
      );
    }
  }
  return ranges;
}

function sortedInserts(spec: Extract<DiffSpec, { kind: 'd2i-insert' }>, sector: D2ISectorHeader): DiffInsert[] {
  if (spec.inserts.length === 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'd2i-insert: at least one insert is required');
  }
  const listStart = sector.offset + D2I_FIRST_ITEM_OFFSET;
  const listEnd = sector.offset + sector.size;
  const inserts = spec.inserts.map((ins, i) => {
    requireInt(`inserts[${i}].at`, ins.at, listStart, listEnd);
    requireInt(`inserts[${i}].length`, ins.length, 1, Number.MAX_SAFE_INTEGER);
    if (ins.bytes && ins.bytes.length !== ins.length) {
      throw new D2RSaverError(
        ErrorCode.INVALID_ARGUMENT,
        `inserts[${i}]: bytes has ${ins.bytes.length} byte(s) but length says ${ins.length}`,
      );
    }
    return ins;
  });
  // Stable sort: inserts at the same `at` keep their order (they land one after another).
  return inserts.map((ins, i) => ({ ins, i })).sort((a, b) => a.ins.at - b.ins.at || a.i - b.i).map(x => x.ins);
}

/**
 * The sector at `sectorOffset`, checked to be a normal (type 0) page with a `JM` list header.
 * Extended (type 1) and metadata (type 2) sectors are never edited in place.
 *
 * @throws {D2RSaverError} `INVALID_PAGE` for another sector type or a missing `JM` marker.
 */
export function findNormalD2ISector(buffer: Uint8Array, sectorOffset: number): D2ISectorHeader {
  const sector = findD2ISector(buffer, sectorOffset);
  if (sector.type !== 0) {
    throw new D2RSaverError(
      ErrorCode.INVALID_PAGE,
      `sector at byte ${sectorOffset} has type ${sector.type} (${sector.type === 1 ? 'extended' : sector.type === 2 ? 'metadata' : 'unknown'}); only normal (type 0) pages can be edited in place`,
    );
  }
  const jm = sector.offset + D2I_SECTOR_HEADER_SIZE;
  if (sector.size < D2I_FIRST_ITEM_OFFSET || buffer[jm] !== 0x4a || buffer[jm + 1] !== 0x4d) {
    throw new D2RSaverError(ErrorCode.INVALID_PAGE, `sector at byte ${sectorOffset} has no "JM" item list header`);
  }
  return sector;
}

function buildExpectation(before: Uint8Array, spec: DiffSpec): Expectation {
  const sector = findNormalD2ISector(before, spec.sectorOffset);
  const countOffset = sector.offset + D2I_LIST_COUNT_OFFSET;
  const count = readU16(before, countOffset);

  if (spec.kind === 'd2i-remove') {
    const ranges = sortedRanges(spec, sector);
    if (ranges.length > count) {
      throw new D2RSaverError(
        ErrorCode.INVALID_ARGUMENT,
        `d2i-remove: ${ranges.length} range(s) but the sector list declares only ${count} item(s)`,
      );
    }
    const removed = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
    const bytes = new Uint8Array(before.length - removed);
    let src = 0;
    let dst = 0;
    for (const r of ranges) {
      bytes.set(before.subarray(src, r.start), dst);
      dst += r.start - src;
      src = r.end;
    }
    bytes.set(before.subarray(src), dst);
    writeU16(bytes, countOffset, count - ranges.length);
    writeU32(bytes, sector.offset + D2I_SECTOR_SIZE_OFFSET, sector.size - removed);
    return { bytes, mask: new Uint8Array(bytes.length).fill(1) };
  }

  const inserts = sortedInserts(spec, sector);
  if (count + inserts.length > 0xffff) {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `d2i-insert: ${count} + ${inserts.length} item(s) overflow the 16-bit list counter`,
    );
  }
  const added = inserts.reduce((sum, ins) => sum + ins.length, 0);
  const bytes = new Uint8Array(before.length + added);
  const mask = new Uint8Array(bytes.length).fill(1);
  let src = 0;
  let dst = 0;
  for (const ins of inserts) {
    bytes.set(before.subarray(src, ins.at), dst);
    dst += ins.at - src;
    src = ins.at;
    if (ins.bytes) bytes.set(ins.bytes, dst);
    else mask.fill(0, dst, dst + ins.length);
    dst += ins.length;
  }
  bytes.set(before.subarray(src), dst);
  writeU16(bytes, countOffset, count + inserts.length);
  writeU32(bytes, sector.offset + D2I_SECTOR_SIZE_OFFSET, sector.size + added);
  return { bytes, mask };
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Prove that `after` is `before` with exactly the declared edit applied: the declared byte
 * ranges spliced out (or the declared gaps filled), the sector's 16-bit item count moved by the
 * number of items, its `sectorSize` moved by the number of bytes, and every other byte of the
 * file identical.
 *
 * Offsets in `spec` refer to `before`; offsets in the returned `mismatches` refer to `after`.
 * Inserted gaps are compared only when the spec carries their `bytes`.
 *
 * @throws {D2RSaverError} `INVALID_FORMAT` when `before` is not a tiled `.d2i`; `INVALID_PAGE`
 *   when `spec.sectorOffset` is not a sector start; `INVALID_ARGUMENT` when the ranges or
 *   inserts fall outside the sector's list, overlap, or under/overflow the item counter.
 */
export function verifyExactDiff(before: Uint8Array, after: Uint8Array, spec: DiffSpec): ExactDiffResult {
  const { bytes: expected, mask } = buildExpectation(before, spec);
  const mismatches: DiffMismatch[] = [];
  let mismatchCount = 0;

  const common = Math.min(expected.length, after.length);
  for (let i = 0; i < common; i++) {
    if (mask[i] && expected[i] !== after[i]) {
      mismatchCount++;
      if (mismatches.length < MAX_REPORTED_MISMATCHES) {
        mismatches.push({ offset: i, expected: expected[i], actual: after[i] });
      }
    }
  }

  return {
    ok: expected.length === after.length && mismatchCount === 0,
    expectedLength: expected.length,
    actualLength: after.length,
    mismatches,
    mismatchCount,
  };
}

/**
 * Like `verifyExactDiff`, but throws instead of returning a failed result.
 *
 * @throws {D2RSaverError} `RANGE_MISMATCH` with the first differing offsets in the message.
 */
export function assertExactDiff(before: Uint8Array, after: Uint8Array, spec: DiffSpec): ExactDiffResult {
  const result = verifyExactDiff(before, after, spec);
  if (!result.ok) {
    const where = result.mismatches
      .slice(0, 4)
      .map(m => `byte ${m.offset}: expected 0x${m.expected.toString(16).padStart(2, '0')}, got 0x${m.actual.toString(16).padStart(2, '0')}`)
      .join('; ');
    throw new D2RSaverError(
      ErrorCode.RANGE_MISMATCH,
      `result differs from the declared ${spec.kind}: ` +
        `length ${result.actualLength} vs expected ${result.expectedLength}, ` +
        `${result.mismatchCount} differing byte(s)${where ? ` (${where})` : ''}`,
    );
  }
  return result;
}
