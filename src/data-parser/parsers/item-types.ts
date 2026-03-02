import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function itemTypeToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('itemtypes');
  const itemTypes: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[1]).trim() === '') continue;
    const code = getString(line[1]).trim().toLowerCase();
    itemTypes[code] = {
      equiv1: getString(line[2] + ' ').trim() || undefined,
      equiv2: getString(line[3] + ' ').trim() || undefined,
      bodyloc1: getString(line[6] + ' ').trim() || undefined,
      bodyloc2: getString(line[7] + ' ').trim() || undefined,
      invgfx1: getString(line[28] + ' ').trim() || undefined,
      invgfx2: getString(line[29] + ' ').trim() || undefined,
      invgfx3: getString(line[30] + ' ').trim() || undefined,
      invgfx4: getString(line[31] + ' ').trim() || undefined,
      invgfx5: getString(line[32] + ' ').trim() || undefined,
      invgfx6: getString(line[33] + ' ').trim() || undefined,
      shoots: getString(line[8] + ' ').trim() || undefined,
      class: getString(line[26] + ' ').trim() || undefined,
      staffmods: getString(line[25] + ' ').trim() || undefined,
      quiver: getString(line[9] + ' ').trim() || undefined,
      body: toNumber(line[5]),
      throwable: toNumber(line[10]),
      magic: toNumber(line[14]),
      rare: toNumber(line[15]),
      normal: toNumber(line[16]),
      beltable: toNumber(line[17]),
      maxsock1: toNumber(line[18]),
      maxsock25: toNumber(line[20]),
      maxsock40: toNumber(line[22]),
      varinvgfx: toNumber(line[27]),
      treasureclass: toNumber(line[23]),
    };
  }

  await writeJson('itemTypes', itemTypes);
  return itemTypes;
}
