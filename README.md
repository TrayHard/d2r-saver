# d2r-saver

Blizzless D2R v105 save file reader/writer library. Ported from d2planner.

## Features

- Read/write `.d2s` (character) and `.d2i` (shared stash) files
- Extract and insert items between save files
- Byte-exact list walking for in-place editing: item ranges, list reports, position patching (0.3.0)
- Portable item serialization tokens (`d2r1:<base64>`)
- HD/SD icon path resolution
- Trade DTO generation for backend integration
- Inventory grid placement helpers
- TypeScript strict mode, full type safety

## Quick Start

```ts
import { D2RSaver } from 'd2r-saver';
import { readFileSync } from 'node:fs';

// Initialize with game data
const saver = await D2RSaver.create({
  dataPath: './data/data.json',
  stringsPath: './data/strings.json',
});

// Or from pre-parsed JSON
const saver = D2RSaver.fromData(dataJson, stringsJson);
```

## Reading Save Files

```ts
// Auto-detect format
const result = saver.readSave(buffer);
// result.type === 'd2s' | 'd2i'

// Or explicitly
const d2s = saver.readD2S(buffer);  // character file
const d2i = saver.readD2I(buffer);  // shared stash
```

### Did the parser understand the whole file?

Every `JM` item list comes back with an `ItemListReport` (0.3.0): what the header declared,
how many items parsed, where the last good item ended and why parsing stopped.

```ts
const d2s = saver.readD2S(buffer);
d2s.lists.main;            // { headerOffset, declared, parsed, endOffset, truncated, complete, error, errorCode, ... }
d2s.lists.corpses;         // ItemListReport[]
d2s.lists.merc;            // ItemListReport | null

const d2i = saver.readD2I(buffer);
d2i.sectors;               // [{ offset, size, type, gold, list }] — every raw sector, in file order
d2i.tiled;                 // sector sizes add up to exactly the file length
d2i.pages[n].list;         // the report of the sector a page came from
```

`complete` is true only when `parsed === declared`, no item failed, and (for `.d2i`) the reader
stopped exactly at the sector end. Only a complete list is safe to write into.

A file cut off mid-item no longer spins: every `BinaryReader` read is bounds-checked and throws
`D2RSaverError` with code `BUFFER_OVERRUN`; the readers turn that into a truncated list report
with `errorCode: 'BUFFER_OVERRUN'` in milliseconds.

Every parsed item also carries absolute byte ranges: `byteRange` (the item alone),
`fullByteRange` (the item plus its socketed children) and `socketedByteRanges` (one per child).
The older `binaryOffset` (bits, relative to the sector for `.d2i`) is unchanged.

## In-Place Editing Building Blocks (0.3.0)

The classic extract/insert operations rebuild the whole file through the item writer. The
in-place path never re-encodes anything: it locates an item's exact bytes with the parser as a
length oracle, moves those bytes, and patches the position bits and the list counter. These
functions are the building blocks; they are also exported standalone (`walkD2I`, `walkItemList`,
`readItemHead`, `patchItemPosition`, `zeroItemPosition`, `buildRawGrid`).

```ts
// Walk every sector of a shared stash. Sectors are addressed by byte offset, never by index.
const report = saver.walkD2I(stashBuffer);
report.tiled;                          // sector sizes add up to the file length
for (const sector of report.sectors) {
  sector.type;                         // 0 normal, 1 extended (stacks), 2 metadata (walk === null)
  sector.walk?.report.complete;        // the list parsed to its declared count and to the sector end
  for (const entry of sector.walk?.entries ?? []) {
    entry.own;                         // { start, end } bytes of the item alone (absolute)
    entry.full;                        // item plus socketed children — what a raw cut/paste moves
    entry.children;                    // socketed children with their own ranges
    entry.head;                        // flags, loc/bodyloc/col/row/storage, base code — no stats parsed
    entry.item;                        // the fully parsed item, even when the parser dropped it
    entry.registeredKey;               // key in sector.walk.items, or null when dropped
    entry.hasQuantity;                 // stack field present
  }
}

// Walk a single JM list (e.g. the main list of a .d2s at lists.main.headerOffset).
const main = saver.walkItemList(charBuffer, saver.readD2S(charBuffer).lists.main!.headerOffset);

// Decode an item head from raw bytes and move the item to another stash cell.
import { readItemHead, patchItemPosition, zeroItemPosition } from 'd2r-saver';
const bytes = stashBuffer.slice(entry.full.start, entry.full.end);
readItemHead(bytes);                   // { base: 'amu', loc: 0, storage: 5, col: 8, row: 0, ... }
const moved = patchItemPosition(bytes, { loc: 0, bodyloc: 0, col: 3, row: 11, storage: 5 }); // copy; children untouched
const fingerprintInput = zeroItemPosition(bytes); // same item in any cell hashes the same

// Occupancy of a sector from the position bits of every walked item (not from the dictionary).
const grid = saver.buildRawGrid(sector.walk!);  // throws UNKNOWN_BASE / INVALID_PAGE instead of guessing
saver.canPlaceItem(grid, 3, 11, { base: 'amu' });
```

Rules the walker relies on (verified on the fixtures): every item starts and ends on a byte
boundary; bits 0–34 are flags; bits 35–52 are `loc` (3), `bodyloc` (4), `col` (4), `row` (4),
`storage` (3); the Huffman base code starts at bit 53; socketed children follow their parent and
are consumed by the parent's parse. Extended sectors (type 1) keep stacks in a virtual layout
that overlaps in raw coordinates, so `buildRawGrid` rejects them with `INVALID_PAGE`.

## Trade Flow (Extract → Serialize → Transfer → Insert)

```ts
// Seller: extract item from character
const { newBuffer, extractedItem, extractedAllItems } =
  saver.extractItemD2S(sellerBuffer, itemId);

// Serialize to portable token (goes over the network)
const token = saver.serializeItem(extractedItem, extractedAllItems);

// Buyer: deserialize and insert into stash
const { item, allItems } = saver.deserializeItem(token);
const { newBuffer: patchedStash } =
  saver.insertItemD2I(buyerBuffer, item, allItems);
```

## Item Information

```ts
// Icon paths
const hdIcon = saver.getItemIconPath(item);  // HD icon key
const sdIcon = saver.getItemIconSD(item);    // SD invfile name

// Trade DTO (for backend)
const dto = saver.toTradeDTO(item, allItems);
// → { token, baseCode, displayName, quality, ilvl, ethereal, sockets, ... }

// Item dimensions
const { width, height } = saver.getItemSize(item);
```

## Placement

```ts
import { StashGrid } from 'd2r-saver';

const grid = new StashGrid(16, 13); // stash dimensions
const canPlace = saver.canPlaceItem(grid, x, y, item);
const slot = saver.findFreeSlot(grid, item);
```

## Error Handling

```ts
import { D2RSaverError, ErrorCode } from 'd2r-saver';

try {
  saver.extractItemD2S(buffer, 999);
} catch (e) {
  if (e instanceof D2RSaverError) {
    switch (e.code) {
      case ErrorCode.ITEM_NOT_FOUND: // ...
      case ErrorCode.INVALID_FORMAT: // ...
      case ErrorCode.NO_FREE_SLOT:   // ...
    }
  }
}
```

Codes added in 0.3.0 for the in-place path: `BUFFER_OVERRUN` (a read ran past the end of the
buffer), `LIST_TRUNCATED` (an operation needs a complete list), `RANGE_MISMATCH` (the byte diff
is not the declared one), `UNKNOWN_BASE` (no grid size for a base code), `INVALID_PAGE` (sector
type, placement or overlap), `INVALID_ARGUMENT` (out-of-range position or offset).

## Architecture

```
src/
  index.ts              — D2RSaver facade + re-exports
  core/                 — BinaryReader (bounds-checked), BitWriter, Huffman, checksum
  types/                — Constants, enums, errors
  game-data/            — GameData class (data.json + strings.json)
  formats/              — D2S/D2I readers/writers, item parser/writer, item walker
  items/                — Item types, stats, serializer, icons, DTO
  inventory/            — Grid, placement, dimensions, raw grid from walked items
  operations/           — Extract, insert, readSave
```

## Test fixtures

`test/fixtures/` holds real Blizzless v105 saves. Every non-empty normal stash sector in them
stops parsing on a Blizzless-specific stat code (480–508) after 0–7 items; only the empty sectors
and the extended sector parse to the end. The tests pin the exact numbers (declared/parsed per
list, byte ranges of the first items) so a parser change that moves any boundary is caught.
`test/__snapshots__/compat-0.2.1/` freezes the 0.2.1 output of `readD2S`/`readD2I` for every
fixture; the compatibility test strips only the fields added since.

## Development

```bash
npm test          # run tests (vitest)
npm run build     # compile TypeScript
```

## Requirements

- Node.js ≥ 18
- Blizzless v105 save files only
