//! `crates/dvpl` - Core DVPL codec and resource parsers.
//!
//! # Quick start
//!
//! ```no_run
//! use dvpl::{open, save, pack, unpack};
//! use std::path::Path;
//!
//! let raw = open(Path::new("foo.yaml.dvpl")).unwrap();
//! // ... edit raw bytes ...
//! save(Path::new("foo.yaml.dvpl"), &raw).unwrap();
//! ```

pub mod codec;
pub mod parsers;

use anyhow::Result;
use std::path::Path;

/// Read a `.dvpl` file from disk and return the decompressed payload.
pub fn open(path: &Path) -> Result<Vec<u8>> {
    let bytes = std::fs::read(path)?;
    codec::unpack(&bytes)
}

/// Compress `data` and write it to `path` as a `.dvpl` file.
pub fn save(path: &Path, data: &[u8]) -> Result<()> {
    let packed = codec::pack(data)?;
    std::fs::write(path, packed)?;
    Ok(())
}

/// Compress raw bytes into the DVPL wire format (no I/O).
pub fn pack(data: &[u8]) -> Result<Vec<u8>> {
    codec::pack(data)
}

/// Decompress DVPL wire-format bytes (no I/O).
pub fn unpack(data: &[u8]) -> Result<Vec<u8>> {
    codec::unpack(data)
}
