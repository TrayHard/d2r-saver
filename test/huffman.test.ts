import { describe, it, expect } from 'vitest';
import {
  HUFFMAN_TREE,
  HUFFMAN_LOOKUP,
  type HuffmanNode,
} from '../src/core/huffman.js';
import { BinaryReader } from '../src/core/binary-reader.js';
import { BitWriter } from '../src/core/binary-writer.js';

/** All valid Huffman alphabet characters. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789 ';

describe('Huffman', () => {
  describe('HUFFMAN_TREE', () => {
    it('contains exactly 37 leaves', () => {
      const leaves = new Set<string>();
      function walk(node: HuffmanNode): void {
        if (typeof node === 'string') {
          leaves.add(node);
        } else {
          for (const child of node) walk(child);
        }
      }
      walk(HUFFMAN_TREE);
      expect(leaves.size).toBe(37);
    });

    it('contains all expected characters', () => {
      const leaves = new Set<string>();
      function walk(node: HuffmanNode): void {
        if (typeof node === 'string') leaves.add(node);
        else { for (const child of node) walk(child); }
      }
      walk(HUFFMAN_TREE);
      for (const ch of ALPHABET) {
        expect(leaves.has(ch)).toBe(true);
      }
    });
  });

  describe('HUFFMAN_LOOKUP', () => {
    it('has entries for all 37 characters', () => {
      expect(Object.keys(HUFFMAN_LOOKUP).length).toBe(37);
      for (const ch of ALPHABET) {
        expect(HUFFMAN_LOOKUP[ch]).toBeDefined();
      }
    });

    it('all entries have positive bit lengths', () => {
      for (const ch of ALPHABET) {
        const entry = HUFFMAN_LOOKUP[ch];
        expect(entry.l).toBeGreaterThan(0);
        expect(entry.l).toBeLessThanOrEqual(9);
      }
    });
  });

  describe('encode/decode roundtrip', () => {
    it('roundtrips all 37 characters individually', () => {
      for (const ch of ALPHABET) {
        const w = new BitWriter();
        // Write via lookup (same as writeChar)
        const entry = HUFFMAN_LOOKUP[ch];
        w.writeUInt16(entry.v, entry.l);
        const packed = w.toArray();
        const r = new BinaryReader(packed);
        expect(r.char()).toBe(ch);
      }
    });

    it('roundtrips multi-character item codes', () => {
      const codes = ['cap', 'mss', 'rin', 'r01', 'cm3', 'jew', '   '];
      for (const code of codes) {
        const w = new BitWriter();
        for (const c of code) {
          const entry = HUFFMAN_LOOKUP[c];
          w.writeUInt16(entry.v, entry.l);
        }
        const packed = w.toArray();
        const r = new BinaryReader(packed);
        const decoded = r.char() + r.char() + r.char();
        expect(decoded).toBe(code);
      }
    });

    it('roundtrips 4-char codes with trailing space', () => {
      const w = new BitWriter();
      const code = 'r01 ';
      for (const c of code) {
        const entry = HUFFMAN_LOOKUP[c];
        w.writeUInt16(entry.v, entry.l);
      }
      const packed = w.toArray();
      const r = new BinaryReader(packed);
      const decoded = r.char() + r.char() + r.char() + r.char();
      expect(decoded).toBe('r01 ');
    });
  });
});
