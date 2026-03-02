import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function monLvlToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('monLvl');
  const monLvl: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    const code = toNumber(line[0]);
    if (code === undefined) continue;
    monLvl[String(code)] = {
      ac: toNumber(line[1]),
      acn: toNumber(line[2]),
      ach: toNumber(line[3]),
      th: toNumber(line[7]),
      thn: toNumber(line[8]),
      hp: toNumber(line[13]),
      hpn: toNumber(line[14]),
      hph: toNumber(line[15]),
      dm: toNumber(line[19]),
      dmn: toNumber(line[20]),
      dmh: toNumber(line[21]),
      xp: toNumber(line[25]),
      xpn: toNumber(line[26]),
      xph: toNumber(line[27]),
      lac: toNumber(line[4]),
      lacn: toNumber(line[5]),
      lach: toNumber(line[6]),
      lth: toNumber(line[10]),
      lthn: toNumber(line[11]),
      lthh: toNumber(line[12]),
      lhp: toNumber(line[16]),
      lhpn: toNumber(line[17]),
      lhph: toNumber(line[18]),
      ldm: toNumber(line[22]),
      ldmn: toNumber(line[23]),
      ldmh: toNumber(line[24]),
      lxp: toNumber(line[28]),
      lxpn: toNumber(line[29]),
      lxph: toNumber(line[30]),
    };
  }

  await writeJson('monLvl', monLvl);
  return monLvl;
}
