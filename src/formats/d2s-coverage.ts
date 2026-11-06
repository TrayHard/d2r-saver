import type { ByteRange } from './item-parser.js';
import type { WalkedItem } from './item-walker.js';

/** Strict traversal certificate of a `.d2s`, computed by the Rust core (`coverage` in `rust/core/src/doc.rs`). */
export interface D2SParseCoverage {
  complete: boolean;
  reachedEof: boolean;
  endOffset: number;
  error: string | null;
  /** Every physical top-level item, including corpses, mercenary and golem; sockets are children. */
  items: WalkedItem[];
  /** Contiguous known sections covering [0, endOffset); no opaque tail is certified. */
  sections: Array<ByteRange & { kind: string }>;
}
