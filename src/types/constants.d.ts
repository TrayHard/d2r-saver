/**
 * Enums & constants for Blizzless D2R v105 save format.
 */
export declare enum ItemQuality {
    LOW = 1,
    NORMAL = 2,
    SUPERIOR = 3,
    MAGIC = 4,
    SET = 5,
    RARE = 6,
    UNIQUE = 7,
    CRAFTED = 8
}
/** Where the item is in the save file (3-bit location field). */
export declare enum LocationType {
    /** Stored in a location grid (inventory, cube, stash). */
    STORED = 0,
    /** Equipped on body. */
    EQUIPPED = 1,
    /** In belt. */
    BELT = 2,
    /** Socketed inside another item. */
    SOCKETED = 6
}
/** Storage grid identifier (3-bit field for STORED items). */
export declare enum StorageType {
    NONE = 0,
    INVENTORY = 1,
    CUBE = 4,
    STASH = 5
}
/** Body slot index for equipped items (4-bit bodyloc field). */
export declare enum BodyLocation {
    NONE = 0,
    HEAD = 1,
    NECK = 2,
    TORSO = 3,
    RIGHT_HAND = 4,
    LEFT_HAND = 5,
    RIGHT_RING = 6,
    LEFT_RING = 7,
    WAIST = 8,
    FEET = 9,
    GLOVES = 10
}
/** D2S magic signature. */
export declare const D2S_MAGIC = 2857740885;
/** D2I (stash) magic signature. */
export declare const D2I_MAGIC = 5460804;
/** Only supported version. */
export declare const BLIZZLESS_VERSION = 105;
export declare const STASH_WIDTH = 16;
export declare const STASH_HEIGHT = 13;
export declare const INVENTORY_WIDTH = 10;
export declare const INVENTORY_HEIGHT = 4;
export declare const CUBE_WIDTH = 3;
export declare const CUBE_HEIGHT = 4;
/** Section marker in d2s: item list section. */
export declare const SECTION_ITEMS = 19021;
/** Section marker in d2s: character stats. */
export declare const SECTION_STATS = 26470;
/** Section marker in d2s: extended section (v105). */
export declare const SECTION_EXTENDED = 26220;
/** Prefix for serialized item tokens. */
export declare const TOKEN_PREFIX = "d2r1:";
export declare enum CharacterClass {
    AMAZON = 0,
    SORCERESS = 1,
    NECROMANCER = 2,
    PALADIN = 3,
    BARBARIAN = 4,
    DRUID = 5,
    ASSASSIN = 6
}
export declare const CLASS_NAMES: Readonly<Record<CharacterClass, string>>;
//# sourceMappingURL=constants.d.ts.map