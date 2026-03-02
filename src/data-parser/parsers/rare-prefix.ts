import { readGameFile, writeJson, getString } from '../files.js';

export async function rarePrefixToJson(): Promise<unknown[]> {
  const table = await readGameFile('rarePrefix');
  const arr: unknown[] = [];

  for (const line of table) {
    arr.push({
      name: getString(line[0] + ' ').trim(),
      itype1: getString(line[2] + ' ').trim() || undefined,
      itype2: getString(line[3] + ' ').trim() || undefined,
      itype3: getString(line[4] + ' ').trim() || undefined,
      itype4: getString(line[5] + ' ').trim() || undefined,
      itype5: getString(line[6] + ' ').trim() || undefined,
      itype6: getString(line[7] + ' ').trim() || undefined,
      itype7: getString(line[8] + ' ').trim() || undefined,
      etype1: getString(line[9] + ' ').trim() || undefined,
      etype2: getString(line[10] + ' ').trim() || undefined,
      etype3: getString(line[11] + ' ').trim() || undefined,
      etype4: getString(line[12] + ' ').trim() || undefined,
    });
  }

  await writeJson('rarePrefix', arr);
  return arr;
}
