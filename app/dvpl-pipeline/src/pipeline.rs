use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct DecryptOptions {
    pub delete_dvpl_after_decrypt: bool,
}

pub struct EncryptBackOptions {
    pub delete_plain_after_encrypt_back: bool,
}

pub fn copy_tree_recursive(src: &Path, dst: &Path) -> Result<()> {
    if !src.is_dir() {
        return Err(anyhow!("input must be a directory"));
    }
    fs::create_dir_all(dst).with_context(|| format!("create dst dir: {}", dst.display()))?;

    for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if entry.file_type().is_dir() {
            continue;
        }
        let rel = p.strip_prefix(src).unwrap();
        let out_path = dst.join(rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(p, &out_path)
            .with_context(|| format!("copy {} -> {}", p.display(), out_path.display()))?;
    }
    Ok(())
}

pub fn decrypt_tree_recursive(
    src_original: &Path,
    dst_decrypted: &Path,
    opts: DecryptOptions,
) -> Result<()> {
    fs::create_dir_all(dst_decrypted)?;

    for entry in WalkDir::new(src_original).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if entry.file_type().is_dir() {
            continue;
        }
        if !crate::utils::is_dvpl(p) {
            continue;
        }

        let rel = p.strip_prefix(src_original).unwrap();
        let out_path = dst_decrypted.join(rel);
        let decrypted_path = crate::utils::dvpl_original_name(&out_path);

        if let Some(parent) = decrypted_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let bytes = fs::read(p).with_context(|| format!("read {}", p.display()))?;
        let decrypted = dvpl::unpack(&bytes)
            .with_context(|| format!("unpack dvpl {}", p.display()))?;
        fs::write(&decrypted_path, decrypted)
            .with_context(|| format!("write {}", decrypted_path.display()))?;

        if opts.delete_dvpl_after_decrypt {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

pub fn encrypt_back_tree_recursive(
    src_decrypted: &Path,
    opts: EncryptBackOptions,
) -> Result<()> {
    for entry in WalkDir::new(src_decrypted).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if entry.file_type().is_dir() {
            continue;
        }
        if crate::utils::is_dvpl(p) {
            continue;
        }

        let bytes = fs::read(p).with_context(|| format!("read {}", p.display()))?;
        let packed = dvpl::pack(&bytes)
            .with_context(|| format!("pack {}", p.display()))?;
        let out_path = PathBuf::from(format!("{}.dvpl", p.to_string_lossy()));

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&out_path, packed)
            .with_context(|| format!("write {}", out_path.display()))?;

        if opts.delete_plain_after_encrypt_back {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}
