/**
 * buildRawGrid: occupancy from the position bits of walked items, refusing to guess.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { walkD2I, walkItemList, type WalkResult, type WalkedItem } from '../src/formats/item-walker.js';
import { buildRawGrid } from '../src/inventory/raw-grid.js';
import { canPlaceItem } from '../src/inventory/placement.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

let gd: GameData;
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

function expectCode(fn: () => unknown, code: ErrorCode): D2RSaverError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
  return caught as D2RSaverError;
}

/** A walk with hand-made entries (only `head`, `index` and `own` matter to the grid). */
function fakeWalk(entries: Array<Partial<WalkedItem['head']> & { base: string | null }>): WalkResult {
  const walk = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).sectors[2].walk!; // empty sector
  return {
    report: walk.report,
    items: {},
    entries: entries.map((head, index) => ({
      index,
      own: { start: 1000 + index * 10, end: 1010 + index * 10 },
      full: { start: 1000 + index * 10, end: 1010 + index * 10 },
      children: [],
      head: {
        identified: true, socketed: false, ear: head.base === null, simple: true, ethereal: false,
        personalized: false, runeword: false, extras: false,
        loc: 0, bodyloc: 0, col: 0, row: 0, storage: 5,
        ...head,
      },
      item: {} as WalkedItem['item'],
      registeredKey: null,
      hasQuantity: false,
    })),
  };
}

function occupied(grid: ReturnType<typeof buildRawGrid>): string[] {
  const cells: string[] = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.columns; x++) if (grid.at(x, y)) cells.push(`${x},${y}=${grid.at(x, y)}`);
  }
  return cells;
}

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

describe('buildRawGrid', () => {
  it('uses the Blizzless stash size 16x13 by default', () => {
    const empty = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).sectors[2].walk!;
    const grid = buildRawGrid(empty, gd);
    expect(grid.columns).toBe(16);
    expect(grid.rows).toBe(13);
    expect(occupied(grid)).toEqual([]);
  });

  it('marks every walked item of sector @1210 (seven 1x1 items) with index + 1', () => {
    const walk = walkD2I(fixture('SharedStashSoftCoreV2V105_.d2i'), gd).sectors[1].walk!;
    const grid = buildRawGrid(walk, gd);
    expect(occupied(grid)).toEqual(['7,0=6', '8,0=1', '6,2=3', '7,2=2', '5,3=7', '6,3=5', '7,3=4']);
    expect(grid.at(8, 0) - 1).toBe(0); // entry 0 = the amulet at column 8, row 0
    expect(walk.entries[grid.at(5, 3) - 1].head.base).toBe('rin');
  });

  it('a 2x2 item occupies four cells', () => {
    const walk = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).sectors[1].walk!;
    expect(walk.entries[0].head.base).toBe('ci2'); // 2x2 charm
    const grid = buildRawGrid(walk, gd);
    expect(occupied(grid)).toEqual(['0,0=1', '1,0=1', '0,1=1', '1,1=1']);
    expect(canPlaceItem(grid, 0, 0, { base: 'cm1' }, gd)).toBe(false);
    expect(canPlaceItem(grid, 2, 0, { base: 'cm1' }, gd)).toBe(true);
    expect(canPlaceItem(grid, 1, 1, { base: 'ci2' }, gd)).toBe(false);
    expect(canPlaceItem(grid, 2, 0, { base: 'ci2' }, gd)).toBe(true);
  });

  it('the single walked item of sector @0 sits at column 9, row 7', () => {
    const walk = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).sectors[0].walk!;
    expect(occupied(buildRawGrid(walk, gd))).toEqual(['9,7=1']);
  });

  it('refuses an unknown base instead of assuming 1x1', () => {
    const err = expectCode(() => buildRawGrid(fakeWalk([{ base: 'zzz', col: 2, row: 2 }]), gd), ErrorCode.UNKNOWN_BASE);
    expect(err.message).toContain('"zzz"');
  });

  it('refuses items that are not in the stash grid (worn / belt / inventory)', () => {
    const worn = walkItemList(fixture('WarlockTest.d2s'), 914, gd); // loc=1 body items
    expectCode(() => buildRawGrid(worn, gd), ErrorCode.INVALID_PAGE);
    const belt = walkItemList(fixture('WarlockShards.d2s'), 903, gd); // loc=2 belt potions
    expectCode(() => buildRawGrid(belt, gd), ErrorCode.INVALID_PAGE);
    expectCode(() => buildRawGrid(fakeWalk([{ base: 'rin', storage: 1 }]), gd), ErrorCode.INVALID_PAGE);
  });

  it('accepts Blizzless material placement (loc=4, storage=5)', () => {
    const grid = buildRawGrid(fakeWalk([{ base: 'rin', loc: 4, col: 3, row: 3 }]), gd);
    expect(occupied(grid)).toEqual(['3,3=1']);
  });

  it('refuses overlapping items and items leaving the grid', () => {
    expectCode(() => buildRawGrid(fakeWalk([{ base: 'rin', col: 1, row: 1 }, { base: 'ci2', col: 0, row: 0 }]), gd), ErrorCode.INVALID_PAGE);
    expectCode(() => buildRawGrid(fakeWalk([{ base: 'ci2', col: 15, row: 0 }]), gd), ErrorCode.INVALID_PAGE);
    expectCode(() => buildRawGrid(fakeWalk([{ base: 'rin', col: 0, row: 13 }]), gd), ErrorCode.INVALID_PAGE);
  });

  it('the extended sector overlaps in raw coordinates and is rejected', () => {
    // Extended (type 1) sectors keep stacks in a virtual layout; r22 and r13 both claim (6,0).
    const ext = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).sectors[5].walk!;
    expectCode(() => buildRawGrid(ext, gd), ErrorCode.INVALID_PAGE);
  });

  it('an ear is 1x1 without a base code', () => {
    const grid = buildRawGrid(fakeWalk([{ base: null, col: 4, row: 4 }]), gd);
    expect(occupied(grid)).toEqual(['4,4=1']);
  });

  it('honours an explicit grid size', () => {
    const grid = buildRawGrid(fakeWalk([{ base: 'rin', col: 9, row: 3 }]), gd, { rows: 4, columns: 10 });
    expect(grid.columns).toBe(10);
    expect(grid.rows).toBe(4);
    expectCode(() => buildRawGrid(fakeWalk([{ base: 'rin', col: 10, row: 0 }]), gd, { rows: 4, columns: 10 }), ErrorCode.INVALID_PAGE);
  });
});
