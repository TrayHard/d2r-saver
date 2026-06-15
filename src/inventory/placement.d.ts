/**
 * Placement logic — inventory/stash item placement helpers.
 *
 * Ported from d2planner/src/logic/inventory.js.
 * Uses GameData for item base dimensions.
 */
import type { GameData } from '../game-data/game-data.js';
import { StashGrid } from './grid.js';
import type { GridSize } from './dimensions.js';
/** Minimal item descriptor needed for placement. */
export interface PlacementItem {
    base: string;
}
/**
 * Check if an item can be placed at a specific position in a grid.
 *
 * @param grid  The occupancy grid.
 * @param x     Column position.
 * @param y     Row position.
 * @param item  The item to check.
 * @param gd    GameData for item dimensions.
 */
export declare function canPlaceItem(grid: StashGrid, x: number, y: number, item: PlacementItem, gd: GameData): boolean;
/**
 * Find a free slot for an item in a grid.
 *
 * @param grid  The occupancy grid.
 * @param item  The item to place.
 * @param gd    GameData for item dimensions.
 * @returns  `{ x, y }` or `null` if no space.
 */
export declare function findFreeSlot(grid: StashGrid, item: PlacementItem, gd: GameData): {
    x: number;
    y: number;
} | null;
/**
 * Find a free slot for an item across multiple stash pages.
 *
 * @param grids  Array of grids, one per stash page.
 * @param item   The item to place.
 * @param gd     GameData for item dimensions.
 * @returns  `{ pageIndex, x, y }` or `null` if no space in any page.
 */
export declare function findFreeSlotInStash(grids: StashGrid[], item: PlacementItem, gd: GameData): {
    pageIndex: number;
    x: number;
    y: number;
} | null;
/**
 * Place an item in a grid, marking cells as occupied.
 *
 * @returns `true` if placed, `false` if the space is not free.
 */
export declare function placeItem(grid: StashGrid, x: number, y: number, item: PlacementItem, gd: GameData, itemId?: number): boolean;
/**
 * Remove an item from a grid, freeing its cells.
 */
export declare function removeItem(grid: StashGrid, x: number, y: number, item: PlacementItem, gd: GameData): void;
/**
 * Build a StashGrid populated from a slot array.
 *
 * @param size  Grid dimensions.
 * @param slots  Sparse array: `slots[index] = itemId`.
 * @param items  All items keyed by ID.
 * @param gd  GameData for item dimensions.
 */
export declare function buildGrid(size: GridSize, slots: (number | undefined)[], items: Record<number | string, PlacementItem>, gd: GameData): StashGrid;
//# sourceMappingURL=placement.d.ts.map