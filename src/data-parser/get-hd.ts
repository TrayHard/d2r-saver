/**
 * HD icon path resolver.
 * Maps item codes to HD asset paths using hd/items/*.json and hditemlib.json.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_PATH } from './files.js';

// ── Lazy-loaded lookup data ──────────────────────────────────────

let _loaded = false;
let hdItemLib: Record<string, unknown> = {};
let itemsMap: Record<string, { asset: string | string[] }> = {};
let uniquesMap: Record<string, { normal: string; uber: string; ultra: string }> = {};
let setsMap: Record<string, { normal: string; uber: string; ultra: string }> = {};

function ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;

  try {
    hdItemLib = JSON.parse(
      readFileSync(resolve(DATA_PATH, 'hditemlib.json'), 'utf-8'),
    ) as Record<string, unknown>;
  } catch { hdItemLib = {}; }

  try {
    const hdItems = JSON.parse(
      readFileSync(resolve(DATA_PATH, 'json/hd/items/items.json'), 'utf-8'),
    ) as Array<Record<string, { asset: string | string[] }>>;
    itemsMap = Object.assign({}, ...hdItems) as typeof itemsMap;
  } catch { itemsMap = {}; }

  try {
    const hdUniques = JSON.parse(
      readFileSync(resolve(DATA_PATH, 'json/hd/items/uniques.json'), 'utf-8'),
    ) as Array<Record<string, { normal: string; uber: string; ultra: string }>>;
    uniquesMap = Object.assign({}, ...hdUniques) as typeof uniquesMap;
  } catch { uniquesMap = {}; }

  try {
    const hdSets = JSON.parse(
      readFileSync(resolve(DATA_PATH, 'json/hd/items/sets.json'), 'utf-8'),
    ) as Array<Record<string, { normal: string; uber: string; ultra: string }>>;
    setsMap = Object.assign({}, ...hdSets) as typeof setsMap;
  } catch { setsMap = {}; }
}

// ── Helpers ──────────────────────────────────────────────────────

const questHD: Record<string, string> = {
  cr1: 'quest/parts_1',
  cr2: 'quest/parts_2',
  cr3: 'quest/parts_3',
};

function isHDIcon(hd: unknown): boolean {
  if (!hd) return false;
  const hasIcon = (path: string) =>
    Object.prototype.hasOwnProperty.call(hdItemLib, path);
  if (typeof hd === 'string') return hasIcon(hd);
  if (Array.isArray(hd)) return hd.length > 0 && hd.every(hasIcon);
  return false;
}

function snakeCase(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .normalize('NFKD')
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1_$2')
    .replace(/([0-9])([a-zA-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
    .trim();
}

// ── Public ───────────────────────────────────────────────────────

export function getHD(name: string | undefined, type: string): string[] | string {
  ensureLoaded();

  if (!name) return [];
  let hd: string[] | string = [];
  const key = snakeCase(name);

  if (type === 'uniqueItems') {
    const val =
      uniquesMap[key] ??
      uniquesMap[snakeCase(name.replace(/ (Cr|Player)$/, ''))];
    if (val) hd = [val.normal, val.uber, val.ultra];
  } else if (type === 'setItems') {
    const val =
      setsMap[key] ??
      setsMap[snakeCase(name.replace(/ (Cr|Player)$/, ''))];
    if (val) hd = [val.normal, val.uber, val.ultra];
  } else {
    const entry = itemsMap[name];
    if (entry) {
      hd = Array.isArray(entry.asset) ? entry.asset : entry.asset;
    }
  }

  if (isHDIcon(hd)) return hd;

  // Fallback: search hditemlib for a path ending with /{key}
  if (type === 'uniqueItems' || type === 'setItems') {
    const suffix = `/${key}`;
    const match = Object.keys(hdItemLib).find((p) => p.endsWith(suffix));
    if (match) return [match, match, match];
  }

  if (questHD[name]) return questHD[name];

  return [];
}

/** Reset cached data (useful for testing or re-running). */
export function resetHdCache(): void {
  _loaded = false;
  hdItemLib = {};
  itemsMap = {};
  uniquesMap = {};
  setsMap = {};
}
