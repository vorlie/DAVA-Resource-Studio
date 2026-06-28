//! Shader include (.slh) stub - treated as raw UTF-8 text.
//!
//! Future work: parse `#include`, `#define`, and custom macro syntax
//! once the shader language is fully understood.

/// Return raw text content of a shader include file.
pub fn as_text(bytes: &[u8]) -> anyhow::Result<String> {
    let s = std::str::from_utf8(bytes)?;
    Ok(s.to_owned())
}
