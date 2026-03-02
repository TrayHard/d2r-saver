import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function itemRatioToJson(): Promise<unknown[]> {
  const table = await readGameFile('itemRatio');
  const arr: unknown[] = [];

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    arr.push({
      version: toNumber(line[1]),
      uber: toNumber(line[2]),
      classspecific: toNumber(line[3]),
      unique: toNumber(line[4]),
      uniquedivisor: toNumber(line[5]),
      uniquemin: toNumber(line[6]),
      rare: toNumber(line[7]),
      raredivisor: toNumber(line[8]),
      raremin: toNumber(line[9]),
      set: toNumber(line[10]),
      setdivisor: toNumber(line[11]),
      setmin: toNumber(line[12]),
      magic: toNumber(line[13]),
      magicdivisor: toNumber(line[14]),
      magicmin: toNumber(line[15]),
      hiquality: toNumber(line[16]),
      hiqualitydivisor: toNumber(line[17]),
      normal: toNumber(line[18]),
      normaldivisor: toNumber(line[19]),
    });
  }

  await writeJson('itemRatio', arr);
  return arr;
}
