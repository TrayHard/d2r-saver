/**
 * Save shapes found by reading every live save (2026-10-30). The bytes here are synthetic; the shapes
 * are the ones the game wrote: a UTF-8 name past 16 bytes, characters without the optional tail
 * sections, ears with 8-bit names, `sth` in the unique form, and potions that kept `loc` 2.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { D2RSaver, encodeMaterialRecord, materialEncodingVerified, materialRecordEncodeInput, readMaterialsD2I } from '../src/index.js';
import { BitWriter } from '../src/core/binary-writer.js';
import { computeChecksum } from '../src/core/checksum.js';
import { D2I_LIST_COUNT_OFFSET, D2I_SECTOR_SIZE_OFFSET, readU16, readU32, writeU16, writeU32 } from '../src/operations/verify-diff.js';

const saver = D2RSaver.fromData(JSON.parse(readFileSync('data/data.json', 'utf8')), JSON.parse(readFileSync('data/strings.json', 'utf8')));
const buyer = new Uint8Array(readFileSync('test/fixtures/MaterialsTabBuyer.d2i'));

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
function withRecord(record: Uint8Array): Uint8Array {
  const out = new Uint8Array(buyer.length + record.length);
  out.set(buyer, 0);
  out.set(record, buyer.length);
  writeU16(out, D2I_LIST_COUNT_OFFSET, readU16(buyer, D2I_LIST_COUNT_OFFSET) + 1);
  writeU32(out, D2I_SECTOR_SIZE_OFFSET, readU32(buyer, D2I_SECTOR_SIZE_OFFSET) + record.length);
  return out;
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

describe('realm data', () => {
  it('skips the 128 bits of realm data for a base outside the misc group', () => {
    const w = new BitWriter();
    w.writeUInt32(0x00800010); // identified, bit 23
    w.writeUInt8(5, 3);
    w.writeUInt8(0, 3).writeUInt8(0, 4).writeUInt8(0, 4).writeUInt8(0, 4).writeUInt8(5, 3);
    for (const ch of 'box ') w.writeChar(ch);
    w.writeUInt8(0, 3); // sockets
    w.writeUInt32(5); // guid
    w.writeUInt8(13, 7).writeUInt8(2, 4); // ilvl, normal quality
    w.writeUInt8(0, 2); // icon and automod flags
    w.writeUInt8(1, 1); // realm flag
    for (let i = 0; i < 4; i++) w.writeUInt32(0x1ff01ff0 + i);
    w.writeUInt8(0, 1); // pre-stats quantity flag
    w.writeUInt16(0x1ff, 9); // stats terminator
    w.writeUInt8(0, 1); // post-stats quantity flag
    w.align();
    const record = w.toArray();
    const rune = encodeMaterialRecord(saver.gd, { family: 'simple', code: 'r01', quantity: 1 });
    const list = Uint8Array.from([0x4a, 0x4d, 2, 0, ...record, ...rune]);
    const walk = saver.walkItemList(list, 0, { expectedEnd: list.length });
    expect(walk.report.error).toBeNull();
    expect(walk.report.complete).toBe(true);
    expect(walk.entries[0].full.end).toBe(4 + record.length);
    expect(walk.entries[1].head.base).toBe('r01');
  });
});

describe('materials records', () => {
  it('reads and re-encodes sth in the unique form', () => {
    const record = encodeMaterialRecord(saver.gd, { family: 'complex', code: 'sth', quantity: 11, guid: 5, ilvl: 98 });
    const report = readMaterialsD2I(withRecord(record), saver.gd, { sectorOffset: 0 });
    expect(report.records.at(-1)).toMatchObject({ code: 'sth', uniqueForm: true, quantity: 11, layoutOk: true, layoutIssue: null });
    expect(record.length).toBe(19);
  });

  it('recognises the unique form from the record, for any complex code', () => {
    const record = encodeMaterialRecord(saver.gd, { family: 'complex', code: 'pk1', quantity: 2, guid: 5, ilvl: 98, uniqueForm: true });
    const tab = withRecord(record);
    const report = readMaterialsD2I(tab, saver.gd, { sectorOffset: 0 });
    expect(report.records.at(-1)).toMatchObject({ code: 'pk1', uniqueForm: true, layoutOk: true });
    expect(materialEncodingVerified(tab, saver.gd, report, 'complex')).toBe(true);
  });

  it('reads a potion that kept loc 2 and proves its encoding', () => {
    const record = encodeMaterialRecord(saver.gd, { family: 'simple', code: 'rvl', quantity: 1, loc: 2 });
    const tab = withRecord(record);
    const report = readMaterialsD2I(tab, saver.gd, { sectorOffset: 0 });
    const read = report.records.at(-1)!;
    expect(read).toMatchObject({ code: 'rvl', loc: 2, quantity: 1, layoutOk: true });
    expect(encodeMaterialRecord(saver.gd, materialRecordEncodeInput(read))).toEqual(record);
  });
});
