/**
 * TypeScript types for the game data tables loaded from data.json / strings.json.
 *
 * These types describe the shape of entries in the ~45 data tables
 * that d2planner produces from Blizzless game files.
 *
 * Note: many fields are optional because the TSV source is sparse.
 */

// ─── Base item entries ──────────────────────────────────────────

/** Common fields shared by armor, weapons, and misc items. */
export interface BaseItemEntry {
  name: string;
  code: string;
  namestr: string;
  invfile: string;
  uniqueinvfile?: string;
  setinvfile?: string;
  type: string;
  spawnable: number;
  version: number;
  level: number;
  levelreq: number;
  cost: number;
  invwidth: number;
  invheight: number;
  hasinv: number;
  gemsockets: number;
  gemapplytype: number;
  bitfield1: number;
  unique: number;
  invtrans: number;
  skipname?: number;
  hd: string;
  nodurability?: number;
  durability?: number;
  stackable?: number;
  minstack?: number;
  maxstack?: number;
  autoprefix?: number;
  quest?: number;
}

export interface ArmorEntry extends BaseItemEntry {
  normcode: string;
  ubercode: string;
  ultracode: string;
  speed: number;
  minac: number;
  maxac: number;
  reqstr: number;
  block: number;
  belt?: number;
  mindam?: number;
  maxdam?: number;
  strbonus?: number;
  gamblecost?: number;
}

export interface WeaponEntry extends BaseItemEntry {
  normcode: string;
  ubercode: string;
  ultracode: string;
  wclass: string;
  '2handedwclass'?: string;
  mindam: number;
  maxdam: number;
  '2handmindam'?: number;
  '2handmaxdam'?: number;
  minmisdam?: number;
  maxmisdam?: number;
  strbonus?: number;
  speed?: number;
  rangeadder?: number;
  reqstr?: number;
  reqdex?: number;
  missiletype?: number;
  '1or2handed'?: number;
  '2handed'?: number;
  gamblecost?: number;
}

export interface MiscEntry extends BaseItemEntry {
  stat1?: string;
  stat2?: string;
  calc1?: number;
  calc2?: number;
  belt?: number;
  useable?: number;
  spelldesc?: string;
  spelldesccalc?: string;
  spelldescstr?: string;
}

/** Unified item entry — union of all three base item categories. */
export type ItemEntry = ArmorEntry | WeaponEntry | MiscEntry;

// ─── itemStatCost ───────────────────────────────────────────────

export interface ItemStatCostEntry {
  id: number;
  stat?: string;
  descstrpos?: string;
  descstrneg?: string;
  descstr2?: string;
  descpriority: number;
  descfunc?: number;
  descval?: number;
  savebits: number;
  saveadd: number;
  saveparambits?: number;
  csvbits?: number;
  add?: number;
  multiply?: number;
  damagerelated?: number;
  op?: number;
  opbase?: string;
  opparam?: number;
  opstat1?: string;
  opstat2?: string;
  opstat3?: string;
  encode?: number;
  [key: string]: unknown;
}

// ─── itemTypes ──────────────────────────────────────────────────

export interface ItemTypeEntry {
  equiv1?: string;
  equiv2?: string;
  bodyloc1?: string;
  bodyloc2?: string;
  body: number;
  throwable: number;
  rare: number;
  normal: number;
  magic?: number;
  beltable: number;
  maxsock1: number;
  maxsock25: number;
  maxsock40: number;
  varinvgfx: number;
  treasureclass: number;
  staffmods?: string;
  class?: string;
  shoots?: string;
  quiver?: string;
  invgfx1?: string;
  invgfx2?: string;
  invgfx3?: string;
  invgfx4?: string;
  invgfx5?: string;
  invgfx6?: string;
  [key: string]: unknown;
}

// ─── Unique items ───────────────────────────────────────────────

export interface UniqueItemEntry {
  index: string;
  code: string;
  invfile?: string;
  invtransform?: number;
  hd: string;
  version: number;
  lvl: number;
  lvlreq: number;
  enabled: number;
  rarity: number;
  costmult?: number;
  costadd?: number;
  carry?: number;
  [key: string]: unknown; // prop1..prop10, par1..par10, min1..min10, max1..max10
}

// ─── Set items ──────────────────────────────────────────────────

export interface SetItemEntry {
  index: string;
  set: string;
  item: string;
  invtransform?: number;
  hd: string;
  lvl: number;
  lvlreq: number;
  costmult?: number;
  costadd?: number;
  rarity?: number;
  addfunc?: number;
  [key: string]: unknown; // prop1..prop8, par1..par7, min1..min8, max1..max8, aprop, etc.
}

// ─── Sets ───────────────────────────────────────────────────────

export interface SetEntry {
  index: string;
  name: string;
  version: number;
  [key: string]: unknown; // pcode, pparam, pmin, pmax, fcode, fparam, fmin, fmax
}

// ─── Runewords ──────────────────────────────────────────────────

export interface RunewordEntry {
  name: string;
  itype1?: string;
  itype2?: string;
  itype3?: string;
  etype1?: string;
  etype2?: string;
  rune1?: string;
  rune2?: string;
  rune3?: string;
  rune4?: string;
  rune5?: string;
  rune6?: string;
  [key: string]: unknown; // t1code1..t1code7, t1param1..t1param7, t1min1..t1min7, t1max1..t1max7
}

// ─── Magic prefix / suffix ──────────────────────────────────────

export interface MagicAffixEntry {
  name: string;
  version: number;
  rare?: number;
  level: number;
  levelreq: number;
  group?: number;
  multiply?: number;
  add?: number;
  frequency?: number;
  classspecific?: string;
  class?: string;
  classlevelreq?: number;
  transformcolor?: number;
  itype1?: string;
  itype2?: string;
  itype3?: string;
  itype4?: string;
  itype5?: string;
  itype6?: string;
  itype7?: string;
  etype1?: string;
  etype2?: string;
  etype3?: string;
  etype4?: string;
  etype5?: string;
  mod1code?: string;
  mod1param?: number;
  mod1min?: number;
  mod1max?: number;
  mod2code?: string;
  mod2param?: number;
  mod2min?: number;
  mod2max?: number;
  mod3code?: string;
  mod3param?: number;
  mod3min?: number;
  mod3max?: number;
  [key: string]: unknown;
}

// ─── Gems ───────────────────────────────────────────────────────

export interface GemEntry {
  transform?: number;
  weaponmod1code?: string;
  weaponmod1param?: number;
  weaponmod1min?: number;
  weaponmod1max?: number;
  weaponmod2code?: string;
  weaponmod2param?: number;
  weaponmod2min?: number;
  weaponmod2max?: number;
  weaponmod3code?: string;
  weaponmod3param?: number;
  weaponmod3min?: number;
  weaponmod3max?: number;
  helmmod1code?: string;
  helmmod1param?: number;
  helmmod1min?: number;
  helmmod1max?: number;
  helmmod2code?: string;
  helmmod2param?: number;
  helmmod2min?: number;
  helmmod2max?: number;
  helmmod3code?: string;
  helmmod3param?: number;
  helmmod3min?: number;
  helmmod3max?: number;
  shieldmod1code?: string;
  shieldmod1param?: number;
  shieldmod1min?: number;
  shieldmod1max?: number;
  shieldmod2code?: string;
  shieldmod2param?: number;
  shieldmod2min?: number;
  shieldmod2max?: number;
  shieldmod3code?: string;
  shieldmod3param?: number;
  shieldmod3min?: number;
  shieldmod3max?: number;
  [key: string]: unknown;
}

// ─── Skills ─────────────────────────────────────────────────────

export interface SkillEntry {
  id: number;
  skill: string;
  skilldesc?: string;
  charclass?: string;
  reqlevel?: number;
  reqskill1?: string;
  reqskill2?: string;
  passive?: number;
  aura?: number;
  [key: string]: unknown; // 80+ fields
}

// ─── Properties ─────────────────────────────────────────────────

export interface PropertyEntry {
  stat1?: string;
  stat2?: string;
  stat3?: string;
  stat4?: string;
  stat5?: string;
  stat6?: string;
  stat7?: string;
  func1?: number;
  func2?: number;
  func3?: number;
  func4?: number;
  func5?: number;
  func6?: number;
  func7?: number;
  set1?: number;
  val1?: number;
  [key: string]: unknown;
}

// ─── States ─────────────────────────────────────────────────────

export interface StateEntry {
  id: number;
  state: string;
  group?: number;
  aura?: number;
  curse?: number;
  restrict?: number;
  [key: string]: unknown;
}

// ─── Monsters ───────────────────────────────────────────────────

export interface MonsterEntry {
  hcidx: number;
  [key: string]: unknown;
}

// ─── Missiles ───────────────────────────────────────────────────

export interface MissileEntry {
  missile: string;
  [key: string]: unknown;
}

// ─── Hirelings ──────────────────────────────────────────────────

export interface HirelingEntry {
  [key: string]: unknown;
}

// ─── Character stats ────────────────────────────────────────────

export interface CharStatEntry {
  str: number;
  dex: number;
  int: number;
  vit: number;
  [key: string]: unknown;
}

// ─── Rare prefix / suffix ───────────────────────────────────────

export interface RareAffixEntry {
  name: string;
  itype1?: string;
  itype2?: string;
  itype3?: string;
  itype4?: string;
  itype5?: string;
  itype6?: string;
  itype7?: string;
  [key: string]: unknown;
}

// ─── Quality items ──────────────────────────────────────────────

export interface QualityItemEntry {
  [key: string]: unknown;
}

// ─── Experience ─────────────────────────────────────────────────

export interface ExperienceEntry {
  [key: string]: unknown;
}

// ─── Belts ──────────────────────────────────────────────────────

export interface BeltEntry {
  [key: string]: unknown;
}

// ─── Info ───────────────────────────────────────────────────────

export interface GridDimensions {
  rows: number;
  columns: number;
}

export interface GameInfo {
  inventory: GridDimensions;
  cube: GridDimensions;
  stash?: GridDimensions;
  options?: {
    etherealBug?: boolean;
    setUpgrade?: boolean;
  };
  legacyFormat?: boolean;
  patch?: boolean;
}

// ─── Raw data.json shape ────────────────────────────────────────

/** The raw structure of data.json before processing. */
export interface RawGameData {
  armor: Record<string, ArmorEntry>;
  weapons: Record<string, WeaponEntry>;
  misc: Record<string, MiscEntry>;
  itemStatCost: Record<string, ItemStatCostEntry>;
  itemTypes: Record<string, ItemTypeEntry>;
  uniqueItems: Record<string, UniqueItemEntry>;
  setItems: Record<string, SetItemEntry>;
  sets: Record<string, SetEntry>;
  runes: Record<string, RunewordEntry>;
  magicPrefix: Record<string, MagicAffixEntry>;
  magicSuffix: Record<string, MagicAffixEntry>;
  autoMagic: Record<string, MagicAffixEntry>;
  crafted: Record<string, MagicAffixEntry>;
  qualityItems: Record<string, QualityItemEntry>;
  gems: Record<string, GemEntry>;
  skills: Record<string, SkillEntry>;
  properties: Record<string, PropertyEntry>;
  states: Record<string, StateEntry>;
  monsters: Record<string, MonsterEntry>;
  monstersEx: Record<string, MonsterEntry>;
  missiles: Record<string, MissileEntry>;
  hireling: Record<string, HirelingEntry>;
  charStats: Record<string, CharStatEntry>;
  rarePrefix: Record<string, RareAffixEntry>;
  rareSuffix: Record<string, RareAffixEntry>;
  experience: Record<string, ExperienceEntry>;
  belts: Record<string, BeltEntry>;
  info: GameInfo;
  strings: Record<string, string>;
  [key: string]: unknown;
}
