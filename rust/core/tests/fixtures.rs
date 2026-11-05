//! The repo fixtures read like the TypeScript library with `resolveMods: false`. Expected values
//! come from `dist/` at 0adab05 (`readD2S`/`readLegacyD2S`/`walkD2I` and the item index's
//! `characterItems`/`stashTabItems`); `test/scan-mode.test.ts` holds the same fixtures to the
//! same bits read by the full parser.

use d2r_saver_core::*;
use std::sync::OnceLock;

fn gd() -> &'static GameData {
    static GD: OnceLock<GameData> = OnceLock::new();
    GD.get_or_init(|| {
        let data =
            |name: &str| std::fs::read_to_string(format!("{}/../../data/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        GameData::from_json(&data("data.json"), &data("strings.json")).unwrap()
    })
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

/// (fixture, version, main list [declared, parsed, end], slots in use, counts).
type CharacterCase = (&'static str, u32, [u32; 3], [usize; 6], &'static [(&'static str, i64)]);

#[test]
fn characters_read_and_count_like_the_js_reader() {
    // The fixtures predate the current stat table, so each main list stops at an unknown stat;
    // the items before it stay, and the sections after it are not reached.
    let cases: [CharacterCase; 3] = [
        ("BlizzlessTest.d2s", 99, [12, 0, 857], [0; 6], &[]),
        (
            "WarlockTest.d2s",
            105,
            [26, 5, 1197],
            [5, 0, 0, 0, 0, 0],
            &[("Lenymo", 1), ("Lore", 1)],
        ),
        ("WarlockShards.d2s", 105, [17, 6, 966], [0, 2, 0, 0, 4, 0], &[]),
    ];
    for (name, version, [declared, parsed, end], slots, expected) in cases {
        let bytes = fixture(name);
        let read = if version == 99 {
            read_legacy_d2s(&bytes, gd())
        } else {
            read_d2s(&bytes, gd())
        }
        .unwrap();
        let main = read.main.unwrap();
        assert_eq!(
            (main.declared, main.parsed, main.end_offset, main.error),
            (declared, parsed, end as usize, true),
            "{name}"
        );
        assert_eq!(slot_kinds(&read), slots, "{name}");
        let c = character_items(&bytes, gd()).unwrap();
        assert_eq!((c.version, c.hardcore, c.ladder), (version, false, false), "{name}");
        assert_eq!(c.items, counts(expected), "{name}");
    }
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
