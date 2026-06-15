/**
 * D2S checksum — compute and patch the rolling checksum used by D2R save files.
 *
 * Ported from d2planner `fixHeader()` in writed2s.js.
 *
 * Format layout (byte offsets):
 *   0x00  magic   (4 bytes, "aa 55 aa 55")
 *   0x04  version (4 bytes)
 *   0x08  filesize (4 bytes)  ← written by fixHeader
 *   0x0C  checksum (4 bytes)  ← written by fixHeader
 */
import { BitWriter } from './binary-writer.js';
/**
 * Write the file size at offset 0x08 and compute + write the rolling checksum
 * at offset 0x0C. Must be called **after** all other data has been written.
 *
 * @param writer The `BitWriter` that contains the fully-written save data.
 */
export declare function fixHeader(writer: BitWriter): void;
/**
 * Compute the checksum for a packed byte array (e.g. from `writer.toArray()`).
 * The checksum field at 0x0C is treated as zero during computation.
 *
 * @param data Complete file bytes.
 * @returns The 32-bit rolling checksum.
 */
export declare function computeChecksum(data: Uint8Array): number;
//# sourceMappingURL=checksum.d.ts.map