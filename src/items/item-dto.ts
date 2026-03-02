/**
 * Item DTO — converts internal ParsedItem to a portable trade DTO.
 *
 * TradeItemDTO is the format sent to the backend for the trade system.
 */

import type { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
import { getItemIconPath } from './item-icon.js';
import { serializeItem } from './item-serializer.js';

// ─── Types ──────────────────────────────────────────────────────

/** Quality enum for trade DTO (matches internal quality values). */
export type ItemQuality =
  | 1  // LOW
  | 2  // NORMAL
  | 3  // HIGH
  | 4  // MAGIC
  | 5  // SET
  | 6  // RARE
  | 7  // UNIQUE
  | 8  // CRAFTED
  | 9; // RUNEWORD

/** Trade item DTO — portable representation for the backend. */
export interface TradeItemDTO {
  /** Base64 token for full item reconstruction: `d2r1:<base64>` */
  token: string;
  /** 3-character item base code. */
  baseCode: string;
  /** Human-readable display name. */
  displayName: string;
  /** Item quality (1-9). */
  quality: ItemQuality;
  /** Item level. */
  ilvl: number;
  /** Is ethereal? */
  ethereal: boolean;
  /** Number of sockets (total, including filled). */
  sockets: number;
  /** Unique/set/runeword identifier. */
  uniqueId?: string;
  /** Width in grid cells. */
  width: number;
  /** Height in grid cells. */
  height: number;
  /** HD icon path key (for hditemlib.json lookup). */
  iconPath: string | null;
  /** Key stats for search/filtering. */
  stats: Record<string, number>;
  /** Socketed sub-items (runes/gems). */
  socketedItems: TradeItemDTO[];
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Convert a parsed item to a TradeItemDTO.
 *
 * @param item      The parsed item.
 * @param allItems  All items dict (for socketed sub-item lookup and serialization).
 * @param gd        GameData instance.
 */
export function toTradeDTO(
  item: BinaryParsedItem,
  allItems: Record<number | string, BinaryParsedItem>,
  gd: GameData,
): TradeItemDTO {
  const baseEntry = gd.items[item.base];
  const base = baseEntry ? baseEntry as unknown as Record<string, unknown> : undefined;
  const { w, h } = getItemSize(base);

  // Resolve display name
  const displayName = resolveDisplayName(item, gd);

  // Build socketed sub-DTOs
  const socketedDTOs: TradeItemDTO[] = [];
  if (item.socketedItems) {
    for (const sid of item.socketedItems) {
      const sockItem = allItems[sid];
      if (sockItem) {
        socketedDTOs.push(toTradeDTO(sockItem, allItems, gd));
      }
    }
  }

  // Serialize token
  const token = serializeItem(item, allItems, gd);

  return {
    token,
    baseCode: item.base,
    displayName,
    quality: item.quality as ItemQuality,
    ilvl: item.ilvl,
    ethereal: item.ethereal,
    sockets: item.sockets,
    uniqueId: item.unique,
    width: w,
    height: h,
    iconPath: getItemIconPath(item, gd),
    stats: { ...item.stats } as Record<string, number>,
    socketedItems: socketedDTOs,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

/** Get item dimensions from base data. */
function getItemSize(base: Record<string, unknown> | undefined): { w: number; h: number } {
  const w = (base?.invwidth as number) || 1;
  const h = (base?.invheight as number) || 1;
  return { w, h };
}

/** Resolve human-readable display name. */
function resolveDisplayName(item: BinaryParsedItem, gd: GameData): string {
  // If item has an explicit name (rare/crafted)
  if (item.name) return item.name;

  // Unique/set/runeword items: look up in GameData
  if (item.unique) {
    const name = lookupName(item.unique, gd);
    if (name) return name;
  }

  // Fall back to base item name from locale
  const baseEntry = gd.items[item.base];
  const base = baseEntry ? baseEntry as unknown as Record<string, unknown> : undefined;
  const namestr = base?.namestr as string | undefined;
  if (namestr) {
    const localized = gd.locale.strings[namestr];
    if (localized) return localized;
    return namestr;
  }

  return item.base;
}

/** Look up an item name from the locale by its unique/set/runeword key. */
function lookupName(key: string, gd: GameData): string | null {
  // Try direct locale lookup
  const direct = gd.locale.strings[key];
  if (direct) return direct;

  // Try uniqueItems / setItems tables if available
  const tables = ['uniqueItems', 'setItems'] as const;
  for (const table of tables) {
    const dict = (gd as unknown as Record<string, Record<string, Record<string, unknown>>>)[table];
    if (dict?.[key]) {
      const nameStr = dict[key].namestr as string | undefined;
      if (nameStr) {
        const localized = gd.locale.strings[nameStr];
        if (localized) return localized;
        return nameStr;
      }
    }
  }

  return null;
}
