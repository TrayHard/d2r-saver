//! d2r-scan: counts the indexed items of saves given as JSON lines.
//!
//! Input, one per line: `{"id":"…","kind":"c"|"t","b64":"…"}` (`c` character, `t` stash tab).
//! Output, one per line: `{"id","ok":true,"version","hardcore","ladder","items":{…}}` for a
//! character, `{"id","ok":true,"items":{…}}` for a stash tab, `{"id","ok":false}` when the save
//! does not read. `--details` writes the index rows instead of the counts: `"rows":[{"place",
//! "name","base","quality","runeword","ethereal","sockets","ilvl","defense","quantity","guid",
//! "stats","socketed"},…]`. `--bench` prints the parse time per save by category to stderr.

use base64::Engine;
use d2r_saver_core::{character_details, character_items, stash_tab_details, stash_tab_items, DetailRow, GameData};
use serde_json::{json, Value};
use std::io::{BufRead, BufWriter, Write};
use std::time::Instant;

const USAGE: &str =
    "usage: d2r-scan [--data <dir with data.json and strings.json>] [--details] [--bench] < saves.jsonl > out.jsonl";

fn main() {
    let mut data_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../data").to_string();
    let mut bench = false;
    let mut details = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bench" => bench = true,
            "--details" => details = true,
            "--data" => data_dir = args.next().unwrap_or_else(|| fail(USAGE)),
            _ => fail(USAGE),
        }
    }
    let read = |name: &str| {
        std::fs::read_to_string(format!("{data_dir}/{name}"))
            .unwrap_or_else(|e| fail(&format!("{data_dir}/{name}: {e}")))
    };
    let gd = GameData::from_json(&read("data.json"), &read("strings.json")).unwrap_or_else(|e| fail(&e));

    // Categories: character v99, character v105, tab v99, tab v105.
    let mut nanos = [0u128; 4];
    let mut saves = [0u64; 4];
    let stdin = std::io::stdin().lock();
    let mut out = BufWriter::new(std::io::stdout().lock());
    for line in stdin.lines() {
        let line = line.unwrap_or_else(|e| fail(&format!("stdin: {e}")));
        if line.trim().is_empty() {
            continue;
        }
        let input: Value = serde_json::from_str(&line).unwrap_or_else(|e| fail(&format!("bad input line: {e}")));
        let id = serde_json::to_string(&input["id"]).unwrap();
        let character = input["kind"] == "c";
        let bytes = input["b64"]
            .as_str()
            .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok());
        let Some(bytes) = bytes else {
            writeln!(out, r#"{{"id":{id},"ok":false}}"#).unwrap();
            continue;
        };

        let legacy = save_version(&bytes, character) == 99;
        let category = (!character as usize) * 2 + (!legacy as usize);
        // Only the read and the count are timed, not the output.
        let started = Instant::now();
        if details {
            let result = if character {
                character_details(&bytes, &gd).map(|c| (Some((c.version, c.hardcore, c.ladder)), c.rows))
            } else {
                stash_tab_details(&bytes, &gd).map(|rows| (None, rows))
            };
            nanos[category] += started.elapsed().as_nanos();
            saves[category] += 1;
            match result {
                Ok((status, rows)) => {
                    let rows = Value::Array(rows.iter().map(row_json).collect());
                    match status {
                        Some((version, hardcore, ladder)) => writeln!(
                            out,
                            r#"{{"id":{id},"ok":true,"version":{version},"hardcore":{hardcore},"ladder":{ladder},"rows":{rows}}}"#
                        ),
                        None => writeln!(out, r#"{{"id":{id},"ok":true,"rows":{rows}}}"#),
                    }
                }
                Err(_) => writeln!(out, r#"{{"id":{id},"ok":false}}"#),
            }
            .unwrap();
            continue;
        }
        let result = if character {
            character_items(&bytes, &gd).map(|c| (Some(c.version), c.hardcore, c.ladder, c.items))
        } else {
            stash_tab_items(&bytes, &gd).map(|items| (None, false, false, items))
        };
        nanos[category] += started.elapsed().as_nanos();
        saves[category] += 1;
        let items = |items| serde_json::to_string(items).unwrap();
        match result {
            Ok((Some(version), hardcore, ladder, counts)) => writeln!(
                out,
                r#"{{"id":{id},"ok":true,"version":{version},"hardcore":{hardcore},"ladder":{ladder},"items":{}}}"#,
                items(&counts)
            ),
            Ok((None, _, _, counts)) => writeln!(out, r#"{{"id":{id},"ok":true,"items":{}}}"#, items(&counts)),
            Err(_) => writeln!(out, r#"{{"id":{id},"ok":false}}"#),
        }
        .unwrap();
    }
    out.flush().unwrap();

    if bench {
        eprintln!("category          saves   total ms    ms/save");
        for (i, name) in ["character v99", "character v105", "tab v99", "tab v105"]
            .iter()
            .enumerate()
        {
            let ms = nanos[i] as f64 / 1e6;
            eprintln!(
                "{name:<14} {:>8} {ms:>10.1} {:>10.5}",
                saves[i],
                ms / saves[i].max(1) as f64
            );
        }
    }
}

fn row_json(r: &DetailRow) -> Value {
    json!({
        "place": r.place,
        "name": r.name,
        "base": r.base,
        "quality": r.quality,
        "runeword": r.runeword,
        "ethereal": r.ethereal,
        "sockets": r.sockets,
        "ilvl": r.ilvl,
        "defense": r.defense,
        "quantity": r.quantity,
        "guid": r.guid,
        "stats": r.stats,
        "socketed": r.socketed,
    })
}

/// The version a category is filed under: byte 4 of a character, byte 8 of a stash tab.
fn save_version(bytes: &[u8], character: bool) -> u32 {
    let at = if character { 4 } else { 8 };
    bytes
        .get(at..at + 4)
        .map_or(0, |b| u32::from_le_bytes(b.try_into().unwrap()))
}

fn fail(message: &str) -> ! {
    eprintln!("d2r-scan: {message}");
    std::process::exit(2)
}
