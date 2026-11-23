/** The stat tables are data: built from data/txt/older, carried by data.json, or given by the caller. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { D2RSaver, ErrorCode, parseStatTable } from '../src/index.js';
import { locale, rawData } from './helpers/stat-tables.js';

const txt = (name: string) => readFileSync(`data/txt/older/${name}.txt`, 'utf8');
const seasonTwoSave = () => new Uint8Array(readFileSync('test/fixtures/BlizzlessTest.d2s'));
/** A reader whose data.json has no older tables, as before 1.2.0. */
const withoutOlder = () => D2RSaver.fromData({ ...rawData(), olderStatTables: undefined }, locale());
const raw = { resolveMods: false };

describe('parseStatTable', () => {
  it('finds the columns by name and reads an empty cell as 0', () => {
    const table = parseStatTable('﻿*ID\tStat\tSave Add\tother\tSave Bits\tSave Param Bits\tCSvBits\r\n7\tmaxhp\t32\tx\t9\t\t21\r\n\t\t\r\n');
    expect(table).toEqual({ maxhp: { id: 7, savebits: 9, saveadd: 32, saveparambits: 0, csvbits: 21 } });
  });

  it('refuses a text that is not an itemstatcost table', () => {
    expect(() => parseStatTable('')).toThrow('no column "stat"');
    expect(() => parseStatTable('Stat\t*ID\tSave Bits\tSave Add\tCSvBits\n')).toThrow('no column "save param bits"');
    expect(() => parseStatTable('Stat\t*ID\tSave Bits\tSave Add\tSave Param Bits\tCSvBits\nmaxhp\t\t9\t32\t\t21\n')).toThrow('maxhp has no id');
  });
});

describe('olderStatTables', () => {
  it('of data.json are the files of data/txt/older', () => {
    const files = readdirSync('data/txt/older').sort().map((file) => file.replace(/\.txt$/, ''));
    expect(Object.keys(rawData().olderStatTables!)).toEqual(files);
    for (const name of files) expect(rawData().olderStatTables![name]).toEqual(parseStatTable(txt(name)));
  });
});

describe('readSave with the stat table of another mod', () => {
  it('reads a save only that table fits and gives its name', () => {
    const saver = withoutOlder();
    expect(saver.readSave(seasonTwoSave(), raw).statTable).toBeNull();
    const read = saver.readSave(seasonTwoSave(), { ...raw, statTables: { 'my-mod': parseStatTable(txt('blizzless-s2')) } });
    expect(read).toMatchObject({ type: 'd2s', version: 99, statTable: 'my-mod', data: { coverage: { complete: true } } });
    expect(read.data).toEqual(D2RSaver.fromData(rawData(), locale()).readSave(seasonTwoSave(), raw).data);
  });

  it('tries it before the older tables', () => {
    const saver = D2RSaver.fromData(rawData(), locale());
    const statTables = { 'my-mod': parseStatTable(txt('blizzless-s2')) };
    expect(saver.readSave(seasonTwoSave(), { ...raw, statTables }).statTable).toBe('my-mod');
  });

  it('reads on when the table does not fit, and throws when the core cannot use it', () => {
    const saver = D2RSaver.fromData(rawData(), locale());
    expect(saver.readSave(seasonTwoSave(), { ...raw, statTables: { vanilla: parseStatTable(txt('d2r')) } }).statTable).toBe('blizzless-s2');
    expect(() => saver.readSave(seasonTwoSave(), { ...raw, statTables: { broken: {} } }))
      .toThrow(expect.objectContaining({ code: ErrorCode.DATA_NOT_LOADED }));
  });
});
