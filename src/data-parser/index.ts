#!/usr/bin/env node
/**
 * Data pipeline entry point.
 *
 * Usage:  npx tsx src/data-parser/index.ts
 *    or:  npm run build:data
 *
 * Steps:
 *   1. Generate strings.json from JSON string files + TBL files
 *   2. Run all table parsers → individual JSONs in data/json/
 *   3. Merge everything into data/data.json
 */

import { resolve } from 'node:path';
import { generateStrings } from './strings.js';
import { generateAll } from './generate-all.js';
import { mergeJsonFiles } from './merge-json.js';
import { DATA_PATH } from './files.js';

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== d2r-saver data pipeline ===');

  console.log('[1/3] Generating strings ...');
  await generateStrings();

  console.log('[2/3] Generating table JSONs ...');
  await generateAll();

  console.log('[3/3] Merging into data.json ...');
  const jsonDir = resolve(DATA_PATH, 'json');
  const outFile = resolve(DATA_PATH, 'data.json');
  await mergeJsonFiles(jsonDir, outFile);

  console.log(`Done in ${Date.now() - t0}ms → ${outFile}`);
}

main().catch((err) => {
  console.error('Data pipeline failed:', err);
  process.exitCode = 1;
});
