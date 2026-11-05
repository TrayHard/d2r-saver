//! Port of `createItemParser` in `src/formats/item-parser.ts` with `resolveMods: false`.
//!
//! The parser reads every field the TypeScript parser reads, in the same order. Counting keeps
//! only base, unique/set/runeword id, quantity and the `Add_one` stat; a parser created with
//! details also keeps what an index row needs of `BinaryParsedItem` (`ItemDetail`).

use crate::bits::BitReader;
use crate::data::{
    GameData, StatInfo, StatKind, TYPE_ARMO, TYPE_BLUN, TYPE_BOOK, TYPE_CHAR, TYPE_WEAP, UNIQUE_RUNEWORD, UNIQUE_SET,
    UNIQUE_UNIQUE,
};
use crate::{Error, Result};
use std::collections::BTreeMap;

/// Stored runeword ids outside the vanilla ranges (`CUSTOM_RUNEWORD_IDS`): Nightfall.
const CUSTOM_RUNEWORD_IDS: &[(u32, u32)] = &[(1396, 325)];

/// `Item::detail` of an item parsed without details.
pub(crate) const NO_DETAIL: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Item {
    /// Base code as read.
    pub code: [u8; 3],
    /// Index into the game data's bases; `NO_BASE` for a code the data does not know.
    pub(crate) base: u16,
    /// `kind * 4096 + id` of `set###`, `unique###` or `runeword###`.
    pub(crate) unique: Option<u16>,
    pub quantity: Option<u32>,
    /// Sum of the `Add_one` stat ("Items inside" of a bag), 0 without it.
    pub add_one: i64,
    /// Index of its `ItemDetail` in the parser's details, `NO_DETAIL` when they are not kept.
    pub(crate) detail: u32,
}

impl Item {
    /// The base code.
    pub fn code(&self) -> String {
        self.code.iter().map(|&c| c as char).collect()
    }

    /// `set###`, `unique###` or `runeword###`, as the TypeScript parser names it.
    pub fn unique_key(&self) -> Option<String> {
        self.unique.map(|u| {
            let prefix = ["set", "unique", "runeword"][(u / 4096) as usize];
            format!("{prefix}{:03}", u % 4096)
        })
    }
}

/// What an index row keeps of an item besides its identity: the `BinaryParsedItem` fields.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ItemDetail {
    /// Neither simple nor an ear: the item has a guid, an item level and stats.
    pub extended: bool,
    pub ethereal: bool,
    /// `item.quality`: 9 for a runeword, `None` for a stored quality the JS map lacks (9..15).
    pub quality: Option<u8>,
    pub runeword: bool,
    pub sockets: u32,
    pub ilvl: Option<u32>,
    pub defense: Option<i64>,
    pub guid: Option<u32>,
    /// `item.stats`: keyed like `addStat`, set and runeword lists merged, damage consolidated.
    pub stats: BTreeMap<String, i64>,
    /// English names of the children `item.socketedItems` lists, in socket order.
    pub socketed: Vec<String>,
}

/// A stat key as `addStat` builds it: the stat name, then `params` of `#a#b`.
#[derive(Clone, Copy, PartialEq, Eq)]
struct StatKey {
    id: u16,
    params: u8,
    a: i64,
    b: i64,
}

impl StatKey {
    fn plain(id: u16) -> Self {
        StatKey {
            id,
            params: 0,
            a: 0,
            b: 0,
        }
    }
}

type Stats = Vec<(StatKey, i64)>;

/// How the parser registers an item in its dictionary (`registeredKey`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Key {
    /// Numeric parse-order id: the dictionary entry is this item.
    Num,
    /// Preset item keyed by base code: the entry is the last item registered with that code.
    Preset(u16),
}

/// A parsed item with what `emitLocation` needs.
pub(crate) struct Parsed {
    pub item: Item,
    pub key: Option<Key>,
    pub location: u32,
    pub bodyloc: u32,
    pub col: u32,
    pub row: u32,
    pub storage: u32,
}

impl Parsed {
    /// `emitLocation` calls its handler, which is what puts a socketed child into `socketedItems`.
    fn emits(&self) -> bool {
        match self.location {
            0 | 4 => matches!(self.storage, 1 | 4 | 5),
            1 => (1..=12).contains(&self.bodyloc),
            2 | 6 => true,
            _ => false,
        }
    }
}

/// What one `JM` list looked like (`ItemListReport`, the fields counting needs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ListReport {
    pub declared: u32,
    pub parsed: u32,
    pub first_item_offset: usize,
    /// Byte after the last item that parsed.
    pub end_offset: usize,
    /// An item failed; the list stops there.
    pub error: bool,
}

pub(crate) struct Parser<'a> {
    pub r: BitReader<'a>,
    gd: &'a GameData,
    legacy: bool,
    /// Preset items in registration order; the dictionary entry of a code is its last one.
    pub presets: Vec<(u16, Item)>,
    /// With details: one per parsed item, children before their parent; `Item::detail` points here.
    pub details: Option<Vec<ItemDetail>>,
}

impl<'a> Parser<'a> {
    pub fn new(buf: &'a [u8], gd: &'a GameData, legacy: bool, details: bool) -> Self {
        Self {
            r: BitReader::new(buf),
            gd,
            legacy,
            presets: Vec::new(),
            details: details.then(Vec::new),
        }
    }

    /// The dictionary entry of a preset code (`items[base]`).
    pub fn preset(&self, base: u16) -> Option<&Item> {
        self.presets
            .iter()
            .rev()
            .find(|(b, _)| *b == base)
            .map(|(_, item)| item)
    }

    /// Stores the details of an item that finished parsing, when they are kept.
    fn keep(&mut self, item: &mut Item, detail: ItemDetail) {
        if let Some(details) = &mut self.details {
            item.detail = details.len() as u32;
            details.push(detail);
        }
    }

    /// One item and its socketed children (`parseItem`).
    pub fn parse_item(&mut self) -> Result<Parsed> {
        let gd = self.gd;
        let legacy = self.legacy;
        let keep = self.details.is_some();
        let r = &mut self.r;

        // Flags (35 bits).
        r.skip_bits(4);
        r.bits(1)?; // identified
        r.skip_bits(6);
        let socketed = r.bits(1)? != 0;
        r.skip_bits(4);
        let ear = r.bits(1)? != 0;
        r.skip_bits(4);
        let simple = r.bits(1)? != 0;
        let ethereal = r.bits(1)? != 0;
        r.skip_bits(1);
        let personalized = r.bits(1)? != 0;
        r.skip_bits(1);
        let runeword = r.bits(1)? != 0;
        r.skip_bits(1);
        let extras = r.bits(1)? != 0;
        let compact_chronicle = r.bits(1)? != 0;
        r.skip_bits(5);

        let location = r.bits(3)?;
        let bodyloc = r.bits(4)?;
        let col = r.bits(4)?;
        let row = r.bits(4)?;
        let storage = r.bits(3)?;
        let at = |item, key| Parsed {
            item,
            key,
            location,
            bodyloc,
            col,
            row,
            storage,
        };
        // Simple items and ears: quality normal, no guid, level or stats.
        let mut detail = ItemDetail {
            ethereal,
            quality: Some(2),
            ..ItemDetail::default()
        };

        if ear {
            r.bits(3)?; // class
            r.bits(7)?; // level
            while r.bits(8)? != 0 {} // name, NUL-terminated
            if r.bits(1)? != 0 {
                r.skip_bits(128);
            }
            if !legacy && r.bits(1)? != 0 {
                r.skip_bits(8);
            }
            r.align();
            let mut item = Item {
                code: *b"ear",
                base: gd.base_of(*b"ear"),
                unique: None,
                quantity: None,
                add_one: 0,
                detail: NO_DETAIL,
            };
            self.keep(&mut item, detail);
            return Ok(at(item, Some(Key::Num)));
        }

        let code = [r.code_char()?, r.code_char()?, r.code_char()?];
        if r.code_char()? != b' ' {
            return Err(Error("invalid item code"));
        }
        let base = gd.base_of(code);
        let info = gd.base(base);
        let mut item = Item {
            code,
            base,
            unique: None,
            quantity: None,
            add_one: 0,
            detail: NO_DETAIL,
        };
        let mut socketed_count = 0;

        if simple {
            if info.quest_difficulty {
                r.bits(gd.quest_difficulty_bits)?;
            }
            // Compact items have no sockets; this bit is the realm flag.
            if r.bits(1)? != 0 {
                r.skip_bits(128);
            }
        } else {
            socketed_count = r.bits(3)?;
            let guid = r.bits(32)?;
            let ilvl = r.bits(7)?;
            let quality = r.bits(4)?;
            if r.bits(1)? != 0 {
                r.bits(3)?; // icon index
            }
            if r.bits(1)? != 0 {
                r.bits(11)?; // auto affix
            }
            match quality {
                1 => r.skip_bits(3),
                2 if info.types & TYPE_CHAR != 0 => r.skip_bits(12),
                3 => {
                    r.bits(3)?;
                }
                4 => {
                    r.bits(11)?;
                    r.bits(11)?;
                }
                5 => item.unique = Some(UNIQUE_SET + r.bits(12)? as u16),
                7 => item.unique = Some(UNIQUE_UNIQUE + r.bits(12)? as u16),
                6 | 8 => {
                    r.bits(8)?;
                    r.bits(8)?;
                    for _ in 0..6 {
                        if r.bits(1)? != 0 {
                            r.bits(11)?;
                        }
                    }
                }
                _ => {}
            }
            if runeword {
                let stored = r.bits(12)?;
                let id = if stored == 2718 {
                    48
                } else if let Some(&(_, mapped)) = CUSTOM_RUNEWORD_IDS.iter().find(|c| c.0 == stored) {
                    mapped
                } else if stored > 3194 {
                    stored - 3194
                } else if stored > 2869 {
                    stored - 2869
                } else if stored > 2588 {
                    stored - 2588
                } else {
                    stored
                };
                item.unique = Some(UNIQUE_RUNEWORD + id as u16);
                r.skip_bits(4);
            }
            if personalized {
                while r.bits(8)? != 0 {}
            }
            if info.types & TYPE_BOOK != 0 {
                r.skip_bits(5);
            }
            // Realm data.
            if r.bits(1)? != 0 {
                r.skip_bits(128);
            }
            let mut defense = None;
            if info.types & TYPE_ARMO != 0 {
                let ac = r.bits(11)? as i64 - 10;
                defense = Some(defense_of(ac, ethereal, info.min_ac, info.max_ac));
            }
            if info.types & (TYPE_WEAP | TYPE_ARMO) != 0 && r.bits(8)? != 0 {
                r.skip_bits(9); // durability
            }
            if legacy {
                // Up to v104 only stackable bases store a quantity, with no presence flag.
                if info.stackable {
                    item.quantity = Some(r.bits(9)?);
                }
            } else if r.bits(1)? != 0 {
                item.quantity = Some(r.bits(9)?);
            }
            let sockets = if socketed { r.bits(4)? } else { 0 };
            let set_flags = if quality == 5 { r.bits(5)? } else { 0 };
            let lists = 1 + set_flags.count_ones() + runeword as u32;
            let mut stats = Stats::new();
            for _ in 0..lists {
                parse_stats(r, gd, &mut item.add_one, keep.then_some(&mut stats))?;
            }
            if keep {
                consolidate_damage(&mut stats, gd);
                // Blunt weapons: +50% damage to undead, whatever the item stores.
                if info.types & TYPE_BLUN != 0 {
                    add_stat(&mut stats, gd.undead_damage, StatKind::Plain, 0, 50);
                }
                detail = ItemDetail {
                    extended: true,
                    ethereal,
                    quality: if runeword {
                        Some(9)
                    } else {
                        (quality <= 8).then_some(quality as u8)
                    },
                    runeword,
                    sockets,
                    ilvl: Some(ilvl),
                    defense,
                    guid: Some(guid),
                    stats: stats
                        .into_iter()
                        .map(|(key, value)| (stat_text(key, gd), value))
                        .collect(),
                    socketed: Vec::new(),
                };
            }
        }

        if extras && !legacy {
            // Chronicle: 16-bit id, then unless compact a 32-bit time and up to 8 recipients.
            r.skip_bits(16);
            if !compact_chronicle {
                r.skip_bits(32);
            }
            let recipients = if compact_chronicle { 1 } else { r.bits(4)?.min(8) };
            r.skip_bits(64 * recipients as usize);
        }
        if !legacy && r.bits(1)? != 0 {
            item.quantity = Some(r.bits(8)?);
        }
        r.align();

        for _ in 0..socketed_count {
            let child = self.parse_item()?;
            if keep && child.key.is_some() && child.emits() {
                detail.socketed.push(display_name(&child.item, gd));
            }
        }
        self.keep(&mut item, detail);

        let key = match item.unique {
            Some(u) if !gd.uniques[u as usize].known => None,
            Some(_) => Some(Key::Num),
            None if info.preset => Some(Key::Preset(base)),
            None if (info.known && info.tradeable) || location == 6 => Some(Key::Num),
            None => None,
        };
        if let Some(Key::Preset(b)) = key {
            self.presets.push((b, item));
        }
        Ok(at(item, key))
    }

    /// One `JM` list (`parseItemList`): fails only on the header; an item failure stops the list.
    pub fn parse_item_list(&mut self, mut handler: impl FnMut(&Parsed)) -> Result<ListReport> {
        if self.r.read16()? != 0x4d4a {
            return Err(Error("invalid item table header"));
        }
        let declared = self.r.read16()?;
        let first_item_offset = self.r.pos >> 3;
        let mut report = ListReport {
            declared,
            parsed: 0,
            first_item_offset,
            end_offset: first_item_offset,
            error: false,
        };
        for _ in 0..declared {
            match self.parse_item() {
                Ok(parsed) => {
                    handler(&parsed);
                    report.parsed += 1;
                    report.end_offset = self.r.pos >> 3;
                }
                Err(_) => {
                    report.error = true;
                    break;
                }
            }
        }
        Ok(report)
    }
}

/// English name of an item: its runeword, unique or set name, else its base name, else `item.base`.
pub(crate) fn display_name(item: &Item, gd: &GameData) -> String {
    item.unique
        .and_then(|u| gd.uniques[u as usize].name)
        .or(gd.base(item.base).display_name)
        .map_or_else(|| item.code(), |id| gd.name(id).to_string())
}

/// `item.defense` from the stored armor class, with the parser's ethereal and eth-bug arithmetic.
fn defense_of(ac: i64, ethereal: bool, base_min: i64, base_max: i64) -> i64 {
    let third = |v: i64| (v as f64 / 1.5).ceil() as i64;
    let (mut min, mut max) = (ac, ac);
    if ethereal {
        min = third(min);
        max = third(max + 1) - 1;
    }
    if min <= base_max + 1 && max >= base_min {
        return (min.max(base_min) + max.min(base_max + 1)) >> 1;
    }
    let (min2, max2) = (third(min), third(max + 1) - 1);
    if min <= base_max && max >= base_min {
        (min2.max(base_min) + max2.min(base_max)) >> 1
    } else {
        (min + max) >> 1
    }
}

/// One stat list up to the 511 terminator. `Add_one` always sums into `add_one`; `stats`, when
/// given, gets every stat the way `addStat` stores it.
fn parse_stats(r: &mut BitReader, gd: &GameData, add_one: &mut i64, mut stats: Option<&mut Stats>) -> Result<()> {
    loop {
        let mut id = r.bits(9)?;
        if id == 511 {
            return Ok(());
        }
        let info = gd.stat(id).ok_or(Error("unknown item stat code"))?;
        let mut follow = info.follow;
        let mut read = |id: u32, info: &StatInfo, r: &mut BitReader| -> Result<()> {
            let param = if info.param_bits != 0 {
                r.bits(info.param_bits)?
            } else {
                0
            };
            let value = r.bits(info.save_bits)? as i64 - info.save_add;
            if info.add_one {
                *add_one += value;
            }
            if let Some(stats) = stats.as_deref_mut() {
                add_stat(stats, id as u16, info.kind, param as i64, value);
            }
            Ok(())
        };
        read(id, info, r)?;
        // Some stats are followed by the next ids without their own 9-bit header.
        while follow > 0 {
            follow -= 1;
            id += 1;
            let Some(next) = gd.stat(id) else { break };
            read(id, next, r)?;
        }
    }
}

/// `addStat`: the key of a stat and how its value joins an earlier one with the same key.
fn add_stat(stats: &mut Stats, id: u16, kind: StatKind, param: i64, value: i64) {
    let keyed = |params, a, b| StatKey { id, params, a, b };
    let (key, value) = match kind {
        StatKind::SkillOn => (keyed(2, param >> 6, value), param & 63),
        // `value >> 8` is a 32-bit shift in JS.
        StatKind::Charged => (keyed(2, param >> 6, param & 63), ((value as i32) >> 8) as i64),
        StatKind::Param => (keyed(1, param, 0), value),
        StatKind::SkillTab => (keyed(1, (param >> 3) * 3 + (param & 7), 0), value),
        StatKind::Plain | StatKind::Highest => (StatKey::plain(id), value),
    };
    match stats.iter_mut().find(|s| s.0 == key) {
        Some(s) if kind == StatKind::Highest => s.1 = s.1.max(value),
        Some(s) => s.1 += value,
        // Math.max(stats[stat] || 0, value)
        None if kind == StatKind::Highest => stats.push((key, value.max(0))),
        None => stats.push((key, value)),
    }
}

/// The parser's damage consolidation: the highest non-zero of base, secondary and throw damage
/// becomes `mindamage` / `maxdamage`, and the other two go.
fn consolidate_damage(stats: &mut Stats, gd: &GameData) {
    for ids in gd.damage_stats {
        let value = |id| stats.iter().find(|s| s.0 == StatKey::plain(id)).map_or(0, |s| s.1);
        let Some(highest) = ids.iter().map(|&id| value(id)).filter(|&v| v != 0).max() else {
            continue;
        };
        stats.retain(|s| s.0 != StatKey::plain(ids[1]) && s.0 != StatKey::plain(ids[2]));
        match stats.iter_mut().find(|s| s.0 == StatKey::plain(ids[0])) {
            Some(s) => s.1 = highest,
            None => stats.push((StatKey::plain(ids[0]), highest)),
        }
    }
}

fn stat_text(key: StatKey, gd: &GameData) -> String {
    let name = gd.stat_name(key.id);
    match key.params {
        0 => name.to_string(),
        1 => format!("{name}#{}", key.a),
        _ => format!("{name}#{}#{}", key.a, key.b),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defense_follows_the_parser_arithmetic() {
        // In range: midpoint of the stored value clamped to the base range.
        assert_eq!(defense_of(50, false, 40, 60), 50);
        // Ethereal: ceil(ac / 1.5) and ceil((ac + 1) / 1.5) - 1.
        assert_eq!(defense_of(90, true, 40, 60), 60);
        // Out of range both ways: the plain midpoint.
        assert_eq!(defense_of(-10, false, 40, 60), -10);
        assert_eq!(defense_of(-11, true, 0, 0), (-7 + -7) >> 1);
    }

    #[test]
    fn add_stat_keys_and_merges_like_the_parser() {
        let mut stats = Stats::new();
        add_stat(&mut stats, 1, StatKind::SkillOn, (54 << 6) | 7, 12);
        add_stat(&mut stats, 2, StatKind::Charged, (66 << 6) | 3, 20 << 8 | 20);
        add_stat(&mut stats, 3, StatKind::SkillTab, (2 << 3) | 1, 2);
        add_stat(&mut stats, 4, StatKind::Highest, 0, -5);
        add_stat(&mut stats, 4, StatKind::Highest, 0, 30);
        add_stat(&mut stats, 4, StatKind::Highest, 0, 20);
        add_stat(&mut stats, 5, StatKind::Plain, 0, 3);
        add_stat(&mut stats, 5, StatKind::Plain, 0, 4);
        let get = |id, a, b| stats.iter().find(|s| (s.0.id, s.0.a, s.0.b) == (id, a, b)).map(|s| s.1);
        assert_eq!(get(1, 54, 12), Some(7));
        assert_eq!(get(2, 66, 3), Some(20));
        assert_eq!(get(3, 7, 0), Some(2));
        assert_eq!(get(4, 0, 0), Some(30));
        assert_eq!(get(5, 0, 0), Some(7));
    }
}
