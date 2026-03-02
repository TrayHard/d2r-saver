import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function monPropToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('monProp');
  const monProp: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    const code = getString(line[0]).trim();
    monProp[code] = {
      prop1: getString(line[1] + ' ').trim() || undefined,
      prop2: getString(line[6] + ' ').trim() || undefined,
      prop3: getString(line[11] + ' ').trim() || undefined,
      prop4: getString(line[16] + ' ').trim() || undefined,
      prop5: getString(line[21] + ' ').trim() || undefined,
      prop6: getString(line[26] + ' ').trim() || undefined,
      prop1n: getString(line[31] + ' ').trim() || undefined,
      prop2n: getString(line[36] + ' ').trim() || undefined,
      prop3n: getString(line[41] + ' ').trim() || undefined,
      prop4n: getString(line[46] + ' ').trim() || undefined,
      prop5n: getString(line[51] + ' ').trim() || undefined,
      prop6n: getString(line[56] + ' ').trim() || undefined,
      prop1h: getString(line[61] + ' ').trim() || undefined,
      prop2h: getString(line[66] + ' ').trim() || undefined,
      prop3h: getString(line[71] + ' ').trim() || undefined,
      prop4h: getString(line[76] + ' ').trim() || undefined,
      prop5h: getString(line[81] + ' ').trim() || undefined,
      prop6h: getString(line[86] + ' ').trim() || undefined,
      min1: toNumber(line[4]),
      min2: toNumber(line[9]),
      min3: toNumber(line[14]),
      min4: toNumber(line[19]),
      min5: toNumber(line[24]),
      min6: toNumber(line[29]),
      max1: toNumber(line[5]),
      max2: toNumber(line[10]),
      max3: toNumber(line[15]),
      max4: toNumber(line[20]),
      max5: toNumber(line[25]),
      max6: toNumber(line[30]),
      min1n: toNumber(line[34]),
      min2n: toNumber(line[39]),
      min3n: toNumber(line[44]),
      min4n: toNumber(line[49]),
      min5n: toNumber(line[54]),
      min6n: toNumber(line[59]),
      max1n: toNumber(line[35]),
      max2n: toNumber(line[40]),
      max3n: toNumber(line[45]),
      max4n: toNumber(line[50]),
      max5n: toNumber(line[55]),
      max6n: toNumber(line[60]),
      min1h: toNumber(line[64]),
      min2h: toNumber(line[69]),
      min3h: toNumber(line[74]),
      min4h: toNumber(line[79]),
      min5h: toNumber(line[84]),
      min6h: toNumber(line[89]),
      max1h: toNumber(line[65]),
      max2h: toNumber(line[70]),
      max3h: toNumber(line[75]),
      max4h: toNumber(line[80]),
      max5h: toNumber(line[85]),
      max6h: toNumber(line[90]),
    };
  }

  await writeJson('monProp', monProp);
  return monProp;
}
