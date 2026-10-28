export { detectFormat, type DetectedFormat } from './detect.js';
export {
  createItemParser,
  type BinaryParsedItem,
  type ItemHandler,
  type ItemParserContext,
  type ByteRange,
  type ItemListReport,
  type ParsedItemTrace,
  type ParserOptions,
  type ParseItemListOptions,
} from './item-parser.js';
export {
  readD2S,
  type D2SReadResult,
  type D2SCharacterProfile,
  type D2SItemLists,
} from './d2s-reader.js';
export {
  readD2I,
  type D2IReadResult,
  type D2IStashPage,
  type D2ISectorSummary,
  type ExtendedPageType,
} from './d2i-reader.js';
export {
  walkItemList,
  walkD2I,
  readItemHead,
  readItemPosition,
  patchItemPosition,
  zeroItemPosition,
  ITEM_POSITION_BIT,
  ITEM_POSITION_BITS,
  ITEM_BASE_BIT,
  type ItemHead,
  type ItemPosition,
  type WalkedItem,
  type WalkResult,
  type WalkItemListOptions,
  type D2IWalkedSector,
  type D2IParseReport,
} from './item-walker.js';
export {
  writeItem,
  writeItemList,
  buildWriteEntries,
  type ItemWriteEntry,
  type ItemWriteLocation,
} from './item-writer.js';
export { writeD2S, type WriteD2SOptions } from './d2s-writer.js';
export {
  writeStash,
  buildStashWritePages,
  patchStashPage,
  type WriteStashPage,
} from './d2i-writer.js';

export { readD2SDemonSection, type D2SDemonSectionReport, type D2SDemonRecord, type D2SDemonStat } from './d2s-demon-reader.js';
export type { D2SParseCoverage } from './d2s-coverage.js';
