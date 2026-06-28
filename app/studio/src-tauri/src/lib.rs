mod commands;

use resourcefs::DiskVfs;
use std::{path::PathBuf, sync::Mutex};

/// Shared application state - held across all Tauri commands.
pub struct AppState {
    /// The currently open VFS. `None` until the user opens a game directory.
    pub vfs: Mutex<Option<DiskVfs>>,
    pub game_root: Mutex<Option<PathBuf>>,
    pub runtime_root: Mutex<Option<PathBuf>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            vfs: Mutex::new(None),
            game_root: Mutex::new(None),
            runtime_root: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // dvpl
            commands::dvpl::dvpl_pack,
            commands::dvpl::dvpl_unpack,
            // vfs
            commands::vfs::vfs_open,
            commands::vfs::vfs_list,
            commands::vfs::vfs_read,
            commands::vfs::vfs_write,
            commands::vfs::vfs_flush,
            commands::vfs::vfs_discard,
            commands::vfs::vfs_is_dirty,
            commands::vfs::vfs_dirty_paths,
            commands::vfs::vfs_discard_path,
            // resource intelligence
            commands::resource::resource_validate,
            commands::resource::resource_format,
            commands::resource::material_inspect,
            commands::resource::shader_index,
            commands::resource::shader_references,
            // runtime, graphics and shader cache
            commands::runtime::runtime_get_path,
            commands::runtime::runtime_set_path,
            commands::runtime::graphics_load,
            commands::runtime::graphics_save,
            commands::runtime::graphics_backups,
            commands::runtime::graphics_restore,
            commands::runtime::game_process_status,
            commands::runtime::game_launch,
            commands::runtime::shader_cache_scan,
            commands::runtime::shader_cache_preview,
            commands::runtime::shader_cache_export,
            commands::runtime::shader_cache_compare,
            commands::runtime::shader_cache_clear,
            commands::runtime::shader_cache_backups,
            commands::runtime::shader_cache_restore,
            commands::runtime::shader_cache_delete_backup,
            // game
            commands::game::game_detect,
            commands::game::game_probe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
