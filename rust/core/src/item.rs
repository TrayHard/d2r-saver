//! Port of `createItemParser` in `src/formats/item-parser.ts` with `resolveMods: false`.
//!
//! The parser reads every field the TypeScript parser reads, in the same order, and keeps only
//! what counting needs: base, unique/set/runeword id, quantity and the `Add_one` stat.

use crate::bits::BitReader;
use crate::data::{GameData, TYPE_ARMO, TYPE_BOOK, TYPE_CHAR, TYPE_WEAP, UNIQUE_RUNEWORD, UNIQUE_SET, UNIQUE_UNIQUE};
use crate::{Error, Result};

/// Stored runeword ids outside the vanilla ranges (`CUSTOM_RUNEWORD_IDS`): Nightfall.
const CUSTOM_RUNEWORD_IDS: &[(u32, u32)] = &[(1396, 325)];

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
}

impl<'a> Parser<'a> {
    pub fn new(buf: &'a [u8], gd: &'a GameData, legacy: bool) -> Self {
        Self {
            r: BitReader::new(buf),
            gd,
            legacy,
            presets: Vec::new(),
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

    /// One item and its socketed children (`parseItem`).
    pub fn parse_item(&mut self) -> Result<Parsed> {
        let gd = self.gd;
        let legacy = self.legacy;
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
        r.bits(1)?; // ethereal
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
            let item = Item {
                code: *b"ear",
                base: gd.base_of(*b"ear"),
                unique: None,
                quantity: None,
                add_one: 0,
            };
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
            r.bits(32)?; // guid
            r.bits(7)?; // ilvl
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
            if info.types & TYPE_ARMO != 0 {
                r.bits(11)?; // defense
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
            if socketed {
                r.bits(4)?;
            }
            let set_flags = if quality == 5 { r.bits(5)? } else { 0 };
            let lists = 1 + set_flags.count_ones() + runeword as u32;
            for _ in 0..lists {
                parse_stats(r, gd, &mut item.add_one)?;
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
            self.parse_item()?;
        }

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

/// One stat list up to the 511 terminator; only `Add_one` is kept.
fn parse_stats(r: &mut BitReader, gd: &GameData, add_one: &mut i64) -> Result<()> {
    loop {
        let mut id = r.bits(9)?;
        if id == 511 {
            return Ok(());
        }
        let info = gd.stat(id).ok_or(Error("unknown item stat code"))?;
        let mut follow = info.follow;
        let mut read = |info: &crate::data::StatInfo, r: &mut BitReader| -> Result<()> {
            if info.param_bits != 0 {
                r.bits(info.param_bits)?;
            }
            let value = r.bits(info.save_bits)? as i64 - info.save_add;
            if info.add_one {
                *add_one += value;
            }
            Ok(())
        };
        read(info, r)?;
        // Some stats are followed by the next ids without their own 9-bit header.
        while follow > 0 {
            follow -= 1;
            id += 1;
            let Some(next) = gd.stat(id) else { break };
            read(next, r)?;
        }
    }
}
