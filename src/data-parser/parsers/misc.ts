import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';
import { getHD } from '../get-hd.js';

export async function miscToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('Misc');
  const misc: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[14]).trim() === '') continue;
    const code = line[14].trim();
    misc[code] = {
      name: getString(line[0].trim()),
      code: line[14].trim(),
      namestr: line[16].trim(),
      invfile: line[24].trim(),
      type: line[31].trim(),
      stat1: line[55].trim() || undefined,
      stat2: line[57].trim() || undefined,
      stat3: line[59].trim() || undefined,
      spelldescstr: line[62].trim() || undefined,
      spawnable: toNumber(line[9]),
      version: toNumber(line[2]),
      level: toNumber(line[3]),
      levelreq: toNumber(line[5]),
      speed: toNumber(line[10]),
      nodurability: toNumber(line[11]),
      cost: toNumber(line[12]),
      invwidth: toNumber(line[18]),
      invheight: toNumber(line[19]),
      hasinv: toNumber(line[20]),
      gemsockets: toNumber(line[21]),
      bitfield1: toNumber(line[70]),
      gemapplytype: toNumber(line[22]),
      unique: toNumber(line[36]),
      belt: toNumber(line[40]),
      stackable: toNumber(line[42]),
      minstack: toNumber(line[43]),
      maxstack: toNumber(line[44]),
      calc1: toNumber(line[56]),
      calc2: toNumber(line[58]),
      calc3: toNumber(line[60]),
      spelldesc: toNumber(line[61]),
      spelldesccalc: toNumber(line[64]),
      invtrans: toNumber(line[157]),
      skipname: toNumber(line[158]),
      useable: toNumber(line[30]),
      quest: toNumber(line[46]),
      hd: getHD(code, 'misc'),
    };

    // Pure runes: use own code as namestr
    const entry = misc[code] as Record<string, unknown>;
    if ((entry.name as string)?.endsWith(' Pure') && entry.type === 'rune') {
      entry.namestr = code;
      entry.name = (entry.name as string).replace(' Pure', ' (Pure)');
    }
  }

  // Fill missing HD
  for (const item of Object.values(misc) as Array<Record<string, unknown>>) {
    if (!item.hd || (Array.isArray(item.hd) && item.hd.length === 0)) {
      const cleanName = (item.name as string)?.replace(/ (99|Diablo|Disenchanted)$/, '');
      if (cleanName !== item.name) {
        const match = (Object.values(misc) as Array<Record<string, unknown>>).find(
          (o) => o.name === cleanName && o.hd && (Array.isArray(o.hd) ? o.hd.length > 0 : true),
        );
        if (match) item.hd = match.hd;
      }
    }
  }

  await writeJson('misc', misc);
  return misc;
}
