//! Local filesystem helpers for the file tree (rename, move, create, delete) and optional git hints.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use git2::{BranchType, Repository};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_status: Option<String>,
    /// Reserved for future icon packs (e.g. Material); `"folder" | "file" | …`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_key: Option<String>,
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

fn find_git_root(mut dir: &Path) -> Option<PathBuf> {
    loop {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
}

fn git_status_output(root: &Path) -> Result<std::process::Output, std::io::Error> {
    let mut c = Command::new("git");
    c.current_dir(root)
        .args(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    crate::subprocess::hide_console_window(&mut c);
    c.output()
}

fn git_ls_files_count(root: &Path) -> Option<i32> {
    let mut c = Command::new("git");
    c.current_dir(root).args(["ls-files", "-z"]);
    crate::subprocess::hide_console_window(&mut c);
    let out = c.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let count = out
        .stdout
        .split(|&b| b == 0)
        .filter(|chunk| !chunk.is_empty())
        .count();
    Some(i32::try_from(count).ok().unwrap_or(i32::MAX))
}

fn git_status_label(xy: &str) -> &'static str {
    let s = xy.trim();
    match s {
        "??" => "untracked",
        "MM" | "M" | "AM" | "MA" | " T" | "T " => "modified",
        "A" | "AD" => "added",
        "D" => "deleted",
        "R" | "RM" => "renamed",
        "UU" | "AA" | "DD" => "conflict",
        _ if s.contains('M') => "modified",
        _ if s.contains('A') => "added",
        _ if s.contains('D') => "deleted",
        _ => "changed",
    }
}

/// Map **child name** → git status label for entries directly under `dir`.
fn git_status_map_for_dir(dir: &Path) -> Option<HashMap<String, String>> {
    let root = find_git_root(dir)?;
    let out = git_status_output(&root).ok()?;
    if !out.status.success() {
        return None;
    }
    let dir_abs = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let mut map: HashMap<String, String> = HashMap::new();

    for raw in out.stdout.split(|&b| b == 0).filter(|s| !s.is_empty()) {
        let line = match std::str::from_utf8(raw) {
            Ok(s) => s.trim_end_matches('\r'),
            Err(_) => continue,
        };
        if line.len() < 3 {
            continue;
        }
        let xy = &line[0..2];
        if line.chars().nth(2) != Some(' ') {
            continue;
        }
        let rest = line[3..].trim();
        let path_part = rest.split(" -> ").last().unwrap_or(rest).trim();
        let rel_path = Path::new(path_part);
        let full = root.join(rel_path);
        let full_abs = fs::canonicalize(&full).unwrap_or(full);
        let Some(parent) = full_abs.parent() else {
            continue;
        };
        if parent != dir_abs {
            continue;
        }
        let name = full_abs
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        map.insert(name, git_status_label(xy).to_string());
    }
    Some(map)
}

/// Every path in the repo with a git status (for folder rollups and badges). Paths are absolute.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitPathStatus {
    pub path: String,
    pub status: String,
    pub added: i32,
    pub removed: i32,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub root: String,
    pub name: String,
    pub total_files: i32,
    pub changed_files: i32,
    pub added_lines: i32,
    pub removed_lines: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
}

fn normalize_remote_url_for_link(remote: &str) -> Option<String> {
    let trimmed = remote.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return Some(trimmed.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("ssh://") {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        if let Some((host, path)) = rest.split_once('/') {
            return Some(format!(
                "https://{}/{}",
                host,
                path.trim_end_matches(".git")
            ));
        }
    }
    if let Some(rest) = trimmed.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            return Some(format!(
                "https://{}/{}",
                host,
                path.trim_end_matches(".git")
            ));
        }
    }
    None
}

fn remote_url_from_name(repo: &Repository, name: &str) -> Option<String> {
    repo.find_remote(name)
        .ok()
        .and_then(|remote| remote.url().ok().map(|s| s.to_owned()))
        .and_then(|url| normalize_remote_url_for_link(&url))
}

fn detect_remote_url(repo: &Repository) -> Option<String> {
    if let Some(url) = remote_url_from_name(repo, "origin") {
        return Some(url);
    }

    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let Ok(local_branch) = head.shorthand() {
                if let Ok(branch) = repo.find_branch(local_branch, BranchType::Local) {
                    if let Ok(upstream) = branch.upstream() {
                        if let Ok(Some(name)) = upstream.name() {
                            if let Some((remote_name, _)) = name.split_once('/') {
                                if let Some(url) = remote_url_from_name(repo, remote_name) {
                                    return Some(url);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(remotes) = repo.remotes() {
        for i in 0..remotes.len() {
            if let Ok(Some(name)) = remotes.get(i) {
                if let Some(url) = remote_url_from_name(repo, name) {
                    return Some(url);
                }
            }
        }
    }

    None
}

fn git_diff_numstat_output(root: &Path) -> Result<std::process::Output, std::io::Error> {
    let mut c = Command::new("git");
    c.current_dir(root)
        .args(["diff", "--numstat", "--no-renames", "--no-ext-diff", "HEAD"]);
    crate::subprocess::hide_console_window(&mut c);
    c.output()
}

fn collect_diff_counts(root: &Path) -> HashMap<PathBuf, (i32, i32)> {
    let mut out: HashMap<PathBuf, (i32, i32)> = HashMap::new();
    let Ok(diff_out) = git_diff_numstat_output(root) else {
        return out;
    };
    if !diff_out.status.success() {
        return out;
    }

    for line in String::from_utf8_lossy(&diff_out.stdout).lines() {
        let mut parts = line.splitn(3, '\t');
        let add_raw = parts.next().unwrap_or("").trim();
        let rem_raw = parts.next().unwrap_or("").trim();
        let rel_raw = parts.next().unwrap_or("").trim();
        if rel_raw.is_empty() {
            continue;
        }
        let added = add_raw.parse::<i32>().ok().unwrap_or(0).max(0);
        let removed = rem_raw.parse::<i32>().ok().unwrap_or(0).max(0);
        let rel = Path::new(rel_raw);
        let full = root.join(rel);
        let full_abs = fs::canonicalize(&full).unwrap_or(full);
        out.insert(full_abs, (added, removed));
    }

    out
}

#[derive(Default)]
struct DiffCache {
    root: PathBuf,
    last_refresh: Option<Instant>,
    diffs: HashMap<PathBuf, (i32, i32)>,
}

static DIFF_CACHE: std::sync::OnceLock<parking_lot::Mutex<DiffCache>> = std::sync::OnceLock::new();

fn diff_cache() -> &'static parking_lot::Mutex<DiffCache> {
    DIFF_CACHE.get_or_init(|| parking_lot::Mutex::new(DiffCache::default()))
}

fn cached_diff_counts(root: &Path) -> HashMap<PathBuf, (i32, i32)> {
    // Keep it simple: refresh at most every 750ms and only for one repo root at a time.
    // This avoids repeated `git.exe` spawns on file-tree polling bursts.
    const MIN_REFRESH: Duration = Duration::from_millis(750);
    let mut g = diff_cache().lock();
    let now = Instant::now();
    if g.root != root {
        g.root = root.to_path_buf();
        g.last_refresh = None;
        g.diffs.clear();
    }
    let fresh = g
        .last_refresh
        .is_some_and(|t| now.duration_since(t) < MIN_REFRESH);
    if !fresh {
        g.diffs = collect_diff_counts(root);
        g.last_refresh = Some(now);
    }
    g.diffs.clone()
}

pub fn git_workdir_status_impl(
    cwd: String,
    include_diff_counts: bool,
) -> Result<Vec<GitPathStatus>, String> {
    let start = PathBuf::from(&cwd);
    if !start.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path_looks_safe(&start) {
        return Err("invalid path".into());
    }
    let Some(root) = find_git_root(&start) else {
        return Ok(vec![]);
    };
    let out = git_status_output(&root).map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("git status failed".into());
    }

    let mut by_path: HashMap<PathBuf, String> = HashMap::new();
    for raw in out.stdout.split(|&b| b == 0).filter(|s| !s.is_empty()) {
        let line = match std::str::from_utf8(raw) {
            Ok(s) => s.trim_end_matches('\r'),
            Err(_) => continue,
        };
        if line.len() < 3 {
            continue;
        }
        let xy = &line[0..2];
        if line.chars().nth(2) != Some(' ') {
            continue;
        }
        let rest = line[3..].trim();
        let path_part = rest.split(" -> ").last().unwrap_or(rest).trim();
        let rel = Path::new(path_part);
        let full = root.join(rel);
        let full_abs = fs::canonicalize(&full).unwrap_or(full);
        let label = git_status_label(xy).to_string();
        by_path.insert(full_abs, label);
    }

    let diffs = if include_diff_counts {
        cached_diff_counts(&root)
    } else {
        HashMap::new()
    };

    Ok(by_path
        .into_iter()
        .map(|(path, status)| {
            let (added, removed) = diffs.get(&path).cloned().unwrap_or((0, 0));
            GitPathStatus {
                path: path.to_string_lossy().into_owned(),
                status,
                added,
                removed,
            }
        })
        .collect())
}

pub fn git_repo_info_impl(cwd: String) -> Result<Option<GitRepoInfo>, String> {
    let start = PathBuf::from(&cwd);
    if !start.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path_looks_safe(&start) {
        return Err("invalid path".into());
    }

    let Some(root) = find_git_root(&start) else {
        return Ok(None);
    };

    let root_abs = fs::canonicalize(&root).unwrap_or(root);
    let name = root_abs
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();

    let diffs = cached_diff_counts(&root_abs);
    let mut changed_files = 0_i32;
    let mut added_lines = 0_i32;
    let mut removed_lines = 0_i32;
    for (added, removed) in diffs.values() {
        let a = (*added).max(0);
        let r = (*removed).max(0);
        if a > 0 || r > 0 {
            changed_files = changed_files.saturating_add(1);
        }
        added_lines = added_lines.saturating_add(a);
        removed_lines = removed_lines.saturating_add(r);
    }

    let (total_files, remote_url) = if let Ok(repo) = Repository::open(&root_abs) {
        let total_files = git_ls_files_count(&root_abs)
            .or_else(|| repo.index().ok().map(|idx| idx.len() as i32))
            .unwrap_or(0);
        let remote_url = detect_remote_url(&repo);
        (total_files, remote_url)
    } else {
        (0, None)
    };

    Ok(Some(GitRepoInfo {
        root: root_abs.to_string_lossy().into_owned(),
        name,
        total_files,
        changed_files,
        added_lines,
        removed_lines,
        remote_url,
    }))
}

fn icon_key_for(_name: &str, is_dir: bool) -> Option<String> {
    Some(if is_dir {
        "folder".into()
    } else {
        "file".into()
    })
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
    let p_abs = fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
    let git_map = find_git_root(&p_abs).and_then(|root| {
        let root_abs = fs::canonicalize(&root).unwrap_or(root);
        if root_abs == p_abs {
            git_status_map_for_dir(&p_abs)
        } else {
            None
        }
    });

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
        let git_status = git_map.as_ref().and_then(|m| m.get(&name).cloned());
        v.push(FsEntry {
            name: name.clone(),
            path: full,
            is_dir,
            git_status,
            icon_key: icon_key_for(&name, is_dir),
        });
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
