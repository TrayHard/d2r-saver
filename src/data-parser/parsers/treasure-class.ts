import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

function stripQuotes(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const str = String(value).trim();
  if (str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1);
  }
  return str || undefined;
}

export async function treasureClassToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('treasureClass');
  const treasureClass: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    const code = getString(line[0] + ' ').trim();
    treasureClass[code] = {
      item1: stripQuotes(line[9]?.trim()) || undefined,
      item2: stripQuotes(line[11]?.trim()) || undefined,
      item3: stripQuotes(line[13]?.trim()) || undefined,
      item4: stripQuotes(line[15]?.trim()) || undefined,
      item5: stripQuotes(line[17]?.trim()) || undefined,
      item6: stripQuotes(line[19]?.trim()) || undefined,
      item7: stripQuotes(line[21]?.trim()) || undefined,
      item8: stripQuotes(line[23]?.trim()) || undefined,
      item9: stripQuotes(line[25]?.trim()) || undefined,
      item10: stripQuotes(line[27]?.trim()) || undefined,
      picks: toNumber(line[3]),
      level: toNumber(line[2]),
      group: toNumber(line[1]),
      nodrop: toNumber(line[8]),
      unique: toNumber(line[4]),
      set: toNumber(line[5]),
      rare: toNumber(line[6]),
      magic: toNumber(line[7]),
      prob1: toNumber(line[10]),
      prob2: toNumber(line[12]),
      prob3: toNumber(line[14]),
      prob4: toNumber(line[16]),
      prob5: toNumber(line[18]),
      prob6: toNumber(line[20]),
      prob7: toNumber(line[22]),
      prob8: toNumber(line[24]),
      prob9: toNumber(line[26]),
      prob10: toNumber(line[28]),
    };
  }

  await writeJson('treasureClass', treasureClass);
  return treasureClass;
}
