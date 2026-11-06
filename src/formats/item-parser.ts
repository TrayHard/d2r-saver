/**
 * Parsed item types and the affix solver.
 *
 * The bits are read by the Rust core (`rust/core/src/item.rs`, through `src/engine/engine.ts`);
 * `solveItem` is the part of the 0.4 parser that reads no bits: it reconstructs affixes and
 * unique/set/runeword values from the stats the core returns.
 */

import type { GameData } from '../game-data/game-data.js';
import type { ItemHead } from './item-walker.js';
import type { ErrorCode } from '../types/errors.js';
import { itemGetTypes } from '../items/item-types.js';
import {
  parseParamStats,
  parseUniqueStats as parseUniqueStatsHelper,
  parseRunewordStats as parseRunewordStatsHelper,
  parseModStats as parseModStatsHelper,
} from '../items/item-stats-parser.js';

// ─── Constants ──────────────────────────────────────────────────

const QUALITY_SET = 5;
const QUALITY_UNIQUE = 7;
const QUALITY_RUNEWORD = 9;

// ─── Types ──────────────────────────────────────────────────────

/**
 * Half-open byte range `[start, end)` in ABSOLUTE file offsets (ranges of `.d2i` items already
 * include the sector offset).
 */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * What one `JM` item list looked like to the parser. Surfaced by the readers
 * (`D2SReadResult.lists`, `D2IStashPage.list`) and by the walker.
 * All offsets are absolute bytes in the file buffer.
 */
export interface ItemListReport {
  /** Absolute byte offset of the `JM` marker. */
  headerOffset: number;
  /** 16-bit item count from the list header. */
  declared: number;
  /** Items consumed without error (top-level; socketed children are inside their parent). */
  parsed: number;
  /** Absolute byte offset of the first item (`headerOffset + 4`). */
  firstItemOffset: number;
  /**
   * Reader position right after the last successfully parsed item, byte-aligned. Equals
   * `firstItemOffset` when nothing parsed. This is where the next item (or the next section)
   * starts; on a truncated list it is the exact point up to which the bytes are understood.
   */
  endOffset: number;
  /** Where the caller expects the list to end (sector end for `.d2i`); `null` when unknown. */
  expectedEnd: number | null;
  /** `endOffset === expectedEnd`; `null` when `expectedEnd` is unknown. */
  reachedEnd: boolean | null;
  /** `parsed < declared`: the list was cut short (see `error` for the reason). */
  truncated: boolean;
  /**
   * The list is fully understood: `parsed === declared`, no error, and (when the expected end
   * is known) the reader stopped exactly there. Only a complete list is safe to write into.
   */
  complete: boolean;
  /** `item <n>/<declared>: <reason>` for the item that failed, or `null`. */
  error: string | null;
  /** `BUFFER_OVERRUN` when the failure was a read past the end, otherwise `PARSE_ERROR`; `null` without error. */
  errorCode: ErrorCode | null;
}

/**
 * Trace record of one parsed item (top-level AND socketed, registered in `items` or dropped),
 * after its socketed children were consumed.
 */
export interface ParsedItemTrace {
  item: BinaryParsedItem;
  /** 0 for a list-level item, 1 for a socketed child, and so on. */
  depth: number;
  /**
   * Key under which the item was stored in `items` (numeric id, or the base code for preset
   * items), or `null` when the parser dropped it (unknown unique/set/runeword, or a base type
   * outside the tradeable filter). Dropped items are still fully parsed and byte-ranged.
   */
  registeredKey: number | string | null;
  /** Flags, position and base code as the parser read them; equal to `readItemHead` at `item.byteRange.start`. */
  head: ItemHead;
}

/** Options of the 0.4 TypeScript item parser, kept for the type surface. */
export interface ParserOptions {
  forceStackable?: boolean;
  /** Byte offset of the reader's first byte inside the whole file. Default 0. */
  baseOffset?: number;
  /** Called for every item the parser finishes, including ones it does not register. */
  onItem?: (trace: ParsedItemTrace) => void;
  /** Save version of the items; 99 selects the legacy read-only layout. Defaults to 105. */
  saveVersion?: 99 | 105;
  /** See `ReadOptions.resolveMods`. */
  resolveMods?: boolean;
}

/** Read options for the public save readers and walkers. */
export interface ReadOptions {
  /**
   * `false` skips the affix solver: `stats` stay the raw binary stats and `uniqueValues`,
   * `propertyIndex`, `mods`, `auto`, `staff`, `crafted`, `superior` and `custom` are not filled.
   * Everything read from the bits is the same: identity, quality, unique/set/runeword id, affix
   * codes, quantity, sockets, locations and byte ranges. The solver takes most of the read time,
   * so callers that only count or locate items should pass `false`. Defaults to `true`.
   */
  resolveMods?: boolean;
}

/** Parsed item representation from the binary reader. */
export interface BinaryParsedItem {
  itemId: number;
  /**
   * The item's persistent 32-bit D2 id (a.k.a. GUID), read straight from the extended-item binary.
   * Assigned by the game at item creation and preserved across saves/moves/trades, so it is a STABLE
   * per-item identity — unlike `itemId`, which is just the parse-order index. Present only for
   * extended (non-simple) items; `undefined` for simple items (runes/gems/potions) and ears.
   */
  guid?: number;
  base: string;
  quality: number;
  ilvl: number;
  unidentified: boolean;
  ethereal: boolean;
  /** Set when armor item has eth-bug (defense computed via inverted ethereal math). */
  ethbugged?: boolean;
  socketed: boolean;
  sockets: number;
  /**
   * IDs of inserted socketed sub-items. Numeric for regular sub-items,
   * string base-code for preset items (runes/gems/jewels) — matches
   * d2planner's convention where preset items are keyed by their base code.
   */
  socketedItems: (number | string)[];
  stats: Record<string, number>;
  unique?: string;
  name?: string;
  /** Raw magic affix codes (mp###/ms###) read straight from the binary. Kept on the item
   * so the magic display name (prefix + base + suffix) can be rebuilt even when the stat
   * solver fails on Blizzless data and clears the `mods` map. */
  magicPrefixCode?: string;
  magicSuffixCode?: string;
  /** ALL prefix affix codes (mp###), in binary order. Magic items carry one; rare/crafted up to
   * three. Persisted so the backend can fill the create-form Prefix slots (names only — the stats
   * always live in the flat mod list, NEVER attributed back to an affix). */
  prefixCodes?: string[];
  /** ALL suffix affix codes (ms###), in binary order (magic: one; rare/crafted: up to three). */
  suffixCodes?: string[];
  uniqueValues?: number[];
  /** Selected pg option index per property key (warlock property-group items). */
  propertyIndex?: Record<string, number>;
  mods?: Record<string, number[]>;
  auto?: Record<string, number[]>;
  staff?: Record<string, number[]>;
  crafted?: Record<string, number[]>;
  superior?: Record<string, number[]>;
  defense?: number;
  quantity?: number;
  /**
   * Where the quantity field sits inside the item's own bits (0.4.0), set whenever a quantity
   * flag was read as 1. `flagBit` is the offset of the 1-bit flag from the first bit of the item;
   * the value follows right after it (`width` bits, LSB-first). `post-stats` is the 1+8-bit field
   * after the stats/extras block, `pre-stats` the V105 1+9-bit field before the sockets. When
   * both are present the later (`post-stats`) one wins, exactly like `quantity`. Parsing does not
   * depend on it; in-place quantity patching of materials tabs does.
   */
  quantityField?: { placement: 'post-stats' | 'pre-stats'; flagBit: number; width: 8 | 9 };
  /** Difficulty of a compact quest item with `questdiffcheck`; `undefined` for other items. */
  questDifficulty?: number;
  /** Personalized name string (when personalized flag set). */
  personalized?: string;
  /** Ear-item payload (when ear flag set). */
  ear?: { class: number; level: number; name: string };
  iconIndex?: number;
  custom?: boolean;
  /** Active set-bonus property bits (5-bit field for SET quality items). */
  setflags?: number;
  /**
   * Bit range in the reader's buffer (relative to the SECTOR for `.d2i` read by `readD2I`). `end`
   * covers the item alone. Kept as-is for compatibility; prefer the byte ranges below.
   */
  binaryOffset: { start: number; end: number };
  /**
   * Absolute byte range of the item alone (without socketed children). Always set by the
   * readers; optional in the type only so hand-built items (tests, the legacy writer) still
   * type-check.
   */
  byteRange?: ByteRange;
  /** Absolute byte range of the item PLUS its socketed children (what a raw cut/paste moves). */
  fullByteRange?: ByteRange;
  /**
   * Absolute byte range of each socketed child in stream order, whether or not the child was
   * registered in `items` (an unknown socketed unique still occupies bytes).
   */
  socketedByteRanges?: ByteRange[];
}

/** Callback for item placement during parsing. */
export type ItemHandler = (
  id: number | string,
  location?: string,
  slot?: number | string,
  item?: BinaryParsedItem,
) => void;

/** Options for `parseItemList`. */
export interface ParseItemListOptions {
  /** Absolute byte offset where the list must end (sector end for `.d2i`), if known. */
  expectedEnd?: number;
}

// ─── extractValuesFromStats (fallback for unique/set/runeword) ──

/**
 * Build a `uniqueValues` array by walking a unique/set/runeword definition
 * and filling each `prop_i` slot from the item's actual binary stats.
 *
 * Used as a fallback when parseUniqueStats / parseRunewordStats can't solve.
 * For propertyGroups (pg) props, the picked option index is captured in
 * `propertyIndex[propName]` so the writer / tooltip can recover the option.
 */
function extractValuesFromStats(
  gd: GameData,
  def: Record<string, unknown> | undefined,
  codeKey: string,
  maxKey: string,
  binaryStats: Record<string, number>,
): { values: number[]; propertyIndex: Record<string, number> } | null {
  if (!def) return null;
  const result: number[] = [];
  const propertyIndex: Record<string, number> = {};
  for (let i = 1; i <= 12; i++) {
    const prop = def[codeKey + i] as string | undefined;
    if (!prop) continue;
    const pg = gd.propertyGroups?.[prop];
    if (pg) {
      let foundOptIdx = 0;
      let foundValue = (def[maxKey + i] as number | undefined) ?? 0;
      for (let j = 1; (gd.mods as Record<string, unknown>)[`${prop}:${j}`]; j++) {
        const m = gd.mods[`${prop}:${j}`] as Record<string, unknown>;
        const baseStat = (gd.properties[m.mod1code as string]?.stat1 as string | undefined);
        const key = m.mod1param != null ? `${baseStat}#${m.mod1param}` : baseStat;
        if (baseStat && key != null && binaryStats[key] != null) {
          foundOptIdx = j - 1;
          const raw = binaryStats[key];
          foundValue = typeof raw === 'object'
            ? ((raw as { min: number; max: number }).min + (raw as { min: number; max: number }).max) >> 1
            : (raw as number);
          break;
        }
      }
      propertyIndex[prop] = foundOptIdx;
      result.push(foundValue);
      continue;
    }
    const statName = gd.properties[prop]?.stat1 as string | undefined;
    const tmax = (def[maxKey + i] as number | undefined) ?? 0;
    let val = (statName && binaryStats[statName] != null
      ? binaryStats[statName]
      : tmax) as number | { min: number; max: number };
    val = typeof val === 'object'
      ? ((val.min + val.max) >> 1)
      : val;
    result.push(tmax > 0 ? Math.min(val as number, tmax) : (val as number));
  }
  return { values: result, propertyIndex };
}

// ─── solveItem ──────────────────────────────────────────────────

/**
 * The affix solver of an extended item: the fields the 0.4 parser set between the stats and the
 * post-stats quantity, in the order it set them (`uniqueValues`, `propertyIndex`, `mods`, `auto`,
 * `staff`, `crafted`, `superior`, `custom`). `item` holds what the bits gave up to the stats,
 * `stats` before the blunt-weapon bonus; `mods` lists the auto affix and the affix codes as read.
 */
export function solveItem(gd: GameData, item: BinaryParsedItem, mods: string[]): Partial<BinaryParsedItem> {
  const solved: Partial<BinaryParsedItem> = {};
  const stats = item.stats;
  const getStats = (src: Record<string, unknown>) =>
    parseParamStats(gd, stats, src as Record<string, never>) as Record<string, never>;
  if (item.quality === QUALITY_SET || item.quality === QUALITY_UNIQUE) {
    const parsed = parseUniqueStatsHelper(gd, item as { base: string; quality: number; unique?: string }, getStats);
    if (parsed) {
      solved.uniqueValues = parsed.uniqueValues;
      if (parsed.propertyIndex && Object.keys(parsed.propertyIndex).length) {
        solved.propertyIndex = parsed.propertyIndex;
      }
    } else {
      const def = (gd.uniqueItems[item.unique!] || gd.setItems[item.unique!]) as unknown as Record<string, unknown> | undefined;
      const extracted = extractValuesFromStats(gd, def, 'prop', 'max', stats);
      if (extracted) {
        solved.uniqueValues = extracted.values;
        if (Object.keys(extracted.propertyIndex).length) solved.propertyIndex = extracted.propertyIndex;
      }
    }
  } else if (item.quality === QUALITY_RUNEWORD) {
    const parsed = parseRunewordStatsHelper(gd, item as { base: string; quality: number; unique?: string }, null, getStats, mods);
    if (parsed) {
      Object.assign(solved, parsed);
    } else {
      const def = gd.runes[item.unique!] as unknown as Record<string, unknown> | undefined;
      const extracted = extractValuesFromStats(gd, def, 't1code', 't1max', stats);
      if (extracted) solved.uniqueValues = extracted.values;
    }
  } else {
    // Type-mismatch guard: if any magic prefix/suffix is unknown or out of
    // type tree, skip the solver (it'd otherwise yield garbage) and mark custom.
    const types = itemGetTypes(gd, item.base);
    const hasMismatch = mods.some(mid => {
      const isPfx = mid.startsWith('mp'), isSfx = mid.startsWith('ms');
      if (!isPfx && !isSfx) return false;
      const modDef = isPfx
        ? gd.magicPrefix[mid] as Record<string, unknown> | undefined
        : gd.magicSuffix[mid] as Record<string, unknown> | undefined;
      if (!modDef) return true;
      const itypes = [modDef.itype1, modDef.itype2, modDef.itype3, modDef.itype4]
        .filter(Boolean) as string[];
      return itypes.length > 0 && !itypes.some(t => types.has(t));
    });
    if (hasMismatch) {
      solved.mods = {};
      solved.custom = true;
    } else {
      // The brute-force affix solver can THROW on Blizzless data (e.g. a missing mod table
      // like `crafted`, or an unhandled staffmod). Treat any solver failure as "unsolved": the
      // item keeps its raw stats, it just isn't marked with reconstructed affixes.
      let parsed: ReturnType<typeof parseModStatsHelper> | null = null;
      try {
        parsed = parseModStatsHelper(gd, item as { base: string; quality: number; unique?: string }, null, null, null, getStats, mods);
      } catch {
        parsed = null;
      }
      if (parsed) {
        Object.assign(solved, parsed);
      } else {
        solved.mods = mods.length ? {} : undefined;
        if (Object.keys(stats).length) solved.custom = true;
      }
    }
  }
  return solved;
}
