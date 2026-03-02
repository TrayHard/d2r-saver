import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function hirelingToJson(): Promise<Record<string, unknown[]>> {
  const table = await readGameFile('hireling');
  const hireling: Record<string, unknown[]> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;

    const code = toNumber(line[3]);
    if (code === undefined) continue;

    const arrElem = {
      namefirst: getString(line[9] + ' ').trim(),
      namelast: getString(line[10] + ' ').trim(),
      skill1: getString(line[36] + ' ').trim() || undefined,
      skill2: getString(line[42] + ' ').trim() || undefined,
      skill3: getString(line[48] + ' ').trim() || undefined,
      skill4: getString(line[54] + ' ').trim() || undefined,
      skill5: getString(line[60] + ' ').trim() || undefined,
      skill6: getString(line[66] + ' ').trim() || undefined,
      version: toNumber(line[2]),
      level: toNumber(line[7]),
      explvl: toNumber(line[12]),
      hp: toNumber(line[13]),
      hplvl: toNumber(line[14]),
      defense: toNumber(line[15]),
      deflvl: toNumber(line[16]),
      str: toNumber(line[17]),
      strlvl: toNumber(line[18]),
      dex: toNumber(line[19]),
      dexlvl: toNumber(line[20]),
      ar: toNumber(line[21]),
      arlvl: toNumber(line[22]),
      dmgmin: toNumber(line[23]),
      dmgmax: toNumber(line[24]),
      dmglvl: toNumber(line[25]),
      resist: toNumber(line[26]),
      resistlvl: toNumber(line[27]),
      defaultchance: toNumber(line[35]),
      mode1: toNumber(line[37]),
      mode2: toNumber(line[43]),
      mode3: toNumber(line[49]),
      mode4: toNumber(line[55]),
      mode5: toNumber(line[61]),
      mode6: toNumber(line[67]),
      chance1: toNumber(line[38]),
      chance2: toNumber(line[44]),
      chance3: toNumber(line[50]),
      chance4: toNumber(line[56]),
      chance5: toNumber(line[62]),
      chance6: toNumber(line[68]),
      chanceperlvl1: toNumber(line[39]),
      chanceperlvl2: toNumber(line[45]),
      chanceperlvl3: toNumber(line[51]),
      chanceperlvl4: toNumber(line[57]),
      chanceperlvl5: toNumber(line[63]),
      chanceperlvl6: toNumber(line[69]),
      level1: toNumber(line[40]),
      level2: toNumber(line[46]),
      level3: toNumber(line[52]),
      level4: toNumber(line[58]),
      level5: toNumber(line[64]),
      level6: toNumber(line[70]),
      levelperlvl1: toNumber(line[41]),
      levelperlvl2: toNumber(line[47]),
      levelperlvl3: toNumber(line[53]),
      levelperlvl4: toNumber(line[59]),
      levelperlvl5: toNumber(line[65]),
      levelperlvl6: toNumber(line[71]),
      act: toNumber(line[5]),
      class: toNumber(line[4]),
    };

    const key = String(code);
    if (!hireling[key]) {
      hireling[key] = [];
    }
    hireling[key].push(arrElem);
  }

  await writeJson('hireling', hireling);
  return hireling;
}
