# Strict v105 character coverage (0.4.2)

`D2RSaver.readD2S(bytes)` adds two reports. Existing profile fields, item dictionaries and raw section preservation remain available. A successful high-level read or an empty warning list is not a traversal certificate.

```ts
const parsed = saver.readD2S(bytes);
if (!parsed.coverage.complete) throw new Error('Uncertified character save');
for (const entry of parsed.coverage.items) {
  // Inspect the physical parent and recursively inspect entry.children.
  // entry.full and entry.own are absolute half-open byte ranges in bytes.
}
```

- `coverage.complete`: verified size/checksum, supported prefix, complete counted item lists, physical ranges, contiguous known sections and exact EOF.
- `coverage.items`: every physical top-level item in stream order, including corpses, mercenary and active golem. Socketed children remain in `children`. Dictionary key collisions do not remove physical entries.
- `coverage.sections`: contiguous section ranges covering the entire file on success.
- `coverage.endOffset`, `coverage.reachedEof`, `coverage.error`: traversal diagnostics. Reject incomplete coverage even when EOF was reached.
- `demons`: strict final-section report, or `null` if parsing never reaches it. The report includes counts, descriptor/stat ranges, parsed raw stats and an error.
- `readD2SDemonSection(bytes, absoluteOffset, gd)`: standalone bounded final-section reader. Requires exact EOF; never searches for markers.

## Supported final-section grammar

The reader requires a u16 version `1`, u16 marker `0x666c`, and u16 `0` or `1` (presence byte and zero padding). A present demon contains a 92-byte descriptor. Its first u16 is the following stat blob's byte length. It is not the descriptor length. Demon types `1` and `2` are supported; class zero is rejected.

The stat blob starts with `0x6667`, followed by 9-bit stat IDs and unsigned 32-bit values, then the 9-bit `0x1ff` terminator. Only IDs `0..15`, whose `CSvParam` is zero in the bundled Blizzless source table, are certified. Duplicate IDs, unsupported schemas, nonzero alignment bits and unused bytes fail. The blob must end at its declared boundary, and the final section must end at EOF. Missing sections, unknown versions, unsupported presence/count, unknown demon types and extra suffixes fail.

Wire schema evidence: [D2SSharp DemonSection.cs, DemonData.Read and ReadDemonStats](https://github.com/ResurrectedTrader/D2SSharp/blob/main/src/D2SSharp/Model/DemonSection.cs). The existing library reader independently supplies item boundaries; it is not replaced by marker scanning. Reserved descriptor metadata stays uninterpreted within its fixed structural range. No raw item or unknown tail is certified through preservation alone.

Private regression tests read saved SCL3V3 responses only when `STASH_PRIVATE_GRANT_FIXTURE_DIR` points to the local grant operation directory. No private bytes are embedded in tests or package files. The existing materials encoder gates remain unchanged; an existing record at quantity zero can be patched without appending a record.
