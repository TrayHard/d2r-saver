/**
 * D2S (character save) reader — Blizzless v105 only.
 *
 * Ported from d2planner/src/logic/binary/index.js → parseCharacter().
 * Simplified: v105 only — all offsets use v105 values.
 *
 * Uses GameData instead of global Data singleton.
 */

import { BinaryReader } from '../core/binary-reader.js';
import { GameData } from '../game-data/game-data.js';
import { detectFormat } from './detect.js';
import { createItemParser, type BinaryParsedItem } from './item-parser.js';

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
  items: Record<string, number>;
  mercItems: Record<string, number>;
  inventory: (number | undefined)[];
  cube: (number | undefined)[];
  stash: (number | undefined)[];
  belt: (number | undefined)[];
  ironGolem?: number;
}

export interface D2SReadResult {
  profile: D2SCharacterProfile;
  items: Record<number, BinaryParsedItem>;
  warnings: string[];
}

// ─── Reader ─────────────────────────────────────────────────────

/**
 * Parse a .d2s character file.
 *
 * @param data Raw file bytes
 * @param gd   GameData instance
 */
export function readD2S(data: Uint8Array, gd: GameData): D2SReadResult {
  const warnings: string[] = [];
  const fmt = detectFormat(data);
  if (!fmt || fmt.type !== 'd2s') throw Error('invalid d2s header');

  const reader = new BinaryReader(data);
  reader.seek(16);

  const result: Partial<D2SCharacterProfile> = {};

  // v105: 4 zero bytes at offset 0x10
  reader.skip(4);

  // Name might be at offset 299 (v105)
  if (!result.name) {
    const savedPos = reader.bitpos;
    reader.seek(299);
    result.name = reader.utf8(16);
    reader.bitpos = savedPos;
  }

  // Class at offset 24 (v105)
  reader.seek(24);
  const classId = reader.read8();
  result.class = GameData.classes[classId] || `unknown_${classId}`;

  // Merc data at offset 163 (v105)
  reader.seek(163);
  const mercId = reader.read32();
  if (mercId) {
    result.mercName = reader.read16();
    result.merc = reader.read16().toString();
    const mercXP = reader.read32();
    const mercData = (gd.hireling[result.merc!] as unknown as Array<{ level: number; explvl: number }>)?.[0];
    if (mercData) {
      let L = mercData.level;
      const M = mercData.explvl;
      while (L < 98 && M * (L + 1) * (L + 1) * (L + 2) <= mercXP) {
        L += 1;
      }
      result.mercLevel = L;
    }
  }

  // Quests
  function readQuestTable() {
    return {
      denofevil: (reader.byte(2) & 1) !== 0,
      radamentslair: (reader.byte(18) & 1) !== 0,
      thegoldenbird: (reader.byte(40) & 1) !== 0,
      lamessenstome: (reader.byte(34) & 1) !== 0,
      thefallenangel: (reader.byte(50) & 1) !== 0,
      prisonofice: (reader.byte(74) & 1) !== 0,
    };
  }

  result.quests = [];
  reader.seek(413); // v105 quest offset normal
  result.quests.push(readQuestTable());
  reader.seek(509); // nightmare
  result.quests.push(readQuestTable());
  reader.seek(605); // hell
  result.quests.push(readQuestTable());

  // Character stats at offset 833 (v105)
  reader.seek(833);
  if (reader.read16() !== 0x6667) throw Error('invalid stats header');

  // Build stat map
  const statMap = new Map<number, string>();
  for (const key in gd.itemStatCost) {
    statMap.set(gd.itemStatCost[key].id, key);
  }

  const charStats: Record<string, number> = {};
  while (true) {
    const statId = reader.bits(9);
    if (statId === 511) break;
    const stat = statMap.get(statId);
    if (!stat) throw Error(`unknown stat code ${statId}`);
    charStats[stat] = reader.bits(gd.itemStatCost[stat].csvbits ?? 0);
  }
  reader.align();

  const classStats = gd.charStats[result.class!] as Record<string, unknown> | undefined;
  result.stats = {
    str: charStats.strength - ((classStats?.str as number) || 0),
    dex: charStats.dexterity - ((classStats?.dex as number) || 0),
    int: charStats.energy - ((classStats?.int as number) || 0),
    vit: charStats.vitality - ((classStats?.vit as number) || 0),
  };
  result.level = charStats.level;

  // Skills
  if (reader.read16() !== 0x6669) throw Error('invalid skills header');
  result.skills = {};
  const skillBases = [6, 36, 66, 96, 126, 221, 251, 373];
  const skillBase = skillBases[classId] ?? (classId < 5 ? classId * 30 + 6 : (classId - 5) * 30 + 221);
  for (let i = 0; i < 30; ++i) {
    const level = reader.read8();
    if (level) result.skills[i + skillBase] = level;
  }

  // Items
  const ctx = createItemParser(reader, gd);

  result.items = {};
  result.inventory = [];
  result.cube = [];
  result.stash = [];
  result.belt = [];

  try {
    ctx.parseItemList((id, location, slot) => {
      if (location === 'body') result.items![slot as string] = id;
      if (location === 'inventory') result.inventory![slot as number] = id;
      if (location === 'cube') result.cube![slot as number] = id;
      if (location === 'stash') result.stash![slot as number] = id;
      if (location === 'belt') result.belt![slot as number] = id;
    });

    // Corpses
    if (reader.read16() !== 0x4d4a) throw Error('invalid item table header');
    const corpses = reader.read16();
    reader.skip(corpses * 12);
    for (let i = 0; i < corpses; ++i) {
      ctx.parseItemList(() => null);
    }

    // Hireling items
    if (!reader.eof()) {
      if (reader.read16() !== 0x666a) throw Error('invalid hireling header');
      result.mercItems = {};
      if (reader.byte(0) === 0x4a && reader.byte(1) === 0x4d) {
        ctx.parseItemList((id, location, slot) => {
          if (mercId && location === 'body') result.mercItems![slot as string] = id;
        });
      }
    }

    // Iron golem
    if (!reader.eof()) {
      if (reader.read16() !== 0x666b) throw Error('invalid iron golem header');
      if (reader.read8()) {
        ctx.parseItem(ctx.nextId(), id => { result.ironGolem = id; });
      }
    }
  } catch (e) {
    const warning = `Item parsing error (some items may be missing): ${(e as Error).message}`;
    warnings.push(warning);
  }

  return {
    profile: result as D2SCharacterProfile,
    items: ctx.items,
    warnings,
  };
}
