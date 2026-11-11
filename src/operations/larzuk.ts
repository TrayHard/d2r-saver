/**
 * Larzuk's socket reward (Act V "Siege on Harrogath") — 0.4.11.
 *
 * Three building blocks, each proving its own output:
 *
 * - `readLarzukRewards` / `consumeLarzukReward`: the quest word of "Siege on Harrogath" lives at
 *   byte 70 of each 96-byte difficulty table of a v105 `.d2s` (tables at 413, 509 and 605). Bit 0
 *   is "reward granted", bit 1 "reward pending". Using the reward leaves the word as the game
 *   leaves it after a real visit to Larzuk: the low 12 bits become 0x021 (granted, plus the
 *   "talked to Larzuk" custom flag the game sets on that visit; "pending" and the progress flags
 *   such as "left town" are gone), the quest-log bits 12–15 are kept. Every used reward in the
 *   real saves we checked reads 0x?021; `ACT5Q1_SetRewardGranted` alone sets bit 0 and clears
 *   bit 1. Only the two bytes of that word and the file checksum change.
 * - `planLarzukSockets` / `rollLarzukSockets`: how many sockets Larzuk gives. Low, normal and
 *   superior items get the maximum the base and the item level allow; magic items 1–2 at random
 *   (capped by that maximum); set, rare, unique and crafted items one socket. The maximum is the
 *   smaller of the base's `gemsockets` and the item type's `maxsock1`/`maxsock25`/`maxsock40` for
 *   item levels up to 25, up to 40 and above.
 * - `socketItemInPlace`: sets the socketed flag of one item and inserts the 4-bit socket count
 *   at its place; every other bit of the item is copied, nothing is re-encoded.
 */

import { computeChecksum } from '../core/checksum.js';
import type { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
import { walkItemList } from '../formats/item-walker.js';
import { detectFormat } from '../formats/detect.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import { BLIZZLESS_VERSION, D2S_MAGIC } from '../types/constants.js';

// ─── Quest word ─────────────────────────────────────────────────

/** Byte offsets of the normal, nightmare and hell quest tables of a v105 `.d2s`. */
export const D2S_QUEST_TABLE_OFFSETS = [413, 509, 605] as const;
/** Byte offset of the "Siege on Harrogath" word inside a difficulty table. */
export const SIEGE_ON_HARROGATH_OFFSET = 70;
/** Offset of the `Woo!` quest section marker in a v105 `.d2s`. */
const QUEST_SECTION_OFFSET = 403;
const CHECKSUM_OFFSET = 12;
const QFLAG_REWARD_GRANTED = 0x0001;
const QFLAG_REWARD_PENDING = 0x0002;
/** Quest-log flags (update log, primary goal, completed now, completed before) kept as they are. */
const QUEST_LOG_BITS = 0xf000;
/** Low bits of a used Larzuk reward in real saves: granted + the "talked to Larzuk" flag. */
const USED_REWARD_LOW_BITS = 0x0021;

/** 0 normal, 1 nightmare, 2 hell. */
export type LarzukDifficulty = 0 | 1 | 2;
/** `available` — Shenk is dead and the socket is not used yet. */
export type LarzukRewardState = 'available' | 'used' | 'not-earned';

export interface LarzukReward {
  difficulty: LarzukDifficulty;
  /** Absolute byte offset of the quest word. */
  offset: number;
  /** The raw 16-bit quest word. */
  flags: number;
  state: LarzukRewardState;
}

export interface ConsumeLarzukRewardResult {
  bytes: Uint8Array;
  offset: number;
  before: number;
  after: number;
}

function u16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
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

function rewardState(flags: number): LarzukRewardState {
  if (flags & QFLAG_REWARD_GRANTED) return 'used';
  if (flags & QFLAG_REWARD_PENDING) return 'available';
  return 'not-earned';
}

function requireD2SQuests(d2s: Uint8Array): void {
  const format = detectFormat(d2s);
  if (d2s.length < D2S_QUEST_TABLE_OFFSETS[2] + 96 || u32(d2s, 0) !== D2S_MAGIC || format?.type === 'd2i') {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, 'not a .d2s character file');
  }
  const version = u32(d2s, 4);
  if (version !== BLIZZLESS_VERSION) {
    throw new D2RSaverError(ErrorCode.UNSUPPORTED_VERSION, `quest layout is known for v105 only, got v${version}`);
  }
  if (String.fromCharCode(...d2s.subarray(QUEST_SECTION_OFFSET, QUEST_SECTION_OFFSET + 4)) !== 'Woo!') {
    throw new D2RSaverError(ErrorCode.PARSE_ERROR, `no "Woo!" quest section at byte ${QUEST_SECTION_OFFSET}`);
  }
  if (u32(d2s, 8) !== d2s.length) {
    throw new D2RSaverError(ErrorCode.INVALID_FORMAT, `file size field ${u32(d2s, 8)} differs from ${d2s.length} bytes`);
  }
  if (u32(d2s, CHECKSUM_OFFSET) !== computeChecksum(d2s)) {
    throw new D2RSaverError(ErrorCode.CHECKSUM_MISMATCH, 'character file checksum does not match its bytes');
  }
}

/** The Larzuk reward of every difficulty of a v105 character file. */
export function readLarzukRewards(d2s: Uint8Array): LarzukReward[] {
  requireD2SQuests(d2s);
  return D2S_QUEST_TABLE_OFFSETS.map((table, difficulty) => {
    const offset = table + SIEGE_ON_HARROGATH_OFFSET;
    const flags = u16(d2s, offset);
    return { difficulty: difficulty as LarzukDifficulty, offset, flags, state: rewardState(flags) };
  });
}

/**
 * Mark the Larzuk reward of one difficulty as used, as the game does after socketing. The input
 * is not modified. Refuses a reward that is not available.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` for a bad difficulty or a reward that is not
 *   available; the format errors of `readLarzukRewards`; `WRITE_ERROR` if the self-check fails.
 */
export function consumeLarzukReward(d2s: Uint8Array, difficulty: LarzukDifficulty): ConsumeLarzukRewardResult {
  if (difficulty !== 0 && difficulty !== 1 && difficulty !== 2) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `difficulty must be 0, 1 or 2, got ${String(difficulty)}`);
  }
  const reward = readLarzukRewards(d2s)[difficulty];
  if (reward.state !== 'available') {
    throw new D2RSaverError(
      ErrorCode.INVALID_ARGUMENT,
      `Larzuk reward of difficulty ${difficulty} is ${reward.state} (flags 0x${reward.flags.toString(16)})`,
    );
  }
  const after = (reward.flags & QUEST_LOG_BITS) | USED_REWARD_LOW_BITS;
  const bytes = new Uint8Array(d2s);
  bytes[reward.offset] = after & 0xff;
  bytes[reward.offset + 1] = after >>> 8;
  writeU32(bytes, CHECKSUM_OFFSET, computeChecksum(bytes));

  // Self-check: only the quest word and the checksum differ, and the reward reads back as used.
  for (let i = 0; i < bytes.length; i++) {
    const allowed = (i >= reward.offset && i < reward.offset + 2) || (i >= CHECKSUM_OFFSET && i < CHECKSUM_OFFSET + 4);
    if (!allowed && bytes[i] !== d2s[i]) {
      throw new D2RSaverError(ErrorCode.WRITE_ERROR, `consumeLarzukReward changed byte ${i}`);
    }
  }
  if (readLarzukRewards(bytes)[difficulty].state !== 'used') {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'consumed Larzuk reward does not read back as used');
  }
  return { bytes, offset: reward.offset, before: reward.flags, after };
}

// ─── Socket count ───────────────────────────────────────────────

const QUALITY_LOW = 1;
const QUALITY_NORMAL = 2;
const QUALITY_SUPERIOR = 3;
const QUALITY_MAGIC = 4;
const QUALITY_SET = 5;
const QUALITY_RARE = 6;
const QUALITY_UNIQUE = 7;
const QUALITY_CRAFTED = 8;

export type LarzukRefusal =
  | 'simple-item'
  | 'ear'
  | 'already-socketed'
  | 'unidentified'
  | 'unknown-base'
  | 'no-sockets'
  | 'unknown-quality';

export type LarzukSocketPlan =
  | { eligible: true; min: number; max: number }
  | { eligible: false; reason: LarzukRefusal };

/** What `planLarzukSockets` needs to know about an item. */
export type LarzukItemFacts = Pick<BinaryParsedItem, 'base' | 'quality' | 'ilvl' | 'socketed' | 'unidentified'> & {
  /** The item is a compact (simple) item: runes, gems, potions. */
  simple?: boolean;
  ear?: boolean;
};

/** The most sockets an item of this base and item level can hold, as the game counts them. */
export function maxSocketsFor(gd: GameData, base: string, ilvl: number): number | null {
  const entry = gd.items[base];
  if (!entry) return null;
  const type = gd.itemTypes[entry.type] as { maxsock1?: number; maxsock25?: number; maxsock40?: number } | undefined;
  if (!type) return null;
  const byLevel = ilvl <= 25 ? type.maxsock1 : ilvl <= 40 ? type.maxsock25 : type.maxsock40;
  return Math.max(0, Math.min(entry.gemsockets || 0, byLevel || 0));
}

/** How many sockets Larzuk would give this item, or why he would refuse it. */
export function planLarzukSockets(gd: GameData, item: LarzukItemFacts): LarzukSocketPlan {
  if (item.ear) return { eligible: false, reason: 'ear' };
  if (item.simple) return { eligible: false, reason: 'simple-item' };
  if (item.socketed) return { eligible: false, reason: 'already-socketed' };
  // shortcut: unidentified items are refused although the game may accept them; check on the stand.
  if (item.unidentified) return { eligible: false, reason: 'unidentified' };
  const max = maxSocketsFor(gd, item.base, item.ilvl);
  if (max === null) return { eligible: false, reason: 'unknown-base' };
  if (max < 1) return { eligible: false, reason: 'no-sockets' };
  switch (item.quality) {
    case QUALITY_LOW:
    case QUALITY_NORMAL:
    case QUALITY_SUPERIOR:
      return { eligible: true, min: max, max };
    case QUALITY_MAGIC:
      return { eligible: true, min: 1, max: Math.min(2, max) };
    case QUALITY_SET:
    case QUALITY_RARE:
    case QUALITY_UNIQUE:
    case QUALITY_CRAFTED:
      return { eligible: true, min: 1, max: 1 };
    default:
      return { eligible: false, reason: 'unknown-quality' };
  }
}

/** Pick the socket count of an eligible plan; `random` returns a number in [0, 1). */
export function rollLarzukSockets(plan: LarzukSocketPlan, random: () => number = Math.random): number {
  if (!plan.eligible) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `item is not eligible: ${plan.reason}`);
  const span = plan.max - plan.min + 1;
  const pick = Math.floor(random() * span);
  return plan.min + Math.min(Math.max(pick, 0), span - 1);
}

// ─── In-place socketing ─────────────────────────────────────────

/** Bit of the socketed flag inside the 35 flag bits (4 + identified 1 + 6). */
const SOCKETED_FLAG_BIT = 11;

function bitAt(bytes: Uint8Array, bit: number): number {
  return (bytes[bit >> 3] >> (bit & 7)) & 1;
}

function setBit(bytes: Uint8Array, bit: number, value: number): void {
  if (value) bytes[bit >> 3] |= 1 << (bit & 7);
  else bytes[bit >> 3] &= ~(1 << (bit & 7));
}

function walkLoneItem(itemBytes: Uint8Array, gd: GameData) {
  const list = new Uint8Array(4 + itemBytes.length);
  list[0] = 0x4a;
  list[1] = 0x4d;
  list[2] = 1;
  list.set(itemBytes, 4);
  const walk = walkItemList(list, 0, gd);
  const entry = walk.entries[0];
  if (walk.entries.length !== 1 || !entry || entry.full.start !== 4 || entry.full.end !== list.length) {
    throw new D2RSaverError(ErrorCode.RANGE_MISMATCH, 'bytes are not exactly one complete item');
  }
  return entry;
}

const VOLATILE_KEYS = new Set([
  'binaryOffset', 'byteRange', 'fullByteRange', 'socketedByteRanges', 'contentBits', 'socketed', 'sockets', 'itemId',
]);

function snapshot(item: BinaryParsedItem): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value as object).sort().map(k => [k, sorted((value as Record<string, unknown>)[k])]));
    }
    return value;
  };
  return JSON.stringify(sorted(Object.fromEntries(Object.entries(item).filter(([k]) => !VOLATILE_KEYS.has(k)))));
}

/**
 * Give one unsocketed item `sockets` empty sockets. `itemBytes` are the item's own bytes (an item
 * without sockets has no children). Returns the new item bytes; the input is not modified.
 *
 * The result differs from the input by the socketed flag and four inserted bits only, which the
 * function proves bit by bit, then re-parses the result and checks that every parsed field
 * except the sockets is unchanged.
 *
 * @throws {D2RSaverError} `INVALID_ARGUMENT` for a bad count or an item that cannot take sockets
 *   (simple, ear, already socketed), `RANGE_MISMATCH` if the bytes are not exactly one item,
 *   `WRITE_ERROR` when the padding is not zero or a self-check fails.
 */
export function socketItemInPlace(itemBytes: Uint8Array, gd: GameData, sockets: number): Uint8Array {
  if (!Number.isInteger(sockets) || sockets < 1 || sockets > 6) {
    throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, `sockets must be an integer in [1, 6], got ${String(sockets)}`);
  }
  const entry = walkLoneItem(itemBytes, gd);
  if (entry.head.ear || entry.head.simple) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'item has no extended data');
  if (entry.head.socketed || entry.children.length) throw new D2RSaverError(ErrorCode.INVALID_ARGUMENT, 'item is already socketed');
  const field = entry.item.socketsFieldBit;
  const content = entry.item.contentBits;
  if (field === undefined || content === undefined || field > content || content > itemBytes.length * 8) {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'item layout is unknown');
  }
  for (let bit = content; bit < itemBytes.length * 8; bit++) {
    if (bitAt(itemBytes, bit)) throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'item padding is not zero');
  }

  const out = new Uint8Array(Math.ceil((content + 4) / 8));
  for (let bit = 0; bit < field; bit++) setBit(out, bit, bitAt(itemBytes, bit));
  for (let i = 0; i < 4; i++) setBit(out, field + i, (sockets >> i) & 1);
  for (let bit = field; bit < content; bit++) setBit(out, bit + 4, bitAt(itemBytes, bit));
  setBit(out, SOCKETED_FLAG_BIT, 1);

  // Self-check 1: bit-exact layout.
  for (let bit = 0; bit < out.length * 8; bit++) {
    let expected: number;
    if (bit === SOCKETED_FLAG_BIT) expected = 1;
    else if (bit < field) expected = bitAt(itemBytes, bit);
    else if (bit < field + 4) expected = (sockets >> (bit - field)) & 1;
    else if (bit < content + 4) expected = bitAt(itemBytes, bit - 4);
    else expected = 0;
    if (bitAt(out, bit) !== expected) throw new D2RSaverError(ErrorCode.WRITE_ERROR, `socketed item differs at bit ${bit}`);
  }
  // Self-check 2: the result parses as one item with the sockets and nothing else changed.
  const after = walkLoneItem(out, gd);
  if (!after.head.socketed || after.item.sockets !== sockets || after.children.length) {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'socketed item does not read back with its sockets');
  }
  if (snapshot(after.item) !== snapshot(entry.item)) {
    throw new D2RSaverError(ErrorCode.WRITE_ERROR, 'socketing changed another parsed field of the item');
  }
  return out;
}

/** Read the item facts `planLarzukSockets` needs from an item's own bytes. */
export function readLarzukItemFacts(itemBytes: Uint8Array, gd: GameData): LarzukItemFacts {
  const entry = walkLoneItem(itemBytes, gd);
  return {
    base: entry.item.base,
    quality: entry.item.quality,
    ilvl: entry.item.ilvl,
    socketed: entry.head.socketed,
    unidentified: !entry.head.identified,
    simple: entry.head.simple,
    ear: entry.head.ear,
  };
}
