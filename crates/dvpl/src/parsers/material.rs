//! Material file stub - treated as raw UTF-8 text until the format is reverse-engineered.
//!
//! Once the binary structure is understood, replace this with a real parser
//! that can round-trip without data loss.

/// Return raw text content of a material file.
pub fn as_text(bytes: &[u8]) -> anyhow::Result<String> {
    let s = std::str::from_utf8(bytes)?;
    Ok(s.to_owned())
}
