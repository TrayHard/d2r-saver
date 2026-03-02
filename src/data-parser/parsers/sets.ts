import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function setsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('sets');
  const sets: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[1]).trim() === '') continue;
    const code = getString(line[1] + ' ').trim();
    sets[code] = {
      index: getString(line[0] + ' ').trim() || undefined,
      name: getString(line[1] + ' ').trim() || undefined,
      pcode2a: getString(line[3] + ' ').trim() || undefined,
      pcode3a: getString(line[11] + ' ').trim() || undefined,
      pcode4a: getString(line[19] + ' ').trim() || undefined,
      pcode5a: getString(line[27] + ' ').trim() || undefined,
      pcode2b: getString(line[7] + ' ').trim() || undefined,
      pcode3b: getString(line[15] + ' ').trim() || undefined,
      pcode4b: getString(line[23] + ' ').trim() || undefined,
      pcode5b: getString(line[31] + ' ').trim() || undefined,
      fcode1: getString(line[35] + ' ').trim() || undefined,
      fcode2: getString(line[39] + ' ').trim() || undefined,
      fcode3: getString(line[43] + ' ').trim() || undefined,
      fcode4: getString(line[47] + ' ').trim() || undefined,
      fcode5: getString(line[51] + ' ').trim() || undefined,
      fcode6: getString(line[55] + ' ').trim() || undefined,
      fcode7: getString(line[59] + ' ').trim() || undefined,
      fcode8: getString(line[63] + ' ').trim() || undefined,
      version: toNumber(line[2]),
      pmin2a: toNumber(line[5]),
      pmin3a: toNumber(line[13]),
      pmin4a: toNumber(line[21]),
      pmin5a: toNumber(line[29]),
      pmin2b: toNumber(line[9]),
      pmin3b: toNumber(line[17]),
      pmin4b: toNumber(line[25]),
      pmin5b: toNumber(line[33]),
      pmax2b: toNumber(line[10]),
      pmax3b: toNumber(line[18]),
      pmax4b: toNumber(line[26]),
      pmax5b: toNumber(line[34]),
      pmax2a: toNumber(line[6]),
      pmax3a: toNumber(line[14]),
      pmax4a: toNumber(line[22]),
      pmax5a: toNumber(line[30]),
      pparam2a: toNumber(line[4]),
      pparam3a: toNumber(line[12]),
      pparam4a: toNumber(line[20]),
      pparam5a: toNumber(line[28]),
      pparam2b: toNumber(line[8]),
      pparam3b: toNumber(line[16]),
      pparam4b: toNumber(line[24]),
      pparam5b: toNumber(line[32]),
      fparam1: toNumber(line[36]),
      fparam2: toNumber(line[40]),
      fparam3: toNumber(line[44]),
      fparam4: toNumber(line[48]),
      fparam5: toNumber(line[52]),
      fparam6: toNumber(line[56]),
      fparam7: toNumber(line[60]),
      fparam8: toNumber(line[64]),
      fmin1: toNumber(line[37]),
      fmin2: toNumber(line[41]),
      fmin3: toNumber(line[45]),
      fmin4: toNumber(line[49]),
      fmin5: toNumber(line[53]),
      fmin6: toNumber(line[57]),
      fmin7: toNumber(line[61]),
      fmin8: toNumber(line[65]),
      fmax1: toNumber(line[38]),
      fmax2: toNumber(line[42]),
      fmax3: toNumber(line[46]),
      fmax4: toNumber(line[50]),
      fmax5: toNumber(line[54]),
      fmax6: toNumber(line[58]),
      fmax7: toNumber(line[62]),
      fmax8: toNumber(line[66]),
    };
  }

  await writeJson('sets', sets);
  return sets;
}
