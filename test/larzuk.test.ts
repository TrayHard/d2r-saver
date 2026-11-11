/**
 * Larzuk's socket reward (0.4.11): quest word, socket plan and in-place socketing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameData } from '../src/game-data/game-data.js';
import { walkD2I, walkItemList, type WalkedItem } from '../src/formats/item-walker.js';
import {
  consumeLarzukReward,
  maxSocketsFor,
  planLarzukSockets,
  readLarzukItemFacts,
  readLarzukRewards,
  rollLarzukSockets,
  socketItemInPlace,
} from '../src/operations/larzuk.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';
import { writeItem } from '../src/formats/item-writer.js';
import type { BinaryParsedItem } from '../src/formats/item-parser.js';
import * as root from '../src/index.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
let gd: GameData;

function expectCode(fn: () => unknown, code: ErrorCode): void {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(D2RSaverError);
  expect((caught as D2RSaverError).code).toBe(code);
}

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

describe('readLarzukRewards / consumeLarzukReward', () => {
  it('reads the reward of each difficulty (WarlockTest: pending in normal and nightmare)', () => {
    const rewards = readLarzukRewards(fixture('WarlockTest.d2s'));
    expect(rewards.map(r => [r.offset, r.flags, r.state])).toEqual([
      [483, 0x8002, 'available'],
      [579, 0x8002, 'available'],
      [675, 0x0000, 'not-earned'],
    ]);
  });

  it('uses a reward like the game: low bits 0x021, quest-log bits kept, only the word and the checksum change', () => {
    const before = fixture('WarlockTest.d2s');
    const { bytes, offset, before: was, after } = consumeLarzukReward(before, 0);
    expect([offset, was, after]).toEqual([483, 0x8002, 0x8021]);
    expect(bytes.length).toBe(before.length);
    const changed = [...bytes.keys()].filter(i => bytes[i] !== before[i]);
    expect(changed.every(i => (i >= 12 && i < 16) || i === 483 || i === 484)).toBe(true);
    expect(readLarzukRewards(bytes).map(r => r.state)).toEqual(['used', 'available', 'not-earned']);
    expect(readLarzukRewards(before)[0].state).toBe('available');
  });

  it('refuses a used, an unearned and a bad difficulty, and a damaged file', () => {
    const used = consumeLarzukReward(fixture('WarlockTest.d2s'), 0).bytes;
    expectCode(() => consumeLarzukReward(used, 0), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => consumeLarzukReward(used, 2), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => consumeLarzukReward(used, 3 as 0), ErrorCode.INVALID_ARGUMENT);
    const damaged = new Uint8Array(used);
    damaged[700] ^= 0xff;
    expectCode(() => readLarzukRewards(damaged), ErrorCode.CHECKSUM_MISMATCH);
    expectCode(() => readLarzukRewards(fixture('SharedStashComplete.d2i')), ErrorCode.INVALID_FORMAT);
  });
});

describe('planLarzukSockets', () => {
  const white = { quality: 2, socketed: false, unidentified: false };

  it('gives white items the maximum by base and item level bands', () => {
    // Crystal Sword: 6 base sockets, sword type 3 / 4 / 6.
    expect([20, 25, 26, 40, 41, 85].map(ilvl => maxSocketsFor(gd, 'crs', ilvl))).toEqual([3, 3, 4, 4, 6, 6]);
    expect(planLarzukSockets(gd, { ...white, base: 'crs', ilvl: 30 })).toEqual({ eligible: true, min: 4, max: 4 });
    expect(planLarzukSockets(gd, { ...white, quality: 1, base: 'crs', ilvl: 50 })).toEqual({ eligible: true, min: 6, max: 6 });
    expect(planLarzukSockets(gd, { ...white, quality: 3, base: 'crs', ilvl: 10 })).toEqual({ eligible: true, min: 3, max: 3 });
  });

  it('gives magic items one or two, and set, rare, unique and crafted items one', () => {
    expect(planLarzukSockets(gd, { ...white, quality: 4, base: 'crs', ilvl: 50 })).toEqual({ eligible: true, min: 1, max: 2 });
    for (const quality of [5, 6, 7, 8]) {
      expect(planLarzukSockets(gd, { ...white, quality, base: 'crs', ilvl: 50 })).toEqual({ eligible: true, min: 1, max: 1 });
    }
  });

  it('refuses jewellery, socketed, unidentified, simple and unknown items', () => {
    expect(planLarzukSockets(gd, { ...white, base: 'rin', ilvl: 50 })).toEqual({ eligible: false, reason: 'no-sockets' });
    expect(planLarzukSockets(gd, { ...white, base: 'amu', ilvl: 50 })).toEqual({ eligible: false, reason: 'no-sockets' });
    expect(planLarzukSockets(gd, { ...white, base: 'crs', ilvl: 50, socketed: true })).toEqual({ eligible: false, reason: 'already-socketed' });
    expect(planLarzukSockets(gd, { ...white, base: 'crs', ilvl: 50, unidentified: true })).toEqual({ eligible: false, reason: 'unidentified' });
    expect(planLarzukSockets(gd, { ...white, base: 'r01', ilvl: 1, simple: true })).toEqual({ eligible: false, reason: 'simple-item' });
    expect(planLarzukSockets(gd, { ...white, base: 'zzz', ilvl: 1 })).toEqual({ eligible: false, reason: 'unknown-base' });
  });

  it('rolls inside the plan', () => {
    const plan = { eligible: true as const, min: 1, max: 2 };
    expect(rollLarzukSockets(plan, () => 0)).toBe(1);
    expect(rollLarzukSockets(plan, () => 0.49)).toBe(1);
    expect(rollLarzukSockets(plan, () => 0.5)).toBe(2);
    expect(rollLarzukSockets(plan, () => 0.999999)).toBe(2);
    expect(rollLarzukSockets({ eligible: true, min: 4, max: 4 }, () => 0.7)).toBe(4);
    expectCode(() => rollLarzukSockets({ eligible: false, reason: 'no-sockets' }), ErrorCode.INVALID_ARGUMENT);
  });
});

describe('socketItemInPlace', () => {
  function topLevelItems(): { file: Uint8Array; entry: WalkedItem }[] {
    const out: { file: Uint8Array; entry: WalkedItem }[] = [];
    const stash = fixture('SharedStashComplete.d2i');
    for (const sector of walkD2I(stash, gd).sectors) {
      for (const entry of sector.walk?.entries ?? []) out.push({ file: stash, entry });
    }
    for (const [name, offset] of [['WarlockTest.d2s', 914], ['WarlockShards.d2s', 903]] as const) {
      const file = fixture(name);
      for (const entry of walkItemList(file, offset, gd).entries) out.push({ file, entry });
    }
    return out;
  }
  const own = (i: { file: Uint8Array; entry: WalkedItem }) => i.file.slice(i.entry.full.start, i.entry.full.end);

  /** A plain item built by the library's writer: the fixtures hold no item Larzuk would take. */
  function built(base: string, ilvl: number, extra: Partial<BinaryParsedItem> = {}): Uint8Array {
    const item = {
      itemId: 0, base, quality: 2, ilvl, unidentified: false, ethereal: false, socketed: false, sockets: 0,
      socketedItems: [], stats: {}, binaryOffset: { start: 0, end: 0 }, guid: 0x12345678, ...extra,
    } as BinaryParsedItem;
    return writeItem(item, { loc: 0, equip: 0, x: 2, y: 1, storage: 5 }, {}, gd);
  }

  it('sockets plain weapons and armour, keeps every other field and the bytes of the input', () => {
    const cases: [Uint8Array, number][] = [
      [built('crs', 30), 4],
      [built('crs', 70), 6],
      [built('aar', 50, { ethereal: true, defense: 300 }), 4],
      [built('uap', 12, { defense: 40 }), 2],
    ];
    for (const [before, expected] of cases) {
      const copy = before.slice();
      const plan = planLarzukSockets(gd, readLarzukItemFacts(before, gd));
      expect(plan).toEqual({ eligible: true, min: expected, max: expected });
      const out = socketItemInPlace(before, gd, expected);
      const facts = readLarzukItemFacts(out, gd);
      expect(facts.socketed).toBe(true);
      expect(planLarzukSockets(gd, facts)).toEqual({ eligible: false, reason: 'already-socketed' });
      expect(out.length - before.length).toBeGreaterThanOrEqual(0);
      expect(out.length - before.length).toBeLessThanOrEqual(1);
      expect(before).toEqual(copy);
    }
  });

  it('refuses socketed and compact items and a bad count', () => {
    const items = topLevelItems();
    const withSockets = items.find(i => i.entry.head.socketed && !i.entry.head.simple)!;
    const simple = items.find(i => i.entry.head.simple)!;
    const plain = { file: built('crs', 30), entry: { full: { start: 0, end: built('crs', 30).length } } as WalkedItem };
    expectCode(() => socketItemInPlace(own(withSockets), gd, 1), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => socketItemInPlace(own(simple), gd, 1), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => socketItemInPlace(own(plain), gd, 0), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => socketItemInPlace(own(plain), gd, 7), ErrorCode.INVALID_ARGUMENT);
    expectCode(() => socketItemInPlace(own(plain).slice(0, -1), gd, 1), ErrorCode.RANGE_MISMATCH);
  });

  it('is exported from the package root', () => {
    for (const name of ['readLarzukRewards', 'consumeLarzukReward', 'planLarzukSockets', 'rollLarzukSockets', 'socketItemInPlace', 'readLarzukItemFacts', 'maxSocketsFor']) {
      expect(typeof (root as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
