import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';
import { getHD } from '../get-hd.js';

export async function weaponsToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('Weapons');
  const weapons: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[3] + ' ').trim() === '') continue;
    const code = getString(line[3] + ' ').trim();
    weapons[code] = {
      name: getString(line[0] + ' ').trim() || undefined,
      type: getString(line[1] + ' ').trim() || undefined,
      code,
      namestr: getString(line[5] + ' ').trim() || undefined,
      normcode: getString(line[37] + ' ').trim() || undefined,
      ubercode: getString(line[38] + ' ').trim() || undefined,
      ultracode: getString(line[39] + ' ').trim() || undefined,
      wclass: getString(line[40] + ' ').trim() || undefined,
      '2handedwclass': getString(line[41] + ' ').trim() || undefined,
      invfile: getString(line[51] + ' ').trim() || undefined,
      uniqueinvfile: getString(line[52] + ' ').trim() || undefined,
      setinvfile: getString(line[53] + ' ').trim() || undefined,
      spawnable: toNumber(line[9]),
      '1or2handed': toNumber(line[16]),
      '2handed': toNumber(line[17]),
      '2handmindam': toNumber(line[18]),
      '2handmaxdam': toNumber(line[19]),
      version: toNumber(line[6]),
      mindam: toNumber(line[14]),
      maxdam: toNumber(line[15]),
      minmisdam: toNumber(line[20]),
      maxmisdam: toNumber(line[21]),
      bitfield1: toNumber(line[74]),
      rangeadder: toNumber(line[22]),
      speed: toNumber(line[23]),
      strbonus: toNumber(line[24]),
      reqstr: toNumber(line[26]),
      reqdex: toNumber(line[27]),
      durability: toNumber(line[28]),
      level: toNumber(line[30]),
      levelreq: toNumber(line[32]),
      cost: toNumber(line[33]),
      gamblecost: toNumber(line[34]),
      autoprefix: toNumber(line[36]),
      invwidth: toNumber(line[44]),
      invheight: toNumber(line[45]),
      stackable: toNumber(line[46]),
      minstack: toNumber(line[47]),
      maxstack: toNumber(line[48]),
      hasinv: toNumber(line[54]),
      gemsockets: toNumber(line[55]),
      gemapplytype: toNumber(line[56]),
      unique: toNumber(line[62]),
      quest: toNumber(line[68]),
      invtrans: toNumber(line[161]),
      skipname: toNumber(line[162]),
      missiletype: toNumber(line[70]),
      hd: getHD(code, 'weapons'),
    };
  }

  // Fill missing HD
  for (const item of Object.values(weapons) as Array<Record<string, unknown>>) {
    if (!item.hd || (Array.isArray(item.hd) && item.hd.length === 0)) {
      const cleanName = (item.name as string)?.replace(/ 99$/, '');
      const match = (Object.values(weapons) as Array<Record<string, unknown>>).find(
        (o) => o.name === cleanName && o.hd && (Array.isArray(o.hd) ? o.hd.length > 0 : true),
      );
      if (match) item.hd = match.hd;
    }
  }

  await writeJson('weapons', weapons);
  return weapons;
}
