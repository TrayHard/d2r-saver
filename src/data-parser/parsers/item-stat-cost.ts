import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function itemStatCostToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('itemStatCost');
  const itemStatCost: Record<string, unknown> = {};

  for (const line of table) {
    const code = getString(line[0]).trim();
    itemStatCost[code] = {
      opbase: getString(line[26]).trim() || undefined,
      opstat1: getString(line[27]).trim() || undefined,
      opstat2: getString(line[28]).trim() || undefined,
      opstat3: getString(line[29]).trim() || undefined,
      descval: toNumber(line[39]),
      descstrpos: getString(line[40] + ' ').trim() || undefined,
      descstrneg: getString(line[41] + ' ').trim() || undefined,
      descstr2: getString(line[42] + ' ').trim() || undefined,
      id: toNumber(line[1]),
      add: toNumber(line[15]),
      multiply: toNumber(line[16]),
      op: toNumber(line[24]),
      opparam: toNumber(line[25]),
      damagerelated: toNumber(line[32]),
      descpriority: toNumber(line[37]),
      descfunc: toNumber(line[38]),
      savebits: toNumber(line[20]),
      saveadd: toNumber(line[21]),
      csvbits: toNumber(line[9]),
      saveparambits: toNumber(line[22]),
    };
  }

  await writeJson('itemStatCost', itemStatCost);
  return itemStatCost;
}
