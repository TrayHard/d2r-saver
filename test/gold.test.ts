/**
 * Gold in place (0.4.17): character gold and goldbank in the stats section, shared-tab gold in the sector header.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import {
  characterGoldMax,
  readCharacterGold,
  readSharedTabGold,
  setCharacterGold,
  setSharedTabGold,
  CHARACTER_STASH_GOLD_MAX,
  SHARED_TAB_GOLD_MAX,
} from '../src/operations/gold.js';
import { readD2S } from '../src/formats/d2s-reader.js';
import { computeChecksum } from '../src/core/checksum.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';
import * as root from '../src/index.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const u32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
let gd: GameData;

function expectCode(fn: () => unknown, code: ErrorCode): void {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
}

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

describe('caps', () => {
  it('carried gold is level × 10,000; the personal stash and a shared tab hold 2,500,000', () => {
    expect(characterGoldMax(1)).toBe(10_000);
    expect(characterGoldMax(99)).toBe(990_000);
    expect(characterGoldMax(0)).toBe(0);
    expect(CHARACTER_STASH_GOLD_MAX).toBe(2_500_000);
    expect(SHARED_TAB_GOLD_MAX).toBe(2_500_000);
  });
});

describe('character gold', () => {
  it('reads the gold, goldbank and level stats', () => {
    expect(readCharacterGold(fixture('WarlockTest.d2s'), gd)).toEqual({ gold: 25853, goldbank: 0, level: 75 });
    expect(readCharacterGold(fixture('WarlockShards.d2s'), gd)).toEqual({ gold: 0, goldbank: 0, level: 1 });
  });

  it('changes a present stat in place: same length, only stats bits and the checksum differ', () => {
    const before = fixture('WarlockTest.d2s');
    const copy = before.slice();
    const { bytes, after } = setCharacterGold(before, gd, { gold: 750_000 });
    expect(before).toEqual(copy);
    expect(after).toEqual({ gold: 750_000, goldbank: 0, level: 75 });
    expect(bytes.length).toBe(before.length);
    const changed = [...bytes.keys()].filter(i => bytes[i] !== before[i]);
    expect(changed.every(i => (i >= 12 && i < 16) || (i >= 833 && i < 833 + 64))).toBe(true);
    expect(u32(bytes, 12)).toBe(computeChecksum(bytes));
    expect(readD2S(bytes, gd).profile.attributes?.gold).toBe(750_000);
  });

  it('inserts goldbank from 0 at its id: the file grows and an edit back gives the original bytes', () => {
    const before = fixture('WarlockTest.d2s');
    const { bytes } = setCharacterGold(before, gd, { goldbank: CHARACTER_STASH_GOLD_MAX });
    // 9-bit id + 25-bit value = 34 bits.
    expect(bytes.length - before.length).toBeGreaterThanOrEqual(4);
    expect(bytes.length - before.length).toBeLessThanOrEqual(5);
    expect(u32(bytes, 8)).toBe(bytes.length);
    const keys = Object.keys(readD2S(bytes, gd).profile.attributes ?? {});
    expect(keys.indexOf('goldbank')).toBe(keys.indexOf('gold') + 1);
    expect(readCharacterGold(bytes, gd)).toEqual({ gold: 25853, goldbank: 2_500_000, level: 75 });
    expect(setCharacterGold(bytes, gd, { goldbank: 0 }).bytes).toEqual(before);
  });

  it('leaves out a stat set to 0, as the game writes it, and back again', () => {
    const before = fixture('WarlockTest.d2s');
    const { bytes } = setCharacterGold(before, gd, { gold: 0 });
    expect(bytes.length).toBeLessThan(before.length);
    expect('gold' in (readD2S(bytes, gd).profile.attributes ?? {})).toBe(false);
    // The fixture's main list stops at an unknown stat (item 6/26); it stops at the same item after the edit.
    expect(readD2S(bytes, gd).lists.main?.parsed).toBe(readD2S(before, gd).lists.main?.parsed);
    expect(setCharacterGold(bytes, gd, { gold: 25853 }).bytes).toEqual(before);
  });

  it('sets both stats from nothing on a level 1 character', () => {
    const before = fixture('WarlockShards.d2s');
    const { bytes } = setCharacterGold(before, gd, { gold: 10_000, goldbank: 1 });
    expect(readCharacterGold(bytes, gd)).toEqual({ gold: 10_000, goldbank: 1, level: 1 });
    expect(setCharacterGold(bytes, gd, { gold: 0, goldbank: 0 }).bytes).toEqual(before);
  });

  it('refuses an amount over the cap, a negative or fractional amount and an empty request', () => {
    const warlock = fixture('WarlockTest.d2s');
    expectCode(() => setCharacterGold(warlock, gd, { gold: 750_001 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setCharacterGold(warlock, gd, { goldbank: 2_500_001 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setCharacterGold(warlock, gd, { gold: -1 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setCharacterGold(warlock, gd, { gold: 1.5 }), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setCharacterGold(warlock, gd, {}), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setCharacterGold(fixture('WarlockShards.d2s'), gd, { gold: 10_001 }), ErrorCode.INVALID_ARGUMENT);
  });

  it('refuses a file with a wrong checksum, a wrong size field or another version', () => {
    const bad = fixture('WarlockTest.d2s');
    bad[900] ^= 1;
    expectCode(() => readCharacterGold(bad, gd), ErrorCode.CHECKSUM_MISMATCH);
    const short = fixture('WarlockTest.d2s').slice(0, -1);
    expectCode(() => readCharacterGold(short, gd), ErrorCode.INVALID_FORMAT);
    expectCode(() => readCharacterGold(fixture('BlizzlessTest.d2s'), gd), ErrorCode.UNSUPPORTED_VERSION);
  });
});

describe('shared tab gold', () => {
  it('reads the gold of each normal sector; the game filled the first tab to 2,500,000 and spilled into the second', () => {
    const tabs = readSharedTabGold(fixture('SharedStashSoftCoreV2V105.d2i'), gd);
    expect(tabs.map(tab => tab.gold)).toEqual([2_500_000, 91_243, 0, 0, 0]);
    expect(tabs.map(tab => tab.sectorOffset)).toEqual([0, 989, 1362, 1430, 1498]);
  });

  it('changes only the four gold bytes of that sector', () => {
    const before = fixture('SharedStashSoftCoreV2V105.d2i');
    const copy = before.slice();
    const result = setSharedTabGold(before, gd, 989, 2_500_000);
    expect(before).toEqual(copy);
    expect(result).toMatchObject({ sectorOffset: 989, before: 91_243, after: 2_500_000 });
    const changed = [...result.bytes.keys()].filter(i => result.bytes[i] !== before[i]);
    expect(changed.every(i => i >= 989 + 12 && i < 989 + 16)).toBe(true);
    expect(readSharedTabGold(result.bytes, gd).map(tab => tab.gold)).toEqual([2_500_000, 2_500_000, 0, 0, 0]);
    expect(setSharedTabGold(result.bytes, gd, 989, 91_243).bytes).toEqual(before);
  });

  it('refuses the materials sector, a missing offset and an amount over 2,500,000', () => {
    const stash = fixture('SharedStashSoftCoreV2V105.d2i');
    expectCode(() => setSharedTabGold(stash, gd, 1566, 1), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setSharedTabGold(stash, gd, 5, 1), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setSharedTabGold(stash, gd, 0, 2_500_001), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => setSharedTabGold(stash, gd, 0, -1), ErrorCode.INVALID_ARGUMENT);
  });
});

describe('root exports', () => {
  it('exposes the gold operations', () => {
    expect(root.readCharacterGold).toBe(readCharacterGold);
    expect(root.setCharacterGold).toBe(setCharacterGold);
    expect(root.readSharedTabGold).toBe(readSharedTabGold);
    expect(root.setSharedTabGold).toBe(setSharedTabGold);
    expect(root.SHARED_TAB_GOLD_MAX).toBe(2_500_000);
  });
});
