import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function superUniquesToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('superUniques');
  const superUniques: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[3]).trim() === '') continue;
    const code = toNumber(line[3]);
    if (code === undefined) continue;
    superUniques[String(code)] = {
      name: getString(line[1] + ' ').trim(),
      class: getString(line[2] + ' ').trim() || undefined,
      tc: getString(line[16] + ' ').trim() || undefined,
      tcn: getString(line[18] + ' ').trim() || undefined,
      tch: getString(line[20] + ' ').trim() || undefined,
      mod1: toNumber(line[5]),
      mod2: toNumber(line[6]),
      mod3: toNumber(line[7]),
      mingrp: toNumber(line[8]),
      maxgrp: toNumber(line[9]),
    };
  }

  await writeJson('superUniques', superUniques);
  return superUniques;
}
