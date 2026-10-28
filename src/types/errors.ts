/**
 * Typed error class for d2r-saver.
 *
 * All user-facing errors are instances of D2RSaverError with a machine-readable
 * `code` property for programmatic handling.
 */

// ─── Error codes ────────────────────────────────────────────────

/** Error code enum — all machine-readable error codes. */
export enum ErrorCode {
  /** File is not a valid d2s or d2i. */
  INVALID_FORMAT = 'INVALID_FORMAT',
  /** Unrecognized or non-v105 file version. */
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  /** Generic parse failure. */
  PARSE_ERROR = 'PARSE_ERROR',
  /** Checksum doesn't match (warning, usually non-blocking). */
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  /** No free grid slot for placement. */
  NO_FREE_SLOT = 'NO_FREE_SLOT',
  /** Item with given ID not found. */
  ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',
  /** Error during binary write. */
  WRITE_ERROR = 'WRITE_ERROR',
  /** Malformed portability token. */
  INVALID_TOKEN = 'INVALID_TOKEN',
  /** GameData has not been loaded yet. */
  DATA_NOT_LOADED = 'DATA_NOT_LOADED',
  /**
   * A read ran past the end of the buffer. Raised by `BinaryReader` the moment any read would
   * need bits that the buffer does not have (truncated / corrupt file), instead of silently
   * returning zeros and letting the item parser spin on garbage.
   */
  BUFFER_OVERRUN = 'BUFFER_OVERRUN',
  /**
   * An item list did not parse to its declared count (or did not end where the sector ends),
   * and the requested in-place operation needs a fully understood list.
   */
  LIST_TRUNCATED = 'LIST_TRUNCATED',
  /** The byte difference between two buffers is not exactly the one the operation declared. */
  RANGE_MISMATCH = 'RANGE_MISMATCH',
  /** An item's base code is not in GameData, so its grid size (and hence its placement) is unknown. */
  UNKNOWN_BASE = 'UNKNOWN_BASE',
  /**
   * The stash sector cannot be used for the operation: wrong type (extended/metadata), an item
   * outside the stash grid, or two items overlapping in the raw layout.
   */
  INVALID_PAGE = 'INVALID_PAGE',
  /** A caller-supplied argument is out of range (position bits, offsets, buffer too short). */
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  /**
   * A record of a materials (type 1) sector does not have the exact layout an in-place quantity
   * edit relies on (0.4.0); the whole sector is refused, foreign records included.
   */
  MATERIAL_LAYOUT = 'MATERIAL_LAYOUT',
  /** A materials sector holds more than one record for the same code (0.4.0). */
  MATERIAL_DUPLICATE_CODE = 'MATERIAL_DUPLICATE_CODE',
  /** A materials sector has no record for the code a patch names (0.4.0). */
  MATERIAL_NOT_FOUND = 'MATERIAL_NOT_FOUND',
  /** A materials record does not hold the quantity the patch expects (stale read) (0.4.0). */
  MATERIAL_STALE = 'MATERIAL_STALE',
  /** A requested materials quantity is outside the allowed range (0.4.0). */
  MATERIAL_RANGE = 'MATERIAL_RANGE',
  /** An append names a code the materials sector already holds (0.4.0). */
  MATERIAL_ALREADY_PRESENT = 'MATERIAL_ALREADY_PRESENT',
  /**
   * A new record cannot be proven to match the sector's layout: the encoder does not reproduce
   * every existing record of that family, there is no such record, or the result does not read
   * back as written (0.4.0).
   */
  LAYOUT_UNVERIFIED = 'LAYOUT_UNVERIFIED',
}

// ─── Error class ────────────────────────────────────────────────

/**
 * Structured error thrown by d2r-saver operations.
 *
 * @example
 * ```ts
 * try {
 *   saver.extractItemD2S(buf, 999);
 * } catch (e) {
 *   if (e instanceof D2RSaverError && e.code === ErrorCode.ITEM_NOT_FOUND) {
 *     console.log('Item not found');
 *   }
 * }
 * ```
 */
export class D2RSaverError extends Error {
  override readonly name = 'D2RSaverError';
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
