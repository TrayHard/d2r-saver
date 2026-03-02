import { readGameFile, writeJson, getString } from '../files.js';

export async function monTypeToJson(): Promise<Record<string, unknown>> {
  const table = await readGameFile('monType');
  const monType: Record<string, unknown> = {};

  for (const line of table) {
    if (getString(line[0]).trim() === '') continue;
    const code = getString(line[0]).trim();
    monType[code] = {
      equiv1: getString(line[1] + ' ').trim() || undefined,
      equiv2: getString(line[2] + ' ').trim() || undefined,
      equiv3: getString(line[3] + ' ').trim() || undefined,
    };
  }

  await writeJson('monType', monType);
  return monType;
}
