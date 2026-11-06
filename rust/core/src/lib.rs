//! Read path of d2r-saver: `.d2s` characters and `.d2i` shared stashes of Blizzless D2R v105 and
//! legacy v99, read bit for bit like the TypeScript reader without its affix solver.
//!
//! The documents of `doc` hold everything the TypeScript readers return (`readD2S`,
//! `readLegacyD2S`, `readD2I`, `walkItemList`, `walkD2I`, `walkLegacyD2I`, `readItemHead`) as JSON;
//! the npm package reads every save through them. Counting (`count`) and the rows of the BGS item
//! index (`details`) read the same bits without building documents.
//!
//! Every read happens in the same order and fails at the same bit, with the same message, as the
//! TypeScript reader, so a save that is cut short or desynchronised stops at the same place and
//! leaves the same partial result. The affix solver is not ported: nothing it computes is read from
//! the bits.

mod bits;
mod character;
mod count;
mod data;
mod details;
pub mod doc;
mod item;
mod json;
mod stash;

pub use bits::BitReader;
pub use character::{read_d2s, read_legacy_d2s, Character, Slot};
pub use count::{character_items, character_status, item_name, stash_tab_items, CharacterCounts, Counts};
pub use data::GameData;
pub use details::{character_details, stash_tab_details, CharacterDetails, DetailRow, TabDetails};
pub use item::{Item, ItemCopy, ItemDetail, ListReport, SimpleCounts};
pub use stash::{walk_d2i, walk_legacy_d2i, StashReport, StashSector, StashWalk};

use std::borrow::Cow;

/// How the TypeScript reader throws an error: the class and code a caller can tell apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// A plain `Error`.
    Plain,
    /// `D2RSaverError` with `BUFFER_OVERRUN`: a read past the end of the buffer.
    Overrun,
    /// `D2RSaverError` with `PARSE_ERROR`.
    Parse,
    /// `D2RSaverError` with `INVALID_ARGUMENT`.
    InvalidArgument,
}

/// A read that failed, with the message the TypeScript reader throws at the same place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: Cow<'static, str>,
}

impl Error {
    pub(crate) const fn plain(message: &'static str) -> Self {
        Error {
            kind: ErrorKind::Plain,
            message: Cow::Borrowed(message),
        }
    }

    pub(crate) fn new(kind: ErrorKind, message: impl Into<Cow<'static, str>>) -> Self {
        Error {
            kind,
            message: message.into(),
        }
    }

    /// `BinaryReader.ensure`: `count` bits at bit `at` of a `len`-byte buffer.
    pub(crate) fn overrun(count: usize, at: usize, len: usize) -> Self {
        Error::new(
            ErrorKind::Overrun,
            format!(
                "buffer overrun: reading {count} bit(s) at bit {at} (byte {}) past the end of a {len}-byte buffer",
                at >> 3
            ),
        )
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// Version of this crate, for logs of the programs that read saves with it.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// `0xaa55aa55`, the first four bytes of every `.d2s` and of every `.d2i` sector.
pub(crate) const D2S_MAGIC: u32 = 0xaa55_aa55;

/// Little-endian u32 that reads missing bytes as 0, like `bytes[i] | …` on a short JS array.
pub(crate) fn u32_lenient(bytes: &[u8], offset: usize) -> u32 {
    (0..4).fold(0, |v, i| v | (*bytes.get(offset + i).unwrap_or(&0) as u32) << (8 * i))
}
