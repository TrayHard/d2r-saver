/**
 * Placement logic — inventory/stash item placement helpers.
 *
 * Ported from d2planner/src/logic/inventory.js.
 * Uses GameData for item base dimensions.
 */

import type { GameData } from '../game-data/game-data.js';
import { StashGrid } from './grid.js';
import type { GridSize } from './dimensions.js';

// ─── Types ──────────────────────────────────────────────────────

/** Minimal item descriptor needed for placement. */
export interface PlacementItem {
  base: string;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Check if an item can be placed at a specific position in a grid.
 *
 * @param grid  The occupancy grid.
 * @param x     Column position.
 * @param y     Row position.
 * @param item  The item to check.
 * @param gd    GameData for item dimensions.
 */
export function canPlaceItem(
  grid: StashGrid,
  x: number,
  y: number,
  item: PlacementItem,
  gd: GameData,
): boolean {
  const { w, h } = getItemSize(item, gd);
  return grid.isFree(x, y, w, h);
}

/**
 * Find a free slot for an item in a grid.
 *
 * @param grid  The occupancy grid.
 * @param item  The item to place.
 * @param gd    GameData for item dimensions.
 * @returns  `{ x, y }` or `null` if no space.
 */
export function findFreeSlot(
  grid: StashGrid,
  item: PlacementItem,
  gd: GameData,
): { x: number; y: number } | null {
  const { w, h } = getItemSize(item, gd);
  return grid.findFreeSlot(w, h);
}

/**
 * Find a free slot for an item across multiple stash pages.
 *
 * @param grids  Array of grids, one per stash page.
 * @param item   The item to place.
 * @param gd     GameData for item dimensions.
 * @returns  `{ pageIndex, x, y }` or `null` if no space in any page.
 */
export function findFreeSlotInStash(
  grids: StashGrid[],
  item: PlacementItem,
  gd: GameData,
): { pageIndex: number; x: number; y: number } | null {
  for (let i = 0; i < grids.length; i++) {
    const slot = findFreeSlot(grids[i], item, gd);
    if (slot) return { pageIndex: i, ...slot };
  }
  return null;
}

/**
 * Place an item in a grid, marking cells as occupied.
 *
 * @returns `true` if placed, `false` if the space is not free.
 */
export function placeItem(
  grid: StashGrid,
  x: number,
  y: number,
  item: PlacementItem,
  gd: GameData,
  itemId = 1,
): boolean {
  const { w, h } = getItemSize(item, gd);
  if (!grid.isFree(x, y, w, h)) return false;
  grid.occupy(x, y, w, h, itemId);
  return true;
}

/**
 * Remove an item from a grid, freeing its cells.
 */
export function removeItem(
  grid: StashGrid,
  x: number,
  y: number,
  item: PlacementItem,
  gd: GameData,
): void {
  const { w, h } = getItemSize(item, gd);
  grid.free(x, y, w, h);
}

/**
 * Build a StashGrid populated from a slot array.
 *
 * @param size  Grid dimensions.
 * @param slots  Sparse array: `slots[index] = itemId`.
 * @param items  All items keyed by ID.
 * @param gd  GameData for item dimensions.
 */
export function buildGrid(
  size: GridSize,
  slots: (number | undefined)[],
  items: Record<number | string, PlacementItem>,
  gd: GameData,
): StashGrid {
  const grid = new StashGrid(size);
  grid.populate(slots, items, gd);
  return grid;
}

// ─── Internal ───────────────────────────────────────────────────

/** Get item width and height from GameData. */
function getItemSize(item: PlacementItem, gd: GameData): { w: number; h: number } {
  const baseItem = gd.items[item.base] as unknown as Record<string, unknown> | undefined;
  const w = (baseItem?.invwidth as number) || 1;
  const h = (baseItem?.invheight as number) || 1;
  return { w, h };
}
