//! Port of `src/core/binary-reader.ts` and the Huffman decode of `src/core/huffman.ts`.
//!
//! Reads are bounds-checked exactly like the TypeScript reader: a read needing bits past the end
//! fails without moving the cursor, with the same message; `seek`, `skip`, `skip_bits` and `align`
//! never check.

use crate::{Error, ErrorKind, Result};
use std::sync::OnceLock;

pub struct BitReader<'a> {
    buf: &'a [u8],
    /// Cursor in bits.
    pub pos: usize,
}

/// Item-code alphabet as (symbol, code, length), codes LSB-first like `HUFFMAN_LOOKUP`.
const HUFFMAN: [(u8, u32, u32); 38] = [
    (b'0', 223, 8),
    (b'1', 31, 7),
    (b'2', 12, 6),
    (b'3', 91, 7),
    (b'4', 95, 8),
    (b'5', 104, 8),
    (b'6', 123, 7),
    (b'7', 30, 5),
    (b'8', 8, 6),
    (b'9', 14, 5),
    (b' ', 1, 2),
    (b'a', 15, 5),
    (b'b', 10, 4),
    (b'c', 2, 5),
    (b'd', 35, 6),
    (b'e', 3, 6),
    (b'f', 50, 6),
    (b'g', 11, 5),
    (b'h', 24, 5),
    (b'i', 63, 7),
    (b'j', 232, 9),
    (b'k', 18, 6),
    (b'l', 23, 5),
    (b'm', 22, 5),
    (b'n', 44, 6),
    (b'o', 127, 7),
    (b'p', 19, 5),
    (b'q', 155, 8),
    (b'r', 7, 5),
    (b's', 4, 4),
    (b't', 6, 5),
    (b'u', 16, 5),
    (b'v', 59, 7),
    (b'w', 0, 5),
    (b'x', 28, 5),
    (b'y', 40, 7),
    (b'z', 27, 8),
    // The tree node `["j"]` has no child 1; no code ends there.
    (DEAD_BRANCH, 232 | 256, 9),
];

/// Table marker for the dead branch of the tree; `code_char` fails on it.
const DEAD_BRANCH: u8 = 0xFF;

/// 9-bit LSB-first window → (symbol, code length).
fn huffman_table() -> &'static [(u8, u8); 512] {
    static TABLE: OnceLock<[(u8, u8); 512]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [(0u8, 0u8); 512];
        for &(sym, code, len) in &HUFFMAN {
            for ext in 0..(1u32 << (9 - len)) {
                let slot = &mut table[(code | (ext << len)) as usize];
                assert_eq!(slot.1, 0, "Huffman codes overlap");
                *slot = (sym, len as u8);
            }
        }
        assert!(table.iter().all(|e| e.1 != 0), "Huffman table has a gap");
        table
    })
}

impl<'a> BitReader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    /// Length of the buffer in bytes.
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    #[inline]
    fn ensure_at(&self, at: usize, count: usize) -> Result<()> {
        if at + count > self.buf.len() * 8 {
            Err(Error::overrun(count, at, self.buf.len()))
        } else {
            Ok(())
        }
    }

    /// Checks that `count` bits can be read at the cursor (the JS `ensure`).
    #[inline]
    pub fn ensure(&self, count: usize) -> Result<()> {
        self.ensure_at(self.pos, count)
    }

    /// Byte at the cursor's byte, ignoring the bit offset, like the JS `read8`.
    pub fn read8(&mut self) -> Result<u32> {
        self.ensure(8)?;
        let v = self.buf[self.pos >> 3] as u32;
        self.pos += 8;
        Ok(v)
    }

    pub fn read16(&mut self) -> Result<u32> {
        self.ensure(16)?;
        let i = self.pos >> 3;
        self.pos += 16;
        Ok(self.buf[i] as u32 | (self.buf[i + 1] as u32) << 8)
    }

    pub fn read32(&mut self) -> Result<u32> {
        self.ensure(32)?;
        let i = self.pos >> 3;
        self.pos += 32;
        Ok(u32::from_le_bytes([
            self.buf[i],
            self.buf[i + 1],
            self.buf[i + 2],
            self.buf[i + 3],
        ]))
    }

    /// Peeks the byte `offset` bytes after the cursor's byte.
    pub fn byte(&self, offset: usize) -> Result<u8> {
        let i = (self.pos >> 3) + offset;
        self.ensure_at(i << 3, 8)?;
        Ok(self.buf[i])
    }

    pub fn seek(&mut self, byte: usize) {
        self.pos = byte << 3;
    }

    pub fn skip(&mut self, bytes: usize) {
        self.pos += bytes << 3;
    }

    pub fn skip_bits(&mut self, count: usize) {
        self.pos += count;
    }

    pub fn align(&mut self) {
        self.pos = (self.pos + 7) & !7;
    }

    pub fn eof(&self) -> bool {
        self.pos >= self.buf.len() * 8
    }

    /// `count` bits LSB-first, `count <= 32` (the widest field in the game data), unsigned.
    #[inline]
    pub fn bits(&mut self, count: u32) -> Result<u32> {
        debug_assert!(count <= 32);
        self.ensure(count as usize)?;
        Ok(self.bits_unchecked(count))
    }

    /// `bits` as the JS reader returns it: an int32, so a 32-bit field with its top bit set is negative.
    #[inline]
    pub fn bits_js(&mut self, count: u32) -> Result<i64> {
        let value = self.bits(count)?;
        Ok(if count == 32 { value as i32 as i64 } else { value as i64 })
    }

    /// `count` bits where the JS reader skips them unchecked: bits past the end read as 0.
    #[inline]
    pub fn bits_unchecked(&mut self, count: u32) -> u32 {
        if count == 0 {
            return 0;
        }
        let byte = self.pos >> 3;
        let window = if byte + 8 <= self.buf.len() {
            u64::from_le_bytes(self.buf[byte..byte + 8].try_into().unwrap())
        } else {
            self.buf
                .get(byte..)
                .unwrap_or(&[])
                .iter()
                .rev()
                .fold(0u64, |v, &b| v << 8 | b as u64)
        };
        let value = (window >> (self.pos & 7)) & ((1u64 << count) - 1);
        self.pos += count as usize;
        value as u32
    }

    /// Bytes `[start, end)` of the buffer, cut at its end.
    pub fn slice(&self, start: usize, end: usize) -> &'a [u8] {
        self.buf.get(start..end.min(self.buf.len())).unwrap_or(&[])
    }

    /// `utf8(length)`: a NUL-terminated UTF-8 field of `length` bytes, decoded like `TextDecoder`.
    pub fn utf8(&mut self, length: usize) -> Result<String> {
        self.ensure(length << 3)?;
        let start = self.pos >> 3;
        let field = &self.buf[start..start + length];
        let end = field.iter().position(|&b| b == 0).unwrap_or(length);
        self.pos = (start + length) << 3;
        Ok(decode_utf8(&field[..end]))
    }

    /// One Huffman-coded item-code character; the dead branch is an invalid item code, after its
    /// 9 bits like the JS walk.
    #[inline]
    pub fn code_char(&mut self) -> Result<u8> {
        if self.pos + 9 <= self.buf.len() * 8 {
            let byte = self.pos >> 3;
            let window = self.buf[byte] as u32 | (*self.buf.get(byte + 1).unwrap_or(&0) as u32) << 8;
            let (sym, len) = huffman_table()[((window >> (self.pos & 7)) & 511) as usize];
            self.pos += len as usize;
            return if sym == DEAD_BRANCH {
                Err(self.dead_branch())
            } else {
                Ok(sym)
            };
        }
        // Near the end, bit by bit, so an overrun leaves the cursor where the JS walk stops.
        let mut path = 0u32;
        for depth in 0..9 {
            path |= self.bits(1)? << depth;
            if let Some(&(sym, _, _)) = HUFFMAN.iter().find(|e| e.2 == depth + 1 && e.1 == path) {
                return if sym == DEAD_BRANCH {
                    Err(self.dead_branch())
                } else {
                    Ok(sym)
                };
            }
        }
        unreachable!("Huffman table is complete")
    }

    /// The JS walk throws after reading the bit that leads nowhere.
    fn dead_branch(&self) -> Error {
        Error::new(
            ErrorKind::Parse,
            format!("invalid item code: empty Huffman branch at bit {}", self.pos - 1),
        )
    }
}

/// `new TextDecoder('utf-8').decode(bytes)`: a leading BOM is dropped, invalid sequences become U+FFFD.
pub(crate) fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lsb_first_and_fails_without_moving() {
        let mut r = BitReader::new(&[0b1010_1101, 0xFF]);
        assert_eq!(r.bits(3).unwrap(), 0b101);
        assert_eq!(r.bits(7).unwrap(), 0b11_10101);
        let error = r.bits(7).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Overrun);
        assert_eq!(
            error.message,
            "buffer overrun: reading 7 bit(s) at bit 10 (byte 1) past the end of a 2-byte buffer"
        );
        assert_eq!(r.pos, 10);
        assert_eq!(r.bits(6).unwrap(), 0b11_1111);
        r.skip_bits(5);
        // A zero-width read past the end fails too, like the JS `ensure`.
        assert_eq!(r.bits(0).unwrap_err().kind, ErrorKind::Overrun);
    }

    #[test]
    fn reads_32_bits_as_an_int32_and_unchecked_bits_as_zero() {
        let mut r = BitReader::new(&[0xFF, 0xFF, 0xFF, 0xFF, 0x01]);
        assert_eq!(r.bits_js(32).unwrap(), -1);
        assert_eq!(r.bits_unchecked(12), 1);
        assert_eq!(r.pos, 44);
    }

    #[test]
    fn decodes_utf8_like_text_decoder() {
        assert_eq!(decode_utf8(b"\xEF\xBB\xBFab"), "ab");
        assert_eq!(decode_utf8(b"a\xFFb"), "a\u{FFFD}b");
    }

    #[test]
    fn decodes_every_code_on_both_paths() {
        huffman_table();
        for &(sym, code, len) in &HUFFMAN {
            let wide = [(code & 0xFF) as u8, (code >> 8) as u8, 0, 0];
            let short = &wide[..(len as usize).div_ceil(8)];
            let mut r = BitReader::new(short);
            if sym == DEAD_BRANCH {
                let message = "invalid item code: empty Huffman branch at bit 8";
                assert_eq!(BitReader::new(&wide).code_char().unwrap_err().message, message);
                assert_eq!(r.code_char().unwrap_err().message, message);
            } else {
                assert_eq!(BitReader::new(&wide).code_char().unwrap(), sym);
                assert_eq!(r.code_char().unwrap(), sym);
            }
            assert_eq!(r.pos, len as usize);
        }
    }
}
