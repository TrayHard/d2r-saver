/**
 * Node `Buffer` inputs. `fs.readFile`, HTTP bodies, S3 objects, `Buffer.from(base64)` and
 * Prisma `bytea` all hand out `Buffer`, a `Uint8Array` subclass whose `slice()` returns a VIEW
 * of the same memory instead of a copy. Every other test wraps the fixtures in
 * `new Uint8Array(...)`, so this file is the only place where aliasing would show: the in-place
 * API must leave a `Buffer` input untouched and must hand back results that share no memory
 * with it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GameData } from '../src/game-data/game-data.js';
import { readD2I } from '../src/formats/d2i-reader.js';
import { walkD2I, patchItemPosition, zeroItemPosition, readItemPosition, readItemHead } from '../src/formats/item-walker.js';
import { extractInPlaceD2I, insertInPlaceD2I } from '../src/operations/inplace-d2i.js';
import { verifyExactDiff, type DiffSpec } from '../src/operations/verify-diff.js';
import { D2RSaverError, ErrorCode } from '../src/types/errors.js';

const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');
const FIXTURES = resolve(import.meta.dirname!, 'fixtures');

const COMPLETE = 1285;        // the complete sector of SharedStashComplete.d2i
const EMPTY = 1644;           // first empty sector of SharedStashComplete.d2i
const ITEM0 = { start: 1353, end: 1393 }; // item 0 of the complete sector (cm1 @9,7)

let gd: GameData;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const fileBuffer = () => readFileSync(resolve(FIXTURES, 'SharedStashComplete.d2i')); // a Buffer, unwrapped
const sharesMemory = (a: Uint8Array, b: Uint8Array) => a.buffer === b.buffer;

beforeAll(() => {
  const rawData = JSON.parse(readFileSync(resolve(DATA_DIR, 'data.json'), 'utf-8'));
  const locale = JSON.parse(readFileSync(resolve(DATA_DIR, 'strings.json'), 'utf-8'));
  gd = GameData.fromRaw(rawData, locale);
});

describe('Buffer semantics this file relies on', () => {
  it('Buffer#slice is a view, new Uint8Array(buffer) is a copy', () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    expect(sharesMemory(buf.slice(1, 3), buf)).toBe(true);
    const copy = new Uint8Array(buf);
    expect(sharesMemory(copy, buf)).toBe(false);
    expect(copy.byteOffset).toBe(0);
    expect(copy.length).toBe(4);
  });
});

describe('patchItemPosition / zeroItemPosition on a Buffer', () => {
  it('do not modify the input and return a copy in its own ArrayBuffer', () => {
    const file = fileBuffer();
    const item = Buffer.from(file.subarray(ITEM0.start, ITEM0.end)); // a small Buffer: lives in the shared pool
    const pristine = Buffer.from(item);
    expect(readItemPosition(item)).toEqual({ loc: 0, bodyloc: 0, col: 9, row: 7, storage: 5 });

    const moved = patchItemPosition(item, { loc: 0, bodyloc: 0, col: 1, row: 1, storage: 5 });
    expect(item.equals(pristine)).toBe(true);
    expect(sharesMemory(moved, item)).toBe(false);
    expect(moved.byteOffset).toBe(0);
    expect(moved.length).toBe(item.length);
    expect(readItemPosition(moved)).toEqual({ loc: 0, bodyloc: 0, col: 1, row: 1, storage: 5 });
    expect(readItemHead(moved)).toEqual({ ...readItemHead(item), col: 1, row: 1 });

    const zeroed = zeroItemPosition(item);
    expect(item.equals(pristine)).toBe(true);
    expect(sharesMemory(zeroed, item)).toBe(false);
    expect(readItemPosition(zeroed)).toEqual({ loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
    // Same bytes as the Uint8Array path.
    expect(Buffer.from(zeroed).equals(Buffer.from(zeroItemPosition(new Uint8Array(item))))).toBe(true);
  });

  it('a Buffer view into the whole file: only the copy changes, the file keeps its position bits', () => {
    const file = fileBuffer();
    const hash = sha256(file);
    const view = file.subarray(ITEM0.start, ITEM0.end); // Buffer#subarray: a view, no copy
    const out = zeroItemPosition(view);
    expect(sha256(file)).toBe(hash);
    expect(readItemPosition(file, ITEM0.start)).toEqual({ loc: 0, bodyloc: 0, col: 9, row: 7, storage: 5 });
    expect(sharesMemory(out, file)).toBe(false);
  });
});

describe('extractInPlaceD2I on a Buffer straight from readFileSync', () => {
  it('leaves the input byte-identical; newBuffer and removed[].bytes share no memory with it', () => {
    const file = fileBuffer();
    const pristine = Buffer.from(file);
    const hash = sha256(file);

    const cut = extractInPlaceD2I(file, { sectorOffset: COMPLETE, indexes: [0] }, gd);

    expect(file.equals(pristine)).toBe(true);
    expect(sha256(file)).toBe(hash);
    expect(readItemPosition(file, ITEM0.start)).toEqual({ loc: 0, bodyloc: 0, col: 9, row: 7, storage: 5 });
    expect(sharesMemory(cut.newBuffer, file)).toBe(false);
    expect(sharesMemory(cut.removed[0].bytes, file)).toBe(false);
    expect(cut.removed[0].bytes.byteOffset).toBe(0);
    expect(cut.removed[0].range).toEqual(ITEM0);
    expect(readItemPosition(cut.removed[0].bytes)).toEqual({ loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
    expect(cut.removed[0].head).toMatchObject({ base: 'cm1', col: 9, row: 7, storage: 5 });

    // The Buffer path and the Uint8Array path agree byte for byte.
    const viaUint8 = extractInPlaceD2I(new Uint8Array(pristine), { sectorOffset: COMPLETE, indexes: [0] }, gd);
    expect(Buffer.from(cut.newBuffer).equals(Buffer.from(viaUint8.newBuffer))).toBe(true);
    expect(Buffer.from(cut.removed[0].bytes).equals(Buffer.from(viaUint8.removed[0].bytes))).toBe(true);
    expect(cut.diff).toEqual(viaUint8.diff);
    expect(verifyExactDiff(file, cut.newBuffer, cut.diff).ok).toBe(true);
    expect(file.equals(pristine)).toBe(true);
  });

  it('cutting several items at once: the "before" the caller keeps for gate 6 is still the original', () => {
    const file = fileBuffer();
    const pristine = Buffer.from(file);
    const cut = extractInPlaceD2I(file, { sectorOffset: COMPLETE, indexes: [8, 3, 1] }, gd);
    expect(file.equals(pristine)).toBe(true);
    expect(cut.removed.map(r => r.index)).toEqual([1, 3, 8]);
    for (const r of cut.removed) {
      expect(sharesMemory(r.bytes, file)).toBe(false);
      expect(readItemPosition(r.bytes)).toEqual({ loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
      expect(readItemPosition(file, r.range.start)).toEqual({ loc: 0, bodyloc: 0, col: r.head.col, row: r.head.row, storage: 5 });
    }
    // The original still walks as a complete 9-item sector.
    expect(walkD2I(file, gd).sectors[2].walk!.report).toMatchObject({ declared: 9, parsed: 9, complete: true });
  });
});

describe('insertInPlaceD2I with a Buffer file and Buffer item bytes', () => {
  it('modifies neither the file nor the item bytes; diff.inserts[].bytes and newBuffer are copies', () => {
    const file = fileBuffer();
    const cut = extractInPlaceD2I(new Uint8Array(file), { sectorOffset: COMPLETE, indexes: [0] }, gd);
    const shrunk = Buffer.from(cut.newBuffer);          // what a backend would hold after a previous step
    const shrunkPristine = Buffer.from(shrunk);
    const item = Buffer.from(cut.removed[0].bytes);     // e.g. bytes read back from bytea / base64
    const itemPristine = Buffer.from(item);

    const back = insertInPlaceD2I(shrunk, { sectorOffset: COMPLETE, listIndex: 0 }, [{ bytes: item, col: 9, row: 7 }], gd);

    expect(shrunk.equals(shrunkPristine)).toBe(true);
    expect(item.equals(itemPristine)).toBe(true);
    expect(readItemPosition(item)).toEqual({ loc: 0, bodyloc: 0, col: 0, row: 0, storage: 0 });
    expect(sharesMemory(back.newBuffer, shrunk)).toBe(false);
    const inserts = (back.diff as Extract<DiffSpec, { kind: 'd2i-insert' }>).inserts;
    expect(inserts).toHaveLength(1);
    expect(sharesMemory(inserts[0].bytes!, item)).toBe(false);
    expect(sharesMemory(inserts[0].bytes!, shrunk)).toBe(false);
    expect(sharesMemory(inserts[0].bytes!, back.newBuffer)).toBe(false);
    expect(readItemPosition(inserts[0].bytes!)).toEqual({ loc: 0, bodyloc: 0, col: 9, row: 7, storage: 5 });

    // Round trip restores the original file byte for byte.
    expect(Buffer.from(back.newBuffer).equals(file)).toBe(true);
    expect(verifyExactDiff(shrunk, back.newBuffer, back.diff).ok).toBe(true);
    expect(shrunk.equals(shrunkPristine)).toBe(true);
  });

  it('two Buffer items into an empty sector: both inputs intact after the call', () => {
    const file = fileBuffer();
    const cut = extractInPlaceD2I(file, { sectorOffset: COMPLETE, indexes: [1, 3] }, gd); // ci2 2x2, rin
    const items = cut.removed.map(r => Buffer.from(r.bytes));
    const pristine = items.map(b => Buffer.from(b));
    const target = Buffer.from(cut.newBuffer);
    const targetPristine = Buffer.from(target);
    const ins = insertInPlaceD2I(target, { sectorOffset: EMPTY - 68 }, [
      { bytes: items[0], col: 14, row: 11 },
      { bytes: items[1], col: 0, row: 0 },
    ], gd);
    expect(items[0].equals(pristine[0])).toBe(true);
    expect(items[1].equals(pristine[1])).toBe(true);
    expect(target.equals(targetPristine)).toBe(true);
    expect(ins.inserted.map(i => `${i.head.base}@${i.head.col},${i.head.row}`)).toEqual(['ci2@14,11', 'rin@0,0']);
    expect(ins.newBuffer.length).toBe(file.length);
  });
});

describe('read-only entry points on a Buffer', () => {
  it('walkD2I, readD2I and verifyExactDiff leave the Buffer untouched', () => {
    const file = fileBuffer();
    const hash = sha256(file);
    const report = walkD2I(file, gd);
    expect(report.tiled).toBe(true);
    expect(report.sectors[2].walk!.report).toMatchObject({ declared: 9, parsed: 9, complete: true });
    expect(readD2I(file, gd).pages.find(p => p.offset === COMPLETE)!.list).toMatchObject({ declared: 9, parsed: 9 });
    const cut = extractInPlaceD2I(file, { sectorOffset: COMPLETE, indexes: [4] }, gd);
    expect(verifyExactDiff(file, Buffer.from(cut.newBuffer), cut.diff).ok).toBe(true);
    expect(sha256(file)).toBe(hash);
  });
});

describe('DiffSpec through JSON', () => {
  it('d2i-remove survives; d2i-insert with bytes fails closed with INVALID_ARGUMENT', () => {
    const file = new Uint8Array(fileBuffer());
    const cut = extractInPlaceD2I(file, { sectorOffset: COMPLETE, indexes: [2] }, gd);
    const removeSpec = JSON.parse(JSON.stringify(cut.diff)) as DiffSpec;
    expect(verifyExactDiff(file, cut.newBuffer, removeSpec).ok).toBe(true);

    const back = insertInPlaceD2I(cut.newBuffer, { sectorOffset: COMPLETE, listIndex: 2 }, [{ bytes: cut.removed[0].bytes, col: 8, row: 0 }], gd);
    const insertSpec = JSON.parse(JSON.stringify(back.diff)) as DiffSpec;
    let caught: unknown;
    try { verifyExactDiff(cut.newBuffer, back.newBuffer, insertSpec); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(D2RSaverError);
    expect((caught as D2RSaverError).code).toBe(ErrorCode.INVALID_ARGUMENT);
    expect((caught as D2RSaverError).message).toMatch(/inserts\[0\]\.bytes must be a Uint8Array/);

    // Decoding the bytes back (here: from the JSON object's numeric keys) makes the spec valid again.
    const decoded = {
      ...insertSpec,
      inserts: (insertSpec as Extract<DiffSpec, { kind: 'd2i-insert' }>).inserts.map(ins => ({
        ...ins,
        bytes: Uint8Array.from(Object.values(ins.bytes as unknown as Record<string, number>)),
      })),
    } as DiffSpec;
    expect(verifyExactDiff(cut.newBuffer, back.newBuffer, decoded).ok).toBe(true);
    // Dropping the bytes is also valid: the gap is then simply not compared.
    const unchecked = {
      ...insertSpec,
      inserts: (insertSpec as Extract<DiffSpec, { kind: 'd2i-insert' }>).inserts.map(({ at, length }) => ({ at, length })),
    } as DiffSpec;
    expect(verifyExactDiff(cut.newBuffer, back.newBuffer, unchecked).ok).toBe(true);
  });
});
