/**
 * Legacy v99 saves are read-only. The bytes here are synthetic; the shapes come from reading every
 * v99 file on the realm and from BGS D2SSharp: quantity without a flag, no post-stats fields, shorter header.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { D2RSaver } from '../src/index.js';
import { BitWriter } from '../src/core/binary-writer.js';
import { computeChecksum } from '../src/core/checksum.js';

const saver = D2RSaver.fromData(JSON.parse(readFileSync('data/data.json', 'utf8')), JSON.parse(readFileSync('data/strings.json', 'utf8')));

function head(w: BitWriter, flags: number, code?: string): void {
  w.writeUInt32(flags);
  w.writeUInt8(5, 3);
  w.writeUInt8(0, 3).writeUInt8(0, 4).writeUInt8(0, 4).writeUInt8(0, 4).writeUInt8(5, 3);
  if (code) for (const ch of `${code} `) w.writeChar(ch);
}
function compact(code: string): Uint8Array {
  const w = new BitWriter();
  head(w, 0x00a00010, code);
  w.writeUInt8(0, 1); // realm flag; v99 has no post-stats quantity flag
  w.align();
  return w.toArray();
}
function stackable(code: string, quantity: number): Uint8Array {
  const w = new BitWriter();
  head(w, 0x00800010, code);
  w.writeUInt8(0, 3); // sockets
  w.writeUInt32(5); // guid
  w.writeUInt8(13, 7).writeUInt8(2, 4); // ilvl, normal quality
  w.writeUInt8(0, 2); // icon and automod flags
  w.writeUInt8(0, 1); // realm flag
  w.writeUInt16(quantity, 9); // no presence flag
  w.writeUInt16(0x1ff, 9); // stats terminator
  w.align();
  return w.toArray();
}
function ear(name: string): Uint8Array {
  const w = new BitWriter();
  head(w, 0x00810010);
  w.writeUInt8(2, 3).writeUInt8(64, 7);
  for (const byte of new TextEncoder().encode(name)) w.writeUInt8(byte, 8);
  w.writeUInt8(0, 8);
  w.writeUInt8(0, 1); // realm flag
  w.align();
  return w.toArray();
}
function tab(items: Uint8Array[]): Uint8Array {
  const list = Uint8Array.from([0x4a, 0x4d, items.length, 0, ...items.flatMap(item => [...item])]);
  const out = new Uint8Array(64 + list.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xaa55aa55, true);
  view.setUint32(8, 99, true);
  view.setUint32(16, out.length, true);
  out.set(list, 64);
  return out;
}
const STATS_V105 = 833;
const STATS_V99 = 765;
function character(name: string): Uint8Array {
  const parsed = saver.readD2S(readFileSync('test/fixtures/WarlockShards.d2s'));
  const v105 = saver.writeD2S({ ...parsed.profile, items: {}, mercItems: {}, inventory: [], cube: [], stash: [], belt: [],
    rawCorpse: undefined, rawGolem: undefined, extraSections: undefined }, {});
  const end = saver.readD2S(v105).demons!.headerOffset;
  const out = new Uint8Array(STATS_V99 + end - STATS_V105);
  out.set(v105.subarray(STATS_V105, end), STATS_V99);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xaa55aa55, true);
  view.setUint32(4, 99, true);
  view.setUint32(8, out.length, true);
  out[36] = 0x20; // expansion
  out[40] = 1;
  out.set(new TextEncoder().encode(name), 267);
  view.setUint32(12, computeChecksum(out), true);
  return out;
}

describe('legacy v99 stash tab', () => {
  it('reads quantity without a flag and keeps every item aligned', () => {
    const items = [stackable('key', 7), ear('Ухо'), compact('r01')];
    const report = saver.walkLegacyD2I(tab(items));
    const walk = report.sectors[0].walk!;
    expect(report.tiled).toBe(true);
    expect(walk.report.complete).toBe(true);
    expect(walk.entries[0].item.quantity).toBe(7);
    expect(walk.entries[0].full.end).toBe(68 + items[0].length);
    expect(walk.entries[1].item.ear!.name).toBe('Ухо');
    expect(walk.entries[2].head.base).toBe('r01');
  });

  it('never reaches the v105 walk the in-place operations use', () => {
    const report = saver.walkD2I(tab([compact('r01')]));
    expect(report.tiled).toBe(false);
    expect(report.sectors).toEqual([]);
  });
});

describe('legacy v99 character', () => {
  it('certifies the file through its end from the shorter header', () => {
    const parsed = saver.readLegacyD2S(character('Тёмный_Паладин'));
    expect(parsed.coverage.error).toBeNull();
    expect(parsed.coverage.complete).toBe(true);
    expect(parsed.profile.name).toBe('Тёмный_Паладин');
    expect(parsed.profile.class).toBe('sor');
  });

  it('is read-only: the v105 reader and the writer both refuse it', () => {
    const bytes = character('A');
    expect(() => saver.readD2S(bytes)).toThrow('invalid d2s header');
    expect(() => saver.writeD2S(saver.readLegacyD2S(bytes).profile, {})).toThrow('read-only');
  });

  it('rejects a v105 file', () => {
    expect(() => saver.readLegacyD2S(new Uint8Array(readFileSync('test/fixtures/WarlockShards.d2s')))).toThrow('invalid v99 d2s header');
  });
});

describe('compact item realm flag', () => {
  it('skips 128 bits of realm data and starts no socket children', () => {
    const w = new BitWriter();
    head(w, 0x00a00010, 'r01');
    w.writeUInt8(1, 1); // realm flag
    for (let i = 0; i < 4; i++) w.writeUInt32(0x1ff01ff0 + i);
    w.writeUInt8(0, 1); // post-stats quantity flag
    w.align();
    const record = w.toArray();
    const next = new BitWriter();
    head(next, 0x00a00010, 'r02');
    next.writeUInt8(0, 2);
    next.align();
    const list = Uint8Array.from([0x4a, 0x4d, 2, 0, ...record, ...next.toArray()]);
    const walk = saver.walkItemList(list, 0, { expectedEnd: list.length });
    expect(walk.report.error).toBeNull();
    expect(walk.report.complete).toBe(true);
    expect(walk.entries[0].children).toEqual([]);
    expect(walk.entries[1].head.base).toBe('r02');
  });
});
