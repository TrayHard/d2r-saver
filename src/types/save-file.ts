/**
 * Types for D2S (character) and D2I (shared stash) file structures.
 */

import type { LocatedItem } from './item.js';
import type { CharacterClass } from './constants.js';

// ─── Character info ─────────────────────────────────────────────

export interface CharacterStats {
  str: number;
  dex: number;
  int: number;
  vit: number;
}

export interface QuestCompletions {
  denofevil: boolean;
  radamentslair: boolean;
  thegoldenbird: boolean;
  lamessenstome: boolean;
  thefallenangel: boolean;
  prisonofice: boolean;
}

export interface CharacterInfo {
  name: string;
  class: CharacterClass;
  level: number;
  stats: CharacterStats;
  skills: Record<number, number>;
  /** Quest completions per difficulty [normal, nightmare, hell]. */
  quests: [QuestCompletions, QuestCompletions, QuestCompletions];
  /** Mercenary data. */
  mercName: number;
  merc: string;
  mercLevel: number;
}

// ─── Character status flags ─────────────────────────────────────

export interface CharacterStatus {
  hardcore: boolean;
  died: boolean;
  expansion: boolean;
  ladder: boolean;
}

// ─── Parse results ──────────────────────────────────────────────

/** Result of parsing a .d2s character file. */
export interface D2SParseResult {
  /** Character metadata. */
  character: CharacterInfo;
  /** Character status flags. */
  status: CharacterStatus;
  /** All items from the character file. */
  items: LocatedItem[];
  /** Warnings emitted during parsing. */
  warnings: string[];
}

/** Result of parsing a .d2i shared stash file. */
export interface D2IParseResult {
  /** Stash pages. */
  pages: StashPage[];
  /** All items across all pages. */
  items: LocatedItem[];
  /** Warnings emitted during parsing. */
  warnings: string[];
}

// ─── Stash page ─────────────────────────────────────────────────

export interface StashPage {
  /** Zero-based page index. */
  index: number;
  /** Page type flag (0 = normal, 1 = extended, 2 = metadata). */
  pageType: number;
  /** Gold stored on this page. */
  gold: number;
  /** Items on this page. */
  items: LocatedItem[];
}

// ─── Format detection ───────────────────────────────────────────

export type SaveFileType = 'd2s' | 'd2i';

export interface DetectedFormat {
  type: SaveFileType;
  version: number;
}
