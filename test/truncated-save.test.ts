/**
 * R-15 (library half): a save file cut off mid-item must fail fast with BUFFER_OVERRUN, never
 * spin. Before the bounds check, `readD2S` on WarlockTest.d2s cut to 1100 bytes blocked the
 * event loop for ~13 s (the reader returned zeros past the end and the item parser walked
 * phantom stats). Now the first out-of-range read throws inside the item list, the list is
 * reported as truncated, and the call returns in milliseconds.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

/** Wall-clock budget per parse. A hang cannot be interrupted, so we also measure. */
const BUDGET_MS = 2000;

function timed<T>(fn: () => T): { result?: T; error?: unknown; ms: number } {
  const t0 = performance.now();
  try {
    const result = fn();
    return { result, ms: performance.now() - t0 };
  } catch (error) {
    return { error, ms: performance.now() - t0 };
  }
}

describe('truncated save files fail fast (BUFFER_OVERRUN)', () => {
  let gd: GameData;
  let warlock: Uint8Array;
  let stash: Uint8Array;

  beforeAll(() => {
    const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
    const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
    gd = GameData.fromRaw(rawData, locale);
    warlock = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockTest.d2s')));
    stash = new Uint8Array(readFileSync(resolve(FIXTURES, 'SharedStashSoftCoreV2V105_.d2i')));
  });

  it('WarlockTest.d2s cut to 1100 bytes returns within the budget and reports the overrun', () => {
    const { result, error, ms } = timed(() => readD2S(warlock.slice(0, 1100), gd));
    expect(error).toBeUndefined();
    expect(ms).toBeLessThan(BUDGET_MS);
    // Item 4 (fhl, bytes [1081,1134)) is the one cut in half.
    expect(result!.warnings.some(w => /item 4\/26: buffer overrun/.test(w))).toBe(true);
    expect(result!.warnings.some(w => /BUFFER_OVERRUN|buffer overrun/.test(w))).toBe(true);
    expect(Object.keys(result!.items).length).toBe(3);
  }, BUDGET_MS);

  it('every truncation point of WarlockTest.d2s terminates quickly', () => {
    // Sweep from a header-only stub up to the full file. Each parse either returns (with a
    // truncation warning) or throws BUFFER_OVERRUN from the fixed header; neither may hang.
    let slowest = 0;
    for (let cut = 16; cut < warlock.length; cut += 7) {
      const { error, ms } = timed(() => readD2S(warlock.slice(0, cut), gd));
      slowest = Math.max(slowest, ms);
      if (error !== undefined) {
        expect(error).toBeInstanceOf(D2RSaverError);
        expect((error as D2RSaverError).code).toBe(ErrorCode.BUFFER_OVERRUN);
      }
    }
    expect(slowest).toBeLessThan(BUDGET_MS);
  }, 30_000);

  it('a .d2i cut inside a sector reports the overrun for that page and stops', () => {
    // Sector @1210 (62 items declared) is cut after its 3rd walked item ([1346,1377)).
    const { result, error, ms } = timed(() => readD2I(stash.slice(0, 1360), gd));
    expect(error).toBeUndefined();
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result!.pages.length).toBe(2);
    expect(result!.warnings.some(w => /Stash page 1: item list truncated: item 3\/62: buffer overrun/.test(w))).toBe(true);
  }, BUDGET_MS);

  it('every truncation point of the .d2i terminates quickly', () => {
    let slowest = 0;
    for (let cut = 0; cut < stash.length; cut += 11) {
      const { error, ms } = timed(() => readD2I(stash.slice(0, cut), gd));
      slowest = Math.max(slowest, ms);
      expect(error).toBeUndefined(); // readD2I never throws: every page failure becomes a warning
    }
    expect(slowest).toBeLessThan(BUDGET_MS);
  }, 30_000);
});
