use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GameInstallDto {
    pub edition: String,
    pub path: String,
    pub version: Option<String>,
}

impl From<game::GameInstall> for GameInstallDto {
    fn from(g: game::GameInstall) -> Self {
        Self {
            edition: format!("{:?}", g.edition),
            path: g.path.to_string_lossy().into_owned(),
            version: g.version,
        }
    }
}

/// Auto-detect all installed game variants.
#[tauri::command]
pub fn game_detect() -> Vec<GameInstallDto> {
    game::detect_all().into_iter().map(Into::into).collect()
}

/// Validate a user-supplied game path.
#[tauri::command]
pub fn game_probe(path: String) -> Option<GameInstallDto> {
    game::probe(std::path::Path::new(&path)).map(Into::into)
}
