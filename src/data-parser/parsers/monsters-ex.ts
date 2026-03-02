import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function monstersExToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('monstersEx');
  const monstersEx: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    const code = getString(line[0] + ' ').trim();
    monstersEx[code] = {
      basew: getString(line[9] + ' ').trim() || undefined,
      sizex: toNumber(line[5]),
      sizey: toNumber(line[6]),
      isatt: toNumber(line[97]),
      revive: toNumber(line[98]),
      small: toNumber(line[101]),
      meleerng: toNumber(line[8]),
      issel: toNumber(line[92]),
      corpsesel: toNumber(line[96]),
      mdt: toNumber(line[44]),
      mnu: toNumber(line[45]),
      mwl: toNumber(line[46]),
      mgh: toNumber(line[47]),
      ma1: toNumber(line[48]),
      ma2: toNumber(line[49]),
      mbl: toNumber(line[50]),
      msc: toNumber(line[51]),
      ms1: toNumber(line[52]),
      ms2: toNumber(line[53]),
      ms3: toNumber(line[54]),
      ms4: toNumber(line[55]),
      mdd: toNumber(line[56]),
      mkb: toNumber(line[57]),
      msq: toNumber(line[58]),
      mrn: toNumber(line[59]),
    };
  }

  await writeJson('monstersEx', monstersEx);
  return monstersEx;
}
