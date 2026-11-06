//! The documents of the TypeScript readers as JSON: everything `readD2S`, `readLegacyD2S`, `readD2I`,
//! `walkItemList`, `walkD2I`, `walkLegacyD2I` and `readItemHead` return, except the fields of the
//! affix solver. The npm package parses a document and builds the reader's objects from it.
//!
//! Every document but the item head has:
//! - `items`: every parsed item as its `BinaryParsedItem`, children before their parent. With `solve`
//!   an extended item is `[head, tail, mods, blunt]`: the solver's fields go between the two halves,
//!   `mods` is the solver's affix list and `blunt` asks for the +50 undead damage after the solver.
//! - `traces`: per item `[depth, registeredKey, flags, loc, bodyloc, col, row, storage]`, the flags
//!   of `ItemHead` from bit 0: identified, socketed, ear, simple, ethereal, personalized, runeword,
//!   extras.
//! - `undef`: indexes of the items whose `quality` is `undefined` (a stored quality of 9 to 15 that is
//!   no runeword); the document holds `null` there.
//!
//! Item trees (`entries` of a walk, `coverage.items`) are `[item index, index, [children…]]`.
//! A reader that throws gives `{"throw":{"kind","message"}}` instead.

use crate::bits::BitReader;
use crate::character::{list_error, read_checked, u16_at, CharacterRead, DemonReport, Mode, Profile, Slot};
use crate::data::{GameData, StatKind};
use crate::item::{add_stat, stat_text, unique_key, FullItem, ListReport, Ref, Section};
use crate::json::Json;
use crate::stash::{self, PageType, Quantities};
use crate::{u32_lenient, Error, ErrorKind, Result};

/// `readD2S` (`legacy` false) or `readLegacyD2S`.
pub fn read_d2s(data: &[u8], gd: &GameData, legacy: bool, solve: bool) -> String {
    match read_checked(data, gd, legacy, Mode::Full) {
        Ok(read) => character(data, gd, read, solve),
        Err(error) => thrown(&error),
    }
}

/// `readD2I`.
pub fn read_d2i(data: &[u8], gd: &GameData, solve: bool) -> String {
    let read = stash::read_d2i(data, gd);
    let mut j = Json::new();
    j.open();
    items(&mut j, read.items.iter(), gd, solve);
    j.key("pages");
    j.open_array();
    for page in &read.pages {
        j.open();
        j.key("pageType");
        match page.page_type {
            PageType::Raw(kind) => j.num(kind),
            PageType::Gems => j.str("gems"),
            PageType::Runes => j.str("runes"),
            PageType::Misc => j.str("misc"),
        }
        j.field("gold", page.gold);
        j.key("stash");
        j.open_array();
        for (slot, reference) in &page.stash {
            j.open_array();
            j.num(*slot);
            write_ref(&mut j, Some(*reference));
            j.close_array();
        }
        j.close_array();
        match &page.quantities {
            Quantities::None => {}
            Quantities::List(list) => {
                j.key("quantities");
                j.open_array();
                for q in list {
                    j.num(*q);
                }
                j.close_array();
            }
            Quantities::Slots(slots) => {
                j.key("quantities");
                j.open();
                for (slot, q) in slots {
                    j.field(&slot.to_string(), *q);
                }
                j.close();
            }
        }
        if let Some(rows) = page.rows {
            j.field("rows", rows);
        }
        j.field("offset", page.offset);
        j.field("sectorSize", page.sector_size);
        j.field("sector", page.sector);
        j.field("rawType", page.raw_type);
        j.close();
    }
    j.close_array();
    j.key("sectors");
    j.open_array();
    for sector in &read.sectors {
        j.open();
        j.field("offset", sector.offset);
        j.field("size", sector.size);
        j.field("type", sector.kind);
        j.field("gold", sector.gold);
        j.key("list");
        match &sector.list {
            Some(list) => report(&mut j, list, Some((sector.offset + sector.size) as f64)),
            None => j.null(),
        }
        j.close();
    }
    j.close_array();
    strings(&mut j, "warnings", &read.warnings);
    j.field_bool("tiled", read.tiled);
    j.field_bool("reachedEof", read.reached_eof);
    j.close();
    j.out
}

/// `walkItemList` from `header_offset`; `expected_end` is the caller's, any number.
pub fn walk_item_list(
    data: &[u8],
    header_offset: usize,
    gd: &GameData,
    legacy: bool,
    first_id: u32,
    expected_end: Option<f64>,
    solve: bool,
) -> String {
    let expected = expected_end.filter(|e| e.fract() == 0.0 && *e >= 0.0).map(|e| e as u64);
    let walk = match stash::walk_item_list(
        data,
        header_offset,
        gd,
        legacy,
        first_id,
        expected,
        Mode::Full,
        Section::Main,
    ) {
        Ok(walk) => walk,
        Err(error) => return thrown(&error),
    };
    let entries = tree(&walk.full, 0);
    if entries.len() != walk.report.parsed as usize {
        return thrown(&Error::new(
            ErrorKind::Parse,
            format!(
                "walker recorded {} top-level items but the parser reports {}",
                entries.len(),
                walk.report.parsed
            ),
        ));
    }
    let mut j = Json::new();
    j.open();
    items(&mut j, walk.full.iter(), gd, solve);
    j.key("report");
    report(&mut j, &walk.report, expected_end);
    j.key("entries");
    nodes(&mut j, &entries);
    j.close();
    j.out
}

/// `walkD2I` (`legacy` false) or `walkLegacyD2I`.
pub fn walk_d2i(data: &[u8], gd: &GameData, legacy: bool, solve: bool) -> String {
    let walked = match stash::walk_sectors(data, gd, legacy, Mode::Full) {
        Ok(walked) => walked,
        Err(error) => return thrown(&error),
    };
    // The items of every sector in one list; each walk names its range.
    let all = walked
        .sectors
        .iter()
        .flat_map(|s| s.walk.iter().flat_map(|w| w.full.iter()));
    let mut j = Json::new();
    j.open();
    items(&mut j, all, gd, solve);
    j.key("sectors");
    j.open_array();
    let mut from = 0;
    for sector in &walked.sectors {
        j.open();
        j.field("offset", sector.offset);
        j.field("size", sector.size);
        j.field("type", sector.kind);
        j.field("gold", sector.gold);
        j.key("walk");
        match &sector.walk {
            Some(walk) => {
                j.open();
                j.key("report");
                report(&mut j, &walk.report, Some((sector.offset + sector.size) as f64));
                j.key("entries");
                nodes(&mut j, &tree(&walk.full, from));
                j.field("from", from);
                from += walk.full.len();
                j.field("to", from);
                j.close();
            }
            None => j.null(),
        }
        j.close();
    }
    j.close_array();
    j.field_bool("tiled", walked.tiled(data.len()));
    j.field_bool("reachedEof", walked.reached_eof);
    j.close();
    j.out
}

/// `readD2SDemonSection` at `header_offset`: the report, which never throws.
pub fn read_demons(data: &[u8], header_offset: usize, gd: &GameData) -> String {
    let mut j = Json::new();
    write_demons(&mut j, &crate::character::read_demons(data, header_offset, gd));
    j.out
}

/// Flags, position block and base code of an item head.
type Head = ([bool; 8], [u32; 5], Option<[u8; 3]>);

/// `readItemHead` at byte `offset`.
pub fn read_item_head(bytes: &[u8], offset: usize) -> String {
    let mut r = BitReader::new(bytes);
    r.pos = offset * 8;
    let head = (|| -> Result<Head> {
        let mut flags = [false; 8];
        // The parser's flag block, the chronicle bits skipped.
        for (flag, skip) in flags.iter_mut().zip([4, 6, 4, 4, 0, 1, 1, 1]) {
            r.skip_bits(skip);
            *flag = r.bits(1)? != 0;
        }
        r.skip_bits(6);
        let position = [r.bits(3)?, r.bits(4)?, r.bits(4)?, r.bits(4)?, r.bits(3)?];
        if flags[2] {
            return Ok((flags, position, None));
        }
        let code = [r.code_char()?, r.code_char()?, r.code_char()?];
        let terminator = r.code_char()?;
        if terminator != b' ' {
            let [a, b, c] = code.map(char::from);
            return Err(Error::new(
                ErrorKind::Parse,
                format!(
                    "invalid item code at byte {offset}: expected a space after \"{a}{b}{c}\", got \"{}\"",
                    terminator as char
                ),
            ));
        }
        Ok((flags, position, Some(code)))
    })();
    let (flags, position, code) = match head {
        Ok(head) => head,
        Err(error) => return thrown(&error),
    };
    let mut j = Json::new();
    j.open();
    j.key("head");
    j.open();
    let names = [
        "identified",
        "socketed",
        "ear",
        "simple",
        "ethereal",
        "personalized",
        "runeword",
        "extras",
    ];
    for (name, flag) in names.iter().zip(flags) {
        j.field_bool(name, flag);
    }
    for (name, value) in ["loc", "bodyloc", "col", "row", "storage"].iter().zip(position) {
        j.field(name, value);
    }
    j.key("base");
    match code {
        Some(code) => j.str(&code_text(code)),
        None => j.null(),
    }
    j.close();
    j.close();
    j.out
}

fn thrown(error: &Error) -> String {
    let kind = match error.kind {
        ErrorKind::Plain => "plain",
        ErrorKind::Overrun => "overrun",
        ErrorKind::Parse => "parse",
        ErrorKind::InvalidArgument => "argument",
    };
    let mut j = Json::new();
    j.open();
    j.key("throw");
    j.open();
    j.field_str("kind", kind);
    j.field_str("message", &error.message);
    j.close();
    j.close();
    j.out
}

fn code_text(code: [u8; 3]) -> String {
    code.iter().map(|&c| c as char).collect()
}

fn write_ref(j: &mut Json, reference: Option<Ref>) {
    match reference {
        Some(Ref::Num(id)) => j.num(id),
        Some(Ref::Code(code)) => j.str(&code_text(code)),
        None => j.null(),
    }
}

fn strings(j: &mut Json, key: &str, list: &[String]) {
    j.key(key);
    j.open_array();
    for s in list {
        j.str(s);
    }
    j.close_array();
}

/// `ItemListReport`; `expected_end` is `null` when unknown.
fn report(j: &mut Json, list: &ListReport, expected_end: Option<f64>) {
    let reached_end = expected_end.map(|e| list.end_offset as f64 == e);
    j.open();
    j.field("headerOffset", list.header_offset);
    j.field("declared", list.declared);
    j.field("parsed", list.parsed);
    j.field("firstItemOffset", list.first_item_offset);
    j.field("endOffset", list.end_offset);
    j.key("expectedEnd");
    match expected_end {
        Some(e) => j.num(e),
        None => j.null(),
    }
    j.key("reachedEnd");
    match reached_end {
        Some(r) => j.bool(r),
        None => j.null(),
    }
    j.field_bool("truncated", list.parsed < list.declared);
    j.field_bool(
        "complete",
        list.parsed == list.declared && list.failure.is_none() && reached_end != Some(false),
    );
    j.key("error");
    match &list.failure {
        Some(_) => j.str(&list_error(list)),
        None => j.null(),
    }
    j.key("errorCode");
    match &list.failure {
        Some(e) if e.kind == ErrorKind::Overrun => j.str("BUFFER_OVERRUN"),
        Some(_) => j.str("PARSE_ERROR"),
        None => j.null(),
    }
    j.close();
}

/// `items`, `traces` and `undef` of a document.
fn items<'a>(j: &mut Json, list: impl Iterator<Item = &'a FullItem> + Clone, gd: &GameData, solve: bool) {
    j.key("items");
    j.open_array();
    for item in list.clone() {
        write_item(j, item, gd, solve);
    }
    j.close_array();
    j.key("traces");
    j.open_array();
    for item in list.clone() {
        j.open_array();
        j.num(item.depth);
        write_ref(j, item.key);
        for value in [
            item.flags as u32,
            item.loc,
            item.bodyloc,
            item.col,
            item.row,
            item.storage,
        ] {
            j.num(value);
        }
        j.close_array();
    }
    j.close_array();
    j.key("undef");
    j.open_array();
    for (i, item) in list.enumerate() {
        if item.ext.as_ref().is_some_and(|e| !e.runeword && e.quality > 8) {
            j.num(i);
        }
    }
    j.close_array();
}

fn affix_code(prefix: bool, id: u32) -> String {
    format!("{}{id:03}", if prefix { "mp" } else { "ms" })
}

/// One `BinaryParsedItem`, its keys in the order `parseItem` sets them.
fn write_item(j: &mut Json, item: &FullItem, gd: &GameData, solve: bool) {
    let split = solve && item.ext.is_some();
    if split {
        j.open_array();
    }
    j.open();
    j.field("itemId", item.id);
    j.field_bool("unidentified", item.flags & 1 == 0);
    j.field_bool("ethereal", item.flags & 16 != 0);
    j.field_bool("socketed", item.flags & 2 != 0);
    j.field("sockets", item.sockets);
    j.key("socketedItems");
    j.open_array();
    for &child in &item.socketed_items {
        write_ref(j, Some(child));
    }
    j.close_array();
    j.key("stats");
    j.open();
    let mut with_bonus;
    let stats = if !split && item.ext.as_ref().is_some_and(|e| e.blunt) {
        with_bonus = item.stats.clone();
        add_stat(&mut with_bonus, gd.undead_damage, StatKind::Plain, 0, 50);
        &with_bonus
    } else {
        &item.stats
    };
    for &(key, value) in stats {
        j.field(&stat_text(key, gd), value);
    }
    j.close();
    j.range("binaryOffset", item.bits);

    if let Some(ear) = &item.ear {
        j.key("ear");
        j.open();
        j.field("class", ear.class);
        j.field("level", ear.level);
        j.field_str("name", &ear.name);
        j.close();
        j.field_str("base", "ear");
        j.field("quality", 2);
        j.range("byteRange", item.own);
        j.range("fullByteRange", (item.own.0, item.full_end));
        j.key("socketedByteRanges");
        j.open_array();
        j.close_array();
        j.close();
        return;
    }

    j.field_str("base", &code_text(item.code));
    match &item.ext {
        None => {
            if let Some(difficulty) = item.quest_difficulty {
                j.field("questDifficulty", difficulty);
            }
            j.field("quality", 2);
        }
        Some(ext) => {
            j.field("guid", ext.guid);
            j.field("ilvl", ext.ilvl);
            j.key("quality");
            if ext.runeword {
                j.num(9);
            } else if ext.quality <= 8 {
                j.num(ext.quality);
            } else {
                j.null();
            }
            if let Some(icon) = ext.icon {
                j.field("iconIndex", icon);
            }
            match ext.quality {
                4 => {
                    for &(prefix, id) in &ext.affixes {
                        let code = affix_code(prefix, id);
                        j.field_str(if prefix { "magicPrefixCode" } else { "magicSuffixCode" }, &code);
                        j.key(if prefix { "prefixCodes" } else { "suffixCodes" });
                        j.open_array();
                        j.str(&code);
                        j.close_array();
                    }
                }
                5 | 7 => j.field_str(
                    "unique",
                    &unique_key(ext.unique.expect("set and unique items have an id")),
                ),
                6 | 8 => {
                    j.field_str("name", ext.rare_name.as_deref().unwrap_or(""));
                    // Each code list sits where its first code was read.
                    let first_prefix = ext.affixes.first().is_none_or(|a| a.0);
                    for prefix in [first_prefix, !first_prefix] {
                        let mut codes = ext.affixes.iter().filter(|a| a.0 == prefix).peekable();
                        if codes.peek().is_some() {
                            j.key(if prefix { "prefixCodes" } else { "suffixCodes" });
                            j.open_array();
                            for &(_, id) in codes {
                                j.str(&affix_code(prefix, id));
                            }
                            j.close_array();
                        }
                    }
                }
                _ => {}
            }
            if ext.runeword && !matches!(ext.quality, 5 | 7) {
                j.field_str("unique", &unique_key(ext.unique.expect("runewords have an id")));
            }
            if let Some(name) = &ext.personalized {
                j.field_str("personalized", name);
            }
            if let Some((defense, ethbugged)) = ext.defense {
                j.field("defense", defense);
                if ethbugged {
                    j.field_bool("ethbugged", true);
                }
            }
            if item.quantity_pre {
                quantity(j, item);
            }
            if ext.setflags != 0 {
                j.field("setflags", ext.setflags);
            }
        }
    }
    if split {
        j.close();
        j.open();
    }
    if !item.quantity_pre && item.quantity.is_some() {
        quantity(j, item);
    }
    j.range("byteRange", item.own);
    j.key("socketedByteRanges");
    j.open_array();
    for &(start, end) in &item.socket_ranges {
        j.open();
        j.field("start", start);
        j.field("end", end);
        j.close();
    }
    j.close_array();
    j.range("fullByteRange", (item.own.0, item.full_end));
    j.close();
    if let (true, Some(ext)) = (split, &item.ext) {
        // The solver's `mods`: the auto affix, then the affix codes as read.
        j.open_array();
        if let Some(auto) = ext.auto_affix {
            j.str(&format!("am{auto:03}"));
        }
        for &(prefix, id) in &ext.affixes {
            j.str(&affix_code(prefix, id));
        }
        j.close_array();
        j.bool(ext.blunt);
        j.close_array();
    }
}

/// `quantity` and, when its flag was read, `quantityField`.
fn quantity(j: &mut Json, item: &FullItem) {
    j.field("quantity", item.quantity.unwrap_or(0));
    if let Some(field) = item.quantity_field {
        j.key("quantityField");
        j.open();
        j.field_str("placement", if field.pre { "pre-stats" } else { "post-stats" });
        j.field("flagBit", field.flag_bit);
        j.field("width", if field.pre { 9 } else { 8 });
        j.close();
    }
}

/// A walked item: its index into the document's items, its index among its siblings, its children.
struct Node {
    item: usize,
    index: usize,
    children: Vec<Node>,
}

/// The walker's tree: children finish before their parent, so each item takes the items one level
/// deeper that finished since the last item of its own level.
fn tree(items: &[FullItem], base: usize) -> Vec<Node> {
    let mut pending: Vec<Vec<Node>> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let depth = item.depth as usize;
        if pending.len() < depth + 2 {
            pending.resize_with(depth + 2, Vec::new);
        }
        let children = std::mem::take(&mut pending[depth + 1]);
        let index = pending[depth].len();
        pending[depth].push(Node {
            item: base + i,
            index,
            children,
        });
    }
    pending.into_iter().next().unwrap_or_default()
}

fn nodes(j: &mut Json, list: &[Node]) {
    j.open_array();
    for node in list {
        j.open_array();
        j.num(node.item);
        j.num(node.index);
        nodes(j, &node.children);
        j.close_array();
    }
    j.close_array();
}

/// The `.d2s` document: `readCharacter`'s result without its byte copies, which the caller slices.
fn character(data: &[u8], gd: &GameData, read: CharacterRead, solve: bool) -> String {
    let full = read.parser.full.unwrap_or_default();
    let p = &read.profile;
    let mut j = Json::new();
    j.open();
    items(&mut j, full.iter(), gd, solve);

    j.key("profile");
    j.open();
    j.field_str("name", &p.name);
    j.field("classId", p.class_id);
    j.key("merc");
    match p.merc {
        Some(merc) => {
            j.open_array();
            for value in merc {
                j.num(value);
            }
            j.close_array();
        }
        None => j.null(),
    }
    j.key("quests");
    j.open_array();
    for table in p.quests {
        j.open_array();
        for quest in table {
            j.bool(quest);
        }
        j.close_array();
    }
    j.close_array();
    j.key("attributes");
    j.open();
    for &(id, value) in &p.attributes {
        j.field(gd.stat_name(id as u16), value);
    }
    j.close();
    j.key("skills");
    j.open();
    for &(id, level) in &p.skills {
        j.field(&id.to_string(), level);
    }
    j.close();
    j.key("slots");
    j.open_array();
    for &(slot, reference) in &p.placements {
        let (kind, at) = match slot {
            Slot::Body(at) => (0, at),
            Slot::Inventory(at) => (1, at),
            Slot::Cube(at) => (2, at),
            Slot::Stash(at) => (3, at),
            Slot::Belt(at) => (4, at),
            Slot::Merc(at) => (5, at),
        };
        j.open_array();
        j.num(kind);
        j.num(at);
        write_ref(&mut j, Some(reference));
        j.close_array();
    }
    j.close_array();
    j.field_bool("mercSection", p.merc_section);
    j.key("ironGolem");
    match p.iron_golem {
        Some(id) => j.num(id),
        None => j.null(),
    }
    for (key, range) in [("corpse", p.corpse), ("golem", p.golem_bytes)] {
        j.key(key);
        match range {
            Some((start, end)) => {
                j.open_array();
                j.num(start);
                j.num(end);
                j.close_array();
            }
            None => j.null(),
        }
    }
    j.key("extra");
    match p.extra {
        Some(start) => j.num(start),
        None => j.null(),
    }
    j.key("bindDemon");
    match &p.bind_demon {
        Some(demon) => {
            j.open();
            j.field_str("revive", "bind");
            j.field_str("id", &demon.id);
            j.field_str("monsterType", demon.monster_type);
            j.field_str("monster", &demon.monster);
            j.field("area", demon.area);
            j.field("level", demon.level);
            j.field_str("unit", &format!("bind_{}", demon.monster));
            j.field_str("group", "binddemon");
            j.field_bool("minion", demon.minion);
            j.field_str("skill", "382");
            if !demon.mods.is_empty() {
                strings(&mut j, "mods", &demon.mods);
            }
            j.close();
        }
        None => j.null(),
    }
    j.close();

    j.key("lists");
    j.open();
    j.key("main");
    match &p.lists.main {
        Some(list) => report(&mut j, list, None),
        None => j.null(),
    }
    j.key("corpses");
    j.open_array();
    for list in &p.lists.corpses {
        report(&mut j, list, None);
    }
    j.close_array();
    j.key("merc");
    match &p.lists.merc {
        Some(list) => report(&mut j, list, None),
        None => j.null(),
    }
    j.key("golem");
    match p.lists.golem {
        Some((header_offset, present)) => {
            j.open();
            j.field("headerOffset", header_offset);
            j.field_bool("present", present);
            j.close();
        }
        None => j.null(),
    }
    j.close();

    j.key("demons");
    match &p.demons {
        Some(demons) => write_demons(&mut j, demons),
        None => j.null(),
    }
    strings(&mut j, "warnings", &p.warnings);

    j.key("coverage");
    j.open();
    let checked = coverage(data, p, &full);
    j.field_bool("complete", checked.is_ok());
    let (reached_eof, end_offset) = match &checked {
        Ok((_, _, end)) => (true, *end),
        Err(_) => p.demons.as_ref().map_or((false, 0), |d| (d.reached_eof, d.end_offset)),
    };
    j.field_bool("reachedEof", reached_eof);
    j.field("endOffset", end_offset);
    j.key("error");
    match &checked {
        Ok(_) => j.null(),
        Err(message) => j.str(message),
    }
    j.key("items");
    match &checked {
        Ok((roots, _, _)) => nodes(&mut j, roots),
        Err(_) => nodes(&mut j, &[]),
    }
    j.key("sections");
    j.open_array();
    if let Ok((_, sections, _)) = &checked {
        for &(kind, start, end) in sections {
            j.open();
            j.field_str("kind", kind);
            j.field("start", start);
            j.field("end", end);
            j.close();
        }
    }
    j.close_array();
    j.close();

    j.close();
    j.out
}

fn write_demons(j: &mut Json, demons: &DemonReport) {
    j.open();
    j.field("headerOffset", demons.header_offset);
    j.field("endOffset", demons.end_offset);
    j.field("declared", demons.declared);
    j.field("parsed", demons.parsed);
    j.key("records");
    j.open_array();
    for record in &demons.records {
        j.open();
        j.range("descriptor", record.descriptor);
        j.range("statsRange", record.stats_range);
        j.field("statDataSize", record.stat_data_size);
        j.field("demonType", record.demon_type);
        j.field("classId", record.class_id);
        j.key("stats");
        j.open_array();
        for &(id, value) in &record.stats {
            j.open();
            j.field("id", id);
            j.field("value", value);
            j.close();
        }
        j.close_array();
        j.close();
    }
    j.close_array();
    j.field_bool("complete", demons.complete);
    j.field_bool("reachedEof", demons.reached_eof);
    j.key("error");
    match &demons.error {
        Some(error) => j.str(error),
        None => j.null(),
    }
    j.close();
}

/// Item trees, sections and end offset of a complete character.
type Covered = (Vec<Node>, Vec<(&'static str, usize, usize)>, usize);

/// `d2sCoverage`: every byte of the character belongs to a known section and every item is ranged.
fn coverage(data: &[u8], p: &Profile, items: &[FullItem]) -> std::result::Result<Covered, &'static str> {
    if !p.prefix_complete {
        return Err("unsupported character prefix schema");
    }
    let lists = &p.lists;
    // Mercenary and golem sections exist for expansion characters only (status bit 5).
    let expansion = data.get(p.layout.flags).is_some_and(|f| f & 0x20 != 0);
    let Some(main) = &lists.main else {
        return Err("incomplete character sections");
    };
    if !p.warnings.is_empty() || (expansion && lists.golem.is_none()) || p.demons.as_ref().is_some_and(|d| !d.complete)
    {
        return Err("incomplete character sections");
    }
    if u32_lenient(data, 8) as usize != data.len() || u32_lenient(data, 12) != checksum(data) {
        return Err("invalid character size or checksum");
    }
    let full = |i: usize| (items[i].own.0, items[i].full_end);
    let mut pending: Vec<Vec<Node>> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let depth = item.depth as usize;
        if pending.len() < depth + 2 {
            pending.resize_with(depth + 2, Vec::new);
        }
        let mut children = std::mem::take(&mut pending[depth + 1]);
        if item.own.1 <= item.own.0 {
            return Err("invalid character item range");
        }
        let mut cursor = item.own.1;
        for (index, child) in children.iter_mut().enumerate() {
            child.index = index;
            if full(child.item).0 != cursor {
                return Err("uncovered socket bytes");
            }
            cursor = full(child.item).1;
        }
        if cursor != item.full_end || cursor > data.len() {
            return Err("invalid character item end");
        }
        pending[depth].push(Node {
            item: i,
            index: 0,
            children,
        });
    }
    if pending.iter().skip(1).any(|level| !level.is_empty()) {
        return Err("orphan socket items");
    }
    let mut roots = pending.into_iter().next().unwrap_or_default();
    let mut used = 0;
    for list in std::iter::once(main).chain(&lists.corpses).chain(&lists.merc) {
        if list.failure.is_some() || list.declared != list.parsed {
            return Err("incomplete character item list");
        }
        let mut cursor = list.first_item_offset;
        for index in 0..list.parsed as usize {
            let Some(entry) = roots.get_mut(used) else {
                return Err("uncovered character item bytes");
            };
            used += 1;
            if full(entry.item).0 != cursor {
                return Err("uncovered character item bytes");
            }
            entry.index = index;
            cursor = full(entry.item).1;
        }
        if cursor != list.end_offset {
            return Err("character list end mismatch");
        }
    }
    let corpse_start = main.end_offset;
    let corpse_end = corpse_start + p.corpse.map_or(0, |(s, e)| e - s);
    if corpse_end < corpse_start + 4 {
        return Err("missing corpse section");
    }
    if u16_at(data, corpse_start + 2) as usize != lists.corpses.len() {
        return Err("corpse count mismatch");
    }
    let mut corpse_cursor = corpse_start + 4;
    for corpse in &lists.corpses {
        if corpse.header_offset != corpse_cursor + 12 {
            return Err("invalid corpse boundary");
        }
        corpse_cursor = corpse.end_offset;
    }
    if corpse_cursor != corpse_end {
        return Err("uncovered corpse bytes");
    }
    let Some((golem_header, golem_present)) = lists.golem else {
        // A classic character ends right after its corpses.
        if lists.merc.is_some() || p.demons.is_some() || used != roots.len() || corpse_end != data.len() {
            return Err("uncovered character tail");
        }
        let sections = vec![
            ("header-stats-skills", 0, main.header_offset),
            ("main", main.header_offset, corpse_start),
            ("corpses", corpse_start, corpse_end),
        ];
        return Ok((roots, sections, corpse_end));
    };
    if u32_lenient(data, p.layout.merc) != 0 && lists.merc.is_none() {
        return Err("missing hired mercenary item list");
    }
    let merc_end = golem_header;
    if u16_at(data, corpse_end) != 0x666a
        || merc_end != lists.merc.as_ref().map_or(corpse_end + 2, |m| m.end_offset)
        || lists.merc.as_ref().is_some_and(|m| m.header_offset != corpse_end + 2)
    {
        return Err("invalid mercenary boundary");
    }
    let raw_golem = p.golem_bytes.map_or(&[][..], |(s, e)| &data[s..e]);
    let golem_end = merc_end + raw_golem.len();
    if raw_golem.get(2).copied() != Some(golem_present as u8) {
        return Err("invalid golem presence flag");
    }
    if golem_present {
        let Some(entry) = roots.get_mut(used) else {
            return Err("incomplete golem item");
        };
        used += 1;
        if full(entry.item) != (merc_end + 3, golem_end) {
            return Err("incomplete golem item");
        }
        entry.index = 0;
    } else if golem_end != merc_end + 3 {
        return Err("unexpected golem bytes");
    }
    let tail_ok = match &p.demons {
        Some(d) => d.header_offset == golem_end,
        None => golem_end == data.len(),
    };
    if used != roots.len() || !tail_ok {
        return Err("uncovered character tail");
    }
    let mut sections = vec![
        ("header-stats-skills", 0, main.header_offset),
        ("main", main.header_offset, main.end_offset),
        ("corpses", corpse_start, corpse_end),
        ("mercenary", corpse_end, merc_end),
        ("golem", merc_end, golem_end),
    ];
    if let Some(d) = &p.demons {
        sections.push(("demons", d.header_offset, d.end_offset));
    }
    let mut cursor = 0;
    for &(_, start, end) in &sections {
        if start != cursor || end <= start || end > data.len() {
            return Err("noncontiguous character sections");
        }
        cursor = end;
    }
    if cursor != data.len() {
        return Err("character EOF mismatch");
    }
    Ok((roots, sections, cursor))
}

/// `computeChecksum`: the rolling checksum with the checksum field read as zeros.
fn checksum(data: &[u8]) -> u32 {
    data.iter().enumerate().fold(0u32, |sum, (i, &byte)| {
        let byte = if (12..16).contains(&i) { 0 } else { byte as u32 };
        byte.wrapping_add(sum >> 31).wrapping_add(sum.wrapping_mul(2))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_rolls_like_the_writer() {
        let mut data = vec![0u8; 20];
        data[0] = 0xff;
        data[13] = 0x77; // inside the checksum field: read as 0
        data[19] = 3;
        // checksum = (byte + (checksum & 0x80000000 ? 1 : 0) + checksum * 2) >>> 0
        let mut expected = 0u64;
        for (i, &b) in data.iter().enumerate() {
            let b = if (12..16).contains(&i) { 0 } else { b as u64 };
            expected = (b + ((expected >> 31) & 1) + expected * 2) & 0xffff_ffff;
        }
        assert_eq!(checksum(&data) as u64, expected);
    }
}
