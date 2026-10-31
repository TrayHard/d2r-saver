/** Wonder (Blizzless S4): the row stayed empty in this library's table while the mod defines it. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const runes = JSON.parse(readFileSync('data/data.json', 'utf8')).runes as Record<string, Record<string, unknown>>;

describe('Wonder runeword data', () => {
  it('keeps the runes and properties of the mod row under the key the parser derives', () => {
    const wonder = runes.runeword192;
    expect(wonder).toMatchObject({ name: 'Wonder', itype1: 'staf', rune1: 'r27', rune2: 'r20', rune3: 'r24' });
    expect(wonder).toMatchObject({ t1code1: 'aura', t1min1: 9, t1max1: 9, t1code6: 'res-all', t1min6: 20, t1max6: 40 });
  });
});
