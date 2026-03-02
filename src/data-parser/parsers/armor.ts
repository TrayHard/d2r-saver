import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';
import { getHD } from '../get-hd.js';

export async function armorsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('Armor');
  const armors: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[18]).trim() === '') continue;
    const code = getString(line[18] + ' ').trim();
    armors[code] = {
      name: getString(line[0] + ' ').trim() || undefined,
      code,
      namestr: getString(line[19] + ' ').trim() || undefined,
      normcode: getString(line[23] + ' ').trim() || undefined,
      ubercode: getString(line[24] + ' ').trim() || undefined,
      ultracode: getString(line[25] + ' ').trim() || undefined,
      invfile: getString(line[33] + ' ').trim() || undefined,
      uniqueinvfile: getString(line[34] + ' ').trim() || undefined,
      setinvfile: getString(line[35] + ' ').trim() || undefined,
      type: getString(line[51] + ' ').trim() || undefined,
      spawnable: toNumber(line[4]),
      version: toNumber(line[1]),
      speed: toNumber(line[7]),
      minac: toNumber(line[5]),
      maxac: toNumber(line[6]),
      reqstr: toNumber(line[8]),
      block: toNumber(line[10]),
      durability: toNumber(line[11]),
      nodurability: toNumber(line[12]),
      level: toNumber(line[13]),
      levelreq: toNumber(line[15]),
      cost: toNumber(line[16]),
      gamblecost: toNumber(line[17]),
      autoprefix: toNumber(line[21]),
      bitfield1: toNumber(line[72]),
      invwidth: toNumber(line[27]),
      invheight: toNumber(line[28]),
      hasinv: toNumber(line[29]),
      gemsockets: toNumber(line[30]),
      gemapplytype: toNumber(line[31]),
      unique: toNumber(line[56]),
      belt: toNumber(line[61]),
      mindam: toNumber(line[67]),
      maxdam: toNumber(line[68]),
      strbonus: toNumber(line[69]),
      invtrans: toNumber(line[159]),
      skipname: toNumber(line[160]),
      hd: getHD(code, 'armor'),
    };
  }

  // Fill missing HD by matching clean name (strip " 99" suffix)
  for (const item of Object.values(armors) as Array<Record<string, unknown>>) {
    if (!item.hd || (Array.isArray(item.hd) && item.hd.length === 0)) {
      const cleanName = (item.name as string)?.replace(/ 99$/, '');
      const match = (Object.values(armors) as Array<Record<string, unknown>>).find(
        (o) => o.name === cleanName && o.hd && (Array.isArray(o.hd) ? o.hd.length > 0 : true),
      );
      if (match) item.hd = match.hd;
    }
  }

  await writeJson('armor', armors);
  return armors;
}
