//! The part of `src/game-data/game-data.ts` the read path and the item names need, flattened into
//! lookup tables at load: stat widths by id, per-base-code facts and per-unique facts.

use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// `presetItemIds` from `src/items/item-types.ts`: items keyed by their base code.
const PRESET_ITEM_IDS: &[&str] = &[
    "aqv", "cqv", "tbk", "ibk", "box", "gps", "ops", "gpm", "opm", "gpl", "opl", "r01", "r02", "r03", "r04", "r05",
    "r06", "r07", "r08", "r09", "r10", "r11", "r12", "r13", "r14", "r15", "r16", "r17", "r18", "r19", "r20", "r21",
    "r22", "r23", "r24", "r25", "r26", "r27", "r28", "r29", "r30", "r31", "r32", "r33", "04r", "14r", "29r", "32r",
    "gcv", "gfv", "gsv", "gzv", "gpv", "gcy", "gfy", "gsy", "gly", "gpy", "gcb", "gfb", "gsb", "glb", "gpb", "gcg",
    "gfg", "gsg", "glg", "gpg", "gcr", "gfr", "gsr", "glr", "gpr", "gcw", "gfw", "gsw", "glw", "gpw", "skc", "skf",
    "sku", "skl", "skz", "vps", "yps", "wms", "tsc", "isc", "key", "hp1", "hp2", "hp3", "hp4", "hp5", "mp1", "mp2",
    "mp3", "mp4", "mp5", "rvs", "rvl", "pk1", "pk2", "pk3", "dhn", "bey", "mbr", "toa", "tes", "ceh", "bet", "fed",
    "xa1", "xa2", "xa3", "xa4", "xa5", "ua1", "ua2", "ua3", "ua4", "ua5", "cr1", "cr2", "cr3", "jwd",
];

/// `followStats` from `src/formats/item-parser.ts`.
const FOLLOW_STATS: &[(&str, u32)] = &[
    ("item_maxdamage_percent", 1),
    ("firemindam", 1),
    ("lightmindam", 1),
    ("magicmindam", 1),
    ("coldmindam", 2),
    ("poisonmindam", 2),
];

/// `itemTypeTreeFilter`: base types the parser registers by numeric id.
const TRADEABLE_TYPES: &[&str] = &[
    "helm", "tors", "glov", "boot", "belt", "shld", "amul", "ring", "jewl", "char", "mele", "miss", "orb", "comb",
];

/// `INDEXED_BASE_TYPES` from `items.mjs`: base items the index names besides uniques, sets and runewords.
const INDEXED_BASE_TYPES: &[&str] = &["rune", "ques", "misc", "GBAG"];

pub(crate) const TYPE_CHAR: u8 = 1;
pub(crate) const TYPE_BOOK: u8 = 2;
pub(crate) const TYPE_ARMO: u8 = 4;
pub(crate) const TYPE_WEAP: u8 = 8;
/// Blunt weapons: the parser adds 50 to their `item_undeaddamage_percent`.
pub(crate) const TYPE_BLUN: u8 = 16;
/// Vendor goods (tomes, keys, arrows, bolts): their copies raise no duplicate alert.
pub(crate) const TYPE_VENDOR: u8 = 32;
/// Gems of every grade: counted like runes by the rollback gate.
pub(crate) const TYPE_GEM: u8 = 64;

/// How `addStat` keys and accumulates a stat.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) enum StatKind {
    /// Summed under its own name.
    #[default]
    Plain,
    /// `item_skillon*`: `name#skill#level`, the value is the chance.
    SkillOn,
    /// `item_charged_skill`: `name#skill#level`, the value is the charges.
    Charged,
    /// Keyed `name#param`.
    Param,
    /// `item_addskill_tab`: `name#class*3+tab`.
    SkillTab,
    /// `item_min/maxdamage_percent`: the highest value wins, never below 0.
    Highest,
}

const PARAM_STATS: &[(&str, StatKind)] = &[
    ("item_skillonattack", StatKind::SkillOn),
    ("item_skillonkill", StatKind::SkillOn),
    ("item_skillondeath", StatKind::SkillOn),
    ("item_skillonhit", StatKind::SkillOn),
    ("item_skillonlevelup", StatKind::SkillOn),
    ("item_skillongethit", StatKind::SkillOn),
    ("item_charged_skill", StatKind::Charged),
    ("item_addclassskills", StatKind::Param),
    ("item_nonclassskill", StatKind::Param),
    ("state", StatKind::Param),
    ("item_singleskill", StatKind::Param),
    ("item_elemskill", StatKind::Param),
    ("item_aura", StatKind::Param),
    ("item_reanimate", StatKind::Param),
    ("item_addskill_tab", StatKind::SkillTab),
    ("item_mindamage_percent", StatKind::Highest),
    ("item_maxdamage_percent", StatKind::Highest),
];

/// Stats the parser consolidates by name after reading all lists: (min or max damage, secondary, throw).
const DAMAGE_STATS: [[&str; 3]; 2] = [
    ["mindamage", "secondary_mindamage", "item_throw_mindamage"],
    ["maxdamage", "secondary_maxdamage", "item_throw_maxdamage"],
];

/// `GameData.classes.length` when the data does not list the classes.
const DEFAULT_CLASSES: u32 = 8;

/// Index into `bases` for a code the game data does not know.
pub(crate) const NO_BASE: u16 = u16::MAX;

/// Unique keys: `set###`, `unique###`, `runeword###` → `kind * 4096 + number`.
pub(crate) const UNIQUE_SET: u16 = 0;
pub(crate) const UNIQUE_UNIQUE: u16 = 4096;
pub(crate) const UNIQUE_RUNEWORD: u16 = 8192;

#[derive(Clone, Copy, Default)]
pub(crate) struct StatInfo {
    pub param_bits: u32,
    pub save_bits: u32,
    pub save_add: i64,
    pub csv_bits: u32,
    /// `Number.isInteger(csvbits)`: the character reader certifies only integer widths.
    pub csv_int: bool,
    pub follow: u32,
    /// The stat is `Add_one`, the "Items inside" count of a bag.
    pub add_one: bool,
    pub kind: StatKind,
    /// Its `itemStatCost` key, as an index into `names`.
    pub name: u32,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct BaseInfo {
    /// `itemGetTypes` reduced to the types the parser asks about.
    pub types: u8,
    /// Present in `gd.items` (armor, misc, weapons).
    pub known: bool,
    pub preset: bool,
    /// `itemTypeTreeFilter(base.type)`.
    pub tradeable: bool,
    /// `base.quest && base.questdiffcheck`.
    pub quest_difficulty: bool,
    pub stackable: bool,
    /// English name when the type is indexed, as an index into `names`.
    pub name: Option<u32>,
    /// The type is one of `INDEXED_BASE_TYPES`.
    pub indexed: bool,
    /// English name of any base, `text(namestr) || name`, as an index into `names`.
    pub display_name: Option<u32>,
    /// `minac` / `maxac`, 0 when the base has none.
    pub min_ac: i64,
    pub max_ac: i64,
    /// `normcode`, else the code itself: one family for the normal, exceptional and elite tier.
    pub family: [u8; 3],
    /// `invwidth || 1`, `invheight || 1`: the cells of an extended stash page's misc grid.
    pub inv_width: u32,
    pub inv_height: u32,
    /// The extended page an item of this base goes to: its `type` is a gem, a rune, or neither.
    pub page: Page,
}

/// The virtual page of an extended stash sector (`readD2I`).
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) enum Page {
    Gem,
    Rune,
    #[default]
    Misc,
}

/// What the bind-demon descriptor of a warlock looks up: `superUniques`, `uniqueMods`, `monsters`.
#[derive(Default)]
pub(crate) struct BindTables {
    /// Super unique id → (`class`, the `uniqueMods` keys of `mod1`..`mod3`).
    pub super_uniques: HashMap<String, (Option<String>, [Option<String>; 3])>,
    /// `uniqueMods` key → its `uniquemod`, when truthy.
    pub unique_mods: HashMap<String, String>,
    /// `monsters` in key order with their `hcidx`.
    pub monsters: Vec<(String, Option<f64>)>,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct UniqueInfo {
    /// Present in `uniqueItems`, `setItems` or `runes`; unknown ones are dropped by the parser.
    pub known: bool,
    pub name: Option<u32>,
}

pub struct GameData {
    pub(crate) stats: Vec<Option<StatInfo>>,
    pub(crate) quest_difficulty_bits: u32,
    pub(crate) quest_difficulty_add: i64,
    /// `rarePrefix[v - 156]` and `rareSuffix[v - 1]` of each stored 8-bit value, localized, `''`
    /// for a row the table lacks.
    pub(crate) rare_prefix: Vec<String>,
    pub(crate) rare_suffix: Vec<String>,
    /// `GameData.classes.length`.
    pub(crate) class_count: u32,
    pub(crate) bind: BindTables,
    code_index: Vec<u16>,
    pub(crate) bases: Vec<BaseInfo>,
    pub(crate) uniques: Vec<UniqueInfo>,
    pub(crate) names: Vec<String>,
    pub(crate) stash_columns: u32,
    /// Stat ids of `DAMAGE_STATS`.
    pub(crate) damage_stats: [[u16; 3]; 2],
    /// Stat id of `item_undeaddamage_percent`.
    pub(crate) undead_damage: u16,
}

/// Position of a code character in the 37-symbol alphabet, `None` for the dead Huffman branch.
fn symbol(c: u8) -> Option<usize> {
    match c {
        b'a'..=b'z' => Some((c - b'a') as usize),
        b'0'..=b'9' => Some((c - b'0') as usize + 26),
        b' ' => Some(36),
        _ => None,
    }
}

fn code_slot(code: [u8; 3]) -> Option<usize> {
    Some(symbol(code[0])? * 37 * 37 + symbol(code[1])? * 37 + symbol(code[2])?)
}

type Equivs<'a> = HashMap<&'a str, [Option<&'a str>; 2]>;

/// `isSubType`: `t` is `what` or reaches it through equiv1/equiv2.
fn is_sub_type(equivs: &Equivs, t: &str, what: &str) -> bool {
    t == what
        || equivs
            .get(t)
            .is_some_and(|e| e.iter().flatten().any(|p| is_sub_type(equivs, p, what)))
}

/// `extendType`: adds `t` and its parents; a type missing from the table adds nothing.
fn extend_type(equivs: &Equivs, types: &mut HashSet<String>, t: &str) {
    if types.contains(t) {
        return;
    }
    let Some(e) = equivs.get(t) else { return };
    types.insert(t.to_string());
    for p in e.iter().flatten() {
        extend_type(equivs, types, p);
    }
}

/// JavaScript truthiness of a JSON value (`undefined` is `None`).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn num(v: Option<&Value>) -> i64 {
    v.and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
        .unwrap_or(0)
}

fn non_empty_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn table<'a>(raw: &'a Value, name: &str) -> Result<&'a Map<String, Value>, String> {
    raw.get(name)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("data.json has no `{name}` table"))
}

impl GameData {
    /// Builds the tables from the texts of `data/data.json` and `data/strings.json`.
    pub fn from_json(data_json: &str, strings_json: &str) -> Result<GameData, String> {
        let raw: Value = serde_json::from_str(data_json).map_err(|e| format!("data.json: {e}"))?;
        let locale: Value = serde_json::from_str(strings_json).map_err(|e| format!("strings.json: {e}"))?;

        // gd.locale.strings: later entries win; `text(key)` treats an empty string as missing.
        let mut strings: HashMap<&str, &str> = HashMap::new();
        for entry in locale
            .as_array()
            .ok_or("strings.json is not an array")?
            .iter()
            .flat_map(Value::as_array)
        {
            if let (Some(k), Some(v)) = (
                entry.first().and_then(Value::as_str),
                entry.get(1).and_then(Value::as_str),
            ) {
                strings.insert(k, v);
            }
        }
        let text = |key: &str| strings.get(key).copied().filter(|s| !s.is_empty());

        let mut names: Vec<String> = Vec::new();
        let mut name_ids: HashMap<String, u32> = HashMap::new();
        let mut intern = |name: &str| -> u32 {
            *name_ids.entry(name.to_string()).or_insert_with(|| {
                names.push(name.to_string());
                (names.len() - 1) as u32
            })
        };

        // Stats by id.
        let isc = table(&raw, "itemStatCost")?;
        let mut stats: Vec<Option<StatInfo>> = vec![None; 1024];
        for (name, entry) in isc {
            let id = num(entry.get("id")) as usize;
            if id >= stats.len() {
                continue; // unreachable through a 9-bit id
            }
            stats[id] = Some(StatInfo {
                param_bits: if truthy(entry.get("saveparambits")) {
                    num(entry.get("saveparambits")) as u32
                } else {
                    0
                },
                save_bits: num(entry.get("savebits")) as u32,
                save_add: num(entry.get("saveadd")),
                csv_bits: num(entry.get("csvbits")) as u32,
                csv_int: entry
                    .get("csvbits")
                    .and_then(Value::as_f64)
                    .is_some_and(|f| f.fract() == 0.0),
                follow: FOLLOW_STATS.iter().find(|f| f.0 == name).map_or(0, |f| f.1),
                add_one: name == "Add_one",
                kind: PARAM_STATS
                    .iter()
                    .find(|k| k.0 == name)
                    .map_or(StatKind::Plain, |k| k.1),
                name: intern(name),
            });
        }
        let stat_id = |name: &str| -> Result<u16, String> {
            isc.get(name)
                .map(|s| num(s.get("id")) as u16)
                .ok_or_else(|| format!("itemStatCost has no `{name}`"))
        };
        let mut damage_stats = [[0u16; 3]; 2];
        for (ids, names) in damage_stats.iter_mut().zip(DAMAGE_STATS) {
            for (id, name) in ids.iter_mut().zip(names) {
                *id = stat_id(name)?;
            }
        }
        let undead_damage = stat_id("item_undeaddamage_percent")?;
        // BitReader::bits stops at 32 bits; the JS reader would wrap wider fields.
        if stats
            .iter()
            .flatten()
            .any(|s| s.param_bits.max(s.save_bits).max(s.csv_bits) > 32)
        {
            return Err("itemStatCost has a field wider than 32 bits".into());
        }
        let quest_difficulty_bits = isc
            .get("questitemdifficulty")
            .map_or(0, |s| num(s.get("savebits")) as u32);
        let quest_difficulty_add = isc.get("questitemdifficulty").map_or(0, |s| num(s.get("saveadd")));

        // Item type tree: type -> [equiv1, equiv2].
        let equivs: Equivs = table(&raw, "itemTypes")?
            .iter()
            .map(|(t, info)| {
                (
                    t.as_str(),
                    [non_empty_str(info.get("equiv1")), non_empty_str(info.get("equiv2"))],
                )
            })
            .collect();

        // gd.items = { ...armor, ...misc, ...weapons }, or the merged table itself.
        let mut items: Vec<(&str, &Value)> = Vec::new();
        if let Some(merged) = raw.get("items").and_then(Value::as_object) {
            items.extend(merged.iter().map(|(code, entry)| (code.as_str(), entry)));
        } else {
            for name in ["armor", "misc", "weapons"] {
                for (code, entry) in table(&raw, name)? {
                    items.retain(|(c, _)| c != code);
                    items.push((code, entry));
                }
            }
        }

        let mut code_index = vec![NO_BASE; 37 * 37 * 37];
        let mut bases: Vec<BaseInfo> = Vec::new();
        let mut slot_of = |code: &str, bases: &mut Vec<BaseInfo>| -> Option<usize> {
            let bytes: [u8; 3] = code.as_bytes().try_into().ok()?;
            let slot = code_slot(bytes)?;
            if code_index[slot] == NO_BASE {
                code_index[slot] = bases.len() as u16;
                bases.push(BaseInfo::default());
            }
            Some(code_index[slot] as usize)
        };
        for (code, entry) in &items {
            let Some(i) = slot_of(code, &mut bases) else { continue };
            let mut types = HashSet::new();
            for key in ["type", "type2"] {
                if let Some(t) = non_empty_str(entry.get(key)) {
                    extend_type(&equivs, &mut types, t);
                }
            }
            let ty = entry.get("type").and_then(Value::as_str);
            let flags = [
                ("char", TYPE_CHAR),
                ("book", TYPE_BOOK),
                ("armo", TYPE_ARMO),
                ("weap", TYPE_WEAP),
                ("blun", TYPE_BLUN),
                ("book", TYPE_VENDOR),
                ("key", TYPE_VENDOR),
                ("bowq", TYPE_VENDOR),
                ("xboq", TYPE_VENDOR),
                ("gem", TYPE_GEM),
            ];
            // text(base.namestr) || base.name || null; a missing namestr looks up "undefined".
            let namestr = entry.get("namestr").and_then(Value::as_str).unwrap_or("undefined");
            let display_name = text(namestr).or_else(|| non_empty_str(entry.get("name")));
            let indexed = ty.is_some_and(|t| INDEXED_BASE_TYPES.contains(&t));
            let name = display_name.filter(|_| indexed);
            bases[i] = BaseInfo {
                indexed,
                display_name: display_name.map(&mut intern),
                min_ac: num(entry.get("minac")),
                max_ac: num(entry.get("maxac")),
                family: non_empty_str(entry.get("normcode"))
                    .and_then(|n| n.as_bytes().try_into().ok())
                    .unwrap_or(code.as_bytes().try_into().expect("slot_of took a three-byte code")),
                types: flags.iter().filter(|f| types.contains(f.0)).fold(0, |acc, f| acc | f.1),
                known: true,
                preset: false,
                tradeable: ty.is_some_and(|t| TRADEABLE_TYPES.iter().any(|w| is_sub_type(&equivs, t, w))),
                quest_difficulty: truthy(entry.get("quest")) && truthy(entry.get("questdiffcheck")),
                stackable: truthy(entry.get("stackable")),
                name: name.map(&mut intern),
                inv_width: Some(num(entry.get("invwidth")) as u32).filter(|&w| w != 0).unwrap_or(1),
                inv_height: Some(num(entry.get("invheight")) as u32)
                    .filter(|&h| h != 0)
                    .unwrap_or(1),
                page: match ty.filter(|t| !t.is_empty()) {
                    Some(t) if is_sub_type(&equivs, t, "gem") => Page::Gem,
                    Some(t) if is_sub_type(&equivs, t, "rune") => Page::Rune,
                    _ => Page::Misc,
                },
            };
        }
        for code in PRESET_ITEM_IDS {
            if let Some(i) = slot_of(code, &mut bases) {
                bases[i].preset = true;
            }
        }

        // Uniques, sets and runewords by the key the parser builds (`mkid` pads to three digits).
        let unique_items = table(&raw, "uniqueItems")?;
        let set_items = table(&raw, "setItems")?;
        let runes = table(&raw, "runes")?;
        let mut uniques = vec![UniqueInfo::default(); 3 * 4096];
        for (kind, prefix) in [
            (UNIQUE_SET, "set"),
            (UNIQUE_UNIQUE, "unique"),
            (UNIQUE_RUNEWORD, "runeword"),
        ] {
            for n in 0..4096u16 {
                let key = format!("{prefix}{n:03}");
                let known = [unique_items, set_items, runes].iter().any(|t| truthy(t.get(&key)));
                let name = if kind == UNIQUE_RUNEWORD {
                    non_empty_str(runes.get(&key).and_then(|e| e.get("name")))
                } else {
                    let t = if kind == UNIQUE_SET { set_items } else { unique_items };
                    // entry.index ? text(entry.index) || entry.index : null
                    non_empty_str(t.get(&key).and_then(|e| e.get("index"))).map(|i| text(i).unwrap_or(i))
                };
                uniques[(kind + n) as usize] = UniqueInfo {
                    known,
                    name: name.map(&mut intern),
                };
            }
        }

        let stash_columns = raw
            .get("info")
            .and_then(|i| i.get("stash"))
            .and_then(|s| s.get("columns"))
            .filter(|c| truthy(Some(c)))
            .map_or(16, |c| num(Some(c)) as u32);

        // item.name of a rare: `${text(name1) || name1 || ''} ${…}`.trim(), name1 = rarePrefix[v - 156]?.name.
        let rare_text = |table: Option<&Value>, offset: i64| -> Vec<String> {
            (0..256i64)
                .map(|v| {
                    let index = v - offset;
                    let row = match table {
                        Some(Value::Array(rows)) => usize::try_from(index).ok().and_then(|i| rows.get(i)),
                        Some(Value::Object(rows)) => rows.get(&index.to_string()),
                        _ => None,
                    };
                    let name = row.and_then(|r| r.get("name")).and_then(Value::as_str);
                    // strings[undefined] looks up the key "undefined".
                    text(name.unwrap_or("undefined"))
                        .or(name.filter(|n| !n.is_empty()))
                        .unwrap_or("")
                        .to_string()
                })
                .collect()
        };
        let rare_prefix = rare_text(raw.get("rarePrefix"), 156);
        let rare_suffix = rare_text(raw.get("rareSuffix"), 1);

        // A JS property key from a JSON value: `uniqueMods[su.mod1 ?? '']`.
        let js_key = |v: Option<&Value>| match v {
            None | Some(Value::Null) => Some(String::new()),
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.as_i64().map_or_else(|| n.to_string(), |i| i.to_string())),
            Some(_) => None,
        };
        let objects = |name: &str| raw.get(name).and_then(Value::as_object).into_iter().flatten();
        let bind = BindTables {
            super_uniques: objects("superUniques")
                .map(|(k, su)| {
                    let class = su.get("class").and_then(Value::as_str).map(str::to_string);
                    (k.clone(), (class, ["mod1", "mod2", "mod3"].map(|m| js_key(su.get(m)))))
                })
                .collect(),
            unique_mods: objects("uniqueMods")
                .filter_map(|(k, m)| {
                    let um = non_empty_str(m.get("uniquemod"))?;
                    Some((k.clone(), um.to_string()))
                })
                .collect(),
            monsters: objects("monsters")
                .map(|(k, m)| (k.clone(), m.get("hcidx").and_then(Value::as_f64)))
                .collect(),
        };
        let class_count = raw
            .get("classes")
            .and_then(Value::as_array)
            .map_or(DEFAULT_CLASSES, |c| c.len() as u32);

        Ok(GameData {
            stats,
            quest_difficulty_bits,
            quest_difficulty_add,
            rare_prefix,
            rare_suffix,
            class_count,
            bind,
            code_index,
            bases,
            uniques,
            names,
            stash_columns,
            damage_stats,
            undead_damage,
        })
    }

    /// Base index of a decoded item code, `NO_BASE` when the data does not know it.
    #[inline]
    pub(crate) fn base_of(&self, code: [u8; 3]) -> u16 {
        code_slot(code).map_or(NO_BASE, |slot| self.code_index[slot])
    }

    #[inline]
    pub(crate) fn base(&self, index: u16) -> BaseInfo {
        self.bases.get(index as usize).copied().unwrap_or_default()
    }

    #[inline]
    pub(crate) fn stat(&self, id: u32) -> Option<&StatInfo> {
        self.stats.get(id as usize).and_then(Option::as_ref)
    }

    /// English name of a `SimpleCounts` key: the base name of `<code>`, the unique, set or runeword name of
    /// `<code>:<unique key>`; `None` when the data knows neither.
    pub fn count_name(&self, key: &str) -> Option<&str> {
        let (code, unique) = key.split_once(':').map_or((key, None), |(c, u)| (c, Some(u)));
        let named = unique.and_then(|u| {
            let (kind, number) = [
                ("set", UNIQUE_SET),
                ("unique", UNIQUE_UNIQUE),
                ("runeword", UNIQUE_RUNEWORD),
            ]
            .iter()
            .find_map(|(prefix, kind)| u.strip_prefix(prefix).map(|n| (*kind, n)))?;
            let index = kind as usize + number.parse::<usize>().ok().filter(|n| *n < 4096)?;
            self.uniques[index].name
        });
        let code: [u8; 3] = code.as_bytes().try_into().ok()?;
        named
            .or_else(|| self.base(self.base_of(code)).display_name)
            .map(|id| self.name(id))
    }

    pub(crate) fn name(&self, id: u32) -> &str {
        &self.names[id as usize]
    }

    /// The `itemStatCost` key of a stat id the parser read (or looked up at load).
    pub(crate) fn stat_name(&self, id: u16) -> &str {
        self.name(self.stats[id as usize].expect("stat id from the data").name)
    }
}

#[cfg(feature = "embedded-data")]
impl GameData {
    /// The game data of this d2r-saver checkout (`data/`), compiled into the binary.
    pub fn embedded() -> Result<GameData, String> {
        Self::from_json(
            include_str!("../../../data/data.json"),
            include_str!("../../../data/strings.json"),
        )
    }
}
