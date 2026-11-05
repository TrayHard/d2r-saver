//! Port of `readCharacter` in `src/formats/d2s-reader.ts`: the header reads that can fail, then
//! every item list in file order (main, corpses, hireling, iron golem) and the profile slots.

use crate::bits::BitReader;
use crate::item::{Item, ItemDetail, Key, ListReport, Parsed, Parser};
use crate::{u32_lenient, Error, GameData, Result, D2S_MAGIC};
use std::collections::HashMap;

struct Layout {
    class: usize,
    merc: usize,
    name: usize,
    name_length: usize,
    quests: [usize; 3],
    stats: usize,
}

const V105: Layout = Layout {
    class: 24,
    merc: 163,
    name: 299,
    name_length: 96,
    quests: [413, 509, 605],
    stats: 833,
};
const V99: Layout = Layout {
    class: 40,
    merc: 179,
    name: 267,
    name_length: 60,
    quests: [345, 441, 537],
    stats: 765,
};

/// A profile slot (`profile.items`, `inventory`, `cube`, `stash`, `belt`, `mercItems`), ordered
/// as the index lists them: place by place, then by position.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum Slot {
    Body(u32),
    Inventory(u32),
    Cube(u32),
    Stash(u32),
    Belt(u32),
    Merc(u32),
}

/// What a character holds in its slots, with the dictionary entries the slots point to resolved.
pub struct Character {
    /// Each slot holds the dictionary entry its id points to. A preset id (runes, gems) points to
    /// the LAST item registered with that base code anywhere in the file, like `read.items[ref]`.
    /// Counting reads these.
    pub slots: HashMap<Slot, Item>,
    /// The same slots, each with the item parsed there: its own guid, level and stats where `slots`
    /// has the last copy of a preset base. Detail rows read these.
    pub held: HashMap<Slot, Item>,
    /// The main item list; `None` when its header did not read.
    pub main: Option<ListReport>,
    /// The details `Item::detail` points to when the save was read with details, else empty.
    pub details: Vec<ItemDetail>,
}

/// `readD2S`: a v105 `.d2s`.
pub fn read_d2s(data: &[u8], gd: &GameData) -> Result<Character> {
    read_version(data, gd, 105, false)
}

/// `readLegacyD2S`: a v99 `.d2s`, read only.
pub fn read_legacy_d2s(data: &[u8], gd: &GameData) -> Result<Character> {
    read_version(data, gd, 99, false)
}

/// The v99 reader for version 99, the v105 reader for any other; `details` keeps item details.
pub(crate) fn read_version(data: &[u8], gd: &GameData, version: u32, details: bool) -> Result<Character> {
    let (expected, layout, legacy, error) = if version == 99 {
        (99, &V99, true, "invalid v99 d2s header")
    } else {
        (105, &V105, false, "invalid d2s header")
    };
    // detectFormat: magic, then the version at offset 4.
    if data.len() < 16 || u32_lenient(data, 0) != D2S_MAGIC || u32_lenient(data, 4) != expected {
        return Err(Error(error));
    }
    read_character(data, gd, layout, legacy, details)
}

fn read_character(data: &[u8], gd: &GameData, layout: &Layout, legacy: bool, details: bool) -> Result<Character> {
    let mut p = Parser::new(data, gd, legacy, details);
    let r = &mut p.r;

    r.seek(layout.name);
    r.ensure(layout.name_length << 3)?; // utf8(nameLength)
    r.seek(layout.class);
    r.read8()?; // class
    r.seek(layout.merc);
    let merc_id = r.read32()?;
    if merc_id != 0 {
        r.read16()?; // name
        r.read16()?; // type
        r.read32()?; // experience
    }
    for q in layout.quests {
        r.seek(q);
        for offset in [2, 18, 40, 34, 50, 74] {
            r.byte(offset)?;
        }
    }

    r.seek(layout.stats);
    if r.read16()? != 0x6667 {
        return Err(Error("invalid stats header"));
    }
    loop {
        let id = r.bits(9)?;
        if id == 511 {
            break;
        }
        let stat = gd.stat(id).ok_or(Error("unknown stat code"))?;
        r.bits(stat.csv_bits)?;
    }
    r.bits(((8 - r.pos % 8) % 8) as u32)?;
    r.align();

    if r.read16()? != 0x6669 {
        return Err(Error("invalid skills header"));
    }
    for _ in 0..30 {
        r.read8()?;
    }

    // Items: from here a failure only stops the reading, like the JS try/catch around this part.
    let stash_columns = gd.stash_columns;
    let mut refs: HashMap<Slot, (Key, Item)> = HashMap::new();
    let mut place = |parsed: &Parsed, merc: bool| {
        let Some(key) = parsed.key else { return };
        let (row, col) = (parsed.row, parsed.col);
        let slot = match parsed.location {
            1 if (1..=12).contains(&parsed.bodyloc) => {
                if merc {
                    Slot::Merc(parsed.bodyloc)
                } else {
                    Slot::Body(parsed.bodyloc)
                }
            }
            _ if merc => return,
            0 | 4 => match parsed.storage {
                1 => Slot::Inventory(row * 10 + col),
                4 => Slot::Cube(row * 3 + col),
                5 => Slot::Stash(row * stash_columns + col),
                _ => return,
            },
            2 => Slot::Belt(col),
            _ => return,
        };
        refs.insert(slot, (key, parsed.item));
    };

    let mut main = None;
    let _ = (|| -> Result<()> {
        let list = p.parse_item_list(|parsed| place(parsed, false))?;
        main = Some(list);
        // A failed item leaves the reader inside its bits; the sections after its list are intact.
        if list.error {
            resync(
                &mut p.r,
                data,
                list.end_offset,
                is_corpse_section,
                "corpse section not found",
            )?;
        }

        // Corpses.
        if p.r.read16()? != 0x4d4a {
            return Err(Error("invalid item table header"));
        }
        let corpses = p.r.read16()?;
        for _ in 0..corpses {
            p.r.skip(12);
            let corpse = p.parse_item_list(|_| {})?;
            if corpse.error {
                resync(
                    &mut p.r,
                    data,
                    corpse.end_offset,
                    is_hireling_section,
                    "hireling section not found",
                )?;
                break;
            }
        }

        // Hireling.
        if !p.r.eof() {
            if p.r.read16()? != 0x666a {
                return Err(Error("invalid hireling header"));
            }
            if p.r.byte(0)? == 0x4a && p.r.byte(1)? == 0x4d {
                let merc = p.parse_item_list(|parsed| {
                    if merc_id != 0 {
                        place(parsed, true)
                    }
                })?;
                if merc.error {
                    resync(
                        &mut p.r,
                        data,
                        merc.end_offset,
                        is_golem_section,
                        "iron golem section not found",
                    )?;
                }
            }
        }

        // Iron golem: its item is registered but sits in no slot.
        if !p.r.eof() {
            if p.r.read16()? != 0x666b {
                return Err(Error("invalid iron golem header"));
            }
            if p.r.read8()? != 0 {
                p.parse_item()?;
            }
        }
        Ok(())
    })();

    let slots = refs
        .iter()
        .filter_map(|(&slot, &(key, item))| match key {
            Key::Num => Some((slot, item)),
            Key::Preset(base) => p.preset(base).map(|item| (slot, *item)),
        })
        .collect();
    Ok(Character {
        slots,
        held: refs.into_iter().map(|(slot, (_, item))| (slot, item)).collect(),
        main,
        details: p.details.unwrap_or_default(),
    })
}

/// Little-endian u16 that reads missing bytes as 0.
fn u16_at(data: &[u8], at: usize) -> u32 {
    *data.get(at).unwrap_or(&0) as u32 | (*data.get(at + 1).unwrap_or(&0) as u32) << 8
}

/// "JM" and a corpse count, then the hireling header (or EOF) without a corpse, else the corpse's
/// "JM" list 12 bytes on.
fn is_corpse_section(data: &[u8], at: usize) -> bool {
    u16_at(data, at) == 0x4d4a
        && if u16_at(data, at + 2) == 0 {
            at + 4 == data.len() || u16_at(data, at + 4) == 0x666a
        } else {
            u16_at(data, at + 16) == 0x4d4a
        }
}

/// "jf", then the hireling's "JM" list or the golem header "kf"; EOF too, where a classic character
/// ends after its corpses.
fn is_hireling_section(data: &[u8], at: usize) -> bool {
    at == data.len()
        || (u16_at(data, at) == 0x666a && (at + 2 == data.len() || matches!(u16_at(data, at + 2), 0x4d4a | 0x666b)))
}

/// "kf" and the presence byte 0 or 1.
fn is_golem_section(data: &[u8], at: usize) -> bool {
    u16_at(data, at) == 0x666b && data.get(at + 2).is_some_and(|&b| b <= 1)
}

/// `resync`: seek to the first byte at or after `from` where `is_start` sees the next section.
fn resync(
    r: &mut BitReader,
    data: &[u8],
    from: usize,
    is_start: fn(&[u8], usize) -> bool,
    not_found: &'static str,
) -> Result<()> {
    let at = (from..=data.len())
        .find(|&at| is_start(data, at))
        .ok_or(Error(not_found))?;
    r.seek(at);
    Ok(())
}
