/**
 * StashGrid — occupancy grid for inventory/stash/cube placement.
 *
 * Ported from d2planner/src/logic/inventory.js, cleaned up as a class.
 * Uses GameData for item base dimensions (invwidth, invheight).
 */
import type { GameData } from '../game-data/game-data.js';
import type { GridSize } from './dimensions.js';
/**
 * A 2D occupancy grid for a storage area.
 *
 * Each cell is either free (0) or occupied (non-zero).
 * Items occupy rectangular regions based on their `invwidth × invheight`.
 */
export declare class StashGrid {
    readonly rows: number;
    readonly columns: number;
    /** Flat occupancy array: `cells[y * columns + x]`. 0 = free, else item ID. */
    private cells;
    constructor(size: GridSize);
    constructor(rows: number, columns: number);
    /** Check if a rectangular area is completely free. */
    isFree(x: number, y: number, width: number, height: number): boolean;
    /** Get the item ID at a cell, or 0 if free. */
    at(x: number, y: number): number;
    /** Mark a rectangular area as occupied by `itemId`. */
    occupy(x: number, y: number, width: number, height: number, itemId?: number): void;
    /** Free a rectangular area. */
    free(x: number, y: number, width: number, height: number): void;
    /** Clear the entire grid. */
    clear(): void;
    /**
     * Find the first free slot (top-left corner) for an item of the given size.
     * Scans left-to-right, top-to-bottom.
     *
     * @returns `{ x, y }` or `null` if no space.
     */
    findFreeSlot(width: number, height: number): {
        x: number;
        y: number;
    } | null;
    /**
     * Populate the grid from a slot array (as returned by d2i/d2s readers).
     *
     * @param slots Sparse array: `slots[slot] = itemId`. Slot = `y * columns + x`.
     * @param items All items keyed by ID.
     * @param gd GameData for item base dimensions.
     */
    populate(slots: (number | undefined)[], items: Record<number | string, {
        base: string;
    }>, gd: GameData): void;
}
//# sourceMappingURL=grid.d.ts.map