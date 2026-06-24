/**
 * Item stat computation — computing stats from mods, properties, gems, etc.
 *
 * Ported from d2planner/src/logic/item.js.
 * Provides: addProp, modsToStats, uniqueStats, runewordStats, gemStats, formatStr, addValues.
 *
 * Uses GameData instead of global Data singleton.
 */

import type { GameData } from '../game-data/game-data.js';
import { isSubType, itemMaxSockets } from './item-types.js';

// ─── Value helpers ──────────────────────────────────────────────

/** A stat value that can be a number or a {min,max} range (for variable mods). */
export type StatValue = number | string | { min: number; max: number };

/**
 * Format a localized string template with positional %d/%s/%i/%N replacements.
 */
export function formatStr(fmt: string | undefined, ...values: unknown[]): string {
  if (fmt == null) return '';
  let i = 0;
  return fmt.replace(/%(\+)?([ids%\d])/g, (_m, plus: string | undefined, chr: string) => {
    if (chr === '%') return chr;
    let value: unknown = (chr === 'd' || chr === 's' || chr === 'i')
      ? values[i++]
      : values[parseInt(chr)];
    if (plus && !isNaN(value as number) && parseInt(value as string) > 0) {
      value = '+' + value;
    }
    return String(value);
  });
}

/**
 * Add two stat values (numbers or ranges), returning the sum.
 */
export function addValues(dst: StatValue | undefined, src: StatValue | undefined): StatValue | undefined {
  const dobj = dst != null && typeof dst === 'object';
  const sobj = src != null && typeof src === 'object';
  if (dobj || sobj) {
    if (dst == null) return src != null ? { ...(src as { min: number; max: number }) } : undefined;
    if (src == null) return dst;
    const d = dobj ? (dst as { min: number; max: number }) : { min: dst as number, max: dst as number };
    if (sobj) {
      const s = src as { min: number; max: number };
      d.min += s.min;
      d.max += s.max;
    } else {
      d.min += src as number;
      d.max += src as number;
    }
    return d;
  } else if (dst != null) {
    return (dst as number) + ((src as number) || 0);
  } else {
    return src;
  }
}

// ─── addProp ────────────────────────────────────────────────────

/**
 * Apply a property (from Properties.txt) to the stats object.
 * Ported from d2planner addProp().
 */
export function addProp(
  gd: GameData,
  stats: Record<string, StatValue>,
  id: string,
  param: unknown,
  min: number,
  max: number,
  value: StatValue,
  item?: { ilvl?: number; base?: string; propertyIndex?: Record<string, number> },
): void {
  // propertyGroups: id refers to a group (e.g. "skilltab-war"). Expand it to
  // the concrete picked option from `item.propertyIndex` (parser-recovered)
  // or default to option 1, then recurse with the resolved mod's mod1code.
  const pg = id && gd.propertyGroups?.[id];
  if (pg) {
    // Value-based pg pick template (e.g. "{0}" or "{1}") — preserve as marker.
    if (typeof value === 'string' && /{(\d+)}/.test(value as string)) {
      const m = (value as string).match(/{(\d+)}/)!;
      stats[`pgpick#${m[1]}`] = 1;
      return;
    }
    const optIdx = item?.propertyIndex?.[id] ?? (typeof value === 'number' ? Math.round(value) : 0);
    const mod = (gd.mods as Record<string, unknown>)[`${id}:${optIdx + 1}`] as Record<string, unknown> | undefined;
    if (mod) {
      const statValue: StatValue =
        item?.propertyIndex != null && typeof value === 'number'
          ? value
          : (mod.mod1max as number);
      addProp(
        gd,
        stats,
        mod.mod1code as string,
        mod.mod1param,
        mod.mod1min as number,
        mod.mod1max as number,
        statValue,
        item,
      );
    }
    return;
  }

  const prop = gd.properties[id];
  if (!prop) return;

  const ilvl = item?.ilvl ?? 99;
  const base = item?.base;
  let last: StatValue = 0;

  function addStat(stat: string, p: unknown, v: StatValue): void {
    last = v;
    if (p != null) stat = `${stat}#${p}`;
    if (stat === 'item_numsockets' && !isNaN(v as number) && item && base) {
      const baseItem = gd.items[base];
      if (baseItem) {
        v = Math.min(v as number, itemMaxSockets(gd, baseItem as unknown as Record<string, unknown>));
      }
    }
    stats[stat] = addValues(stats[stat], v)!;
    if (stat === 'poisonlength') {
      stats.poison_count = ((stats.poison_count as number) || 0) + 1;
    }
  }

  function statFunc(set: unknown, val: unknown, func: number, stat: string): void {
    switch (func) {
      case 3:
        addStat(stat, null, last);
        break;
      case 5:
        addStat('mindamage', null, value);
        break;
      case 6:
        addStat('maxdamage', null, value);
        break;
      case 7:
        if (!isNaN(value as number)) {
          const baseItem = base ? gd.items[base] : undefined;
          if (baseItem && isSubType(gd, baseItem.type, 'weap') &&
            (((baseItem as unknown as Record<string, unknown>)['2handmaxdam'] as number) || (baseItem as unknown as Record<string, unknown>).maxdam as number || 0) * (value as number) < 100) {
            addStat('maxdamage', null, 1);
          } else {
            addStat('item_mindamage_percent', null, value);
            addStat('item_maxdamage_percent', null, value);
          }
        } else {
          addStat('item_mindamage_percent', null, value);
          addStat('item_maxdamage_percent', null, value);
        }
        break;
      case 10:
        addStat(stat, param, value);
        break;
      case 11:
        if (max === 0) {
          const skill = gd.skills[param as string];
          const reqlvl = skill?.reqlevel ?? 0;
          const calcMax = Math.round((ilvl - reqlvl + 1) / 3.9);
          addStat(stat, `${param}#${min}#x`, calcMax);
        } else {
          addStat(stat, `${param}#${min}`, max);
        }
        break;
      case 12:
        addStat(stat, `${param}#x`, value);
        break;
      case 14:
        addStat(stat, null, param != null ? param as number : value);
        break;
      case 15:
        addStat(stat, null, min);
        break;
      case 16:
        addStat(stat, null, max);
        break;
      case 17:
        addStat(stat, null, param != null ? param as number : value);
        break;
      case 19:
        if (min < 0 && max < 0 && gd.skills[param as string]) {
          const skill = gd.skills[param as string];
          const reqlvl = skill.reqlevel ?? 0;
          const slvl = Math.max(1, Math.floor((ilvl - reqlvl) / Math.floor((99 - reqlvl) / (-max))));
          const charges = Math.floor(-min * slvl / 8) + (-min);
          addStat(stat, `${param}#${slvl}`, charges);
        } else {
          addStat(stat, `${param}#${max}`, min);
        }
        break;
      case 20:
        stats.item_indesctructible = 1;
        break;
      case 21:
        addStat(stat, val, value);
        break;
      case 22:
      case 24:
        addStat(stat, param, value);
        break;
      case 23:
        stats.item_ethereal = 1;
        break;
      case 36:
        addStat(stat, `${val}#x`, value);
        break;
      default:
        addStat(stat, null, set == null ? value : set as number);
        break;
    }
  }

  const p = prop as Record<string, unknown>;
  if (p.func1) statFunc(p.set1, p.val1, p.func1 as number, p.stat1 as string);
  if (p.func2) statFunc(p.set2, p.val2, p.func2 as number, p.stat2 as string);
  if (p.func3) statFunc(p.set3, p.val3, p.func3 as number, p.stat3 as string);
  if (p.func4) statFunc(p.set4, p.val4, p.func4 as number, p.stat4 as string);
  if (p.func5) statFunc(p.set5, p.val5, p.func5 as number, p.stat5 as string);
  if (p.func6) statFunc(p.set6, p.val6, p.func6 as number, p.stat6 as string);
  if (p.func7) statFunc(p.set7, p.val7, p.func7 as number, p.stat7 as string);
}

// ─── modsToStats ────────────────────────────────────────────────

/**
 * Compute stats from a set of mods (affix id → array of values).
 * Ported from d2planner modsToStats().
 */
export function modsToStats(
  gd: GameData,
  stats: Record<string, StatValue>,
  mods: Record<string, StatValue[]>,
  item?: { ilvl?: number; base?: string },
): Record<string, StatValue> {
  function addMod(mod: string, values: StatValue[]): void {
    const affix = gd.mods[mod];
    if (!affix) return;
    const a = affix as Record<string, unknown>;
    if (a.mod1code) addProp(gd, stats, a.mod1code as string, a.mod1param, a.mod1min as number, a.mod1max as number, values[0], item);
    if (a.mod2code) addProp(gd, stats, a.mod2code as string, a.mod2param, a.mod2min as number, a.mod2max as number, values[1], item);
    if (a.mod3code) addProp(gd, stats, a.mod3code as string, a.mod3param, a.mod3min as number, a.mod3max as number, values[2], item);
    if (a.mod4code) addProp(gd, stats, a.mod4code as string, a.mod4param, a.mod4min as number, a.mod4max as number, values[3], item);
    if (a.mod5code) addProp(gd, stats, a.mod5code as string, a.mod5param, a.mod5min as number, a.mod5max as number, values[4], item);
  }

  const numpsn = (stats.poison_count as number) || 0;
  for (const mod in mods) {
    addMod(mod, mods[mod]);
  }
  if (stats.poison_count) {
    stats.poison_count = Math.min(stats.poison_count as number, numpsn + 1);
  }

  return stats;
}

// ─── uniqueStats ────────────────────────────────────────────────

/**
 * Compute stats from a unique/set item definition.
 * Ported from d2planner uniqueStats().
 */
export function uniqueStats(
  gd: GameData,
  stats: Record<string, StatValue>,
  uniq: Record<string, unknown>,
  values: StatValue[] | undefined,
  item?: { ilvl?: number; base?: string },
): Record<string, StatValue> {
  for (let i = 1; i <= 12; ++i) {
    if (uniq[`prop${i}`]) {
      const min = uniq[`min${i}`] as number;
      const max = uniq[`max${i}`] as number;
      addProp(
        gd, stats, uniq[`prop${i}`] as string, uniq[`par${i}`],
        min, max,
        values ? values[i - 1] : (min === max ? max : ''),
        item,
      );
    }
  }
  // Set-specific additional properties
  if (!uniq.addfunc && uniq.set) {
    for (let i = 1; i <= 5; ++i) {
      if (uniq[`aprop${i}a`]) {
        addProp(gd, stats, uniq[`aprop${i}a`] as string, uniq[`apar${i}a`],
          uniq[`amin${i}a`] as number, uniq[`amax${i}a`] as number, uniq[`amax${i}a`] as number, item);
      }
      if (uniq[`aprop${i}b`]) {
        addProp(gd, stats, uniq[`aprop${i}b`] as string, uniq[`apar${i}b`],
          uniq[`amin${i}b`] as number, uniq[`amax${i}b`] as number, uniq[`amax${i}b`] as number, item);
      }
    }
  }
  return stats;
}

// ─── runewordStats ──────────────────────────────────────────────

/**
 * Compute stats from a runeword definition.
 * Ported from d2planner runewordStats().
 */
export function runewordStats(
  gd: GameData,
  stats: Record<string, StatValue>,
  uniq: Record<string, unknown>,
  values: StatValue[] | undefined,
  item?: { ilvl?: number; base?: string },
): Record<string, StatValue> {
  for (let i = 1; i <= 7; ++i) {
    if (uniq[`t1code${i}`] && uniq[`t1code${i}`] !== 'ethereal') {
      const min = uniq[`t1min${i}`] as number;
      const max = uniq[`t1max${i}`] as number;
      const param = uniq[`t1param${i}`];
      const v = values ? values[i - 1] : (min === max ? max : '');
      addProp(gd, stats, uniq[`t1code${i}`] as string, param, min, max, v, item);
    }
  }
  return stats;
}

// ─── gemStats ───────────────────────────────────────────────────

/**
 * Apply gem/rune/jewel stats to the stat object based on the equipment slot type.
 * Ported from d2planner gemStats().
 */
export function gemStats(
  gd: GameData,
  stats: Record<string, StatValue>,
  code: string,
  types: Set<string>,
): Record<string, StatValue> {
  const gem = gd.gems[code];
  if (!gem) return stats;
  const g = gem as Record<string, unknown>;

  if (types.has('weap')) {
    if (g.weaponmod1code) addProp(gd, stats, g.weaponmod1code as string, g.weaponmod1param, g.weaponmod1min as number, g.weaponmod1max as number, g.weaponmod1max as number);
    if (g.weaponmod2code) addProp(gd, stats, g.weaponmod2code as string, g.weaponmod2param, g.weaponmod2min as number, g.weaponmod2max as number, g.weaponmod2max as number);
    if (g.weaponmod3code) addProp(gd, stats, g.weaponmod3code as string, g.weaponmod3param, g.weaponmod3min as number, g.weaponmod3max as number, g.weaponmod3max as number);
  } else if (types.has('shld')) {
    if (g.shieldmod1code) addProp(gd, stats, g.shieldmod1code as string, g.shieldmod1param, g.shieldmod1min as number, g.shieldmod1max as number, g.shieldmod1max as number);
    if (g.shieldmod2code) addProp(gd, stats, g.shieldmod2code as string, g.shieldmod2param, g.shieldmod2min as number, g.shieldmod2max as number, g.shieldmod2max as number);
    if (g.shieldmod3code) addProp(gd, stats, g.shieldmod3code as string, g.shieldmod3param, g.shieldmod3min as number, g.shieldmod3max as number, g.shieldmod3max as number);
  } else if (types.has('helm') || types.has('tors')) {
    if (g.helmmod1code) {
      const min1 = g.helmmod1min ?? g.helmod1min;
      const max1 = g.helmmod1max ?? g.helmod1max;
      const param1 = g.helmmod1param ?? g.helmod1param;
      addProp(gd, stats, g.helmmod1code as string, param1, min1 as number, max1 as number, max1 as number);
    }
    if (g.helmmod2code) {
      const min2 = g.helmmod2min ?? g.helmod2min;
      const max2 = g.helmmod2max ?? g.helmod2max;
      const param2 = g.helmmod2param ?? g.helmod2param;
      addProp(gd, stats, g.helmmod2code as string, param2, min2 as number, max2 as number, max2 as number);
    }
    if (g.helmmod3code) {
      const min3 = g.helmmod3min ?? g.helmod3min;
      const max3 = g.helmmod3max ?? g.helmod3max;
      const param3 = g.helmmod3param ?? g.helmod3param;
      addProp(gd, stats, g.helmmod3code as string, param3, min3 as number, max3 as number, max3 as number);
    }
  }
  return stats;
}
