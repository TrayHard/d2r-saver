# d2r-saver

Blizzless D2R v105 save file reader/writer library. Ported from d2planner.

## Features

- Read/write `.d2s` (character) and `.d2i` (shared stash) files
- Extract and insert items between save files
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

## Architecture

```
src/
  index.ts              — D2RSaver facade + re-exports
  core/                 — BinaryReader, BitWriter, Huffman, checksum
  types/                — Constants, enums, errors
  game-data/            — GameData class (data.json + strings.json)
  formats/              — D2S/D2I readers/writers, item parser/writer
  items/                — Item types, stats, serializer, icons, DTO
  inventory/            — Grid, placement, dimensions
  operations/           — Extract, insert, readSave
```

## Development

```bash
npm test          # run tests (vitest)
npm run build     # compile TypeScript
```

## Requirements

- Node.js ≥ 18
- Blizzless v105 save files only
