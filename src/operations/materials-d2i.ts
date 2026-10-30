/**
 * Materials tab (`.d2i` sector type 1) — read, encode and edit quantity records in place (0.4.0).
 *
 * A Blizzless materials tab holds one anchor record per material code. Its authoritative
 * counter is the post-stats presence flag followed by an 8-bit value (ItemData+0x9c in
 * D2R 3.3.93847). The position nibbles carry a replication mirror that may be stale.
 * Native increment/decrement updates the counter alone; absolute-count network messages
 * refresh the position mirror. Equality is not a save-format invariant.
 *
 * A quantity edit changes only the 8-bit counter and preserves the position fields,
 * record length, flag and all other bits. Zero-count anchors stay in the list.
 * Appends grow the list count and sectorSize; following sectors shift unchanged.
 *
 * Bit convention (as `BinaryReader`): LSB-first, absolute bit `b` is `(buf[b >> 3] >> (b & 7)) & 1`;
 * a record starts on a byte boundary, so record bit `r` is absolute bit `recordStart * 8 + r`.
 *
 * Record layouts, from the item parser and verified on the public fixture and a real tab:
 *
 * | bits            | simple (runes, gems, potions)   | complex (keys, essences, organs…) |
 * |-----------------|---------------------------------|-----------------------------------|
 * | 0–31            | flags `0x00a00010` (potions may carry bit 10) | flags `0x00800010`  |
 * | 32–34           | version 5                       | version 5                         |
 * | 35–37 / 38–41   | `loc` (0, 2 for a potion that came from a belt, or 4 for Blizzless crafting parts) / `bodyloc` 0 | same   |
 * | 42–45 / 46–49   | `col` / `row` replication mirror | same                              |
 * | 50–52           | `storage` 5                     | same                              |
 * | 53…53+L         | Huffman code "abc " (L = 14–23) | same                              |
 * | then            | 1 bit sockets (0)               | 3 bits sockets (0), 32 guid, 7 ilvl, 4 quality (2), 4 zero flags (icon, automod, extended, pre-stats quantity), stats terminator 0x1FF (9) |
 * | then            | quantity flag 1, quantity (8)   | quantity flag 1, quantity (8)     |
 * | tail            | zero bits to the byte boundary  | same                              |
 *
 * So the quantity flag sits at record bit `54 + L` (simple, 10–11 bytes) or `112 + L` (complex,
 * 18 bytes). A record whose flag is anywhere else carries something this module does not
 * understand (stats, an icon, an automod, a pre-stats quantity…) and is reported `layoutOk: false`.
 *
 * Standard of Heroes (`std`, `sth`) is a complex record in a unique form: quality 7 and, after the icon
 * and automod flags, the 12-bit unique id 0xFFF, so its flag sits at `124 + L` (19 bytes). Verified on
 * tabs written by the game. The reader recognises the form from the record, not from a list of codes.
 */

import type { GameData } from '../game-data/game-data.js';
import { BitWriter } from '../core/binary-writer.js';
import { HUFFMAN_LOOKUP } from '../core/huffman.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import { itemGetTypes } from '../items/item-types.js';
import { walkItemList, type WalkedItem } from '../formats/item-walker.js';
import {
  D2I_SECTOR_HEADER_SIZE,
  D2I_SECTOR_SIZE_OFFSET,
  D2I_LIST_COUNT_OFFSET,
  findMaterialsD2ISector,
  readU16,
  readU32,
  writeU16,
  writeU32,
  assertExactDiff,
  type MaterialsDiffSpec,
} from './verify-diff.js';

// ─── Constants ──────────────────────────────────────────────────

/** Record family: `simple` records have no guid/ilvl, `complex` ones do. */
export type MaterialFamily = 'simple' | 'complex';

/** Flags (bits 0–31) of a new simple record: identified (bit 4), simple (bit 21), bit 23. */
export const MATERIAL_SIMPLE_FLAGS = 0x00a00010;
/** Flags (bits 0–31) of a new complex record: identified (bit 4), bit 23. */
export const MATERIAL_COMPLEX_FLAGS = 0x00800010;
/** Item version stored in bits 32–34. */
export const MATERIAL_ITEM_VERSION = 5;
/** `storage` value of every materials record (stash). */
export const MATERIAL_STORAGE = 5;
/** Largest value the 8-bit quantity field (and `col + 16 * row`) can hold. */
export const MATERIAL_QUANTITY_FIELD_MAX = 255;
/** Default cap for `editMaterialsD2I`: the game's materials stack limit. */
export const MATERIAL_DEFAULT_MAX_QUANTITY = 99;

/** Quality value (normal) of a complex record. */
const QUALITY_NORMAL = 2;
/** The game stores these codes as a unique with no unique row: quality 7 and id 0xFFF, 12 bits longer than a normal complex record. */
const QUALITY_UNIQUE = 7;
const UNIQUE_ID_NONE = 0xfff;
const UNIQUE_ID_BITS = 12;
/** Codes the encoder writes in the unique form by default. */
const UNIQUE_FORM_CODES: ReadonlySet<string> = new Set(['std', 'sth']);
/** `loc` values the game leaves in a materials record: stored, belt (a potion), Blizzless crafting part. */
const MATERIAL_LOCS: ReadonlySet<number> = new Set([0, 2, 4]);
/** Flags that change the record layout and are never set in a materials record. */
const FLAG_SOCKETED = 1 << 11;
const FLAG_EAR = 1 << 16;
const FLAG_SIMPLE = 1 << 21;
const FLAG_ETHEREAL = 1 << 22;
const FLAG_PERSONALIZED = 1 << 24;
const FLAG_RUNEWORD = 1 << 26;
const FLAG_EXTRAS = 1 << 28;
const FORBIDDEN_FLAGS = FLAG_SOCKETED | FLAG_EAR | FLAG_ETHEREAL | FLAG_PERSONALIZED | FLAG_RUNEWORD | FLAG_EXTRAS;
/** Item types whose bit layout differs from a plain misc item (extra fields before the stats). */
const LAYOUT_CHANGING_TYPES = ['book', 'char', 'armo', 'weap'];

// ─── Types ──────────────────────────────────────────────────────

/** Why a record is not safe to edit; `null` when `layoutOk`. */
export type MaterialLayoutIssue =
  | 'ear'
  | 'personalized'
  | 'runeword'
  | 'extras'
  | 'socketed'
  | 'children'
  | 'own_not_full'
  | 'storage'
  | 'bodyloc'
  | 'loc'
  | 'no_quantity_field'
  | 'pre_stats_quantity'
  | 'quantity_width'
  | 'quantity_flag'
  | 'quality'
  | 'unexpected_layout';

/** One record of a materials sector, as read from the bytes. */
export interface MaterialRecord {
  /** Zero-based position in the sector list. */
  index: number;
  /** Three-letter base code (`''` for an ear, which has none). */
  code: string;
  family: MaterialFamily;
  /** Absolute byte offset of the record's first byte. */
  recordStart: number;
  /** Absolute byte offset just past the record (`recordEnd - recordStart` is its length). */
  recordEnd: number;
  /** The 8-bit post-stats quantity, or `null` when the record has no quantity field. */
  quantity: number | null;
  /** `col + 16 * row`: a replication mirror that can lag behind the authoritative quantity. */
  positionQuantity: number;
  /** Offset of the quantity flag in bits from the record's first bit, or `null` without a field. */
  quantityFlagBit: number | null;
  /** Value of the quantity flag bit (0 without a field). */
  quantityFlag: 0 | 1;
  /** Bits 0–31 of the record. */
  flags: number;
  /** Persistent item id of a complex record, `null` for a simple one. */
  guid: number | null;
  /** Item level of a complex record, `null` for a simple one. */
  ilvl: number | null;
  /** The record has the unique form of Standard of Heroes (quality 7, unique id 0xFFF). */
  uniqueForm: boolean;
  /** 0 normally; 2 for a potion from a belt; 4 for Blizzless crafting parts (all stored in the tab). */
  loc: number;
  /** Every condition for an in-place quantity edit holds (see `MaterialLayoutIssue`). */
  layoutOk: boolean;
  /** First failed condition, or `null`. */
  layoutIssue: MaterialLayoutIssue | null;
}

/** Result of `readMaterialsD2I`. */
export interface MaterialsSectorReport {
  /** Absolute byte offset of the sector header. */
  sectorOffset: number;
  /** `sectorSize` from the header. */
  size: number;
  /** Record count from the list header. */
  declared: number;
  /** Records the parser got through. */
  parsed: number;
  /** `parsed === declared`, no parse error, and the list ends exactly at the sector end. */
  complete: boolean;
  /** Every parsed record, zero-quantity records included (unlike `readD2I`). */
  records: MaterialRecord[];
  /** Codes that occur in more than one record, sorted. */
  duplicateCodes: string[];
  /** Human-readable problems: parse error, records with a layout issue, duplicates. */
  issues: string[];
}

/** Options for `readMaterialsD2I`. */
export interface ReadMaterialsD2IOptions {
  /** Byte offset of the type-1 sector header (0 for a single-sector realm tab file). */
  sectorOffset: number;
}

/** Input of `encodeMaterialRecord`. */
export interface EncodeMaterialRecordInput {
  family: MaterialFamily;
  /** Three-letter base code present in GameData. */
  code: string;
  /** Authoritative post-stats counter, 0–255. */
  quantity: number;
  /** Position mirror to preserve when re-encoding. Defaults to quantity for existing encoder compatibility. */
  positionQuantity?: number;
  /** Complex records only, required there: unsigned 32-bit persistent id. */
  guid?: number;
  /** Complex records only, required there: 0–127. */
  ilvl?: number;
  /** Write the unique form; defaults to true for the codes the game stores that way (`std`). */
  uniqueForm?: boolean;
  /** `loc` field, 0 (default), 2 or 4. */
  loc?: number;
  /**
   * Bits 0–31; defaults to `MATERIAL_SIMPLE_FLAGS` / `MATERIAL_COMPLEX_FLAGS`. Exists so that an
   * existing record can be re-encoded byte for byte (potions carry bit 10). The simple bit must
   * match `family`; flags that change the layout (socketed, ear, ethereal, personalized,
   * runeword, extras) are refused.
   */
  flags?: number;
}

/** A quantity change of an existing record. */
export interface MaterialPatch {
  code: string;
  /** Quantity the record must have now (stale reads are refused). */
  from: number;
  /** New quantity, `0..maxQuantity`. */
  to: number;
}

/** A new record for a code the sector does not hold yet. */
export interface MaterialAppend {
  code: string;
  family: MaterialFamily;
  /** `1..maxQuantity`. */
  quantity: number;
  /** Complex only, required there. */
  guid?: number;
  /** Complex only, required there. */
  ilvl?: number;
}

/** Edit description for `editMaterialsD2I`. */
export interface EditMaterialsD2IEdit {
  sectorOffset: number;
  patches: MaterialPatch[];
  appends: MaterialAppend[];
}

/** Options for `editMaterialsD2I`. */
export interface EditMaterialsD2IOptions {
  /** Highest quantity a patch or append may set (default 99, at most 255). */
  maxQuantity?: number;
  /** Permit fully ranged invalid records only when they are not patched and remain byte-exact. Default false. */
  preserveUnchangedInvalidRecords?: boolean;
}

/** Result of `editMaterialsD2I`. */
export interface EditMaterialsD2IResult {
  /** A fresh buffer; the caller's buffer is never modified. */
  newBuffer: Uint8Array;
  /** The edit as `verifyExactDiff` understands it, already proven on `newBuffer`. */
  diff: MaterialsDiffSpec;
  /** The sector as it was. */
  before: MaterialsSectorReport;
  /** The sector re-read from `newBuffer`. */
  after: MaterialsSectorReport;
}

// ─── Bit helpers ────────────────────────────────────────────────

function bitsAt(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const p = bitOffset + i;
    value += ((bytes[p >> 3] >> (p & 7)) & 1) * 2 ** i;
  }
  return value;
}

function setBitsAt(bytes: Uint8Array, bitOffset: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) {
    const p = bitOffset + i;
    if (Math.floor(value / 2 ** i) & 1) bytes[p >> 3] |= 1 << (p & 7);
    else bytes[p >> 3] &= ~(1 << (p & 7));
  }
}

function requireInt(name: string, value: unknown, min: number, max: number, code = ErrorCode.INVALID_ARGUMENT): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new D2RSaverError(code, `${name} must be an integer in [${min}, ${max}], got ${String(value)}`);
  }
}

/** Number of bits the Huffman code of `code + ' '` takes. */
function huffmanLength(code: string): number {
  let length = 0;
  for (const ch of code + ' ') {
    const entry = HUFFMAN_LOOKUP[ch];
    if (!entry) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `item code "${code}" has a character outside [a-z0-9]`);
    length += entry.l;
  }
  return length;
}

/** Record bit at which the quantity flag of a well-formed record of `family` sits. */
function expectedQuantityFlagBit(family: MaterialFamily, code: string, uniqueForm: boolean): number {
  return (family === 'simple' ? 54 : 112) + huffmanLength(code) + (uniqueForm ? UNIQUE_ID_BITS : 0);
}

// ─── Read ───────────────────────────────────────────────────────

function describeRecord(buffer: Uint8Array, entry: WalkedItem): MaterialRecord {
  const { head, item } = entry;
  const recordStart = entry.own.start;
  const recordEnd = entry.own.end;
  const family: MaterialFamily = head.simple ? 'simple' : 'complex';
  const code = head.base ?? '';
  const field = entry.quantityField;
  const quantityFlagBit = field ? field.flagBit : null;
  const quantityFlag = (quantityFlagBit !== null ? bitsAt(buffer, recordStart * 8 + quantityFlagBit, 1) : 0) as 0 | 1;
  const quantity = field && item.quantity !== undefined ? item.quantity : null;
  const positionQuantity = head.col + 16 * head.row;

  let issue: MaterialLayoutIssue | null = null;
  const fail = (i: MaterialLayoutIssue) => { if (issue === null) issue = i; };
  if (head.ear) fail('ear');
  if (head.personalized) fail('personalized');
  if (head.runeword) fail('runeword');
  if (head.extras) fail('extras');
  if (head.socketed) fail('socketed');
  if (entry.children.length > 0) fail('children');
  if (entry.own.start !== entry.full.start || entry.own.end !== entry.full.end) fail('own_not_full');
  if (head.storage !== MATERIAL_STORAGE) fail('storage');
  if (head.bodyloc !== 0) fail('bodyloc');
  if (!MATERIAL_LOCS.has(head.loc)) fail('loc');
  if (!field) fail('no_quantity_field');
  else if (field.placement !== 'post-stats') fail('pre_stats_quantity');
  else if (field.width !== 8) fail('quantity_width');
  if (field && quantityFlag !== 1) fail('quantity_flag');
  // The id sits before the extended and pre-stats quantity flags (2 bits) and the 9-bit stats terminator.
  const uniqueForm = family === 'complex' && item.quality === QUALITY_UNIQUE && quantityFlagBit !== null
    && bitsAt(buffer, recordStart * 8 + quantityFlagBit - 9 - 2 - UNIQUE_ID_BITS, UNIQUE_ID_BITS) === UNIQUE_ID_NONE;
  if (family === 'complex' && item.quality !== QUALITY_NORMAL && !uniqueForm) fail('quality');
  if (issue === null && !head.ear) {
    // Fixed layout: the flag sits right where the family's layout puts it, the record ends on the
    // first byte boundary after the 8-bit value, and the alignment padding is zero.
    const expected = expectedQuantityFlagBit(family, code, uniqueForm);
    const lengthBits = (recordEnd - recordStart) * 8;
    if (
      quantityFlagBit !== expected ||
      recordEnd - recordStart !== Math.ceil((expected + 9) / 8) ||
      bitsAt(buffer, recordStart * 8 + expected + 9, lengthBits - expected - 9) !== 0
    ) {
      fail('unexpected_layout');
    }
  }

  return {
    index: entry.index,
    code,
    family,
    recordStart,
    recordEnd,
    quantity,
    positionQuantity,
    quantityFlagBit,
    quantityFlag,
    flags: bitsAt(buffer, recordStart * 8, 32),
    guid: family === 'complex' && item.guid !== undefined ? item.guid : null,
    ilvl: family === 'complex' && item.ilvl !== undefined ? item.ilvl : null,
    uniqueForm,
    loc: head.loc,
    layoutOk: issue === null,
    layoutIssue: issue,
  };
}

/**
 * Read a materials (type 1) sector record by record. Zero-quantity records are listed (the
 * `readD2I` pages hide them). Nothing is modified.
 *
 * @throws {D2RSaverError} `INVALID_FORMAT` when the sector chain does not tile the buffer;
 *   `INVALID_PAGE` when no sector starts at `sectorOffset`, the sector is not type 1, or it has
 *   no `JM` list header.
 */
export function readMaterialsD2I(buffer: Uint8Array, gd: GameData, options: ReadMaterialsD2IOptions): MaterialsSectorReport {
  const sector = findMaterialsD2ISector(buffer, options.sectorOffset);
  const walk = walkItemList(buffer, sector.offset + D2I_SECTOR_HEADER_SIZE, gd, {
    initialId: 1,
    expectedEnd: sector.offset + sector.size,
  });
  const records = walk.entries.map(entry => describeRecord(buffer, entry));

  const seen = new Map<string, number>();
  for (const r of records) if (r.code) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  const duplicateCodes = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c).sort();

  const issues: string[] = [];
  if (walk.report.error) issues.push(`list: ${walk.report.error}`);
  else if (!walk.report.complete) {
    issues.push(`list: parsed ${walk.report.parsed}/${walk.report.declared}, ends at byte ${walk.report.endOffset} instead of ${sector.offset + sector.size}`);
  }
  for (const r of records) if (!r.layoutOk) issues.push(`record ${r.index} (${r.code || 'ear'}): ${r.layoutIssue}`);
  for (const c of duplicateCodes) issues.push(`duplicate code ${c}`);

  return {
    sectorOffset: sector.offset,
    size: sector.size,
    declared: walk.report.declared,
    parsed: walk.report.parsed,
    complete: walk.report.complete,
    records,
    duplicateCodes,
    issues,
  };
}

// ─── Encode ─────────────────────────────────────────────────────

/**
 * The `encodeMaterialRecord` input that reproduces an existing record: family, code, quantity,
 * position mirror, guid, ilvl, loc and flags as read. `encodeMaterialRecord(gd, materialRecordEncodeInput(r))`
 * equals the record's bytes for every well-formed record.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` for a record without a quantity field.
 */
export function materialRecordEncodeInput(record: MaterialRecord): EncodeMaterialRecordInput {
  if (record.quantity === null) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `record ${record.index} (${record.code}) has no quantity field`);
  }
  const input: EncodeMaterialRecordInput = {
    family: record.family,
    code: record.code,
    quantity: record.quantity,
    positionQuantity: record.positionQuantity,
    loc: record.loc,
    flags: record.flags,
  };
  if (record.family === 'complex') {
    input.guid = record.guid ?? undefined;
    input.ilvl = record.ilvl ?? undefined;
    input.uniqueForm = record.uniqueForm;
  }
  return input;
}

/**
 * Build the bytes of one materials record deterministically (no randomness: a complex record's
 * guid comes from the caller). `loc` 0 unless given, `bodyloc` 0, position from `positionQuantity ?? quantity`,
 * `storage` 5, quantity flag 1 even for 0.
 *
 * @throws {D2RSaverError} `UNKNOWN_BASE` for a code not in GameData; `INVALID_ARGUMENT` for a
 *   value out of range, a missing guid/ilvl on a complex record, flags that do not match the
 *   family or change the layout, or a base type with extra fields (book, charm, armor, weapon).
 */
export function encodeMaterialRecord(gd: GameData, input: EncodeMaterialRecordInput): Uint8Array {
  const { family, code } = input;
  if (family !== 'simple' && family !== 'complex') {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `family must be "simple" or "complex", got ${String(family)}`);
  }
  if (typeof code !== 'string' || !/^[a-z0-9]{3}$/.test(code)) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `code must be three characters [a-z0-9], got ${JSON.stringify(code)}`);
  }
  if (!gd.items[code]) throw new D2RSaverError(ErrorCode.UNKNOWN_BASE, `item code "${code}" is not in GameData`);
  const types = itemGetTypes(gd, code);
  const changing = LAYOUT_CHANGING_TYPES.filter(t => types.has(t));
  if (changing.length > 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `"${code}" has type ${changing.join('/')}, whose record carries extra fields`);
  }
  requireInt('quantity', input.quantity, 0, MATERIAL_QUANTITY_FIELD_MAX);
  const position = input.positionQuantity ?? input.quantity;
  requireInt('positionQuantity', position, 0, MATERIAL_QUANTITY_FIELD_MAX);
  const loc = input.loc ?? 0;
  if (!MATERIAL_LOCS.has(loc)) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `loc must be 0, 2 or 4, got ${String(loc)}`);
  const flags = input.flags ?? (family === 'simple' ? MATERIAL_SIMPLE_FLAGS : MATERIAL_COMPLEX_FLAGS);
  requireInt('flags', flags, 0, 0xffffffff);
  if (((flags & FLAG_SIMPLE) !== 0) !== (family === 'simple')) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `flags 0x${flags.toString(16)} do not match family "${family}"`);
  }
  if ((flags & FORBIDDEN_FLAGS) !== 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `flags 0x${flags.toString(16)} change the record layout`);
  }
  if (family === 'complex') {
    requireInt('guid', input.guid, 0, 0xffffffff);
    requireInt('ilvl', input.ilvl, 0, 127);
  } else if (input.guid !== undefined || input.ilvl !== undefined) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'a simple record has no guid or ilvl');
  }
  if (input.uniqueForm === true && family !== 'complex') {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `"${code}" has no unique form`);
  }

  const q = input.quantity;
  const w = new BitWriter(256);
  w.writeUInt32(flags >>> 0, 32);
  w.writeUInt8(MATERIAL_ITEM_VERSION, 3);
  w.writeUInt8(loc, 3);
  w.writeUInt8(0, 4); // bodyloc
  w.writeUInt8(position & 15, 4); // col: replication mirror, not the persisted counter
  w.writeUInt8(position >> 4, 4); // row
  w.writeUInt8(MATERIAL_STORAGE, 3);
  for (const ch of code + ' ') w.writeChar(ch);
  if (family === 'simple') {
    w.writeBit(0); // socketed item count (1 bit)
  } else {
    w.writeUInt8(0, 3); // socketed item count
    w.writeUInt32(input.guid! >>> 0, 32);
    w.writeUInt8(input.ilvl!, 7);
    const uniqueForm = input.uniqueForm ?? UNIQUE_FORM_CODES.has(code);
    w.writeUInt8(uniqueForm ? QUALITY_UNIQUE : QUALITY_NORMAL, 4);
    w.writeBit(0); // icon index flag
    w.writeBit(0); // automod flag
    if (uniqueForm) w.writeUInt16(UNIQUE_ID_NONE, UNIQUE_ID_BITS);
    w.writeBit(0); // D2R extended section flag
    w.writeBit(0); // pre-stats quantity flag
    w.writeUInt16(0x1ff, 9); // stats terminator
  }
  w.writeBit(1); // post-stats quantity flag
  w.writeUInt8(q, 8);
  w.align();
  return w.toArray();
}

function encodesBackExactly(buffer: Uint8Array, gd: GameData, record: MaterialRecord): boolean {
  try {
    const bytes = encodeMaterialRecord(gd, materialRecordEncodeInput(record));
    const original = buffer.subarray(record.recordStart, record.recordEnd);
    return bytes.length === original.length && bytes.every((b, i) => b === original[i]);
  } catch {
    return false;
  }
}

/**
 * `true` when `encodeMaterialRecord` reproduces, byte for byte, every record of `family` in the
 * report and there is at least one such record: the proof that a new record of that family is
 * laid out like the ones already in the tab.
 */
export function materialEncodingVerified(
  buffer: Uint8Array,
  gd: GameData,
  report: MaterialsSectorReport,
  family: MaterialFamily,
): boolean {
  const same = report.records.filter(r => r.family === family);
  return same.length > 0 && same.every(r => encodesBackExactly(buffer, gd, r));
}

// ─── Edit ───────────────────────────────────────────────────────

/**
 * Change quantities of existing records in place and/or append records for absent codes, in a
 * materials (type 1) sector. Checks, in this order (the first failure throws):
 *
 * 1. the list is fully parsed and ends at the sector end (`LIST_TRUNCATED`);
 * 2. EVERY record is `layoutOk`, foreign ones included (`MATERIAL_LAYOUT`);
 * 3. no code occurs twice in the sector (`MATERIAL_DUPLICATE_CODE`);
 * 4. no code repeats across `patches` and `appends`, and there is at least one of them
 *    (`INVALID_ARGUMENT`);
 * 5. per patch: the record exists (`MATERIAL_NOT_FOUND`), holds exactly `from`
 *    (`MATERIAL_STALE`), and `0 ≤ to ≤ maxQuantity` (`MATERIAL_RANGE`);
 * 6. per append: the code is absent (`MATERIAL_ALREADY_PRESENT`), `1 ≤ quantity ≤ maxQuantity`
 *    (`MATERIAL_RANGE`), and the encoder reproduces every record of the same family in the
 *    sector, of which there is at least one (`LAYOUT_UNVERIFIED`).
 *
 * A patch rewrites only the 8-bit post-stats quantity; position, flag and length stay. A
 * record set to 0 stays in the list. Appends go to the end of the list (= end of the sector) in
 * the given order; the count and `sectorSize` grow, following sectors shift unchanged. The
 * result is proven with `assertExactDiff` and re-read: the record count and authoritative quantity
 * of every touched record must be what was asked, and its position must be unchanged.
 *
 * @throws {D2RSaverError} as listed above, plus `INVALID_PAGE`/`INVALID_FORMAT` from
 *   `readMaterialsD2I`, `RANGE_MISMATCH` from the self-check.
 */
export function editMaterialsD2I(
  buffer: Uint8Array,
  gd: GameData,
  edit: EditMaterialsD2IEdit,
  options?: EditMaterialsD2IOptions,
): EditMaterialsD2IResult {
  if (!edit || typeof edit !== 'object') {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'edit must be an object { sectorOffset, patches, appends }');
  }
  const maxQuantity = options?.maxQuantity ?? MATERIAL_DEFAULT_MAX_QUANTITY;
  requireInt('maxQuantity', maxQuantity, 0, MATERIAL_QUANTITY_FIELD_MAX);
  const patches = edit.patches ?? [];
  const appends = edit.appends ?? [];
  if (!Array.isArray(patches) || !Array.isArray(appends)) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'patches and appends must be arrays');
  }

  // 1–3: the whole sector must be understood.
  const before = readMaterialsD2I(buffer, gd, { sectorOffset: edit.sectorOffset });
  if (!before.complete) {
    throw new D2RSaverError(ErrorCode.LIST_TRUNCATED, `materials sector at byte ${before.sectorOffset} is not fully parsed: ${before.issues[0] ?? 'incomplete list'}`);
  }
  const patchedCodes = new Set(patches.map(p => p.code));
  const bad = before.records.find(r => !r.layoutOk && (options?.preserveUnchangedInvalidRecords !== true || patchedCodes.has(r.code)));
  if (bad) {
    throw new D2RSaverError(ErrorCode.MATERIAL_LAYOUT, `record ${bad.index} (${bad.code || 'ear'}) cannot be edited in place: ${bad.layoutIssue}`);
  }
  if (before.duplicateCodes.length > 0) {
    throw new D2RSaverError(ErrorCode.MATERIAL_DUPLICATE_CODE, `materials sector holds more than one record for ${before.duplicateCodes.join(', ')}`);
  }

  // 4: the edit itself.
  if (patches.length + appends.length === 0) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'nothing to edit: no patches and no appends');
  }
  const codes = new Set<string>();
  for (const { code } of [...patches, ...appends]) {
    if (typeof code !== 'string' || code.length === 0) {
      throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `invalid material code ${JSON.stringify(code)}`);
    }
    if (codes.has(code)) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `material code ${code} appears twice in the edit`);
    codes.add(code);
  }

  // 5: patches.
  const byCode = new Map(before.records.map(r => [r.code, r]));
  const targets = patches.map(p => {
    const record = byCode.get(p.code);
    if (!record) throw new D2RSaverError(ErrorCode.MATERIAL_NOT_FOUND, `materials sector has no record for ${p.code}`);
    requireInt(`patch ${p.code}: from`, p.from, 0, MATERIAL_QUANTITY_FIELD_MAX);
    if (record.quantity !== p.from) {
      throw new D2RSaverError(ErrorCode.MATERIAL_STALE, `record ${p.code} holds ${String(record.quantity)}, not ${p.from}`);
    }
    requireInt(`patch ${p.code}: to`, p.to, 0, maxQuantity, ErrorCode.MATERIAL_RANGE);
    return { patch: p, record };
  });

  // 6: appends.
  const appendBytes = appends.map(a => {
    if (byCode.has(a.code)) {
      throw new D2RSaverError(ErrorCode.MATERIAL_ALREADY_PRESENT, `materials sector already has a record for ${a.code}`);
    }
    requireInt(`append ${a.code}: quantity`, a.quantity, 1, maxQuantity, ErrorCode.MATERIAL_RANGE);
    if (!materialEncodingVerified(buffer, gd, before, a.family)) {
      throw new D2RSaverError(
        ErrorCode.LAYOUT_UNVERIFIED,
        `cannot append ${a.code}: the encoder is not proven on the ${a.family} records of this sector`,
      );
    }
    const input: EncodeMaterialRecordInput = { family: a.family, code: a.code, quantity: a.quantity };
    if (a.family === 'complex') { input.guid = a.guid; input.ilvl = a.ilvl; }
    else if (a.guid !== undefined || a.ilvl !== undefined) {
      throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `append ${a.code}: a simple record has no guid or ilvl`);
    }
    return encodeMaterialRecord(gd, input);
  });

  // Write: copy (never alias the caller's memory), patch the authoritative counter, append at the sector end.
  const sectorEnd = before.sectorOffset + before.size;
  const added = appendBytes.reduce((sum, b) => sum + b.length, 0);
  const count = readU16(buffer, before.sectorOffset + D2I_LIST_COUNT_OFFSET);
  if (count + appendBytes.length > 0xffff) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `${count} + ${appendBytes.length} records overflow the 16-bit list counter`);
  }
  const out = new Uint8Array(buffer.length + added);
  out.set(buffer.subarray(0, sectorEnd), 0);
  let at = sectorEnd;
  for (const b of appendBytes) { out.set(b, at); at += b.length; }
  out.set(buffer.subarray(sectorEnd), at);
  for (const { patch, record } of targets) {
    const bit = record.recordStart * 8;
    setBitsAt(out, bit + record.quantityFlagBit! + 1, 8, patch.to);
  }
  writeU16(out, before.sectorOffset + D2I_LIST_COUNT_OFFSET, count + appendBytes.length);
  writeU32(out, before.sectorOffset + D2I_SECTOR_SIZE_OFFSET, readU32(buffer, before.sectorOffset + D2I_SECTOR_SIZE_OFFSET) + added);

  const diff: MaterialsDiffSpec = {
    kind: 'd2i-materials',
    sectorOffset: before.sectorOffset,
    patches: targets
      .map(({ patch, record }) => ({
        recordStart: record.recordStart,
        recordEnd: record.recordEnd,
        quantityFlagBit: record.quantityFlagBit!,
        before: patch.from,
        after: patch.to,
      }))
      .sort((a, b) => a.recordStart - b.recordStart),
    appends: appendBytes.map(bytes => ({ bytes })),
  };
  assertExactDiff(buffer, out, diff);

  // Self-check by re-reading the result.
  const after = readMaterialsD2I(out, gd, { sectorOffset: before.sectorOffset });
  const fail = (why: string): never => {
    throw new D2RSaverError(ErrorCode.LAYOUT_UNVERIFIED, `materials edit did not read back as written: ${why}`);
  };
  if (!after.complete) fail('the list is no longer complete');
  if (after.records.length !== before.records.length + appendBytes.length) {
    fail(`${after.records.length} records instead of ${before.records.length + appendBytes.length}`);
  }
  for (const [index, record] of before.records.entries()) {
    const next = after.records[index];
    if (!next || next.code !== record.code || next.recordStart !== record.recordStart || next.recordEnd !== record.recordEnd) {
      fail('an existing record changed its boundary');
    }
    if (patchedCodes.has(record.code)) {
      if (!next.layoutOk) fail('a patched record lost its layout');
    } else {
      const original = buffer.subarray(record.recordStart, record.recordEnd);
      const preserved = out.subarray(next.recordStart, next.recordEnd);
      if (original.length !== preserved.length || original.some((value, i) => value !== preserved[i])) fail('an untouched record changed');
    }
  }
  if (after.duplicateCodes.length > 0) fail(`duplicate codes ${after.duplicateCodes.join(', ')}`);
  const afterByCode = new Map(after.records.map(r => [r.code, r]));
  for (const { patch, record } of targets) {
    const r = afterByCode.get(patch.code);
    if (!r || r.quantity !== patch.to || r.positionQuantity !== record.positionQuantity) fail(`record ${patch.code} does not hold ${patch.to} with its original position`);
  }
  appends.forEach((a, i) => {
    const r = after.records[before.records.length + i];
    if (!r || r.code !== a.code || r.family !== a.family || r.quantity !== a.quantity || r.positionQuantity !== a.quantity) {
      fail(`appended record ${a.code} does not hold ${a.quantity}`);
    }
    if (a.family === 'complex' && (r.guid !== a.guid || r.ilvl !== a.ilvl)) fail(`appended record ${a.code} has another guid/ilvl`);
  });

  return { newBuffer: out, diff, before, after };
}
