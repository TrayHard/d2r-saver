import { readGameFile, writeJson, getString } from '../files.js';
import { toNumber } from '../to-number.js';

export async function propertiesToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('properties');
  const properties: Record<string, unknown> = {};

  for (const line of table) {
    const code = getString(line[0] + ' ').trim();
    properties[code] = {
      stat1: getString(line[3] + ' ').trim() || undefined,
      stat2: getString(line[7] + ' ').trim() || undefined,
      stat3: getString(line[11] + ' ').trim() || undefined,
      stat4: getString(line[15] + ' ').trim() || undefined,
      stat5: getString(line[19] + ' ').trim() || undefined,
      stat6: getString(line[23] + ' ').trim() || undefined,
      stat7: getString(line[27] + ' ').trim() || undefined,
      set1: toNumber(line[4]),
      set2: toNumber(line[8]),
      set3: toNumber(line[12]),
      set4: toNumber(line[16]),
      set5: toNumber(line[20]),
      set6: toNumber(line[24]),
      set7: toNumber(line[28]),
      val1: toNumber(line[5]),
      val2: toNumber(line[9]),
      val3: toNumber(line[13]),
      val4: toNumber(line[17]),
      val5: toNumber(line[21]),
      val6: toNumber(line[25]),
      val7: toNumber(line[29]),
      func1: toNumber(line[2]),
      func2: toNumber(line[6]),
      func3: toNumber(line[10]),
      func4: toNumber(line[14]),
      func5: toNumber(line[18]),
      func6: toNumber(line[22]),
      func7: toNumber(line[26]),
    };
  }

  await writeJson('properties', properties);
  return properties;
}
