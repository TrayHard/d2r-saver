import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

function padCode(prefix: string, i: number): string {
  if (i < 10) return `${prefix}00${i}`;
  if (i < 100) return `${prefix}0${i}`;
  return `${prefix}${i}`;
}

export async function qualityItemsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('qualityItems');
  const qualityItems: Record<string, unknown> = {};
  let i = 0;

  for (const line of table) {
    if (getString(line[0]).trim() === '') {
      i++;
      continue;
    }
    const code = padCode('qm', i);
    qualityItems[code] = {
      mod1code: getString(line[0] + ' ').trim(),
      mod2code: getString(line[4] + ' ').trim(),
      mod1param: toNumber(line[1]),
      mod2param: toNumber(line[5]),
      mod1min: toNumber(line[2]),
      mod2min: toNumber(line[6]),
      mod1max: toNumber(line[3]),
      mod2max: toNumber(line[7]),
      armor: toNumber(line[8]),
      weapon: toNumber(line[9]),
      shield: toNumber(line[10]),
      scepter: toNumber(line[11]),
      wand: toNumber(line[12]),
      staff: toNumber(line[13]),
      bow: toNumber(line[14]),
      boots: toNumber(line[15]),
      gloves: toNumber(line[16]),
      belt: toNumber(line[17]),
    };
    i++;
  }

  await writeJson('qualityItems', qualityItems);
  return qualityItems;
}
