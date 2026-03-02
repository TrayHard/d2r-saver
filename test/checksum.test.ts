import { describe, it, expect } from 'vitest';
import { computeChecksum, fixHeader } from '../src/core/checksum.js';
import { BitWriter } from '../src/core/binary-writer.js';
import { BinaryReader } from '../src/core/binary-reader.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve(import.meta.dirname!, '..', 'test', 'fixtures');

describe('checksum', () => {
  describe('computeChecksum', () => {
    it('returns 0 for all-zero buffer (past checksum field)', () => {
      const data = new Uint8Array(32); // all zeros
      const result = computeChecksum(data);
      expect(result).toBe(0);
    });

    it('produces a consistent checksum for known data', () => {
      // Construct a small "file" with known bytes
      const data = new Uint8Array(20);
      data[0] = 0xaa;
      data[1] = 0x55;
      data[2] = 0xaa;
      data[3] = 0x55;
      // bytes 0x0C..0x0F are checksum field (treated as 0)
      data[16] = 0x42;
      const cs1 = computeChecksum(data);
      const cs2 = computeChecksum(data);
      expect(cs1).toBe(cs2);
      expect(cs1).toBeGreaterThan(0);
    });
  });

  describe('fixHeader', () => {
    it('writes filesize and checksum into BitWriter', () => {
      const w = new BitWriter();
      // Write a minimal D2S-like header
      w.writeUInt32(0xaa55aa55); // 0x00: magic
      w.writeUInt32(105);        // 0x04: version
      w.writeUInt32(0);          // 0x08: filesize (placeholder)
      w.writeUInt32(0);          // 0x0C: checksum (placeholder)
      // Some body data
      w.writeUInt32(0xdeadbeef);
      w.writeUInt32(0xcafebabe);

      fixHeader(w);

      // Verify filesize at 0x08
      w.seekByte(0x08);
      const filesize = w.peekBytes(4);
      const size = filesize[0] | (filesize[1] << 8) | (filesize[2] << 16) | ((filesize[3] << 24) >>> 0);
      expect(size).toBe(24); // 6 * 4 bytes

      // Verify checksum is non-zero at 0x0C
      w.seekByte(0x0c);
      const csBytes = w.peekBytes(4);
      const cs = (csBytes[0] | (csBytes[1] << 8) | (csBytes[2] << 16) | ((csBytes[3] << 24) >>> 0)) >>> 0;
      expect(cs).toBeGreaterThan(0);

      // Verify checksum matches computeChecksum on the packed array
      const packed = w.toArray();
      expect(computeChecksum(packed)).toBe(cs);
    });
  });

  describe('real fixture validation', () => {
    it('validates checksum of BlizzlessTest.d2s', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'BlizzlessTest.d2s')));
      // Read the stored checksum at offset 0x0C
      const reader = new BinaryReader(data);
      reader.seek(0x0c);
      const storedChecksum = reader.read32();

      // Compute checksum (treating 0x0C-0x0F as zero)
      const computed = computeChecksum(data);
      expect(computed).toBe(storedChecksum);
    });

    it('validates checksum of WarlockShards.d2s', () => {
      const data = new Uint8Array(readFileSync(resolve(FIXTURES, 'WarlockShards.d2s')));
      const reader = new BinaryReader(data);
      reader.seek(0x0c);
      const storedChecksum = reader.read32();
      expect(computeChecksum(data)).toBe(storedChecksum);
    });
  });
});
