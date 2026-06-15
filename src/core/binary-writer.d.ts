/**
 * BitWriter — bit-level writer for D2R save files (Blizzless v105).
 *
 * Ported from d2planner/src/logic/binary/writer.js.
 * Stores individual bits in an expanded Uint8Array (1 bit per byte),
 * then packs them on `toArray()`.
 *
 * Also provides Huffman character writing via `writeChar()`.
 */
export declare class BitWriter {
    /** Expanded bit storage: each byte holds 0 or 1. */
    private bits;
    /** Current write/seek offset in bits. */
    offset: number;
    /** High-water mark — total bit length. */
    length: number;
    constructor(capacity?: number);
    /** Write a single bit (0 or 1). */
    writeBit(value: number | boolean): this;
    /** Write an array of bits (expanded form: each element is 0 or 1). */
    writeBits(bitsArray: ArrayLike<number>, numberOfBits: number): this;
    /** Write raw bytes, optionally limiting to `numberOfBits` bits. */
    writeBytes(bytes: ArrayLike<number>, numberOfBits?: number): this;
    /** Alias for `writeBytes`. */
    writeArray(bytes: ArrayLike<number>, numberOfBits: number): this;
    /** Write an unsigned 8-bit value. */
    writeUInt8(value: number, numberOfBits?: number): this;
    /** Write an unsigned 16-bit value (little-endian). */
    writeUInt16(value: number, numberOfBits?: number): this;
    /** Write an unsigned 32-bit value (little-endian). */
    writeUInt32(value: number, numberOfBits?: number): this;
    /** Write a UTF-8 string, padded/truncated to `numberOfBytes` bytes. */
    writeString(value: string, numberOfBytes: number): this;
    /** Write `bits` bits of `value` in MSB-first order. */
    writeBitsNumber(value: number, bits: number): this;
    /** Write one Huffman-encoded character (for item type codes). */
    writeChar(ch: string): this;
    /** Seek to an absolute bit offset. */
    seekBit(offset: number): this;
    /** Seek to an absolute byte offset. */
    seekByte(offset: number): this;
    /** Peek at `count` packed bytes starting from current offset (does NOT advance). */
    peekBytes(count: number): Uint8Array;
    /** Align offset to next byte boundary (skip forward). */
    align(): this;
    /** Pack expanded bit storage into a compact Uint8Array. */
    toArray(): Uint8Array;
}
//# sourceMappingURL=binary-writer.d.ts.map