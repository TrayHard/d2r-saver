/**
 * Save file format detection — Blizzless v105 only.
 *
 * Ported from d2planner/src/logic/binary/index.js → detectFormat().
 * Simplified: only accepts version 105.
 */
/** Detected format type */
export interface DetectedFormat {
    type: 'd2s' | 'd2i';
    version: number;
}
/**
 * Detect whether `data` is a valid Blizzless v105 .d2s or .d2i file.
 *
 * @returns Format info or `null` if not recognized / unsupported version.
 */
export declare function detectFormat(data: Uint8Array): DetectedFormat | null;
//# sourceMappingURL=detect.d.ts.map