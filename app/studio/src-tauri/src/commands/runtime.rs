use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::AppState;

const GRAPHICS_KEYS: &[&str] = &[
    "Quality", "Antialiasing", "AnisotropicFiltering", "ShadowQuality", "FogQuality",
    "WaterQuality", "GrassQuality", "GrassInSniperMode", "EffectsQuality", "ObjectsQuality",
    "VehiclesQuality", "LevelOfDetail", "HDTextures", "HalfResolutionV2", "FPSLimit",
    "VSync", "Fullscreen", "TankTreads", "TankSuspension",
];

#[derive(Debug, Serialize)]
pub struct GraphicsOptionsDto {
    path: String,
    recognized: BTreeMap<String, String>,
    unknown: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct GraphicsSaveDto {
    values: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct BackupDto { id: String, modified_ms: u128, size: u64 }

#[derive(Debug, Serialize)]
pub struct ProcessStatusDto { running: bool }

#[derive(Debug, Serialize)]
pub struct CacheEntryDto {
    id: String,
    size: u64,
    modified_ms: u128,
    sha256: String,
    preview: String,
}

#[derive(Debug, Serialize)]
pub struct CacheCompareDto { equal: bool, size_a: u64, size_b: u64, differing_bytes: usize, first_difference: Option<usize> }

fn now_stamp() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
fn modified_ms(meta: &fs::Metadata) -> u128 { meta.modified().ok().and_then(|v| v.duration_since(UNIX_EPOCH).ok()).map(|v| v.as_millis()).unwrap_or(0) }

fn runtime_root(state: &State<AppState>) -> Result<PathBuf, String> {
    state.runtime_root.lock().unwrap().clone().filter(|p| p.is_dir()).ok_or_else(|| "Runtime data directory is not configured or does not exist.".into())
}

fn options_path(state: &State<AppState>) -> Result<PathBuf, String> { Ok(runtime_root(state)?.join("ExportedOptions.yaml")) }
fn cache_path(state: &State<AppState>) -> Result<PathBuf, String> { Ok(runtime_root(state)?.join("shader_cache")) }

pub(crate) fn is_game_running() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("tasklist").creation_flags(0x08000000).args(["/FI", "IMAGENAME eq wotblitz.exe", "/FO", "CSV", "/NH"])
            .output().ok().map(|output| String::from_utf8_lossy(&output.stdout).to_ascii_lowercase().contains("wotblitz.exe")).unwrap_or(false)
    }
    #[cfg(not(windows))]
    { false }
}

fn require_stopped() -> Result<(), String> { if is_game_running() { Err("World of Tanks Blitz must be closed for this operation.".into()) } else { Ok(()) } }

fn read_options(path: &Path) -> Result<serde_yaml::Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_yaml::from_str(&text).map_err(|e| e.to_string())
}

fn string_options(root: &serde_yaml::Value) -> BTreeMap<String, String> {
    root.get("keyedArchive").and_then(|v| v.as_mapping()).map(|map| map.iter().filter_map(|(key, value)| {
        Some((key.as_str()?.to_owned(), value.get("string")?.as_str()?.to_owned()))
    }).collect()).unwrap_or_default()
}

fn validate_graphics(key: &str, value: &str) -> Result<(), String> {
    if !GRAPHICS_KEYS.contains(&key) { return Err(format!("Unsupported graphics key: {key}")); }
    let bool_keys = ["GrassInSniperMode", "HDTextures", "VSync", "Fullscreen", "TankTreads", "TankSuspension"];
    if bool_keys.contains(&key) && !matches!(value, "true" | "false") { return Err(format!("{key} must be true or false")); }
    if key == "FPSLimit" && value.parse::<u16>().ok().filter(|v| (30..=500).contains(v)).is_none() { return Err("FPSLimit must be between 30 and 500".into()); }
    if value.len() > 64 || value.contains(['\n', '\r']) { return Err(format!("Invalid value for {key}")); }
    Ok(())
}

fn backup_file(path: &Path) -> Result<PathBuf, String> {
    let backup = path.with_file_name(format!("ExportedOptions.yaml.backup.{}", now_stamp()));
    fs::copy(path, &backup).map_err(|e| format!("backup {}: {e}", path.display()))?;
    Ok(backup)
}

#[tauri::command]
pub fn runtime_get_path(state: State<AppState>) -> Option<String> { state.runtime_root.lock().unwrap().as_ref().map(|p| p.to_string_lossy().into_owned()) }

#[tauri::command]
pub fn runtime_set_path(path: String, state: State<AppState>) -> Result<(), String> {
    let root = PathBuf::from(path);
    if !root.is_dir() || !root.join("ExportedOptions.yaml").is_file() { return Err("Select the DAVAProject directory containing ExportedOptions.yaml.".into()); }
    *state.runtime_root.lock().unwrap() = Some(root);
    Ok(())
}

#[tauri::command]
pub fn graphics_load(state: State<AppState>) -> Result<GraphicsOptionsDto, String> {
    let path = options_path(&state)?;
    let all = string_options(&read_options(&path)?);
    let known: HashSet<_> = GRAPHICS_KEYS.iter().copied().collect();
    Ok(GraphicsOptionsDto {
        path: path.to_string_lossy().into_owned(),
        recognized: all.iter().filter(|(k, _)| known.contains(k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect(),
        unknown: all.into_iter().filter(|(k, _)| !known.contains(k.as_str())).collect(),
    })
}

#[tauri::command]
pub fn graphics_save(options: GraphicsSaveDto, state: State<AppState>) -> Result<String, String> {
    require_stopped()?;
    for (key, value) in &options.values { validate_graphics(key, value)?; }
    let path = options_path(&state)?;
    let mut root = read_options(&path)?;
    let archive = root.get_mut("keyedArchive").and_then(|v| v.as_mapping_mut()).ok_or("Missing keyedArchive in ExportedOptions.yaml")?;
    for (key, value) in options.values {
        let entry = archive.get_mut(serde_yaml::Value::String(key.clone())).ok_or_else(|| format!("Option not found: {key}"))?;
        let map = entry.as_mapping_mut().ok_or_else(|| format!("Malformed option: {key}"))?;
        map.insert(serde_yaml::Value::String("string".into()), serde_yaml::Value::String(value));
    }
    let backup = backup_file(&path)?;
    let temp = path.with_extension("yaml.tmp");
    fs::write(&temp, serde_yaml::to_string(&root).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&temp, &path) { let _ = fs::copy(&backup, &path); return Err(error.to_string()); }
    Ok(backup.file_name().unwrap_or_default().to_string_lossy().into_owned())
}

fn list_named_backups(root: &Path, prefix: &str) -> Result<Vec<BackupDto>, String> {
    let mut result = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(prefix) { continue; }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        result.push(BackupDto { id: name, modified_ms: modified_ms(&meta), size: meta.len() });
    }
    result.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(result)
}

fn safe_child(root: &Path, id: &str, prefix: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.starts_with(prefix) || Path::new(id).components().count() != 1 { return Err("Invalid backup or cache identifier.".into()); }
    Ok(root.join(id))
}

#[tauri::command]
pub fn graphics_backups(state: State<AppState>) -> Result<Vec<BackupDto>, String> { list_named_backups(&runtime_root(&state)?, "ExportedOptions.yaml.backup.") }

#[tauri::command]
pub fn graphics_restore(id: String, state: State<AppState>) -> Result<(), String> {
    require_stopped()?;
    let root = runtime_root(&state)?;
    let source = safe_child(&root, &id, "ExportedOptions.yaml.backup.")?;
    let target = root.join("ExportedOptions.yaml");
    backup_file(&target)?;
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn game_process_status() -> ProcessStatusDto { ProcessStatusDto { running: is_game_running() } }

#[tauri::command]
pub fn game_launch(state: State<AppState>) -> Result<(), String> {
    if is_game_running() { return Err("World of Tanks Blitz is already running.".into()); }
    let root = state.game_root.lock().unwrap().clone().ok_or("No game installation selected.")?;
    let executable = ["wotblitz.exe", "TanksBlitz.exe"].iter().map(|name| root.join(name)).find(|p| p.is_file()).ok_or("Game executable not found.")?;
    Command::new(executable).current_dir(root).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn cache_entry_path(state: &State<AppState>, id: &str) -> Result<PathBuf, String> {
    let root = cache_path(state)?;
    let path = safe_child(&root, id, "")?;
    if !path.is_file() { return Err("Cache entry not found.".into()); }
    Ok(path)
}

fn preview_hex(bytes: &[u8]) -> String { bytes.iter().take(64).map(|byte| format!("{byte:02X}")).collect::<Vec<_>>().join(" ") }

#[tauri::command]
pub fn shader_cache_scan(state: State<AppState>) -> Result<Vec<CacheEntryDto>, String> {
    let root = cache_path(&state)?;
    if !root.exists() { fs::create_dir_all(&root).map_err(|e| e.to_string())?; }
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
        let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(CacheEntryDto { id: entry.file_name().to_string_lossy().into_owned(), size: meta.len(), modified_ms: modified_ms(&meta), sha256: format!("{:x}", Sha256::digest(&bytes)), preview: preview_hex(&bytes) });
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub fn shader_cache_preview(id: String, state: State<AppState>) -> Result<String, String> { Ok(preview_hex(&fs::read(cache_entry_path(&state, &id)?).map_err(|e| e.to_string())?)) }

#[tauri::command]
pub fn shader_cache_export(id: String, destination: String, state: State<AppState>) -> Result<(), String> {
    let source = cache_entry_path(&state, &id)?;
    let destination = PathBuf::from(destination);
    if destination.is_dir() { fs::copy(source, destination.join(&id)).map_err(|e| e.to_string())?; } else { fs::copy(source, destination).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn shader_cache_compare(a: String, b: String, state: State<AppState>) -> Result<CacheCompareDto, String> {
    let left = fs::read(cache_entry_path(&state, &a)?).map_err(|e| e.to_string())?;
    let right = fs::read(cache_entry_path(&state, &b)?).map_err(|e| e.to_string())?;
    let common = left.len().min(right.len());
    let first = (0..common).find(|index| left[*index] != right[*index]).or((left.len() != right.len()).then_some(common));
    let differing_bytes = (0..common).filter(|index| left[*index] != right[*index]).count() + left.len().abs_diff(right.len());
    Ok(CacheCompareDto { equal: first.is_none(), size_a: left.len() as u64, size_b: right.len() as u64, differing_bytes, first_difference: first })
}

#[tauri::command]
pub fn shader_cache_clear(state: State<AppState>) -> Result<String, String> {
    require_stopped()?;
    clear_cache_at(&runtime_root(&state)?)
}

fn clear_cache_at(root: &Path) -> Result<String, String> {
    let cache = root.join("shader_cache");
    let id = format!("shader_cache.backup.{}", now_stamp());
    let backup = root.join(&id);
    if cache.exists() { fs::rename(&cache, &backup).map_err(|e| e.to_string())?; }
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn shader_cache_backups(state: State<AppState>) -> Result<Vec<BackupDto>, String> { list_named_backups(&runtime_root(&state)?, "shader_cache.backup.") }

#[tauri::command]
pub fn shader_cache_restore(id: String, state: State<AppState>) -> Result<(), String> {
    require_stopped()?;
    let root = runtime_root(&state)?;
    restore_cache_at(&root, &id)
}

fn restore_cache_at(root: &Path, id: &str) -> Result<(), String> {
    let backup = safe_child(&root, &id, "shader_cache.backup.")?;
    if !backup.is_dir() { return Err("Shader cache backup not found.".into()); }
    let cache = root.join("shader_cache");
    if cache.exists() { fs::rename(&cache, root.join(format!("shader_cache.backup.{}", now_stamp()))).map_err(|e| e.to_string())?; }
    fs::rename(backup, cache).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn shader_cache_delete_backup(id: String, state: State<AppState>) -> Result<(), String> {
    require_stopped()?;
    let backup = safe_child(&runtime_root(&state)?, &id, "shader_cache.backup.")?;
    if !backup.is_dir() { return Err("Shader cache backup not found.".into()); }
    fs::remove_dir_all(backup).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_ids() {
        let root = Path::new("C:/safe");
        assert!(safe_child(root, "../shader_cache.backup.1", "shader_cache.backup.").is_err());
        assert!(safe_child(root, "shader_cache.backup.1/child", "shader_cache.backup.").is_err());
    }

    #[test]
    fn validates_known_graphics_values() {
        assert!(validate_graphics("VSync", "true").is_ok());
        assert!(validate_graphics("VSync", "yes").is_err());
        assert!(validate_graphics("FPSLimit", "120").is_ok());
        assert!(validate_graphics("Unknown", "x").is_err());
    }

    #[test]
    fn backup_file_preserves_original_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ExportedOptions.yaml");
        fs::write(&path, "original").unwrap();
        let backup = backup_file(&path).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "original");
        assert_eq!(fs::read_to_string(backup).unwrap(), "original");
    }

    #[test]
    fn cache_clear_and_restore_are_recoverable() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("shader_cache");
        fs::create_dir(&cache).unwrap();
        fs::write(cache.join("entry.bin"), b"compiled").unwrap();

        let id = clear_cache_at(dir.path()).unwrap();
        assert!(!cache.join("entry.bin").exists());
        assert_eq!(fs::read(dir.path().join(&id).join("entry.bin")).unwrap(), b"compiled");

        restore_cache_at(dir.path(), &id).unwrap();
        assert_eq!(fs::read(cache.join("entry.bin")).unwrap(), b"compiled");
    }
}
