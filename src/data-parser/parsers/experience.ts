import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function experienceToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('experience');
  const experience: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    const code = getString(line[0] + ' ').trim();
    experience[code] = {
      amazon: toNumber(line[1]),
      expratio: toNumber(line[8]),
    };
  }

  await writeJson('experience', experience);
  return experience;
}
