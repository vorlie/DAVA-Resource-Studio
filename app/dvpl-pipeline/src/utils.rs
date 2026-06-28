use std::path::{Path, PathBuf};

pub fn is_dvpl(path: &Path) -> bool {
    path.extension().map(|e| e == "dvpl").unwrap_or(false)
}

pub fn dvpl_original_name(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_suffix(".dvpl") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}
