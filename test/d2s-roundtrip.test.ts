import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { D2RSaver } from '../src/index.js';
import { writeD2S } from '../src/formats/d2s-writer.js';

// Build the saver once from the bundled game data.
const data = JSON.parse(readFileSync('data/data.json', 'utf8'));
const strings = JSON.parse(readFileSync('data/strings.json', 'utf8'));
const saver = D2RSaver.fromData(data, strings);

// Candidate fixtures, keeping only those that exist AND parse as a valid d2s.
const FIXTURES = ['WarlockShards', 'WarlockTest', 'BlizzlessTest']
  .filter((f) => existsSync(`test/fixtures/${f}.d2s`))
  .filter((f) => {
    try {
      saver.readD2S(new Uint8Array(readFileSync(`test/fixtures/${f}.d2s`)));
      return true;
    } catch {
      return false; // e.g. an older/non-v105 file the reader cannot parse
    }
  });

describe('writeD2S lossless round-trip', () => {
  for (const fx of FIXTURES) {
    it(`round-trips ${fx}.d2s without data loss`, () => {
      const bytes = new Uint8Array(readFileSync(`test/fixtures/${fx}.d2s`));
      const before = saver.readD2S(bytes);
      const out = writeD2S({
        profile: before.profile,
        items: before.items,
        gd: saver.gd,
      });
      const after = saver.readD2S(out);

      // The fixed 833-byte header is copied verbatim — only filesize (8-11) and
      // checksum (12-15) are re-derived, so compare from offset 16 onward.
      expect(Array.from(out.slice(16, 833))).toEqual(Array.from(bytes.slice(16, 833)));

      // The stats the OLD (planner) writer destroyed — must now survive exactly.
      expect(after.profile.gold).toBe(before.profile.gold);
      expect(after.profile.goldStash).toBe(before.profile.goldStash);
      expect(after.profile.attributes).toEqual(before.profile.attributes);
      expect(after.profile.level).toBe(before.profile.level);
      expect(after.profile.quests).toEqual(before.profile.quests);
      expect(after.profile.merc).toBe(before.profile.merc);
      expect(after.profile.mercLevel).toBe(before.profile.mercLevel);

      // Items round-trip (same count + same ids).
      expect(Object.keys(after.items).sort()).toEqual(
        Object.keys(before.items).sort()
      );

      // The rewrite must never INTRODUCE parser warnings (it may produce fewer,
      // since it normalises a trailing section the original reader tripped on).
      expect(after.warnings.length).toBeLessThanOrEqual(before.warnings.length);
    });
  }

  it('a gold edit changes only gold, nothing else', () => {
    const fx = FIXTURES[0];
    const bytes = new Uint8Array(readFileSync(`test/fixtures/${fx}.d2s`));
    const before = saver.readD2S(bytes);

    // Edit gold the way the editor will: mutate the raw attribute then write.
    const edited = structuredClone(before.profile);
    edited.attributes!.gold = 123456;
    const out = writeD2S({ profile: edited, items: before.items, gd: saver.gd });
    const after = saver.readD2S(out);

    expect(after.profile.gold).toBe(123456);
    // Everything else identical to the original parse.
    expect(after.profile.goldStash).toBe(before.profile.goldStash);
    expect(after.profile.level).toBe(before.profile.level);
    expect(after.profile.attributes!.experience).toBe(
      before.profile.attributes!.experience
    );
    expect(after.profile.attributes!.strength).toBe(
      before.profile.attributes!.strength
    );
  });
});
