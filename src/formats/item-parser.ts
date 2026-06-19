/**
 * Item binary parser — reads items from D2R v105 save files.
 *
 * Ported from d2planner/src/logic/binary/index.js → createItemParser().
 * Simplified: Blizzless v105 only (D2R=true, V105=true, version=105).
 *
 * Uses GameData instead of global Data singleton.
 */

import type { BinaryReader } from '../core/binary-reader.js';
import type { GameData } from '../game-data/game-data.js';
import { itemGetTypes, isSubType, presetItemIds } from '../items/item-types.js';
import {
  parseParamStats,
  parseUniqueStats as parseUniqueStatsHelper,
  parseRunewordStats as parseRunewordStatsHelper,
  parseModStats as parseModStatsHelper,
} from '../items/item-stats-parser.js';

// ─── Constants ──────────────────────────────────────────────────

/** Maps the 4-bit quality field from the binary format to our Quality enum values. */
export const gameQualityMap = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
// Index:                     0  1  2  3  4  5  6  7  8
// Quality: none, LOW, NORMAL, SUPERIOR, MAGIC, SET, RARE, UNIQUE, CRAFTED

const QUALITY_LOW = 1;
const QUALITY_NORMAL = 2;
const QUALITY_SUPERIOR = 3;
const QUALITY_MAGIC = 4;
const QUALITY_SET = 5;
const QUALITY_RARE = 6;
const QUALITY_UNIQUE = 7;
const QUALITY_CRAFTED = 8;
const QUALITY_RUNEWORD = 9;

/** Maps body slot indices to slot names. */
const bodyMap = [
  null, 'head', 'neck', 'tors', 'rarm', 'larm',
  'rrin', 'lrin', 'belt', 'feet', 'glov', 'rarm2', 'larm2',
] as const;

/** Zero-pad a number to 3 digits (for mod IDs like "mp001"). */
function mkid(n: number): string {
  return n.toString().padStart(3, '0');
}

/**
 * Stats followed by N consecutive stat IDs in the binary stream.
 * (e.g. item_maxdamage_percent followed by 1 stat, coldmindam by 2.)
 */
const followStats: Record<string, number> = {
  item_maxdamage_percent: 1,
  firemindam: 1,
  lightmindam: 1,
  magicmindam: 1,
  coldmindam: 2,
  poisonmindam: 2,
};

// ─── Types ──────────────────────────────────────────────────────

/** Parsed item representation from the binary reader. */
export interface BinaryParsedItem {
  itemId: number;
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
  /** Personalized name string (when personalized flag set). */
  personalized?: string;
  /** Ear-item payload (when ear flag set). */
  ear?: { class: number; level: number; name: string };
  iconIndex?: number;
  custom?: boolean;
  /** Active set-bonus property bits (5-bit field for SET quality items). */
  setflags?: number;
  /** Bit range in the original buffer. */
  binaryOffset: { start: number; end: number };
}

/** Callback for item placement during parsing. */
export type ItemHandler = (
  id: number | string,
  location?: string,
  slot?: number | string,
  item?: BinaryParsedItem,
) => void;

/** Return type of createItemParser. */
export interface ItemParserContext {
  parseItem: (itemId: number, handler: ItemHandler) => void;
  parseItemList: (handler: ItemHandler) => void;
  items: Record<number | string, BinaryParsedItem>;
  nextId: () => number;
  readonly currentId: number;
  /** Non-fatal error from the last parseItemList call (set when an item mid-list throws). */
  readonly error: string | null;
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

// ─── Stat helper ────────────────────────────────────────────────

/**
 * Add a stat value to the stats accumulator.
 * Handles special cases: skill-on-event encoding, addclass/single/aura skill params, enhanced damage max.
 */
function addStat(stats: Record<string, number>, stat: string, param: number, value: number): void {
  let param2: number;
  switch (stat) {
    case 'item_skillonattack':
    case 'item_skillonkill':
    case 'item_skillondeath':
    case 'item_skillonhit':
    case 'item_skillonlevelup':
    case 'item_skillongethit':
      param2 = value;
      value = param & 63;
      param = param >> 6;
      stat = `${stat}#${param}#${param2}`;
      break;
    case 'item_charged_skill':
      value = value >> 8;
      param2 = param & 63;
      param = param >> 6;
      stat = `${stat}#${param}#${param2}`;
      break;
    case 'item_addclassskills':
    case 'item_nonclassskill':
    case 'state':
    case 'item_singleskill':
    case 'item_elemskill':
    case 'item_aura':
    case 'item_reanimate':
      stat = `${stat}#${param}`;
      break;
    case 'item_addskill_tab':
      param = (param >> 3) * 3 + (param & 7);
      stat = `${stat}#${param}`;
      break;
  }

  // Enhanced damage workaround: follow stats can read item_mindamage_percent
  // twice; summing would double-count. Use Math.max.
  if (stat === 'item_mindamage_percent' || stat === 'item_maxdamage_percent') {
    stats[stat] = Math.max(stats[stat] || 0, value);
    return;
  }

  stats[stat] = (stats[stat] || 0) + value;
}

// ─── createItemParser ───────────────────────────────────────────

/**
 * Create a parser context for reading items from a BinaryReader.
 * V105 only — no version branching.
 *
 * @param reader    BinaryReader positioned before item data
 * @param gd        GameData instance
 * @param initialId Starting item ID (default 0)
 * @param options   Parser options
 */
export function createItemParser(
  reader: BinaryReader,
  gd: GameData,
  initialId = 0,
  options?: { forceStackable?: boolean },
): ItemParserContext {
  const forceStackable = options?.forceStackable ?? false;
  const items: Record<number | string, BinaryParsedItem> = {};
  let itemId = initialId;
  let listError: string | null = null;

  // Build stat map: numeric id → stat key
  const statMap = new Map<number, string>();
  for (const key in gd.itemStatCost) {
    statMap.set(gd.itemStatCost[key].id, key);
  }

  function getStatInfo(stat: string): { savebits?: number; saveadd?: number; saveparambits?: number } {
    return (gd.itemStatCost as Record<string, { savebits?: number; saveadd?: number; saveparambits?: number }>)[stat] || {};
  }

  function itemTypeTreeFilter(type: string): boolean {
    const tradeableTypes = [
      'helm', 'tors', 'glov', 'boot', 'belt', 'shld',
      'amul', 'ring', 'jewl', 'char',
      'mele', 'miss', 'orb', 'comb',
    ];
    return tradeableTypes.some(t => isSubType(gd, type, t));
  }

  const stashColumns = gd.info?.stash?.columns || 16;

  function parseItem(idIn: number | string, handler: ItemHandler): void {
    const startBit = reader.bitpos;

    // ── Flags (35 bits, D2R v105) ─────────────────────────────
    reader.skipbits(4);
    const unidentified = !reader.bits(1);
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
    // D2R: 1 unk + 1 extras flag + 6 unk
    reader.skipbits(1);
    const extras = reader.bits(1);
    reader.skipbits(6);

    const item: Partial<BinaryParsedItem> = {
      itemId: typeof idIn === 'number' ? idIn : 0,
      unidentified,
      ethereal,
      socketed,
      sockets: 0,
      socketedItems: [],
      stats: {},
      binaryOffset: { start: startBit, end: 0 },
    };

    // ── Location ──────────────────────────────────────────────
    const location = reader.bits(3);
    const bodyloc = reader.bits(4);
    const invcol = reader.bits(4);
    const invrow = reader.bits(4);
    const storage = reader.bits(3);

    // ── Ear item ──────────────────────────────────────────────
    if (ear) {
      const earClass = reader.bits(3);
      const earLevel = reader.bits(7);
      const nameBytes: number[] = [];
      let ch: number;
      while ((ch = reader.bits(7))) nameBytes.push(ch);
      const earName = String.fromCharCode(...nameBytes);
      item.ear = { class: earClass, level: earLevel, name: earName };
      item.base = 'ear';
      item.quality = QUALITY_NORMAL;
      reader.align();
      item.binaryOffset!.end = reader.bitpos;

      const earId = typeof idIn === 'number' ? idIn : 0;
      items[earId] = item as BinaryParsedItem;
      emitLocation(earId, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
      return;
    }

    // ── Item code (Huffman: 3 letters + space) ────────────────
    const basea = reader.char();
    const baseb = reader.char();
    const basec = reader.char();
    const based = reader.char();
    if (based !== ' ') throw Error(`invalid item code`);
    const baseId = basea + baseb + basec;
    // Unknown bases are tolerated (parsed as generic) to match d2planner-HEAD.
    item.base = baseId;

    const base = (gd.items[baseId] || {}) as unknown as Record<string, unknown>;
    let socketedItemsCount = 0;

    if (simple) {
      // socketed-count is 1-bit for simple items (always 0 in practice)
      socketedItemsCount = reader.bits(1);
      item.quality = QUALITY_NORMAL;
    } else {
      socketedItemsCount = reader.bits(3);

      const types = itemGetTypes(gd, baseId);

      reader.skipbits(32); // item ID
      item.ilvl = reader.bits(7);
      const qualityRaw = gameQualityMap[reader.bits(4)];
      item.quality = runeword ? QUALITY_RUNEWORD : qualityRaw;

      if (reader.bits(1)) {
        item.iconIndex = reader.bits(3);
      }

      const mods: string[] = [];
      if (reader.bits(1)) {
        mods.push(`am${mkid(reader.bits(11))}`);
      }

      let modid: number;
      switch (qualityRaw) {
        case QUALITY_LOW:
          reader.skipbits(3);
          break;
        case QUALITY_NORMAL:
          if (types.has('char')) reader.skipbits(12);
          break;
        case QUALITY_SUPERIOR:
          mods.push(`qm${mkid(reader.bits(3))}`);
          mods.pop(); // too many mismatches (mirrors d2planner)
          break;
        case QUALITY_MAGIC: {
          const p = reader.bits(11);
          if (p) { const c = `mp${mkid(p)}`; mods.push(c); item.magicPrefixCode = c; }
          const s = reader.bits(11);
          if (s) { const c = `ms${mkid(s)}`; mods.push(c); item.magicSuffixCode = c; }
          break;
        }
        case QUALITY_SET:
          item.unique = `set${mkid(reader.bits(12))}`;
          break;
        case QUALITY_UNIQUE:
          item.unique = `unique${mkid(reader.bits(12))}`;
          break;
        case QUALITY_RARE:
        case QUALITY_CRAFTED: {
          const name1 = (gd.rarePrefix as Record<string, { name?: string }>)[reader.bits(8) - 156]?.name;
          const name2 = (gd.rareSuffix as Record<string, { name?: string }>)[reader.bits(8) - 1]?.name;
          item.name = `${gd.locale.strings[name1!] || name1 || ''} ${gd.locale.strings[name2!] || name2 || ''}`.trim();

          if (reader.bits(1)) mods.push(`mp${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`ms${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`mp${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`ms${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`mp${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`ms${mkid(reader.bits(11))}`);
          break;
        }
      }

      if (runeword) {
        let rwid = reader.bits(12);
        // Eye() mapping (maxroll): stored D2S runeword ID → sequential index.
        if (rwid === 2718) rwid = 48;
        else if (rwid > 3194) rwid -= 3194;
        else if (rwid > 2869) rwid -= 2869;
        else if (rwid > 2588) rwid -= 2588;
        item.unique = `runeword${mkid(rwid)}`;
        reader.skipbits(4);
      }

      if (personalized) {
        const bytes: number[] = [];
        let chr: number;
        while ((chr = reader.bits(8))) bytes.push(chr);
        item.personalized = String.fromCharCode(...bytes);
      }

      if (types.has('book')) {
        reader.skipbits(5);
      }

      // D2R extended section flag
      if (reader.bits(1)) {
        reader.skipbits(types.has('misc') ? 128 : 3);
      }

      // ── Armor defense ─────────────────────────────────────
      if (types.has('armo')) {
        let minac = reader.bits(11) - 10;
        let maxac = minac;
        if (item.ethereal) {
          minac = Math.ceil(minac / 1.5);
          maxac = Math.ceil((maxac + 1) / 1.5) - 1;
        }
        const baseMaxAc = 'maxac' in base ? (base.maxac as number) : 0;
        const baseMinAc = 'minac' in base ? (base.minac as number) : 0;
        if (minac <= baseMaxAc + 1 && maxac >= baseMinAc) {
          item.defense = (Math.max(minac, baseMinAc) + Math.min(maxac, baseMaxAc + 1)) >> 1;
        } else {
          const minac2 = Math.ceil(minac / 1.5);
          const maxac2 = Math.ceil((maxac + 1) / 1.5) - 1;
          if (minac <= baseMaxAc && maxac >= baseMinAc) {
            item.defense = (Math.max(minac2, baseMinAc) + Math.min(maxac2, baseMaxAc)) >> 1;
            item.ethbugged = true;
          } else {
            item.defense = (minac + maxac) >> 1;
          }
        }
      }

      // ── Durability ────────────────────────────────────────
      if (types.has('weap') || types.has('armo')) {
        if (reader.bits(8)) reader.skipbits(9);
      }

      // ── V105 pre-stats quantity (1-bit flag + 9-bit value) ─
      if (reader.bits(1)) {
        item.quantity = reader.bits(9);
      } else if (forceStackable && !types.has('ques')) {
        // legacy fixture path — V105 never enters here
      }

      if (socketed) item.sockets = reader.bits(4);

      // ── Set flags ─────────────────────────────────────────
      const setflags = (qualityRaw === QUALITY_SET ? reader.bits(5) : 0);
      if (setflags) item.setflags = setflags;

      // ── Stats ─────────────────────────────────────────────
      const stats: Record<string, number> = {};

      function parseStats(): void {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          let id = reader.bits(9);
          if (id === 511) break;
          const stat = statMap.get(id);
          if (!stat) throw Error(`unknown item stat code ${id}`);
          const info = getStatInfo(stat);
          if (!info) throw Error(`unknown item stat code ${id}`);
          const param = info.saveparambits ? reader.bits(info.saveparambits) : 0;
          const value = reader.bits(info.savebits ?? 0) - (info.saveadd || 0);
          addStat(stats, stat, param, value);

          let follow = followStats[stat] || 0;
          while (follow--) {
            const followStat = statMap.get(++id);
            if (!followStat) break;
            const followInfo = getStatInfo(followStat) || {};
            const followParam = followInfo.saveparambits ? reader.bits(followInfo.saveparambits) : 0;
            const followValue = reader.bits(followInfo.savebits ?? 0) - (followInfo.saveadd || 0);
            addStat(stats, followStat, followParam, followValue);
          }
        }
      }

      parseStats();
      if (setflags & 1) parseStats();
      if (setflags & 2) parseStats();
      if (setflags & 4) parseStats();
      if (setflags & 8) parseStats();
      if (setflags & 16) parseStats();
      if (runeword) parseStats();

      // Damage stat consolidation
      if (stats.mindamage || stats.secondary_mindamage || stats.item_throw_mindamage) {
        stats.mindamage = Math.max(
          ...[stats.mindamage, stats.secondary_mindamage, stats.item_throw_mindamage].filter(Boolean) as number[],
        );
        delete stats.secondary_mindamage;
        delete stats.item_throw_mindamage;
      }
      if (stats.maxdamage || stats.secondary_maxdamage || stats.item_throw_maxdamage) {
        stats.maxdamage = Math.max(
          ...[stats.maxdamage, stats.secondary_maxdamage, stats.item_throw_maxdamage].filter(Boolean) as number[],
        );
        delete stats.secondary_maxdamage;
        delete stats.item_throw_maxdamage;
      }

      item.stats = stats;

      // ── Resolve mod sources ───────────────────────────────
      const getStats = (src: Record<string, unknown>) =>
        parseParamStats(gd, stats, src as Record<string, never>) as Record<string, never>;
      if (item.quality === QUALITY_SET || item.quality === QUALITY_UNIQUE) {
        const parsed = parseUniqueStatsHelper(gd, item as { base: string; quality: number; unique?: string }, getStats);
        if (parsed) {
          item.uniqueValues = parsed.uniqueValues;
          if (parsed.propertyIndex && Object.keys(parsed.propertyIndex).length) {
            item.propertyIndex = parsed.propertyIndex;
          }
        } else {
          const def = (gd.uniqueItems[item.unique!] || gd.setItems[item.unique!]) as unknown as Record<string, unknown> | undefined;
          const extracted = extractValuesFromStats(gd, def, 'prop', 'max', stats);
          if (extracted) {
            item.uniqueValues = extracted.values;
            if (Object.keys(extracted.propertyIndex).length) item.propertyIndex = extracted.propertyIndex;
          }
        }
      } else if (item.quality === QUALITY_RUNEWORD) {
        const parsed = parseRunewordStatsHelper(
          gd,
          item as { base: string; quality: number; unique?: string },
          null,
          getStats,
          mods,
        );
        if (parsed) {
          Object.assign(item, parsed);
        } else {
          const def = gd.runes[item.unique!] as unknown as Record<string, unknown> | undefined;
          const extracted = extractValuesFromStats(gd, def, 't1code', 't1max', stats);
          if (extracted) item.uniqueValues = extracted.values;
        }
      } else {
        // Type-mismatch guard: if any magic prefix/suffix is unknown or out of
        // type tree, skip the solver (it'd otherwise yield garbage) and mark custom.
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
          item.mods = {};
          item.custom = true;
        } else {
          // The brute-force affix solver can THROW on Blizzless data (e.g. a missing mod table
          // like `crafted`, or an unhandled staffmod). A throw here used to abort the WHOLE
          // item list (one bad item hid every item after it). Treat any solver failure as
          // "unsolved" → the item keeps its raw stats (the backend rebuilds mods from those),
          // it just isn't marked with reconstructed affixes.
          let parsed: ReturnType<typeof parseModStatsHelper> | null = null;
          try {
            parsed = parseModStatsHelper(
              gd,
              item as { base: string; quality: number; unique?: string },
              null,
              null,
              null,
              getStats,
              mods,
            );
          } catch {
            parsed = null;
          }
          if (parsed) {
            Object.assign(item, parsed);
          } else {
            item.mods = mods.length ? {} : undefined;
            if (Object.keys(stats).length) item.custom = true;
          }
        }
      }

      // Blunt weapon undead damage bonus
      if (types.has('blun')) {
        stats.item_undeaddamage_percent = (stats.item_undeaddamage_percent || 0) + 50;
      }
    }

    // ── Post-stats: D2R extras + chronicle + V105 quantity ───
    if (extras) {
      reader.skipbits(52);
      // Blizzless: SET/UNIQUE/RUNEWORD items carry an extra 64-bit
      // chronicle-tracking field after the extras block.
      if (item.quality === QUALITY_SET || item.quality === QUALITY_UNIQUE || item.quality === QUALITY_RUNEWORD) {
        reader.skipbits(64);
      }
    }
    // V105: post-stats quantity (1-bit flag + 8-bit value).
    if (reader.bits(1)) item.quantity = reader.bits(8);

    reader.align();
    item.binaryOffset!.end = reader.bitpos;

    // ── Socketed sub-items (recursive) ────────────────────────
    if (socketedItemsCount > 0) {
      item.socketedItems = [];
      for (let i = 0; i < socketedItemsCount; ++i) {
        parseItem(itemId++, (sockId) => {
          // Preset items (runes/gems) emit their base code as id; non-preset
          // sub-items emit numeric ids. Both are valid.
          item.socketedItems!.push(sockId as number | string);
        });
      }
    }

    // ── Validate / store / emit ───────────────────────────────
    if (item.unique && !(gd.uniqueItems[item.unique] || gd.setItems[item.unique] || gd.runes[item.unique])) {
      // Unknown unique/set/runeword: drop without registering, but the stream
      // has already been consumed correctly via socketed-item recursion above.
      return;
    }

    let effectiveId: number | string = idIn;
    if (presetItemIds.has(item.base!) && !item.unique) {
      // Preset items (runes, gems, potions, etc.) are keyed by their base code
      // so the items dict can identify them by type. This matches the d2r-saver
      // convention and lets callers find e.g. r01 via items['r01'].
      effectiveId = item.base!;
      items[effectiveId] = item as BinaryParsedItem;
    } else if (
      (gd.items[item.base!] && itemTypeTreeFilter((gd.items[item.base!] as unknown as Record<string, unknown>).type as string)) ||
      item.unique ||
      location === 6
    ) {
      items[effectiveId] = item as BinaryParsedItem;
    } else {
      return;
    }

    emitLocation(effectiveId, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
  }

  function emitLocation(
    id: number | string,
    location: number,
    bodyloc: number,
    storage: number,
    invrow: number,
    invcol: number,
    item: BinaryParsedItem,
    handler: ItemHandler,
  ): void {
    switch (location) {
      case 0:
      case 4: // Blizzless: crafting materials (e.g. Ingot) use location 4 with storage 5
        if (storage === 1) handler(id, 'inventory', invrow * 10 + invcol, item);
        if (storage === 4) handler(id, 'cube', invrow * 3 + invcol, item);
        if (storage === 5) handler(id, 'stash', invrow * stashColumns + invcol, item);
        break;
      case 1:
        if (bodyMap[bodyloc]) handler(id, 'body', bodyMap[bodyloc]!, item);
        break;
      case 2:
        handler(id, 'belt', invcol, item);
        break;
      case 6:
        handler(id);
        break;
    }
  }

  function parseItemList(handler: ItemHandler): void {
    if (reader.read16() !== 0x4d4a) throw Error('invalid item table header');
    const count = reader.read16();
    for (let i = 0; i < count; ++i) {
      try {
        parseItem(itemId++, handler);
      } catch (e) {
        listError = `item ${i + 1}/${count}: ${(e as Error).message}`;
        break;
      }
    }
  }

  function nextId(): number {
    return itemId++;
  }

  return {
    parseItem,
    parseItemList,
    items,
    nextId,
    get currentId() { return itemId; },
    get error() { return listError; },
  };
}
