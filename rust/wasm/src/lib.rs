//! The WebAssembly face of d2r-saver-core for the npm package: plain exports and no imports, so one
//! module runs in Node, Deno, Bun, Docker and browsers with no glue but a few lines of JS.
//!
//! JS copies the input into memory from `alloc`, calls a reader with an engine handle, frees the
//! input with `dealloc` and reads the UTF-8 document of `doc` at `result_ptr` (the reader returns its
//! length).

use d2r_saver_core::{doc, GameData};
use std::cell::RefCell;

thread_local! {
    static ENGINES: RefCell<Vec<Option<GameData>>> = const { RefCell::new(Vec::new()) };
    static RESULT: RefCell<String> = const { RefCell::new(String::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` and `len` come from one `alloc` call.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        // SAFETY: JS passes a buffer it filled from `alloc(len)` and keeps until the call returns.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

fn result(text: String) -> usize {
    let len = text.len();
    RESULT.with(|r| *r.borrow_mut() = text);
    len
}

fn with_engine(handle: u32, read: impl FnOnce(&GameData) -> String) -> usize {
    let text = ENGINES.with(|engines| {
        let engines = engines.borrow();
        let gd = handle
            .checked_sub(1)
            .and_then(|i| engines.get(i as usize))
            .and_then(Option::as_ref)
            .expect("a live engine handle");
        read(gd)
    });
    result(text)
}

/// Game data from the JSON of the data tables and of the locale strings: a handle above 0, or 0 with
/// the reason as the result.
#[no_mangle]
pub extern "C" fn engine_new(data: *const u8, data_len: usize, strings: *const u8, strings_len: usize) -> u32 {
    let text = |ptr, len| String::from_utf8_lossy(input(ptr, len)).into_owned();
    match GameData::from_json(&text(data, data_len), &text(strings, strings_len)) {
        Ok(gd) => ENGINES.with(|engines| {
            let mut engines = engines.borrow_mut();
            engines.push(Some(gd));
            engines.len() as u32
        }),
        Err(reason) => {
            result(reason);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn engine_drop(handle: u32) {
    ENGINES.with(|engines| {
        let mut engines = engines.borrow_mut();
        if let Some(slot) = handle.checked_sub(1).and_then(|i| engines.get_mut(i as usize)) {
            *slot = None;
        }
    });
}

#[no_mangle]
pub extern "C" fn read_d2s(engine: u32, ptr: *const u8, len: usize, legacy: u32, solve: u32) -> usize {
    with_engine(engine, |gd| doc::read_d2s(input(ptr, len), gd, legacy != 0, solve != 0))
}

#[no_mangle]
pub extern "C" fn read_d2i(engine: u32, ptr: *const u8, len: usize, solve: u32) -> usize {
    with_engine(engine, |gd| doc::read_d2i(input(ptr, len), gd, solve != 0))
}

/// `expected_end` is ignored unless `has_expected_end` is set.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn walk_item_list(
    engine: u32,
    ptr: *const u8,
    len: usize,
    header_offset: u32,
    legacy: u32,
    first_id: u32,
    has_expected_end: u32,
    expected_end: f64,
    solve: u32,
) -> usize {
    with_engine(engine, |gd| {
        doc::walk_item_list(
            input(ptr, len),
            header_offset as usize,
            gd,
            legacy != 0,
            first_id,
            (has_expected_end != 0).then_some(expected_end),
            solve != 0,
        )
    })
}

#[no_mangle]
pub extern "C" fn walk_d2i(engine: u32, ptr: *const u8, len: usize, legacy: u32, solve: u32) -> usize {
    with_engine(engine, |gd| doc::walk_d2i(input(ptr, len), gd, legacy != 0, solve != 0))
}

#[no_mangle]
pub extern "C" fn read_demons(engine: u32, ptr: *const u8, len: usize, header_offset: u32) -> usize {
    with_engine(engine, |gd| {
        doc::read_demons(input(ptr, len), header_offset as usize, gd)
    })
}

#[no_mangle]
pub extern "C" fn read_item_head(ptr: *const u8, len: usize, offset: u32) -> usize {
    result(doc::read_item_head(input(ptr, len), offset as usize))
}
