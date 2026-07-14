//! Connection profiles under `~/.partty/profiles/*.toml`.
//!
//! Local profiles are seeded from detected shells; WSL profiles from
//! `wsl.exe -l -q` (same discovery Windows Terminal uses). Friendly `name`
//! is display-only — spawn uses `shell` / `wsl_distro` / etc.

use crate::prefs::{ensure_config_dir, Prefs};
use crate::pty::detect_available_shells;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub const LOCAL_DEFAULT_ID: &str = "local-default";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileKind {
    Local,
    Wsl,
    Ssh,
}

impl Default for ProfileKind {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    /// Schema version (same key as keybinds/themes: `version = 1`).
    #[serde(default = "default_version", alias = "v")]
    pub version: u32,
    pub id: String,
    /// Friendly display name (UI / palette). Independent of shell/distro/SSH.
    #[serde(alias = "display_name")]
    pub name: String,
    #[serde(default)]
    pub kind: ProfileKind,
    /// Shell executable. Empty / absent → use global `prefs.shell`.
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub initial_cwd: Option<String>,
    #[serde(default)]
    pub wsl_distro: Option<String>,
    /// SSH target: `host`, `user@host`, or an `~/.ssh/config` Host alias.
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    /// Extra OpenSSH client args (e.g. `["-J", "jump", "-o", "ForwardAgent=yes"]`).
    #[serde(default)]
    pub ssh_args: Vec<String>,
    /// Full commandline override (Windows Terminal style), e.g. `ssh -J jump user@host`.
    /// When set, structured `ssh_*` fields are ignored.
    #[serde(default)]
    pub commandline: Option<String>,
    #[serde(default)]
    pub startup_command: Option<String>,
    /// Spawn using another profile (chainable). TOML key: `base`.
    #[serde(default, alias = "base_profile_id")]
    pub base: Option<String>,
    /// Overrides `[profiles].inherit_cwd_on_split` for splits into this profile.
    #[serde(default, alias = "inherit_cwd_on_split")]
    pub inherit_cwd: Option<bool>,
    #[serde(default)]
    pub icon: Option<String>,
    /// Pane color theme (`id`, `id/variant`, or custom slug). Colors only.
    #[serde(default)]
    pub theme: Option<String>,
    /// Seeded / built-in profiles (still editable on disk).
    #[serde(default)]
    pub builtin: bool,
}

fn default_version() -> u32 {
    1
}

/// DTO for the webview (camelCase).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub kind: String,
    pub shell: Option<String>,
    pub initial_cwd: Option<String>,
    pub wsl_distro: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_user: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
    pub ssh_args: Vec<String>,
    pub commandline: Option<String>,
    pub startup_command: Option<String>,
    pub base: Option<String>,
    pub inherit_cwd: Option<bool>,
    pub icon: Option<String>,
    pub theme: Option<String>,
    pub builtin: bool,
    /// `data:image/…;base64,…` when `[profiles].palette_icons` is on.
    pub icon_data_url: Option<String>,
}

impl From<&ConnectionProfile> for ProfileDto {
    fn from(p: &ConnectionProfile) -> Self {
        Self {
            version: p.version,
            id: p.id.clone(),
            name: p.name.clone(),
            kind: match p.kind {
                ProfileKind::Local => "local".into(),
                ProfileKind::Wsl => "wsl".into(),
                ProfileKind::Ssh => "ssh".into(),
            },
            shell: p.shell.clone(),
            initial_cwd: p.initial_cwd.clone(),
            wsl_distro: p.wsl_distro.clone(),
            ssh_host: p.ssh_host.clone(),
            ssh_user: p.ssh_user.clone(),
            ssh_port: p.ssh_port,
            ssh_identity_file: p.ssh_identity_file.clone(),
            ssh_args: p.ssh_args.clone(),
            commandline: p.commandline.clone(),
            startup_command: p.startup_command.clone(),
            base: p.base.clone(),
            inherit_cwd: p.inherit_cwd,
            icon: p.icon.clone(),
            theme: p.theme.clone(),
            builtin: p.builtin,
            icon_data_url: None,
        }
    }
}

pub fn profiles_dir() -> Result<PathBuf, String> {
    let dir = ensure_config_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join("profiles");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn validate_profile_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 {
        return Err("invalid profile id length".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("profile id: use letters, numbers, dashes, underscores only".into());
    }
    Ok(())
}

fn profile_path(id: &str) -> Result<PathBuf, String> {
    validate_profile_id(id)?;
    Ok(profiles_dir()?.join(format!("{id}.toml")))
}

fn builtin_local_default() -> ConnectionProfile {
    ConnectionProfile {
        version: 1,
        id: LOCAL_DEFAULT_ID.into(),
        name: "Local (default shell)".into(),
        kind: ProfileKind::Local,
        shell: None,
        initial_cwd: None,
        wsl_distro: None,
        ssh_host: None,
        ssh_user: None,
        ssh_port: None,
        ssh_identity_file: None,
        ssh_args: Vec::new(),
        commandline: None,
        startup_command: None,
        base: None,
        inherit_cwd: None,
        icon: None,
        theme: None,
        builtin: true,
    }
}

fn display_name_for_shell(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "pwsh" => "pwsh".into(),
        "powershell" => "powershell".into(),
        "cmd" => "CMD".into(),
        "bash" => "bash".into(),
        "zsh" => "zsh".into(),
        other => other.to_string(),
    }
}

fn slugify(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_dash = false;
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn profile_id_for_shell(name: &str) -> String {
    format!("local-{}", slugify(name))
}

fn profile_id_for_wsl(distro: &str) -> String {
    let slug = slugify(distro);
    if slug.is_empty() {
        "wsl-default".into()
    } else {
        format!("wsl-{slug}")
    }
}

fn write_profile_if_missing(profile: &ConnectionProfile) -> Result<(), String> {
    let path = profile_path(&profile.id)?;
    if path.exists() {
        return Ok(());
    }
    write_profile(profile)
}

pub fn write_profile(profile: &ConnectionProfile) -> Result<(), String> {
    validate_profile_id(&profile.id)?;
    let path = profile_path(&profile.id)?;
    let text = toml::to_string_pretty(profile).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_profile(id: &str) -> Result<ConnectionProfile, String> {
    let path = profile_path(id)?;
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut p: ConnectionProfile = toml::from_str(&text).map_err(|e| e.to_string())?;
    if p.id.trim().is_empty() {
        p.id = id.to_string();
    }
    if p.version == 0 {
        p.version = 1;
    }
    if p.name.trim().is_empty() {
        p.name = p.id.clone();
    }
    Ok(p)
}

fn load_all_from_disk() -> Result<Vec<ConnectionProfile>, String> {
    let dir = profiles_dir()?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if stem.is_empty() {
            continue;
        }
        match read_profile(&stem) {
            Ok(p) => out.push(p),
            Err(e) => eprintln!("partty: skip profile {}: {e}", path.display()),
        }
    }
    sort_profiles(&mut out);
    Ok(out)
}

fn sort_profiles(profiles: &mut [ConnectionProfile]) {
    profiles.sort_by(|a, b| {
        let rank = |p: &ConnectionProfile| -> u8 {
            if p.id == LOCAL_DEFAULT_ID {
                0
            } else if matches!(p.kind, ProfileKind::Local) {
                1
            } else if matches!(p.kind, ProfileKind::Wsl) {
                2
            } else {
                3
            }
        };
        match rank(a).cmp(&rank(b)) {
            std::cmp::Ordering::Equal => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            other => other,
        }
    });
}

/// Decode `wsl.exe -l -q` output (UTF-16 LE with or without BOM, or UTF-8).
fn decode_wsl_list_bytes(bytes: &[u8]) -> String {
    let bytes = if bytes.starts_with(&[0xFF, 0xFE]) {
        &bytes[2..]
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        // UTF-16 BE — rare for wsl.exe; fall through to lossy UTF-8
        return String::from_utf8_lossy(bytes).into_owned();
    } else {
        bytes
    };

    let looks_utf16_le = bytes.len() >= 4
        && bytes.len() % 2 == 0
        && bytes.iter().skip(1).step_by(2).filter(|&&b| b == 0).count() * 2 >= bytes.len() / 2;

    if looks_utf16_le {
        let u16s: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }

    String::from_utf8_lossy(bytes).into_owned()
}

/// Installed WSL distribution names (`wsl.exe -l -q`), matching Windows Terminal.
pub fn list_wsl_distros() -> Vec<String> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const TTL: Duration = Duration::from_secs(45);
    static CACHE: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);

    if let Ok(guard) = CACHE.lock() {
        if let Some((at, names)) = guard.as_ref() {
            if at.elapsed() < TTL {
                return names.clone();
            }
        }
    }

    let names = list_wsl_distros_uncached();
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), names.clone()));
    }
    names
}

fn list_wsl_distros_uncached() -> Vec<String> {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-l", "-q"]);
    crate::subprocess::hide_console_window(&mut cmd);
    let output = cmd.output();
    let Ok(out) = output else {
        return Vec::new();
    };
    // wsl may exit non-zero when no distros / WSL missing; still try stdout.
    let text = decode_wsl_list_bytes(&out.stdout);
    let mut names = Vec::new();
    for line in text.lines() {
        let name = line.trim().trim_start_matches('\u{feff}');
        if name.is_empty() {
            continue;
        }
        // Skip noise / error lines
        if name.starts_with("Windows Subsystem")
            || name.contains("wsl.exe")
            || name.contains("error")
            || name.contains("Error")
        {
            continue;
        }
        if !names.iter().any(|n: &String| n.eq_ignore_ascii_case(name)) {
            names.push(name.to_string());
        }
    }
    names
}

fn seed_local_shell_profiles() -> Result<(), String> {
    let shells = detect_available_shells();
    for shell in shells {
        // Bare `wsl` is replaced by per-distro profiles below.
        if shell.name.eq_ignore_ascii_case("wsl") {
            continue;
        }
        let id = profile_id_for_shell(&shell.name);
        let want_name = display_name_for_shell(&shell.name);
        let path = profile_path(&id)?;
        if path.exists() {
            // Refresh default display names for seeded builtins (keep user renames).
            if let Ok(mut existing) = read_profile(&id) {
                if existing.builtin && existing.name != want_name {
                    let is_stock = matches!(
                        existing.name.as_str(),
                        "PowerShell 7"
                            | "Windows PowerShell"
                            | "Command Prompt"
                            | "Git Bash"
                            | "Zsh"
                            | "pwsh"
                            | "powershell"
                            | "CMD"
                            | "bash"
                            | "zsh"
                    ) || existing.name.eq_ignore_ascii_case(&shell.name);
                    if is_stock {
                        existing.name = want_name;
                        write_profile(&existing)?;
                    }
                }
            }
            continue;
        }
        let profile = ConnectionProfile {
            version: 1,
            id,
            name: want_name,
            kind: ProfileKind::Local,
            shell: Some(shell.name.clone()),
            initial_cwd: None,
            wsl_distro: None,
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            ssh_identity_file: None,
            ssh_args: Vec::new(),
            commandline: None,
            startup_command: None,
            base: None,
            inherit_cwd: None,
            icon: None,
            theme: None,
            builtin: true,
        };
        write_profile(&profile)?;
    }
    Ok(())
}

fn seed_wsl_profiles() -> Result<(), String> {
    for distro in list_wsl_distros() {
        let mut id = profile_id_for_wsl(&distro);
        if id.len() > 64 {
            let slug = slugify(&distro);
            let take = slug.len().min(56);
            id = format!("wsl-{}", &slug[..take]);
        }
        let profile = ConnectionProfile {
            version: 1,
            id,
            name: distro.clone(),
            kind: ProfileKind::Wsl,
            shell: None,
            initial_cwd: None,
            wsl_distro: Some(distro),
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            ssh_identity_file: None,
            ssh_args: Vec::new(),
            commandline: None,
            startup_command: None,
            base: None,
            inherit_cwd: None,
            icon: None,
            theme: None,
            builtin: true,
        };
        write_profile_if_missing(&profile)?;
    }
    Ok(())
}

/// Ensure default + local shells + WSL distros are present on disk.
pub fn ensure_seeded_profiles() -> Result<(), String> {
    let _ = profiles_dir()?;
    write_profile_if_missing(&builtin_local_default())?;
    seed_local_shell_profiles()?;
    seed_wsl_profiles()?;
    Ok(())
}

/// Merge freshly detected shells/distros into the list even if a write failed,
/// so the palette stays in sync with Settings / Windows Terminal discovery.
fn merge_detected_ephemeral(mut profiles: Vec<ConnectionProfile>) -> Vec<ConnectionProfile> {
    let existing: std::collections::HashSet<String> =
        profiles.iter().map(|p| p.id.to_ascii_lowercase()).collect();

    for shell in detect_available_shells() {
        if shell.name.eq_ignore_ascii_case("wsl") {
            continue;
        }
        let id = profile_id_for_shell(&shell.name);
        if existing.contains(&id.to_ascii_lowercase()) {
            continue;
        }
        profiles.push(ConnectionProfile {
            version: 1,
            id,
            name: display_name_for_shell(&shell.name),
            kind: ProfileKind::Local,
            shell: Some(shell.name),
            initial_cwd: None,
            wsl_distro: None,
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            ssh_identity_file: None,
            ssh_args: Vec::new(),
            commandline: None,
            startup_command: None,
            base: None,
            inherit_cwd: None,
            icon: None,
            theme: None,
            builtin: true,
        });
    }

    let existing: std::collections::HashSet<String> =
        profiles.iter().map(|p| p.id.to_ascii_lowercase()).collect();
    for distro in list_wsl_distros() {
        let id = profile_id_for_wsl(&distro);
        if existing.contains(&id.to_ascii_lowercase()) {
            continue;
        }
        profiles.push(ConnectionProfile {
            version: 1,
            id,
            name: distro.clone(),
            kind: ProfileKind::Wsl,
            shell: None,
            initial_cwd: None,
            wsl_distro: Some(distro),
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            ssh_identity_file: None,
            ssh_args: Vec::new(),
            commandline: None,
            startup_command: None,
            base: None,
            inherit_cwd: None,
            icon: None,
            theme: None,
            builtin: true,
        });
    }

    if !profiles.iter().any(|p| p.id == LOCAL_DEFAULT_ID) {
        profiles.insert(0, builtin_local_default());
    }
    sort_profiles(&mut profiles);
    profiles
}

pub fn list_profiles(prefs: &Prefs) -> Result<Vec<ProfileDto>, String> {
    let _ = ensure_seeded_profiles();
    let profiles = match load_all_from_disk() {
        Ok(p) if !p.is_empty() => merge_detected_ephemeral(p),
        Ok(_) | Err(_) => {
            let def = builtin_local_default();
            let _ = write_profile(&def);
            merge_detected_ephemeral(vec![def])
        }
    };

    let omit: std::collections::HashSet<String> = prefs
        .profile_omit
        .iter()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    let with_icons = prefs.palette_profile_icons;
    Ok(profiles
        .into_iter()
        .filter(|p| !omit.contains(&p.id.to_ascii_lowercase()))
        .map(|p| {
            let mut dto = ProfileDto::from(&p);
            if with_icons {
                let kind = dto.kind.as_str();
                if let Some(src) = crate::profile_icons::resolve_icon_source(
                    kind,
                    p.shell.as_deref(),
                    p.icon.as_deref(),
                    p.commandline.as_deref(),
                    p.wsl_distro.as_deref(),
                ) {
                    dto.icon_data_url = crate::profile_icons::icon_data_url_for_path(&src);
                }
            }
            dto
        })
        .collect())
}

pub fn get_profile(id: &str) -> Result<ConnectionProfile, String> {
    // Fast path: read from disk. Do not re-run shell/WSL detection on every spawn.
    match read_profile(id) {
        Ok(p) => Ok(p),
        Err(_) => {
            for p in merge_detected_ephemeral(Vec::new()) {
                if p.id == id {
                    return Ok(p);
                }
            }
            Err(format!("profile not found: {id}"))
        }
    }
}

const MAX_BASE_PROFILE_DEPTH: usize = 8;

/// Follow `base` chain to the profile that owns spawn settings.
pub fn resolve_effective_spawn_profile(assigned_id: &str) -> Result<ConnectionProfile, String> {
    use std::collections::HashSet;

    let mut id = assigned_id.trim().to_string();
    if id.is_empty() {
        return Err("profile id is empty".into());
    }
    let mut seen = HashSet::new();
    let mut profile = get_profile(&id)?;

    for _ in 0..MAX_BASE_PROFILE_DEPTH {
        seen.insert(id);
        let Some(base_id) = profile
            .base
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            return Ok(profile);
        };
        if seen.contains(base_id) {
            return Err(format!("profile base chain cycle at `{base_id}`"));
        }
        id = base_id.to_string();
        profile = get_profile(&id)?;
    }
    Err(format!(
        "profile base chain exceeds depth {MAX_BASE_PROFILE_DEPTH} (started at `{assigned_id}`)"
    ))
}

/// SSH startup from the assigned profile (overrides base when `base` is set).
pub fn resolve_ssh_startup_command(assigned: &ConnectionProfile) -> Option<String> {
    assigned
        .startup_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Resolve effective shell for a local profile against global prefs.
#[allow(dead_code)]
pub fn resolve_shell(profile: &ConnectionProfile, prefs: &Prefs) -> String {
    profile
        .shell
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| prefs.shell.trim())
        .to_string()
}

/// Resolve optional initial cwd override from profile (pane cwd still wins when set).
#[allow(dead_code)]
pub fn resolve_initial_cwd<'a>(
    profile: &'a ConnectionProfile,
    prefs: &'a Prefs,
) -> Option<&'a str> {
    profile
        .initial_cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            prefs
                .initial_cwd
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
}

#[allow(dead_code)]
pub fn profile_exists(id: &str) -> bool {
    profile_path(id).map(|p| p.exists()).unwrap_or(false)
}

#[allow(dead_code)]
pub fn delete_profile_file(id: &str) -> Result<(), String> {
    if id == LOCAL_DEFAULT_ID {
        return Err("cannot delete the built-in local-default profile".into());
    }
    let path = profile_path(id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_slug() {
        assert_eq!(profile_id_for_shell("pwsh"), "local-pwsh");
        assert_eq!(profile_id_for_shell("PowerShell"), "local-powershell");
    }

    #[test]
    fn wsl_slug() {
        assert_eq!(profile_id_for_wsl("Ubuntu-22.04"), "wsl-ubuntu-22-04");
        assert_eq!(profile_id_for_wsl("archlinux"), "wsl-archlinux");
    }

    #[test]
    fn profile_theme_field_deserializes_and_dto() {
        let text = r#"
version = 1
id = "ssh-mango"
name = "mango"
kind = "ssh"
commandline = "ssh host"
theme = "carbonfox"
"#;
        let p: ConnectionProfile = toml::from_str(text).unwrap();
        assert_eq!(p.theme.as_deref(), Some("carbonfox"));
        let dto = ProfileDto::from(&p);
        assert_eq!(dto.theme.as_deref(), Some("carbonfox"));
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["theme"], "carbonfox");
    }

    #[test]
    fn decode_utf16_le_wsl_list() {
        // "ubuntu\r\n" in UTF-16 LE
        let bytes: Vec<u8> = "ubuntu\r\n"
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        let text = decode_wsl_list_bytes(&bytes);
        assert!(text.contains("ubuntu"));
    }
}
