# d2r-saver

Blizzless D2R v105 save file reader/writer library. Ported from d2planner.

## Features

- Read/write `.d2s` (character) and `.d2i` (shared stash) files
- Extract and insert items between save files
- Byte-exact list walking for in-place editing: item ranges, list reports, position patching (0.3.0)
- In-place `.d2i` operations: cut and paste raw item bytes in a stash tab without rebuilding the
  file, with an exact-diff proof of what changed (0.3.0)
- Materials tab (`.d2i` sector type 1): read every quantity record, patch quantities in place,
  append records for absent codes, with the same exact-diff proof (0.4.0)
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

## In-Place Operations on `.d2i` (0.3.0)

`extractInPlaceD2I` and `insertInPlaceD2I` move items between shared-stash tabs by splicing
their raw bytes. The item writer is never involved: items the parser could not understand stay
exactly where they are, and nothing is re-synthesised. Only three things change in the file —
the moved bytes, the sector's 16-bit item count and its 32-bit `sectorSize` (plus the position
bits of an inserted item) — and every operation proves that on its own result with
`verifyExactDiff` before returning.

```ts
import { verifyExactDiff } from 'd2r-saver';

const report = saver.walkD2I(stash);
const tab = report.sectors[2];            // addressed by byte offset, never by page index

// Cut items 0 and 3 (each with its socketed children) out of the tab.
const cut = saver.extractInPlaceD2I(stash, { sectorOffset: tab.offset, indexes: [0, 3] });
cut.newBuffer;                            // the file without them
cut.removed[0].bytes;                     // raw item bytes, position bits zeroed (hash them for a fingerprint)
cut.removed[0].head;                      // the head as it was, original cell included
cut.listBefore.complete;                  // true — the tab was fully understood
cut.listAfter;                            // report of the tab in newBuffer
cut.diff;                                 // { kind: 'd2i-remove', sectorOffset, ranges }

// Paste them into another tab at explicit free cells (checked on the raw grid).
const put = saver.insertInPlaceD2I(otherStash, { sectorOffset: 1362 }, [
  { bytes: cut.removed[0].bytes, col: 3, row: 11 },
  { bytes: cut.removed[1].bytes, col: 0, row: 0 },
]);
put.inserted[0].range;                    // where the bytes sit in put.newBuffer
put.inserted[0].head;                     // loc 0, bodyloc 0, storage 5, col 3, row 11
put.diff;                                 // { kind: 'd2i-insert', sectorOffset, inserts: [{ at, length, bytes }] }

// Re-run the proof yourself on the buffers you are about to persist (gate 6).
verifyExactDiff(otherStash, put.newBuffer, put.diff);   // { ok: true, mismatches: [], ... }
```

Rules:

- Only normal (type 0) sectors can be edited. Extended (type 1) and metadata (type 2) sectors,
  and any offset that is not a sector start, throw `INVALID_PAGE`. A buffer whose sector chain
  does not tile it throws `INVALID_FORMAT` before anything is parsed.
- `insertInPlaceD2I` requires a **complete** target list (`report.complete === true`): with an
  unparsed tail the occupancy of the tab is unknown. There is no override (`LIST_TRUNCATED`).
- `extractInPlaceD2I` requires the same by default. `{ requireCompleteList: false }` allows
  cutting items out of the parsed prefix of a truncated list (the truncation point moves up by
  the removed items); it exists for tests and for a later phase, not for the production path.
- There is no automatic placement: the caller names the cell. The raw grid of the tab (every
  walked item, including ones the parser dropped) gates it: `NO_FREE_SLOT` when the cell is
  taken or outside the 16×13 grid, `UNKNOWN_BASE` when an item has no size in GameData.
- Inserted bytes must parse as exactly one item (with its children) and nothing else
  (`INVALID_ARGUMENT`). Their position bits are set to the stash page (`loc 0`, `bodyloc 0`,
  `storage 5`) and the given cell; children are untouched.
- Items go to the head of the list by default; `listIndex` places them elsewhere. The game does
  not care about list order; an explicit index lets a cut-and-paste restore the original file
  byte for byte.
- `fixD2ISectorSize(buffer, sectorOffset, delta)` is the header patch on its own, for callers
  that splice bytes themselves. `.d2i` has no checksum.
- Inputs are never modified, whatever `Uint8Array` subclass they are. A Node `Buffer` (what
  `fs.readFile`, HTTP bodies, S3 objects, `Buffer.from(base64)` and Prisma `bytea` hand out) is
  accepted as-is; `newBuffer`, `removed[].bytes`, `diff.inserts[].bytes` and the results of
  `patchItemPosition` / `zeroItemPosition` are fresh copies that share no memory with the
  inputs. (`Buffer#slice` returns a view, not a copy; the library never relies on it.) The only
  function that writes into its argument is `fixD2ISectorSize`, by contract.

`verifyExactDiff(before, after, spec)` is pure (no GameData): it rebuilds the expected `after`
from `before` and the `DiffSpec`, and compares byte for byte. `ok` is false on any length
difference or stray byte; `mismatches` lists the first 32 with their offsets, `mismatchCount`
counts them all. `assertExactDiff` throws `RANGE_MISMATCH` instead.

Two things to know before building a gate on it:

- **It is a byte check, not a structure check.** It proves that `after` differs from `before`
  exactly as the spec declares. It does not prove that the declared ranges are item boundaries:
  a spec whose range covers an item plus part of the next one, applied to a buffer spliced the
  same way, is self-consistent and passes. A caller that verifies a spec it did not build in
  the same call (the backend's gate 6) also matches `diff.ranges` / `diff.inserts[].at` against
  `entries[i].full` of its own `walkD2I(before)` and re-walks the target sector of `after`
  (`complete`, expected `parsed`).
- **`DiffSpec` with `bytes` does not survive JSON as-is.** `JSON.stringify` turns
  `inserts[].bytes` into a plain object and `verifyExactDiff` then throws `INVALID_ARGUMENT`
  (it fails closed, it does not skip the gap). Persist a `d2i-insert` spec with `bytes` encoded
  (base64, hex) and decode them back to a `Uint8Array` before verifying, or drop `bytes` to leave
  the gap unchecked. `d2i-remove` specs carry only numbers and round-trip unchanged.

## Materials Tab (`.d2i` sector type 1) (0.4.0)

A Blizzless materials tab holds one record per material code (runes, gems, keys, essences,
statuettes, shards, organs, potions…) and a count for each. A realm tab file is a single type-1
sector at offset 0; in a full shared stash the sector sits between the normal tabs and the
metadata sector.

Every record stores its quantity **twice**: an 8-bit post-stats field preceded by a 1-bit flag
(always 1, even for quantity 0), and the position fields, `col + 16 * row == quantity` (the tab
has no grid). A record whose quantity drops to 0 stays in the list.

```ts
import { verifyExactDiff, materialRecordEncodeInput } from 'd2r-saver';

const tab = saver.readMaterialsD2I(file, { sectorOffset: 0 });
tab.complete;                 // parsed === declared and the list ends at the sector end
tab.duplicateCodes;           // [] in a healthy tab
tab.records[0];
// { index, code: 'r01', family: 'simple', recordStart, recordEnd, quantity: 5,
//   positionQuantity: 5, quantityFlagBit: 76, quantityFlag: 1, flags, guid: null, ilvl: null,
//   loc: 0, layoutOk: true, layoutIssue: null }

// Withdraw 3 El into the tab, deposit 2 keys from it, create a record for an absent gem.
const edit = saver.editMaterialsD2I(file, {
  sectorOffset: 0,
  patches: [{ code: 'r01', from: 5, to: 8 }, { code: 'pk1', from: 3, to: 1 }],
  appends: [{ code: 'gpr', family: 'simple', quantity: 4 }],
});                           // maxQuantity defaults to 99
edit.newBuffer;               // fresh buffer; the input is never modified
edit.diff;                    // { kind: 'd2i-materials', sectorOffset, patches, appends }
edit.before; edit.after;      // sector reports before and after

verifyExactDiff(file, edit.newBuffer, edit.diff).ok;   // true

// The encoder reproduces existing records byte for byte; new records use the default flags.
saver.encodeMaterialRecord(materialRecordEncodeInput(tab.records[0]));
saver.encodeMaterialRecord({ family: 'complex', code: 'pk2', quantity: 1, guid: 0x1234, ilvl: 1 });
```

Record layouts (bits LSB-first from the record's first bit; source of truth: the item parser):

| bits | simple (runes, gems, potions) | complex (keys, essences, statuettes, shards, organs, token) |
|------|-------------------------------|-------------------------------------------------------------|
| 0–31 | flags `0x00a00010` (potions may also carry bit 10) | flags `0x00800010` |
| 32–34 | version 5 | version 5 |
| 35–52 | `loc` 0 (4 for Blizzless crafting parts), `bodyloc` 0, `col` = q & 15, `row` = q >> 4, `storage` 5 | same |
| 53… | Huffman code `"abc "` (14–23 bits) | same |
| then | 1 bit sockets (0) | 3 bits sockets (0), guid (32), ilvl (7), quality (4, = 2), four zero flags (icon, automod, extended, pre-stats quantity), stats terminator `0x1FF` (9) |
| then | quantity flag 1, quantity (8) | quantity flag 1, quantity (8) |
| tail | zero bits up to the byte boundary (10–11 bytes) | same (18 bytes) |

Rules:

- `readMaterialsD2I` accepts only a type-1 sector (`INVALID_PAGE` otherwise) and lists every
  record, zero quantities included (the `readD2I` pages hide them). `layoutOk` requires: no ear,
  personalized, runeword, extras or socketed flag, no children, `storage` 5, `bodyloc` 0, `loc`
  0 or 4, a post-stats 8-bit quantity field with flag 1, both quantity copies equal, quality 2
  for a complex record, and the flag exactly where the family's layout puts it (`54 + L` simple,
  `112 + L` complex) with zero padding after the value.
- `editMaterialsD2I` checks, in this order: complete list (`LIST_TRUNCATED`); every record
  `layoutOk`, foreign ones included (`MATERIAL_LAYOUT`); no duplicate code
  (`MATERIAL_DUPLICATE_CODE`); no code twice in the edit and at least one change
  (`INVALID_ARGUMENT`); per patch: the record exists (`MATERIAL_NOT_FOUND`), holds exactly `from`
  (`MATERIAL_STALE`), `0 ≤ to ≤ maxQuantity ≤ 255` (`MATERIAL_RANGE`); per append: the code is
  absent (`MATERIAL_ALREADY_PRESENT`), `1 ≤ quantity ≤ maxQuantity` (`MATERIAL_RANGE`), and the
  encoder reproduces every record of the same family in the sector, of which there must be at
  least one (`LAYOUT_UNVERIFIED`).
- A patch rewrites only `col`, `row` and the 8-bit value. The flag and the record length never
  change. Appends go to the end of the list (the end of the sector); the 16-bit count and
  `sectorSize` grow and following sectors shift unchanged. The result is proven with
  `assertExactDiff` and re-read before it is returned.
- `encodeMaterialRecord` is deterministic: a complex record's guid and ilvl come from the caller
  (required), there is no randomness inside the library. Bases whose records carry extra fields
  (books, charms, armor, weapons) and layout-changing flags are refused.
- `verifyExactDiff` with `{ kind: 'd2i-materials', sectorOffset, patches: [{ recordStart,
  recordEnd, quantityFlagBit, before, after }], appends: [{ bytes }] }` needs no GameData. It
  accepts only a type-1 sector, requires sorted non-overlapping patches inside the list,
  `68 ≤ quantityFlagBit ≤ 8 * length - 9`, and refuses a stale spec (flag, 8-bit value and
  `col + 16 * row` in `before` must all equal `patch.before`). The comparison covers every byte.
  `d2i-remove` and `d2i-insert` still refuse type-1 sectors.
- The game's stack cap of 99 is a game rule, not a format rule (both copies can hold 255); keep
  the default `maxQuantity`. Whether the game accepts an appended record is only shown by loading
  the tab in the game.

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

Codes added in 0.4.0 for the materials tab: `MATERIAL_LAYOUT`, `MATERIAL_DUPLICATE_CODE`,
`MATERIAL_NOT_FOUND`, `MATERIAL_STALE`, `MATERIAL_RANGE`, `MATERIAL_ALREADY_PRESENT`,
`LAYOUT_UNVERIFIED` (see "Materials Tab").

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
  operations/           — Extract, insert, readSave, in-place .d2i, materials tab, exact diff
```

## Test fixtures

`test/fixtures/` holds real Blizzless v105 saves. Every non-empty normal stash sector in them
stops parsing on a Blizzless-specific stat code (480–508) after 0–7 items; only the empty sectors
and the extended sector parse to the end. The tests pin the exact numbers (declared/parsed per
list, byte ranges of the first items) so a parser change that moves any boundary is caught.
`test/__snapshots__/compat-0.2.1/` freezes the 0.2.1 output of `readD2S`/`readD2I` for every
fixture; the compatibility test strips only the fields added since.

### `SharedStashComplete.d2i` (synthetic)

The in-place insert path only accepts a **complete** non-empty normal sector, and the real
fixtures contain none. `SharedStashComplete.d2i` is built from them through the public in-place
API (`test/helpers/shared-stash-complete.ts`, regenerate with `npm run build:fixtures`):

1. `extractInPlaceD2I(..., { requireCompleteList: false })` cuts the walkable prefix of three
   truncated sectors: `cm1` (first item of sector @0) and `ci2` (first item of sector @989) of
   `SharedStashSoftCoreV2V105.d2i`, and the seven items of sector @1210 of
   `SharedStashSoftCoreV2V105_.d2i` (two amulets, five rings).
2. `insertInPlaceD2I` pastes all nine into the first empty sector of the shrunk
   `SharedStashSoftCoreV2V105.d2i`, each at the cell it originally occupied.

Result (2778 bytes): sector @0 (949 bytes, 0/14 parsed), @949 (336, 0/6), **@1285 (359, 9/9,
complete)**, two empty sectors @1644 and @1712, the extended sector @1780 (56/56) and the
metadata sector @2610. The complete sector's raw grid marks 12 cells (`ci2` is 2×2). Items keep
their guid and stats across the move; note that the source stash already carries duplicated
guids (the two amulets share one, three of the rings another).

The build is deterministic and self-checked: the walker both builds the tab and verifies it, and
`test/shared-stash-complete.test.ts` fails if the committed file differs from a fresh build.
Caveat: this proves the library is consistent with itself; whether the game accepts such a tab
is only shown by loading it in the game.

### `MaterialsTabSeller.d2i` / `MaterialsTabBuyer.d2i` (synthetic, 0.4.0)

Single-sector materials tabs (one type-1 sector at offset 0, the realm's file shape), built only
from the materials sector of `SharedStashComplete.d2i` (`test/helpers/materials-fixtures.ts`,
regenerate with `npm run build:fixtures:materials`): copy the 64-byte sector header and the `JM`
list header, copy the chosen records, fix the count and `sectorSize`, then set quantities with
`editMaterialsD2I` and add `gpv` through an append.

- Seller (176 bytes): `rvl` 99, `glb` 0, `r01` 5, `r10` 3, `pk1` 3, `tes` 2, `ua1` 1, `gpv` 4.
- Buyer (129 bytes): `rvl` 99, `glb` 0, `r01` 0 (record present), `r10` 98 (one below the cap),
  `tes` 1; `pk1` and `gpv` are absent.

`test/materials-d2i.test.ts` pins their SHA-256 and fails if a fresh build differs. An optional
block of that test reads a local copy of a real materials tab when the environment variable
`STASH_MATERIALS_OWNER_COPY` points to it (read-only, only hashes and counts are logged, nothing
is committed); it is skipped otherwise.

## Development

```bash
npm test                # run tests (vitest)
npm run build           # compile TypeScript
npm run probe           # build, then run test/probe/inplace-probe.mjs (in-place editing on the public API)
npm run build:fixtures  # regenerate test/fixtures/SharedStashComplete.d2i
npm run build:fixtures:materials  # regenerate test/fixtures/MaterialsTab{Seller,Buyer}.d2i
```

## Requirements

- Node.js ≥ 18
- Blizzless v105 save files only
