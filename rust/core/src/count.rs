//! Port of `ItemIndex/src/items.mjs`: how many of each named item a save holds.

use crate::item::Item;
use crate::{read_d2s, read_legacy_d2s, u32_lenient, walk_d2i, walk_legacy_d2i, Error, GameData, Result};
use std::collections::{BTreeMap, HashMap};

/// Item name → copies, sorted by name.
pub type Counts = BTreeMap<String, i64>;

#[derive(Debug, PartialEq, Eq)]
pub struct CharacterCounts {
    pub version: u32,
    pub hardcore: bool,
    pub ladder: bool,
    pub items: Counts,
}

/// `characterStatus`: version at byte 4, status flags at byte 20 (v105) or 36 (older).
pub fn character_status(bytes: &[u8]) -> (u32, bool, bool) {
    let version = u32_lenient(bytes, 4);
    let flags = *bytes.get(if version >= 105 { 20 } else { 36 }).unwrap_or(&0);
    (version, flags >> 2 & 1 == 1, flags >> 6 & 1 == 1)
}

/// `itemName`: the English name the index keeps the item under, `None` when it is not indexed.
pub fn item_name<'g>(item: &Item, gd: &'g GameData) -> Option<&'g str> {
    name_id(item, gd).map(|id| gd.name(id))
}

fn name_id(item: &Item, gd: &GameData) -> Option<u32> {
    match item.unique {
        Some(u) => gd.uniques[u as usize].name,
        None => gd.base(item.base).name,
    }
}

/// `add`: a bag counts its "Items inside", a materials slot its stack, anything else one.
fn add(counts: &mut HashMap<u32, i64>, item: &Item, gd: &GameData, stack: Option<i64>) {
    let Some(name) = name_id(item, gd) else { return };
    let n = if item.add_one > 0 {
        item.add_one
    } else {
        stack.unwrap_or(1)
    };
    if n > 0 {
        *counts.entry(name).or_default() += n;
    }
}

fn named(counts: HashMap<u32, i64>, gd: &GameData) -> Counts {
    counts.into_iter().map(|(id, n)| (gd.name(id).to_string(), n)).collect()
}

/// `characterItems`: slot references of a character (body, inventory, cube, stash, belt, mercenary).
pub fn character_items(bytes: &[u8], gd: &GameData) -> Result<CharacterCounts> {
    let (version, hardcore, ladder) = character_status(bytes);
    let read = if version == 99 {
        read_legacy_d2s(bytes, gd)?
    } else {
        read_d2s(bytes, gd)?
    };
    let mut counts = HashMap::new();
    for item in read.slots.values() {
        add(&mut counts, item, gd, None);
    }
    Ok(CharacterCounts {
        version,
        hardcore,
        ladder,
        items: named(counts, gd),
    })
}

/// `stashTabItems`: top-level entries of every sector; stacks count only in the materials sector.
pub fn stash_tab_items(bytes: &[u8], gd: &GameData) -> Result<Counts> {
    let report = if u32_lenient(bytes, 8) == 99 {
        walk_legacy_d2i(bytes, gd)?
    } else {
        walk_d2i(bytes, gd)?
    };
    if !report.reached_eof {
        return Err(Error("Stash tab ends in an unknown sector"));
    }
    let mut counts = HashMap::new();
    for sector in &report.sectors {
        let Some(walk) = &sector.walk else { continue };
        if !walk.complete {
            return Err(Error("Stash sector is not fully readable"));
        }
        for item in &walk.entries {
            // An empty materials slot stores 0; elsewhere the field is ammunition or charges.
            let stack = if sector.kind == 1 {
                item.quantity.map(i64::from)
            } else {
                None
            };
            add(&mut counts, item, gd, stack);
        }
    }
    Ok(named(counts, gd))
}
