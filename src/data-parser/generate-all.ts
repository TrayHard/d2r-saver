/**
 * Orchestrator: runs all individual table parsers in the correct order.
 *
 * Order matters:
 *  1. skills + skillDesc must run BEFORE parsers that use getSkillId
 *     (uniqueItems, setItems, runes, skills itself resolves internally).
 *  2. Everything else is independent.
 */

import { resetHdCache } from './get-hd.js';
import { resetSkillIdCache } from './get-skill-id.js';

// Phase-1 parsers (no dependencies on getSkillId)
import { skillsToJson } from './parsers/skills.js';
import { skillDescToJson } from './parsers/skill-desc.js';

// Phase-2 parsers (may depend on getSkillId, getHD, or are independent)
import { armorsToJson } from './parsers/armor.js';
import { weaponsToJson } from './parsers/weapons.js';
import { miscToJson } from './parsers/misc.js';
import { itemStatCostToJson } from './parsers/item-stat-cost.js';
import { itemTypeToJson } from './parsers/item-types.js';
import { uniqueItemsToJson } from './parsers/unique-items.js';
import { setItemsToJson } from './parsers/set-items.js';
import { setsToJson } from './parsers/sets.js';
import { runesToJson } from './parsers/runes.js';
import { magicPrefixToJson } from './parsers/magic-prefix.js';
import { magicSuffixToJson } from './parsers/magic-suffix.js';
import { gemsToJson } from './parsers/gems.js';
import { propertiesToJson } from './parsers/properties.js';
import { charStatsToJson } from './parsers/char-stats.js';
import { statesToJson } from './parsers/states.js';
import { monstersToJson } from './parsers/monsters.js';
import { monstersExToJson } from './parsers/monsters-ex.js';
import { missilesToJson } from './parsers/missiles.js';
import { hirelingToJson } from './parsers/hireling.js';
import { rarePrefixToJson } from './parsers/rare-prefix.js';
import { rareSuffixToJson } from './parsers/rare-suffix.js';
import { experienceToJson } from './parsers/experience.js';
import { beltsToJson } from './parsers/belts.js';
import { autoMagicToJson } from './parsers/auto-magic.js';
import { qualityItemsToJson } from './parsers/quality-items.js';
import { monLvlToJson } from './parsers/mon-lvl.js';
import { levelsToJson } from './parsers/levels.js';
import { monTypeToJson } from './parsers/mon-type.js';
import { monPropToJson } from './parsers/mon-prop.js';
import { superUniquesToJson } from './parsers/super-uniques.js';
import { monEquipToJson } from './parsers/mon-equip.js';
import { difficultyToJson } from './parsers/difficulty.js';
import { itemRatioToJson } from './parsers/item-ratio.js';
import { treasureClassToJson } from './parsers/treasure-class.js';

export async function generateAll(): Promise<void> {
  // Reset caches from any previous run
  resetHdCache();
  resetSkillIdCache();

  // Phase 1: skills + skillDesc first (generates the JSONs that getSkillId reads)
  console.log('  [1/4] skills, skillDesc (bootstrap pass) ...');
  await skillsToJson();
  await skillDescToJson();

  // Phase 2: reset getSkillId cache so it picks up the freshly written JSONs
  resetSkillIdCache();

  // Phase 3: re-run skills with proper getSkillId resolution + item tables
  console.log('  [2/4] skills (resolve pass) ...');
  await skillsToJson();

  console.log('  [3/4] item tables ...');
  await armorsToJson();
  await weaponsToJson();
  await miscToJson();
  await itemStatCostToJson();
  await itemTypeToJson();
  await uniqueItemsToJson();
  await setItemsToJson();
  await setsToJson();
  await runesToJson();
  await magicPrefixToJson();
  await magicSuffixToJson();
  await gemsToJson();
  await propertiesToJson();

  console.log('  [4/4] world tables ...');
  await charStatsToJson();
  await statesToJson();
  await monstersToJson();
  await monstersExToJson();
  await missilesToJson();
  await hirelingToJson();
  await rarePrefixToJson();
  await rareSuffixToJson();
  await experienceToJson();
  await beltsToJson();
  await autoMagicToJson();
  await qualityItemsToJson();
  await monLvlToJson();
  await levelsToJson();
  await monTypeToJson();
  await monPropToJson();
  await superUniquesToJson();
  await monEquipToJson();
  await difficultyToJson();
  await itemRatioToJson();
  await treasureClassToJson();
}
