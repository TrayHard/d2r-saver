/**
 * GameData — central registry of processed game data tables.
 *
 * Replaces the d2planner `Data` singleton. Instead of a global,
 * GameData instances are created once and passed to all consumers.
 *
 * Ported from: d2planner/src/data/index.js + d2planner/src/data/load.js (processData).
 * Simplified: Blizzless v105 only — no version filtering, no browser/UI code.
 */
import type { RawGameData, ItemEntry, ArmorEntry, WeaponEntry, MiscEntry, ItemStatCostEntry, ItemTypeEntry, UniqueItemEntry, SetItemEntry, SetEntry, RunewordEntry, MagicAffixEntry, GemEntry, SkillEntry, PropertyEntry, StateEntry, MonsterEntry, MissileEntry, HirelingEntry, CharStatEntry, RareAffixEntry, QualityItemEntry, GameInfo } from './types.js';
import { type LocaleArray } from './loader.js';
export interface LocaleStore {
    strings: Record<string, string>;
    istrings: string[];
    stringi: Record<string, number>;
}
export declare class GameData {
    armor: Record<string, ArmorEntry>;
    weapons: Record<string, WeaponEntry>;
    misc: Record<string, MiscEntry>;
    itemStatCost: Record<string, ItemStatCostEntry>;
    itemTypes: Record<string, ItemTypeEntry>;
    uniqueItems: Record<string, UniqueItemEntry>;
    setItems: Record<string, SetItemEntry>;
    sets: Record<string, SetEntry>;
    runes: Record<string, RunewordEntry>;
    magicPrefix: Record<string, MagicAffixEntry>;
    magicSuffix: Record<string, MagicAffixEntry>;
    autoMagic: Record<string, MagicAffixEntry>;
    crafted: Record<string, MagicAffixEntry>;
    qualityItems: Record<string, QualityItemEntry>;
    gems: Record<string, GemEntry>;
    skills: Record<string, SkillEntry>;
    properties: Record<string, PropertyEntry>;
    states: Record<string, StateEntry>;
    monsters: Record<string, MonsterEntry>;
    missiles: Record<string, MissileEntry>;
    hireling: Record<string, HirelingEntry>;
    charStats: Record<string, CharStatEntry>;
    rarePrefix: Record<string, RareAffixEntry>;
    rareSuffix: Record<string, RareAffixEntry>;
    info: GameInfo;
    strings: Record<string, string>;
    /** Merged map: armor + misc + weapons. */
    items: Record<string, ItemEntry>;
    /** Merged map: autoMagic + magicPrefix + magicSuffix + crafted + qualityItems + staffMods. */
    mods: Record<string, MagicAffixEntry>;
    /** Generated staff mod affix definitions. */
    staffMods: Record<string, MagicAffixEntry>;
    /** skill.skill.toLowerCase() → SkillEntry */
    skillByName: Record<string, SkillEntry>;
    /** state.state.toLowerCase() → StateEntry */
    stateByName: Record<string, StateEntry>;
    /** missile.missile.toLowerCase() → MissileEntry */
    missileByName: Record<string, MissileEntry>;
    /** monster.hcidx → MonsterEntry */
    monsterById: MonsterEntry[];
    /** Locale lookup tables. */
    locale: LocaleStore;
    static readonly classes: readonly ["ama", "sor", "nec", "pal", "bar", "dru", "ass", "war"];
    static readonly classNames: Record<string, string>;
    static readonly strClassSkillsStat: string[];
    static readonly strClassOnly: string[];
    static readonly strSkilltabStat: string[];
    private constructor();
    /**
     * Create GameData by loading from file system.
     */
    static fromFile(dataPath: string, stringsPath: string): Promise<GameData>;
    /**
     * Create GameData from pre-parsed JSON objects.
     */
    static fromRaw(rawData: RawGameData, locale: LocaleArray): GameData;
    /**
     * Internal: create and process from loaded data.
     */
    private static fromLoaded;
    private processData;
    private reorderStatPriorities;
    private generateStaffMods;
    private fixupMods;
    private buildLookupMaps;
}
//# sourceMappingURL=game-data.d.ts.map