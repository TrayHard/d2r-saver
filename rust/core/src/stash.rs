//! Port of `walkSectors` / `walkItemList` in `src/formats/item-walker.ts` and of `readD2I` in
//! `src/formats/d2i-reader.ts`: every sector of a `.d2i` stash tab, the items of each sector's `JM`
//! list, and the pages `readD2I` makes of them.

use crate::character::{list_error, Mode};
use crate::data::{GameData, Page};
use crate::item::{
    emit_of, Emit, FullItem, Item, ItemCopy, ItemDetail, ListReport, Parser, Ref, Section, SimpleCounts,
};
use crate::{u32_lenient, Error, ErrorKind, Result, D2S_MAGIC};
use std::collections::HashSet;

const SECTOR_HEADER_SIZE: u64 = 64;

pub struct StashWalk {
    pub report: ListReport,
    /// `report.parsed === declared`, no error, and the list ends exactly at the sector end.
    pub complete: bool,
    /// Top-level items in list order, registered by the parser or not; socketed children are not here.
    pub entries: Vec<Item>,
    /// The details `Item::detail` points to when the tab was walked with details, else empty.
    pub details: Vec<ItemDetail>,
    /// With details: every extended item of the sector, socketed ones included.
    pub copies: Vec<ItemCopy>,
    /// With details: the simple item counts of the sector.
    pub counts: SimpleCounts,
    /// A full walk: every item of the list, children before their parent.
    pub(crate) full: Vec<FullItem>,
}

pub struct StashSector {
    pub offset: u64,
    pub size: u64,
    /// 0 normal, 1 extended (materials), 2 metadata.
    pub kind: u8,
    pub gold: u32,
    /// `None` for a metadata sector.
    pub walk: Option<StashWalk>,
}

pub struct StashReport {
    pub sectors: Vec<StashSector>,
    /// The sector loop ran to the end of the buffer without stopping on an unrecognised sector.
    pub reached_eof: bool,
}

impl StashReport {
    /// The sector sizes add up to exactly the buffer length (`tiled`).
    pub fn tiled(&self, len: usize) -> bool {
        self.reached_eof && self.sectors.last().is_some_and(|s| s.offset + s.size == len as u64)
    }
}

/// `walkD2I`: a v105 stash tab.
pub fn walk_d2i(buffer: &[u8], gd: &GameData) -> Result<StashReport> {
    walk_sectors(buffer, gd, false, Mode::Count)
}

/// `walkLegacyD2I`: a v99 stash tab, read only.
pub fn walk_legacy_d2i(buffer: &[u8], gd: &GameData) -> Result<StashReport> {
    walk_sectors(buffer, gd, true, Mode::Count)
}

/// The v99 walker when byte 8 holds 99, the v105 walker otherwise; `details` keeps item details.
pub(crate) fn walk_version(buffer: &[u8], gd: &GameData, details: bool) -> Result<StashReport> {
    let mode = if details { Mode::Details } else { Mode::Count };
    walk_sectors(buffer, gd, u32_lenient(buffer, 8) == 99, mode)
}

/// `detectFormat(buffer.subarray(offset))` sees a v105 `.d2i` (a 105 at offset 4 would make it a d2s).
fn is_d2i_sector(buffer: &[u8], offset: usize, legacy: bool) -> bool {
    let u32_at = |i: usize| u32_lenient(buffer, offset + i);
    u32_at(0) == D2S_MAGIC
        && if legacy {
            u32_at(8) == 99
        } else {
            u32_at(4) != 105 && u32_at(8) == 105
        }
}

pub(crate) fn walk_sectors(buffer: &[u8], gd: &GameData, legacy: bool, mode: Mode) -> Result<StashReport> {
    let len = buffer.len() as u64;
    let mut sectors = Vec::new();
    let mut offset = 0u64;
    let mut stopped = false;
    while offset < len {
        if offset + SECTOR_HEADER_SIZE > len || !is_d2i_sector(buffer, offset as usize, legacy) {
            stopped = true;
            break;
        }
        let o = offset as usize;
        let gold = u32_lenient(buffer, o + 12);
        let size = u32_lenient(buffer, o + 16) as u64;
        let kind = buffer[o + 20];
        if size < SECTOR_HEADER_SIZE {
            stopped = true;
            break;
        }
        let walk = if kind != 2 {
            Some(walk_item_list(
                buffer,
                o + SECTOR_HEADER_SIZE as usize,
                gd,
                legacy,
                1,
                Some(offset + size),
                mode,
                Section::Tab(kind),
            )?)
        } else {
            None
        };
        sectors.push(StashSector {
            offset,
            size,
            kind,
            gold,
            walk,
        });
        offset += size;
    }
    Ok(StashReport {
        sectors,
        reached_eof: !stopped,
    })
}

/// `walkItemList` from `header_offset`; the list may read past the sector, `complete` says if it did.
#[allow(clippy::too_many_arguments)]
pub(crate) fn walk_item_list(
    buffer: &[u8],
    header_offset: usize,
    gd: &GameData,
    legacy: bool,
    first_id: u32,
    expected_end: Option<u64>,
    mode: Mode,
    section: Section,
) -> Result<StashWalk> {
    if header_offset + 4 > buffer.len() {
        return Err(Error::new(
            ErrorKind::Overrun,
            format!(
                "item list header at byte {header_offset} runs past the end of a {}-byte buffer",
                buffer.len()
            ),
        ));
    }
    if buffer[header_offset] != 0x4a || buffer[header_offset + 1] != 0x4d {
        return Err(Error::new(
            ErrorKind::Parse,
            format!("no \"JM\" item list header at byte {header_offset}"),
        ));
    }
    let mut parser = if mode == Mode::Full {
        Parser::full(buffer, gd, legacy, first_id, 0)
    } else {
        Parser::new(buffer, gd, legacy, mode == Mode::Details)
    };
    parser.section = section;
    parser.r.seek(header_offset);
    let mut entries = Vec::new();
    let report = parser.parse_item_list(|parsed| entries.push(parsed.item))?;
    let complete =
        report.parsed == report.declared && !report.error && expected_end.is_none_or(|e| report.end_offset as u64 == e);
    Ok(StashWalk {
        report,
        complete,
        entries,
        details: parser.details.unwrap_or_default(),
        copies: parser.copies.unwrap_or_default(),
        counts: parser.counts.unwrap_or_default(),
        full: parser.full.unwrap_or_default(),
    })
}

/// A page of `readD2I` (`D2IStashPage`); extended sectors give three.
pub(crate) struct StashPage {
    /// `pageType`: the sector type, or `gems` / `runes` / `misc` for the pages of an extended sector.
    pub page_type: PageType,
    pub gold: u32,
    /// `stash[slot] = id` in handler order.
    pub stash: Vec<(u32, Ref)>,
    pub quantities: Quantities,
    /// `rows` of the misc page.
    pub rows: Option<u32>,
    pub offset: u64,
    pub sector_size: u64,
    /// Index of the sector whose list the page shares.
    pub sector: usize,
    pub raw_type: u8,
}

pub(crate) enum PageType {
    Raw(u8),
    Gems,
    Runes,
    Misc,
}

pub(crate) enum Quantities {
    None,
    /// `gemQty` / `runeQty`, one per stash entry.
    List(Vec<u32>),
    /// `miscQty[slot]`.
    Slots(Vec<(u32, u32)>),
}

/// `D2ISectorSummary`.
pub(crate) struct SectorSummary {
    pub offset: u64,
    pub size: u64,
    pub kind: u8,
    pub gold: u32,
    pub list: Option<ListReport>,
}

/// `D2IReadResult`.
pub(crate) struct StashRead {
    pub items: Vec<FullItem>,
    pub pages: Vec<StashPage>,
    pub sectors: Vec<SectorSummary>,
    pub warnings: Vec<String>,
    pub tiled: bool,
    pub reached_eof: bool,
}

/// `readD2I`: each sector parsed through its own subarray, extended sectors split into gems, runes and a
/// packed misc grid.
pub(crate) fn read_d2i(buffer: &[u8], gd: &GameData) -> StashRead {
    let len = buffer.len() as u64;
    let mut out = StashRead {
        items: Vec::new(),
        pages: Vec::new(),
        sectors: Vec::new(),
        warnings: Vec::new(),
        tiled: false,
        reached_eof: false,
    };
    let mut offset = 0u64;
    let mut next_id = 1u32;
    let mut stopped = false;
    while offset < len {
        if offset + SECTOR_HEADER_SIZE > len || !is_d2i_sector(buffer, offset as usize, false) {
            stopped = true;
            break;
        }
        let o = offset as usize;
        let gold = u32_lenient(buffer, o + 12);
        let size = u32_lenient(buffer, o + 16) as u64;
        let kind = buffer[o + 20];
        // A sector smaller than its header would never advance the loop.
        if size < SECTOR_HEADER_SIZE {
            out.warnings.push(format!(
                "Malformed D2I page at offset {offset}: sectorSize {size} < {SECTOR_HEADER_SIZE}; stopping parse."
            ));
            stopped = true;
            break;
        }
        let sector = out.sectors.len();
        out.sectors.push(SectorSummary {
            offset,
            size,
            kind,
            gold,
            list: None,
        });
        if kind == 2 {
            offset += size;
            continue;
        }

        let mut p = Parser::full(&buffer[o..], gd, false, next_id, o);
        p.r.seek(SECTOR_HEADER_SIZE as usize);
        let page = out.pages.len();
        let label = if kind == 1 { " (extended)" } else { "" };
        // (slot, reference, quantity, base) of every item the handler is called with in the stash.
        let mut seen: Vec<(u32, Ref, u32, [u8; 3])> = Vec::new();
        let parsed_list = p.parse_item_list(|parsed| {
            let emit = emit_of(
                parsed.location,
                parsed.bodyloc,
                parsed.col,
                parsed.row,
                parsed.storage,
                gd.stash_columns,
            );
            if let (Some(Emit::Stash(slot)), Some(reference)) = (emit, parsed.reference()) {
                seen.push((slot, reference, parsed.item.quantity.unwrap_or(0), parsed.item.code));
            }
        });
        match parsed_list {
            Ok(list) => {
                if list.error {
                    out.warnings.push(format!(
                        "Stash page {page}{label}: item list truncated: {}",
                        list_error(&list)
                    ));
                }
                out.sectors[sector].list = Some(list);
            }
            Err(error) => out
                .warnings
                .push(format!("Stash page {page}{label} parsing error: {error}")),
        }
        let items = p.full.take().unwrap_or_default();
        // The next sector numbers from the highest registered numeric id so far.
        let highest = items.iter().filter_map(|i| match i.key {
            Some(Ref::Num(id)) => Some(id + 1),
            _ => None,
        });
        next_id = highest.fold(next_id, u32::max);
        out.items.extend(items);

        if kind == 1 {
            let (mut gems, mut runes, mut misc) = (Vec::new(), Vec::new(), Vec::new());
            for (_, reference, quantity, code) in seen {
                if quantity == 0 {
                    continue;
                }
                let info = gd.base(gd.base_of(code));
                match info.page {
                    Page::Gem => gems.push((reference, quantity)),
                    Page::Rune => runes.push((reference, quantity)),
                    Page::Misc => misc.push((reference, quantity, info.inv_width, info.inv_height)),
                }
            }
            // Misc items packed into a 10-column grid by their sizes.
            const COLUMNS: u32 = 10;
            let mut occupied = HashSet::new();
            let mut misc_stash = Vec::new();
            let mut misc_quantities = Vec::new();
            let mut max_row = 0;
            for &(reference, quantity, w, h) in &misc {
                let mut slot = 0u32;
                loop {
                    let (x, y) = (slot % COLUMNS, slot / COLUMNS);
                    let fits = x + w <= COLUMNS
                        && (0..h).all(|dy| (0..w).all(|dx| !occupied.contains(&((y + dy) * COLUMNS + x + dx))));
                    if fits {
                        misc_stash.push((slot, reference));
                        misc_quantities.push((slot, quantity));
                        for dy in 0..h {
                            for dx in 0..w {
                                occupied.insert((y + dy) * COLUMNS + x + dx);
                                max_row = max_row.max(y + dy);
                            }
                        }
                        break;
                    }
                    slot += 1;
                }
            }
            let dense = |list: Vec<(Ref, u32)>| -> (Vec<(u32, Ref)>, Quantities) {
                let quantities = list.iter().map(|e| e.1).collect();
                let stash = list.into_iter().enumerate().map(|(i, e)| (i as u32, e.0)).collect();
                (stash, Quantities::List(quantities))
            };
            let page_of = |page_type, gold, (stash, quantities), rows| StashPage {
                page_type,
                gold,
                stash,
                quantities,
                rows,
                offset,
                sector_size: size,
                sector,
                raw_type: 1,
            };
            out.pages.push(page_of(PageType::Gems, gold, dense(gems), None));
            out.pages.push(page_of(PageType::Runes, 0, dense(runes), None));
            let rows = if misc.is_empty() { 1 } else { max_row + 1 };
            let misc_page = (misc_stash, Quantities::Slots(misc_quantities));
            out.pages.push(page_of(PageType::Misc, 0, misc_page, Some(rows)));
        } else {
            out.pages.push(StashPage {
                page_type: PageType::Raw(kind),
                gold,
                stash: seen
                    .into_iter()
                    .map(|(slot, reference, ..)| (slot, reference))
                    .collect(),
                quantities: Quantities::None,
                rows: None,
                offset,
                sector_size: size,
                sector,
                raw_type: kind,
            });
        }

        offset += size;
    }
    out.reached_eof = !stopped;
    out.tiled = !out.sectors.is_empty() && offset == len && !stopped;
    out
}
