//! Resource parsers - deliberately minimal stubs.
//!
//! Real format parsing is deferred until the engine formats are
//! fully understood and can be serialized back byte-for-byte.

pub mod yaml;
pub mod material;
pub mod shader;

/// A generic game resource: either structured YAML, UTF-8 text, or raw binary.
#[derive(Debug, Clone)]
pub enum Resource {
    Yaml(serde_yaml::Value),
    Text(String),
    Binary(Vec<u8>),
}

impl Resource {
    /// Detect format from the virtual path extension and parse accordingly.
    ///
    /// Extensions handled:
    /// - `.yaml`, `.yml`  → [`Resource::Yaml`]
    /// - `.slh`, `.glsl`  → [`Resource::Text`] (shader includes)
    /// - anything else    → [`Resource::Binary`]
    pub fn from_bytes(vpath: &std::path::Path, bytes: Vec<u8>) -> Self {
        let ext = vpath
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        match ext.as_str() {
            "yaml" | "yml" => yaml::parse(&bytes)
                .map(Resource::Yaml)
                .unwrap_or_else(|_| Resource::Binary(bytes)),
            "slh" | "glsl" | "material" | "fsh" | "vsh" => {
                String::from_utf8(bytes.clone())
                    .map(Resource::Text)
                    .unwrap_or_else(|_| Resource::Binary(bytes))
            }
            _ => Resource::Binary(bytes),
        }
    }

    /// Serialize back to bytes for writing.
    pub fn to_bytes(&self) -> anyhow::Result<Vec<u8>> {
        match self {
            Resource::Yaml(v) => {
                let s = serde_yaml::to_string(v)?;
                Ok(s.into_bytes())
            }
            Resource::Text(s) => Ok(s.as_bytes().to_vec()),
            Resource::Binary(b) => Ok(b.clone()),
        }
    }
}
