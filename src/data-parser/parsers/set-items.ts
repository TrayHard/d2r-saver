import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';
import { getHD } from '../get-hd.js';
import { getSkillId } from '../get-skill-id.js';

export async function setItemsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('setItems');
  const setItems: Record<string, unknown> = {};
  let i = 0;

  for (const line of table) {
    const name = getString(line[0]).trim();
    if (name === '') { i++; continue; }

    const code = `set${String(i).padStart(3, '0')}`;
    const index = getString(line[0]) || undefined;
    setItems[code] = {
      index,
      set: getString(line[2]) || undefined,
      item: getString(line[4]) || undefined,
      invtransform: getString(line[10]) || undefined,
      prop1: getString(line[19]) || undefined,
      prop2: getString(line[23]) || undefined,
      prop3: getString(line[27]) || undefined,
      prop4: getString(line[31]) || undefined,
      prop5: getString(line[35]) || undefined,
      prop6: getString(line[39]) || undefined,
      prop7: getString(line[43]) || undefined,
      prop8: getString(line[47]) || undefined,
      prop9: getString(line[51]) || undefined,
      aprop1a: getString(line[55]) || undefined,
      aprop2a: getString(line[63]) || undefined,
      aprop2b: getString(line[67]) || undefined,
      aprop3a: getString(line[71]) || undefined,
      aprop3b: getString(line[75]) || undefined,
      aprop4a: getString(line[79]) || undefined,
      aprop4b: getString(line[83]) || undefined,
      aprop5a: getString(line[87]) || undefined,
      aprop5b: getString(line[91]) || undefined,

      apar1a: isNaN(Number(line[56])) ? await getSkillId(getString(line[56])) : toNumber(line[56]),
      apar2a: isNaN(Number(line[64])) ? await getSkillId(getString(line[64])) : toNumber(line[64]),
      apar2b: isNaN(Number(line[68])) ? await getSkillId(getString(line[68])) : toNumber(line[68]),
      apar3a: isNaN(Number(line[72])) ? await getSkillId(getString(line[72])) : toNumber(line[72]),
      apar3b: isNaN(Number(line[76])) ? await getSkillId(getString(line[76])) : toNumber(line[76]),
      apar4a: isNaN(Number(line[80])) ? await getSkillId(getString(line[80])) : toNumber(line[80]),
      apar4b: isNaN(Number(line[84])) ? await getSkillId(getString(line[84])) : toNumber(line[84]),
      apar5a: isNaN(Number(line[88])) ? await getSkillId(getString(line[88])) : toNumber(line[88]),
      apar5b: isNaN(Number(line[92])) ? await getSkillId(getString(line[92])) : toNumber(line[92]),

      lvl: toNumber(line[7]),
      lvlreq: toNumber(line[8]),
      costmult: toNumber(line[16]),
      costadd: toNumber(line[17]),
      addfunc: toNumber(line[18]),

      min1: toNumber(line[21]),
      min2: toNumber(line[25]),
      min3: toNumber(line[29]),
      min4: toNumber(line[33]),
      min5: toNumber(line[37]),
      min6: toNumber(line[41]),
      min7: toNumber(line[45]),
      min8: toNumber(line[49]),
      min9: toNumber(line[53]),

      par1: isNaN(Number(line[20])) ? await getSkillId(getString(line[20])) : toNumber(line[20]),
      par2: isNaN(Number(line[24])) ? await getSkillId(getString(line[24])) : toNumber(line[24]),
      par3: isNaN(Number(line[28])) ? await getSkillId(getString(line[28])) : toNumber(line[28]),
      par4: isNaN(Number(line[32])) ? await getSkillId(getString(line[32])) : toNumber(line[32]),
      par5: isNaN(Number(line[36])) ? await getSkillId(getString(line[36])) : toNumber(line[36]),
      par6: isNaN(Number(line[40])) ? await getSkillId(getString(line[40])) : toNumber(line[40]),
      par7: isNaN(Number(line[44])) ? await getSkillId(getString(line[44])) : toNumber(line[44]),
      par8: isNaN(Number(line[48])) ? await getSkillId(getString(line[48])) : toNumber(line[48]),
      par9: isNaN(Number(line[52])) ? await getSkillId(getString(line[52])) : toNumber(line[52]),

      max1: toNumber(line[22]),
      max2: toNumber(line[26]),
      max3: toNumber(line[30]),
      max4: toNumber(line[34]),
      max5: toNumber(line[38]),
      max6: toNumber(line[42]),
      max7: toNumber(line[46]),
      max8: toNumber(line[50]),
      max9: toNumber(line[54]),

      amin1a: toNumber(line[57]),
      amin2a: toNumber(line[65]),
      amin3a: toNumber(line[73]),
      amin4a: toNumber(line[81]),
      amin5a: toNumber(line[89]),

      amax1a: toNumber(line[58]),
      amax2a: toNumber(line[66]),
      amax3a: toNumber(line[74]),
      amax4a: toNumber(line[82]),
      amax5a: toNumber(line[90]),

      amin1b: toNumber(line[91]),
      amin2b: toNumber(line[69]),
      amin3b: toNumber(line[77]),
      amin4b: toNumber(line[85]),
      amin5b: toNumber(line[93]),

      amax1b: toNumber(line[92]),
      amax2b: toNumber(line[70]),
      amax3b: toNumber(line[78]),
      amax4b: toNumber(line[86]),
      amax5b: toNumber(line[94]),

      rarity: toNumber(line[6]),
      hd: getHD(index, 'setItems'),
    };
    i++;
  }

  await writeJson('setItems', setItems);
  return setItems;
}
