import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

function padCode(prefix: string, i: number): string {
  if (i < 10) return `${prefix}00${i}`;
  if (i < 100) return `${prefix}0${i}`;
  return `${prefix}${i}`;
}

export async function autoMagicToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('autoMagic');
  const autoMagic: Record<string, unknown> = {};
  let i = 1;

  for (const line of table) {
    if (getString(line[0]).trim() === '') {
      i++;
      continue;
    }
    const code = padCode('am', i);
    autoMagic[code] = {
      name: getString(line[0] + ' ').trim(),
      mod1code: getString(line[12] + ' ').trim() || undefined,
      mod2code: getString(line[16] + ' ').trim() || undefined,
      mod3code: getString(line[20] + ' ').trim() || undefined,
      transformcolor: getString(line[24] + ' ').trim() || undefined,
      itype1: getString(line[25] + ' ').trim() || undefined,
      itype2: getString(line[26] + ' ').trim() || undefined,
      itype3: getString(line[27] + ' ').trim() || undefined,
      itype4: getString(line[28] + ' ').trim() || undefined,
      itype5: getString(line[29] + ' ').trim() || undefined,
      itype6: getString(line[30] + ' ').trim() || undefined,
      itype7: getString(line[31] + ' ').trim() || undefined,
      etype1: getString(line[32] + ' ').trim() || undefined,
      etype2: getString(line[33] + ' ').trim() || undefined,
      etype3: getString(line[34] + ' ').trim() || undefined,
      etype4: getString(line[35] + ' ').trim() || undefined,
      etype5: getString(line[36] + ' ').trim() || undefined,
      version: toNumber(line[1]),
      rare: toNumber(line[3]),
      level: toNumber(line[4]),
      levelreq: toNumber(line[6]),
      group: toNumber(line[11]),
      mod1param: toNumber(line[13]),
      mod2param: toNumber(line[17]),
      mod3param: toNumber(line[21]),
      mod1min: toNumber(line[14]),
      mod2min: toNumber(line[18]),
      mod3min: toNumber(line[22]),
      mod1max: toNumber(line[15]),
      mod2max: toNumber(line[19]),
      mod3max: toNumber(line[23]),
      multiply: toNumber(line[37]),
      add: toNumber(line[38]),
      frequency: toNumber(line[10]),
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
    i++;
  }

  await writeJson('autoMagic', autoMagic);
  return autoMagic;
}
