import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function monEquipToJson(): Promise<unknown[]> {
  const table = await readGameFile('monEquip');
  const arr: unknown[] = [];

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    arr.push({
      monster: getString(line[0] + ' ').trim(),
      item1: getString(line[3] + ' ').trim() || undefined,
      item2: getString(line[6] + ' ').trim() || undefined,
      item3: getString(line[9] + ' ').trim() || undefined,
      loc1: getString(line[4] + ' ').trim() || undefined,
      loc2: getString(line[7] + ' ').trim() || undefined,
      loc3: getString(line[10] + ' ').trim() || undefined,
      oninit: toNumber(line[1]),
      level: toNumber(line[2]),
      mod1: toNumber(line[5]),
      mod2: toNumber(line[8]),
      mod3: toNumber(line[11]),
    });
  }

  await writeJson('monEquip', arr);
  return arr;
}
