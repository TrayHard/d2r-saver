import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function missilesToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('missiles');
  const missiles: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[1]).trim() === '') continue;
    const code = toNumber(line[1]);
    if (code === undefined) continue;
    missiles[String(code)] = {
      missile: getString(line[0] + ' ').trim(),
      dmgcalc1: getString(line[47] + ' ').trim() || undefined,
      skill: getString(line[106] + ' ').trim() || undefined,
      etype: getString(line[127] + ' ').trim() || undefined,
      id: code,
      psrvdofunc: toNumber(line[4]),
      psrvdmgfunc: toNumber(line[6]),
      dparam1: toNumber(line[49]),
      dparam2: toNumber(line[51]),
      vel: toNumber(line[53]),
      maxvel: toNumber(line[54]),
      range: toNumber(line[57]),
      collidetype: toNumber(line[75]),
      collidekill: toNumber(line[76]),
      size: toNumber(line[87]),
      tohit: toNumber(line[91]),
      canslow: toNumber(line[98]),
      returnfire: toNumber(line[99]),
      gethit: toNumber(line[100]),
      pierce: toNumber(line[104]),
      missileskill: toNumber(line[105]),
      resultflags: toNumber(line[107]),
      hitshift: toNumber(line[109]),
      emin: toNumber(line[128]),
      emax: toNumber(line[134]),
      minelev1: toNumber(line[129]),
      minelev2: toNumber(line[130]),
      minelev3: toNumber(line[131]),
      minelev4: toNumber(line[132]),
      minelev5: toNumber(line[133]),
      maxelev1: toNumber(line[135]),
      maxelev2: toNumber(line[136]),
      maxelev3: toNumber(line[137]),
      maxelev4: toNumber(line[138]),
      maxelev5: toNumber(line[139]),
      srcdamage: toNumber(line[111]),
      mindamage: toNumber(line[114]),
      maxdamage: toNumber(line[120]),
      minlevdam1: toNumber(line[115]),
      minlevdam2: toNumber(line[116]),
      minlevdam3: toNumber(line[117]),
      minlevdam4: toNumber(line[118]),
      minlevdam5: toNumber(line[119]),
      maxlevdam1: toNumber(line[121]),
      maxlevdam2: toNumber(line[122]),
      maxlevdam3: toNumber(line[123]),
      maxlevdam4: toNumber(line[124]),
      maxlevdam5: toNumber(line[125]),
      elen: toNumber(line[141]),
      elevlen1: toNumber(line[142]),
      elevlen2: toNumber(line[143]),
      elevlen3: toNumber(line[144]),
    };
  }

  await writeJson('missiles', missiles);
  return missiles;
}
