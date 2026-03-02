/**
 * GameData — central registry of processed game data tables.
 *
 * Replaces the d2planner `Data` singleton. Instead of a global,
 * GameData instances are created once and passed to all consumers.
 *
 * Ported from: d2planner/src/data/index.js + d2planner/src/data/load.js (processData).
 * Simplified: Blizzless v105 only — no version filtering, no browser/UI code.
 */

import type {
  RawGameData,
  ItemEntry,
  ArmorEntry,
  WeaponEntry,
  MiscEntry,
  ItemStatCostEntry,
  ItemTypeEntry,
  UniqueItemEntry,
  SetItemEntry,
  SetEntry,
  RunewordEntry,
  MagicAffixEntry,
  GemEntry,
  SkillEntry,
  PropertyEntry,
  StateEntry,
  MonsterEntry,
  MissileEntry,
  HirelingEntry,
  CharStatEntry,
  RareAffixEntry,
  QualityItemEntry,
  GameInfo,
} from './types.js';
import { loadDataFromFile, type LocaleArray, type LoadedData } from './loader.js';

// ─── Locale store (module-level, shared) ────────────────────────

export interface LocaleStore {
  strings: Record<string, string>;
  istrings: string[];
  stringi: Record<string, number>;
}

// ─── GameData class ─────────────────────────────────────────────

export class GameData {
  // ── Raw tables (from data.json, post-process) ───────────────

  armor!: Record<string, ArmorEntry>;
  weapons!: Record<string, WeaponEntry>;
  misc!: Record<string, MiscEntry>;
  itemStatCost!: Record<string, ItemStatCostEntry>;
  itemTypes!: Record<string, ItemTypeEntry>;
  uniqueItems!: Record<string, UniqueItemEntry>;
  setItems!: Record<string, SetItemEntry>;
  sets!: Record<string, SetEntry>;
  runes!: Record<string, RunewordEntry>;
  magicPrefix!: Record<string, MagicAffixEntry>;
  magicSuffix!: Record<string, MagicAffixEntry>;
  autoMagic!: Record<string, MagicAffixEntry>;
  crafted!: Record<string, MagicAffixEntry>;
  qualityItems!: Record<string, QualityItemEntry>;
  gems!: Record<string, GemEntry>;
  skills!: Record<string, SkillEntry>;
  properties!: Record<string, PropertyEntry>;
  states!: Record<string, StateEntry>;
  monsters!: Record<string, MonsterEntry>;
  missiles!: Record<string, MissileEntry>;
  hireling!: Record<string, HirelingEntry>;
  charStats!: Record<string, CharStatEntry>;
  rarePrefix!: Record<string, RareAffixEntry>;
  rareSuffix!: Record<string, RareAffixEntry>;
  info!: GameInfo;
  strings!: Record<string, string>;

  // ── Derived / computed ──────────────────────────────────────

  /** Merged map: armor + misc + weapons. */
  items!: Record<string, ItemEntry>;
  /** Merged map: autoMagic + magicPrefix + magicSuffix + crafted + qualityItems + staffMods. */
  mods!: Record<string, MagicAffixEntry>;
  /** Generated staff mod affix definitions. */
  staffMods!: Record<string, MagicAffixEntry>;

  /** skill.skill.toLowerCase() → SkillEntry */
  skillByName!: Record<string, SkillEntry>;
  /** state.state.toLowerCase() → StateEntry */
  stateByName!: Record<string, StateEntry>;
  /** missile.missile.toLowerCase() → MissileEntry */
  missileByName!: Record<string, MissileEntry>;
  /** monster.hcidx → MonsterEntry */
  monsterById!: MonsterEntry[];

  /** Locale lookup tables. */
  locale!: LocaleStore;

  // ── Static class metadata ───────────────────────────────────

  static readonly classes = ['ama', 'sor', 'nec', 'pal', 'bar', 'dru', 'ass', 'war'] as const;

  static readonly classNames: Record<string, string> = {
    ama: 'Amazon',
    sor: 'Sorceress',
    nec: 'Necromancer',
    pal: 'Paladin',
    bar: 'Barbarian',
    dru: 'Druid',
    ass: 'Assassin',
    war: 'Warlock',
  };

  static readonly strClassSkillsStat = [
    'ModStr3a', 'ModStr3d', 'ModStr3c', 'ModStr3b', 'ModStr3e',
    'ModStre8a', 'ModStre8b', 'ModStrge9',
  ];

  static readonly strClassOnly = [
    'AmaOnly', 'SorOnly', 'NecOnly', 'PalOnly',
    'BarOnly', 'DruOnly', 'AssOnly', 'WarOnly',
  ];

  static readonly strSkilltabStat = [
    'StrSklTabItem3', 'StrSklTabItem2', 'StrSklTabItem1',
    'StrSklTabItem15', 'StrSklTabItem14', 'StrSklTabItem13',
    'StrSklTabItem8', 'StrSklTabItem7', 'StrSklTabItem9',
    'StrSklTabItem6', 'StrSklTabItem5', 'StrSklTabItem4',
    'StrSklTabItem11', 'StrSklTabItem12', 'StrSklTabItem10',
    'StrSklTabItem16', 'StrSklTabItem17', 'StrSklTabItem18',
    'StrSklTabItem19', 'StrSklTabItem20', 'StrSklTabItem21',
    'StrSklTabItem24', 'StrSklTabItem22', 'StrSklTabItem23',
  ];

  // ── Construction ────────────────────────────────────────────

  private constructor() {}

  /**
   * Create GameData by loading from file system.
   */
  static async fromFile(dataPath: string, stringsPath: string): Promise<GameData> {
    const loaded = await loadDataFromFile(dataPath, stringsPath);
    return GameData.fromLoaded(loaded);
  }

  /**
   * Create GameData from pre-parsed JSON objects.
   */
  static fromRaw(rawData: RawGameData, locale: LocaleArray): GameData {
    return GameData.fromLoaded({ rawData, locale });
  }

  /**
   * Internal: create and process from loaded data.
   */
  private static fromLoaded(loaded: LoadedData): GameData {
    const gd = new GameData();
    gd.processData(loaded.rawData, loaded.locale);
    return gd;
  }

  // ── processData ─────────────────────────────────────────────

  private processData(rawData: RawGameData, locale: LocaleArray): void {
    // 1. Merge all raw tables onto this instance
    Object.assign(this, rawData);

    // 2. Stash defaults
    if (!this.info.stash) {
      this.info.stash = { rows: 13, columns: 16 }; // Blizzless dimensions
    }

    // 3. Locale setup
    this.locale = { strings: {}, istrings: [], stringi: {} };
    for (let index = 0; index < locale.length; ++index) {
      const entry = locale[index];
      if (entry) {
        this.locale.istrings[index] = entry[1];
        this.locale.strings[entry[0]] = entry[1];
        this.locale.stringi[entry[0]] = index;
      }
    }

    // 4. itemStatCost priority reorder
    this.reorderStatPriorities();

    // 5. Generate staff mods
    this.generateStaffMods();

    // 6. Version filtering — SKIPPED for Blizzless v105 (always latest)
    // (no GameVersion < 100 branch, no version filtering)

    // 7. Magic prefix/suffix filter (keep version > 0, Blizzless GameVersion = 100)
    this.magicPrefix = filterRows(this.magicPrefix, row => row.version > 0 && row.version <= 100);
    this.magicSuffix = filterRows(this.magicSuffix, row => row.version > 0 && row.version <= 100);

    // 8. Hireling filter (Blizzless uses version 100)
    for (const id in this.hireling) {
      const hirelings = this.hireling[id];
      if (Array.isArray(hirelings)) {
        (this.hireling as Record<string, unknown>)[id] =
          (hirelings as Array<{ version?: number }>).filter(row => row.version === 100);
      }
    }

    // 9. Merged items dict
    this.items = { ...this.armor, ...this.misc, ...this.weapons };

    // 10. Merged mods dict
    this.mods = {
      ...this.autoMagic,
      ...this.magicPrefix,
      ...this.magicSuffix,
      ...this.crafted,
      ...this.qualityItems as Record<string, MagicAffixEntry>,
      ...this.staffMods,
    };

    // 11. Mod fixups
    this.fixupMods();

    // 12. Lookup maps
    this.buildLookupMaps();

    // 13. itemStatCost overrides
    if (this.itemStatCost.item_extra_stack) {
      this.itemStatCost.item_extra_stack.descfunc = 1;
      this.itemStatCost.item_extra_stack.descval = 2;
    }
    if (this.itemStatCost.item_replenish_quantity) {
      this.itemStatCost.item_replenish_quantity.descfunc = 99;
    }

    // 14. Locale patch
    if (this.locale.strings.ModStre9vx) {
      this.locale.strings.ModStre9vx = `${this.locale.strings.ModStre9vx} [1 in %d sec.]`;
    }
  }

  // ── Processing helpers ──────────────────────────────────────

  private reorderStatPriorities(): void {
    const statList: [string, number][] = [];
    for (const id in this.itemStatCost) {
      const stat = this.itemStatCost[id];
      let priority = (stat.descpriority || 0) + stat.id * 0.001;
      if (id === 'item_magicbonus' || id === 'passive_cold_mastery' || id === 'passive_pois_mastery') {
        priority += 0.1;
      } else if (id === 'item_preventheal' || id === 'item_replenish_durability') {
        priority -= 0.1;
      }
      statList.push([id, priority]);
    }
    statList.sort((a, b) => a[1] - b[1]);
    statList.forEach(([id], i) => { this.itemStatCost[id].descpriority = i; });
  }

  private generateStaffMods(): void {
    this.staffMods = {};
    const staffILvl: Record<number, number> = { 1: 1, 6: 1, 12: 12, 18: 19, 24: 25, 30: 37 };

    for (const id in this.skills) {
      const skill = this.skills[id];
      if (!skill.charclass || !staffILvl[skill.reqlevel ?? 0]) continue;

      const mod: MagicAffixEntry = {
        name: `staff${id}`,
        version: skill.reqlevel === 30 ? 100 : 1,
        rare: 1,
        level: staffILvl[skill.reqlevel!],
        levelreq: skill.reqlevel!,
        classspecific: skill.charclass,
        group: 600 + parseInt(id),
        multiply: (skill as Record<string, unknown>).costmult as number | undefined,
        add: (skill as Record<string, unknown>).costadd as number | undefined,
        mod1code: 'skill',
        mod1param: parseInt(id),
        mod1min: 1,
        mod1max: 3,
      };

      let itypes = 0;
      for (const typeId in this.itemTypes) {
        if (this.itemTypes[typeId].staffmods === skill.charclass) {
          (mod as Record<string, unknown>)[`itype${++itypes}`] = typeId;
        }
      }

      this.staffMods[`staff${id}`] = mod;
    }
  }

  private fixupMods(): void {
    // Normalize sock/rep-quant mods
    for (const mod of Object.values(this.mods)) {
      if ((mod.mod1code === 'sock' || mod.mod1code === 'rep-quant') && mod.mod1param && !mod.mod1min && !mod.mod1max) {
        mod.mod1min = mod.mod1param;
        mod.mod1max = mod.mod1param;
        delete mod.mod1param;
      }
    }

    // Fix dmg-ac min/max inversion
    for (const row of Object.values(this.mods)) {
      for (let i = 1; i <= 5; i++) fixmod(row, `mod${i}code`, `mod${i}min`, `mod${i}max`);
    }
    for (const row of Object.values(this.uniqueItems)) {
      for (let i = 1; i <= 12; i++) fixmod(row, `prop${i}`, `min${i}`, `max${i}`);
    }
    for (const row of Object.values(this.setItems)) {
      for (let i = 1; i <= 9; i++) fixmod(row, `prop${i}`, `min${i}`, `max${i}`);
      for (let i = 1; i <= 5; i++) {
        fixmod(row, `aprop${i}a`, `amin${i}a`, `amax${i}a`);
        fixmod(row, `aprop${i}b`, `amin${i}b`, `amax${i}b`);
      }
    }
    for (const row of Object.values(this.sets)) {
      for (let i = 2; i <= 5; i++) {
        fixmod(row, `pcode${i}a`, `pmin${i}a`, `pmax${i}a`);
        fixmod(row, `pcode${i}b`, `pmin${i}b`, `pmax${i}b`);
      }
      for (let i = 1; i <= 8; i++) fixmod(row, `fcode${i}`, `fmin${i}`, `fmax${i}`);
    }
  }

  private buildLookupMaps(): void {
    this.skillByName = {};
    for (const skill of Object.values(this.skills)) {
      this.skillByName[skill.skill.toLowerCase()] = skill;
    }

    this.stateByName = {};
    for (const state of Object.values(this.states)) {
      this.stateByName[state.state.toLowerCase()] = state;
    }

    this.missileByName = {};
    for (const missile of Object.values(this.missiles)) {
      const m = missile as Record<string, unknown>;
      if (m.srcdamage) {
        m.srcdam = m.srcdamage;
        delete m.srcdamage;
      }
      this.missileByName[missile.missile.toLowerCase()] = missile;
    }

    this.monsterById = [];
    for (const monster of Object.values(this.monsters)) {
      this.monsterById[monster.hcidx] = monster;
      const m = monster as Record<string, unknown>;
      if ((rawData => rawData)((this as unknown as { monstersEx?: Record<string, MonsterEntry> }).monstersEx)) {
        const monstersEx = (this as unknown as { monstersEx: Record<string, MonsterEntry> }).monstersEx;
        if (m.monstatsex && monstersEx[m.monstatsex as string]) {
          Object.assign(monster, monstersEx[m.monstatsex as string]);
        }
      }
    }
  }
}

// ─── Utility functions ──────────────────────────────────────────

function filterRows<T>(table: Record<string, T>, fn: (row: T) => boolean): Record<string, T> {
  const result: Record<string, T> = {};
  for (const id in table) {
    if (fn(table[id])) result[id] = table[id];
  }
  return result;
}

function fixmod(row: Record<string, unknown>, prop: string, min: string, max: string): void {
  if (row[prop] === 'sock') (row as Record<string, unknown>).sockets = true;
  if (row[prop] === 'dmg-ac' && (row[min] as number) > (row[max] as number)) {
    const tmp = row[min];
    row[min] = row[max];
    row[max] = tmp;
  }
}
