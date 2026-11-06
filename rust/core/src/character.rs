//! Port of `readCharacter` in `src/formats/d2s-reader.ts`: the header, attributes and skills, then
//! every item list in file order (main, corpses, hireling, iron golem), the profile slots and, for a
//! document, the sections after them (`readD2SDemonSection` and the bind-demon descriptor).

use crate::bits::BitReader;
use crate::data::GameData;
use crate::item::{
    emit_of, Emit, Item, ItemCopy, ItemDetail, Key, ListReport, Parsed, Parser, Ref, Section, SimpleCounts,
};
use crate::{u32_lenient, Error, ErrorKind, Result, D2S_MAGIC};
use std::collections::HashMap;

pub(crate) struct Layout {
    pub flags: usize,
    class: usize,
    pub merc: usize,
    name: usize,
    name_length: usize,
    quests: [usize; 3],
    stats: usize,
}

const V105: Layout = Layout {
    flags: 20,
    class: 24,
    merc: 163,
    name: 299,
    name_length: 96,
    quests: [413, 509, 605],
    stats: 833,
};
const V99: Layout = Layout {
    flags: 36,
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
    /// With details: every extended item of the main, corpse and hireling lists, socketed ones included.
    pub copies: Vec<ItemCopy>,
    /// With details: the simple item counts of the same lists.
    pub counts: SimpleCounts,
}

/// `D2SItemLists`.
#[derive(Default)]
pub(crate) struct Lists {
    pub main: Option<ListReport>,
    pub corpses: Vec<ListReport>,
    pub merc: Option<ListReport>,
    /// The iron-golem section: header offset and presence flag.
    pub golem: Option<(usize, bool)>,
}

/// `D2SDemonSectionReport`.
pub(crate) struct DemonReport {
    pub header_offset: usize,
    pub end_offset: usize,
    pub declared: u32,
    pub parsed: u32,
    pub records: Vec<DemonRecord>,
    pub complete: bool,
    pub reached_eof: bool,
    pub error: Option<String>,
}

pub(crate) struct DemonRecord {
    pub descriptor: (usize, usize),
    pub stats_range: (usize, usize),
    pub stat_data_size: u32,
    pub demon_type: u32,
    pub class_id: u32,
    pub stats: Vec<(u32, u32)>,
}

/// `profile.bindDemon`.
pub(crate) struct BindDemon {
    pub id: String,
    pub monster_type: &'static str,
    pub monster: String,
    pub area: u32,
    pub level: u32,
    pub minion: bool,
    pub mods: Vec<String>,
}

/// Everything `readCharacter` reads besides the items.
pub(crate) struct Profile {
    pub layout: &'static Layout,
    pub name: String,
    pub class_id: u32,
    /// `mercName`, the hireling type and its experience, when a hireling is hired.
    pub merc: Option<[u32; 3]>,
    /// Per difficulty: den of evil, radament's lair, golden bird, lam essen's tome, fallen angel,
    /// prison of ice.
    pub quests: [[bool; 6]; 3],
    /// Stat id and value in the order the stats first appear.
    pub attributes: Vec<(u32, i64)>,
    pub prefix_complete: bool,
    /// Skill id and level, levels 0 left out.
    pub skills: Vec<(u32, u32)>,
    /// Handler calls of the main and hireling lists, in order.
    pub placements: Vec<(Slot, Ref)>,
    /// The hireling header was read: `profile.mercItems` exists.
    pub merc_section: bool,
    pub iron_golem: Option<u32>,
    /// Byte ranges of `rawCorpse` and `rawGolem`, start of `extraSections`.
    pub corpse: Option<(usize, usize)>,
    pub golem_bytes: Option<(usize, usize)>,
    pub extra: Option<usize>,
    pub bind_demon: Option<BindDemon>,
    pub lists: Lists,
    pub demons: Option<DemonReport>,
    pub warnings: Vec<String>,
}

/// What the parser keeps of the items.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Count,
    Details,
    /// Whole items, and the sections after the iron golem.
    Full,
}

pub(crate) struct CharacterRead<'a> {
    pub parser: Parser<'a>,
    pub refs: HashMap<Slot, (Key, Item)>,
    pub profile: Profile,
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
    let mode = if details { Mode::Details } else { Mode::Count };
    let read = read_checked(data, gd, version == 99, mode)?;
    let p = read.parser;
    let slots = read
        .refs
        .iter()
        .filter_map(|(&slot, &(key, item))| match key {
            Key::Num => Some((slot, item)),
            Key::Preset(base) => p.preset(base).map(|item| (slot, *item)),
        })
        .collect();
    Ok(Character {
        slots,
        held: read.refs.into_iter().map(|(slot, (_, item))| (slot, item)).collect(),
        main: read.profile.lists.main,
        details: p.details.unwrap_or_default(),
        copies: p.copies.unwrap_or_default(),
        counts: p.counts.unwrap_or_default(),
    })
}

/// `readD2S` (`legacy` false: detectFormat says d2s) or `readLegacyD2S`, then `readCharacter`.
pub(crate) fn read_checked<'a>(
    data: &'a [u8],
    gd: &'a GameData,
    legacy: bool,
    mode: Mode,
) -> Result<CharacterRead<'a>> {
    let (expected, layout, error) = if legacy {
        (99, &V99, "invalid v99 d2s header")
    } else {
        (105, &V105, "invalid d2s header")
    };
    if data.len() < 16 || u32_lenient(data, 0) != D2S_MAGIC || u32_lenient(data, 4) != expected {
        return Err(Error::plain(error));
    }
    read_character(data, gd, layout, legacy, mode)
}

fn read_character<'a>(
    data: &'a [u8],
    gd: &'a GameData,
    layout: &'static Layout,
    legacy: bool,
    mode: Mode,
) -> Result<CharacterRead<'a>> {
    let mut p = if mode == Mode::Full {
        Parser::full(data, gd, legacy, 0, 0)
    } else {
        Parser::new(data, gd, legacy, mode == Mode::Details)
    };
    let r = &mut p.r;

    r.seek(layout.name);
    let name = r.utf8(layout.name_length)?;
    r.seek(layout.class);
    let class_id = r.read8()?;
    r.seek(layout.merc);
    let merc_id = r.read32()?;
    let merc = if merc_id != 0 {
        Some([r.read16()?, r.read16()?, r.read32()?])
    } else {
        None
    };
    let mut quests = [[false; 6]; 3];
    for (table, &offset) in quests.iter_mut().zip(&layout.quests) {
        r.seek(offset);
        for (quest, at) in table.iter_mut().zip([2, 18, 40, 34, 50, 74]) {
            *quest = r.byte(at)? & 1 != 0;
        }
    }

    r.seek(layout.stats);
    if r.read16()? != 0x6667 {
        return Err(Error::plain("invalid stats header"));
    }
    // The bundled tables certify zero-CsvParam base attributes only (ids 0..15).
    let mut prefix_complete = class_id < gd.class_count;
    let mut attributes: Vec<(u32, i64)> = Vec::new();
    loop {
        let id = r.bits(9)?;
        if id == 511 {
            break;
        }
        let stat = gd
            .stat(id)
            .ok_or_else(|| Error::new(ErrorKind::Plain, format!("unknown stat code {id}")))?;
        let seen = attributes.iter().position(|a| a.0 == id);
        if id > 15 || seen.is_some() || !stat.csv_int || stat.csv_bits == 0 || stat.csv_bits > 32 {
            prefix_complete = false;
        }
        let value = r.bits_js(stat.csv_bits)?;
        match seen {
            Some(i) => attributes[i].1 = value,
            None => attributes.push((id, value)),
        }
    }
    if r.bits(((8 - r.pos % 8) % 8) as u32)? != 0 {
        prefix_complete = false;
    }
    r.align();

    if r.read16()? != 0x6669 {
        return Err(Error::plain("invalid skills header"));
    }
    let skill_base = match class_id {
        0..=7 => [6, 36, 66, 96, 126, 221, 251, 373][class_id as usize],
        c => (c - 5) * 30 + 221,
    };
    let mut skills = Vec::new();
    for i in 0..30 {
        let level = r.read8()?;
        if level != 0 {
            skills.push((i + skill_base, level));
        }
    }

    let mut profile = Profile {
        layout,
        name,
        class_id,
        merc,
        quests,
        attributes,
        prefix_complete,
        skills,
        placements: Vec::new(),
        merc_section: false,
        iron_golem: None,
        corpse: None,
        golem_bytes: None,
        extra: None,
        bind_demon: None,
        lists: Lists::default(),
        demons: None,
        warnings: Vec::new(),
    };
    let mut refs = HashMap::new();
    // From here a failure only stops the reading, like the JS try/catch around this part.
    if let Err(error) = read_items(&mut p, data, gd, merc_id != 0, mode, &mut profile, &mut refs) {
        profile
            .warnings
            .push(format!("Item parsing error (some items may be missing): {error}"));
    }
    Ok(CharacterRead {
        parser: p,
        refs,
        profile,
    })
}

/// The slot a list's handler puts an item in.
fn place(parsed: &Parsed, merc: bool, stash_columns: u32) -> Option<Slot> {
    parsed.key?;
    let emit = emit_of(
        parsed.location,
        parsed.bodyloc,
        parsed.col,
        parsed.row,
        parsed.storage,
        stash_columns,
    )?;
    Some(match emit {
        Emit::Body(b) if merc => Slot::Merc(b),
        Emit::Body(b) => Slot::Body(b),
        _ if merc => return None,
        Emit::Inventory(s) => Slot::Inventory(s),
        Emit::Cube(s) => Slot::Cube(s),
        Emit::Stash(s) => Slot::Stash(s),
        Emit::Belt(s) => Slot::Belt(s),
        Emit::Socket => return None,
    })
}

/// `item <n>/<declared>: <reason>` of a list that stopped on an item.
pub(crate) fn list_error(list: &ListReport) -> String {
    let reason = list.failure.as_ref().map_or("", |e| &e.message);
    format!("item {}/{}: {reason}", list.parsed + 1, list.declared)
}

fn read_items(
    p: &mut Parser,
    data: &[u8],
    gd: &GameData,
    merc_hired: bool,
    mode: Mode,
    profile: &mut Profile,
    refs: &mut HashMap<Slot, (Key, Item)>,
) -> Result<()> {
    let columns = gd.stash_columns;
    let placements = &mut profile.placements;
    let mut handler = |parsed: &Parsed, merc: bool| {
        if let (Some(slot), Some(key), Some(reference)) = (place(parsed, merc, columns), parsed.key, parsed.reference())
        {
            refs.insert(slot, (key, parsed.item));
            placements.push((slot, reference));
        }
    };
    let list = p.parse_item_list(|parsed| handler(parsed, false))?;
    profile.lists.main = Some(list.clone());
    // A failed item leaves the reader inside its bits; the sections after its list are intact.
    if list.error {
        profile
            .warnings
            .push(format!("Main item list truncated: {}", list_error(&list)));
        resync(&mut p.r, data, list.end_offset, is_corpse_section, "corpse")?;
    }

    // Corpses.
    p.section = Section::Corpse;
    let corpse_start = p.r.pos >> 3;
    if p.r.read16()? != 0x4d4a {
        return Err(Error::plain("invalid item table header"));
    }
    let corpses = p.r.read16()?;
    for i in 0..corpses {
        p.r.skip(12);
        let corpse = p.parse_item_list(|_| {})?;
        profile.lists.corpses.push(corpse.clone());
        if corpse.error {
            profile.warnings.push(format!(
                "Corpse {}/{corpses} item list truncated: {}",
                i + 1,
                list_error(&corpse)
            ));
            resync(&mut p.r, data, corpse.end_offset, is_hireling_section, "hireling")?;
            break;
        }
    }
    profile.corpse = Some((corpse_start, p.r.pos >> 3));

    // Hireling.
    p.section = Section::Mercenary;
    if !p.r.eof() {
        if p.r.read16()? != 0x666a {
            return Err(Error::plain("invalid hireling header"));
        }
        profile.merc_section = true;
        if p.r.byte(0)? == 0x4a && p.r.byte(1)? == 0x4d {
            let merc = p.parse_item_list(|parsed| {
                if merc_hired {
                    handler(parsed, true)
                }
            })?;
            profile.lists.merc = Some(merc.clone());
            if merc.error {
                profile
                    .warnings
                    .push(format!("Hireling item list truncated: {}", list_error(&merc)));
                resync(&mut p.r, data, merc.end_offset, is_golem_section, "iron golem")?;
            }
        }
    }

    // Iron golem: its item is registered but sits in no slot.
    p.section = Section::Golem;
    if !p.r.eof() {
        let golem_start = p.r.pos >> 3;
        if p.r.read16()? != 0x666b {
            return Err(Error::plain("invalid iron golem header"));
        }
        let present = p.r.read8()? != 0;
        profile.lists.golem = Some((golem_start, present));
        if present {
            let golem = p.parse_item()?;
            if emit_of(golem.location, golem.bodyloc, golem.col, golem.row, golem.storage, 0).is_some() {
                profile.iron_golem = golem.reference().map(|r| match r {
                    Ref::Num(id) => id,
                    Ref::Code(_) => 0,
                });
            }
        }
        profile.golem_bytes = Some((golem_start, p.r.pos >> 3));
    }

    // The 0x666c warlock demon section, kept verbatim, read strictly and best-effort.
    if mode == Mode::Full && !p.r.eof() {
        let start = p.r.pos >> 3;
        profile.extra = Some(start);
        let demons = read_demons(data, start, gd);
        if !demons.complete {
            profile.warnings.push(format!(
                "Demon section incomplete: {}",
                demons.error.as_deref().unwrap_or("null")
            ));
        }
        profile.demons = Some(demons);
        read_bind_demon(&mut p.r, gd, &mut profile.bind_demon);
    }
    Ok(())
}

/// Little-endian u16 that reads missing bytes as 0.
pub(crate) fn u16_at(data: &[u8], at: usize) -> u32 {
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
    section: &str,
) -> Result<()> {
    let at = (from..=data.len()).find(|&at| is_start(data, at)).ok_or_else(|| {
        Error::new(
            ErrorKind::Plain,
            format!("{section} section not found after the truncated item list"),
        )
    })?;
    r.seek(at);
    Ok(())
}

/// `readD2SDemonSection`: the strict v105 bridge and its `lf` record; anything unknown fails closed.
pub(crate) fn read_demons(data: &[u8], header_offset: usize, gd: &GameData) -> DemonReport {
    let mut report = DemonReport {
        header_offset,
        end_offset: header_offset,
        declared: 0,
        parsed: 0,
        records: Vec::new(),
        complete: false,
        reached_eof: false,
        error: None,
    };
    let mut r = BitReader::new(data);
    let fail = |message: &'static str| Err(Error::plain(message));
    let result = (|| -> Result<()> {
        if header_offset > data.len() {
            return fail("invalid demon section offset");
        }
        r.seek(header_offset);
        if r.read16()? != 1 || r.read16()? != 0x666c {
            return fail("unknown demon section version or marker");
        }
        report.declared = r.read16()?;
        if report.declared > 1 {
            return fail("unsupported demon count or header padding");
        }
        if report.declared == 1 {
            let start = r.pos >> 3;
            if start + 92 > data.len() {
                return fail("truncated demon descriptor");
            }
            let stat_data_size = r.read16()?;
            let demon_type = r.read16()?;
            let class_id = r.read16()?;
            if demon_type != 1 && demon_type != 2 {
                return fail("unknown demon type");
            }
            if class_id == 0 {
                return fail("invalid demon class");
            }
            r.seek(start + 92);
            let stats_start = start + 92;
            let stats_end = stats_start + stat_data_size as usize;
            if stat_data_size < 4 || stats_end > data.len() {
                return fail("invalid demon stat data size");
            }
            // Every bit read is bounded to the declared blob, not the whole character save.
            let mut s = BitReader::new(&data[stats_start..stats_end]);
            if s.read16()? != 0x6667 {
                return fail("invalid demon stats marker");
            }
            let mut stats: Vec<(u32, u32)> = Vec::new();
            loop {
                let id = s.bits(9)?;
                if id == 0x1ff {
                    break;
                }
                if id > 15 || gd.stat(id).is_none() {
                    return fail("unsupported demon stat schema");
                }
                if stats.iter().any(|st| st.0 == id) {
                    return fail("duplicate demon stat");
                }
                stats.push((id, s.bits(32)?));
            }
            let padding = ((8 - s.pos % 8) % 8) as u32;
            if s.bits(padding)? != 0 || s.pos != stat_data_size as usize * 8 {
                return fail("unconsumed demon stat bytes or nonzero padding");
            }
            r.seek(stats_end);
            report.records.push(DemonRecord {
                descriptor: (start, start + 92),
                stats_range: (stats_start, stats_end),
                stat_data_size,
                demon_type,
                class_id,
                stats,
            });
            report.parsed = 1;
        }
        report.end_offset = r.pos >> 3;
        report.reached_eof = report.end_offset == data.len();
        if !report.reached_eof {
            return fail("unknown trailing character data");
        }
        report.complete = report.parsed == report.declared;
        Ok(())
    })();
    if let Err(error) = result {
        report.end_offset = r.pos >> 3;
        report.error = Some(error.message.into_owned());
    }
    report
}

/// The best-effort bind-demon descriptor after the iron golem; a read past the end keeps what was set.
fn read_bind_demon(r: &mut BitReader, gd: &GameData, out: &mut Option<BindDemon>) {
    let _ = (|| -> Result<()> {
        if r.read16()? != 1 || r.read16()? != 0x666c {
            return Ok(());
        }
        if r.read16()? == 0 {
            return Ok(());
        }
        r.read16()?; // entry size
        let id_type = r.read16()?; // 1 normal monster by hcidx, 2 super unique
        let mon_id = r.read16()? as i64 - 1;
        r.read16()?;
        let mon_type = r.read16()?; // 8 unique, 12 champion
        r.read16()?;
        r.read8()?; // difficulty
        r.skip(11);
        let area = r.read32()?;
        let level = r.read32()?;
        r.skip(48);
        let bind = &gd.bind;
        let super_unique = bind.super_uniques.get(&mon_id.to_string());
        let (monster, id, monster_type) = match id_type {
            2 => (
                super_unique.and_then(|su| su.0.clone()),
                Some(mon_id.to_string()),
                "super",
            ),
            1 => {
                let monster = bind
                    .monsters
                    .iter()
                    .find(|m| m.1 == Some(mon_id as f64))
                    .map(|m| m.0.clone());
                (
                    monster.clone(),
                    monster,
                    if mon_type == 12 { "champion" } else { "unique" },
                )
            }
            _ => return Ok(()),
        };
        let (Some(monster), Some(id)) = (monster.filter(|m| !m.is_empty()), id.filter(|i| !i.is_empty())) else {
            return Ok(());
        };
        let demon = out.insert(BindDemon {
            id,
            monster_type,
            monster,
            area,
            level,
            minion: mon_type != 16,
            mods: Vec::new(),
        });
        let preset: Vec<&String> = match (id_type, super_unique) {
            (2, Some(su)) => {
                su.1.iter()
                    .flatten()
                    .filter_map(|key| bind.unique_mods.get(key))
                    .collect()
            }
            _ => Vec::new(),
        };
        let mut all: Vec<String> = Vec::new();
        for _ in 0..8 {
            let key = r.read8()?.to_string();
            if let Some(um) = bind.unique_mods.get(&key) {
                if !all.contains(um) {
                    all.push(um.clone());
                }
            }
        }
        demon.mods = all.into_iter().filter(|m| !preset.contains(&m)).collect();
        Ok(())
    })();
}
