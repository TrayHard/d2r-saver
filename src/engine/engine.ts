/**
 * The Rust read core (`rust/core`) compiled to WebAssembly (`rust/wasm`), and the objects the
 * readers build from its documents.
 *
 * The module is embedded as base64 (`wasm-module.ts`, written by `scripts/build-wasm.mjs`), has no
 * imports and is compiled on the first read. Browsers refuse to compile it synchronously on the main
 * thread: there, `await ready()` (or `D2RSaver.create`) before the first read.
 *
 * A document (see `rust/core/src/doc.rs`) holds every parsed item with its trace; the affix solver
 * runs here, between the halves of each extended item, so the objects equal those of the 0.4 parser.
 */

import WASM_BASE64 from './wasm-module.js';
import { GameData } from '../game-data/game-data.js';
import { D2RSaverError, ErrorCode } from '../types/errors.js';
import { solveItem, type BinaryParsedItem } from '../formats/item-parser.js';
import type { ItemHead, WalkedItem } from '../formats/item-walker.js';

// The few WebAssembly globals used here; the package compiles without the DOM library.
declare const WebAssembly: {
  Module: new (bytes: Uint8Array) => object;
  Instance: new (module: object) => { exports: unknown };
  instantiate(bytes: Uint8Array): Promise<{ instance: { exports: unknown } }>;
};

interface Exports {
  memory: { buffer: ArrayBuffer };
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  result_ptr(): number;
  result_len(): number;
  engine_new(data: number, dataLen: number, strings: number, stringsLen: number): number;
  engine_drop(engine: number): void;
  read_d2s(engine: number, ptr: number, len: number, legacy: number, solve: number): number;
  read_d2i(engine: number, ptr: number, len: number, solve: number): number;
  walk_item_list(
    engine: number, ptr: number, len: number, headerOffset: number, legacy: number,
    firstId: number, hasExpectedEnd: number, expectedEnd: number, solve: number,
  ): number;
  walk_d2i(engine: number, ptr: number, len: number, legacy: number, solve: number): number;
  read_demons(engine: number, ptr: number, len: number, headerOffset: number): number;
  read_item_head(ptr: number, len: number, offset: number): number;
}

/** An item of a document: whole, or `[head, tail, solver mods, blunt]` when the solver runs. */
type DocItem = BinaryParsedItem | [Partial<BinaryParsedItem>, Partial<BinaryParsedItem>, string[], boolean];
/** `[depth, registeredKey, head flags, loc, bodyloc, col, row, storage]`. */
export type Trace = [number, number | string | null, number, number, number, number, number, number];
/** `[item index, index among siblings, children]`. */
export type Node = [number, number, Node[]];

export interface ItemsDoc {
  items: DocItem[];
  traces: Trace[];
  undef: number[];
}

let wasm: Exports | undefined;
let compiling: Promise<void> | undefined;
const engines = new WeakMap<GameData, { wasm: Exports; handle: number }>();
const released = typeof FinalizationRegistry === 'function'
  ? new FinalizationRegistry<{ wasm: Exports; handle: number }>(e => e.wasm.engine_drop(e.handle))
  : undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function wasmBytes(): Uint8Array {
  const binary = atob(WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Compile the WebAssembly reader asynchronously. Needed once before the first read on a browser's
 * main thread, which refuses synchronous compilation; elsewhere the first read compiles it.
 */
export function ready(): Promise<void> {
  if (wasm) return Promise.resolve();
  return (compiling ??= WebAssembly.instantiate(wasmBytes()).then(({ instance }) => {
    wasm ??= instance.exports as Exports;
  }));
}

function instance(): Exports {
  if (!wasm) {
    try {
      wasm = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes())).exports as Exports;
    } catch (e) {
      throw new D2RSaverError(
        ErrorCode.DATA_NOT_LOADED,
        `the WebAssembly reader cannot compile synchronously here (${(e as Error).message}); await ready() before reading`,
      );
    }
  }
  return wasm;
}

/** Copy `input` into the module and return its address; the caller frees it. */
function put(x: Exports, input: Uint8Array): number {
  const ptr = x.alloc(input.length);
  new Uint8Array(x.memory.buffer, ptr, input.length).set(input);
  return ptr;
}

function result(x: Exports, len = x.result_len()): string {
  return decoder.decode(new Uint8Array(x.memory.buffer, x.result_ptr(), len));
}

/** Copy `input` into the module, call `read` on it and parse the document it leaves. */
function run<T>(input: Uint8Array, read: (x: Exports, ptr: number, len: number) => number): T {
  const x = instance();
  const ptr = put(x, input);
  let len: number;
  try {
    len = read(x, ptr, input.length);
  } catch (e) {
    // A trap leaves the instance unusable: the next read compiles a new one.
    wasm = undefined;
    throw new D2RSaverError(ErrorCode.PARSE_ERROR, `the WebAssembly reader failed: ${(e as Error).message}`);
  }
  x.dealloc(ptr, input.length);
  const doc = JSON.parse(result(x, len));
  if (doc.throw) throw thrown(doc.throw);
  return doc as T;
}

function thrown({ kind, message }: { kind: string; message: string }): Error {
  switch (kind) {
    case 'overrun': return new D2RSaverError(ErrorCode.BUFFER_OVERRUN, message);
    case 'parse': return new D2RSaverError(ErrorCode.PARSE_ERROR, message);
    case 'argument': return new D2RSaverError(ErrorCode.INVALID_ARGUMENT, message);
    default: return new Error(message);
  }
}

/** The tables of `gd` the read core uses, as JSON. */
function engineData(gd: GameData): string {
  type Row = Record<string, unknown> | undefined;
  const pick = (table: unknown, f: (v: Row) => unknown) =>
    Object.fromEntries(Object.entries((table ?? {}) as Record<string, Row>).map(([k, v]) => [k, f(v)]));
  return JSON.stringify({
    itemStatCost: gd.itemStatCost,
    itemTypes: gd.itemTypes,
    items: gd.items,
    uniqueItems: gd.uniqueItems,
    setItems: gd.setItems,
    runes: gd.runes,
    info: gd.info,
    rarePrefix: gd.rarePrefix,
    rareSuffix: gd.rareSuffix,
    classes: GameData.classes,
    superUniques: pick(gd.superUniques, v => ({ class: v?.class, mod1: v?.mod1, mod2: v?.mod2, mod3: v?.mod3 })),
    uniqueMods: pick(gd.uniqueMods, v => ({ uniquemod: v?.uniquemod })),
    monsters: pick(gd.monsters, v => ({ hcidx: v?.hcidx })),
  });
}

/** The engine of `gd`, built on its first read from the tables as they are then. */
function engine(gd: GameData): number {
  const x = instance();
  const known = engines.get(gd);
  if (known?.wasm === x) return known.handle;
  const data = encoder.encode(engineData(gd));
  const strings = encoder.encode(JSON.stringify(Object.entries(gd.locale.strings)));
  const dataPtr = put(x, data);
  const stringsPtr = put(x, strings);
  const handle = x.engine_new(dataPtr, data.length, stringsPtr, strings.length);
  x.dealloc(dataPtr, data.length);
  x.dealloc(stringsPtr, strings.length);
  if (!handle) throw new D2RSaverError(ErrorCode.DATA_NOT_LOADED, `game data rejected by the read core: ${result(x)}`);
  const entry = { wasm: x, handle };
  engines.set(gd, entry);
  released?.register(gd, entry);
  return handle;
}

// ─── Reads ──────────────────────────────────────────────────────

export function engineReadD2S<T extends ItemsDoc>(gd: GameData, data: Uint8Array, legacy: boolean, solve: boolean): T {
  const e = engine(gd);
  return run(data, (x, p, n) => x.read_d2s(e, p, n, +legacy, +solve));
}

export function engineReadD2I<T extends ItemsDoc>(gd: GameData, data: Uint8Array, solve: boolean): T {
  const e = engine(gd);
  return run(data, (x, p, n) => x.read_d2i(e, p, n, +solve));
}

export function engineWalkList<T extends ItemsDoc>(
  gd: GameData, data: Uint8Array, headerOffset: number, legacy: boolean, firstId: number,
  expectedEnd: number | undefined, solve: boolean,
): T {
  const e = engine(gd);
  return run(data, (x, p, n) => x.walk_item_list(
    e, p, n, headerOffset, +legacy, firstId >>> 0, +(expectedEnd !== undefined), expectedEnd ?? 0, +solve,
  ));
}

export function engineWalkD2I<T extends ItemsDoc>(gd: GameData, data: Uint8Array, legacy: boolean, solve: boolean): T {
  const e = engine(gd);
  return run(data, (x, p, n) => x.walk_d2i(e, p, n, +legacy, +solve));
}

export function engineReadDemons<T>(gd: GameData, data: Uint8Array, headerOffset: number): T {
  const e = engine(gd);
  return run(data, (x, p, n) => x.read_demons(e, p, n, headerOffset));
}

export function engineItemHead(bytes: Uint8Array, offset: number): ItemHead {
  return run<{ head: ItemHead }>(bytes, (x, p, n) => x.read_item_head(p, n, offset)).head;
}

// ─── Objects from documents ─────────────────────────────────────

/**
 * The items of a document as `BinaryParsedItem`s: `quality` set back to `undefined` where the
 * document holds `null`, the affix solver run between the halves of each extended item, the
 * blunt-weapon bonus added after it.
 */
export function itemsOf(doc: ItemsDoc, gd: GameData): BinaryParsedItem[] {
  const items = doc.items;
  for (const i of doc.undef) {
    const item = items[i];
    (Array.isArray(item) ? item[0] : item).quality = undefined;
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!Array.isArray(item)) continue;
    const [head, tail, mods, blunt] = item;
    const whole = Object.assign(head, solveItem(gd, head as BinaryParsedItem, mods), tail) as BinaryParsedItem;
    if (blunt) whole.stats.item_undeaddamage_percent = (whole.stats.item_undeaddamage_percent || 0) + 50;
    items[i] = whole;
  }
  return items as BinaryParsedItem[];
}

/** The parser's dictionary of items `[from, to)`: registered items by key, the last one wins. */
export function dictOf(
  items: BinaryParsedItem[],
  traces: Trace[],
  from = 0,
  to = items.length,
): Record<number | string, BinaryParsedItem> {
  const dict: Record<number | string, BinaryParsedItem> = {};
  for (let i = from; i < to; i++) {
    const key = traces[i][1];
    if (key !== null) dict[key] = items[i];
  }
  return dict;
}

/** `ItemHead` of a traced item. */
export function headOf(trace: Trace, item: BinaryParsedItem): ItemHead {
  const flags = trace[2];
  return {
    identified: (flags & 1) !== 0,
    socketed: (flags & 2) !== 0,
    ear: (flags & 4) !== 0,
    simple: (flags & 8) !== 0,
    ethereal: (flags & 16) !== 0,
    personalized: (flags & 32) !== 0,
    runeword: (flags & 64) !== 0,
    extras: (flags & 128) !== 0,
    loc: trace[3],
    bodyloc: trace[4],
    col: trace[5],
    row: trace[6],
    storage: trace[7],
    base: flags & 4 ? null : item.base,
  };
}

/** Walked items of an item tree. */
export function entriesOf(nodes: Node[], items: BinaryParsedItem[], traces: Trace[]): WalkedItem[] {
  return nodes.map(([i, index, children]) => {
    const item = items[i];
    return {
      index,
      own: item.byteRange!,
      full: item.fullByteRange!,
      children: entriesOf(children, items, traces),
      head: headOf(traces[i], item),
      item,
      registeredKey: traces[i][1],
      hasQuantity: item.quantity !== undefined,
      quantityField: item.quantityField,
    };
  });
}

/** An array filled by `array[slot] = value` in order, holes kept. */
export function sparse<T>(pairs: Array<[number, T]>): (T | undefined)[] {
  const array: (T | undefined)[] = [];
  for (const [slot, value] of pairs) array[slot] = value;
  return array;
}
