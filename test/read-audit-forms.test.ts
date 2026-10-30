/**
 * Save shapes found by reading every live save (2026-10-30). The bytes here are synthetic; the shapes
 * are the ones the game wrote: a UTF-8 name past 16 bytes, characters without the optional tail
 * sections, and ears with 8-bit names.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { D2RSaver, encodeMaterialRecord } from '../src/index.js';
import { BitWriter } from '../src/core/binary-writer.js';
import { computeChecksum } from '../src/core/checksum.js';

const saver = D2RSaver.fromData(JSON.parse(readFileSync('data/data.json', 'utf8')), JSON.parse(readFileSync('data/strings.json', 'utf8')));

function fix(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(8, out.length, true);
  view.setUint32(12, computeChecksum(out), true);
  return out;
}
function character(): Uint8Array {
  const profile = saver.readD2S(readFileSync('test/fixtures/WarlockShards.d2s')).profile;
  return saver.writeD2S({ ...profile, items: {}, mercItems: {}, inventory: [], cube: [], stash: [], belt: [],
    rawCorpse: undefined, rawGolem: undefined, extraSections: undefined }, {});
}

describe('character name', () => {
  it('reads a UTF-8 name longer than 16 bytes', () => {
    const name = 'Тёмный_Паладин'; // 27 bytes
    const bytes = character();
    bytes.fill(0, 299, 299 + 96);
    bytes.set(new TextEncoder().encode(name), 299);
    expect(saver.readD2S(fix(bytes)).profile.name).toBe(name);
  });
});

describe('optional character sections', () => {
  it('certifies a character without the demon section', () => {
    const source = character();
    const start = saver.readD2S(source).demons!.headerOffset;
    const parsed = saver.readD2S(fix(source.subarray(0, start)));
    expect(parsed.demons).toBeNull();
    expect(parsed.coverage.complete).toBe(true);
    expect(parsed.coverage.reachedEof).toBe(true);
    expect(parsed.coverage.endOffset).toBe(start);
    expect(parsed.coverage.sections.map(section => section.kind)).toEqual(['header-stats-skills', 'main', 'corpses', 'mercenary', 'golem']);
  });

  it('certifies a classic character that ends after its corpses, and only a classic one', () => {
    const source = character();
    const corpseEnd = saver.readD2S(source).coverage.sections.find(section => section.kind === 'corpses')!.end;
    const classic = source.slice(0, corpseEnd);
    classic[20] &= ~0x20;
    const parsed = saver.readD2S(fix(classic));
    expect(parsed.coverage.complete).toBe(true);
    expect(parsed.coverage.endOffset).toBe(corpseEnd);
    expect(parsed.coverage.sections.map(section => section.kind)).toEqual(['header-stats-skills', 'main', 'corpses']);

    const expansion = source.slice(0, corpseEnd);
    expansion[20] |= 0x20;
    expect(saver.readD2S(fix(expansion)).coverage.complete).toBe(false);
  });
});

describe('ear items', () => {
  function ear(name: string): Uint8Array {
    const w = new BitWriter();
    w.writeUInt32(0x00810010); // identified, ear, bit 23
    w.writeUInt8(5, 3); // item version
    w.writeUInt8(0, 3).writeUInt8(0, 4).writeUInt8(1, 4).writeUInt8(0, 4).writeUInt8(5, 3);
    w.writeUInt8(2, 3).writeUInt8(64, 7); // class, level
    for (const byte of new TextEncoder().encode(name)) w.writeUInt8(byte, 8);
    w.writeUInt8(0, 8);
    w.writeUInt8(0, 2); // realm and post-stats quantity flags
    w.align();
    return w.toArray();
  }

  it('keeps the next item aligned for any name, UTF-8 included', () => {
    const rune = encodeMaterialRecord(saver.gd, { family: 'simple', code: 'r01', quantity: 1 });
    for (const name of ['A', 'Ab', 'Abcdefg', 'Abcdefgh', 'Abcdefghijklmnop', 'Ухо', 'Тёмный_Паладин']) {
      const record = ear(name);
      const list = Uint8Array.from([0x4a, 0x4d, 2, 0, ...record, ...rune]);
      const walk = saver.walkItemList(list, 0, { expectedEnd: list.length });
      expect(walk.report.complete, name).toBe(true);
      expect(walk.entries[0].item.ear!.name).toBe(name);
      expect(walk.entries[0].full.end).toBe(4 + record.length);
      expect(walk.entries[1].head.base).toBe('r01');
    }
  });
});
