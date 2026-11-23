# Changelog

## 1.2.0

- The stat tables of older games are data, not code: `data/txt/older/` holds the save columns of
  their `itemstatcost.txt`, `npm run build:data` puts them into `data/data.json` as
  `olderStatTables`, and `readSave` takes them from there. The numbers are those of 1.1.0. A caller
  that keeps a `data.json` of its own takes the new one to keep reading season 2 and D2R saves.
- `parseStatTable` makes a stat table from the text of an `itemstatcost.txt`, and `readSave` takes
  such tables in `statTables`, so a save of another mod reads without a new version of the library.
- A stat table the read core refuses is reported (DATA_NOT_LOADED) instead of skipped.
- `test/fixtures/BlizzlessBartuc.d2s`: a v105 character of the current mod, saved by the game client.
  The README says which game each fixture comes from.

## 1.1.0

- The trade site line 0.4.11-0.4.17 is merged: tables of the Blizzless mod of 14.11.2026 (Bartuc
  patch, saved stats 474-477), `chargesLeft`, materials fixes, Larzuk sockets, gold in place.
- `readSave` reads a file of any save version and season: it detects v99 and v105, tries the current
  stat table, then Blizzless season 2 and D2R without the mod, and returns `version` and `statTable`.
  A v99 shared stash comes as `type: 'd2i-v99'` with the walked sectors. Files that were refused
  with INVALID_FORMAT because of version 99 are read now; `detectFormat` still accepts 105 only.
- The Rust core returns `socketsFieldBit` and `contentBits`.
- `character_details` of the Rust core says in `broken` when a list broke off and its rows are not
  the whole save.
- `setCharacterGold` no longer refuses a file whose broken list stops at the end of the buffer.

## 1.0.0

Every save is now read by a Rust core compiled to WebAssembly. The objects are the same as those
of the 0.4 TypeScript reader, key order included.

### Reading

- `readD2S`, `readLegacyD2S`, `readD2I`, `readSave`, `walkD2I`, `walkLegacyD2I`, `walkItemList`,
  `readItemHead` and `readD2SDemonSection` read through `rust/core` (`d2r-saver-core`), compiled
  to a 353 KB WebAssembly module with no imports and embedded in the package. The same build runs
  in Node on Windows and Linux, in Docker and in browsers; there is no native addon and no `.wasm`
  file to serve. Everything built on them reads through it too: extract and insert, the in-place
  `.d2i` operations, the materials tab and token deserialization.
- The affix solver stays in TypeScript and runs on the core's stats where the 0.4 parser ran it,
  so `uniqueValues`, `propertyIndex`, `mods`, `auto`, `staff`, `crafted`, `superior` and `custom`
  are unchanged.
- New `ready()`: compiles the module asynchronously. Browsers may refuse synchronous compilation
  on the main thread; there, `await ready()` before the first read. `D2RSaver.create` awaits it.
- New `ReadOptions` `{ resolveMods: false }` for every reader and walker: skips the affix solver
  when you only count or locate items. Identity, quality, affix codes, quantities, sockets,
  locations and byte ranges are the same in both modes.
- Verified equal to the TypeScript reader on 855,323 real saves (2,480,656 reads) and 290,232
  cut or bit-flipped copies (621,795 reads): 0 differences, errors included.
- A full character read takes 7.53 ms instead of 8.20 ms on average; a read has a fixed cost of
  about 10 µs, so tiny saves and reads without the solver are slightly slower (see the README).

### Fixes since 0.4.10

- A broken item list no longer loses the sections after it: after a failed item the `.d2s`
  reader finds the corpse, hireling and iron-golem sections by their headers.
- An item code on the empty Huffman branch is an invalid item (`PARSE_ERROR`), not an item of an
  unknown base.

### Removed

- The internal `createItemParser` and `statIdMap` (not exported from the package). Their types
  (`ParserOptions`, `ItemHandler`, `ParsedItemTrace`, `ParseItemListOptions`) stay exported.

### Building from source

- `npm run build` needs Rust with `wasm32-unknown-unknown`; `npm run build:wasm` builds the module.
- `rust/core` (1.0.0) can be used from Rust programs directly; `rust/cli` (`d2r-scan`) counts the
  items of saves given as JSON lines.
