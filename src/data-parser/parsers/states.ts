import { readGameFile, writeJson } from '../files.js';
import { toNumber } from '../to-number.js';

export async function statesToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('states');
  const states: Record<string, unknown> = {};

  for (const line of table) {
    const code = toNumber(line[1]);
    if (code === undefined) continue;
    states[String(code)] = {
      state: line[0]?.trim() || undefined,
      group: toNumber(line[2]),
      aura: toNumber(line[5]),
      curse: toNumber(line[22]),
      sunderfull: toNumber(line[28]),
      restrict: toNumber(line[3]),
    };
  }

  await writeJson('states', states);
  return states;
}
