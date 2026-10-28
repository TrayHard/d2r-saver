import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { D2RSaver, readD2SDemonSection } from '../src/index.js';
import { BitWriter } from '../src/core/binary-writer.js';
import { computeChecksum } from '../src/core/checksum.js';

const saver = D2RSaver.fromData(JSON.parse(readFileSync('data/data.json', 'utf8')), JSON.parse(readFileSync('data/strings.json', 'utf8')));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function section(stats: Array<[number, number]> = [[6, 1], [7, 2], [12, 80], [13, 0xffffffff]]): Uint8Array {
  const writer = new BitWriter();
  writer.writeUInt16(0x6667);
  for (const [id, value] of stats) writer.writeUInt16(id, 9).writeUInt32(value);
  writer.writeUInt16(0x1ff, 9).align();
  const blob = writer.toArray();
  const bytes = new Uint8Array(6 + 92 + blob.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 0x666c, true); view.setUint16(4, 1, true);
  view.setUint16(6, blob.length, true); view.setUint16(8, 1, true); view.setUint16(10, 1, true);
  bytes.set(blob, 98);
  return bytes;
}
function emptySection() { return Uint8Array.from([1, 0, 0x6c, 0x66, 0, 0]); }
function changed(bytes: Uint8Array, at: number, value: number): Uint8Array {
  const out = Uint8Array.from(bytes); out[at] = value; return out;
}
function fix(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes); const view = new DataView(out.buffer);
  view.setUint32(8, out.length, true); view.setUint32(12, computeChecksum(out), true); return out;
}
function cleanCharacter(): Uint8Array {
  const profile = saver.readD2S(readFileSync('test/fixtures/WarlockShards.d2s')).profile;
  return saver.writeD2S({ ...profile, items: {}, mercItems: {}, inventory: [], cube: [], stash: [], belt: [],
    rawCorpse: undefined, rawGolem: undefined, extraSections: undefined }, {});
}
function withTail(tail: Uint8Array): Uint8Array {
  const source = cleanCharacter(); const start = saver.readD2S(source).demons!.headerOffset;
  return fix(Buffer.concat([source.subarray(0, start), tail]));
}

describe('strict v105 demon grammar', () => {
  it('certifies an empty six-byte section at an absolute offset and EOF', () => {
    const bytes = Uint8Array.from([99, 98, ...emptySection()]);
    const parsed = readD2SDemonSection(bytes, 2, saver.gd);
    expect(parsed.complete).toBe(true); expect(parsed.declared).toBe(0); expect(parsed.parsed).toBe(0);
    expect(parsed.endOffset).toBe(bytes.length); expect(parsed.reachedEof).toBe(true);
  });
  it('uses the stat blob size, bounded gf grammar and unsigned 32-bit values', () => {
    const bytes = section(); const parsed = readD2SDemonSection(bytes, 0, saver.gd);
    expect(bytes.length).toBe(122); expect(parsed.complete).toBe(true); expect(parsed.records[0].statDataSize).toBe(24);
    expect(parsed.records[0].descriptor).toEqual({ start: 6, end: 98 });
    expect(parsed.records[0].statsRange).toEqual({ start: 98, end: 122 });
    expect(parsed.records[0].stats.at(-1)?.value).toBe(0xffffffff);
    expect(parsed.parsed).toBe(parsed.declared); expect(parsed.endOffset).toBe(bytes.length);
  });
  it('does not assume every bound demon has a 116-byte payload', () => {
    for (const stats of [[], [[6, 1]], [[6, 1], [7, 2]]] as Array<Array<[number, number]>>) {
      const bytes = section(stats); expect(bytes.length).not.toBe(122);
      expect(readD2SDemonSection(bytes, 0, saver.gd).complete).toBe(true);
    }
  });
  it('rejects every truncated prefix of both supported section forms', () => {
    for (const bytes of [emptySection(), section()]) for (let end = 0; end < bytes.length; end++) {
      expect(readD2SDemonSection(bytes.subarray(0, end), 0, saver.gd).complete, `prefix ${end}`).toBe(false);
    }
  });
  it('rejects unknown version, marker, count, padding, demon type and class zero', () => {
    const bytes = section();
    for (const [at, value] of [[0, 2], [2, 0], [4, 2], [4, 255], [5, 1], [8, 0], [8, 3], [10, 0]]) {
      expect(readD2SDemonSection(changed(bytes, at, value), 0, saver.gd).complete, `field ${at}`).toBe(false);
    }
  });
  it('rejects both stat-size directions, broken gf, duplicates, unknown stats and nonzero alignment bits', () => {
    const bytes = section();
    for (const invalid of [changed(bytes, 6, 23), changed(bytes, 6, 25), changed(bytes, 6, 0), changed(bytes, 98, 0),
      section([[6, 1], [6, 2]]), section([[16, 1]]), section([[510, 1]]), changed(bytes, bytes.length - 1, 0xff)]) {
      expect(readD2SDemonSection(invalid, 0, saver.gd).complete).toBe(false);
    }
  });
  it('rejects missing terminator and bytes after a valid terminator even inside an enlarged blob', () => {
    const bytes = section();
    const noTerminator = Uint8Array.from(bytes); noTerminator[120] = 0; noTerminator[121] = 0;
    expect(readD2SDemonSection(noTerminator, 0, saver.gd).complete).toBe(false);
    const appended = Uint8Array.from([...bytes, 0]); appended[6]++;
    expect(readD2SDemonSection(appended, 0, saver.gd).complete).toBe(false);
  });
  it('rejects unknown suffixes, second sections, and count zero followed by hidden data', () => {
    for (const bytes of [Uint8Array.from([...emptySection(), 0]), Uint8Array.from([...section(), ...emptySection()]),
      changed(section(), 4, 0)]) expect(readD2SDemonSection(bytes, 0, saver.gd).complete).toBe(false);
  });
  it('never aliases or mutates input and rejects invalid offsets', () => {
    const bytes = section(), before = sha(bytes);
    for (const offset of [-1, 0.5, NaN, Infinity, bytes.length + 1]) expect(readD2SDemonSection(bytes, offset, saver.gd).complete).toBe(false);
    readD2SDemonSection(bytes, 0, saver.gd); expect(sha(bytes)).toBe(before);
  });
});

describe('strict whole-character coverage', () => {
  it('certifies generated empty and bound-demon saves with contiguous sections through EOF', () => {
    for (const bytes of [cleanCharacter(), withTail(section())]) {
      const parsed = saver.readD2S(bytes); expect(parsed.warnings.length).toBe(0); expect(parsed.coverage.complete).toBe(true);
      let cursor = 0;
      for (const range of parsed.coverage.sections) { expect(range.start).toBe(cursor); cursor = range.end; }
      expect(cursor).toBe(bytes.length); expect(parsed.coverage.endOffset).toBe(bytes.length);
    }
  });
  it('rejects missing and malformed final sections even with a repaired file checksum', () => {
    const good = cleanCharacter(); const start = saver.readD2S(good).demons!.headerOffset;
    for (const tail of [new Uint8Array(), emptySection().subarray(0, 5), Uint8Array.from([...emptySection(), 0]), changed(emptySection(), 0, 2)]) {
      const parsed = saver.readD2S(fix(Buffer.concat([good.subarray(0, start), tail])));
      expect(parsed.coverage.complete).toBe(false);
    }
  });
  it('rejects corrupt file size and checksum without treating EOF as full coverage', () => {
    const bytes = cleanCharacter();
    for (const at of [8, 12]) expect(saver.readD2S(changed(bytes, at, bytes[at] ^ 1)).coverage.complete).toBe(false);
  });
  it('does not certify the partially parsed public fixtures', () => {
    for (const file of ['WarlockTest', 'WarlockShards']) {
      const parsed = saver.readD2S(readFileSync(`test/fixtures/${file}.d2s`));
      expect(parsed.coverage.complete).toBe(false); expect(parsed.coverage.items.length).toBe(0);
    }
  });
  it('certifies two interleaved corpse records and exposes every physical item range', () => {
    const bytes = cleanCharacter(); const p = saver.readD2S(bytes);
    const corpse = p.coverage.sections.find(s => s.kind === 'corpses')!;
    const corpses = Uint8Array.from([0x4a, 0x4d, 2, 0, ...new Uint8Array(12), 0x4a, 0x4d, 0, 0,
      ...new Uint8Array(12), 0x4a, 0x4d, 0, 0]);
    const out = fix(Buffer.concat([bytes.subarray(0, corpse.start), corpses, bytes.subarray(corpse.end)]));
    const parsed = saver.readD2S(out); expect(parsed.coverage.complete).toBe(true); expect(parsed.lists.corpses.length).toBe(2);
  });
});

const privateDir = process.env.STASH_PRIVATE_GRANT_FIXTURE_DIR;
describe.skipIf(!privateDir)('private SCL3V3 traversal, without embedded private fixtures', () => {
  it('certifies all four real character files and refuses each changed/truncated fl tail', () => {
    for (const [name, expectedCounts] of [['before-response.json', [8, 8]], ['counterpart-before-response.json', [76, 64]]] as const) {
      const responsePath = join(privateDir!, name); const response = readFileSync(responsePath); const digest = sha(response);
      const save = JSON.parse(response.toString('utf8'));
      for (const tab of save.sharedStashTabs) {
        expect(tab.season).toBe(3); expect(tab.gameVersion).toBe(3); expect(tab.hardcore).toBe(false);
        const bytes = Buffer.from(tab.saveData, 'base64'), walked = saver.walkD2I(bytes);
        expect(walked.tiled).toBe(true); expect(walked.reachedEof).toBe(true); expect(walked.sectors.length).toBe(1);
        expect(walked.sectors[0].type).toBe(tab.type); expect(walked.sectors[0].walk?.report.complete).toBe(true);
        if (tab.type === 1) expect(saver.readMaterialsD2I(bytes, { sectorOffset: 0 }).complete).toBe(true);
      }
      for (const [index, character] of save.characters.entries()) {
        const bytes = Buffer.from(character.saveData, 'base64'), original = sha(bytes); const parsed = saver.readD2S(bytes);
        expect(parsed.warnings.length).toBe(0); expect(parsed.coverage.complete).toBe(true); expect(parsed.coverage.reachedEof).toBe(true);
        expect(parsed.coverage.items.length).toBe(expectedCounts[index]);
        expect(parsed.coverage.endOffset).toBe(bytes.length);
        const start = parsed.demons!.headerOffset;
        for (let end = start; end < bytes.length; end++) expect(saver.readD2S(fix(bytes.subarray(0, end))).coverage.complete).toBe(false);
        const bad = changed(bytes, start, 2); expect(saver.readD2S(fix(bad)).coverage.complete).toBe(false);
        const extra = fix(Buffer.concat([bytes, Buffer.from([0])])); expect(saver.readD2S(extra).coverage.complete).toBe(false);
        expect(sha(bytes)).toBe(original);
      }
      expect(sha(readFileSync(responsePath))).toBe(digest);
    }
  });
});

describe('physical item coverage across character sections', () => {
  function physicalItem(socketed: boolean): Uint8Array {
    const stash = readFileSync(socketed ? 'test/fixtures/WarlockTest.d2s' : 'test/fixtures/SharedStashComplete.d2i');
    const entries = socketed
      ? saver.walkItemList(stash, saver.readD2S(stash).lists.main!.headerOffset).entries
      : saver.walkD2I(stash).sectors.flatMap(s => s.walk?.entries ?? []);
    const entry = entries.find(e => socketed ? e.children.length > 0 : e.head.simple && e.head.base === 'r01');
    expect(entry).toBeDefined();
    return stash.subarray(entry!.full.start, entry!.full.end);
  }
  function replaceRange(base: Uint8Array, kind: string, value: Uint8Array): Uint8Array {
    const range = saver.readD2S(base).coverage.sections.find(s => s.kind === kind)!;
    return fix(Buffer.concat([base.subarray(0, range.start), value, base.subarray(range.end)]));
  }
  it('ranges a golem parent and all its socketed children instead of certifying an opaque golem blob', () => {
    const item = physicalItem(true);
    const base = cleanCharacter();
    const bytes = replaceRange(base, 'golem', Uint8Array.from([0x6b, 0x66, 1, ...item]));
    const parsed = saver.readD2S(bytes);
    expect(parsed.coverage.complete).toBe(true); expect(parsed.coverage.items.length).toBe(1);
    const parent = parsed.coverage.items[0]; expect(parent.children.length).toBeGreaterThan(0);
    expect(parent.full.end - parent.full.start).toBe(item.length);
    const range = parsed.coverage.sections.find(s => s.kind === 'golem')!;
    expect(parent.full.start).toBe(range.start + 3); expect(parent.full.end).toBe(range.end);
    const invalid = changed(bytes, range.start + 2, 2);
    expect(saver.readD2S(fix(invalid)).coverage.complete).toBe(false);
  });
  it('keeps duplicate preset instances even when the high-level dictionary collapses their keys', () => {
    const item = physicalItem(false);
    const bytes = replaceRange(cleanCharacter(), 'main', Uint8Array.from([0x4a, 0x4d, 2, 0, ...item, ...item]));
    const parsed = saver.readD2S(bytes);
    expect(parsed.coverage.complete).toBe(true); expect(parsed.coverage.items.length).toBe(2);
    expect(parsed.coverage.items[0].full.end).toBe(parsed.coverage.items[1].full.start);
  });
});

describe.skipIf(!privateDir)('private SCL3V3 existing-record material round-trip', () => {
  it('retains the zero r01 record and restores real balances byte-for-byte', () => {
    for (const [name, quantity] of [['counterpart-before-response.json', 11], ['2026-10-15T21-55-58-239Z-target-after.json', 10]] as const) {
      const responsePath = join(privateDir!, name), response = readFileSync(responsePath), original = sha(response);
      const save = JSON.parse(response.toString('utf8'));
      const tab = save.sharedStashTabs.find((t: { type: number }) => t.type === 1);
      expect(tab.season).toBe(3); expect(tab.gameVersion).toBe(3); expect(tab.hardcore).toBe(false);
      const bytes = Buffer.from(tab.saveData, 'base64'), digest = sha(bytes);
      const before = saver.readMaterialsD2I(bytes, { sectorOffset: 0 });
      expect(before.complete).toBe(true); expect(before.records.find(r => r.code === 'r01')?.quantity).toBe(quantity);
      const removed = saver.editMaterialsD2I(bytes, { sectorOffset: 0, appends: [], patches: [{ code: 'r01', from: quantity, to: 0 }] });
      expect(removed.after.records.length).toBe(before.records.length);
      expect(removed.after.records.find(r => r.code === 'r01')?.quantity).toBe(0);
      const restored = saver.editMaterialsD2I(removed.newBuffer, { sectorOffset: 0, appends: [], patches: [{ code: 'r01', from: 0, to: quantity }] });
      expect(sha(restored.newBuffer)).toBe(digest); expect(sha(bytes)).toBe(digest); expect(sha(readFileSync(responsePath))).toBe(original);
    }
  });
});
