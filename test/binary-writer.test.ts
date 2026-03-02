import { describe, it, expect } from 'vitest';
import { BitWriter } from '../src/core/binary-writer.js';
import { BinaryReader } from '../src/core/binary-reader.js';

describe('BitWriter', () => {
  describe('writeBit', () => {
    it('writes individual bits and packs correctly', () => {
      const w = new BitWriter();
      // Write 0b10110010 = 0xB2 (LSB first)
      w.writeBit(0);
      w.writeBit(1);
      w.writeBit(0);
      w.writeBit(0);
      w.writeBit(1);
      w.writeBit(1);
      w.writeBit(0);
      w.writeBit(1);
      const arr = w.toArray();
      expect(arr.length).toBe(1);
      expect(arr[0]).toBe(0xb2);
    });

    it('tracks length correctly', () => {
      const w = new BitWriter();
      w.writeBit(1);
      w.writeBit(0);
      w.writeBit(1);
      expect(w.length).toBe(3);
      expect(w.offset).toBe(3);
    });
  });

  describe('writeUInt8', () => {
    it('writes a full byte', () => {
      const w = new BitWriter();
      w.writeUInt8(0xab);
      const arr = w.toArray();
      expect(arr[0]).toBe(0xab);
    });

    it('writes partial bits', () => {
      const w = new BitWriter();
      w.writeUInt8(0xff, 4); // only 4 LSB bits
      const arr = w.toArray();
      expect(arr[0]).toBe(0x0f); // lower 4 bits are 1
    });
  });

  describe('writeUInt16', () => {
    it('writes little-endian 16-bit', () => {
      const w = new BitWriter();
      w.writeUInt16(0x1234);
      const arr = w.toArray();
      expect(arr[0]).toBe(0x34); // LE: low byte first
      expect(arr[1]).toBe(0x12);
    });

    it('writes partial 16-bit', () => {
      const w = new BitWriter();
      w.writeUInt16(0xffff, 12);
      expect(w.length).toBe(12);
      const arr = w.toArray();
      expect(arr[0]).toBe(0xff);
      expect(arr[1]).toBe(0x0f);
    });
  });

  describe('writeUInt32', () => {
    it('writes little-endian 32-bit', () => {
      const w = new BitWriter();
      w.writeUInt32(0xdeadbeef);
      const arr = w.toArray();
      expect(arr[0]).toBe(0xef);
      expect(arr[1]).toBe(0xbe);
      expect(arr[2]).toBe(0xad);
      expect(arr[3]).toBe(0xde);
    });
  });

  describe('writeString', () => {
    it('writes UTF-8 encoded string padded to length', () => {
      const w = new BitWriter();
      w.writeString('Hi', 4);
      const arr = w.toArray();
      expect(arr[0]).toBe(0x48); // 'H'
      expect(arr[1]).toBe(0x69); // 'i'
      expect(arr[2]).toBe(0x00); // pad
      expect(arr[3]).toBe(0x00); // pad
    });
  });

  describe('writeBitsNumber (MSB-first)', () => {
    it('writes value MSB-first', () => {
      const w = new BitWriter();
      // Write 0b101 in 3 bits MSB-first → bit sequence: 1, 0, 1
      w.writeBitsNumber(0b101, 3);
      // Packed into byte: bit0=1, bit1=0, bit2=1 → 0b101 = 5
      const arr = w.toArray();
      expect(arr[0]).toBe(0b00000101);
    });

    it('writes 8-bit value MSB-first', () => {
      const w = new BitWriter();
      // Write 0xA5 = 10100101 MSB-first 
      // bit sequence produced: 1,0,1,0,0,1,0,1
      // Packed LSB: bit0=1, bit1=0, bit2=1, bit3=0, bit4=0, bit5=1, bit6=0, bit7=1
      // = 0b10100101 = 0xA5
      w.writeBitsNumber(0xa5, 8);
      const arr = w.toArray();
      expect(arr[0]).toBe(0xa5);
    });
  });

  describe('writeChar (Huffman)', () => {
    it('writes huffman-encoded space (2 bits)', () => {
      const w = new BitWriter();
      w.writeChar(' ');
      expect(w.length).toBe(2); // space = 2 bits
    });

    it('encodes and decodes roundtrip', () => {
      const w = new BitWriter();
      const chars = 'abc';
      for (const c of chars) w.writeChar(c);
      const packed = w.toArray();
      const r = new BinaryReader(packed);
      expect(r.char()).toBe('a');
      expect(r.char()).toBe('b');
      expect(r.char()).toBe('c');
    });

    it('throws on unsupported character', () => {
      const w = new BitWriter();
      expect(() => w.writeChar('!')).toThrow('unsupported');
    });
  });

  describe('seek / peek', () => {
    it('seekByte positions at byte offset', () => {
      const w = new BitWriter();
      w.writeUInt32(0x12345678);
      w.seekByte(0);
      expect(w.offset).toBe(0);
    });

    it('peekBytes reads without advancing offset', () => {
      const w = new BitWriter();
      w.writeUInt16(0xabcd);
      const beforeOffset = w.offset;
      w.seekByte(0);
      const peeked = w.peekBytes(2);
      expect(peeked[0]).toBe(0xcd); // LE
      expect(peeked[1]).toBe(0xab);
      expect(w.offset).toBe(0); // did not advance
    });

    it('seekBit/seekByte update length watermark', () => {
      const w = new BitWriter();
      w.seekByte(10);
      expect(w.length).toBe(80);
    });
  });

  describe('align', () => {
    it('aligns to next byte boundary', () => {
      const w = new BitWriter();
      w.writeBit(1);
      w.writeBit(0);
      w.writeBit(1);
      w.align();
      expect(w.offset).toBe(8);
    });

    it('no-op when already aligned', () => {
      const w = new BitWriter();
      w.writeUInt8(0xff);
      w.align();
      expect(w.offset).toBe(8);
    });
  });

  describe('toArray', () => {
    it('returns empty array for empty writer', () => {
      const w = new BitWriter();
      const arr = w.toArray();
      expect(arr.length).toBe(0);
    });

    it('packs partial byte correctly', () => {
      const w = new BitWriter();
      w.writeBit(1);
      const arr = w.toArray();
      expect(arr.length).toBe(1);
      expect(arr[0]).toBe(0x01);
    });
  });

  describe('auto-resize', () => {
    it('handles writes beyond initial capacity', () => {
      const w = new BitWriter(8); // tiny capacity
      for (let i = 0; i < 100; i++) w.writeUInt8(0xaa);
      const arr = w.toArray();
      expect(arr.length).toBe(100);
      expect(arr[0]).toBe(0xaa);
      expect(arr[99]).toBe(0xaa);
    });
  });

  describe('overwrite via seek', () => {
    it('seekByte + writeUInt32 overwrites data', () => {
      const w = new BitWriter();
      w.writeUInt32(0x00000000);
      w.writeUInt32(0x00000000);
      w.seekByte(0).writeUInt32(0xdeadbeef);
      const arr = w.toArray();
      expect(arr[0]).toBe(0xef);
      expect(arr[1]).toBe(0xbe);
      expect(arr[2]).toBe(0xad);
      expect(arr[3]).toBe(0xde);
    });
  });
});
