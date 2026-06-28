//! `crates/game` - WoT Blitz / Lesta Tanks installation detection.
//!
//! Detection is path-first (no hard registry dependency) and user-overridable
//! via [`probe`].

use std::path::{Path, PathBuf};

// Types

/// Which distribution/launcher the game belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameEdition {
    Steam,
    MicrosoftStore,
    /// Lesta Games (CIS-region client).
    Lesta,
    /// Custom / manually-specified path.
    Custom,
}

/// A detected (or user-specified) game installation.
#[derive(Debug, Clone)]
pub struct GameInstall {
    pub edition: GameEdition,
    pub path: PathBuf,
    /// Version string read from the game data directory, if present.
    pub version: Option<String>,
}

// Public API

/// Attempt to detect all installed game variants automatically.
pub fn detect_all() -> Vec<GameInstall> {
    let mut found = Vec::new();
    if let Some(g) = detect_steam() { found.push(g); }
    if let Some(g) = detect_lesta() { found.push(g); }
    found
}

/// Validate and classify a user-supplied path.
///
/// Returns `None` if the path does not look like a valid game directory.
pub fn probe(path: &Path) -> Option<GameInstall> {
    if !is_valid_game_root(path) {
        return None;
    }
    Some(GameInstall {
        edition: GameEdition::Custom,
        version: read_version(path),
        path: path.to_path_buf(),
    })
}

// Internal detection

pub fn detect_steam() -> Option<GameInstall> {
    let steam_path = find_steam_path()?;
    let game_path = steam_path.join("steamapps").join("common").join("World of Tanks Blitz");
    if is_valid_game_root(&game_path) {
        return Some(GameInstall {
            edition: GameEdition::Steam,
            version: read_version(&game_path),
            path: game_path,
        });
    }
    None
}

pub fn detect_lesta() -> Option<GameInstall> {
    let candidates = lesta_candidate_paths();
    for path in candidates {
        if is_valid_game_root(&path) {
            return Some(GameInstall {
                edition: GameEdition::Lesta,
                version: read_version(&path),
                path,
            });
        }
    }
    None
}

// Helpers

/// A game root is valid if it contains a known Blitz executable and its data
/// directory. Steam currently ships `wotblitz.exe`; older and non-Steam
/// distributions may use `TanksBlitz.exe`.
fn is_valid_game_root(path: &Path) -> bool {
    if !path.is_dir() || !path.join("Data").is_dir() {
        return false;
    }

    ["wotblitz.exe", "TanksBlitz.exe"]
        .iter()
        .any(|executable| path.join(executable).is_file())
}

/// Read the version string from the game directory.
///
/// Checks common file names in order; returns the first one found.
fn read_version(path: &Path) -> Option<String> {
    for name in &["version", "version.info", "version.txt"] {
        let p = path.join(name);
        if let Ok(s) = std::fs::read_to_string(&p) {
            let trimmed = s.trim().to_owned();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

/// Known Lesta candidate installation paths (Windows).
fn lesta_candidate_paths() -> Vec<PathBuf> {
    let drives = ["C:", "D:", "E:"];
    let folders = ["Tanks Blitz", "World_of_Tanks_Blitz", "TanksBlitz"];
    let mut paths = Vec::new();
    for drive in &drives {
        for folder in &folders {
            paths.push(PathBuf::from(format!("{}\\Games\\{}", drive, folder)));
            paths.push(PathBuf::from(format!("{}\\{}", drive, folder)));
        }
    }
    paths
}

/// Locate the Steam root directory.
///
/// On Windows: tries the registry first, then falls back to the default path.
/// On non-Windows: returns `None`.
fn find_steam_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        // Try HKCU first (most common), then HKLM.
        for hive in &[HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            if let Ok(key) = RegKey::predef(*hive).open_subkey("Software\\Valve\\Steam") {
                if let Ok(val) = key.get_value::<String, _>("SteamPath") {
                    let p = PathBuf::from(val);
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }

        // Fallback default.
        let default = PathBuf::from(r"C:\Program Files (x86)\Steam");
        if default.exists() { return Some(default); }
    }

    None
}

// ── Tests 

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_fake_game(dir: &Path) {
        fs::write(dir.join("TanksBlitz.exe"), b"fake").unwrap();
        fs::create_dir_all(dir.join("Data")).unwrap();
    }

    #[test]
    fn probe_valid_path() {
        let dir = TempDir::new().unwrap();
        make_fake_game(dir.path());
        let install = probe(dir.path()).expect("should detect valid game root");
        assert_eq!(install.edition, GameEdition::Custom);
        assert_eq!(install.version, None);
    }

    #[test]
    fn probe_invalid_path() {
        let dir = TempDir::new().unwrap();
        // No exe, no Shaders dir.
        assert!(probe(dir.path()).is_none());
    }

    #[test]
    fn probe_current_steam_layout() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("wotblitz.exe"), b"fake").unwrap();
        fs::create_dir_all(dir.path().join("Data").join("3d")).unwrap();

        assert!(probe(dir.path()).is_some());
    }

    #[test]
    fn probe_rejects_unrelated_data_directory() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("Data")).unwrap();

        assert!(probe(dir.path()).is_none());
    }

    #[test]
    fn probe_reads_version() {
        let dir = TempDir::new().unwrap();
        make_fake_game(dir.path());
        fs::write(dir.path().join("version"), "13.8.0.123\n").unwrap();
        let install = probe(dir.path()).unwrap();
        assert_eq!(install.version.as_deref(), Some("13.8.0.123"));
    }
}
