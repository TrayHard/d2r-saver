/**
 * Item icon path resolution — determines the HD icon key for an item.
 *
 * Ported from d2planner/src/logic/item.js → itemGetIconHD().
 */

import type { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';

// ─── Public API ─────────────────────────────────────────────────

/**
 * Get the HD icon path key for an item.
 *
 * Returns the icon identifier used in hditemlib.json for HD rendering.
 * The result can be passed to the frontend for icon display.
 *
 * @param item  The parsed item.
 * @param gd    GameData instance.
 * @returns Icon path string, or `null` if no icon is available.
 */
export function getItemIconPath(
  item: BinaryParsedItem,
  gd: GameData,
): string | null {
  const baseEntry = gd.items[item.base];
  if (!baseEntry) return null;
  const base = baseEntry as unknown as Record<string, unknown>;

  let icon = base.hd as string | undefined;
  if (!icon) return null;

  // Unique/set items may have specific HD icons
  if (item.quality === 7 || item.quality === 5) {
    // quality 7 = UNIQUE, 5 = SET
    const specialItem = item.unique
      ? (gd.uniqueItems[item.unique] as unknown as Record<string, unknown> | undefined)
        ?? (gd.setItems[item.unique] as unknown as Record<string, unknown> | undefined)
      : undefined;

    const specialHd = specialItem?.hd as string[] | undefined;
    if (specialHd?.length) {
      const normcode = base.normcode as string | undefined;
      const ubercode = base.ubercode as string | undefined;
      const ultracode = base.ultracode as string | undefined;

      if (!normcode || normcode === item.base) {
        icon = specialHd[0];
      } else if (ubercode === item.base) {
        icon = specialHd[1] ?? specialHd[0];
      } else if (ultracode === item.base) {
        icon = specialHd[2] ?? specialHd[0];
      } else {
        icon = specialHd[0];
      }
    }
  }

  if (!icon) return null;

  // Variable inventory graphics (armor/weapons with multiple visual variants)
  const baseType = base.type as string | undefined;
  if (baseType) {
    const typeData = gd.itemTypes[baseType] as unknown as Record<string, unknown> | undefined;
    if (typeData?.varinvgfx && icon === (base.hd as string)) {
      const varCount = typeData.varinvgfx as number;
      const index = ((item.iconIndex || 0) % varCount) + 1;
      icon = icon + index;
    }
  }

  return icon;
}

/**
 * Get the inventory file icon name for an item (SD, non-HD).
 *
 * @param item  The parsed item.
 * @param gd    GameData instance.
 * @returns Icon name string, or `null` if not found.
 */
export function getItemIconSD(
  item: BinaryParsedItem,
  gd: GameData,
): string | null {
  const baseEntry2 = gd.items[item.base];
  if (!baseEntry2) return null;
  const base = baseEntry2 as unknown as Record<string, unknown>;

  let icon = base.invfile as string | undefined;
  if (!icon) return null;

  // Variable inventory graphics
  const baseType = base.type as string | undefined;
  if (baseType) {
    const typeData = gd.itemTypes[baseType] as unknown as Record<string, unknown> | undefined;
    if (typeData?.varinvgfx) {
      const varCount = typeData.varinvgfx as number;
      const index = ((item.iconIndex || 0) % varCount) + 1;
      const varIcon = typeData[`invgfx${index}`] as string | undefined;
      if (varIcon) icon = varIcon;
    }
  }

  // Unique/set overrides
  if (item.quality === 7) {
    const uniq = item.unique ? (gd.uniqueItems[item.unique] as unknown as Record<string, unknown> | undefined) : undefined;
    icon = (uniq?.invfile as string) || (base.uniqueinvfile as string) || icon;
  } else if (item.quality === 5) {
    const setItem = item.unique ? (gd.setItems[item.unique] as unknown as Record<string, unknown> | undefined) : undefined;
    icon = (setItem?.invfile as string) || (base.setinvfile as string) || icon;
  }

  return icon || null;
}
