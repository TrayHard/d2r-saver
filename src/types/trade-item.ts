/**
 * Trade DTO — the shape sent from d2r-saver to the trade backend.
 */

import type { ItemQuality } from './constants.js';

/**
 * Data Transfer Object for an item in the trading system.
 * Contains everything the backend/frontend needs to display and filter items.
 */
export interface TradeItemDTO {
  /** Base64 portability token for full item reconstruction. */
  token: string;

  /** 3-character base item code. */
  baseCode: string;

  /** Human-readable item name. */
  displayName: string;

  /** Item quality. */
  quality: ItemQuality;

  /** Item level. */
  ilvl: number;

  /** Ethereal flag. */
  ethereal: boolean;

  /** Number of sockets. */
  sockets: number;

  /** Unique/set/runeword ID (if applicable). */
  uniqueId?: string;

  /** Width in grid cells. */
  width: number;

  /** Height in grid cells. */
  height: number;

  /** Icon path/key for HD icon lookup in hditemlib. */
  iconPath: string;

  /** Key stats for search/filtering. */
  stats: Record<string, number>;

  /** Nested socketed items. */
  socketedItems: TradeItemDTO[];
}
