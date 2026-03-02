import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/core/binary-reader.js';

describe('BinaryReader', () => {
  describe('byte-aligned reads', () => {
    it('read8 reads a single byte', () => {
      const reader = new BinaryReader(new Uint8Array([0x42, 0xff]));
      expect(reader.read8()).toBe(0x42);
      expect(reader.read8()).toBe(0xff);
      expect(reader.bitpos).toBe(16);
    });

    it('read16 reads little-endian 16-bit', () => {
      // 0x01 | (0x02 << 8) = 0x0201 = 513
      const reader = new BinaryReader(new Uint8Array([0x01, 0x02]));
      expect(reader.read16()).toBe(0x0201);
    });

    it('read32 reads little-endian 32-bit unsigned', () => {
      // 0x55 | (0xAA << 8) | (0x55 << 16) | (0xAA << 24) >>> 0
      const reader = new BinaryReader(new Uint8Array([0x55, 0xaa, 0x55, 0xaa]));
      expect(reader.read32()).toBe(0xaa55aa55);
    });

    it('read32 returns unsigned for values > 0x7FFFFFFF', () => {
      const reader = new BinaryReader(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
      expect(reader.read32()).toBe(0xffffffff);
    });
  });

  describe('byte peek', () => {
    it('byte() peeks without advancing', () => {
      const reader = new BinaryReader(new Uint8Array([0x10, 0x20, 0x30]));
      expect(reader.byte(0)).toBe(0x10);
      expect(reader.byte(1)).toBe(0x20);
      expect(reader.byte(2)).toBe(0x30);
      expect(reader.bitpos).toBe(0);
    });
  });

  describe('string reads', () => {
    it('string reads ASCII up to NUL', () => {
      const data = new Uint8Array([0x48, 0x69, 0x00, 0x00]); // "Hi\0\0"
      const reader = new BinaryReader(data);
      expect(reader.string(4)).toBe('Hi');
      expect(reader.bitpos).toBe(32); // advances full length
    });

    it('string reads ASCII without NUL in range', () => {
      const data = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
      const reader = new BinaryReader(data);
      expect(reader.string(3)).toBe('ABC');
    });

    it('utf8 reads UTF-8 encoded string', () => {
      const encoder = new TextEncoder();
      const encoded = encoder.encode('Привет');
      const padded = new Uint8Array(encoded.length + 2);
      padded.set(encoded);
      const reader = new BinaryReader(padded);
      expect(reader.utf8(padded.length)).toBe('Привет');
    });
  });

  describe('positioning', () => {
    it('seek jumps to absolute byte position', () => {
      const reader = new BinaryReader(new Uint8Array(100));
      reader.seek(10);
      expect(reader.bitpos).toBe(80);
    });

    it('skip advances by N bytes', () => {
      const reader = new BinaryReader(new Uint8Array(100));
      reader.skip(5);
      expect(reader.bitpos).toBe(40);
    });

    it('align rounds up to next byte boundary', () => {
      const reader = new BinaryReader(new Uint8Array(100));
      reader.bitpos = 3;
      reader.align();
      expect(reader.bitpos).toBe(8);
    });

    it('align is no-op when already aligned', () => {
      const reader = new BinaryReader(new Uint8Array(100));
      reader.bitpos = 16;
      reader.align();
      expect(reader.bitpos).toBe(16);
    });
  });

  describe('bit-level reads', () => {
    it('bit reads individual bits LSB-first', () => {
      // byte 0b10110010 = 0xB2
      const reader = new BinaryReader(new Uint8Array([0xb2]));
      expect(reader.bit()).toBe(0); // bit 0
      expect(reader.bit()).toBe(1); // bit 1
      expect(reader.bit()).toBe(0); // bit 2
      expect(reader.bit()).toBe(0); // bit 3
      expect(reader.bit()).toBe(1); // bit 4
      expect(reader.bit()).toBe(1); // bit 5
      expect(reader.bit()).toBe(0); // bit 6
      expect(reader.bit()).toBe(1); // bit 7
    });

    it('bits reads N bits as LE unsigned', () => {
      // 0xFF → read 4 bits → 0x0F
      const reader = new BinaryReader(new Uint8Array([0xff]));
      expect(reader.bits(4)).toBe(0x0f);
      expect(reader.bits(4)).toBe(0x0f);
    });

    it('bits reads across byte boundaries', () => {
      // bytes: [0b10110010, 0b11001010]
      // read 12 bits starting at bit 0:
      //   byte0 bits[0..7] = 0b10110010 → value = 0xB2
      //   byte1 bits[0..3] = 0b1010 → value = 0x0A
      //   combined = 0xAB2
      const reader = new BinaryReader(new Uint8Array([0xb2, 0xca]));
      expect(reader.bits(12)).toBe(0xab2);
    });

    it('skipbits skips given number of bits', () => {
      const reader = new BinaryReader(new Uint8Array(10));
      reader.skipbits(13);
      expect(reader.bitpos).toBe(13);
    });
  });

  describe('huffman', () => {
    it('char decodes a space (shortest code: 2 bits)', () => {
      // Space is HUFFMAN_LOOKUP[' '] = { v: 1, l: 2 }
      // Bits: LSB-first: [1, 0] → travels tree[1] → ' '
      const reader = new BinaryReader(new Uint8Array([0b01])); // bit0=1, bit1=0
      expect(reader.char()).toBe(' ');
    });

    it('char decodes letter "s" (4 bits)', () => {
      // 's' = { v: 4, l: 4 } → binary 0100 → LSB-first bits [0,0,1,0]
      // Navigate tree: [0] → [0] → [1] → [0] → "s"
      const reader = new BinaryReader(new Uint8Array([0b00000100]));
      expect(reader.char()).toBe('s');
    });
  });

  describe('eof', () => {
    it('eof returns true when buffer consumed', () => {
      const reader = new BinaryReader(new Uint8Array([0x01]));
      expect(reader.eof()).toBe(false);
      reader.read8();
      expect(reader.eof()).toBe(true);
    });
  });
});
