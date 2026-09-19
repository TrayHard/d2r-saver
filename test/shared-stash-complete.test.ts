/**
 * The synthetic fixture SharedStashComplete.d2i: provenance (it is exactly what the builder
 * produces from the two real fixtures through the public in-place API) and the numbers the
 * rest of the suite relies on (one complete non-empty normal sector).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../src/game-data/game-data.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import { walkD2I } from '../src/formats/item-walker.js';
import { buildRawGrid } from '../src/inventory/raw-grid.js';
import { buildSharedStashComplete, SHARED_STASH_COMPLETE, type SharedStashCompleteBuild } from './helpers/shared-stash-complete.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

let gd: GameData;
let build: SharedStashCompleteBuild;
let committed: Uint8Array;
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
  build = buildSharedStashComplete(gd, fixture('SharedStashSoftCoreV2V105.d2i'), fixture('SharedStashSoftCoreV2V105_.d2i'));
  committed = fixture(SHARED_STASH_COMPLETE);
});

describe('SharedStashComplete.d2i provenance', () => {
  it('is byte-identical to the builder output from the two real fixtures', () => {
    expect(build.buffer.length).toBe(2778);
    expect(sha256(committed)).toBe(sha256(build.buffer));
    expect(Buffer.compare(Buffer.from(committed), Buffer.from(build.buffer))).toBe(0);
  });

  it('holds nine items moved from three truncated sectors, at their original cells', () => {
    expect(build.sectorOffset).toBe(1285);
    expect(build.placed.map(p => `${p.source.replace('SharedStashSoftCoreV2V105', '')}@${p.sourceSector}#${p.sourceIndex}:${p.base}@${p.col},${p.row}`)).toEqual([
      '.d2i@0#0:cm1@9,7',
      '.d2i@989#0:ci2@0,0',
      '_.d2i@1210#0:amu@8,0',
      '_.d2i@1210#1:rin@7,2',
      '_.d2i@1210#2:rin@6,2',
      '_.d2i@1210#3:rin@7,3',
      '_.d2i@1210#4:rin@6,3',
      '_.d2i@1210#5:amu@7,0',
      '_.d2i@1210#6:rin@5,3',
    ]);
    // The sources kept everything except the moved bytes: the truncation points moved up.
    const plain = walkD2I(build.shrunkPlain, gd);
    expect(plain.sectors.map(s => [s.offset, s.size, s.walk?.report.parsed ?? null, s.walk?.report.declared ?? null])).toEqual([
      [0, 949, 0, 14], [949, 336, 0, 6], [1285, 68, 0, 0], [1353, 68, 0, 0], [1421, 68, 0, 0], [1489, 830, 56, 56], [2319, 168, null, null],
    ]);
    const underscore = walkD2I(build.shrunkUnderscore, gd);
    expect(underscore.sectors.map(s => [s.offset, s.size, s.walk?.report.parsed, s.walk?.report.declared])).toEqual([
      [0, 1210, 0, 31], [1210, 2076, 0, 55], [3286, 1184, 0, 42],
    ]);
    expect(underscore.sectors[1].walk!.report.error).toBe('item 1/55: unknown item stat code 489');
  });
});

describe('SharedStashComplete.d2i numbers', () => {
  it('walkD2I: sector @1285 is 9/9 and complete; the rest is the plain fixture minus two items', () => {
    const report = walkD2I(committed, gd);
    expect(report.tiled).toBe(true);
    expect(report.reachedEof).toBe(true);
    expect(report.sectors.map(s => ({ offset: s.offset, size: s.size, type: s.type, parsed: s.walk?.report.parsed ?? null, declared: s.walk?.report.declared ?? null, complete: s.walk?.report.complete ?? null }))).toEqual([
      { offset: 0, size: 949, type: 0, parsed: 0, declared: 14, complete: false },
      { offset: 949, size: 336, type: 0, parsed: 0, declared: 6, complete: false },
      { offset: 1285, size: 359, type: 0, parsed: 9, declared: 9, complete: true },
      { offset: 1644, size: 68, type: 0, parsed: 0, declared: 0, complete: true },
      { offset: 1712, size: 68, type: 0, parsed: 0, declared: 0, complete: true },
      { offset: 1780, size: 830, type: 1, parsed: 56, declared: 56, complete: true },
      { offset: 2610, size: 168, type: 2, parsed: null, declared: null, complete: null },
    ]);
    const full = report.sectors[2].walk!;
    expect(full.report).toMatchObject({ headerOffset: 1349, firstItemOffset: 1353, endOffset: 1644, expectedEnd: 1644, reachedEnd: true, error: null, errorCode: null });
    expect(full.entries.map(e => `${e.head.base}@${e.head.col},${e.head.row}`)).toEqual([
      'cm1@9,7', 'ci2@0,0', 'amu@8,0', 'rin@7,2', 'rin@6,2', 'rin@7,3', 'rin@6,3', 'amu@7,0', 'rin@5,3',
    ]);
    expect(full.entries.map(e => e.full.end - e.full.start)).toEqual([40, 37, 37, 31, 31, 26, 26, 37, 26]);
    expect(full.entries.every(e => e.head.loc === 0 && e.head.bodyloc === 0 && e.head.storage === 5)).toBe(true);
    expect(full.entries.every(e => e.registeredKey !== null)).toBe(true);
    // Items keep their identity (guid, stats) across the move.
    const plainWalk = walkD2I(fixture('SharedStashSoftCoreV2V105.d2i'), gd).sectors;
    const underscoreWalk = walkD2I(fixture('SharedStashSoftCoreV2V105_.d2i'), gd).sectors;
    const sources = [plainWalk[0].walk!.entries[0], plainWalk[1].walk!.entries[0], ...underscoreWalk[1].walk!.entries];
    expect(full.entries.map(e => e.item.guid)).toEqual(sources.map(e => e.item.guid));
    expect(full.entries.map(e => e.item.stats)).toEqual(sources.map(e => e.item.stats));
    expect(full.entries[0].item.guid).toBe(2620541511);
    expect(full.entries[2].item.guid).toBe(3740327953);
    expect(full.entries[5].item.guid).toBe(4198596071);
  });

  it('the raw grid of the complete sector marks 12 cells (ci2 is 2x2) with no overlap', () => {
    const walk = walkD2I(committed, gd).sectors[2].walk!;
    const grid = buildRawGrid(walk, gd);
    const cells: string[] = [];
    for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) if (grid.at(x, y)) cells.push(`${x},${y}=${grid.at(x, y)}`);
    expect(cells).toEqual(['0,0=2', '1,0=2', '7,0=8', '8,0=3', '0,1=2', '1,1=2', '6,2=5', '7,2=4', '5,3=9', '6,3=7', '7,3=6', '9,7=1']);
  });

  it('readD2I sees a page with nine items and no warning for it', () => {
    const result = readD2I(committed, gd);
    expect(result.tiled).toBe(true);
    expect(result.reachedEof).toBe(true);
    const page = result.pages.find(p => p.offset === 1285)!;
    expect(page.list).toMatchObject({ declared: 9, parsed: 9, complete: true });
    expect(page.stash.filter(id => id != null).length).toBe(9);
    expect(result.warnings.some(w => w.includes('page 2'))).toBe(false);
    expect(result.warnings).toEqual([
      'Stash page 0: item list truncated: item 1/14: unknown item stat code 482',
      'Stash page 1: item list truncated: item 1/6: unknown item stat code 480',
    ]);
    const bases = page.stash.filter((id): id is number => id != null).map(id => result.items[id].base).sort();
    expect(bases).toEqual(['amu', 'amu', 'ci2', 'cm1', 'rin', 'rin', 'rin', 'rin', 'rin']);
  });
});
