import { computeChecksum } from '../core/checksum.js';
import type { D2SItemLists, D2SCharacterProfile } from './d2s-reader.js';
import type { ByteRange, ParsedItemTrace } from './item-parser.js';
import type { D2SDemonSectionReport } from './d2s-demon-reader.js';
import { readItemHead, type WalkedItem } from './item-walker.js';

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

export function d2sCoverage(data: Uint8Array, profile: Partial<D2SCharacterProfile>, lists: D2SItemLists,
  traces: ParsedItemTrace[], demons: D2SDemonSectionReport | null, warnings: string[], prefixComplete: boolean): D2SParseCoverage {
  const out: D2SParseCoverage = { complete: false, reachedEof: demons?.reachedEof ?? false,
    endOffset: demons?.endOffset ?? 0, error: null, items: [], sections: [] };
  try {
    if (!prefixComplete) throw Error('unsupported character prefix schema');
    if (warnings.length || !lists.main || !lists.golem || !demons?.complete) throw Error('incomplete character sections');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(8, true) !== data.length || view.getUint32(12, true) !== computeChecksum(data)) throw Error('invalid character size or checksum');
    const pending: WalkedItem[][] = [];
    for (const trace of traces) {
      const { item, depth, registeredKey } = trace;
      if (!item.byteRange || !item.fullByteRange) throw Error('unranged character item');
      const children = pending[depth + 1] ?? [];
      pending[depth + 1] = [];
      const entry: WalkedItem = { index: -1, own: item.byteRange, full: item.fullByteRange, children,
        head: readItemHead(data, item.byteRange.start), item, registeredKey, hasQuantity: item.quantity !== undefined,
        quantityField: item.quantityField };
      let cursor = entry.own.end;
      if (entry.own.start !== entry.full.start || entry.own.end <= entry.own.start) throw Error('invalid character item range');
      for (const [index, child] of children.entries()) {
        child.index = index;
        if (child.full.start !== cursor) throw Error('uncovered socket bytes');
        cursor = child.full.end;
      }
      if (cursor !== entry.full.end || cursor > data.length) throw Error('invalid character item end');
      (pending[depth] ??= []).push(entry);
    }
    if (pending.slice(1).some(entries => entries.length > 0)) throw Error('orphan socket items');
    const roots = pending[0] ?? [];
    let used = 0;
    for (const list of [lists.main, ...lists.corpses, ...(lists.merc ? [lists.merc] : [])]) {
      if (!list.complete || list.error || list.truncated || list.declared !== list.parsed) throw Error('incomplete character item list');
      let cursor = list.firstItemOffset;
      for (let index = 0; index < list.parsed; index++) {
        const entry = roots[used++];
        if (!entry || entry.full.start !== cursor) throw Error('uncovered character item bytes');
        entry.index = index;
        cursor = entry.full.end;
      }
      if (cursor !== list.endOffset) throw Error('character list end mismatch');
    }
    const corpseStart = lists.main.endOffset;
    const corpseEnd = corpseStart + (profile.rawCorpse?.length ?? 0);
    if (corpseEnd < corpseStart + 4) throw Error('missing corpse section');
    const corpseCount = view.getUint16(corpseStart + 2, true);
    if (corpseCount !== lists.corpses.length) throw Error('corpse count mismatch');
    let corpseCursor = corpseStart + 4;
    for (const corpse of lists.corpses) {
      if (corpse.headerOffset !== corpseCursor + 12) throw Error('invalid corpse boundary');
      corpseCursor = corpse.endOffset;
    }
    if (corpseCursor !== corpseEnd) throw Error('uncovered corpse bytes');
    if (view.getUint32(163, true) !== 0 && !lists.merc) throw Error('missing hired mercenary item list');
    const mercEnd = lists.golem.headerOffset;
    if (view.getUint16(corpseEnd, true) !== 0x666a || mercEnd !== (lists.merc?.endOffset ?? corpseEnd + 2)
      || (lists.merc && lists.merc.headerOffset !== corpseEnd + 2)) throw Error('invalid mercenary boundary');
    const golemEnd = mercEnd + (profile.rawGolem?.length ?? 0);
    if (profile.rawGolem?.[2] !== Number(lists.golem.present)) throw Error('invalid golem presence flag');
    if (lists.golem.present) {
      const entry = roots[used++];
      if (!entry || entry.full.start !== mercEnd + 3 || entry.full.end !== golemEnd) throw Error('incomplete golem item');
      entry.index = 0;
    } else if (golemEnd !== mercEnd + 3) throw Error('unexpected golem bytes');
    if (used !== roots.length || demons.headerOffset !== golemEnd) throw Error('uncovered character tail');
    const sections = [
      { kind: 'header-stats-skills', start: 0, end: lists.main.headerOffset },
      { kind: 'main', start: lists.main.headerOffset, end: lists.main.endOffset },
      { kind: 'corpses', start: corpseStart, end: corpseEnd },
      { kind: 'mercenary', start: corpseEnd, end: mercEnd },
      { kind: 'golem', start: mercEnd, end: golemEnd },
      { kind: 'demons', start: demons.headerOffset, end: demons.endOffset },
    ];
    let cursor = 0;
    for (const section of sections) {
      if (section.start !== cursor || section.end <= section.start || section.end > data.length) throw Error('noncontiguous character sections');
      cursor = section.end;
    }
    if (cursor !== data.length) throw Error('character EOF mismatch');
    out.sections = sections;
    out.items = roots;
    out.complete = true;
  } catch (error) {
    out.error = error instanceof Error ? error.message : 'character coverage failure';
  }
  return out;
}
