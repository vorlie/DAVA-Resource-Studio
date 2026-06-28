use resourcefs::{DiskVfs, Vfs, VfsEntry};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct VfsEntryDto {
    pub path: String,
    pub is_dvpl: bool,
    pub size: u64,
}

impl From<VfsEntry> for VfsEntryDto {
    fn from(e: VfsEntry) -> Self {
        Self {
            path: e.path.to_string_lossy().into_owned(),
            is_dvpl: e.is_dvpl,
            size: e.size,
        }
    }
}

/// Open a game data directory, replacing any previously open VFS.
#[tauri::command]
pub fn vfs_open(root: String, state: State<AppState>) -> Result<(), String> {
    let data_root = Path::new(&root).join("Data");
    if !data_root.is_dir() {
        return Err(format!("Game Data directory not found: {}", data_root.display()));
    }
    let mut guard = state.vfs.lock().unwrap();
    *guard = Some(DiskVfs::new(&data_root));
    *state.game_root.lock().unwrap() = Some(Path::new(&root).to_path_buf());
    if state.runtime_root.lock().unwrap().is_none() {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            *state.runtime_root.lock().unwrap() = Some(Path::new(&local).join("wotblitz").join("DAVAProject"));
        }
    }
    Ok(())
}

/// List virtual entries in the open VFS.
#[tauri::command]
pub fn vfs_list(state: State<AppState>) -> Result<Vec<VfsEntryDto>, String> {
    let guard = state.vfs.lock().unwrap();
    match guard.as_ref() {
        Some(vfs) => Ok(vfs.list().into_iter().map(Into::into).collect()),
        None => Err("No directory open. Call vfs_open first.".into()),
    }
}

/// Read a file from the open VFS (returns raw bytes).
#[tauri::command]
pub fn vfs_read(vpath: String, state: State<AppState>) -> Result<Vec<u8>, String> {
    let guard = state.vfs.lock().unwrap();
    match guard.as_ref() {
        Some(vfs) => vfs.read(Path::new(&vpath)).map_err(|e| e.to_string()),
        None => Err("No directory open.".into()),
    }
}

/// Stage a write in the open VFS (does not touch disk).
#[tauri::command]
pub fn vfs_write(vpath: String, data: Vec<u8>, state: State<AppState>) -> Result<(), String> {
    let mut guard = state.vfs.lock().unwrap();
    match guard.as_mut() {
        Some(vfs) => vfs.write(Path::new(&vpath), data).map_err(|e| e.to_string()),
        None => Err("No directory open.".into()),
    }
}

/// Flush all staged writes to disk.
#[tauri::command]
pub fn vfs_flush(state: State<AppState>) -> Result<(), String> {
    if super::runtime::is_game_running() {
        return Err("World of Tanks Blitz must be closed before applying resources.".into());
    }
    let mut guard = state.vfs.lock().unwrap();
    match guard.as_mut() {
        Some(vfs) => vfs.flush().map_err(|e| e.to_string()),
        None => Err("No directory open.".into()),
    }
}

/// Discard all staged writes.
#[tauri::command]
pub fn vfs_discard(state: State<AppState>) -> Result<(), String> {
    let mut guard = state.vfs.lock().unwrap();
    match guard.as_mut() {
        Some(vfs) => { vfs.discard(); Ok(()) }
        None => Err("No directory open.".into()),
    }
}

/// Return true if there are unsaved staged writes.
#[tauri::command]
pub fn vfs_is_dirty(state: State<AppState>) -> bool {
    let guard = state.vfs.lock().unwrap();
    guard.as_ref().map(|v| v.is_dirty()).unwrap_or(false)
}

/// List virtual paths with staged changes.
#[tauri::command]
pub fn vfs_dirty_paths(state: State<AppState>) -> Vec<String> {
    let guard = state.vfs.lock().unwrap();
    guard
        .as_ref()
        .map(|vfs| {
            vfs.dirty_paths()
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Discard one staged virtual path without affecting other staged files.
#[tauri::command]
pub fn vfs_discard_path(vpath: String, state: State<AppState>) -> Result<bool, String> {
    let mut guard = state.vfs.lock().unwrap();
    match guard.as_mut() {
        Some(vfs) => Ok(vfs.discard_path(Path::new(&vpath))),
        None => Err("No directory open.".into()),
    }
}
