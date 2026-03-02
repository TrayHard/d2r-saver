/**
 * Item binary parser — reads items from D2R v105 save files.
 *
 * Ported from d2planner/src/logic/binary/index.js → createItemParser().
 * Simplified: Blizzless v105 only (D2R=true, V105=true, version=105).
 *
 * All version branches removed — only the v105 path remains.
 * Uses GameData instead of global Data singleton.
 */

import type { BinaryReader } from '../core/binary-reader.js';
import type { GameData } from '../game-data/game-data.js';
import type { ItemQuality } from '../types/constants.js';
import { itemGetTypes, isSubType, presetItemIds } from '../items/item-types.js';
import {
  parseParamStats,
  parseUniqueStats as parseUniqueStatsHelper,
  parseRunewordStats as parseRunewordStatsHelper,
  parseModStats as parseModStatsHelper,
} from '../items/item-stats-parser.js';

// ─── Constants ──────────────────────────────────────────────────

/** Maps the 4-bit quality field from the binary format to our Quality enum values. */
const gameQualityMap = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
// Index:               0  1  2  3  4  5  6  7  8
// Quality: none, LOW, NORMAL, SUPERIOR, MAGIC, SET, RARE, UNIQUE, CRAFTED

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
 * Stats that are followed by `N` consecutive stat IDs.
 * e.g. item_maxdamage_percent is followed by 1 stat, firemindam by 1, etc.
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
  socketed: boolean;
  sockets: number;
  socketedItems: number[];
  stats: Record<string, number>;
  unique?: string;
  name?: string;
  uniqueValues?: number[];
  mods?: Record<string, number[]>;
  auto?: Record<string, number[]>;
  staff?: Record<string, number[]>;
  crafted?: Record<string, number[]>;
  superior?: Record<string, number[]>;
  defense?: number;
  quantity?: number;
  ear?: { class: number; level: number; name: string };
  personalized?: string;
  iconIndex?: number;
  custom?: boolean;
  /** Bit range in the original buffer */
  binaryOffset: { start: number; end: number };
}

/** Callback for item placement during parsing. */
export type ItemHandler = (
  id: number,
  location?: string,
  slot?: number | string,
  item?: BinaryParsedItem,
) => void;

/** Return type of createItemParser. */
export interface ItemParserContext {
  parseItem: (itemId: number, handler: ItemHandler) => void;
  parseItemList: (handler: ItemHandler) => void;
  items: Record<number, BinaryParsedItem>;
  nextId: () => number;
  readonly currentId: number;
}

// ─── Stat helper ────────────────────────────────────────────────

/**
 * Add a stat value to the stats accumulator.
 * Handles special cases: skill-on-event stats with param encoding, enhanced damage max.
 */
function addStat(stats: Record<string, number>, stat: string, param: number, value: number): void {
  if (stat.startsWith('item_') && (
    stat.endsWith('_skill_onevent') ||
    stat.endsWith('_skill_onattack') ||
    stat.endsWith('_skill_onkill') ||
    stat.endsWith('_skill_ondeath') ||
    stat.endsWith('_skill_onhit') ||
    stat.endsWith('_skill_onlevelup') ||
    stat.endsWith('_skill_ongethit') ||
    stat === 'item_charged_skill' ||
    stat === 'item_nonclassskill' ||
    stat === 'item_singleskill' ||
    stat === 'item_addclassskills' ||
    stat === 'item_addskill_tab'
  )) {
    const key = `${stat}#${param}`;
    // Some stats encode additional params — skill-on-event has chance#skill#level
    if (stat === 'item_charged_skill') {
      // param = skill, value = level#charges (encoded)
      // Actually: param has the skill id, value = charges, separate level stat follows
      stats[`${stat}#${param}#${value}`] = value;
    } else if (stat === 'item_nonclassskill' || stat === 'item_singleskill') {
      stats[key] = value;
    } else if (stat === 'item_addclassskills') {
      stats[`${stat}#${param}`] = value;
    } else if (stat === 'item_addskill_tab') {
      stats[`${stat}#${param}`] = value;
    } else {
      // skill_onevent, onattack, etc: param encodes chance + skill
      stats[`${stat}#${param}#${value}`] = value;
    }
    return;
  }
  if (stat === 'item_maxdamage_percent') {
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
  const items: Record<number, BinaryParsedItem> = {};
  let itemId = initialId;

  // Build stat map: numeric id → stat key
  const statMap = new Map<number, string>();
  for (const key in gd.itemStatCost) {
    statMap.set(gd.itemStatCost[key].id, key);
  }

  function getStatInfo(stat: string): { savebits?: number; saveadd?: number; saveparambits?: number } {
    return gd.itemStatCost[stat] || {};
  }

  // ── Item type tree filter ─────────────────────────────────────
  // In the original code, this uses itemTypeTree.filter(). For our purposes,
  // we accept all items that are armor, weapons, rings, amulets, charms, jewels,
  // or any other known item type.
  function itemTypeTreeFilter(type: string): boolean {
    const tradeableTypes = [
      'helm', 'tors', 'glov', 'boot', 'belt', 'shld',
      'amul', 'ring', 'jewl', 'char',
      'mele', 'miss', 'orb', 'comb',
    ];
    return tradeableTypes.some(t => isSubType(gd, type, t));
  }

  const stashColumns = gd.info?.stash?.columns || 16;

  function parseItem(id: number, handler: ItemHandler): void {
    const startBit = reader.bitpos;

    // Item flags — D2R v105 layout (35 bits total):
    // skip(4), identified(1), skip(6), socketed(1), skip(4), ear(1),
    // skip(4), simple(1), ethereal(1), skip(1), personalized(1),
    // skip(1), runeword(1), skip(8)
    reader.skipbits(4);
    const unidentified = !reader.bit(); // bit is "identified", we want unidentified
    reader.skipbits(6);
    const socketed = !!reader.bit();
    reader.skipbits(4);
    const ear = !!reader.bit();
    reader.skipbits(4);
    const simple = !!reader.bit();
    const ethereal = !!reader.bit();
    reader.skipbits(1);
    const personalized = !!reader.bit();
    reader.skipbits(1);
    const runeword = !!reader.bit();
    reader.skipbits(8); // D2R: 8 remaining flag bits

    const item: Partial<BinaryParsedItem> = {
      itemId: id,
      unidentified,
      ethereal,
      socketed,
      sockets: 0,
      socketedItems: [],
      stats: {},
      binaryOffset: { start: startBit, end: 0 },
    };

    // Location fields
    const location = reader.bits(3);
    const bodyloc = reader.bits(4);
    const invcol = reader.bits(4);
    const invrow = reader.bits(4);
    const storage = reader.bits(3);

    // Ear item (D2R): read class, level, name (8-bit chars)
    if (ear) {
      const earClass = reader.bits(3);
      const earLevel = reader.bits(7);
      const nameBytes: number[] = [];
      let ch: number;
      while ((ch = reader.bits(8))) nameBytes.push(ch);
      const earName = String.fromCharCode(...nameBytes);
      item.ear = { class: earClass, level: earLevel, name: earName };
      item.base = 'ear';
      item.quality = 2; // NORMAL
      reader.align();

      item.binaryOffset!.end = reader.bitpos;
      items[id] = item as BinaryParsedItem;

      emitLocation(id, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
      return;
    }

    // Item code (D2R: Huffman-encoded, 4 chars — 3 letters + space)
    const basea = reader.char();
    const baseb = reader.char();
    const basec = reader.char();
    const based = reader.char();
    if (based !== ' ') throw Error(`invalid item code`);
    const baseId = basea + baseb + basec;
    if (!gd.items[baseId]) throw Error(`invalid item code ${baseId} at bit ${reader.bitpos}`);
    item.base = baseId;

    // Simple item
    if (simple) {
      reader.skipbits(1); // socketed count (1 bit for simple items)
      // v105 simple items: quantity (1 flag bit + 8-bit quantity if flag=1)
      if (reader.bits(1)) item.quantity = reader.bits(8);
      reader.align();

      item.quality = 2; // NORMAL
      item.binaryOffset!.end = reader.bitpos;

      if (presetItemIds.has(baseId)) {
        items[baseId as unknown as number] = item as BinaryParsedItem;
        emitLocation(baseId as unknown as number, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
      } else {
        items[id] = item as BinaryParsedItem;
        emitLocation(id, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
      }
      return;
    }

    const base = gd.items[baseId];
    let socketedItems = reader.bits(3);

    const types = itemGetTypes(gd, baseId);

    reader.skipbits(32); // item ID
    item.ilvl = reader.bits(7);
    const qualityRaw = gameQualityMap[reader.bits(4)];
    item.quality = runeword ? 9 : qualityRaw; // RUNEWORD = 9 in our mapping, but use numeric for now

    if (reader.bits(1)) {
      item.iconIndex = reader.bits(3);
    }

    const mods: string[] = [];
    if (reader.bits(1)) {
      mods.push(`am${mkid(reader.bits(11))}`);
    }

    let modid: number;
    switch (qualityRaw) {
      case 1: // LOW
        reader.skipbits(3);
        break;
      case 2: // NORMAL
        if (types.has('char')) reader.skipbits(12);
        break;
      case 3: // SUPERIOR
        mods.push(`qm${mkid(reader.bits(3))}`);
        mods.pop(); // too many mismatches (original comment from d2planner)
        break;
      case 4: // MAGIC
        if ((modid = reader.bits(11))) mods.push(`mp${mkid(modid)}`);
        if ((modid = reader.bits(11))) mods.push(`ms${mkid(modid)}`);
        break;
      case 5: // SET
        item.unique = `set${mkid(reader.bits(12))}`;
        break;
      case 7: // UNIQUE
        item.unique = `unique${mkid(reader.bits(12))}`;
        break;
      case 6: // RARE
      case 8: // CRAFTED
        {
          const name1 = (gd.rarePrefix as Record<string, { name?: string }>)[reader.bits(8) - 156]?.name;
          const name2 = (gd.rareSuffix as Record<string, { name?: string }>)[reader.bits(8) - 1]?.name;
          item.name = `${gd.locale.strings[name1!] || name1 || ''} ${gd.locale.strings[name2!] || name2 || ''}`.trim();

          if (reader.bits(1)) mods.push(`mp${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`ms${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`mp${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`ms${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`mp${mkid(reader.bits(11))}`);
          if (reader.bits(1)) mods.push(`ms${mkid(reader.bits(11))}`);
        }
        break;
    }

    if (runeword) {
      let rwid = reader.bits(12);
      if (rwid === 2718) rwid = 48;
      item.unique = `runeword${mkid(rwid)}`;
      reader.skipbits(4);
    }

    if (personalized) {
      // v105: 8-bit chars for personalized name
      const bytes: number[] = [];
      let chr: number;
      while ((chr = reader.bits(8))) bytes.push(chr);
      item.personalized = String.fromCharCode(...bytes);
    }

    if (types.has('book')) {
      reader.skipbits(5);
    }

    // v105 extended section
    if (reader.bits(1)) {
      reader.skipbits(types.has('misc') ? 128 : 3);
    }

    // Armor defense
    if (types.has('armo')) {
      let minac = reader.bits(11) - 10;
      let maxac = minac;

      if (item.ethereal) {
        minac = Math.ceil(minac / 1.5);
        maxac = Math.ceil((maxac + 1) / 1.5) - 1;
      }
      const baseMaxAc = 'maxac' in base ? (base as unknown as Record<string, unknown>).maxac as number : 0;
      const baseMinAc = 'minac' in base ? (base as unknown as Record<string, unknown>).minac as number : 0;
      if (minac <= baseMaxAc + 1 && maxac >= baseMinAc) {
        item.defense = (Math.max(minac, baseMinAc) + Math.min(maxac, baseMaxAc + 1)) >> 1;
      } else {
        item.defense = (minac + maxac) >> 1;
      }
    }

    // Durability
    if (types.has('weap') || types.has('armo')) {
      if (reader.bits(8)) reader.skipbits(9);
    }

    // v105: unknown bit after durability
    reader.skipbits(1);

    // Stackable quantity (pre-stats)
    if (('stackable' in base && (base as unknown as Record<string, unknown>).stackable) ||
      (forceStackable && !types.has('ques'))) {
      item.quantity = reader.bits(9);
    }

    if (socketed) item.sockets = reader.bits(4);

    // Set flags
    const setflags = (qualityRaw === 5 ? reader.bits(5) : 0);

    // Parse stats
    const stats: Record<string, number> = {};

    function parseStats(): void {
      while (true) {
        const statId = reader.bits(9);
        if (statId === 511) break;

        const stat = statMap.get(statId);
        if (!stat) throw Error(`unknown item stat code ${statId}`);
        const info = getStatInfo(stat);

        const param = info.saveparambits ? reader.bits(info.saveparambits) : 0;
        const value = reader.bits(info.savebits ?? 0) - (info.saveadd || 0);

        addStat(stats, stat, param, value);

        let follow = followStats[stat] || 0;
        let nextId = statId;
        while (follow--) {
          const followStat = statMap.get(++nextId);
          if (!followStat) break;
          const followInfo = getStatInfo(followStat);
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

    // v105: post-stats quantity (1 flag bit + 8-bit quantity)
    if (reader.bits(1)) item.quantity = reader.bits(8);

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

    // Resolve mod sources
    if (item.quality === 5 || item.quality === 7) {
      // SET or UNIQUE
      item.uniqueValues = parseUniqueStatsHelper(gd, item as { base: string; quality: number; unique?: string },
        src => parseParamStats(gd, stats, src)) ?? undefined;
      if (!item.uniqueValues) {
        item.custom = true;
      }
    } else if (item.quality === 9) {
      // RUNEWORD
      const parsed = parseRunewordStatsHelper(
        gd,
        item as { base: string; quality: number; unique?: string },
        null,
        src => parseParamStats(gd, stats, src),
        mods,
      );
      if (parsed) {
        Object.assign(item, parsed);
      } else {
        item.custom = true;
      }
    } else {
      // MAGIC, RARE, CRAFTED, SUPERIOR, LOW, NORMAL
      const parsed = parseModStatsHelper(
        gd,
        item as { base: string; quality: number; unique?: string },
        null,
        null,
        null,
        src => parseParamStats(gd, stats, src),
        mods,
      );
      if (parsed) {
        Object.assign(item, parsed);
      } else {
        item.custom = true;
      }
    }

    // Blunt weapon undead damage bonus
    if (types.has('blun')) {
      stats.item_undeaddamage_percent = (stats.item_undeaddamage_percent || 0) + 50;
    }

    reader.align();
    item.binaryOffset!.end = reader.bitpos;

    // Socketed items
    if (item.sockets || socketedItems) {
      item.socketedItems = [];
    }
    for (let i = 0; i < socketedItems; ++i) {
      parseItem(itemId++, (sockId) => {
        item.socketedItems!.push(sockId);
      });
    }

    // Validate unique/set/runeword exists in data
    if (item.unique && !(gd.uniqueItems[item.unique] || gd.setItems[item.unique] || gd.runes[item.unique])) {
      return;
    }

    // Store item and emit location
    if (presetItemIds.has(item.base!) && !item.unique) {
      emitLocation(item.base as unknown as number, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
    } else if (itemTypeTreeFilter(base.type) || item.unique || location === 6) {
      items[id] = item as BinaryParsedItem;
      emitLocation(id, location, bodyloc, storage, invrow, invcol, item as BinaryParsedItem, handler);
    }
  }

  function emitLocation(
    id: number,
    location: number,
    bodyloc: number,
    storage: number,
    invrow: number,
    invcol: number,
    item: BinaryParsedItem,
    handler: ItemHandler,
  ): void {
    switch (location) {
      case 0: // STORED
        if (storage === 1) handler(id, 'inventory', invrow * 10 + invcol, item);
        if (storage === 4) handler(id, 'cube', invrow * 3 + invcol, item);
        if (storage === 5) handler(id, 'stash', invrow * stashColumns + invcol, item);
        break;
      case 1: // EQUIPPED
        if (bodyMap[bodyloc]) handler(id, 'body', bodyMap[bodyloc]!, item);
        break;
      case 2: // BELT
        handler(id, 'belt', invcol, item);
        break;
      case 6: // SOCKETED
        handler(id);
        break;
    }
  }

  function parseItemList(handler: ItemHandler): void {
    if (reader.read16() !== 0x4d4a) throw Error('invalid item table header');
    const count = reader.read16();
    for (let i = 0; i < count; ++i) {
      parseItem(itemId++, handler);
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
  };
}
