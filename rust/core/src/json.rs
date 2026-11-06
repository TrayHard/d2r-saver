//! A JSON text writer. Documents are written key by key in the order the TypeScript reader creates
//! its objects, so `JSON.parse` gives objects with the same keys in the same order.

use std::fmt::{Display, Write};

pub(crate) struct Json {
    pub out: String,
    /// No value written yet in the current object or array, or a key was just written.
    first: bool,
}

impl Json {
    pub fn new() -> Self {
        Json {
            out: String::with_capacity(1 << 14),
            first: true,
        }
    }

    fn sep(&mut self) {
        if !self.first {
            self.out.push(',');
        }
        self.first = false;
    }

    pub fn open(&mut self) {
        self.sep();
        self.out.push('{');
        self.first = true;
    }

    pub fn close(&mut self) {
        self.out.push('}');
        self.first = false;
    }

    pub fn open_array(&mut self) {
        self.sep();
        self.out.push('[');
        self.first = true;
    }

    pub fn close_array(&mut self) {
        self.out.push(']');
        self.first = false;
    }

    pub fn key(&mut self, key: &str) {
        self.sep();
        self.quoted(key);
        self.out.push(':');
        self.first = true;
    }

    pub fn num(&mut self, value: impl Display) {
        self.sep();
        write!(self.out, "{value}").unwrap();
    }

    pub fn bool(&mut self, value: bool) {
        self.sep();
        self.out.push_str(if value { "true" } else { "false" });
    }

    pub fn null(&mut self) {
        self.sep();
        self.out.push_str("null");
    }

    pub fn str(&mut self, value: &str) {
        self.sep();
        self.quoted(value);
    }

    fn quoted(&mut self, value: &str) {
        self.out.push('"');
        for c in value.chars() {
            match c {
                '"' => self.out.push_str("\\\""),
                '\\' => self.out.push_str("\\\\"),
                c if c < ' ' => write!(self.out, "\\u{:04x}", c as u32).unwrap(),
                c => self.out.push(c),
            }
        }
        self.out.push('"');
    }

    /// `"key":value` pairs.
    pub fn field(&mut self, key: &str, value: impl Display) {
        self.key(key);
        self.num(value);
    }

    pub fn field_bool(&mut self, key: &str, value: bool) {
        self.key(key);
        self.bool(value);
    }

    pub fn field_str(&mut self, key: &str, value: &str) {
        self.key(key);
        self.str(value);
    }

    /// `{"start":…,"end":…}`, the shape of a `ByteRange`.
    pub fn range(&mut self, key: &str, range: (usize, usize)) {
        self.key(key);
        self.open();
        self.field("start", range.0);
        self.field("end", range.1);
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_nested_values_and_escapes_strings() {
        let mut j = Json::new();
        j.open();
        j.field("a", 1);
        j.key("b");
        j.open_array();
        j.str("q\"\\\n\u{1}ж");
        j.null();
        j.open();
        j.close();
        j.close_array();
        j.field_bool("c", false);
        j.close();
        assert_eq!(j.out, r#"{"a":1,"b":["q\"\\\u000a\u0001ж",null,{}],"c":false}"#);
    }
}
