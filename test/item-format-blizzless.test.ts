import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { D2RSaver } from '../src/index.js';
import { BitWriter } from '../src/core/binary-writer.js';

// Layouts the game server writes (BGS D2SSharp Item.ReadCompactItem / ReadChronicle). Synthetic bytes only.
const saver = D2RSaver.fromData(JSON.parse(readFileSync('data/data.json', 'utf8')), JSON.parse(readFileSync('data/strings.json', 'utf8')));

interface Spec { code: string; simple?: boolean; chronicle?: { compact: boolean; recipients: number }; questDifficulty?: number }

function item(spec: Spec): Uint8Array {
  const w = new BitWriter();
  // D2 item fields are least-significant bit first; BitWriter.writeBitsNumber writes MSB first.
  const num = (value: number, bits: number) => { for (let i = 0; i < bits; i++) w.writeBit(Math.floor(value / 2 ** i) % 2); return chain; };
  const chain = { num };
  const flags = new Array<number>(35).fill(0);
  flags[4] = 1; // identified
  if (spec.simple) flags[21] = 1;
  if (spec.chronicle) { flags[28] = 1; flags[29] = spec.chronicle.compact ? 1 : 0; }
  for (const bit of flags) w.writeBit(bit);
  num(0, 3).num(0, 4).num(0, 4).num(0, 4).num(5, 3); // stored in stash at 0,0
  for (const ch of spec.code.padEnd(4, ' ')) w.writeChar(ch);
  if (spec.simple) {
    if (spec.questDifficulty !== undefined) num(spec.questDifficulty, 2);
    w.writeBit(0); // socket count
  } else {
    num(0, 3); // socket count
    num(0x12345678, 32).num(80, 7).num(2, 4); // guid, ilvl, normal quality
    w.writeBit(0).writeBit(0); // no icon, no automagic
    w.writeBit(0); // no realm data
    w.writeBit(0); // no pre-stats quantity
    num(511, 9); // empty stat list
    if (spec.chronicle) {
      num(7, 16); // chronicle id
      if (!spec.chronicle.compact) num(0xabcdef01, 32).num(spec.chronicle.recipients, 4);
      for (let i = 0; i < (spec.chronicle.compact ? 1 : spec.chronicle.recipients); i++) num(0xffffffff, 32).num(i + 1, 32);
    }
    w.writeBit(0); // no post-stats quantity
  }
  w.align();
  return w.toArray();
}

function walk(specs: Spec[]) {
  const parts = specs.map(item);
  const list = new Uint8Array(4 + parts.reduce((n, p) => n + p.length, 0));
  list.set([0x4a, 0x4d, specs.length, 0]);
  let at = 4;
  for (const p of parts) { list.set(p, at); at += p.length; }
  return saver.walkItemList(list, 0, { expectedEnd: list.length });
}

describe('Blizzless item layouts', () => {
  it('reads a compact quest item difficulty before its socket bit and keeps the next item aligned', () => {
    const result = walk([{ code: 'mss', simple: true, questDifficulty: 2 }, { code: 'r01', simple: true }]);
    expect(result.report.complete).toBe(true);
    expect(result.entries.map(e => e.head.base)).toEqual(['mss', 'r01']);
    expect(result.entries[0].item.questDifficulty).toBe(2);
    expect(result.entries[0].children).toEqual([]);
  });

  it('reads no difficulty for a mod quest-type item without questdiffcheck', () => {
    const result = walk([{ code: 'p20', simple: true }, { code: 'r01', simple: true }]);
    expect(result.report.complete).toBe(true);
    expect(result.entries[0].item.questDifficulty).toBeUndefined();
    expect(saver.gd.items.p20?.invwidth).toBe(1);
  });

  it.each([0, 1, 2, 3, 8])('skips a chronicle with %i recipients', recipients => {
    const result = walk([{ code: 'rin', chronicle: { compact: false, recipients } }, { code: 'r01', simple: true }]);
    expect(result.report.complete).toBe(true);
    expect(result.entries.map(e => e.head.base)).toEqual(['rin', 'r01']);
  });

  it('skips a compact chronicle as one recipient without timestamp or count', () => {
    const result = walk([{ code: 'rin', chronicle: { compact: true, recipients: 1 } }, { code: 'r01', simple: true }]);
    expect(result.report.complete).toBe(true);
    expect(result.entries.map(e => e.head.base)).toEqual(['rin', 'r01']);
  });
});
