/**
 * Types for parsed items — the internal representation of a D2R item
 * after reading from a save file.
 */

import type { ItemQuality, LocationType, StorageType, BodyLocation } from './constants.js';

// ─── Mod container ──────────────────────────────────────────────

/**
 * Mod values: stat ID → array of parameter values.
 * `values[0..4]` correspond to `mod1max..mod5max` in the data tables.
 */
export type ModContainer = Record<string, number[]>;

// ─── Item location ──────────────────────────────────────────────

/** Raw location fields as stored in the binary save data. */
export interface RawItemLocation {
  /** 3-bit location type. */
  location: LocationType;
  /** 4-bit body slot (for equipped items). */
  bodyloc: BodyLocation;
  /** 3-bit storage identifier (for stored items). */
  storage: StorageType;
  /** Column in the storage grid. */
  x: number;
  /** Row in the storage grid. */
  y: number;
}

/** Resolved item location with source context. */
export interface ItemLocation {
  /** Source file type. */
  source: 'character' | 'sharedStash';
  /** Original filename (for debugging / display). */
  sourceFile: string;
  /** Storage type the item resides in. */
  storage: StorageType;
  /** For d2i — zero-based page index. */
  page?: number;
  /** Column in the storage grid. */
  x: number;
  /** Row in the storage grid. */
  y: number;
  /** Raw binary location fields. */
  raw: RawItemLocation;
}

// ─── Ear data ───────────────────────────────────────────────────

export interface EarData {
  class: number;
  level: number;
  name: string;
}

// ─── Binary position ────────────────────────────────────────────

/** Bit offset range of an item in the original save file. */
export interface BinaryOffset {
  /** Bit offset where the item data starts. */
  start: number;
  /** Bit offset where the item data ends. */
  end: number;
}

// ─── ParsedItem ─────────────────────────────────────────────────

/**
 * Internal representation of a parsed D2R item.
 * Produced by the item parser, consumed by item writer and trade DTO converter.
 */
export interface ParsedItem {
  /** 3-character item code (e.g. "rin", "cap", "r01"). */
  base: string;

  /** Item quality. */
  quality: ItemQuality;

  /** Item level (7 bits in save). */
  ilvl: number;

  /** Whether the item is unidentified. */
  unidentified: boolean;

  /** Whether the item is ethereal. */
  ethereal: boolean;

  /** Number of sockets. */
  sockets: number;

  /** Socketed child items (gems, runes, jewels). */
  socketedItems: ParsedItem[];

  /** Computed stats from all sources (for display/search). */
  stats: Record<string, number>;

  // ─── Quality-specific ────────────────────────────

  /** ID in unique/set/runeword table (e.g. "unique001"). */
  unique?: string;

  /** Generated name for rare/crafted items. */
  name?: string;

  /** Variable range values for unique/set/runeword properties. */
  uniqueValues?: number[];

  // ─── Mod containers ──────────────────────────────

  /** Magic prefix/suffix mods. */
  mods?: ModContainer;

  /** Auto-prefix mods. */
  auto?: ModContainer;

  /** Staff (class-specific) mods. */
  staff?: ModContainer;

  /** Crafted recipe mods. */
  crafted?: ModContainer;

  /** Superior quality mods. */
  superior?: ModContainer;

  // ─── Optional fields ─────────────────────────────

  /** Base defense (armor items). */
  defense?: number;

  /** Stack quantity (stackable items, potions, etc.). */
  quantity?: number;

  /** Ear item data. */
  ear?: EarData;

  /** Personalized inscription name. */
  personalized?: string;

  /** Alternate graphics index (3 bits). */
  iconIndex?: number;

  /** Whether this item was "custom" parsed (stats didn't match known definitions). */
  custom?: boolean;

  // ─── Binary metadata ─────────────────────────────

  /** Internal 32-bit item ID from the save file. */
  itemId: number;

  /** Bit offsets in the original binary buffer. */
  binaryOffset: BinaryOffset;
}

// ─── LocatedItem ────────────────────────────────────────────────

/** A parsed item together with its location in the save file. */
export interface LocatedItem {
  item: ParsedItem;
  location: ItemLocation;
}
