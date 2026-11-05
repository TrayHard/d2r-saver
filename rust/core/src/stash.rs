//! Port of `walkSectors` / `walkItemList` in `src/formats/item-walker.ts`: every sector of a
//! `.d2i` stash tab and the top-level items of each sector's `JM` list.

use crate::item::{Item, ItemCopy, ItemDetail, ListReport, Parser, Section};
use crate::{u32_lenient, Error, GameData, Result, D2S_MAGIC, OVERRUN};

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
}

pub struct StashSector {
    pub offset: u64,
    pub size: u64,
    /// 0 normal, 1 extended (materials), 2 metadata.
    pub kind: u8,
    /// `None` for a metadata sector.
    pub walk: Option<StashWalk>,
}

pub struct StashReport {
    pub sectors: Vec<StashSector>,
    /// The sector loop ran to the end of the buffer without stopping on an unrecognised sector.
    pub reached_eof: bool,
}

/// `walkD2I`: a v105 stash tab.
pub fn walk_d2i(buffer: &[u8], gd: &GameData) -> Result<StashReport> {
    walk_sectors(buffer, gd, false, false)
}

/// `walkLegacyD2I`: a v99 stash tab, read only.
pub fn walk_legacy_d2i(buffer: &[u8], gd: &GameData) -> Result<StashReport> {
    walk_sectors(buffer, gd, true, false)
}

/// The v99 walker when byte 8 holds 99, the v105 walker otherwise; `details` keeps item details.
pub(crate) fn walk_version(buffer: &[u8], gd: &GameData, details: bool) -> Result<StashReport> {
    walk_sectors(buffer, gd, u32_lenient(buffer, 8) == 99, details)
}

fn walk_sectors(buffer: &[u8], gd: &GameData, legacy: bool, details: bool) -> Result<StashReport> {
    let len = buffer.len() as u64;
    let mut sectors = Vec::new();
    let mut offset = 0u64;
    let mut stopped = false;
    while offset < len {
        if offset + SECTOR_HEADER_SIZE > len {
            stopped = true;
            break;
        }
        let o = offset as usize;
        let u32_at = |i: usize| u32_lenient(buffer, o + i);
        let recognised = if legacy {
            u32_at(0) == D2S_MAGIC && u32_at(8) == 99
        } else {
            // detectFormat: a 105 at offset 4 would make it a d2s, not a d2i.
            u32_at(0) == D2S_MAGIC && u32_at(4) != 105 && u32_at(8) == 105
        };
        if !recognised {
            stopped = true;
            break;
        }
        let size = u32_at(16) as u64;
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
                offset + size,
                details,
                kind,
            )?)
        } else {
            None
        };
        sectors.push(StashSector {
            offset,
            size,
            kind,
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
fn walk_item_list(
    buffer: &[u8],
    header_offset: usize,
    gd: &GameData,
    legacy: bool,
    expected_end: u64,
    details: bool,
    kind: u8,
) -> Result<StashWalk> {
    if header_offset + 4 > buffer.len() {
        return Err(OVERRUN);
    }
    if buffer[header_offset] != 0x4a || buffer[header_offset + 1] != 0x4d {
        return Err(Error("no JM item list header"));
    }
    let mut parser = Parser::new(buffer, gd, legacy, details);
    parser.section = Section::Tab(kind);
    parser.r.seek(header_offset);
    let mut entries = Vec::new();
    let report = parser.parse_item_list(|parsed| entries.push(parsed.item))?;
    let complete = report.parsed == report.declared && !report.error && report.end_offset as u64 == expected_end;
    Ok(StashWalk {
        report,
        complete,
        entries,
        details: parser.details.unwrap_or_default(),
        copies: parser.copies.unwrap_or_default(),
    })
}
