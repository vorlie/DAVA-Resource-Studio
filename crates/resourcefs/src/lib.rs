//! `crates/resourcefs` - Virtual filesystem over a DVPL-packed game directory.
//!
//! Files are exposed without the `.dvpl` suffix. All reads decompress on the fly;
//! all writes are buffered in memory with a dirty flag until [`DiskVfs::flush`] is called.
//!
//! # Example
//!
//! ```no_run
//! use resourcefs::{DiskVfs, Vfs};
//! use std::path::Path;
//!
//! let mut vfs = DiskVfs::new(Path::new("GameData"));
//!
//! // Read a file (decompressed transparently):
//! let contents = vfs.read(Path::new("Shaders/pbr-lightning.slh")).unwrap();
//!
//! // Buffer a change (nothing written to disk yet):
//! vfs.write(Path::new("Shaders/pbr-lightning.slh"), contents).unwrap();
//!
//! // Flush dirty entries to disk (re-compresses → writes .dvpl):
//! vfs.flush().unwrap();
//! ```

use anyhow::{anyhow, Context, Result};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

// Public types

/// Metadata about a single entry in the virtual filesystem.
#[derive(Debug, Clone)]
pub struct VfsEntry {
    /// Virtual path (no `.dvpl` suffix).
    pub path: PathBuf,
    /// `true` if the backing file on disk is DVPL-compressed.
    pub is_dvpl: bool,
    /// Size of the on-disk file (compressed if DVPL, raw otherwise).
    pub size: u64,
}

// Trait 

/// Core virtual filesystem operations.
pub trait Vfs {
    /// Read a file by its virtual path (decompresses DVPL automatically).
    ///
    /// If the file has pending in-memory changes, those are returned instead of
    /// reading from disk.
    fn read(&self, path: &Path) -> Result<Vec<u8>>;

    /// Stage bytes for a virtual path (does **not** touch disk).
    fn write(&mut self, path: &Path, data: Vec<u8>) -> Result<()>;

    /// Flush all dirty (staged) entries to disk.
    ///
    /// Files that map to a `.dvpl` on disk are re-compressed before writing.
    /// Newly created virtual paths are written as plain files (no `.dvpl`).
    fn flush(&mut self) -> Result<()>;

    /// Discard all staged (dirty) changes without touching disk.
    fn discard(&mut self);
}

// DiskVfs

/// [`Vfs`] implementation backed by a real directory on disk.
pub struct DiskVfs {
    root: PathBuf,
    /// Staged writes: virtual path → pending bytes.
    dirty: HashMap<PathBuf, Vec<u8>>,
}

impl DiskVfs {
    /// Create a new VFS rooted at `root`.  The directory must exist.
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            dirty: HashMap::new(),
        }
    }

    /// List all entries (real + staged) in the virtual filesystem.
    pub fn list(&self) -> Vec<VfsEntry> {
        let mut entries: HashMap<PathBuf, VfsEntry> = HashMap::new();

        // Walk the real directory.
        for entry in WalkDir::new(&self.root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let real_path = entry.path();
            let rel = real_path.strip_prefix(&self.root).unwrap();
            let is_dvpl = has_dvpl_ext(real_path);
            let vpath = if is_dvpl {
                strip_dvpl_ext(rel)
            } else {
                rel.to_path_buf()
            };
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            entries.insert(vpath.clone(), VfsEntry { path: vpath, is_dvpl, size });
        }

        // Overlay staged (dirty) paths.
        for (vpath, data) in &self.dirty {
            entries.entry(vpath.clone()).or_insert_with(|| VfsEntry {
                path: vpath.clone(),
                is_dvpl: false,
                size: data.len() as u64,
            });
        }

        let mut list: Vec<VfsEntry> = entries.into_values().collect();
        list.sort_by(|a, b| a.path.cmp(&b.path));
        list
    }

    /// Return `true` if `vpath` exists (either on disk or staged).
    pub fn exists(&self, vpath: &Path) -> bool {
        if self.dirty.contains_key(vpath) {
            return true;
        }
        self.real_path(vpath).is_some()
    }

    /// Return `true` if there are any unsaved (dirty) changes.
    pub fn is_dirty(&self) -> bool {
        !self.dirty.is_empty()
    }

    /// Return the virtual paths with staged, unapplied contents.
    pub fn dirty_paths(&self) -> Vec<PathBuf> {
        let mut paths: Vec<_> = self.dirty.keys().cloned().collect();
        paths.sort();
        paths
    }

    /// Discard the staged contents for one virtual path.
    pub fn discard_path(&mut self, path: &Path) -> bool {
        self.dirty.remove(path).is_some()
    }

    /// Resolve the real on-disk path for a virtual path (checks both plain and `.dvpl`).
    fn real_path(&self, vpath: &Path) -> Option<PathBuf> {
        let plain = self.root.join(vpath);
        if plain.exists() {
            return Some(plain);
        }
        let dvpl = with_dvpl_ext(&self.root.join(vpath));
        if dvpl.exists() {
            return Some(dvpl);
        }
        None
    }

    /// Determine whether the real backing file is DVPL-compressed.
    fn backing_is_dvpl(&self, vpath: &Path) -> bool {
        let dvpl = with_dvpl_ext(&self.root.join(vpath));
        dvpl.exists()
    }
}

impl Vfs for DiskVfs {
    fn read(&self, path: &Path) -> Result<Vec<u8>> {
        // Dirty cache takes priority.
        if let Some(data) = self.dirty.get(path) {
            return Ok(data.clone());
        }

        let real = self
            .real_path(path)
            .ok_or_else(|| anyhow!("file not found in VFS: {}", path.display()))?;

        let bytes = fs::read(&real)
            .with_context(|| format!("read {}", real.display()))?;

        if has_dvpl_ext(&real) {
            dvpl::unpack(&bytes)
                .with_context(|| format!("unpack {}", real.display()))
        } else {
            Ok(bytes)
        }
    }

    fn write(&mut self, path: &Path, data: Vec<u8>) -> Result<()> {
        self.dirty.insert(path.to_path_buf(), data);
        Ok(())
    }

    fn flush(&mut self) -> Result<()> {
        for (vpath, data) in &self.dirty {
            let real_path = if self.backing_is_dvpl(vpath) {
                // Re-use the existing .dvpl backing file.
                with_dvpl_ext(&self.root.join(vpath))
            } else {
                // Write as a plain file (could be a new virtual file).
                self.root.join(vpath)
            };

            if let Some(parent) = real_path.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("create parent dirs for {}", real_path.display()))?;
            }

            let on_disk = if has_dvpl_ext(&real_path) {
                dvpl::pack(data)
                    .with_context(|| format!("pack {}", vpath.display()))?
            } else {
                data.clone()
            };

            fs::write(&real_path, &on_disk)
                .with_context(|| format!("write {}", real_path.display()))?;
        }

        self.dirty.clear();
        Ok(())
    }

    fn discard(&mut self) {
        self.dirty.clear();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn has_dvpl_ext(path: &Path) -> bool {
    path.extension().map(|e| e == "dvpl").unwrap_or(false)
}

/// Strip the final `.dvpl` suffix from a path: `foo.yaml.dvpl` → `foo.yaml`.
fn strip_dvpl_ext(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_suffix(".dvpl") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

/// Append `.dvpl` to a path: `foo.yaml` → `foo.yaml.dvpl`.
fn with_dvpl_ext(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.dvpl", path.to_string_lossy()))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_dvpl(data: &[u8]) -> Vec<u8> {
        dvpl::pack(data).unwrap()
    }

    #[test]
    fn read_dvpl_transparently() {
        let dir = TempDir::new().unwrap();
        let dvpl_path = dir.path().join("hello.txt.dvpl");
        fs::write(&dvpl_path, make_dvpl(b"hello world")).unwrap();

        let vfs = DiskVfs::new(dir.path());
        let out = vfs.read(Path::new("hello.txt")).unwrap();
        assert_eq!(out, b"hello world");
    }

    #[test]
    fn write_is_buffered_not_flushed() {
        let dir = TempDir::new().unwrap();
        let dvpl_path = dir.path().join("file.txt.dvpl");
        fs::write(&dvpl_path, make_dvpl(b"original")).unwrap();

        let mut vfs = DiskVfs::new(dir.path());
        vfs.write(Path::new("file.txt"), b"modified".to_vec()).unwrap();

        // Disk should still have the original.
        let on_disk = dvpl::unpack(&fs::read(&dvpl_path).unwrap()).unwrap();
        assert_eq!(on_disk, b"original");

        // But in-memory read should return the pending value.
        let mem = vfs.read(Path::new("file.txt")).unwrap();
        assert_eq!(mem, b"modified");
    }

    #[test]
    fn flush_writes_to_disk() {
        let dir = TempDir::new().unwrap();
        let dvpl_path = dir.path().join("file.txt.dvpl");
        fs::write(&dvpl_path, make_dvpl(b"original")).unwrap();

        let mut vfs = DiskVfs::new(dir.path());
        vfs.write(Path::new("file.txt"), b"flushed".to_vec()).unwrap();
        vfs.flush().unwrap();

        assert!(!vfs.is_dirty());
        let on_disk = dvpl::unpack(&fs::read(&dvpl_path).unwrap()).unwrap();
        assert_eq!(on_disk, b"flushed");
    }

    #[test]
    fn discard_clears_dirty() {
        let dir = TempDir::new().unwrap();
        let dvpl_path = dir.path().join("file.txt.dvpl");
        fs::write(&dvpl_path, make_dvpl(b"original")).unwrap();

        let mut vfs = DiskVfs::new(dir.path());
        vfs.write(Path::new("file.txt"), b"changed".to_vec()).unwrap();
        assert!(vfs.is_dirty());
        vfs.discard();
        assert!(!vfs.is_dirty());

        let out = vfs.read(Path::new("file.txt")).unwrap();
        assert_eq!(out, b"original");
    }

    #[test]
    fn reports_and_discards_individual_dirty_paths() {
        let dir = TempDir::new().unwrap();
        let mut vfs = DiskVfs::new(dir.path());
        vfs.write(Path::new("b.txt"), b"b".to_vec()).unwrap();
        vfs.write(Path::new("a.txt"), b"a".to_vec()).unwrap();

        assert_eq!(vfs.dirty_paths(), [PathBuf::from("a.txt"), PathBuf::from("b.txt")]);
        assert!(vfs.discard_path(Path::new("a.txt")));
        assert_eq!(vfs.dirty_paths(), [PathBuf::from("b.txt")]);
        assert!(!vfs.discard_path(Path::new("missing.txt")));
    }
}
