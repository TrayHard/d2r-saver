//! Port of `createItemParser` in `src/formats/item-parser.ts` without the affix solver.
//!
//! The parser reads every field the TypeScript parser reads, in the same order, and fails at the
//! same read. Counting keeps only base, unique/set/runeword id, quantity and the `Add_one` stat; a
//! parser created with details also keeps what an index row needs (`ItemDetail`); a full parser
//! keeps the whole `BinaryParsedItem`, its trace and where it went (`FullItem`).

use crate::bits::{decode_utf8, BitReader};
use crate::data::{
    GameData, StatInfo, StatKind, NO_BASE, TYPE_ARMO, TYPE_BLUN, TYPE_BOOK, TYPE_CHAR, TYPE_GEM, TYPE_VENDOR,
    TYPE_WEAP, UNIQUE_RUNEWORD, UNIQUE_SET, UNIQUE_UNIQUE,
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
        self.unique.map(unique_key)
    }
}

/// `set###`, `unique###` or `runeword###` of a `kind * 4096 + id` index.
pub(crate) fn unique_key(u: u16) -> String {
    let prefix = ["set", "unique", "runeword"][(u / 4096) as usize];
    format!("{prefix}{:03}", u % 4096)
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
    /// The identity of an extended item, see `Fingerprint`; `None` for simple items and ears.
    pub fingerprint: Option<u64>,
    /// Copies of the item are worth an alert: it has a guid other than 0, is superior or better or a
    /// runeword, and is no vendor goods (tomes, keys, quivers). Normal and low quality items are left
    /// out: every new character gets the same starter weapons, one guid for all.
    pub tracked: bool,
}

/// An extended item anywhere in a save (slots, corpses, mercenary, socketed in another item, every
/// stash sector), for duplicate tracking. The iron golem's item is not one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemCopy {
    pub fingerprint: u64,
    pub guid: u32,
    /// `ItemDetail::tracked`.
    pub tracked: bool,
    /// `equipped`, `belt`, `inventory`, `cube`, `stash` (`loc<n>` for another location), `corpse`,
    /// `mercenary`, `socketed`; `tab-page`, `tab-materials` or `tab-<sector type>` in a stash tab.
    pub place: String,
    /// Runeword, unique or set name, otherwise the base name.
    pub name: String,
    pub base: String,
    pub quality: Option<u8>,
}

/// The item list a parser reads, for the place of an `ItemCopy`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Section {
    Main,
    Corpse,
    Mercenary,
    Golem,
    /// A stash tab sector of this type.
    Tab(u8),
}

/// `NONE` stands for an absent field in the fingerprint words.
const NONE: u32 = u32::MAX;

/// The fingerprint of an extended item: FNV-1a 64 over u32 words, each fed as 4 little-endian bytes, of
/// what play cannot change: guid, base family (`normcode`), ethereal, item level, the stored quality, icon
/// index, auto affix, the quality block (low and superior bits, the 12 bits of a normal charm, magic
/// affixes, set or unique id, rare names and affixes), set flags, and the main and set stat lists, each
/// sorted and closed by `NONE`. A list leaves out `Add_one` (a bag's content) and the current charges of
/// a charged skill. Location, identification, sockets and their content, runeword and its list,
/// personalisation, base tier, defense, durability and quantity are not hashed: play changes them.
struct Fingerprint(u64);

impl Fingerprint {
    fn new() -> Self {
        Fingerprint(0xcbf2_9ce4_8422_2325)
    }

    fn word(&mut self, word: u32) {
        for byte in word.to_le_bytes() {
            self.0 = (self.0 ^ byte as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }

    fn list(&mut self, stats: &mut [[u32; 3]]) {
        stats.sort_unstable();
        for word in stats.iter().flatten() {
            self.word(*word);
        }
        self.word(NONE);
    }
}

/// A stat key as `addStat` builds it: the stat name, then `params` of `#a#b`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct StatKey {
    pub id: u16,
    pub params: u8,
    pub a: i64,
    pub b: i64,
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

/// `item.stats` in insertion order.
pub(crate) type Stats = Vec<(StatKey, i64)>;

/// How the parser registers an item in its dictionary (`registeredKey`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Key {
    /// Numeric parse-order id: the dictionary entry is this item.
    Num,
    /// Preset item keyed by base code: the entry is the last item registered with that code.
    Preset(u16),
}

/// A registered key as the dictionary and the item handlers see it: a numeric id or a base code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Ref {
    Num(u32),
    Code([u8; 3]),
}

/// Where `emitLocation` hands an item: `(location, slot)` of `ItemHandler`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Emit {
    Inventory(u32),
    Cube(u32),
    Stash(u32),
    /// `bodyMap[bodyloc]`, 1..=12.
    Body(u32),
    Belt(u32),
    /// Location 6: `handler(id)` without a place.
    Socket,
}

/// `item.ear`.
pub(crate) struct Ear {
    pub class: u32,
    pub level: u32,
    pub name: String,
}

/// `item.quantityField`: pre-stats 1+9 bits or post-stats 1+8 bits.
#[derive(Clone, Copy)]
pub(crate) struct QuantityField {
    pub pre: bool,
    pub flag_bit: usize,
}

/// What an extended (neither simple nor ear) item adds to `BinaryParsedItem`.
pub(crate) struct Extended {
    pub guid: u32,
    pub ilvl: u32,
    /// The stored 4-bit quality.
    pub quality: u32,
    pub runeword: bool,
    pub icon: Option<u32>,
    pub auto_affix: Option<u32>,
    /// Affix ids in read order, `true` for a prefix: one or two for a magic item (ids 0 left out), up
    /// to six for a rare or crafted one (ids 0 kept, like the parser's `mp000`).
    pub affixes: Vec<(bool, u32)>,
    pub rare_name: Option<String>,
    /// `item.unique`: the set or unique id, replaced by the runeword id.
    pub unique: Option<u16>,
    pub personalized: Option<String>,
    /// `item.defense` and `item.ethbugged`.
    pub defense: Option<(i64, bool)>,
    pub setflags: u32,
    /// Blunt weapons get +50 undead damage after the affix solver.
    pub blunt: bool,
}

/// Everything the TypeScript parser returns of one item, without the solver's fields.
pub(crate) struct FullItem {
    pub id: u32,
    /// Socket nesting: 0 for a list item.
    pub depth: u32,
    /// `registeredKey`: `None` when the parser dropped the item.
    pub key: Option<Ref>,
    /// `ItemHead` flags: identified, socketed, ear, simple, ethereal, personalized, runeword, extras
    /// from bit 0 up.
    pub flags: u8,
    pub loc: u32,
    pub bodyloc: u32,
    pub col: u32,
    pub row: u32,
    pub storage: u32,
    /// `item.base`: the code, `ear` for an ear.
    pub code: [u8; 3],
    pub ear: Option<Ear>,
    pub quest_difficulty: Option<i64>,
    pub ext: Option<Box<Extended>>,
    pub quantity: Option<u32>,
    pub quantity_field: Option<QuantityField>,
    /// The quantity key was first set before the stats (its place among the keys).
    pub quantity_pre: bool,
    pub sockets: u32,
    /// `item.stats` before the blunt bonus.
    pub stats: Stats,
    pub socketed_items: Vec<Ref>,
    /// `binaryOffset`: bits of the reader's buffer.
    pub bits: (usize, usize),
    /// `byteRange`, absolute; `fullByteRange` ends at `full_end`.
    pub own: (usize, usize),
    pub full_end: usize,
    pub socket_ranges: Vec<(usize, usize)>,
}

/// A parsed item with what `emitLocation` needs.
pub(crate) struct Parsed {
    pub item: Item,
    pub key: Option<Key>,
    /// Its parse-order id.
    pub id: u32,
    pub location: u32,
    pub bodyloc: u32,
    pub col: u32,
    pub row: u32,
    pub storage: u32,
}

impl Parsed {
    /// `emitLocation` calls its handler, which is what puts a socketed child into `socketedItems`.
    fn emits(&self) -> bool {
        emit_of(self.location, self.bodyloc, self.col, self.row, self.storage, 0).is_some()
    }

    /// The key handlers receive.
    pub fn reference(&self) -> Option<Ref> {
        self.key.map(|key| match key {
            Key::Num => Ref::Num(self.id),
            Key::Preset(_) => Ref::Code(self.item.code),
        })
    }
}

/// `emitLocation` of an item at this position; `stash_columns` sizes the stash slot.
pub(crate) fn emit_of(
    location: u32,
    bodyloc: u32,
    col: u32,
    row: u32,
    storage: u32,
    stash_columns: u32,
) -> Option<Emit> {
    match location {
        0 | 4 => match storage {
            1 => Some(Emit::Inventory(row * 10 + col)),
            4 => Some(Emit::Cube(row * 3 + col)),
            5 => Some(Emit::Stash(row * stash_columns + col)),
            _ => None,
        },
        1 => (1..=12).contains(&bodyloc).then_some(Emit::Body(bodyloc)),
        2 => Some(Emit::Belt(col)),
        6 => Some(Emit::Socket),
        _ => None,
    }
}

/// What one `JM` list looked like (`ItemListReport` without what the caller knows: the expected end).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListReport {
    /// Absolute byte offset of the `JM` marker.
    pub header_offset: usize,
    pub declared: u32,
    pub parsed: u32,
    pub first_item_offset: usize,
    /// Byte after the last item that parsed.
    pub end_offset: usize,
    /// An item failed; the list stops there.
    pub error: bool,
    /// Why item `parsed + 1` failed.
    pub failure: Option<Error>,
}

pub(crate) struct Parser<'a> {
    pub r: BitReader<'a>,
    gd: &'a GameData,
    legacy: bool,
    /// Preset items in registration order; the dictionary entry of a code is its last one.
    pub presets: Vec<(u16, Item)>,
    /// With details: one per parsed item, children before their parent; `Item::detail` points here.
    pub details: Option<Vec<ItemDetail>>,
    /// With details: every extended item outside the golem slot, children before their parent.
    pub copies: Option<Vec<ItemCopy>>,
    /// With details: `SimpleCounts` of the items outside the golem slot, socketed ones left out.
    pub counts: Option<SimpleCounts>,
    /// Full parser: every item that finished parsing, children before their parent (the traces).
    pub full: Option<Vec<FullItem>>,
    /// The list being read; its reader sets it before each list.
    pub section: Section,
    /// Socket nesting of the item being parsed: 0 for a top-level item.
    depth: u32,
    /// The id the next item gets (`itemId++`).
    pub next_id: u32,
    /// Absolute offset of the reader's first byte (`ParserOptions.baseOffset`).
    pub base_offset: usize,
}

impl<'a> Parser<'a> {
    pub fn new(buf: &'a [u8], gd: &'a GameData, legacy: bool, details: bool) -> Self {
        Self {
            r: BitReader::new(buf),
            gd,
            legacy,
            presets: Vec::new(),
            details: details.then(Vec::new),
            copies: details.then(Vec::new),
            counts: details.then(SimpleCounts::new),
            full: None,
            section: Section::Main,
            depth: 0,
            next_id: 0,
            base_offset: 0,
        }
    }

    /// A parser that keeps every item whole, numbering from `first_id`, over a buffer that starts at
    /// absolute byte `base_offset` of the file.
    pub fn full(buf: &'a [u8], gd: &'a GameData, legacy: bool, first_id: u32, base_offset: usize) -> Self {
        Self {
            full: Some(Vec::new()),
            next_id: first_id,
            base_offset,
            ..Self::new(buf, gd, legacy, false)
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

    /// Absolute byte at the cursor.
    fn abs(&self) -> usize {
        self.base_offset + (self.r.pos >> 3)
    }

    /// Stores the details of an item that finished parsing, and its copy, when they are kept.
    fn keep(&mut self, item: &mut Item, detail: ItemDetail, location: u32, storage: u32) {
        let Some(details) = &mut self.details else { return };
        if let (Some(copies), Some(fingerprint), Some(place)) = (
            &mut self.copies,
            detail.fingerprint,
            place(self.section, self.depth, location, storage),
        ) {
            copies.push(ItemCopy {
                fingerprint,
                guid: detail.guid.unwrap_or(0),
                tracked: detail.tracked,
                place,
                name: display_name(item, self.gd),
                base: item.code(),
                quality: detail.quality,
            });
        }
        if let Some(counts) = &mut self.counts {
            count(counts, item, &detail, self.gd, self.section, self.depth);
        }
        item.detail = details.len() as u32;
        details.push(detail);
    }

    /// One item and its socketed children (`parseItem`).
    pub fn parse_item(&mut self) -> Result<Parsed> {
        let gd = self.gd;
        let legacy = self.legacy;
        let keep = self.details.is_some();
        let full = self.full.is_some();
        let id = self.next_id;
        self.next_id += 1;
        let start_bit = self.r.pos;
        let start_byte = self.abs();
        let r = &mut self.r;

        // Flags (35 bits).
        r.skip_bits(4);
        let identified = r.bits(1)? != 0;
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
        let flags = [
            identified,
            socketed,
            ear,
            simple,
            ethereal,
            personalized,
            runeword,
            extras,
        ]
        .iter()
        .enumerate()
        .fold(0u8, |acc, (bit, &set)| acc | (set as u8) << bit);
        let at = |item, key| Parsed {
            item,
            key,
            id,
            location,
            bodyloc,
            col,
            row,
            storage,
        };
        let mut whole = full.then(|| FullItem {
            id,
            depth: self.depth,
            key: None,
            flags,
            loc: location,
            bodyloc,
            col,
            row,
            storage,
            code: *b"ear",
            ear: None,
            quest_difficulty: None,
            ext: None,
            quantity: None,
            quantity_field: None,
            quantity_pre: false,
            sockets: 0,
            stats: Stats::new(),
            socketed_items: Vec::new(),
            bits: (start_bit, 0),
            own: (start_byte, 0),
            full_end: 0,
            socket_ranges: Vec::new(),
        });
        // Simple items and ears: quality normal, no guid, level or stats.
        let mut detail = ItemDetail {
            ethereal,
            quality: Some(2),
            ..ItemDetail::default()
        };

        if ear {
            let class = r.bits(3)?;
            let level = r.bits(7)?;
            let mut name = Vec::new();
            loop {
                let ch = r.bits(8)?;
                if ch == 0 {
                    break;
                }
                if full {
                    name.push(ch as u8);
                }
            }
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
            self.keep(&mut item, detail, location, storage);
            if let Some(mut w) = whole {
                let end = self.abs();
                w.ear = Some(Ear {
                    class,
                    level,
                    name: decode_utf8(&name),
                });
                w.key = Some(Ref::Num(id));
                w.bits.1 = self.r.pos;
                w.own.1 = end;
                w.full_end = end;
                self.full.as_mut().unwrap().push(w);
            }
            return Ok(at(item, Some(Key::Num)));
        }

        let code = [r.code_char()?, r.code_char()?, r.code_char()?];
        if r.code_char()? != b' ' {
            return Err(Error::plain("invalid item code"));
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
        let mut quantity_field = None;
        let mut quantity_pre = false;
        let mut sockets = 0;
        let mut stats = Stats::new();
        let mut ext = None;

        if simple {
            if info.quest_difficulty {
                let difficulty = r.bits_js(gd.quest_difficulty_bits)? - gd.quest_difficulty_add;
                if let Some(w) = &mut whole {
                    w.quest_difficulty = Some(difficulty);
                }
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
            let icon = if r.bits(1)? != 0 { Some(r.bits(3)?) } else { None };
            let auto_affix = if r.bits(1)? != 0 { Some(r.bits(11)?) } else { None };
            let family = if base == NO_BASE || !info.known {
                code
            } else {
                info.family
            };
            let mut fingerprint = Fingerprint::new();
            for word in [
                guid,
                u32::from_le_bytes([family[0], family[1], family[2], 0]),
                ethereal as u32,
                ilvl,
                quality,
                icon.unwrap_or(NONE),
                auto_affix.unwrap_or(NONE),
            ] {
                fingerprint.word(word);
            }
            let mut affixes = Vec::new();
            let mut rare_name = None;
            // Low quality and normal charms are skipped unchecked, like the parser's `skipbits`.
            match quality {
                1 => fingerprint.word(r.bits_unchecked(3)),
                3 => fingerprint.word(r.bits(3)?),
                2 if info.types & TYPE_CHAR != 0 => fingerprint.word(r.bits_unchecked(12)),
                4 => {
                    for prefix in [true, false] {
                        let affix = r.bits(11)?;
                        fingerprint.word(affix);
                        if affix != 0 {
                            affixes.push((prefix, affix));
                        }
                    }
                }
                5 | 7 => {
                    let id = r.bits(12)?;
                    fingerprint.word(id);
                    let kind = if quality == 5 { UNIQUE_SET } else { UNIQUE_UNIQUE };
                    item.unique = Some(kind + id as u16);
                }
                6 | 8 => {
                    let names = [r.bits(8)?, r.bits(8)?];
                    fingerprint.word(names[0]);
                    fingerprint.word(names[1]);
                    if full {
                        let joined = format!(
                            "{} {}",
                            gd.rare_prefix[names[0] as usize], gd.rare_suffix[names[1] as usize]
                        );
                        rare_name = Some(js_trim(&joined).to_string());
                    }
                    for slot in 0..6 {
                        let affix = if r.bits(1)? != 0 { r.bits(11)? } else { NONE };
                        fingerprint.word(affix);
                        if affix != NONE {
                            affixes.push((slot % 2 == 0, affix));
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
            let mut personal = Vec::new();
            if personalized {
                loop {
                    let ch = r.bits(8)?;
                    if ch == 0 {
                        break;
                    }
                    personal.push(ch as u8);
                }
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
            let pre_flag_bit = r.pos - start_bit;
            if legacy {
                // Up to v104 only stackable bases store a quantity, with no presence flag.
                if info.stackable {
                    item.quantity = Some(r.bits(9)?);
                    quantity_pre = true;
                }
            } else if r.bits(1)? != 0 {
                item.quantity = Some(r.bits(9)?);
                quantity_field = Some(QuantityField {
                    pre: true,
                    flag_bit: pre_flag_bit,
                });
                quantity_pre = true;
            }
            sockets = if socketed { r.bits(4)? } else { 0 };
            let set_flags = if quality == 5 { r.bits(5)? } else { 0 };
            if quality == 5 {
                fingerprint.word(set_flags);
            }
            // The main list and the set lists are hashed; the runeword list comes last and is not.
            let hashed = 1 + set_flags.count_ones();
            let mut raw = Vec::new();
            let collect = keep || full;
            for list in 0..hashed + runeword as u32 {
                let own = keep && list < hashed;
                parse_stats(
                    r,
                    gd,
                    &mut item.add_one,
                    collect.then_some(&mut stats),
                    own.then_some(&mut raw),
                )?;
                if own {
                    fingerprint.list(&mut raw);
                    raw.clear();
                }
            }
            let blunt = info.types & TYPE_BLUN != 0;
            if collect {
                consolidate_damage(&mut stats, gd);
            }
            if keep {
                let mut held = stats.clone();
                // Blunt weapons: +50% damage to undead, whatever the item stores.
                if blunt {
                    add_stat(&mut held, gd.undead_damage, StatKind::Plain, 0, 50);
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
                    defense: defense.map(|d| d.0),
                    guid: Some(guid),
                    stats: held
                        .into_iter()
                        .map(|(key, value)| (stat_text(key, gd), value))
                        .collect(),
                    socketed: Vec::new(),
                    fingerprint: Some(fingerprint.0),
                    tracked: guid != 0 && (quality >= 3 || runeword) && info.types & TYPE_VENDOR == 0,
                };
            }
            if full {
                ext = Some(Box::new(Extended {
                    guid,
                    ilvl,
                    quality,
                    runeword,
                    icon,
                    auto_affix,
                    affixes,
                    rare_name,
                    unique: item.unique,
                    // `String.fromCharCode(...bytes)`: one character per byte.
                    personalized: personalized.then(|| personal.iter().map(|&b| b as char).collect()),
                    defense,
                    setflags: set_flags,
                    blunt,
                }));
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
        let post_flag_bit = r.pos - start_bit;
        if !legacy && r.bits(1)? != 0 {
            item.quantity = Some(r.bits(8)?);
            quantity_field = Some(QuantityField {
                pre: false,
                flag_bit: post_flag_bit,
            });
        }
        r.align();
        let end_bit = r.pos;
        let own_end = self.abs();

        self.depth += 1;
        let mut children = Ok(());
        let mut socketed_items = Vec::new();
        let mut socket_ranges = Vec::new();
        for _ in 0..socketed_count {
            let child_start = self.abs();
            match self.parse_item() {
                Ok(child) => {
                    if child.key.is_some() && child.emits() {
                        if keep {
                            detail.socketed.push(display_name(&child.item, gd));
                        }
                        if full {
                            socketed_items.extend(child.reference());
                        }
                    }
                    socket_ranges.push((child_start, self.abs()));
                }
                Err(error) => {
                    children = Err(error);
                    break;
                }
            }
        }
        // A failed child must not leave the next list nested.
        self.depth -= 1;
        children?;
        self.keep(&mut item, detail, location, storage);

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
        let parsed = at(item, key);
        if let Some(mut w) = whole.take() {
            w.key = parsed.reference();
            w.code = code;
            w.ext = ext;
            w.quantity = item.quantity;
            w.quantity_field = quantity_field;
            w.quantity_pre = quantity_pre;
            w.sockets = sockets;
            w.stats = stats;
            w.socketed_items = socketed_items;
            w.bits.1 = end_bit;
            w.own.1 = own_end;
            w.full_end = self.abs();
            w.socket_ranges = socket_ranges;
            self.full.as_mut().unwrap().push(w);
        }
        Ok(parsed)
    }

    /// One `JM` list (`parseItemList`): fails only on the header; an item failure stops the list.
    pub fn parse_item_list(&mut self, mut handler: impl FnMut(&Parsed)) -> Result<ListReport> {
        let header_offset = self.abs();
        if self.r.read16()? != 0x4d4a {
            return Err(Error::plain("invalid item table header"));
        }
        let declared = self.r.read16()?;
        let first_item_offset = self.abs();
        let mut report = ListReport {
            header_offset,
            declared,
            parsed: 0,
            first_item_offset,
            end_offset: first_item_offset,
            error: false,
            failure: None,
        };
        for _ in 0..declared {
            match self.parse_item() {
                Ok(parsed) => {
                    handler(&parsed);
                    report.parsed += 1;
                    report.end_offset = self.abs();
                }
                Err(error) => {
                    report.error = true;
                    report.failure = Some(error);
                    break;
                }
            }
        }
        Ok(report)
    }
}

/// `String.prototype.trim`: Unicode white space and the BOM, which `str::trim` keeps.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// English name of an item: its runeword, unique or set name, else its base name, else `item.base`.
pub(crate) fn display_name(item: &Item, gd: &GameData) -> String {
    item.unique
        .and_then(|u| gd.uniques[u as usize].name)
        .or(gd.base(item.base).display_name)
        .map_or_else(|| item.code(), |id| gd.name(id).to_string())
}

/// Simple items a save holds, by base code: what the fingerprint cannot follow because the item has no guid
/// or its copies stack. A rune, gem, quest or misc item (keys, organs, essences, tokens, shards) counts
/// its materials stack or 1, unless a fingerprint tracks it; a bag counts its content ("Items inside")
/// under `<code>:<unique key>`, whatever its quality. Socketed items and the golem's item are left out.
pub type SimpleCounts = BTreeMap<String, i64>;

fn count(counts: &mut SimpleCounts, item: &Item, detail: &ItemDetail, gd: &GameData, section: Section, depth: u32) {
    if depth > 0 || section == Section::Golem {
        return;
    }
    let info = gd.base(item.base);
    let (key, n) = if item.add_one > 0 {
        let key = item
            .unique_key()
            .map_or_else(|| item.code(), |u| format!("{}:{u}", item.code()));
        (key, item.add_one)
    } else if (info.indexed || info.types & TYPE_GEM != 0) && !detail.tracked {
        // The materials sector keeps stacks; an empty slot there stores 0.
        let stack = if section == Section::Tab(1) {
            item.quantity
        } else {
            None
        };
        (item.code(), stack.map_or(1, i64::from))
    } else {
        return;
    };
    if n > 0 {
        *counts.entry(key).or_default() += n;
    }
}

/// Where an `ItemCopy` sits; `None` for the iron golem's item.
fn place(section: Section, depth: u32, location: u32, storage: u32) -> Option<String> {
    let place = match section {
        Section::Golem => return None,
        _ if depth > 0 => "socketed",
        Section::Corpse => "corpse",
        Section::Mercenary => "mercenary",
        Section::Tab(0) => "tab-page",
        Section::Tab(1) => "tab-materials",
        Section::Tab(kind) => return Some(format!("tab-{kind}")),
        Section::Main => match (location, storage) {
            (1, _) => "equipped",
            (2, _) => "belt",
            (_, 1) => "inventory",
            (_, 4) => "cube",
            (_, 5) => "stash",
            _ => return Some(format!("loc{location}")),
        },
    };
    Some(place.to_string())
}

/// `item.defense` and `item.ethbugged` from the stored armor class, with the parser's ethereal and
/// eth-bug arithmetic.
fn defense_of(ac: i64, ethereal: bool, base_min: i64, base_max: i64) -> (i64, bool) {
    let third = |v: i64| (v as f64 / 1.5).ceil() as i64;
    let (mut min, mut max) = (ac, ac);
    if ethereal {
        min = third(min);
        max = third(max + 1) - 1;
    }
    if min <= base_max + 1 && max >= base_min {
        return ((min.max(base_min) + max.min(base_max + 1)) >> 1, false);
    }
    let (min2, max2) = (third(min), third(max + 1) - 1);
    if min <= base_max && max >= base_min {
        ((min2.max(base_min) + max2.min(base_max)) >> 1, true)
    } else {
        ((min + max) >> 1, false)
    }
}

/// One stat list up to the 511 terminator. `Add_one` always sums into `add_one`; `stats`, when
/// given, gets every stat the way `addStat` stores it; `raw`, when given, gets the stored id, param
/// and value of every stat but `Add_one`, a charged skill without its current charges (`value >> 8`).
fn parse_stats(
    r: &mut BitReader,
    gd: &GameData,
    add_one: &mut i64,
    mut stats: Option<&mut Stats>,
    mut raw: Option<&mut Vec<[u32; 3]>>,
) -> Result<()> {
    loop {
        let mut id = r.bits(9)?;
        if id == 511 {
            return Ok(());
        }
        let info = gd
            .stat(id)
            .ok_or_else(|| Error::new(crate::ErrorKind::Plain, format!("unknown item stat code {id}")))?;
        let mut follow = info.follow;
        let mut read = |id: u32, info: &StatInfo, r: &mut BitReader| -> Result<()> {
            let param = if info.param_bits != 0 {
                r.bits_js(info.param_bits)?
            } else {
                0
            };
            let stored = r.bits_js(info.save_bits)?;
            let value = stored - info.save_add;
            if info.add_one {
                *add_one += value;
            } else if let Some(raw) = raw.as_deref_mut() {
                let stored = stored as u32;
                let stored = if info.kind == StatKind::Charged {
                    stored >> 8
                } else {
                    stored
                };
                raw.push([id, param as u32, stored]);
            }
            if let Some(stats) = stats.as_deref_mut() {
                add_stat(stats, id as u16, info.kind, param, value);
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
pub(crate) fn add_stat(stats: &mut Stats, id: u16, kind: StatKind, param: i64, value: i64) {
    let keyed = |params, a, b| StatKey { id, params, a, b };
    let (key, value) = match kind {
        // The JS shifts and masks int32s.
        StatKind::SkillOn => (keyed(2, (param as i32 >> 6) as i64, value), param & 63),
        StatKind::Charged => (
            keyed(2, (param as i32 >> 6) as i64, param & 63),
            ((value as i32) >> 8) as i64,
        ),
        StatKind::Param => (keyed(1, param, 0), value),
        StatKind::SkillTab => (keyed(1, (param as i32 >> 3) as i64 * 3 + (param & 7), 0), value),
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

/// The key `addStat` stores a stat under.
pub(crate) fn stat_text(key: StatKey, gd: &GameData) -> String {
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
        assert_eq!(defense_of(50, false, 40, 60), (50, false));
        // Ethereal: ceil(ac / 1.5) and ceil((ac + 1) / 1.5) - 1.
        assert_eq!(defense_of(90, true, 40, 60), (60, false));
        // Out of range both ways: the plain midpoint.
        assert_eq!(defense_of(-10, false, 40, 60), (-10, false));
        assert_eq!(defense_of(-11, true, 0, 0), ((-7 + -7) >> 1, false));
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

    #[test]
    fn trims_like_javascript() {
        assert_eq!(js_trim(" \u{FEFF}Grim Shield\u{A0} "), "Grim Shield");
    }
}
