/**
 * Item stat parser — determines mod sources for parsed items.
 *
 * Ported from d2planner/src/logic/parser.js.
 * Provides: parseModStats, parseUniqueStats, parseRunewordStats.
 *
 * These functions analyze item stats read from the binary save file
 * and determine which affixes (mods) produced those stats, along with
 * the variable values (uniqueValues) for unique/set/runeword items.
 *
 * Uses GameData instead of global Data singleton.
 */

import { GameData } from '../game-data/game-data.js';
import type { StatValue } from './item.js';
import { modsToStats, uniqueStats, runewordStats } from './item.js';
import { itemGetTypes, itemCheckMod, itemGetType } from './item-types.js';

// ─── Types ──────────────────────────────────────────────────────

interface ParsedItem {
  base: string;
  quality: number;
  unique?: string;
  [key: string]: unknown;
}

type StatsGetter = (src: Record<string, StatValue>) => Record<string, StatValue> | null;

// ─── Internal: itemListMods ─────────────────────────────────────

/**
 * List all applicable mods for a given item (by base code and quality).
 * Returns groups: prefix, suffix, auto, crafted, superior, staff.
 */
function itemListMods(
  gd: GameData,
  id: string,
  quality: number,
  magic?: { prefix?: string; suffix?: string } | null,
): Record<string, string[]> {
  const item = gd.items[id];
  if (!item) return {};
  const types = itemGetTypes(gd, id);

  function listMods(
    modList: Record<string, Record<string, unknown>>,
    name: string | null | undefined,
    gid: number | null | undefined,
    supt: string | null | undefined,
  ): string[] {
    return Object.keys(modList).filter(modId => {
      const mod = modList[modId];
      if (supt != null && !mod[supt]) return false;
      if (gid != null && mod.group !== gid) return false;
      if (name != null) {
        const modName = (gd.locale.strings[(mod.name as string)] || (mod.name as string));
        if (modName !== name) return false;
      }
      return itemCheckMod(gd, mod, item as unknown as Record<string, unknown>, types, quality);
    });
  }

  const result: Record<string, string[]> = {};

  // Magic prefix/suffix
  if (quality === 4 || quality === 6 || quality === 8) { // MAGIC, RARE, CRAFTED
    result.prefix = listMods(
      gd.magicPrefix as unknown as Record<string, Record<string, unknown>>,
      magic ? (magic.prefix || '') : null,
      undefined,
      undefined,
    );
    result.suffix = listMods(
      gd.magicSuffix as unknown as Record<string, Record<string, unknown>>,
      magic ? (magic.suffix || '') : null,
      undefined,
      undefined,
    );
  }

  // Auto prefix
  const itemAny = item as unknown as Record<string, unknown>;
  if (itemAny.autoprefix) {
    result.auto = listMods(
      gd.autoMagic as unknown as Record<string, Record<string, unknown>>,
      null,
      itemAny.autoprefix as number,
      undefined,
    );
  }

  // Crafted mods
  if (quality === 8) { // CRAFTED
    result.crafted = listMods(
      gd.crafted as unknown as Record<string, Record<string, unknown>>,
      null, undefined, undefined,
    );
  }

  // Superior / runeword quality mods
  if (quality === 3 || quality === 9) { // SUPERIOR or RUNEWORD
    const supt = itemGetType(types);
    if (supt) {
      result.superior = listMods(
        gd.qualityItems as unknown as Record<string, Record<string, unknown>>,
        null, undefined, supt,
      );
    }
  }

  // Staff mods (class-specific)
  if (gd.itemTypes[item.type]?.staffmods && quality !== 7 && quality !== 5) { // not UNIQUE/SET
    result.staff = listMods(
      gd.staffMods as unknown as Record<string, Record<string, unknown>>,
      null, undefined, undefined,
    );
  }

  return result;
}

// ─── Internal: subtractStats ────────────────────────────────────

function subtractStats(
  dst: Record<string, StatValue>,
  src: Record<string, StatValue>,
  orig?: Record<string, number>,
): boolean {
  for (const id in src) {
    if (orig && orig[id] && orig[id] < 0) {
      (dst as Record<string, number>)[id] = ((dst as Record<string, number>)[id] || 0) - (src[id] as number);
      continue;
    }
    if (id === 'coldlength') continue;
    if (!dst[id]) return false;
    if (typeof dst[id] === 'object') {
      const d = dst[id] as { min: number; max: number };
      if (Math.max(Math.abs(d.min), Math.abs(d.max)) < Math.abs(src[id] as number)) return false;
      d.min -= src[id] as number;
      d.max -= src[id] as number;
    } else {
      if (Math.abs(dst[id] as number) < Math.abs(src[id] as number)) return false;
      (dst as Record<string, number>)[id] -= src[id] as number;
      if (!(dst[id] as number)) delete dst[id];
    }
  }
  return true;
}

// ─── Internal: parseMods (brute-force mod matcher) ──────────────

interface ModRange {
  min: number;
  max: number;
  index?: number;
}

/**
 * Brute-force search for the combination of mods that produce the observed stats.
 */
function parseMods(
  gd: GameData,
  stats: Record<string, StatValue>,
  modVals: Record<string, Record<string, StatValue>>,
  quality: number,
  presetMods?: string[],
): Record<string, number[]> | null {
  // Build target vector
  const target: Record<string, ModRange> = {};

  switch (quality) {
    case 3: // SUPERIOR
      target.n_superior = { min: 1, max: 1 };
      break;
    case 4: // MAGIC
      target.n_prefix = { min: 0, max: 1 };
      target.n_suffix = { min: 0, max: 1 };
      target.n_affix = { min: 1, max: 2 };
      break;
    case 6: // RARE
      target.n_prefix = { min: 0, max: 3 };
      target.n_suffix = { min: 0, max: 3 };
      target.n_affix = { min: 3, max: 6 };
      break;
    case 8: // CRAFTED
      target.n_crafted = { min: 1, max: 1 };
      target.n_prefix = { min: 0, max: 3 };
      target.n_suffix = { min: 0, max: 3 };
      target.n_affix = { min: 1, max: 4 };
      break;
    case 9: // RUNEWORD
      target.n_superior = { min: 0, max: 1 };
      break;
  }

  if (presetMods) {
    for (const id of presetMods) {
      target[`m_${id}`] = { min: 1, max: 1 };
    }
  }
  if (Object.keys(modVals).some(id => (gd.autoMagic as Record<string, unknown>)[id])) {
    target.n_auto = { min: 1, max: 1 };
  }
  if (modVals.runeword) {
    target.n_runeword = { min: 1, max: 1 };
  }
  for (const id in stats) {
    if (typeof stats[id] === 'object') {
      const obj = stats[id] as { min: number; max: number };
      target[id] = { min: obj.min, max: obj.max };
    } else {
      const v = stats[id] as number;
      target[id] = { min: v, max: v };
    }
  }

  // Build source vectors
  const groups: Record<number, { mods: Record<string, Record<string, ModRange>>; repeats: number; max: Record<string, number> }> = {};
  const modLimits: Record<string, Record<string, ModRange>> = {};
  const negative = new Set<string>();

  for (const [id, mstat] of Object.entries(modVals)) {
    const modsrc: Record<string, ModRange> = {};

    if ((gd.magicPrefix as Record<string, unknown>)[id]) {
      modsrc.n_prefix = { min: 1, max: 1 };
      modsrc.n_affix = { min: 1, max: 1 };
    }
    if ((gd.magicSuffix as Record<string, unknown>)[id]) {
      modsrc.n_suffix = { min: 1, max: 1 };
      modsrc.n_affix = { min: 1, max: 1 };
    }
    if ((gd.crafted as Record<string, unknown> | undefined)?.[id]) {
      modsrc.n_crafted = { min: 1, max: 1 };
    }
    if ((gd.autoMagic as Record<string, unknown>)[id]) {
      modsrc.n_auto = { min: 1, max: 1 };
    }
    if ((gd.qualityItems as Record<string, unknown>)[id]) {
      modsrc.n_superior = { min: 1, max: 1 };
    }
    if (id === 'runeword') {
      modsrc.n_runeword = { min: 1, max: 1 };
    }
    if (presetMods?.includes(id)) {
      modsrc[`m_${id}`] = { min: 1, max: 1 };
    }

    const usedIndices: Record<number, boolean> = {};
    let repeats = 0;
    for (const [sid, value] of Object.entries(mstat)) {
      if (sid === 'coldlength') continue;

      const chargedMatch = sid.match(/item_charged_skill#(\d+)#/);
      if (chargedMatch) {
        const nstat = Object.keys(stats).find(s => s.includes(chargedMatch[0])) || sid;
        const nval = (stats[nstat] ?? value) as number;
        modsrc[nstat] = { min: nval, max: nval };
      } else if (typeof value === 'number') {
        modsrc[sid] = { min: value, max: value };
        if (value < 0) negative.add(sid);
      } else if (typeof value === 'string') {
        const m = (value as string).match(/^\{(\d)\}$/);
        if (m) {
          const mod = gd.mods[id] as Record<string, unknown>;
          const min = mod[`mod${m[1]}min`] as number;
          const max = mod[`mod${m[1]}max`] as number;
          const index = parseInt(m[1]) - 1;
          modsrc[sid] = { min, max, index };
          if (usedIndices[index]) repeats += 1;
          usedIndices[index] = true;
          if (min < 0) negative.add(sid);
        }
      }
    }

    if (Object.keys(modsrc).every(sid => target[sid])) {
      const gid = (gd.mods[id] as Record<string, unknown>)?.group as number || 0;
      if (!groups[gid]) groups[gid] = { mods: {}, repeats: 0, max: {} };
      groups[gid].mods[id] = modsrc;
      groups[gid].repeats = Math.max(groups[gid].repeats, repeats);
      modLimits[id] = modsrc;
    }
  }

  // Negate negative stat targets and sources
  const negate = ({ min, max, index }: ModRange): ModRange => {
    const r: ModRange = { min: -max, max: -min };
    if (index != null) r.index = index;
    return r;
  };
  for (const id of negative) {
    if (!target[id]) continue;
    target[id] = negate(target[id]);
    for (const mod of Object.values(modLimits)) {
      if (mod[id]) mod[id] = negate(mod[id]);
    }
  }

  // Build source groups and partial sums
  const source = Object.values(groups);
  for (const group of source) {
    group.max = {};
    for (const mod of Object.values(group.mods)) {
      for (const id in target) {
        mod[id] = mod[id] || { min: 0, max: 0 };
        group.max[id] = Math.max(group.max[id] || 0, mod[id].max);
      }
    }
  }
  source.sort((a, b) => a.repeats - b.repeats);

  // Reverse partial sums for pruning
  const reverse: Record<string, number>[] = new Array(source.length + 1);
  reverse[source.length] = {};
  for (const id in target) reverse[source.length][id] = 0;
  for (let i = source.length - 1; i >= 0; --i) {
    reverse[i] = { ...reverse[i + 1] };
    for (const id in source[i].max) {
      reverse[i][id] += source[i].max[id];
    }
  }

  // Recursive brute-force
  const result: string[] = [];
  const ids = Object.keys(target);

  function iterate(i: number, tmin: Record<string, number>, tmax: Record<string, number>): boolean {
    if (i >= source.length) {
      return ids.every(id => tmin[id] <= 0 && tmax[id] >= 0);
    }

    const next = reverse[i + 1];
    for (const m in source[i].mods) {
      const src = source[i].mods[m];

      const pmin: number[] = [];
      const pmax: number[] = [];
      for (const id in stats) {
        const { min, max, index } = src[id];
        if (index != null) {
          const cmin = Math.max(min, tmin[id] - next[id]);
          const cmax = Math.min(max, tmax[id]);
          pmin[index] = pmin[index] == null ? cmin : Math.max(pmin[index], cmin);
          pmax[index] = pmax[index] == null ? cmax : Math.min(pmax[index], cmax);
        }
      }

      if (ids.every(id => src[id].min <= tmax[id] && src[id].max + next[id] >= tmin[id]) &&
        Object.keys(pmin).every(idx => pmin[parseInt(idx)] <= pmax[parseInt(idx)])) {
        const nmin = { ...tmin };
        const nmax = { ...tmax };
        for (const id in src) {
          const { min, max, index } = src[id];
          if (index != null) {
            nmin[id] -= pmax[index];
            nmax[id] -= pmin[index];
          } else {
            nmin[id] -= max;
            nmax[id] -= min;
          }
        }
        result.push(m);
        if (iterate(i + 1, nmin, nmax)) return true;
        result.pop();
      }
    }

    if (ids.every(id => next[id] >= tmin[id])) {
      return iterate(i + 1, tmin, tmax);
    }
    return false;
  }

  const tmin: Record<string, number> = {};
  const tmax: Record<string, number> = {};
  for (const id in target) {
    tmin[id] = target[id].min;
    tmax[id] = target[id].max;
  }

  if (iterate(0, tmin, tmax)) {
    result.reverse();

    const rmin: Record<string, number> = {};
    const rmax: Record<string, number> = {};
    const nmin: Record<string, number> = {};
    const nmax: Record<string, number> = {};
    for (const sid in stats) {
      rmin[sid] = rmax[sid] = 0;
      nmin[sid] = typeof stats[sid] === 'object' ? (stats[sid] as { min: number }).min : stats[sid] as number;
      nmax[sid] = typeof stats[sid] === 'object' ? (stats[sid] as { max: number }).max : stats[sid] as number;
      for (const id of result) {
        rmin[sid] += modLimits[id][sid].min;
        rmax[sid] += modLimits[id][sid].max;
      }
    }

    const output: Record<string, number[]> = {};
    for (const id of result) {
      const values: number[] = [];
      const modi = gd.mods[id] as Record<string, unknown>;
      if (modi.mod1max != null) values[0] = modi.mod1max as number;
      if (modi.mod2max != null) values[1] = modi.mod2max as number;
      if (modi.mod3max != null) values[2] = modi.mod3max as number;
      if (modi.mod4max != null) values[3] = modi.mod4max as number;
      if (modi.mod5max != null) values[4] = modi.mod5max as number;
      if (modi.mod6max != null) values[5] = modi.mod6max as number;
      if (modi.mod7max != null) values[6] = modi.mod7max as number;

      const pmin: number[] = [];
      const pmax: number[] = [];
      for (const sid in stats) {
        const { min, max, index } = modLimits[id][sid];
        if (index != null) {
          const cmin = Math.max(min, nmin[sid] + max - rmax[sid]);
          const cmax = Math.min(max, nmax[sid] + min - rmin[sid]);
          pmin[index] = pmin[index] == null ? cmin : Math.max(pmin[index], cmin);
          pmax[index] = pmax[index] == null ? cmax : Math.min(pmax[index], cmax);
        }
      }

      for (const sid in stats) {
        const { min, max, index } = modLimits[id][sid];
        if (index != null) {
          if (pmin[index] > pmax[index]) return null;
          const value = (pmin[index] + pmax[index]) >> 1;
          nmin[sid] -= value;
          nmax[sid] -= value;
          values[index] = negative.has(sid) ? -value : value;
        } else {
          nmin[sid] -= min;
          nmax[sid] -= max;
        }
        rmin[sid] -= min;
        rmax[sid] -= max;
      }

      output[id] = values;
    }
    return output;
  }

  return null;
}

// ─── parseParamStats ────────────────────────────────────────────

/**
 * Post-process binary stats into a format suitable for mod matching.
 * Handles descfunc 13/27 stats (class skill bonuses, single-skill bonuses).
 * Ported from d2planner binary/index.js → parseParamStats().
 */
export function parseParamStats(
  gd: GameData,
  stats: Record<string, number>,
  src: Record<string, StatValue>,
): Record<string, StatValue> | null {
  const result: Record<string, StatValue> = {};

  for (const idFull in src) {
    const parts = idFull.split('#');
    const id = parts[0];
    const stat = gd.itemStatCost[id];

    // Non-descfunc stats: try to match directly
    if (!stat?.descfunc) {
      if (stats[idFull] != null) {
        result[idFull] = stats[idFull];
      } else if (typeof src[idFull] === 'number') {
        // Fixed value from mod definition — keep if matches
        result[idFull] = src[idFull];
      }
      continue;
    }

    // descfunc 13: class skill stats (e.g. "+2 to Amazon Skill Levels")
    if (stat.descfunc === 13 && parts[2] === 'x') {
      // The param is the value, param2 is the class
      const value = parts[1];
      for (let cls = 0; cls < GameData.strClassSkillsStat.length; ++cls) {
        const key = `${id}#${value}#${cls}`;
        if (stats[key] != null) {
          result[key] = stats[key];
          break;
        }
      }
      continue;
    }

    // descfunc 27: single-skill stats (e.g. "+3 to Frozen Orb (Sorceress Only)")
    if (stat.descfunc === 27 && parts[2] === 'x') {
      const value = parts[1];
      for (const skillId in gd.skills) {
        const key = `${id}#${skillId}#${value}`;
        if (stats[key] != null) {
          result[key] = stats[key];
          break;
        }
      }
      continue;
    }

    // Standard stat: copy from binary stats
    if (stats[idFull] != null) {
      result[idFull] = stats[idFull];
    }
  }

  // Check that all required src stats were resolved
  for (const idFull in src) {
    const parts = idFull.split('#');
    const id = parts[0];
    const stat = gd.itemStatCost[id];
    if (stat?.descfunc && result[idFull] == null) {
      // Try finding by prefix (for parameterized stats)
      const found = Object.keys(result).some(k => k.startsWith(id + '#'));
      if (!found && parts[2] !== 'x') {
        // Required stat missing
        return null;
      }
    }
  }

  return result;
}

// ─── parseUniqueStats ───────────────────────────────────────────

/**
 * Determine the variable values for a unique/set item by analyzing binary stats.
 * Returns `{uniqueValues, propertyIndex}` (matching d2planner HEAD) or null
 * when the stats don't match the definition.
 *
 * `propertyIndex` maps each propertyGroup property name to the picked option
 * index (warlock items use this for "pick a skill tab" style rolls).
 */
export function parseUniqueStats(
  gd: GameData,
  item: ParsedItem,
  getStats: StatsGetter,
): { uniqueValues: number[]; propertyIndex: Record<string, number> } | null {
  const uniq = (gd.uniqueItems[item.unique!] || gd.setItems[item.unique!]) as Record<string, unknown> | undefined;
  if (!uniq) return null;

  // Build source stats with template values
  const values: StatValue[] = [];
  for (let i = 0; i < 12; ++i) {
    if (!uniq[`prop${i + 1}`]) continue;
    const min = uniq[`min${i + 1}`] as number;
    const max = uniq[`max${i + 1}`] as number;
    values.push(min === max && max !== 0 ? max : `{${i}}`);
  }
  const statsSrc = uniqueStats(gd, {}, uniq, values, item as { base: string; ilvl?: number });

  const uniqueValues: number[] = [];
  const propertyIndex: Record<string, number> = {};
  const stats = getStats(statsSrc);
  if (!stats) return null;

  for (const id in statsSrc) {
    const descFunc = gd.itemStatCost[id]?.descfunc;
    if (descFunc || stats[id] != null) {
      if (stats[id] == null) return null;
      if ((descFunc! < 6 || descFunc! > 10) && typeof statsSrc[id] === 'number') {
        if (typeof stats[id] === 'object') {
          const s = stats[id] as { min: number; max: number };
          if ((statsSrc[id] as number) < s.min || (statsSrc[id] as number) > s.max) return null;
        } else {
          if (statsSrc[id] !== stats[id]) return null;
        }
      }
    }

    if (typeof statsSrc[id] === 'string') {
      const m = (statsSrc[id] as string).match(/\{(\d+)\}/);
      if (m) {
        const index = parseInt(m[1]);
        const min = (uniqueValues[index] != null ? uniqueValues[index] : uniq[`min${index + 1}`] as number);
        const max = (uniqueValues[index] != null ? uniqueValues[index] : uniq[`max${index + 1}`] as number);
        if (min === 0 && max === 0) {
          uniqueValues[index] = typeof stats[id] === 'object'
            ? (((stats[id] as { min: number }).min + (stats[id] as { max: number }).max) >> 1)
            : (stats[id] as number ?? 0);
        } else if (typeof stats[id] === 'object') {
          const s = stats[id] as { min: number; max: number };
          if (min > s.max || max < s.min) return null;
          uniqueValues[index] = (Math.max(s.min, min) + Math.min(s.max, max)) >> 1;
        } else {
          if ((stats[id] as number) < min || (stats[id] as number) > max) return null;
          uniqueValues[index] = stats[id] as number;
        }
      }
    }
  }

  // Fill non-variable slots. For propertyGroup props (pg), pick the actual
  // option index by scanning the group's mods for one whose mod1 stat is
  // present in `stats`; otherwise default to the def's `max`.
  for (let i = 0; i < 12; ++i) {
    const prop = uniq[`prop${i + 1}`] as string | undefined;
    if (!prop) continue;
    if (uniqueValues[i] != null) continue;

    const pg = gd.propertyGroups?.[prop];
    if (pg) {
      let foundOptIdx = 0;
      for (let j = 1; (gd.mods as Record<string, unknown>)[`${prop}:${j}`]; j++) {
        const m = gd.mods[`${prop}:${j}`] as Record<string, unknown>;
        const baseStat = (gd.properties[m.mod1code as string]?.stat1 as string | undefined);
        const key = m.mod1param != null ? `${baseStat}#${m.mod1param}` : baseStat;
        if (baseStat && key != null && (stats as Record<string, unknown>)[key] != null) {
          foundOptIdx = j - 1;
          break;
        }
      }
      propertyIndex[prop] = foundOptIdx;
      uniqueValues[i] = foundOptIdx;
    } else {
      uniqueValues[i] = uniq[`max${i + 1}`] as number;
    }
  }

  return { uniqueValues, propertyIndex };
}

// ─── parseRunewordStats ─────────────────────────────────────────

/**
 * Determine the mod sources and uniqueValues for a runeword item.
 */
export function parseRunewordStats(
  gd: GameData,
  item: ParsedItem,
  socketStats: Record<string, StatValue> | null,
  getStats: StatsGetter,
  presetMods?: string[],
): Record<string, unknown> | null {
  const runeword = gd.runes[item.unique!] as Record<string, unknown> | undefined;
  if (!runeword) return null;

  const mods = itemListMods(gd, item.base, item.quality);

  const allStats: Record<string, StatValue> = { ...socketStats };
  const modStats: Record<string, Record<string, StatValue>> = {};
  for (const type in mods) {
    for (const id of mods[type]) {
      modStats[id] = modsToStats(gd, {}, { [id]: ['{1}', '{2}', '{3}', '{4}'] });
      delete modStats[id].poison_count;
      Object.assign(allStats, modStats[id]);
    }
  }

  // Build runeword mod
  const rwmod: Record<string, unknown> = { group: 'runeword' };
  const rwvals: StatValue[] = [];
  for (let i = 1; i <= 7; ++i) {
    if (runeword[`t1code${i}`]) {
      rwmod[`mod${i}code`] = runeword[`t1code${i}`];
      rwmod[`mod${i}param`] = runeword[`t1param${i}`];
      const min = rwmod[`mod${i}min`] = runeword[`t1min${i}`] as number;
      const max = rwmod[`mod${i}max`] = runeword[`t1max${i}`] as number;
      rwvals.push(min === max || max === 0 ? max : `{${i}}`);
    }
  }
  modStats.runeword = runewordStats(gd, {}, runeword, rwvals, item as { base: string; ilvl?: number });
  Object.assign(allStats, modStats.runeword);

  const stats = getStats(allStats);
  if (!stats) return null;
  if (socketStats && !subtractStats(stats, socketStats)) return null;

  // Temporarily add runeword mod to gd.mods for parseMods
  (gd.mods as Record<string, unknown>).runeword = rwmod;
  const parsed = parseMods(gd, stats, modStats, item.quality, presetMods);
  delete (gd.mods as Record<string, unknown>).runeword;

  if (!parsed) return null;

  const result: Record<string, unknown> = {};
  for (const id in parsed) {
    if ((gd.autoMagic as Record<string, unknown>)[id]) {
      if (!result.auto) result.auto = {};
      (result.auto as Record<string, number[]>)[id] = parsed[id];
    } else if ((gd.qualityItems as Record<string, unknown>)[id]) {
      if (!result.superior) result.superior = {};
      (result.superior as Record<string, number[]>)[id] = parsed[id];
    } else if ((gd.staffMods as Record<string, unknown>)[id]) {
      if (!result.staff) result.staff = {};
      (result.staff as Record<string, number[]>)[id] = parsed[id];
    } else if (id === 'runeword') {
      result.uniqueValues = parsed[id];
    }
  }
  if (!result.uniqueValues) return null;
  return result;
}

// ─── parseModStats ──────────────────────────────────────────────

/**
 * Determine the mod sources for a magic/rare/crafted/superior item.
 */
export function parseModStats(
  gd: GameData,
  item: ParsedItem,
  magic: { prefix?: string; suffix?: string } | null,
  socketStats: Record<string, StatValue> | null,
  levelreq: number | null,
  getStats: StatsGetter,
  presetMods?: string[],
): Record<string, unknown> | null {
  const mods = itemListMods(gd, item.base, item.quality, magic);

  const statsSrc: Record<string, StatValue> = { ...socketStats };
  const modStats: Record<string, Record<string, StatValue>> = {};
  for (const type in mods) {
    for (const id of mods[type]) {
      const mod = gd.mods[id] as Record<string, unknown>;
      if (levelreq != null && !(gd.autoMagic as Record<string, unknown>)[id] &&
        ((mod.classlevelreq as number) || (mod.levelreq as number)) > levelreq) continue;

      modStats[id] = modsToStats(gd, {}, { [id]: ['{1}', '{2}', '{3}', '{4}'] });
      delete modStats[id].poison_count;
      Object.assign(statsSrc, modStats[id]);
    }
  }

  const stats = getStats(statsSrc);
  if (!stats) return null;
  if (socketStats && !subtractStats(stats, socketStats)) return null;

  const parsed = parseMods(gd, stats, modStats, item.quality, presetMods);
  if (!parsed) return null;

  const result: Record<string, unknown> = {};
  for (const id in parsed) {
    if ((gd.magicPrefix as Record<string, unknown>)[id] || (gd.magicSuffix as Record<string, unknown>)[id]) {
      if (!result.mods) result.mods = {};
      (result.mods as Record<string, number[]>)[id] = parsed[id];
    } else if ((gd.autoMagic as Record<string, unknown>)[id]) {
      if (!result.auto) result.auto = {};
      (result.auto as Record<string, number[]>)[id] = parsed[id];
    } else if ((gd.crafted as Record<string, unknown>)[id]) {
      if (!result.crafted) result.crafted = {};
      (result.crafted as Record<string, number[]>)[id] = parsed[id];
    } else if ((gd.qualityItems as Record<string, unknown>)[id]) {
      if (!result.superior) result.superior = {};
      (result.superior as Record<string, number[]>)[id] = parsed[id];
    } else if ((gd.staffMods as Record<string, unknown>)[id]) {
      if (!result.staff) result.staff = {};
      (result.staff as Record<string, number[]>)[id] = parsed[id];
    }
  }
  return result;
}
