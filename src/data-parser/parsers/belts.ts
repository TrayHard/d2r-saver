import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function beltsToJson(): Promise<(number | undefined)[]> {
  const table = await readGameFile('belts');
  const belts: (number | undefined)[] = [];

  for (const line of table) {
    if (getString(line[1]).trim() === '') continue;
    belts.push(toNumber(line[1]));
  }

  await writeJson('belts', belts);
  return belts;
}
