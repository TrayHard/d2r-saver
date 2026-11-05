//! The repo fixtures read like the TypeScript library with `resolveMods: false`. Expected values
//! come from the TypeScript sources of this branch (`readD2S`/`readLegacyD2S`/`walkD2I`) and the
//! item index's `characterItems`/`stashTabItems`; `test/scan-mode.test.ts` holds the same
//! fixtures to the same bits read by the full parser.

use d2r_saver_core::*;
use serde_json::{json, Value};
use std::sync::OnceLock;

fn repo_file(path: &str) -> String {
    std::fs::read_to_string(format!("{}/../../{path}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn gd() -> &'static GameData {
    static GD: OnceLock<GameData> = OnceLock::new();
    GD.get_or_init(|| GameData::from_json(&repo_file("data/data.json"), &repo_file("data/strings.json")).unwrap())
}

/// The current data with the stat table a fixture was written with (`test/fixtures/stat-tables.json`).
fn gd_with(table: &str) -> GameData {
    let mut data: Value = serde_json::from_str(&repo_file("data/data.json")).unwrap();
    let tables: Value = serde_json::from_str(&repo_file("test/fixtures/stat-tables.json")).unwrap();
    let stats = tables[table].as_object().unwrap().iter().map(|(stat, row)| {
        let entry =
            json!({"id": row[0], "savebits": row[1], "saveadd": row[2], "saveparambits": row[3], "csvbits": row[4]});
        (stat.clone(), entry)
    });
    data["itemStatCost"] = Value::Object(stats.collect());
    GameData::from_json(&data.to_string(), &repo_file("data/strings.json")).unwrap()
}

fn gd_d2r() -> &'static GameData {
    static GD: OnceLock<GameData> = OnceLock::new();
    GD.get_or_init(|| gd_with("d2r"))
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/../../test/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn counts(pairs: &[(&str, i64)]) -> Counts {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

/// (body, inventory, cube, stash, belt, merc) slots in use.
fn slot_kinds(c: &Character) -> [usize; 6] {
    let mut n = [0; 6];
    for slot in c.slots.keys() {
        n[match slot {
            Slot::Body(_) => 0,
            Slot::Inventory(_) => 1,
            Slot::Cube(_) => 2,
            Slot::Stash(_) => 3,
            Slot::Belt(_) => 4,
            Slot::Merc(_) => 5,
        }] += 1;
    }
    n
}

/// (fixture, version, main list [declared, parsed, end], main list broken, slots in use, counts).
type CharacterCase = (
    &'static str,
    u32,
    [u32; 3],
    bool,
    [usize; 6],
    &'static [(&'static str, i64)],
);

fn check_character(gd: &GameData, name: &str, bytes: &[u8], case: &CharacterCase) {
    let &(_, version, [declared, parsed, end], broken, slots, expected) = case;
    let read = if version == 99 {
        read_legacy_d2s(bytes, gd)
    } else {
        read_d2s(bytes, gd)
    }
    .unwrap();
    let main = read.main.unwrap();
    assert_eq!(
        (main.declared, main.parsed, main.end_offset, main.error),
        (declared, parsed, end as usize, broken),
        "{name}"
    );
    assert_eq!(slot_kinds(&read), slots, "{name}");
    let c = character_items(bytes, gd).unwrap();
    assert_eq!((c.version, c.hardcore, c.ladder), (version, false, false), "{name}");
    assert_eq!(c.items, counts(expected), "{name}");
}

#[test]
fn characters_read_and_count_like_the_js_reader() {
    // The fixtures were written with other stat tables, so with the Blizzless one each main list
    // stops at an unknown stat. The sections after it are found by their headers: WarlockTest.d2s
    // still has two of its three hireling items.
    let cases: [CharacterCase; 3] = [
        ("BlizzlessTest.d2s", 99, [12, 0, 857], true, [0; 6], &[]),
        (
            "WarlockTest.d2s",
            105,
            [26, 5, 1197],
            true,
            [5, 0, 0, 0, 0, 2],
            &[("Lenymo", 1), ("Lore", 1), ("Rockstopper", 1), ("Griswold's Heart", 1)],
        ),
        ("WarlockShards.d2s", 105, [17, 6, 966], true, [0, 2, 0, 0, 4, 0], &[]),
    ];
    for case in &cases {
        check_character(gd(), case.0, &fixture(case.0), case);
    }
}

#[test]
fn characters_read_completely_with_their_own_stat_table() {
    let blizzless_s2: CharacterCase = (
        "BlizzlessTest.d2s",
        99,
        [12, 12, 1077],
        false,
        [0, 12, 0, 0, 0, 0],
        &[
            ("Ber Rune", 10),
            ("Nef Rune (Pure)", 1),
            ("Horadric Cube", 1),
            ("Horadric Sphere", 11),
            ("Dol Rune (Pure)", 1),
            ("Blacksmith Ingot", 11),
            ("Sur Rune (Pure)", 1),
            ("Resplendent Spark", 11),
            ("Cham Rune (Pure)", 1),
        ],
    );
    check_character(
        &gd_with("blizzless-s2"),
        blizzless_s2.0,
        &fixture(blizzless_s2.0),
        &blizzless_s2,
    );
    let d2r: [CharacterCase; 2] = [
        (
            "WarlockTest.d2s",
            105,
            [26, 26, 1636],
            false,
            [11, 6, 0, 1, 8, 3],
            &[
                ("Lenymo", 1),
                ("The Mahim-Oak Curio", 1),
                ("Lore", 1),
                ("Gull", 1),
                ("Skin of the Vipermagi", 1),
                ("Chance Guards", 1),
                ("Spirit", 1),
                ("Moser's Blessed Circle", 1),
                ("Horadric Cube", 1),
                ("Tir Rune", 1),
                ("Stealth", 1),
                ("Rockstopper", 1),
                ("Griswold's Heart", 1),
                ("Insight", 1),
            ],
        ),
        (
            "WarlockShards.d2s",
            105,
            [17, 17, 1158],
            false,
            [1, 7, 0, 5, 4, 0],
            &[
                ("Southern Worldstone Shard", 1),
                ("Deep Worldstone Shard", 1),
                ("Western Worldstone Shard", 1),
                ("Northern Worldstone Shard", 1),
                ("Eastern Worldstone Shard", 1),
                ("Worusk's End", 1),
                ("Talic's Anguish", 1),
                ("Korlic's Pain", 1),
                ("Madawc's Ire", 1),
                ("Bul-Kathos' Nightmare", 1),
            ],
        ),
    ];
    for case in &d2r {
        check_character(gd_d2r(), case.0, &fixture(case.0), case);
    }
    // Every sector reads to its end, so the tabs count; (names, copies) as the item index has them.
    for (name, names, copies) in [
        ("SharedStashComplete.d2i", 74, 223),
        ("SharedStashSoftCoreV2V105.d2i", 71, 216),
        ("SharedStashSoftCoreV2V105_.d2i", 68, 94),
    ] {
        let c = stash_tab_items(&fixture(name), gd_d2r()).unwrap();
        assert_eq!((c.len(), c.values().sum::<i64>()), (names, copies), "{name}");
    }
}

#[test]
fn a_broken_main_list_keeps_the_hireling_items() {
    // The first code character of item 8 of WarlockTest.d2s (byte 1197) becomes the dead Huffman
    // branch: an invalid item code, after which the hireling section is found by its header.
    let mut bytes = fixture("WarlockTest.d2s");
    for i in 0..9 {
        let bit = 1197 * 8 + 53 + i;
        let value = ((232 | 256) >> i) & 1;
        bytes[bit >> 3] = (bytes[bit >> 3] & !(1 << (bit & 7))) | (value << (bit & 7)) as u8;
    }
    let broken: CharacterCase = (
        "WarlockTest.d2s",
        105,
        [26, 7, 1197],
        true,
        [7, 0, 0, 0, 0, 3],
        &[
            ("Lenymo", 1),
            ("The Mahim-Oak Curio", 1),
            ("Lore", 1),
            ("Gull", 1),
            ("Rockstopper", 1),
            ("Griswold's Heart", 1),
            ("Insight", 1),
        ],
    );
    check_character(gd_d2r(), "WarlockTest.d2s with item 8 broken", &bytes, &broken);
}

#[test]
fn a_save_goes_only_through_the_reader_of_its_version() {
    assert!(read_d2s(&fixture("BlizzlessTest.d2s"), gd()).is_err());
    assert!(read_legacy_d2s(&fixture("WarlockTest.d2s"), gd()).is_err());
    assert!(character_items(&[0; 10], gd()).is_err());
}

#[test]
fn status_flags_come_from_byte_20_of_v105_and_byte_36_of_v99() {
    let header = |version: u8, at: usize, flags: u8| {
        let mut b = vec![0u8; 64];
        b[4] = version;
        b[at] = flags;
        b
    };
    assert_eq!(character_status(&header(105, 20, 0x44)), (105, true, true));
    assert_eq!(character_status(&header(105, 20, 0x20)), (105, false, false));
    assert_eq!(character_status(&header(99, 36, 0x40)), (99, false, true));
}

type Entry = (&'static str, Option<&'static str>, Option<u32>);

/// (offset, size, kind, item list: ([declared, parsed, end], complete, entries)).
type Sector<'a> = (u64, u64, u8, Option<([u32; 3], bool, &'a [Entry])>);

fn check_walk(name: &str, sectors: &[Sector]) {
    let report = walk_d2i(&fixture(name), gd()).unwrap();
    assert!(report.reached_eof, "{name}");
    assert_eq!(report.sectors.len(), sectors.len(), "{name}");
    for (got, want) in report.sectors.iter().zip(sectors) {
        assert_eq!((got.offset, got.size, got.kind), (want.0, want.1, want.2), "{name}");
        match (&got.walk, want.3) {
            (None, None) => {}
            (Some(walk), Some(([declared, parsed, end], complete, entries))) => {
                let r = walk.report;
                assert_eq!(
                    (r.declared, r.parsed, r.end_offset, walk.complete),
                    (declared, parsed, end as usize, complete),
                    "{name} @{}",
                    got.offset
                );
                let got: Vec<_> = walk
                    .entries
                    .iter()
                    .map(|e| (e.code(), e.unique_key(), e.quantity, e.add_one))
                    .collect();
                let want: Vec<_> = entries
                    .iter()
                    .map(|e| (e.0.to_string(), e.1.map(String::from), e.2, 0))
                    .collect();
                assert_eq!(got, want, "{name} @{}", r.first_item_offset);
            }
            _ => panic!(
                "{name} @{}: walked a metadata sector or skipped an item sector",
                got.offset
            ),
        }
    }
}

const MATERIALS: &[Entry] = &[
    ("rvl", None, Some(99)),
    ("rvs", None, Some(1)),
    ("r08", None, Some(3)),
    ("r14", None, Some(2)),
    ("r22", None, Some(6)),
    ("r13", None, Some(6)),
    ("r33", None, Some(4)),
    ("r32", None, Some(2)),
    ("pk1", None, Some(21)),
    ("pk3", None, Some(21)),
    ("pk2", None, Some(21)),
    ("ua5", None, Some(6)),
    ("ua4", None, Some(6)),
    ("xa1", None, Some(7)),
    ("xa2", None, Some(7)),
    ("ua2", None, Some(6)),
    ("ua1", None, Some(6)),
    ("ua3", None, Some(6)),
    ("xa4", None, Some(7)),
    ("xa5", None, Some(7)),
    ("xa3", None, Some(7)),
    ("glb", None, Some(0)),
    ("r15", None, Some(2)),
    ("r31", None, Some(2)),
    ("r27", None, Some(2)),
    ("r21", None, Some(2)),
    ("r24", None, Some(2)),
    ("r29", None, Some(2)),
    ("r28", None, Some(2)),
    ("r25", None, Some(2)),
    ("r26", None, Some(2)),
    ("r30", None, Some(2)),
    ("r23", None, Some(1)),
    ("tes", None, Some(1)),
    ("bey", None, Some(1)),
    ("r02", None, Some(1)),
    ("r06", None, Some(1)),
    ("r10", None, Some(1)),
    ("r18", None, Some(1)),
    ("r16", None, Some(1)),
    ("r19", None, Some(1)),
    ("r07", None, Some(1)),
    ("r03", None, Some(1)),
    ("mbr", None, Some(1)),
    ("ceh", None, Some(1)),
    ("bet", None, Some(1)),
    ("dhn", None, Some(1)),
    ("fed", None, Some(1)),
    ("toa", None, Some(1)),
    ("r09", None, Some(1)),
    ("r17", None, Some(1)),
    ("r12", None, Some(1)),
    ("r11", None, Some(1)),
    ("r04", None, Some(1)),
    ("r05", None, Some(1)),
    ("r01", None, Some(1)),
];

const RINGS: &[Entry] = &[
    ("amu", Some("unique272"), None),
    ("rin", Some("unique300"), None),
    ("rin", Some("unique300"), None),
    ("rin", Some("unique268"), None),
    ("rin", Some("unique268"), None),
    ("amu", Some("unique272"), None),
    ("rin", Some("unique268"), None),
];

#[test]
fn shared_stash_tabs_walk_like_the_js_walker() {
    let mut torch_and_rings: Vec<Entry> = vec![("cm1", Some("unique381"), None), ("ci2", Some("unique357"), None)];
    torch_and_rings.extend_from_slice(RINGS);
    check_walk(
        "SharedStashComplete.d2i",
        &[
            (0, 949, 0, Some(([14, 0, 68], false, &[]))),
            (949, 336, 0, Some(([6, 0, 1017], false, &[]))),
            (1285, 359, 0, Some(([9, 9, 1644], true, &torch_and_rings))),
            (1644, 68, 0, Some(([0, 0, 1712], true, &[]))),
            (1712, 68, 0, Some(([0, 0, 1780], true, &[]))),
            (1780, 830, 1, Some(([56, 56, 2610], true, MATERIALS))),
            (2610, 168, 2, None),
        ],
    );
    check_walk(
        "SharedStashSoftCoreV2V105.d2i",
        &[
            (
                0,
                989,
                0,
                Some(([15, 1, 108], false, &[("cm1", Some("unique381"), None)])),
            ),
            (
                989,
                373,
                0,
                Some(([7, 1, 1094], false, &[("ci2", Some("unique357"), None)])),
            ),
            (1362, 68, 0, Some(([0, 0, 1430], true, &[]))),
            (1430, 68, 0, Some(([0, 0, 1498], true, &[]))),
            (1498, 68, 0, Some(([0, 0, 1566], true, &[]))),
            (1566, 830, 1, Some(([56, 56, 2396], true, MATERIALS))),
            (2396, 168, 2, None),
        ],
    );
    check_walk(
        "SharedStashSoftCoreV2V105_.d2i",
        &[
            (0, 1210, 0, Some(([31, 0, 68], false, &[]))),
            (1210, 2290, 0, Some(([62, 7, 1492], false, RINGS))),
            (3500, 1184, 0, Some(([42, 0, 3568], false, &[]))),
        ],
    );
    // A sector that does not read to its end makes the whole tab an error, not a short count.
    for name in [
        "SharedStashComplete.d2i",
        "SharedStashSoftCoreV2V105.d2i",
        "SharedStashSoftCoreV2V105_.d2i",
    ] {
        assert!(stash_tab_items(&fixture(name), gd()).is_err(), "{name}");
    }
}

#[test]
fn materials_tabs_count_stacks_and_skip_empty_slots() {
    check_walk(
        "MaterialsTabBuyer.d2i",
        &[(
            0,
            129,
            1,
            Some((
                [5, 5, 129],
                true,
                &[
                    ("rvl", None, Some(99)),
                    ("glb", None, Some(0)),
                    ("r01", None, Some(0)),
                    ("r10", None, Some(98)),
                    ("tes", None, Some(1)),
                ],
            )),
        )],
    );
    assert_eq!(
        stash_tab_items(&fixture("MaterialsTabBuyer.d2i"), gd()).unwrap(),
        counts(&[("Thul Rune", 98), ("Twisted Essence of Suffering", 1)])
    );
    assert_eq!(
        stash_tab_items(&fixture("MaterialsTabSeller.d2i"), gd()).unwrap(),
        counts(&[
            ("El Rune", 5),
            ("Thul Rune", 3),
            ("Key of Terror", 3),
            ("Twisted Essence of Suffering", 2),
            ("Talic's Anguish", 1)
        ])
    );
}

#[test]
fn names_come_from_the_locale_strings() {
    let walk = walk_d2i(&fixture("MaterialsTabSeller.d2i"), gd()).unwrap();
    let names: Vec<_> = walk.sectors[0]
        .walk
        .as_ref()
        .unwrap()
        .entries
        .iter()
        .map(|e| item_name(e, gd()))
        .collect();
    // Gems are not indexed; potions and gold-like misc are not either.
    assert_eq!(
        names,
        [
            None,
            None,
            Some("El Rune"),
            Some("Thul Rune"),
            Some("Key of Terror"),
            Some("Twisted Essence of Suffering"),
            Some("Talic's Anguish"),
            None
        ]
    );
}

#[test]
fn detail_rows_read_like_the_js_reference() {
    // Expected rows: `dist/` read with `resolveMods: false`, filtered and named as the item index keeps them.
    let c = character_details(&fixture("WarlockTest.d2s"), gd()).unwrap();
    // Five equipped items, then the two hireling items found after the broken main list.
    assert_eq!((c.version, c.rows.len()), (105, 7));
    assert_eq!(c.rows[5].place, "mercenary");
    let lore = &c.rows[0];
    assert_eq!(
        (
            lore.place.as_str(),
            lore.name.as_str(),
            lore.base.as_str(),
            lore.quality,
            lore.runeword
        ),
        ("equipped", "Lore", "fhl", Some(9), true)
    );
    assert_eq!(
        (lore.sockets, lore.ilvl, lore.defense, lore.guid, lore.quantity),
        (2, Some(40), Some(26), Some(2731174711), 1)
    );
    let stats: std::collections::BTreeMap<String, i64> = [
        ("energy", 10),
        ("item_allskills", 1),
        ("item_lightradius", 2),
        ("item_manaafterkill", 2),
    ]
    .map(|(k, v)| (k.to_string(), v))
    .into();
    assert_eq!(lore.stats, stats);
    assert_eq!(lore.socketed, ["Ort Rune", "Sol Rune"]);
    assert_eq!(c.rows[4].stats.get("item_skillongethit#38#10"), Some(&3));

    // Stacks are quantities; the empty gem slot and the potion and gem stacks are no rows.
    let rows = stash_tab_details(&fixture("MaterialsTabSeller.d2i"), gd()).unwrap();
    let summary: Vec<_> = rows
        .iter()
        .map(|r| (r.place.as_str(), r.name.as_str(), r.quantity, r.guid.is_some()))
        .collect();
    assert_eq!(
        summary,
        [
            ("tab-materials", "El Rune", 5, false),
            ("tab-materials", "Thul Rune", 3, false),
            ("tab-materials", "Key of Terror", 3, true),
            ("tab-materials", "Twisted Essence of Suffering", 2, true),
            ("tab-materials", "Talic's Anguish", 1, true),
        ]
    );
    assert!(stash_tab_details(&fixture("SharedStashComplete.d2i"), gd()).is_err());
}

/// `n` bits at bit `at`, LSB first, like the save stores them.
fn get_bits(b: &[u8], at: usize, n: usize) -> u64 {
    (0..n).fold(0, |v, i| v | (((b[(at + i) >> 3] >> ((at + i) & 7)) & 1) as u64) << i)
}

fn set_bits(b: &mut [u8], at: usize, n: usize, value: u64) {
    for i in 0..n {
        let (byte, bit) = ((at + i) >> 3, (at + i) & 7);
        b[byte] = (b[byte] & !(1 << bit)) | (((value >> i) & 1) as u8) << bit;
    }
}

#[test]
fn detail_rows_come_from_each_copy_of_a_preset_base() {
    // A second Tome of Town Portal with another guid in another inventory cell. Tomes are keyed by
    // base code, so both slots point to the last copy in the dictionary; each row keeps its own.
    let gd = gd_d2r();
    let bytes = fixture("WarlockTest.d2s");
    let read = read_d2s(&bytes, gd).unwrap();
    let main = read.main.unwrap();
    let count_at = main.first_item_offset - 2;
    // Item k of the main list ends where a list declared with k items stops.
    let ends: Vec<usize> = (0..=main.declared as u16)
        .map(|k| {
            let mut b = bytes.clone();
            b[count_at..count_at + 2].copy_from_slice(&k.to_le_bytes());
            read_d2s(&b, gd).unwrap().main.unwrap().end_offset
        })
        .collect();
    const GUID: u64 = 2547047660;
    let (start, end, guid_at) = ends
        .windows(2)
        .find_map(|w| {
            (w[0] * 8..w[1] * 8 - 32)
                .find(|&p| get_bits(&bytes, p, 32) == GUID)
                .map(|p| (w[0], w[1], p))
        })
        .unwrap();
    let mut copy = bytes[start..end].to_vec();
    set_bits(&mut copy, guid_at - start * 8, 32, GUID ^ 1);
    let free = (0..40)
        .find(|&cell| !read.held.contains_key(&Slot::Inventory(cell)))
        .unwrap();
    set_bits(&mut copy, 42, 4, (free % 10) as u64); // col
    set_bits(&mut copy, 46, 4, (free / 10) as u64); // row
    let mut save = [&bytes[..end], &copy, &bytes[end..]].concat();
    save[count_at..count_at + 2].copy_from_slice(&(main.declared as u16 + 1).to_le_bytes());

    let c = character_details(&save, gd).unwrap();
    let tomes: Vec<_> = c.rows.iter().filter(|r| r.base == "tbk").map(|r| r.guid).collect();
    assert_eq!(tomes.len(), 2);
    assert!(tomes.contains(&Some(GUID as u32)) && tomes.contains(&Some(GUID as u32 ^ 1)));
}
