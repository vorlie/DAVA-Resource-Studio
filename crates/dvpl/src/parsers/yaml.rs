//! YAML parser using serde_yaml.

use anyhow::Result;

pub fn parse(bytes: &[u8]) -> Result<serde_yaml::Value> {
    let s = std::str::from_utf8(bytes)?;
    let v = serde_yaml::from_str(s)?;
    Ok(v)
}

pub fn serialize(value: &serde_yaml::Value) -> Result<Vec<u8>> {
    let s = serde_yaml::to_string(value)?;
    Ok(s.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_yaml() {
        let input = b"key: value\nnested:\n  a: 1\n  b: 2\n";
        let parsed = parse(input).unwrap();
        let back = serialize(&parsed).unwrap();
        // Re-parse the serialized output and compare values (not raw bytes).
        let reparsed = parse(&back).unwrap();
        assert_eq!(parsed, reparsed);
    }
}
