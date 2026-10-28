import { beforeAll, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { D2RSaver, type BinaryParsedItem } from "../src/index.js";
let saver: D2RSaver;
beforeAll(async () => { saver = await D2RSaver.create({ dataPath: fileURLToPath(new URL("../data/data.json", import.meta.url)),
  stringsPath: fileURLToPath(new URL("../data/strings.json", import.meta.url)) }); });
test("item writes preserve guid independently of parse-order itemId", () => {
  const item: BinaryParsedItem = { itemId: 1, guid: 0xabcdef01, base: "hax", quality: 2, ilvl: 1, unidentified: false,
    ethereal: false, socketed: false, sockets: 0, socketedItems: [], stats: {}, binaryOffset: { start: 0, end: 0 } };
  const bytes = saver.writeStash([{ pageType: 0, gold: 0, entries: [{ item, location: { loc: 0, equip: 0, x: 0, y: 0, storage: 5 } }] }], { 1: item });
  const parsed = saver.walkD2I(bytes).sectors[0].walk!.entries[0].item;
  expect(parsed.guid).toBe(0xabcdef01);
  expect(parsed.itemId).not.toBe(parsed.guid);
  const read = saver.readD2I(bytes);
  const rewritten = saver.writeStash(saver.buildStashWritePages(read.pages, read.items), read.items);
  expect(saver.walkD2I(rewritten).sectors[0].walk!.entries[0].item.guid).toBe(0xabcdef01);
});
test("inserting a second character item never treats parse ID zero as an empty cell", () => {
  let bytes = saver.writeD2S({ name: "ZzEditor", class: "war", level: 10, stats: { str: 10, dex: 5, int: 5, vit: 10 },
    skills: {}, quests: [], items: {}, mercItems: {}, inventory: [], cube: [], stash: [], belt: [] }, {});
  for (const guid of [10001, 10002]) {
    const item: BinaryParsedItem = { itemId: 1, guid, base: "hax", quality: 2, ilvl: 1, unidentified: false, ethereal: false,
      socketed: false, sockets: 0, socketedItems: [], stats: {}, binaryOffset: { start: 0, end: 0 } };
    bytes = saver.insertItemD2S(bytes, item, { 1: item }, "inventory").newBuffer;
  }
  const parsed = saver.readD2S(bytes);
  expect(parsed.lists.main!.declared).toBe(2);
  expect(Object.values(parsed.items).map(item => item.guid)).toEqual([10001, 10002]);
});
