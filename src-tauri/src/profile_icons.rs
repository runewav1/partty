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

/// Return a `data:image/bmp;base64,…` URL for the icon associated with `source`.
/// Results are cached on disk under `~/.partty/cache/icons/`.
pub fn icon_data_url_for_path(source: &Path) -> Option<String> {
    if !source.is_file() {
        return None;
    }
    let cache = icons_cache_dir()?;
    fs::create_dir_all(&cache).ok()?;
    let key = cache_key_for_source(source);
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

        let size = 16i32;
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
pub fn resolve_icon_source(
    kind: &str,
    shell: Option<&str>,
    icon_override: Option<&str>,
    commandline: Option<&str>,
) -> Option<PathBuf> {
    if let Some(raw) = icon_override.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(raw);
        if p.is_file() {
            return Some(p);
        }
    }

    match kind {
        "wsl" => resolve_exe_on_path("wsl.exe").or_else(|| system32_join("wsl.exe")),
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
            let token = shell.map(str::trim).filter(|s| !s.is_empty())?;
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
            resolve_exe_on_path(&exe)
        }
    }
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
