import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function gemsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('gems');
  const gems: Record<string, unknown> = {};

  for (const line of table) {
    const code = getString(line[3]).trim();
    gems[code] = {
      letter: getString(line[1]).trim() || undefined,
      weaponmod1code: getString(line[4].trim()) || undefined,
      weaponmod2code: getString(line[8].trim()) || undefined,
      weaponmod3code: getString(line[12].trim()) || undefined,
      helmmod1code: getString(line[16]).trim() || undefined,
      helmmod2code: getString(line[20]).trim() || undefined,
      helmmod3code: getString(line[24]).trim() || undefined,
      shieldmod1code: getString(line[28]).trim() || undefined,
      shieldmod2code: getString(line[32]).trim() || undefined,
      shieldmod3code: getString(line[36]).trim() || undefined,
      transform: Number(line[2]),
      weaponmod1param: toNumber(line[5]),
      weaponmod2param: toNumber(line[9]),
      weaponmod3param: toNumber(line[13]),
      weaponmod1min: toNumber(line[6]),
      weaponmod2min: toNumber(line[10]),
      weaponmod3min: toNumber(line[14]),
      weaponmod1max: toNumber(line[7]),
      weaponmod2max: toNumber(line[11]),
      weaponmod3max: toNumber(line[15]),
      helmmod1param: toNumber(line[17]),
      helmmod2param: toNumber(line[21]),
      helmmod3param: toNumber(line[25]),
      helmmod1min: toNumber(line[18]),
      helmmod2min: toNumber(line[22]),
      helmmod3min: toNumber(line[26]),
      helmmod1max: toNumber(line[19]),
      helmmod2max: toNumber(line[23]),
      helmmod3max: toNumber(line[27]),
      shieldmod1param: toNumber(line[29]),
      shieldmod2param: toNumber(line[33]),
      shieldmod3param: toNumber(line[37]),
      shieldmod1min: toNumber(line[30]),
      shieldmod2min: toNumber(line[34]),
      shieldmod3min: toNumber(line[38]),
      shieldmod1max: toNumber(line[31]),
      shieldmod2max: toNumber(line[35]),
      shieldmod3max: toNumber(line[39]),
    };
  }

  await writeJson('gems', gems);
  return gems;
}
