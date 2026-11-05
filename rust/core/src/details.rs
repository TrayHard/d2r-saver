//! Rows of the BGS item index (`item_index.items`): every held top-level item of a save with what
//! d2r-saver reads of it. Held means what counting walks: the character's slots and the top-level
//! entries of every stash sector. A row is every extended item (any quality) and every simple item
//! of an indexed base type (runes, quest items, craft components, bags); an empty materials slot
//! (quantity 0) is not a row.

use crate::character::{read_version, Slot};
use crate::count::{character_status, copies, read_tab, stack};
use crate::item::{display_name, Item, ItemDetail};
use crate::{GameData, Result};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DetailRow {
    /// `equipped`, `inventory`, `cube`, `stash`, `belt`, `mercenary`; `tab-page`, `tab-materials`
    /// or `tab-<sector type>` in a stash tab.
    pub place: String,
    /// Runeword, unique or set name, otherwise the base name (the code when the data has none).
    pub name: String,
    /// `item.base`.
    pub base: String,
    pub quality: Option<u8>,
    pub runeword: bool,
    pub ethereal: bool,
    pub sockets: u32,
    pub ilvl: Option<u32>,
    pub defense: Option<i64>,
    /// Copies the row stands for: a bag's content, a materials stack, otherwise 1.
    pub quantity: i64,
    pub guid: Option<u32>,
    pub stats: BTreeMap<String, i64>,
    pub socketed: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CharacterDetails {
    pub version: u32,
    pub hardcore: bool,
    pub ladder: bool,
    /// Ordered by place (`Slot` order), then by position.
    pub rows: Vec<DetailRow>,
}

/// The rows of a `.d2s`, read like `character_items` reads it.
pub fn character_details(bytes: &[u8], gd: &GameData) -> Result<CharacterDetails> {
    let (version, hardcore, ladder) = character_status(bytes);
    let read = read_version(bytes, gd, version, true)?;
    let mut slots: Vec<_> = read.slots.iter().collect();
    slots.sort_unstable_by_key(|(slot, _)| **slot);
    let rows = slots
        .into_iter()
        .filter_map(|(slot, item)| {
            let place = match slot {
                Slot::Body(_) => "equipped",
                Slot::Inventory(_) => "inventory",
                Slot::Cube(_) => "cube",
                Slot::Stash(_) => "stash",
                Slot::Belt(_) => "belt",
                Slot::Merc(_) => "mercenary",
            };
            row(item, &read.details, gd, place, None)
        })
        .collect();
    Ok(CharacterDetails {
        version,
        hardcore,
        ladder,
        rows,
    })
}

/// The rows of a `.d2i` stash tab in sector and list order; fails where `stash_tab_items` fails.
pub fn stash_tab_details(bytes: &[u8], gd: &GameData) -> Result<Vec<DetailRow>> {
    let report = read_tab(bytes, gd, true)?;
    let mut rows = Vec::new();
    for sector in &report.sectors {
        let Some(walk) = &sector.walk else { continue };
        let place = match sector.kind {
            0 => "tab-page".to_string(),
            1 => "tab-materials".to_string(),
            kind => format!("tab-{kind}"),
        };
        for item in &walk.entries {
            rows.extend(row(item, &walk.details, gd, &place, stack(sector.kind, item)));
        }
    }
    Ok(rows)
}

fn row(item: &Item, details: &[ItemDetail], gd: &GameData, place: &str, stack: Option<i64>) -> Option<DetailRow> {
    let detail = &details[item.detail as usize];
    let quantity = copies(item, stack);
    if !(detail.extended || gd.base(item.base).indexed) || quantity <= 0 {
        return None;
    }
    Some(DetailRow {
        place: place.to_string(),
        name: display_name(item, gd),
        base: item.code(),
        quality: detail.quality,
        runeword: detail.runeword,
        ethereal: detail.ethereal,
        sockets: detail.sockets,
        ilvl: detail.ilvl,
        defense: detail.defense,
        quantity,
        guid: detail.guid,
        stats: detail.stats.clone(),
        socketed: detail.socketed.clone(),
    })
}
