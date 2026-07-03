//! Local filesystem helpers for the file tree (rename, move, create, delete, list, summary).
//!
//! Git status / icon-key extraction and the diff cache were retired alongside
//! removal of the file-tree search + image-icon system; the tree now reflects
//! plain directory listings only.

use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsDirSummary {
    pub entries: i32,
    pub dirs: i32,
}

fn path_err(p: impl AsRef<Path>, e: std::io::Error) -> String {
    format!("{}: {e}", p.as_ref().display())
}

/// Reject `..` components that would escape normalization.
fn path_looks_safe(p: &Path) -> bool {
    for c in p.components() {
        if matches!(c, Component::ParentDir) {
            return false;
        }
    }
    true
}

/// List immediate children of a directory (sorted: folders first, then files).
pub fn read_dir_entries_impl(path: String) -> Result<Vec<FsEntry>, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path_looks_safe(&p) {
        return Err("invalid path".into());
    }
    let rd = fs::read_dir(&p).map_err(|e| path_err(&p, e))?;

    let mut v: Vec<FsEntry> = Vec::new();
    for e in rd {
        let e = match e {
            Ok(val) => val,
            Err(_) => continue,
        };
        let meta = match e.metadata() {
            Ok(val) => val,
            Err(_) => continue,
        };
        let name = e.file_name().to_string_lossy().into_owned();
        let full = e.path().to_string_lossy().into_owned();
        let is_dir = meta.is_dir();
        v.push(FsEntry { name, path: full, is_dir });
    }
    v.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(v)
}

pub fn read_dir_summary_impl(path: String) -> Result<FsDirSummary, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path_looks_safe(&p) {
        return Err("invalid path".into());
    }

    let mut entries = 0_i32;
    let mut dirs = 0_i32;
    let rd = fs::read_dir(&p).map_err(|e| path_err(&p, e))?;
    for item in rd {
        let item = match item {
            Ok(v) => v,
            Err(_) => continue,
        };
        entries = entries.saturating_add(1);
        if let Ok(meta) = item.metadata() {
            if meta.is_dir() {
                dirs = dirs.saturating_add(1);
            }
        }
    }
    Ok(FsDirSummary { entries, dirs })
}

pub fn fs_parent_dir(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    Ok(p.parent().map(|x| x.to_string_lossy().into_owned()))
}

pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    let a = PathBuf::from(&from);
    let b = PathBuf::from(&to);
    if !a.is_absolute() || !b.is_absolute() {
        return Err("paths must be absolute".into());
    }
    if !path_looks_safe(&a) || !path_looks_safe(&b) {
        return Err("invalid path".into());
    }
    fs::rename(&a, &b).map_err(|e| format!("rename: {e}"))
}

pub fn fs_move(from: String, to: String) -> Result<(), String> {
    let a = PathBuf::from(&from);
    let b = PathBuf::from(&to);
    if !a.is_absolute() || !b.is_absolute() {
        return Err("paths must be absolute".into());
    }
    if !path_looks_safe(&a) || !path_looks_safe(&b) {
        return Err("invalid path".into());
    }
    if fs::rename(&a, &b).is_ok() {
        return Ok(());
    }
    if a.is_dir() {
        copy_dir_recursive(&a, &b)?;
        fs::remove_dir_all(&a).map_err(|e| format!("remove source dir: {e}"))?;
    } else {
        fs::copy(&a, &b).map_err(|e| format!("copy: {e}"))?;
        fs::remove_file(&a).map_err(|e| format!("remove source: {e}"))?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir: {e}"))?;
    for e in fs::read_dir(src).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let t = dst.join(e.file_name());
        let m = e.metadata().map_err(|e| e.to_string())?;
        let p = e.path();
        if m.is_dir() {
            copy_dir_recursive(&p, &t)?;
        } else {
            fs::copy(&p, &t).map_err(|e| format!("copy: {e}"))?;
        }
    }
    Ok(())
}

pub fn fs_remove(path: String, recursive: bool) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !path_looks_safe(&p) {
        return Err("invalid path".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        if recursive {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())
        } else {
            fs::remove_dir(&p).map_err(|e| e.to_string())
        }
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

pub fn fs_create_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !path_looks_safe(&p) {
        return Err("invalid path".into());
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::File::create(&p).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn fs_create_dir(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !path_looks_safe(&p) {
        return Err("invalid path".into());
    }
    fs::create_dir_all(&p).map_err(|e| e.to_string())
}