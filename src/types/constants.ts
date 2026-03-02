/**
 * Enums & constants for Blizzless D2R v105 save format.
 */

// ─── Item Quality ───────────────────────────────────────────────

export enum ItemQuality {
  LOW = 1,
  NORMAL = 2,
  SUPERIOR = 3,
  MAGIC = 4,
  SET = 5,
  RARE = 6,
  UNIQUE = 7,
  CRAFTED = 8,
}

// ─── Location / Storage ─────────────────────────────────────────

/** Where the item is in the save file (3-bit location field). */
export enum LocationType {
  /** Stored in a location grid (inventory, cube, stash). */
  STORED = 0,
  /** Equipped on body. */
  EQUIPPED = 1,
  /** In belt. */
  BELT = 2,
  /** Socketed inside another item. */
  SOCKETED = 6,
}

/** Storage grid identifier (3-bit field for STORED items). */
export enum StorageType {
  NONE = 0,
  INVENTORY = 1,
  CUBE = 4,
  STASH = 5,
}

/** Body slot index for equipped items (4-bit bodyloc field). */
export enum BodyLocation {
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
  GLOVES = 10,
}

// ─── File format ────────────────────────────────────────────────

/** D2S magic signature. */
export const D2S_MAGIC = 0xaa55aa55;
/** D2I (stash) magic signature. */
export const D2I_MAGIC = 0x00535344; // "DST\0" in LE

/** Only supported version. */
export const BLIZZLESS_VERSION = 105;

// ─── Grid dimensions (Blizzless) ────────────────────────────────

export const STASH_WIDTH = 16;
export const STASH_HEIGHT = 13;
export const INVENTORY_WIDTH = 10;
export const INVENTORY_HEIGHT = 4;
export const CUBE_WIDTH = 3;
export const CUBE_HEIGHT = 4;

// ─── D2S section markers (v105 — no "JM" per-item headers) ─────

/** Section marker in d2s: item list section. */
export const SECTION_ITEMS = 0x4a4d; // "JM"
/** Section marker in d2s: character stats. */
export const SECTION_STATS = 0x6766; // "gf"
/** Section marker in d2s: extended section (v105). */
export const SECTION_EXTENDED = 0x666c; // "fl"

// ─── Portability token prefix ───────────────────────────────────

/** Prefix for serialized item tokens. */
export const TOKEN_PREFIX = 'd2r1:';

// ─── Character classes ──────────────────────────────────────────

export enum CharacterClass {
  AMAZON = 0,
  SORCERESS = 1,
  NECROMANCER = 2,
  PALADIN = 3,
  BARBARIAN = 4,
  DRUID = 5,
  ASSASSIN = 6,
}

export const CLASS_NAMES: Readonly<Record<CharacterClass, string>> = {
  [CharacterClass.AMAZON]: 'Amazon',
  [CharacterClass.SORCERESS]: 'Sorceress',
  [CharacterClass.NECROMANCER]: 'Necromancer',
  [CharacterClass.PALADIN]: 'Paladin',
  [CharacterClass.BARBARIAN]: 'Barbarian',
  [CharacterClass.DRUID]: 'Druid',
  [CharacterClass.ASSASSIN]: 'Assassin',
};
