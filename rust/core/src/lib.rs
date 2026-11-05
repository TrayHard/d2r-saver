//! Read path of d2r-saver (`src/core/binary-reader.ts`, `src/formats/item-parser.ts`,
//! `src/formats/d2s-reader.ts`, `src/formats/item-walker.ts`) with `resolveMods: false`, plus the
//! item counting of the BGS item index (`ItemIndex/src/items.mjs`) and the rows of its item table
//! (`details`).
//!
//! Every read happens in the same order and fails at the same bit as the TypeScript reader, so a
//! save that is cut short or desynchronised stops at the same place and leaves the same partial
//! result. The affix solver is not ported: nothing it computes is read from the bits.

mod bits;
mod character;
mod count;
mod data;
mod details;
mod item;
mod stash;

pub use bits::BitReader;
pub use character::{read_d2s, read_legacy_d2s, Character, Slot};
pub use count::{character_items, character_status, item_name, stash_tab_items, CharacterCounts, Counts};
pub use data::GameData;
pub use details::{character_details, stash_tab_details, CharacterDetails, DetailRow, TabDetails};
pub use item::{Item, ItemCopy, ItemDetail, ListReport, SimpleCounts};
pub use stash::{walk_d2i, walk_legacy_d2i, StashReport, StashSector, StashWalk};

/// A read that failed. The TypeScript reader throws in the same places; the message is for logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Error(pub &'static str);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// Version of this crate, for logs of the programs that read saves with it.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub(crate) const OVERRUN: Error = Error("buffer overrun");
/// `0xaa55aa55`, the first four bytes of every `.d2s` and of every `.d2i` sector.
pub(crate) const D2S_MAGIC: u32 = 0xaa55_aa55;

/// Little-endian u32 that reads missing bytes as 0, like `bytes[i] | …` on a short JS array.
pub(crate) fn u32_lenient(bytes: &[u8], offset: usize) -> u32 {
    (0..4).fold(0, |v, i| v | (*bytes.get(offset + i).unwrap_or(&0) as u32) << (8 * i))
}
