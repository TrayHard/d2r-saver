/**
 * Skill ID resolver: looks up a skill display name and returns its numeric ID.
 * Used by parsers that reference skills by name in TSV columns.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_PATH } from './files.js';

/** Cached data to avoid re-reading files on every call. */
let skillsData: Record<string, { skill: string; skilldesc?: string }> | null = null;
let skillDescData: Record<string, { strname?: string }> | null = null;
let stringsMap: Map<string, string> | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const jsonDir = resolve(DATA_PATH, 'json');
  const skillsPath = resolve(jsonDir, 'skills.json');
  const descPath = resolve(jsonDir, 'skillDesc.json');
  const strPath = resolve(jsonDir, 'strings.json');

  // Gracefully handle missing files (first build - skills.json doesn't exist yet)
  if (!existsSync(skillsPath) || !existsSync(descPath) || !existsSync(strPath)) {
    skillsData = {};
    skillDescData = {};
    stringsMap = new Map();
    return;
  }

  const [skillsRaw, descRaw, strRaw] = await Promise.all([
    readFile(skillsPath, 'utf-8'),
    readFile(descPath, 'utf-8'),
    readFile(strPath, 'utf-8'),
  ]);

  skillsData = JSON.parse(skillsRaw) as typeof skillsData;
  skillDescData = JSON.parse(descRaw) as typeof skillDescData;

  // strings.json is an array of [key, value] pairs
  const strArr = JSON.parse(strRaw) as [string, string][];
  stringsMap = new Map(strArr);
}

export async function getSkillId(skillName: string | undefined): Promise<number | undefined> {
  if (!skillName || skillName.trim() === '') return undefined;

  await ensureLoaded();

  const needle = skillName.trim().toLowerCase();

  for (const [skillId, skill] of Object.entries(skillsData!)) {
    const skillDesc = skillDescData![skill.skilldesc ?? ''];
    if (skillDesc?.strname) {
      const skillDisplayName = stringsMap!.get(skillDesc.strname);
      if (skillDisplayName?.toLowerCase() === needle) {
        return parseInt(skillId);
      }
    }

    if (skill.skill?.toLowerCase() === needle) {
      return parseInt(skillId);
    }
  }

  console.warn(`Skill not found: ${skillName}`);
  return undefined;
}

/** Reset cached data (for re-running after skills/skilldesc regeneration). */
export function resetSkillIdCache(): void {
  skillsData = null;
  skillDescData = null;
  stringsMap = null;
  loaded = false;
}
