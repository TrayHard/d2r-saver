import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';
import { getSkillId } from '../get-skill-id.js';

export async function runesToJson(): Promise<Record<string, unknown>> {
  console.log('loading runes.txt...');
  const table = await readGameFile('runes');
  const runes: Record<string, unknown> = {};
  let i = 1;

  for (const line of table) {
    const name = getString(line[0]).trim();
    if (name === '' || getString(line[1]).indexOf('(Pure)') > 0 || getString(line[2]) !== '1') {
      i++;
      continue;
    }

    let rwNum = name.startsWith('Runeword') ? +(name.match(/Runeword(\d+)/)?.[1] ?? i) : i;
    if (rwNum > 75) {
      rwNum += 25;
    } else {
      rwNum += 26;
    }
    const code = `runeword${String(rwNum).padStart(3, '0')}`;

    runes[code] = {
      name: getString(line[1]),
      itype1: getString(line[6]) || undefined,
      itype2: getString(line[7]) || undefined,
      itype3: getString(line[8]) || undefined,
      itype4: getString(line[9]) || undefined,
      itype5: getString(line[10]) || undefined,
      itype6: getString(line[11]) || undefined,
      etype1: getString(line[12]) || undefined,
      etype2: getString(line[13]) || undefined,
      etype3: getString(line[14]) || undefined,
      rune1: getString(line[16]) || undefined,
      rune2: getString(line[17]) || undefined,
      rune3: getString(line[18]) || undefined,
      rune4: getString(line[19]) || undefined,
      rune5: getString(line[20]) || undefined,
      rune6: getString(line[21]) || undefined,
      t1code1: getString(line[22]) || undefined,
      t1code2: getString(line[26]) || undefined,
      t1code3: getString(line[30]) || undefined,
      t1code4: getString(line[34]) || undefined,
      t1code5: getString(line[38]) || undefined,
      t1code6: getString(line[42]) || undefined,
      t1code7: getString(line[46]) || undefined,
      t1param1: isNaN(Number(line[23])) ? await getSkillId(getString(line[23])) : toNumber(line[23]),
      t1param2: isNaN(Number(line[27])) ? await getSkillId(getString(line[27])) : toNumber(line[27]),
      t1param3: isNaN(Number(line[31])) ? await getSkillId(getString(line[31])) : toNumber(line[31]),
      t1param4: isNaN(Number(line[35])) ? await getSkillId(getString(line[35])) : toNumber(line[35]),
      t1param5: isNaN(Number(line[39])) ? await getSkillId(getString(line[39])) : toNumber(line[39]),
      t1param6: isNaN(Number(line[43])) ? await getSkillId(getString(line[43])) : toNumber(line[43]),
      t1param7: isNaN(Number(line[47])) ? await getSkillId(getString(line[47])) : toNumber(line[47]),
      t1min1: toNumber(line[24]),
      t1min2: toNumber(line[28]),
      t1min3: toNumber(line[32]),
      t1min4: toNumber(line[36]),
      t1min5: toNumber(line[40]),
      t1min6: toNumber(line[44]),
      t1min7: toNumber(line[48]),
      t1max1: toNumber(line[25]),
      t1max2: toNumber(line[29]),
      t1max3: toNumber(line[33]),
      t1max4: toNumber(line[37]),
      t1max5: toNumber(line[41]),
      t1max6: toNumber(line[45]),
      t1max7: toNumber(line[49]),
    };
    i++;
  }

  await writeJson('runes', runes);
  return runes;
}
