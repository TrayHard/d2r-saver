/**
 * Raw occupancy grid — built from the position bits of walked items, not from the parser's
 * dictionary.
 *
 * `StashGrid.populate` / `buildGrid` derive occupancy from the readers' slot arrays, which only
 * contain items the parser REGISTERED. A raw grid instead marks every top-level item the walker
 * saw (registered or dropped), using the `col`/`row` bits and the base's `invwidth`/`invheight`.
 * It refuses to guess: an unknown base is an error, not a 1x1 placeholder, and an item outside
 * the stash grid or overlapping another one is an error too, because this grid gates where new
 * bytes may be inserted.
 */

import type { GameData } from '../game-data/game-data.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import type { WalkResult, WalkedItem } from '../formats/item-walker.js';
import { StashGrid } from './grid.js';
import { STASH, type GridSize } from './dimensions.js';

/** Grid size of an item by its head (ears are 1x1 and have no base code). */
function rawItemSize(entry: WalkedItem, gd: GameData): { w: number; h: number } {
  const { head, index } = entry;
  if (head.base === null) return { w: 1, h: 1 };
  const base = gd.items[head.base];
  const w = base?.invwidth;
  const h = base?.invheight;
  if (!base || typeof w !== 'number' || typeof h !== 'number' || w < 1 || h < 1) {
    throw new D2RSaverError(
      ErrorCode.UNKNOWN_BASE,
      `item #${index} at bytes [${entry.own.start}, ${entry.own.end}): unknown base "${head.base}", cannot size it`,
    );
  }
  return { w, h };
}

/**
 * Build the occupancy grid of a stash sector from a walk. Every top-level entry must sit in the
 * stash grid (`loc` 0 or 4 with `storage` 5); cells are marked with `entry.index + 1`, so
 * `grid.at(x, y) - 1` is the index of the entry occupying a cell (0 means free).
 *
 * @param walk  A walked `.d2i` sector list (`walkD2I(...).sectors[n].walk`).
 * @param gd    GameData for item sizes.
 * @param size  Grid size; defaults to `gd.info.stash` (16x13 on Blizzless).
 * @throws {D2RSaverError} `UNKNOWN_BASE` for a base code missing from GameData; `INVALID_PAGE`
 *   for an item outside the stash grid, one that leaves the grid bounds, or two items that overlap.
 */
export function buildRawGrid(walk: WalkResult, gd: GameData, size?: GridSize): StashGrid {
  const dims = size ?? gd.info?.stash ?? STASH;
  const grid = new StashGrid(dims.rows, dims.columns);

  for (const entry of walk.entries) {
    const { head, index } = entry;
    const inStash = (head.loc === 0 || head.loc === 4) && head.storage === 5;
    if (!inStash) {
      throw new D2RSaverError(
        ErrorCode.INVALID_PAGE,
        `item #${index} at bytes [${entry.own.start}, ${entry.own.end}) is not in the stash grid ` +
          `(loc=${head.loc}, bodyloc=${head.bodyloc}, storage=${head.storage})`,
      );
    }
    const { w, h } = rawItemSize(entry, gd);
    if (!grid.isFree(head.col, head.row, w, h)) {
      throw new D2RSaverError(
        ErrorCode.INVALID_PAGE,
        `item #${index} (${head.base ?? 'ear'}) at column ${head.col}, row ${head.row}, size ${w}x${h} ` +
          `overlaps another item or leaves the ${dims.columns}x${dims.rows} grid`,
      );
    }
    grid.occupy(head.col, head.row, w, h, index + 1);
  }

  return grid;
}
