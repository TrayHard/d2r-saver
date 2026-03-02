import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function charStatsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('charStats');
  const charStats: Record<string, unknown> = {};

  for (const line of table) {
    const code = line[0].slice(0, 3).toLowerCase();
    charStats[code] = {
      class: getString(line[0].trim()),
      strallskills: getString(line[35]).trim() || undefined,
      strskilltab1: getString(line[36]).trim() || undefined,
      strskilltab2: getString(line[37]).trim() || undefined,
      strskilltab3: getString(line[38]).trim() || undefined,
      strclassonly: getString(line[39]).trim() || undefined,
      str: toNumber(line[1]),
      dex: toNumber(line[2]),
      int: toNumber(line[3]),
      vit: toNumber(line[4]),
      stamina: toNumber(line[5]),
      hpadd: toNumber(line[6]),
      manaregen: toNumber(line[7]),
      tohitfactor: toNumber(line[8]),
      walkvelocity: toNumber(line[9]),
      runvelocity: toNumber(line[10]),
      rundrain: toNumber(line[11]),
      lifeperlevel: toNumber(line[13]),
      staminaperlevel: toNumber(line[14]),
      manaperlevel: toNumber(line[15]),
      lifepervitality: toNumber(line[16]),
      staminapervitality: toNumber(line[17]),
      manapermagic: toNumber(line[18]),
      statperlevel: toNumber(line[19]),
      blockfactor: toNumber(line[22]),
    };
  }

  await writeJson('charStats', charStats);
  return charStats;
}
