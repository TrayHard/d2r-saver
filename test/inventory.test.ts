import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import {
  STASH, INVENTORY, CUBE, getGridSize,
} from '../src/inventory/dimensions.js';
import { StashGrid } from '../src/inventory/grid.js';
import {
  canPlaceItem,
  findFreeSlot,
  findFreeSlotInStash,
  placeItem,
  removeItem,
  buildGrid,
} from '../src/inventory/placement.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

describe('Inventory', () => {
  let gd: GameData;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
  });

  // ─── Dimensions ───────────────────────────────────────────────

  describe('dimensions', () => {
    it('STASH is 16×13', () => {
      expect(STASH.columns).toBe(16);
      expect(STASH.rows).toBe(13);
    });

    it('INVENTORY is 10×4', () => {
      expect(INVENTORY.columns).toBe(10);
      expect(INVENTORY.rows).toBe(4);
    });

    it('CUBE is 3×4', () => {
      expect(CUBE.columns).toBe(3);
      expect(CUBE.rows).toBe(4);
    });

    it('getGridSize returns correct sizes', () => {
      expect(getGridSize('stash')).toEqual(STASH);
      expect(getGridSize('inventory')).toEqual(INVENTORY);
      expect(getGridSize('cube')).toEqual(CUBE);
    });
  });

  // ─── StashGrid basics ────────────────────────────────────────

  describe('StashGrid', () => {
    it('starts empty', () => {
      const grid = new StashGrid(STASH);
      expect(grid.isFree(0, 0, 1, 1)).toBe(true);
      expect(grid.at(0, 0)).toBe(0);
    });

    it('occupy marks cells', () => {
      const grid = new StashGrid(4, 4);
      grid.occupy(1, 1, 2, 2, 42);
      expect(grid.at(1, 1)).toBe(42);
      expect(grid.at(2, 2)).toBe(42);
      expect(grid.at(0, 0)).toBe(0);
      expect(grid.at(3, 3)).toBe(0);
    });

    it('isFree detects occupied cells', () => {
      const grid = new StashGrid(4, 4);
      grid.occupy(0, 0, 2, 2);
      expect(grid.isFree(0, 0, 1, 1)).toBe(false);
      expect(grid.isFree(1, 1, 1, 1)).toBe(false);
      expect(grid.isFree(2, 2, 1, 1)).toBe(true);
    });

    it('isFree rejects out-of-bounds', () => {
      const grid = new StashGrid(4, 4);
      expect(grid.isFree(-1, 0, 1, 1)).toBe(false);
      expect(grid.isFree(0, 0, 5, 1)).toBe(false);
      expect(grid.isFree(0, 0, 1, 5)).toBe(false);
    });

    it('free releases cells', () => {
      const grid = new StashGrid(4, 4);
      grid.occupy(1, 1, 2, 2, 10);
      expect(grid.isFree(1, 1, 2, 2)).toBe(false);
      grid.free(1, 1, 2, 2);
      expect(grid.isFree(1, 1, 2, 2)).toBe(true);
    });

    it('clear resets the entire grid', () => {
      const grid = new StashGrid(4, 4);
      grid.occupy(0, 0, 4, 4, 1);
      grid.clear();
      expect(grid.isFree(0, 0, 4, 4)).toBe(true);
    });

    it('findFreeSlot finds 1×1 in empty grid', () => {
      const grid = new StashGrid(STASH);
      expect(grid.findFreeSlot(1, 1)).toEqual({ x: 0, y: 0 });
    });

    it('findFreeSlot finds 2×2 after partial fill', () => {
      const grid = new StashGrid(4, 4);
      grid.occupy(0, 0, 2, 2);
      const slot = grid.findFreeSlot(2, 2);
      expect(slot).not.toBeNull();
      expect(slot!.x).toBe(2);
      expect(slot!.y).toBe(0);
    });

    it('findFreeSlot returns null when full', () => {
      const grid = new StashGrid(2, 2);
      grid.occupy(0, 0, 2, 2);
      expect(grid.findFreeSlot(1, 1)).toBeNull();
    });

    it('findFreeSlot for 2×4 item', () => {
      const grid = new StashGrid(STASH);
      // Fill the first two columns fully
      grid.occupy(0, 0, 2, 13);
      const slot = grid.findFreeSlot(2, 4);
      expect(slot).toEqual({ x: 2, y: 0 });
    });
  });

  // ─── Placement ────────────────────────────────────────────────

  describe('placement', () => {
    it('canPlaceItem returns true for empty grid', () => {
      const grid = new StashGrid(STASH);
      expect(canPlaceItem(grid, 0, 0, { base: 'cap' }, gd)).toBe(true);
    });

    it('placeItem occupies cells', () => {
      const grid = new StashGrid(STASH);
      const ok = placeItem(grid, 0, 0, { base: 'cap' }, gd, 99);
      expect(ok).toBe(true);
      // cap is 2×2
      const baseItem = gd.items['cap'] as unknown as Record<string, number>;
      if (baseItem?.invwidth === 2 && baseItem?.invheight === 2) {
        expect(grid.isFree(0, 0, 2, 2)).toBe(false);
      }
    });

    it('placeItem returns false if occupied', () => {
      const grid = new StashGrid(4, 4);
      grid.occupy(0, 0, 2, 2, 1);
      const ok = placeItem(grid, 0, 0, { base: 'cap' }, gd, 2);
      expect(ok).toBe(false);
    });

    it('findFreeSlot finds space for an item', () => {
      const grid = new StashGrid(STASH);
      const slot = findFreeSlot(grid, { base: 'cap' }, gd);
      expect(slot).not.toBeNull();
    });

    it('removeItem frees cells', () => {
      const grid = new StashGrid(STASH);
      placeItem(grid, 0, 0, { base: 'cap' }, gd, 99);
      removeItem(grid, 0, 0, { base: 'cap' }, gd);
      expect(grid.isFree(0, 0, 2, 2)).toBe(true);
    });

    it('findFreeSlotInStash searches across pages', () => {
      // Fill page 0 completely
      const g1 = new StashGrid(2, 2);
      g1.occupy(0, 0, 2, 2);
      // Page 1 is empty
      const g2 = new StashGrid(2, 2);
      const result = findFreeSlotInStash([g1, g2], { base: 'r01' }, gd);
      expect(result).not.toBeNull();
      expect(result!.pageIndex).toBe(1);
    });

    it('findFreeSlotInStash returns null when all full', () => {
      const g1 = new StashGrid(1, 1);
      g1.occupy(0, 0, 1, 1);
      const result = findFreeSlotInStash([g1], { base: 'r01' }, gd);
      expect(result).toBeNull();
    });
  });

  // ─── Populate from real data ──────────────────────────────────

  describe('populate from real data', () => {
    it('populates grid from d2i stash page', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
      const parsed = readD2I(buf, gd);
      const page0 = parsed.pages[0];
      const grid = buildGrid(STASH, page0.stash, parsed.items, gd);

      // The grid should have some occupied cells
      const itemCount = page0.stash.filter(Boolean).length;
      if (itemCount > 0) {
        let occupied = 0;
        for (let y = 0; y < grid.rows; y++) {
          for (let x = 0; x < grid.columns; x++) {
            if (grid.at(x, y) !== 0) occupied++;
          }
        }
        expect(occupied).toBeGreaterThan(0);
      }
    });

    it('findFreeSlot works on populated stash grid', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
      const parsed = readD2I(buf, gd);
      const page0 = parsed.pages[0];
      const grid = buildGrid(STASH, page0.stash, parsed.items, gd);

      // r01 (El rune) is 1×1
      const slot = findFreeSlot(grid, { base: 'r01' }, gd);
      // Stash is 16×13 = 208 cells, unlikely to be fully packed
      expect(slot).not.toBeNull();
    });

    it('populates grid from d2s inventory', () => {
      const buf = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
      const parsed = readD2S(buf, gd);
      const grid = buildGrid(INVENTORY, parsed.profile.inventory, parsed.items, gd);
      // Just verifying it doesn't throw
      expect(grid.rows).toBe(4);
      expect(grid.columns).toBe(10);
    });
  });
});
