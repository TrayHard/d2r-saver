import type { GameData } from '../../src/game-data/game-data.js';
import { walkItemList, type WalkedItem } from '../../src/formats/item-walker.js';

const bodyMap = [null, 'head', 'neck', 'tors', 'rarm', 'larm', 'rrin', 'lrin', 'belt', 'feet', 'glov', 'rarm2', 'larm2'];

/** Where the 0.4 parser's list handler put a top-level item: `(id, location, slot)`. */
export interface Placed {
  id: number | string;
  location?: string;
  slot?: number | string;
}

/**
 * One `JM` list read with `walkItemList`, plus what the 0.4 parser's list handler (`placed`) and
 * `onItem` (`traces`: base, depth, registered key, children before parents) saw of it.
 */
export function parseList(
  buffer: Uint8Array,
  gd: GameData,
  options: { headerOffset?: number; initialId?: number; expectedEnd?: number } = {},
) {
  const headerOffset = options.headerOffset ?? 0;
  const walk = walkItemList(buffer, headerOffset, gd, { initialId: options.initialId, expectedEnd: options.expectedEnd });
  const columns = gd.info?.stash?.columns || 16;
  const placed: Placed[] = [];
  for (const { head, registeredKey: id } of walk.entries) {
    if (id === null) continue;
    const { loc, storage, row, col, bodyloc } = head;
    if (loc === 0 || loc === 4) {
      if (storage === 1) placed.push({ id, location: 'inventory', slot: row * 10 + col });
      if (storage === 4) placed.push({ id, location: 'cube', slot: row * 3 + col });
      if (storage === 5) placed.push({ id, location: 'stash', slot: row * columns + col });
    } else if (loc === 1 && bodyMap[bodyloc]) placed.push({ id, location: 'body', slot: bodyMap[bodyloc]! });
    else if (loc === 2) placed.push({ id, location: 'belt', slot: col });
    else if (loc === 6) placed.push({ id });
  }
  const traces: Array<[string, number, number | string | null]> = [];
  const visit = (entry: WalkedItem, depth: number) => {
    entry.children.forEach(child => visit(child, depth + 1));
    traces.push([entry.item.base, depth, entry.registeredKey]);
  };
  walk.entries.forEach(entry => visit(entry, 0));
  return { ...walk, placed, traces, consumed: walk.report.endOffset - headerOffset - 4 };
}
