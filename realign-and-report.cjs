/**
 * One-off: realign current `diablo files` excel tables into the COLUMN ORDER the
 * d2r-saver parsers expect (the parsers use fixed indices matching the OLD game-file
 * layout; the current files inserted columns, shifting everything). We read the OLD
 * header (already in data/txt) as the target schema and pull each current row's cells
 * BY COLUMN NAME into the old positions. Scoped to item tables to limit blast radius.
 */
const fs = require("fs");
const path = require("path");

const SAVER_TXT = path.resolve(__dirname, "data/txt");
const EXCEL = path.resolve(__dirname, "../diablo files/data/global/excel");

// Only the tables the backend import (and their direct deps) consume.
const ITEM_FILES = new Set([
  "misc.txt", "armor.txt", "weapons.txt", "uniqueitems.txt", "setitems.txt",
  "sets.txt", "itemtypes.txt", "properties.txt", "itemstatcost.txt",
  "gems.txt", "runes.txt", "skills.txt", "skilldesc.txt",
  "magicprefix.txt", "magicsuffix.txt", "rareprefix.txt", "raresuffix.txt",
  "automagic.txt", "belts.txt", "charstats.txt",
]);

// Columns the current files RENAMED (sometimes with inverted meaning). Keyed by the
// OLD column name the parsers expect → how to source it from the current header.
const COLUMN_ALIASES = {
  // current uniqueitems renamed "enabled" -> "disabled" with INVERTED semantics
  // (disabled=1 means off). The parser keeps rows where enabled === "1".
  enabled: { from: "disabled", invert: true },
};

function resolveCell(name, cells, curIdx) {
  if (curIdx[name] != null) return cells[curIdx[name]] ?? "";
  const alias = COLUMN_ALIASES[name];
  if (alias && curIdx[alias.from] != null) {
    const raw = (cells[curIdx[alias.from]] ?? "").trim();
    return alias.invert ? (raw === "1" ? "0" : "1") : raw;
  }
  return "";
}

function readLines(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw.replace(/\r/g, "").split("\n");
}

const excelByLower = {};
for (const f of fs.readdirSync(EXCEL)) {
  if (f.toLowerCase().endsWith(".txt")) excelByLower[f.toLowerCase()] = f;
}
const saverByLower = {};
for (const f of fs.readdirSync(SAVER_TXT)) {
  if (f.toLowerCase().endsWith(".txt")) saverByLower[f.toLowerCase()] = f;
}

const report = [];
for (const lower of ITEM_FILES) {
  if (!excelByLower[lower] || !saverByLower[lower]) {
    report.push({ file: lower, status: "SKIP (not in both dirs)" });
    continue;
  }
  const saverPath = path.join(SAVER_TXT, saverByLower[lower]);
  const excelPath = path.join(EXCEL, excelByLower[lower]);
  const oldLines = readLines(saverPath);
  const curLines = readLines(excelPath);
  const oldHeader = oldLines[0].split("\t");
  const curHeader = curLines[0].split("\t");
  const curIdx = {};
  curHeader.forEach((name, i) => {
    if (!(name in curIdx)) curIdx[name] = i;
  });
  const missingCols = oldHeader.filter(
    (n) => n !== "" && !(n in curIdx) && !(n in COLUMN_ALIASES && curIdx[COLUMN_ALIASES[n].from] != null),
  );

  const out = [oldHeader.join("\t")];
  let dataRows = 0;
  for (let r = 1; r < curLines.length; r++) {
    const line = curLines[r];
    if (line === "") {
      out.push("");
      continue;
    }
    const cells = line.split("\t");
    out.push(oldHeader.map((name) => resolveCell(name, cells, curIdx)).join("\t"));
    dataRows++;
  }
  fs.writeFileSync(saverPath, out.join("\n"));
  report.push({
    file: lower,
    oldCols: oldHeader.length,
    curCols: curHeader.length,
    oldDataRows: oldLines.length - 1,
    newDataRows: dataRows,
    missingCols: missingCols.length ? missingCols : undefined,
  });
}

console.log(JSON.stringify(report, null, 1));
