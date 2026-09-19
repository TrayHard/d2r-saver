// In-place editing probe on the public d2r-saver 0.3.0 API.
//
// A runnable example and a smoke check in one: it reproduces the reconnaissance probe that
// proved in-place editing on the fixtures (offline-trade notes, `scout-saver-probe.mjs`),
// rewritten on top of the published API (`dist/index.js` only, no internal modules).
//
// - `.d2s`: the list walk, the standalone re-parse of a cut range and the position patching
//   come from the library; the splice itself and the header fix (size + checksum) are local
//   helpers, because in-place `.d2s` operations are not part of 0.3.0 (design phase 6.2).
// - `.d2i`: everything goes through `extractInPlaceD2I` / `insertInPlaceD2I` /
//   `verifyExactDiff`. Insertion into a truncated sector is refused by design, so the old
//   "re-insert into the truncated sector" checks became insertions into an empty sector and into
//   the synthetic complete sector of `SharedStashComplete.d2i`.
//
// Reads fixtures and dist/, writes nothing. Run: `npm run probe` (builds dist first).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const {
  D2RSaver, D2RSaverError, ErrorCode,
  walkItemList, walkD2I, readItemHead, patchItemPosition, zeroItemPosition,
  extractInPlaceD2I, insertInPlaceD2I, verifyExactDiff, readD2ISectorChain,
} = await import(`file:///${ROOT.replace(/\\/g, '/')}/dist/index.js`);

const saver = await D2RSaver.create({ dataPath: `${ROOT}/data/data.json`, stringsPath: `${ROOT}/data/strings.json` });
const gd = saver.gd;
const fixture = (name) => new Uint8Array(readFileSync(resolve(ROOT, 'test', 'fixtures', name)));

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const setU16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
const setU32 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };
const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const rangeOf = (e) => [e.full.start, e.full.end];

let failures = 0;
let checks = 0;
const check = (name, ok, extra = '') => {
  checks++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const throwsCode = (fn, code) => {
  try { fn(); return { ok: false, got: 'no error' }; } catch (e) {
    return { ok: e instanceof D2RSaverError && e.code === code, got: e instanceof D2RSaverError ? `${e.code}: ${e.message}` : String(e) };
  }
};

/** Parse a cut byte range standalone (JM + count=1 + bytes): it must be exactly one item. */
function standaloneCheck(bytes) {
  const w = new Uint8Array(4 + bytes.length);
  w[0] = 0x4a; w[1] = 0x4d; w[2] = 1; w[3] = 0; w.set(bytes, 4);
  const { report } = walkItemList(w, 0, gd, { expectedEnd: w.length });
  return { ok: report.complete && report.parsed === 1, error: report.error, consumed: report.endOffset - 4, expected: bytes.length };
}

function describeEntry(e) {
  const h = e.head;
  const kind = h.ear ? 'ear' : h.simple ? 'simple' : 'extended';
  return `#${e.index + 1} [${e.full.start},${e.full.end}) len=${e.full.end - e.full.start} ${kind} base=${h.base ?? '?'} guid=${e.item.guid ?? '-'} sockets=${e.item.sockets ?? 0} loc=${h.loc} storage=${h.storage} col=${h.col} row=${h.row} bodyloc=${h.bodyloc} key=${e.registeredKey ?? 'dropped'}`;
}

// ─── .d2s: local helpers (in-place .d2s operations are design phase 6.2) ───────

/** D2S rolling checksum over the whole file with the checksum field read as zero. */
function d2sChecksum(data) {
  let checksum = 0;
  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    if (i >= 12 && i < 16) byte = 0;
    if (checksum & 0x80000000) byte += 1;
    checksum = (byte + checksum * 2) >>> 0;
  }
  return checksum;
}
function fixD2SHeader(buf) {
  setU32(buf, 8, buf.length);
  setU32(buf, 12, 0);
  setU32(buf, 12, d2sChecksum(buf));
}
function spliceOutD2S(buf, jm, range) {
  const out = new Uint8Array(buf.length - (range.end - range.start));
  out.set(buf.subarray(0, range.start), 0);
  out.set(buf.subarray(range.end), range.start);
  setU16(out, jm + 2, u16(buf, jm + 2) - 1);
  fixD2SHeader(out);
  return out;
}
function spliceInD2S(buf, jm, at, bytes) {
  const out = new Uint8Array(buf.length + bytes.length);
  out.set(buf.subarray(0, at), 0);
  out.set(bytes, at);
  out.set(buf.subarray(at), at + bytes.length);
  setU16(out, jm + 2, u16(buf, jm + 2) + 1);
  fixD2SHeader(out);
  return out;
}
const shiftStop = (error, delta) => (error ? error.replace(/item (\d+)\/(\d+)/, (_, a, b) => `item ${+a + delta}/${+b + delta}`) : null);

for (const f of ['WarlockTest.d2s', 'WarlockShards.d2s']) {
  console.log(`\n=== ${f} ===`);
  const buf = fixture(f);
  const main = saver.readD2S(buf).lists.main;
  const { headerOffset: jm, declared: count, firstItemOffset: first } = main;
  console.log(`bytes=${buf.length} filesize@8=${u32(buf, 8)} checksum@12=0x${u32(buf, 12).toString(16)} recomputed=0x${d2sChecksum(buf).toString(16)}`);
  check('original header: filesize == length', u32(buf, 8) === buf.length);
  check('original header: checksum matches', u32(buf, 12) === d2sChecksum(buf));
  console.log(`main JM at ${jm}, declared count=${count}, first item at ${first}`);

  const walk = walkItemList(buf, jm, gd);
  console.log(`walked ${walk.entries.length}/${count} items, stop=${walk.report.error ?? 'none'}, endOffset=${walk.report.endOffset}`);
  for (const e of walk.entries) console.log('  ' + describeEntry(e));
  const base = saver.readD2S(buf);
  console.log(`library readD2S: parsed=${Object.keys(base.items).length} warnings=${JSON.stringify(base.warnings)}`);

  const firstSimple = walk.entries.find(e => e.head.simple && !e.head.ear);
  const firstExt = walk.entries.find(e => !e.head.simple && !e.head.ear);
  for (const [tag, e] of [['first simple', firstSimple], ['first extended', firstExt]]) {
    if (!e) { console.log(`  (no ${tag} item before truncation)`); continue; }
    console.log(`\n-- extract ${tag}: ${describeEntry(e)}`);
    const cut = buf.slice(e.full.start, e.full.end);
    console.log(`  cut bytes: ${hex(cut)}`);
    const sa = standaloneCheck(cut);
    check('cut range re-parses standalone as exactly one item', sa.ok, `consumed ${sa.consumed}/${sa.expected}${sa.error ? ' err=' + sa.error : ''}`);

    const out = spliceOutD2S(buf, jm, e.full);
    check('bytes [0,8) identical', eq(out.subarray(0, 8), buf.subarray(0, 8)));
    check('bytes [16, jm+2) identical', eq(out.subarray(16, jm + 2), buf.subarray(16, jm + 2)));
    check('bytes [jm+4, start) identical', eq(out.subarray(jm + 4, e.full.start), buf.subarray(jm + 4, e.full.start)));
    check('bytes [start, end-of-file) == original [end, eof)', eq(out.subarray(e.full.start), buf.subarray(e.full.end)));
    check('count decremented', u16(out, jm + 2) === count - 1, `${u16(out, jm + 2)}`);
    check('filesize field == new length', u32(out, 8) === out.length, `${u32(out, 8)} vs ${out.length}`);
    check('checksum field == recomputed', u32(out, 12) === d2sChecksum(out));
    const walk2 = walkItemList(out, jm, gd);
    check('truncation point shifted by exactly one item', walk2.report.error === shiftStop(walk.report.error, -1), `${walk2.report.error}`);
    const len = e.full.end - e.full.start;
    const expectedRanges = walk.entries.filter(x => x !== e).map(x => x.full.start < e.full.start ? rangeOf(x) : [x.full.start - len, x.full.end - len]);
    check('remaining item ranges identical (shifted)', JSON.stringify(expectedRanges) === JSON.stringify(walk2.entries.map(rangeOf)));
    const rep = saver.readD2S(out);
    console.log(`  library readD2S after extract: parsed=${Object.keys(rep.items).length} warnings=${JSON.stringify(rep.warnings)}`);
    const sig = (w) => w.entries.map(x => `${x.head.base ?? '?'}:${x.item.guid ?? '-'}`);
    check('walked (base,guid) sequence == original minus removed', JSON.stringify(sig(walk2)) === JSON.stringify(sig(walk).filter((_, i) => walk.entries[i] !== e)), JSON.stringify(sig(walk2)));

    const back = spliceInD2S(out, jm, e.full.start, cut);
    check('re-insert at original offset restores the original file byte-for-byte', eq(back, buf));

    const moved = patchItemPosition(cut, { loc: 0, bodyloc: 0, col: 9, row: 7, storage: 5 });
    const out2 = spliceInD2S(out, jm, first, moved);
    const walk3 = walkItemList(out2, jm, gd);
    const h3 = walk3.entries[0]?.head;
    check('inserted-at-head item parses with the new position bits', !!h3 && h3.loc === 0 && h3.storage === 5 && h3.col === 9 && h3.row === 7, JSON.stringify(h3));
    const prof = saver.readD2S(out2).profile;
    check('inserted-at-head item lands in stash slot 7*16+9 of the profile', prof.stash[7 * 16 + 9] !== undefined, `stash[121]=${prof.stash[7 * 16 + 9]}`);
    const it0 = walk3.entries[0]?.item;
    check('moved item keeps base/guid/stats', !!it0 && it0.base === e.item.base && it0.guid === e.item.guid && JSON.stringify(it0.stats) === JSON.stringify(e.item.stats), `${it0?.base} guid=${it0?.guid}`);
    check('bytes after the inserted item identical to the extracted file', eq(out2.subarray(first + cut.length), out.subarray(first)));
    check('moved file: filesize+checksum consistent', u32(out2, 8) === out2.length && u32(out2, 12) === d2sChecksum(out2));
    check('moved file: truncation at the same item index (item moved before it)', walk3.report.error === walk.report.error, `${walk3.report.error}`);
    check('zeroItemPosition: moved and original hash the same', sha256(zeroItemPosition(moved)) === sha256(zeroItemPosition(cut)));
  }
}

// ─── .d2i: the real fixtures (every non-empty normal sector is truncated) ───────

const complete = fixture('SharedStashComplete.d2i');
const COMPLETE_SECTOR = 1285;
const COMPLETE_EMPTY = 1644;

for (const f of ['SharedStashSoftCoreV2V105_.d2i', 'SharedStashSoftCoreV2V105.d2i']) {
  console.log(`\n=== ${f} ===`);
  const buf = fixture(f);
  const report = walkD2I(buf, gd);
  for (const s of report.sectors) {
    const list = s.walk ? `${s.walk.report.parsed}/${s.walk.report.declared}${s.walk.report.complete ? ' complete' : ` stop=${s.walk.report.error} endOffset=${s.walk.report.endOffset} (sector end ${s.offset + s.size})`}` : 'metadata';
    console.log(`  sector @${s.offset} size=${s.size} type=${s.type} gold=${s.gold} ${list}`);
    for (const e of (s.walk?.entries ?? []).slice(0, 4)) console.log('    ' + describeEntry(e) + ` qty=${e.item.quantity ?? '-'}`);
    if (s.walk && s.walk.entries.length > 4) console.log(`    ... ${s.walk.entries.length - 4} more`);
  }
  check('sectors tile the file exactly', report.tiled && report.reachedEof && readD2ISectorChain(buf).length === report.sectors.length);
  const before = saver.readD2I(buf);
  console.log(`  library readD2I: pages=${before.pages.length} items=${Object.keys(before.items).length} warnings=${JSON.stringify(before.warnings)}`);

  const pick = report.sectors.filter(s => s.type === 0 && s.walk.entries.length > 0).sort((a, b) => (b.walk.report.complete - a.walk.report.complete) || (b.walk.entries.length - a.walk.entries.length))[0];
  if (!pick) { console.log('  no normal sector with at least one walkable item'); continue; }
  const walk = pick.walk;
  console.log(`  -> using sector @${pick.offset} (${walk.report.complete ? 'complete' : 'truncated'}) for the in-place cut`);
  const e = walk.entries[0];
  console.log('  cut: ' + describeEntry(e));
  const len = e.full.end - e.full.start;

  const cut = extractInPlaceD2I(buf, { sectorOffset: pick.offset, indexes: [0] }, gd, { requireCompleteList: false });
  const out = cut.newBuffer;
  const removed = cut.removed[0];
  console.log(`  cut bytes (position zeroed): ${hex(removed.bytes)}`);
  const sa = standaloneCheck(removed.bytes);
  check('cut range re-parses standalone as exactly one item', sa.ok, `consumed ${sa.consumed}/${sa.expected}${sa.error ? ' err=' + sa.error : ''}`);
  check('other sectors byte-identical (before target)', eq(out.subarray(0, pick.offset), buf.subarray(0, pick.offset)));
  check('target sector header identical except sectorSize', eq(out.subarray(pick.offset, pick.offset + 16), buf.subarray(pick.offset, pick.offset + 16)) && eq(out.subarray(pick.offset + 20, pick.offset + 66), buf.subarray(pick.offset + 20, pick.offset + 66)));
  check('other sectors byte-identical (after target)', eq(out.subarray(pick.offset + pick.size - len), buf.subarray(pick.offset + pick.size)));
  const after = saver.readD2I(out);
  check('page count unchanged', after.pages.length === before.pages.length);
  check('truncation point shifted by exactly one item', cut.listAfter.error === shiftStop(walk.report.error, -1), `${cut.listAfter.error}`);
  const walk2 = walkD2I(out, gd).sectors.find(s => s.offset === pick.offset).walk;
  check('remaining item ranges identical (shifted)', JSON.stringify(walk.entries.slice(1).map(x => [x.full.start - len, x.full.end - len])) === JSON.stringify(walk2.entries.map(rangeOf)));
  const v = verifyExactDiff(buf, out, cut.diff);
  check('verifyExactDiff: the file differs by exactly the declared removal', v.ok, `${v.mismatchCount} mismatch(es), length ${v.actualLength}/${v.expectedLength}`);
  console.log(`  library readD2I after cut: pages=${after.pages.length} items=${Object.keys(after.items).length} warnings=${JSON.stringify(after.warnings)}`);

  // Insertion into a truncated sector is refused by design (replaces the old re-insert check).
  const refused = throwsCode(() => insertInPlaceD2I(out, { sectorOffset: pick.offset }, [{ bytes: removed.bytes, col: e.head.col, row: e.head.row }], gd), ErrorCode.LIST_TRUNCATED);
  check('re-insert into the truncated sector is refused with LIST_TRUNCATED', refused.ok, refused.got);

  // Insert into an EMPTY normal sector: of this file if it has one, otherwise of SharedStashComplete.d2i.
  const emptyHere = walkD2I(out, gd).sectors.find(s => s.type === 0 && s.walk.report.declared === 0);
  const [targetBuf, targetOff, targetName] = emptyHere ? [out, emptyHere.offset, `${f} @${emptyHere.offset}`] : [complete, COMPLETE_EMPTY, `SharedStashComplete.d2i @${COMPLETE_EMPTY}`];
  console.log(`  -> inserting the cut item into the empty sector ${targetName} at column 15, row 12`);
  const ins = insertInPlaceD2I(targetBuf, { sectorOffset: targetOff }, [{ bytes: removed.bytes, col: 15, row: 12 }], gd);
  const h3 = ins.inserted[0].head;
  check('inserted item parses first in the empty sector with the new position', ins.inserted[0].index === 0 && h3.storage === 5 && h3.col === 15 && h3.row === 12 && h3.base === e.head.base, JSON.stringify(h3));
  const after2 = saver.readD2I(ins.newBuffer);
  const page = after2.pages.find(p => p.offset === targetOff);
  check('readD2I sees the item in stash slot 12*16+15 of that page', !!page && page.stash[12 * 16 + 15] !== undefined && after2.items[page.stash[12 * 16 + 15]]?.base === e.head.base && after2.tiled, `pages=${after2.pages.length} warnings=${JSON.stringify(after2.warnings)}`);
  check('empty sector list is 1/1 and complete after the insert', ins.listBefore.declared === 0 && ins.listAfter.parsed === 1 && ins.listAfter.declared === 1 && ins.listAfter.complete);
  const v2 = verifyExactDiff(targetBuf, ins.newBuffer, ins.diff);
  check('verifyExactDiff: the file differs by exactly the declared insertion', v2.ok, `${v2.mismatchCount} mismatch(es)`);
  const moved = walkD2I(ins.newBuffer, gd).sectors.find(s => s.offset === targetOff).walk.entries[0].item;
  check('moved item keeps base/guid/stats', moved.base === e.item.base && moved.guid === e.item.guid && JSON.stringify(moved.stats) === JSON.stringify(e.item.stats), `${moved.base} guid=${moved.guid}`);

  // Insert into the COMPLETE (non-empty) sector of SharedStashComplete.d2i at a free cell.
  const ins2 = insertInPlaceD2I(complete, { sectorOffset: COMPLETE_SECTOR }, [{ bytes: removed.bytes, col: 15, row: 12 }], gd);
  check('insert into the complete sector of SharedStashComplete.d2i: 10/10 complete, diff exact', ins2.listAfter.parsed === 10 && ins2.listAfter.complete && verifyExactDiff(complete, ins2.newBuffer, ins2.diff).ok);
}

// ─── SharedStashComplete.d2i: the production path (complete non-empty sector) ───

console.log('\n=== SharedStashComplete.d2i ===');
{
  const report = walkD2I(complete, gd);
  const sector = report.sectors.find(s => s.offset === COMPLETE_SECTOR);
  for (const s of report.sectors) {
    const list = s.walk ? `${s.walk.report.parsed}/${s.walk.report.declared}${s.walk.report.complete ? ' complete' : ''}` : 'metadata';
    console.log(`  sector @${s.offset} size=${s.size} type=${s.type} ${list}`);
  }
  check('sectors tile the file exactly', report.tiled && report.reachedEof);
  check('sector @1285 walks 9/9 and is complete', sector.walk.report.parsed === 9 && sector.walk.report.declared === 9 && sector.walk.report.complete);
  for (const e of sector.walk.entries) console.log('    ' + describeEntry(e));

  for (const e of sector.walk.entries) {
    const cut = extractInPlaceD2I(complete, { sectorOffset: COMPLETE_SECTOR, indexes: [e.index] }, gd);
    const back = insertInPlaceD2I(cut.newBuffer, { sectorOffset: COMPLETE_SECTOR, listIndex: e.index }, [{ bytes: cut.removed[0].bytes, col: e.head.col, row: e.head.row }], gd);
    check(`round trip item #${e.index + 1} (${e.head.base}@${e.head.col},${e.head.row}): extract → insert restores the file byte-for-byte`, eq(back.newBuffer, complete) && cut.listAfter.complete && cut.listAfter.parsed === 8);
  }

  const multi = extractInPlaceD2I(complete, { sectorOffset: COMPLETE_SECTOR, indexes: [8, 2, 5] }, gd);
  const total = multi.removed.reduce((s, r) => s + r.bytes.length, 0);
  check('three items in one cut: count 9→6, sectorSize -sum, list complete', u16(multi.newBuffer, COMPLETE_SECTOR + 66) === 6 && u32(multi.newBuffer, COMPLETE_SECTOR + 16) === sector.size - total && multi.listAfter.complete && multi.listAfter.parsed === 6, `removed ${multi.removed.map(r => r.index).join(',')} (${total} bytes)`);
  const mutated = multi.newBuffer.slice();
  mutated[COMPLETE_SECTOR + 30] ^= 0x01;
  const vm = verifyExactDiff(complete, mutated, multi.diff);
  check('verifyExactDiff catches one flipped byte in the sector header', !vm.ok && vm.mismatchCount === 1 && vm.mismatches[0].offset === COMPLETE_SECTOR + 30 && verifyExactDiff(complete, multi.newBuffer, multi.diff).ok, JSON.stringify(vm.mismatches));

  const item = extractInPlaceD2I(complete, { sectorOffset: COMPLETE_SECTOR, indexes: [3] }, gd).removed[0].bytes;
  const r1 = throwsCode(() => insertInPlaceD2I(complete, { sectorOffset: 0 }, [{ bytes: item, col: 15, row: 12 }], gd), ErrorCode.LIST_TRUNCATED);
  check('insert into a truncated sector → LIST_TRUNCATED', r1.ok, r1.got);
  const r2 = throwsCode(() => insertInPlaceD2I(complete, { sectorOffset: 1780 }, [{ bytes: item, col: 0, row: 0 }], gd), ErrorCode.INVALID_PAGE);
  check('insert into the extended sector → INVALID_PAGE', r2.ok, r2.got);
  const r3 = throwsCode(() => extractInPlaceD2I(complete, { sectorOffset: 2610, indexes: [0] }, gd), ErrorCode.INVALID_PAGE);
  check('extract from the metadata sector → INVALID_PAGE', r3.ok, r3.got);
  const r4 = throwsCode(() => insertInPlaceD2I(complete, { sectorOffset: COMPLETE_SECTOR }, [{ bytes: item, col: 8, row: 0 }], gd), ErrorCode.NO_FREE_SLOT);
  check('insert onto a taken cell → NO_FREE_SLOT', r4.ok, r4.got);

  const t0 = performance.now();
  const truncated = walkD2I(complete.slice(0, COMPLETE_SECTOR + 200), gd);
  const ms = performance.now() - t0;
  const rep = truncated.sectors.find(s => s.offset === COMPLETE_SECTOR).walk.report;
  check('file cut inside the sector → BUFFER_OVERRUN in milliseconds', rep.errorCode === ErrorCode.BUFFER_OVERRUN && !truncated.tiled && ms < 100, `${rep.error} (${ms.toFixed(1)} ms)`);
}

console.log(`\n${checks} checks, ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exitCode = failures === 0 ? 0 : 1;
