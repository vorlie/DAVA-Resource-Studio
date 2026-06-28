//! DVPL wire-format codec: pack (compress) and unpack (decompress).
//!
//! Wire format (last 20 bytes = footer):
//!
//! ```text
//! [data][input_size u32 LE][compressed_size u32 LE][crc32 u32 LE][compress_type u32 LE]["DVPL"]
//! ```
//!
//! `compress_type == 0` → uncompressed, `compress_type == 1` → LZ4 block.

use anyhow::{anyhow, Context, Result};
use crc32fast::Hasher;
use lz4::block::{compress as lz4_compress, decompress as lz4_decompress};

const FOOTER_LEN: usize = 20;

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut h = Hasher::new();
    h.update(data);
    h.finalize()
}

/// Compress `input` into DVPL wire format.
pub fn pack(input: &[u8]) -> Result<Vec<u8>> {
    let input_size = input.len() as u32;
    let compressed = lz4_compress(input, None, false)
        .context("lz4 compression failed")?;
    let compressed_size = compressed.len() as u32;

    let mut out = Vec::new();

    if input_size <= compressed_size {
        // Storing uncompressed is smaller or equal — use compress_type 0.
        out.extend_from_slice(input);
        out.extend_from_slice(&input_size.to_le_bytes());
        out.extend_from_slice(&input_size.to_le_bytes());
        out.extend_from_slice(&crc32_ieee(input).to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
    } else {
        // compress_type 1 — LZ4 block.
        out.extend_from_slice(&compressed);
        out.extend_from_slice(&input_size.to_le_bytes());
        out.extend_from_slice(&compressed_size.to_le_bytes());
        out.extend_from_slice(&crc32_ieee(&compressed).to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
    }

    out.extend_from_slice(b"DVPL");
    Ok(out)
}

/// Decompress DVPL wire-format `input` and return the original payload.
pub fn unpack(input: &[u8]) -> Result<Vec<u8>> {
    if input.len() < FOOTER_LEN {
        return Err(anyhow!("input too small for dvpl footer"));
    }

    let (data_buf, footer) = input.split_at(input.len() - FOOTER_LEN);

    let original_size   = u32::from_le_bytes(footer[0..4].try_into().unwrap()) as usize;
    let compressed_size = u32::from_le_bytes(footer[4..8].try_into().unwrap()) as usize;
    let crc_expected    = u32::from_le_bytes(footer[8..12].try_into().unwrap());
    let compress_type   = u32::from_le_bytes(footer[12..16].try_into().unwrap());

    if &footer[16..20] != b"DVPL" {
        return Err(anyhow!("invalid dvpl magic"));
    }
    if compressed_size != data_buf.len() {
        return Err(anyhow!("compressed_size in footer does not match data length"));
    }
    if crc_expected != crc32_ieee(data_buf) {
        return Err(anyhow!("crc32 mismatch"));
    }

    if compress_type == 0 {
        Ok(data_buf.to_vec())
    } else {
        let out = lz4_decompress(data_buf, Some(original_size as i32))
            .map_err(|e| anyhow!("lz4 decompress failed: {e}"))?;
        if out.len() != original_size {
            return Err(anyhow!("decompressed size mismatch: got {} expected {}", out.len(), original_size));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_small() {
        let data = b"hello world, this is a test string for the dvpl codec!";
        let packed = pack(data).unwrap();
        let unpacked = unpack(&packed).unwrap();
        assert_eq!(unpacked, data);
    }

    #[test]
    fn round_trip_empty() {
        let packed = pack(&[]).unwrap();
        let unpacked = unpack(&packed).unwrap();
        assert!(unpacked.is_empty());
    }

    #[test]
    fn round_trip_repetitive() {
        // Highly compressible data — exercises the LZ4 path.
        let data: Vec<u8> = b"AAAAAAAAAA".repeat(1000);
        let packed = pack(&data).unwrap();
        assert!(packed.len() < data.len(), "LZ4 should compress repetitive data");
        let unpacked = unpack(&packed).unwrap();
        assert_eq!(unpacked, data);
    }

    #[test]
    fn bad_magic_rejected() {
        let mut packed = pack(b"test").unwrap();
        let len = packed.len();
        packed[len - 4] = b'X'; // corrupt magic
        assert!(unpack(&packed).is_err());
    }

    #[test]
    fn bad_crc_rejected() {
        let mut packed = pack(b"test").unwrap();
        let len = packed.len();
        // CRC is at bytes [len-12..len-8]
        packed[len - 12] ^= 0xFF;
        assert!(unpack(&packed).is_err());
    }
}
