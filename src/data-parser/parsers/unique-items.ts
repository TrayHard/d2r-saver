import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';
import { getHD } from '../get-hd.js';
import { getSkillId } from '../get-skill-id.js';

export async function uniqueItemsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('uniqueItems');
  const uniqueItems: Record<string, unknown> = {};
  let i = 0;

  for (const line of table) {
    if (getString(line[0]).trim() === '' || getString(line[3]) !== '1') {
      i++;
      continue;
    }

    const code = `unique${String(i).padStart(3, '0')}`;
    const index = getString(line[0] + ' ').trim() || undefined;
    uniqueItems[code] = {
      index,
      code: getString(line[10] + ' ').trim() || undefined,
      invfile: getString(line[18] + ' ').trim() || undefined,
      invtransform: getString(line[16] + ' ').trim() || undefined,
      prop1: getString(line[22] + ' ').trim() || undefined,
      prop2: getString(line[26] + ' ').trim() || undefined,
      prop3: getString(line[30] + ' ').trim() || undefined,
      prop4: getString(line[34] + ' ').trim() || undefined,
      prop5: getString(line[38] + ' ').trim() || undefined,
      prop6: getString(line[42] + ' ').trim() || undefined,
      prop7: getString(line[46] + ' ').trim() || undefined,
      prop8: getString(line[50] + ' ').trim() || undefined,
      prop9: getString(line[54] + ' ').trim() || undefined,
      prop10: getString(line[58] + ' ').trim() || undefined,
      prop11: getString(line[62] + ' ').trim() || undefined,
      prop12: getString(line[66] + ' ').trim() || undefined,
      version: toNumber(line[2]),
      lvl: toNumber(line[8]),
      lvlreq: toNumber(line[9]),
      carry: toNumber(line[12]),
      costmult: toNumber(line[13]),
      costadd: toNumber(line[14]),
      min1: toNumber(line[24]),
      min2: toNumber(line[28]),
      min3: toNumber(line[32]),
      min4: toNumber(line[36]),
      min5: toNumber(line[40]),
      min6: toNumber(line[44]),
      min7: toNumber(line[48]),
      min8: toNumber(line[52]),
      min9: toNumber(line[56]),
      min10: toNumber(line[60]),
      min11: toNumber(line[64]),
      min12: toNumber(line[68]),
      par1: isNaN(Number(line[23])) ? await getSkillId(getString(line[23])) : toNumber(line[23]),
      par2: isNaN(Number(line[27])) ? await getSkillId(getString(line[27])) : toNumber(line[27]),
      par3: isNaN(Number(line[31])) ? await getSkillId(getString(line[31])) : toNumber(line[31]),
      par4: isNaN(Number(line[35])) ? await getSkillId(getString(line[35])) : toNumber(line[35]),
      par5: isNaN(Number(line[39])) ? await getSkillId(getString(line[39])) : toNumber(line[39]),
      par6: isNaN(Number(line[43])) ? await getSkillId(getString(line[43])) : toNumber(line[43]),
      par7: isNaN(Number(line[47])) ? await getSkillId(getString(line[47])) : toNumber(line[47]),
      par8: isNaN(Number(line[51])) ? await getSkillId(getString(line[51])) : toNumber(line[51]),
      par9: isNaN(Number(line[55])) ? await getSkillId(getString(line[55])) : toNumber(line[55]),
      par10: isNaN(Number(line[59])) ? await getSkillId(getString(line[59])) : toNumber(line[59]),
      par11: isNaN(Number(line[63])) ? await getSkillId(getString(line[63])) : toNumber(line[63]),
      par12: isNaN(Number(line[67])) ? await getSkillId(getString(line[67])) : toNumber(line[67]),
      max1: toNumber(line[25]),
      max2: toNumber(line[29]),
      max3: toNumber(line[33]),
      max4: toNumber(line[37]),
      max5: toNumber(line[41]),
      max6: toNumber(line[45]),
      max7: toNumber(line[49]),
      max8: toNumber(line[53]),
      max9: toNumber(line[57]),
      max10: toNumber(line[61]),
      max11: toNumber(line[65]),
      max12: toNumber(line[69]),
      enabled: toNumber(line[3]),
      rarity: toNumber(line[6]),
      hd: getHD(index, 'uniqueItems'),
    };
    i++;
  }

  await writeJson('uniqueItems', uniqueItems);
  return uniqueItems;
}
