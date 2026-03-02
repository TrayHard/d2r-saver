import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function difficultyToJson(): Promise<unknown[]> {
  const table = await readGameFile('difficulty');
  const arr: unknown[] = [];

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    arr.push({
      resistpenalty: toNumber(line[1]),
      monsterskillbonus: toNumber(line[4]),
      monsterfreezedivisor: toNumber(line[5]),
      monstercolddivisor: toNumber(line[6]),
      aicursedivisor: toNumber(line[7]),
      lifestealdivisor: toNumber(line[8]),
      manastealdivisor: toNumber(line[9]),
      uniquedamagebonus: toNumber(line[10]),
      championdamagebonus: toNumber(line[11]),
      hireablebossdamagepercent: toNumber(line[19]),
      mostercedamagepercent: toNumber(line[25]),
      staticfieldmin: toNumber(line[27]),
    });
  }

  await writeJson('difficulty', arr);
  return arr;
}
