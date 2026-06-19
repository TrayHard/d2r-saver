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
  ironGolem?: number | string;
  /**
   * Raw bytes of the v105 "extra sections" tail (typically the 0x666c warlock
   * demon block). Preserved verbatim from the source file so the writer can
   * round-trip them unchanged.
   */
  extraSections?: number[];
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
  result.gold = charStats.gold ?? 0;
  result.goldStash = charStats.goldbank ?? 0;

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
        ctx.parseItem(ctx.nextId(), id => { result.ironGolem = typeof id === 'number' ? id : 0; });
      }
    }

    // Preserve extra sections (0x666c warlock demon data) as raw bytes,
    // and best-effort parse the bind-demon descriptor.
    if (!reader.eof()) {
      const bytePos = reader.bitpos >> 3;
      result.extraSections = Array.from(reader.buffer.subarray(bytePos));
      try {
        if (reader.read16() === 1 && reader.read16() === 0x666c) {
          const count = reader.read16();
          if (count > 0) {
            reader.read16(); // entrySize
            const idType = reader.read16(); // 1=normal monster by hcidx, 2=super unique
            const binaryId = reader.read16();
            const monId = binaryId - 1; // hcidx (1-indexed in binary)
            reader.read16(); // skip
            const monType = reader.read16(); // 8=unique, 12=champion
            reader.read16(); // skip
            reader.read8(); // diff
            reader.skip(11);
            const area = reader.read32();
            const level = reader.read32();
            reader.skip(48);
            let monClass: string | undefined;
            let demonId: string | undefined;
            let monsterType: string | undefined;
            if (idType === 2) {
              const su = gd.superUniques?.[String(monId)];
              monClass = su?.class;
              demonId = String(monId);
              monsterType = 'super';
            } else if (idType === 1) {
              const entry = Object.entries(gd.monsters).find(
                ([, v]) => (v as { hcidx?: number })?.hcidx === monId,
              );
              monClass = entry?.[0];
              demonId = monClass;
              monsterType = monType === 12 ? 'champion' : 'unique';
            }
            if (monClass && demonId && monsterType) {
              result.bindDemon = {
                revive: 'bind',
                id: demonId,
                monsterType,
                monster: monClass,
                area,
                level,
                unit: `bind_${monClass}`,
                group: 'binddemon',
                minion: monType !== 16,
                skill: '382',
              };
              const presetMods = idType === 2
                ? [
                  (gd.uniqueMods?.[(gd.superUniques?.[String(monId)] as { mod1?: string })?.mod1 ?? ''] as { uniquemod?: string } | undefined)?.uniquemod,
                  (gd.uniqueMods?.[(gd.superUniques?.[String(monId)] as { mod2?: string })?.mod2 ?? ''] as { uniquemod?: string } | undefined)?.uniquemod,
                  (gd.uniqueMods?.[(gd.superUniques?.[String(monId)] as { mod3?: string })?.mod3 ?? ''] as { uniquemod?: string } | undefined)?.uniquemod,
                ].filter(Boolean)
                : [];
              const allMods = new Set<string>();
              for (let m = 0; m < 8; m++) {
                const um = (gd.uniqueMods?.[String(reader.read8())] as { uniquemod?: string } | undefined)?.uniquemod;
                if (um) allMods.add(um);
              }
              const demonMods = [...allMods].filter(m => !presetMods.includes(m));
              if (demonMods.length) result.bindDemon.mods = demonMods;
            }
          }
        }
      } catch {
        // best-effort; non-critical
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
