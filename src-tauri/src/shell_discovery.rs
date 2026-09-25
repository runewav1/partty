//! Shared discovery for profile enumeration and launch. Inspired by Windows Terminal's
//! PowershellCoreProfileGenerator and WslDistroGenerator; additionally consult installer
//! registration and PATH to support installations on arbitrary drives/directories.
use std::path::{Path, PathBuf};

/// Expand Windows environment references without interpreting shell syntax or arguments.
fn expand_with(value: &str, env: &impl Fn(&str) -> Option<String>) -> String {
    let mut result = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        result.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest[1..].find('%').map(|i| i + 1) else {
            break;
        };
        if let Some(replacement) = env(&rest[1..end]) {
            result.push_str(&replacement);
        } else {
            result.push_str(&rest[..=end]);
        }
        rest = &rest[end + 1..];
    }
    result.push_str(rest);
    result
}

pub fn expand_path(value: &str) -> PathBuf {
    PathBuf::from(expand_with(
        value.trim().trim_matches(|c| c == '"' || c == '\''),
        &|name| std::env::var(name).ok(),
    ))
}

pub fn executable_exists(path: &Path) -> bool {
    // App execution aliases are reparse points; following them through metadata can
    // fail even though CreateProcess can launch them.
    path.is_file()
        || std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
}

fn find_in_path(name: &str, path: &str) -> Option<PathBuf> {
    // Windows PATH permits quoted entries. Ignore empty entries (current directory).
    std::env::split_paths(path)
        .map(|p| expand_path(&p.to_string_lossy()))
        .filter(|p| p.is_absolute())
        .map(|dir| dir.join(name))
        .find(|p| executable_exists(p))
}

pub fn resolve_on_path(name: &str) -> Option<PathBuf> {
    let name = if Path::new(name).extension().is_none() {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Some(found) = std::env::var("PATH")
        .ok()
        .and_then(|p| find_in_path(&name, &p))
    {
        return Some(found);
    }
    // Explorer / the app may have inherited PATH before an installer updated it.
    for (root, key) in [
        (
            reg::MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ),
        (reg::USER, r"Environment"),
    ] {
        if let Some(found) = reg::Key::open(root, key, 0)
            .and_then(|k| k.string("Path"))
            .and_then(|p| find_in_path(&name, &p))
        {
            return Some(found);
        }
    }
    None
}

fn versioned_pwsh(root: &Path) -> Vec<PathBuf> {
    let mut versions = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let major = name
                .split(|c: char| !c.is_ascii_digit())
                .next()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            let exe = entry.path().join("pwsh.exe");
            if executable_exists(&exe) {
                versions.push((name.contains("preview"), std::cmp::Reverse(major), exe));
            }
        }
    }
    versions.sort();
    versions.into_iter().map(|(_, _, p)| p).collect()
}

fn pwsh_candidates(env: &impl Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for variable in [
        "ProgramW6432",
        "ProgramFiles",
        "ProgramFiles(Arm)",
        "ProgramFiles(x86)",
    ] {
        if let Some(root) = env(variable) {
            paths.extend(versioned_pwsh(&PathBuf::from(root).join("PowerShell")));
        }
    }
    if let Some(root) = env("LOCALAPPDATA") {
        let aliases = PathBuf::from(root).join("Microsoft/WindowsApps");
        for family in [
            "Microsoft.PowerShell_8wekyb3d8bbwe",
            "Microsoft.PowerShellPreview_8wekyb3d8bbwe",
            "",
        ] {
            paths.push(aliases.join(family).join("pwsh.exe"));
        }
    }
    if let Some(home) = env("USERPROFILE") {
        paths.push(PathBuf::from(&home).join(".dotnet/tools/pwsh.exe"));
        paths.push(PathBuf::from(home).join("scoop/shims/pwsh.exe"));
    }
    for variable in ["SCOOP", "SCOOP_GLOBAL"] {
        if let Some(root) = env(variable) {
            paths.push(PathBuf::from(root).join("shims/pwsh.exe"));
        }
    }
    if let Some(root) = env("DOTNET_CLI_HOME") {
        paths.push(PathBuf::from(root).join(".dotnet/tools/pwsh.exe"));
    }
    paths
}

fn preview_path(path: &Path) -> bool {
    path.parent().and_then(Path::file_name).is_some_and(|name| {
        let name = name.to_string_lossy().to_ascii_lowercase();
        name.contains("-preview") || name.starts_with("microsoft.powershellpreview_")
    })
}

fn registered_pwsh() -> Vec<(PathBuf, bool)> {
    let mut paths = Vec::new();
    for root in [reg::USER, reg::MACHINE] {
        for view in [reg::VIEW64, reg::VIEW32] {
            if let Some(key) = reg::Key::open(
                root,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\pwsh.exe",
                view,
            ) && let Some(path) = key.string("")
            {
                let path = expand_path(&path);
                let preview = preview_path(&path);
                paths.push((path, preview));
            }
            if let Some(key) = reg::Key::open(
                root,
                r"SOFTWARE\Microsoft\PowerShellCore\InstalledVersions",
                view,
            ) {
                for name in key.children() {
                    if let Some(install) = key.child(&name, view)
                        && let Some(path) = install.string("InstallLocation")
                    {
                        let path = expand_path(&path).join("pwsh.exe");
                        let preview = install
                            .string("SemanticVersion")
                            .map(|v| v.contains('-'))
                            .unwrap_or_else(|| preview_path(&path));
                        paths.push((path, preview));
                    }
                }
            }
        }
    }
    paths
}

pub fn resolve_pwsh(preview: bool) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = resolve_on_path("pwsh.exe") {
        let preview = preview_path(&path);
        candidates.push((path, preview));
    }
    candidates.extend(registered_pwsh());
    candidates.extend(
        pwsh_candidates(&|name| std::env::var(name).ok())
            .into_iter()
            .map(|p| {
                let preview = preview_path(&p);
                (p, preview)
            }),
    );
    select_pwsh(candidates, preview)
}

fn select_pwsh(mut candidates: Vec<(PathBuf, bool)>, preview: bool) -> Option<PathBuf> {
    // Stable by default, preview only for the explicit preview alias. Preserve source
    // order within each channel (PATH, installer registrations, conventional installs).
    candidates.sort_by_key(|(_, preview)| *preview);
    candidates
        .into_iter()
        .find(|(p, is_preview)| (!preview || *is_preview) && executable_exists(p))
        .map(|(p, _)| p)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub(crate) struct Fixture(pub PathBuf);
    impl Fixture {
        pub(crate) fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join("opencode").join(format!(
                "partty-shell-discovery-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        pub(crate) fn exe(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"discovery fixture, not an executable").unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn arbitrary_path_entries_are_not_command_lines() {
        let temp = Fixture::new();
        for directory in [
            "Program Files/PowerShell/7",
            "Program Files (x86)/PowerShell/7",
            "portable anywhere",
            "O'Brien & Sons/(shell) [7] #!",
            "日本語/Æøå 😀",
            "a.b/7.6.0-preview.2",
            "dollar $HOME and `backticks`",
            "semicolon; in a quoted PATH entry",
        ] {
            let exe = temp.exe(&format!("{directory}/pwsh.exe"));
            let list = format!(
                ";relative;{};\"{}\";",
                temp.0.join("missing").display(),
                exe.parent().unwrap().display()
            );
            assert_eq!(
                find_in_path("pwsh.exe", &list),
                Some(exe.clone()),
                "{directory}"
            );
            assert_eq!(expand_path(&format!("\"{}\"", exe.display())), exe);
            assert_eq!(find_in_path("powershell.exe", &list), None);
        }
    }

    #[test]
    fn versioned_installs_prefer_stable_and_numeric_major() {
        let temp = Fixture::new();
        for version in ["7", "6", "10", "11-preview", "not-a-version"] {
            temp.exe(&format!("PowerShell/{version}/pwsh.exe"));
        }
        let found = versioned_pwsh(&temp.0.join("PowerShell"));
        assert_eq!(found[0], temp.0.join("PowerShell/10/pwsh.exe"));
        assert_eq!(
            found.last().unwrap(),
            &temp.0.join("PowerShell/11-preview/pwsh.exe")
        );
        assert!(versioned_pwsh(&temp.0.join("missing")).is_empty());
    }

    #[test]
    fn store_scoop_dotnet_and_redirected_roots_are_discovered() {
        let temp = Fixture::new();
        for (variable, relative) in [
            ("ProgramFiles", "PowerShell/7/pwsh.exe"),
            ("ProgramW6432", "PowerShell/8/pwsh.exe"),
            ("ProgramFiles(x86)", "PowerShell/7/pwsh.exe"),
            ("ProgramFiles(Arm)", "PowerShell/7/pwsh.exe"),
            (
                "LOCALAPPDATA",
                "Microsoft/WindowsApps/Microsoft.PowerShell_8wekyb3d8bbwe/pwsh.exe",
            ),
            (
                "LOCALAPPDATA",
                "Microsoft/WindowsApps/Microsoft.PowerShellPreview_8wekyb3d8bbwe/pwsh.exe",
            ),
            ("LOCALAPPDATA", "Microsoft/WindowsApps/pwsh.exe"),
            ("USERPROFILE", ".dotnet/tools/pwsh.exe"),
            ("USERPROFILE", "scoop/shims/pwsh.exe"),
            ("SCOOP", "shims/pwsh.exe"),
            ("SCOOP_GLOBAL", "shims/pwsh.exe"),
            ("DOTNET_CLI_HOME", ".dotnet/tools/pwsh.exe"),
        ] {
            let exe = temp.exe(&format!("custom location 日本語/{relative}"));
            let root = temp
                .0
                .join("custom location 日本語")
                .to_string_lossy()
                .into_owned();
            let candidates = pwsh_candidates(&|key| (key == variable).then(|| root.clone()));
            assert!(candidates.contains(&exe), "{variable}: {}", exe.display());
        }
    }

    #[test]
    fn selection_skips_stale_registrations_and_respects_channel() {
        let temp = Fixture::new();
        let stable = temp.exe("portable/stable/pwsh.exe");
        let preview = temp.exe("arbitrary location/pwsh.exe");
        let candidates = vec![
            (temp.0.join("removed/pwsh.exe"), false),
            (preview.clone(), true),
            (stable.clone(), false),
        ];
        assert_eq!(select_pwsh(candidates.clone(), false), Some(stable.clone()));
        assert_eq!(select_pwsh(candidates, true), Some(preview.clone()));
        assert_eq!(select_pwsh(vec![(stable, false)], true), None);
        assert_eq!(
            select_pwsh(vec![(preview.clone(), true)], false),
            Some(preview)
        );
    }

    #[test]
    fn expands_environment_without_reinterpreting_windows_paths() {
        let lookup = |key: &str| match key {
            "TOOLS" => Some(r"D:\Odd & 日本語\Tools".into()),
            _ => None,
        };
        assert_eq!(
            expand_with(r"%TOOLS%\pwsh.exe", &lookup),
            r"D:\Odd & 日本語\Tools\pwsh.exe"
        );
        for path in [
            r"\\server\share name\pwsh.exe",
            r"\\?\D:\very long path\pwsh.exe",
            r"%UNKNOWN%\pwsh.exe",
            "100% portable",
        ] {
            assert_eq!(expand_with(path, &lookup), path);
        }
    }

    /// Opt-in verification on a Windows development machine with PowerShell installed.
    #[test]
    #[ignore = "requires an installed PowerShell; executes it without loading profiles"]
    fn live_discovery_smoke() {
        let exe = resolve_pwsh(false).expect("installed PowerShell should be discovered");
        let output = std::process::Command::new(&exe)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$PSVersionTable.PSVersion.ToString()",
            ])
            .output()
            .expect("discovered PowerShell should launch");
        assert!(output.status.success(), "{}: {:?}", exe.display(), output);
        println!(
            "PowerShell: {} ({})",
            exe.display(),
            String::from_utf8_lossy(&output.stdout).trim()
        );
        println!("Git Bash: {:?}", resolve_git_bash());
        println!(
            "WSL: {:?}; distributions: {:?}",
            resolve_wsl(),
            wsl_distros()
        );
    }
}

pub fn resolve_git_bash() -> Option<PathBuf> {
    for root in [reg::USER, reg::MACHINE] {
        for view in [reg::VIEW64, reg::VIEW32] {
            if let Some(path) = reg::Key::open(root, r"SOFTWARE\GitForWindows", view)
                .and_then(|k| k.string("InstallPath"))
                .map(|p| expand_path(&p).join("bin/bash.exe"))
                .filter(|p| executable_exists(p))
            {
                return Some(path);
            }
        }
    }
    // A Git installation can have any directory name. Identify it by its layout.
    resolve_on_path("git.exe").and_then(|git| {
        let root = git.parent()?.parent()?;
        let bash = root.join("bin/bash.exe");
        executable_exists(&bash).then_some(bash)
    })
}

pub fn resolve_wsl() -> Option<PathBuf> {
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    // Sysnative bypasses WOW64 redirection when running a 32-bit process.
    [
        root.join("Sysnative/wsl.exe"),
        root.join("System32/wsl.exe"),
    ]
    .into_iter()
    .find(|p| executable_exists(p))
    .or_else(|| resolve_on_path("wsl.exe"))
}

pub fn wsl_distros() -> Vec<String> {
    let Some(key) = reg::Key::open(
        reg::USER,
        r"Software\Microsoft\Windows\CurrentVersion\Lxss",
        0,
    ) else {
        return Vec::new();
    };
    let mut names = Vec::new();
    for child in key.children() {
        if let Some(name) = key
            .child(&child, 0)
            .and_then(|k| k.string("DistributionName"))
        {
            let lower = name.to_lowercase();
            if !name.trim().is_empty()
                && !lower.starts_with("docker-desktop")
                && !lower.starts_with("rancher-desktop")
                && !names.iter().any(|n: &String| n.eq_ignore_ascii_case(&name))
            {
                names.push(name);
            }
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    names
}

// Read-only handles, closed on every exit path. No subprocesses or shell parsing.
mod reg {
    use std::ptr;
    use windows_sys::Win32::System::Registry::*;
    pub const USER: HKEY = HKEY_CURRENT_USER;
    pub const MACHINE: HKEY = HKEY_LOCAL_MACHINE;
    pub const VIEW64: u32 = KEY_WOW64_64KEY;
    pub const VIEW32: u32 = KEY_WOW64_32KEY;
    pub struct Key(HKEY);
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    impl Key {
        pub fn open(root: HKEY, path: &str, view: u32) -> Option<Self> {
            let mut handle = ptr::null_mut();
            // SAFETY: NUL-terminated name and valid output pointer; read-only access.
            let status = unsafe {
                RegOpenKeyExW(root, wide(path).as_ptr(), 0, KEY_READ | view, &mut handle)
            };
            (status == 0).then(|| Self(handle))
        }
        pub fn child(&self, path: &str, view: u32) -> Option<Self> {
            Self::open(self.0, path, view)
        }
        pub fn children(&self) -> Vec<String> {
            let mut names = Vec::new();
            for index in 0.. {
                let mut buffer = [0u16; 256];
                let mut length = buffer.len() as u32;
                // SAFETY: registry subkey names have at most 255 UTF-16 code units.
                let status = unsafe {
                    RegEnumKeyExW(
                        self.0,
                        index,
                        buffer.as_mut_ptr(),
                        &mut length,
                        ptr::null(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                        ptr::null_mut(),
                    )
                };
                if status != 0 {
                    break;
                }
                names.push(String::from_utf16_lossy(&buffer[..length as usize]));
            }
            names
        }
        pub fn string(&self, name: &str) -> Option<String> {
            let name = wide(name);
            let mut kind = 0;
            let mut size = 0;
            // SAFETY: probe required size without reading data.
            let status = unsafe {
                RegQueryValueExW(
                    self.0,
                    name.as_ptr(),
                    ptr::null(),
                    &mut kind,
                    ptr::null_mut(),
                    &mut size,
                )
            };
            if status != 0 || size > 65536 || size % 2 != 0 {
                return None;
            }
            let mut data = vec![0u16; size as usize / 2 + 1];
            // SAFETY: allocation covers the probed byte count; API bounds its write.
            let status = unsafe {
                RegQueryValueExW(
                    self.0,
                    name.as_ptr(),
                    ptr::null(),
                    &mut kind,
                    data.as_mut_ptr().cast(),
                    &mut size,
                )
            };
            if status != 0 || !matches!(kind, REG_SZ | REG_EXPAND_SZ) {
                return None;
            }
            Some(
                String::from_utf16_lossy(&data[..size as usize / 2])
                    .trim_end_matches('\0')
                    .to_string(),
            )
        }
    }
    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: this wrapper uniquely owns the opened registry handle.
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
}
