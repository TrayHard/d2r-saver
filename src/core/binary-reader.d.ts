/**
 * BinaryReader — bit-level reader for D2R save files (Blizzless v105).
 *
 * Ported from d2planner/src/logic/binary/reader.js.
 * Supports byte-aligned reads, arbitrary-width bit reads,
 * and Huffman-decoded character reads for item codes.
 */
export declare class BinaryReader {
    /** Current position in bits */
    bitpos: number;
    /** Underlying raw buffer */
    readonly buffer: Uint8Array;
    constructor(buffer: Uint8Array);
    /** Read unsigned 8-bit integer (byte-aligned). */
    read8(): number;
    /** Read unsigned 16-bit integer, little-endian (byte-aligned). */
    read16(): number;
    /** Read unsigned 32-bit integer, little-endian (byte-aligned). */
    read32(): number;
    /** Peek at a byte at relative offset from current byte position (does NOT advance). */
    byte(offset: number): number;
    /** Read a fixed-length ASCII string, stopping at the first NUL. */
    string(length: number): string;
    /** Read a fixed-length UTF-8 string, stopping at the first NUL. */
    utf8(length: number): string;
    /** Seek to an absolute byte position. */
    seek(pos: number): void;
    /** Skip forward by `bytes` bytes. */
    skip(bytes: number): void;
    /** Align to the next byte boundary. */
    align(): void;
    /** Read `count` bits as little-endian unsigned integer. */
    bits(count: number): number;
    /** Read a single bit (0 or 1). */
    bit(): number;
    /** Skip forward by `count` bits. */
    skipbits(count: number): void;
    /** Read one Huffman-encoded character (for item type codes). */
    char(): string;
    /** Returns true when the reader has consumed the entire buffer. */
    eof(): boolean;
}
//# sourceMappingURL=binary-reader.d.ts.map