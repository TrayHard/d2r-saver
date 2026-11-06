/**
 * D2S (character save) reader — Blizzless v105, and legacy v99 read-only.
 *
 * The Rust core reads the file (`rust/core/src/character.rs`); this module builds the profile
 * from its document: names, slots and the derived base stats.
 */

import { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem, ItemListReport, ReadOptions } from './item-parser.js';
import type { D2SDemonSectionReport } from './d2s-demon-reader.js';
import type { D2SParseCoverage } from './d2s-coverage.js';
import { dictOf, engineReadD2S, entriesOf, itemsOf, type ItemsDoc, type Node } from '../engine/engine.js';

// ─── Types ──────────────────────────────────────────────────────

export interface D2SCharacterProfile {
  name: string;
  class: string;
  level: number;
  stats: {
    str: number;
    dex: number;
    int: number;
    vit: number;
  };
  skills: Record<number, number>;
  quests: Array<{
    denofevil: boolean;
    radamentslair: boolean;
    thegoldenbird: boolean;
    lamessenstome: boolean;
    thefallenangel: boolean;
    prisonofice: boolean;
  }>;
  weaponSet?: number;
  mercName?: number;
  merc?: string;
  mercLevel?: number;
  /**
   * Slot maps and arrays carry either numeric item IDs OR string base codes
   * (for preset items like runes / gems / potions, which are keyed by base
   * code in the items dict).
   */
  items: Record<string, number | string>;
  mercItems: Record<string, number | string>;
  inventory: (number | string | undefined)[];
  cube: (number | string | undefined)[];
  stash: (number | string | undefined)[];
  belt: (number | string | undefined)[];
  /** Gold carried in the character's inventory (the `gold` stat). */
  gold?: number;
  /** Gold in the character's personal stash (the `goldbank` stat). */
  goldStash?: number;
  /**
   * Raw character stat map straight from the save (stat name → value), e.g.
   * strength, dexterity, vitality, energy, level, experience, maxhp, maxmana,
   * maxstamina, statpts, newskills. Life/mana/stamina are 8.8 fixed-point
   * (divide by 256 for the displayed integer).
   */
  attributes?: Record<string, number>;
  ironGolem?: number | string;
  /**
   * Raw bytes of the v105 "extra sections" tail (typically the 0x666c warlock
   * demon block). Preserved verbatim from the source file so the writer can
   * round-trip them unchanged.
   */
  extraSections?: number[];
  /**
   * Raw bytes [0, 833) of the fixed v105 header, captured verbatim. Lets the
   * writer round-trip every header field (name, class, merc header, quests,
   * waypoints, appearance, difficulty, skill hotkeys, timestamps, progression)
   * without recomputing them. Only filesize + checksum are re-derived on write.
   */
  rawHeader?: number[];
  /** Set by `readLegacyD2S`: this profile came from an older save version and must not be written. */
  legacyVersion?: 99;
  /** Raw bytes of the corpse section (0x4d4a marker + corpse item lists). */
  rawCorpse?: number[];
  /** Raw bytes of the iron-golem section (0x666b marker + optional golem item). */
  rawGolem?: number[];
  /**
   * Parsed warlock bind-demon descriptor when the 0x666c extras block
   * decodes successfully. Optional and best-effort.
   */
  bindDemon?: {
    revive: 'bind';
    id: string;
    monsterType: string;
    monster: string;
    area: number;
    level: number;
    unit: string;
    group: string;
    minion: boolean;
    skill: string;
    mods?: string[];
  };
}

/**
 * Per-list parse reports of a `.d2s`, in file order. A list the reader never reached (because
 * an earlier section failed) is `null` / missing; a list it reached but could not finish has
 * `truncated = true` and an `error`.
 */
export interface D2SItemLists {
  /** The main list (worn, inventory, cube, stash, belt). */
  main: ItemListReport | null;
  /** One report per corpse list. */
  corpses: ItemListReport[];
  /** The hireling list; `null` when absent or not reached. */
  merc: ItemListReport | null;
  /** The iron-golem section is a flag plus one item, not a `JM` list. */
  golem: { headerOffset: number; present: boolean } | null;
}

export interface D2SReadResult {
  profile: D2SCharacterProfile;
  items: Record<number, BinaryParsedItem>;
  warnings: string[];
  /** What each `JM` list declared versus what parsed (0.3.0). */
  lists: D2SItemLists;
  /** Strict traversal certificate. Raw preservation and empty warnings alone do not certify coverage. */
  coverage: D2SParseCoverage;
  demons: D2SDemonSectionReport | null;
}

// ─── Reader ─────────────────────────────────────────────────────

/**
 * Parse a .d2s character file.
 *
 * @param data Raw file bytes
 * @param gd   GameData instance
 */
export function readD2S(data: Uint8Array, gd: GameData, options?: ReadOptions): D2SReadResult {
  return readCharacter(data, gd, false, options);
}

/**
 * Parse a legacy v99 .d2s for reading only. The profile carries no `rawHeader`, and `writeD2S`
 * refuses `legacyVersion`, so a v99 file can never be written back through the v105 writer.
 */
export function readLegacyD2S(data: Uint8Array, gd: GameData, options?: ReadOptions): D2SReadResult {
  return readCharacter(data, gd, true, options);
}

/** The character document of the read core (`rust/core/src/doc.rs`). */
interface CharacterDoc extends ItemsDoc {
  profile: {
    name: string;
    classId: number;
    /** `mercName`, hireling type, experience. */
    merc: [number, number, number] | null;
    quests: boolean[][];
    attributes: Record<string, number>;
    skills: Record<number, number>;
    /** `[place, slot, id]`: 0 body, 1 inventory, 2 cube, 3 stash, 4 belt, 5 hireling body. */
    slots: Array<[number, number, number | string]>;
    mercSection: boolean;
    ironGolem: number | null;
    corpse: [number, number] | null;
    golem: [number, number] | null;
    extra: number | null;
    bindDemon: D2SCharacterProfile['bindDemon'] | null;
  };
  lists: D2SItemLists;
  demons: D2SDemonSectionReport | null;
  warnings: string[];
  coverage: Omit<D2SParseCoverage, 'items'> & { items: Node[] };
}

/** Body slot names by `bodyloc`. */
const bodyMap = [
  null, 'head', 'neck', 'tors', 'rarm', 'larm',
  'rrin', 'lrin', 'belt', 'feet', 'glov', 'rarm2', 'larm2',
] as const;

function readCharacter(data: Uint8Array, gd: GameData, legacy: boolean, options?: ReadOptions): D2SReadResult {
  const doc = engineReadD2S<CharacterDoc>(gd, data, legacy, options?.resolveMods ?? true);
  const items = itemsOf(doc, gd);
  const p = doc.profile;
  const bytes = (start: number, end?: number) => Array.from(data.subarray(start, end));
  const result: Partial<D2SCharacterProfile> = {};

  // The fixed 833-byte v105 header, verbatim for lossless round-tripping.
  if (legacy) result.legacyVersion = 99;
  else result.rawHeader = bytes(0, 833);
  result.name = p.name;
  result.class = GameData.classes[p.classId] || `unknown_${p.classId}`;
  if (p.merc) {
    const [mercName, mercType, mercXP] = p.merc;
    result.mercName = mercName;
    result.merc = mercType.toString();
    const mercData = (gd.hireling[result.merc] as unknown as Array<{ level: number; explvl: number }>)?.[0];
    if (mercData) {
      let L = mercData.level;
      const M = mercData.explvl;
      while (L < 98 && M * (L + 1) * (L + 1) * (L + 2) <= mercXP) {
        L += 1;
      }
      result.mercLevel = L;
    }
  }
  result.quests = p.quests.map(q => ({
    denofevil: q[0],
    radamentslair: q[1],
    thegoldenbird: q[2],
    lamessenstome: q[3],
    thefallenangel: q[4],
    prisonofice: q[5],
  }));

  const charStats = p.attributes;
  const classStats = gd.charStats[result.class] as Record<string, unknown> | undefined;
  result.stats = {
    str: charStats.strength - ((classStats?.str as number) || 0),
    dex: charStats.dexterity - ((classStats?.dex as number) || 0),
    int: charStats.energy - ((classStats?.int as number) || 0),
    vit: charStats.vitality - ((classStats?.vit as number) || 0),
  };
  result.level = charStats.level;
  result.gold = charStats.gold ?? 0;
  result.goldStash = charStats.goldbank ?? 0;
  result.attributes = charStats;
  result.skills = p.skills;

  result.items = {};
  result.inventory = [];
  result.cube = [];
  result.stash = [];
  result.belt = [];
  const places = [result.items, result.inventory, result.cube, result.stash, result.belt];
  for (const [place, slot, id] of p.slots) {
    if (place === 0) result.items[bodyMap[slot]!] = id;
    else if (place < 5) (places[place] as (number | string)[])[slot] = id;
  }
  if (p.corpse) result.rawCorpse = bytes(...p.corpse);
  if (p.mercSection) {
    result.mercItems = {};
    for (const [place, slot, id] of p.slots) {
      if (place === 5) result.mercItems[bodyMap[slot]!] = id;
    }
  }
  if (p.ironGolem !== null) result.ironGolem = p.ironGolem;
  if (p.golem) result.rawGolem = bytes(...p.golem);
  if (p.extra !== null) result.extraSections = bytes(p.extra);
  if (p.bindDemon) result.bindDemon = p.bindDemon;

  const coverage = doc.coverage;
  return {
    profile: result as D2SCharacterProfile,
    items: dictOf(items, doc.traces),
    warnings: doc.warnings,
    lists: doc.lists,
    demons: doc.demons,
    coverage: { ...coverage, items: entriesOf(coverage.items, items, doc.traces) },
  };
}
