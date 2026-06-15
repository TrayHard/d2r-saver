/**
 * Huffman tree and lookup table for D2R item code encoding/decoding.
 *
 * Used in v105 (Blizzless) for 3-character item codes.
 * Alphabet: [a-z0-9 ] — 37 symbols.
 * Space (' ') is the most frequent (2 bits), 'j' is the rarest (9 bits).
 */
/**
 * Huffman decoding tree. Navigate by bit value (0=left, 1=right) until a string leaf is reached.
 * Note: some nodes have only one child (e.g. `["j"]`) — only bit 0 is valid there.
 */
export type HuffmanNode = [HuffmanNode, HuffmanNode] | [HuffmanNode] | string;
export declare const HUFFMAN_TREE: HuffmanNode;
/** Huffman encoding lookup: char → { v: bit pattern, l: bit length } */
export interface HuffmanEntry {
    /** Bit pattern value (little-endian) */
    readonly v: number;
    /** Number of bits */
    readonly l: number;
}
export declare const HUFFMAN_LOOKUP: Readonly<Record<string, HuffmanEntry>>;
//# sourceMappingURL=huffman.d.ts.map