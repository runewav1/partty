//! Extract and cache icons associated with executables (shells, wsl.exe, ssh.exe).
//! Used by the profile palette when `[profiles].palette_icons` is enabled.

use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

/// Cache directory: `~/.partty/cache/icons/`.
pub fn icons_cache_dir() -> Option<PathBuf> {
    crate::prefs::ensure_config_dir().map(|d| d.join("cache").join("icons"))
}

fn cache_key_for_source(source: &Path) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    source.to_string_lossy().to_lowercase().hash(&mut h);
    if let Ok(meta) = fs::metadata(source) {
        if let Ok(modified) = meta.modified() {
            modified.hash(&mut h);
        }
        meta.len().hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

/// Return a `data:image/…;base64,…` URL for an icon file or executable.
/// Results are cached on disk under `~/.partty/cache/icons/`.
pub fn icon_data_url_for_path(source: &Path) -> Option<String> {
    if !source.is_file() {
        return None;
    }
    let cache = icons_cache_dir()?;
    fs::create_dir_all(&cache).ok()?;
    let key = format!("v3-{}", cache_key_for_source(source));

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // Raster assets (WT ProfileIcons PNGs, WSL shortcut.ico): prefer as-is.
    if ext == "png" {
        let cached = cache.join(format!("{key}.png"));
        if !cached.is_file() {
            fs::copy(source, &cached).ok()?;
        }
        let bytes = fs::read(&cached).ok()?;
        return Some(format!(
            "data:image/png;base64,{}",
            encode_base64(&bytes)
        ));
    }
    // WSL shortcut.ico (and similar): WebView won't paint data:image/x-icon reliably.
    // Rasterize via ExtractIconEx → BMP (same path as .exe icons).
    if ext == "ico" {
        let bmp_path = cache.join(format!("{key}.bmp"));
        if !bmp_path.is_file() {
            extract_associated_icon_bmp(source, &bmp_path)?;
        }
        let bytes = fs::read(&bmp_path).ok()?;
        if bytes.is_empty() {
            return None;
        }
        return Some(format!(
            "data:image/bmp;base64,{}",
            encode_base64(&bytes)
        ));
    }

    // Executables / other: extract associated icon → BMP.
    let bmp_path = cache.join(format!("{key}.bmp"));
    if !bmp_path.is_file() {
        extract_associated_icon_bmp(source, &bmp_path)?;
    }
    let bytes = fs::read(&bmp_path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!(
        "data:image/bmp;base64,{}",
        encode_base64(&bytes)
    ))
}

fn encode_base64(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(not(windows))]
fn extract_associated_icon_bmp(_source: &Path, _dest: &Path) -> Option<()> {
    None
}

#[cfg(windows)]
fn extract_associated_icon_bmp(source: &Path, dest: &Path) -> Option<()> {
    use std::ptr;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        PatBlt, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        BLACKNESS,
    };
    use windows_sys::Win32::UI::Shell::{
        ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, DrawIconEx, GetIconInfo, DI_NORMAL, HICON, ICONINFO,
    };

    unsafe {
        let wide: Vec<u16> = source
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut icon: HICON = ptr::null_mut();
        let mut large: HICON = ptr::null_mut();
        let mut small: HICON = ptr::null_mut();
        let extracted = ExtractIconExW(wide.as_ptr(), 0, &mut large, &mut small, 1);
        if extracted > 0 {
            if !small.is_null() {
                icon = small;
                if !large.is_null() && large != small {
                    DestroyIcon(large);
                }
            } else if !large.is_null() {
                icon = large;
            }
        }
        if icon.is_null() {
            let mut sfi = std::mem::zeroed::<SHFILEINFOW>();
            let ok = SHGetFileInfoW(
                wide.as_ptr(),
                0,
                &mut sfi,
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_SMALLICON,
            );
            if ok == 0 || sfi.hIcon.is_null() {
                return None;
            }
            icon = sfi.hIcon;
        }

        let mut info = std::mem::zeroed::<ICONINFO>();
        if GetIconInfo(icon, &mut info) == 0 {
            DestroyIcon(icon);
            return None;
        }

        let screen = GetDC(ptr::null_mut());
        if screen.is_null() {
            cleanup_iconinfo(&info);
            DestroyIcon(icon);
            return None;
        }

        // Prefer a larger draw size so WT/distro icons stay sharp in the palette.
        let size = 32i32;
        let mem_dc = CreateCompatibleDC(screen);
        let dib = CreateCompatibleBitmap(screen, size, size);
        let old = SelectObject(mem_dc, dib);
        PatBlt(mem_dc, 0, 0, size, size, BLACKNESS);
        DrawIconEx(
            mem_dc,
            0,
            0,
            icon,
            size,
            size,
            0,
            ptr::null_mut(),
            DI_NORMAL,
        );
        SelectObject(mem_dc, old);

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: size,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [std::mem::zeroed()],
        };
        let pixel_bytes = (size * size * 4) as usize;
        let mut pixels = vec![0u8; pixel_bytes];
        let got = GetDIBits(
            mem_dc,
            dib,
            0,
            size as u32,
            pixels.as_mut_ptr().cast(),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        DeleteObject(dib);
        DeleteDC(mem_dc);
        ReleaseDC(ptr::null_mut(), screen);
        cleanup_iconinfo(&info);
        DestroyIcon(icon);

        if got == 0 {
            return None;
        }

        let header = &bmi.bmiHeader;
        let file_header_size = 14u32;
        let dib_header_size = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        let off_bits = file_header_size + dib_header_size;
        let bi_size_image = (pixel_bytes as u32).max(header.biSizeImage);
        let file_size = off_bits + bi_size_image;

        let mut out = Vec::with_capacity(file_size as usize);
        out.extend_from_slice(b"BM");
        out.extend_from_slice(&file_size.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&off_bits.to_le_bytes());
        out.extend_from_slice(&header.biSize.to_le_bytes());
        out.extend_from_slice(&header.biWidth.to_le_bytes());
        out.extend_from_slice(&header.biHeight.to_le_bytes());
        out.extend_from_slice(&header.biPlanes.to_le_bytes());
        out.extend_from_slice(&header.biBitCount.to_le_bytes());
        out.extend_from_slice(&header.biCompression.to_le_bytes());
        out.extend_from_slice(&bi_size_image.to_le_bytes());
        out.extend_from_slice(&header.biXPelsPerMeter.to_le_bytes());
        out.extend_from_slice(&header.biYPelsPerMeter.to_le_bytes());
        out.extend_from_slice(&header.biClrUsed.to_le_bytes());
        out.extend_from_slice(&header.biClrImportant.to_le_bytes());
        out.extend_from_slice(&pixels);

        fs::write(dest, &out).ok()?;
        Some(())
    }
}

#[cfg(windows)]
unsafe fn cleanup_iconinfo(info: &windows_sys::Win32::UI::WindowsAndMessaging::ICONINFO) {
    use windows_sys::Win32::Graphics::Gdi::DeleteObject;
    if !info.hbmColor.is_null() {
        DeleteObject(info.hbmColor);
    }
    if !info.hbmMask.is_null() {
        DeleteObject(info.hbmMask);
    }
}

/// Resolve a filesystem path to pull an icon from for a profile.
///
/// Matches Windows Terminal where possible:
/// - Local shells → WT `ProfileIcons/*.png` (not the generic .exe glyph)
/// - WSL → distro `shortcut.ico` under `%LOCALAPPDATA%\wsl\{guid}\` / Lxss BasePath
/// - else fall back to extracting from the executable
pub fn resolve_icon_source(
    kind: &str,
    shell: Option<&str>,
    icon_override: Option<&str>,
    commandline: Option<&str>,
    wsl_distro: Option<&str>,
) -> Option<PathBuf> {
    if let Some(raw) = icon_override.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(raw);
        if p.is_file() {
            return Some(p);
        }
    }

    match kind {
        "wsl" => {
            if let Some(distro) = wsl_distro.map(str::trim).filter(|s| !s.is_empty()) {
                if let Some(ico) = find_wsl_distro_icon(distro) {
                    return Some(ico);
                }
            }
            // WT's default WSL/Tux asset, then wsl.exe as last resort.
            wt_profile_icon_by_guid("9acb9455-ca41-5af7-950f-6bca1bc9722f")
                .or_else(|| resolve_exe_on_path("wsl.exe"))
                .or_else(|| system32_join("wsl.exe"))
        }
        "ssh" => {
            if let Some(cl) = commandline.map(str::trim).filter(|s| !s.is_empty()) {
                let exe = cl.split_whitespace().next().unwrap_or("ssh.exe");
                let p = PathBuf::from(exe);
                if p.is_file() {
                    return Some(p);
                }
                if exe.eq_ignore_ascii_case("ssh") || exe.eq_ignore_ascii_case("ssh.exe") {
                    return resolve_exe_on_path("ssh.exe")
                        .or_else(|| system32_join("OpenSSH\\ssh.exe"));
                }
            }
            resolve_exe_on_path("ssh.exe").or_else(|| system32_join("OpenSSH\\ssh.exe"))
        }
        _ => {
            let token = shell.map(str::trim).filter(|s| !s.is_empty());
            if let Some(token) = token {
                if let Some(wt) = wt_profile_icon_for_shell(token) {
                    return Some(wt);
                }
                let as_path = PathBuf::from(token);
                if as_path.is_file() {
                    return Some(as_path);
                }
                for s in crate::pty::detect_available_shells() {
                    if s.name.eq_ignore_ascii_case(token) {
                        let p = PathBuf::from(&s.path);
                        if p.is_file() {
                            return Some(p);
                        }
                    }
                }
                let exe = if token.to_ascii_lowercase().ends_with(".exe") {
                    token.to_string()
                } else {
                    format!("{token}.exe")
                };
                return resolve_exe_on_path(&exe);
            }
            // local-default with no shell token — use WT pwsh icon as a neutral default
            wt_profile_icon_for_shell("pwsh")
        }
    }
}

/// Distro-specific icon: Lxss BasePath\shortcut.ico (same source WT fragments use).
fn find_wsl_distro_icon(distro: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let lxss = hkcu
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Lxss")
            .ok()?;
        for key_name in lxss.enum_keys().filter_map(Result::ok) {
            let sub = match lxss.open_subkey(&key_name) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let name: String = match sub.get_value("DistributionName") {
                Ok(n) => n,
                Err(_) => continue,
            };
            if !name.eq_ignore_ascii_case(distro) {
                continue;
            }
            if let Ok(base) = sub.get_value::<String, _>("BasePath") {
                let base = base.trim_start_matches(r"\\?\");
                let ico = PathBuf::from(base).join("shortcut.ico");
                if ico.is_file() {
                    return Some(ico);
                }
            }
            if let Some(local) = dirs::data_local_dir() {
                let ico = local.join("wsl").join(&key_name).join("shortcut.ico");
                if ico.is_file() {
                    return Some(ico);
                }
            }
        }

        // WT JSON fragments often already point at the right icon path.
        if let Some(ico) = find_wsl_icon_in_wt_fragments(distro) {
            return Some(ico);
        }
    }
    let _ = distro;
    None
}

fn find_wsl_icon_in_wt_fragments(distro: &str) -> Option<PathBuf> {
    let local = dirs::data_local_dir()?;
    let roots = [
        local.join("Microsoft").join("Windows Terminal").join("Fragments"),
        local
            .join("Microsoft")
            .join("Windows Terminal Preview")
            .join("Fragments"),
    ];
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let Ok(walker) = fs::read_dir(&root) else {
            continue;
        };
        for entry in walker.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(inner) = fs::read_dir(&path) {
                    for f in inner.flatten() {
                        if f.path().extension().and_then(|e| e.to_str()) == Some("json") {
                            if let Some(ico) = parse_wt_fragment_icon(&f.path(), distro) {
                                return Some(ico);
                            }
                        }
                    }
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(ico) = parse_wt_fragment_icon(&path, distro) {
                    return Some(ico);
                }
            }
        }
    }
    None
}

fn parse_wt_fragment_icon(path: &Path, distro: &str) -> Option<PathBuf> {
    let text = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let profiles = v.get("profiles")?.as_array()?;
    for p in profiles {
        let name = p.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if !name.eq_ignore_ascii_case(distro) {
            continue;
        }
        let icon = p.get("icon").and_then(|i| i.as_str())?;
        let icon_path = PathBuf::from(icon.trim_start_matches(r"\\?\"));
        if icon_path.is_file() {
            return Some(icon_path);
        }
    }
    None
}

/// Locate WT's ProfileIcons folder.
///
/// `WindowsApps` is not listable without elevation, but individual package paths
/// from the AppModel registry *are* readable (same as Windows Terminal itself).
fn find_windows_terminal_profile_icons_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let packages = hkcu
            .open_subkey(
                r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages",
            )
            .ok()?;
        let mut candidates: Vec<PathBuf> = Vec::new();
        for key_name in packages.enum_keys().filter_map(Result::ok) {
            // Prefer stable Terminal over Preview.
            if !key_name.starts_with("Microsoft.WindowsTerminal_")
                || key_name.contains("Preview")
            {
                continue;
            }
            let sub = match packages.open_subkey(&key_name) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let root: String = match sub.get_value("PackageRootFolder") {
                Ok(r) => r,
                Err(_) => continue,
            };
            let pi = PathBuf::from(root).join("ProfileIcons");
            // is_dir may fail on the parent; probe a known file instead.
            if pi.join("pwsh.scale-100.png").is_file()
                || pi
                    .join("{574e775e-4f2a-5b96-ac1e-a2962a402336}.scale-100.png")
                    .is_file()
                || pi.is_dir()
            {
                candidates.push(pi);
            }
        }
        candidates.sort_by(|a, b| {
            a.to_string_lossy()
                .to_lowercase()
                .cmp(&b.to_string_lossy().to_lowercase())
        });
        if let Some(dir) = candidates.pop() {
            return Some(dir);
        }
    }

    // Fallback: try listing WindowsApps (usually Access Denied).
    let pf = std::env::var_os("ProgramFiles")?;
    let apps = PathBuf::from(pf).join("WindowsApps");
    let Ok(entries) = fs::read_dir(&apps) else {
        return None;
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let s = name.to_string_lossy();
        if s.starts_with("Microsoft.WindowsTerminal_") && !s.contains("Preview") {
            let pi = entry.path().join("ProfileIcons");
            if pi.is_dir() {
                candidates.push(pi);
            }
        }
    }
    candidates.sort();
    candidates.pop()
}

fn wt_profile_icon_by_guid(guid: &str) -> Option<PathBuf> {
    let dir = find_windows_terminal_profile_icons_dir()?;
    for scale in ["200", "150", "125", "100"] {
        let p = dir.join(format!("{{{guid}}}.scale-{scale}.png"));
        if p.is_file() {
            return Some(p);
        }
        let p = dir.join(format!("{guid}.scale-{scale}.png"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Map shell tokens to Windows Terminal's bundled ProfileIcons (same assets WT uses).
fn wt_profile_icon_for_shell(shell: &str) -> Option<PathBuf> {
    let dir = find_windows_terminal_profile_icons_dir()?;
    let lower = shell.to_ascii_lowercase();
    let named: &[&str] = match lower.as_str() {
        "pwsh" | "pwsh-preview" | "powershell-core" | "ps7" => &[
            "pwsh.scale-200.png",
            "pwsh.scale-100.png",
            "vs-pwsh.scale-200.png",
            "vs-pwsh.scale-100.png",
        ],
        "powershell" => &[
            "vs-powershell.scale-200.png",
            "vs-powershell.scale-100.png",
        ],
        "cmd" => &["vs-cmd.scale-200.png", "vs-cmd.scale-100.png"],
        _ => &[],
    };
    for name in named {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    // GUID fallbacks (WT dynamic profile icons).
    let guid = match lower.as_str() {
        "pwsh" | "pwsh-preview" | "powershell-core" | "ps7" => {
            Some("574e775e-4f2a-5b96-ac1e-a2962a402336")
        }
        "powershell" => Some("61c54bbd-c2c6-5271-96e7-009a87ff44bf"),
        "cmd" => Some("0caa0dad-35be-5f56-a8ff-afceeeaa6101"),
        "bash" | "git-bash" | "gitbash" | "zsh" => {
            Some("9acb9455-ca41-5af7-950f-6bca1bc9722f")
        }
        _ => None,
    }?;
    for scale in ["200", "150", "125", "100"] {
        let p = dir.join(format!("{{{guid}}}.scale-{scale}.png"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn system32_join(rel: &str) -> Option<PathBuf> {
    let root = std::env::var_os("SystemRoot")?;
    let p = PathBuf::from(root).join("System32").join(rel);
    p.is_file().then_some(p)
}

fn resolve_exe_on_path(name: &str) -> Option<PathBuf> {
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
