/**
 * Merge all individual JSON files from a folder into a single combined JSON file.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

export async function mergeJsonFiles(inputFolder: string, outputFile: string): Promise<void> {
  const result: Record<string, unknown> = {};
  const files = await readdir(inputFolder);
  const jsonFiles = files.filter((file) => extname(file).toLowerCase() === '.json');

  await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const filePath = join(inputFolder, file);
        const fileContent = await readFile(filePath, 'utf-8');
        const jsonData = JSON.parse(fileContent) as unknown;
        const fileName = basename(file, '.json');
        result[fileName] = jsonData;
      } catch (err) {
        console.error((err as Error).message);
      }
    }),
  );

  await writeFile(outputFile, JSON.stringify(result));
}
