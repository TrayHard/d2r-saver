/**
 * Inventory grid dimensions — Blizzless v105.
 *
 * Constants and helpers for stash/inventory/cube grid sizes.
 */
/** Shared stash grid dimensions. */
export declare const STASH: {
    readonly rows: 13;
    readonly columns: 16;
};
/** Character inventory grid dimensions. */
export declare const INVENTORY: {
    readonly rows: 4;
    readonly columns: 10;
};
/** Horadric cube grid dimensions. */
export declare const CUBE: {
    readonly rows: 4;
    readonly columns: 3;
};
/** Belt grid (4 columns, variable rows depending on belt type). */
export declare const BELT: {
    readonly rows: 4;
    readonly columns: 4;
};
/** Extended page misc tab (d2i type=1, virtual sub-page). */
export declare const EXTENDED_MISC: {
    readonly rows: 10;
    readonly columns: 10;
};
/** Grid dimensions descriptor. */
export interface GridSize {
    readonly rows: number;
    readonly columns: number;
}
/**
 * Get grid dimensions for a storage type.
 *
 * @param storage  Storage type: 'inventory' | 'cube' | 'stash' | 'belt'
 */
export declare function getGridSize(storage: 'inventory' | 'cube' | 'stash' | 'belt'): GridSize;
//# sourceMappingURL=dimensions.d.ts.map