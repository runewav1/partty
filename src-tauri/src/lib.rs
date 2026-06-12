mod fs_watcher;
mod fs_workspace;
mod palette_commands;
#[cfg(windows)]
mod peb_cwd_windows;
mod prefs;
mod pty;
mod subprocess;
mod win_console;

use parking_lot::Mutex;
use prefs::{load_state, save_state, PersistedState};
use pty::PtySession;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const DETACHED_PANE_WINDOW_PREFIX: &str = "detached-pane-";

#[derive(Debug, Clone)]
struct DetachedPaneState {
    pane_id: String,
    title: String,
    snapshot: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct DetachedPaneBootstrap {
    pane_id: String,
    title: String,
    snapshot: Option<String>,
}

pub struct AppState {
    pub pty_panes: Mutex<HashMap<String, Arc<PtySession>>>,
    pub persisted: Mutex<PersistedState>,
    last_window_save: Mutex<Option<Instant>>,
    /// Per-pane shell + cwd identity (for pref changes / respawn).
    pub pty_spawn_identity: Mutex<HashMap<String, String>>,
    /// Focus target for palette cwd + keyboard routing from frontend.
    pub focused_pane_id: Mutex<Option<String>>,
    /// Set before programmatic destroy on hide so `ExitRequested` keeps the app alive.
    pub webview_destroyed_for_hide: AtomicBool,
    /// After recreating the main webview, hold `partty-prepare-show` until JS calls `webview_boot_complete`.
    pub defer_prepare_show_until_webview_ready: AtomicBool,
    /// Incremented whenever a delayed destroy should be invalidated (e.g. window was shown again).
    pub hide_destroy_generation: AtomicU64,
    pub app_session_id: String,
    /// Filesystem watcher for file tree live-updating.
    pub fs_watcher: fs_watcher::WatcherHandle,
    /// Detached pane windows keyed by window label.
    detached_panes: Mutex<HashMap<String, DetachedPaneState>>,
}

fn make_app_session_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{:x}-{:x}", std::process::id(), now)
}

#[tauri::command]
fn get_app_session_id(state: State<'_, AppState>) -> String {
    state.app_session_id.clone()
}

impl AppState {
    fn snapshot_window(&self, window: &tauri::WebviewWindow) {
        let Ok(pos) = window.outer_position() else {
            return;
        };
        let Ok(sz) = window.outer_size() else {
            return;
        };
        let mut p = self.persisted.lock();
        p.window.x = pos.x;
        p.window.y = pos.y;
        p.window.width = sz.width;
        p.window.height = sz.height;
        p.window.maximized = window.is_maximized().unwrap_or(false);
    }
}

#[tauri::command]
fn read_dir_entries(path: String) -> Result<Vec<fs_workspace::FsEntry>, String> {
    fs_workspace::read_dir_entries_impl(path)
}

#[tauri::command]
fn read_dir_summary(path: String) -> Result<fs_workspace::FsDirSummary, String> {
    fs_workspace::read_dir_summary_impl(path)
}

#[tauri::command]
fn git_workdir_status(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<Vec<fs_workspace::GitPathStatus>, String> {
    let include = state.persisted.lock().prefs.file_tree_show_diff_counts;
    fs_workspace::git_workdir_status_impl(cwd, include)
}

#[tauri::command]
fn git_repo_info(cwd: String) -> Result<Option<fs_workspace::GitRepoInfo>, String> {
    fs_workspace::git_repo_info_impl(cwd)
}

#[tauri::command]
fn fs_parent_dir(path: String) -> Result<Option<String>, String> {
    fs_workspace::fs_parent_dir(path)
}

#[tauri::command]
fn fs_rename(from: String, to: String) -> Result<(), String> {
    fs_workspace::fs_rename(from, to)
}

#[tauri::command]
fn fs_move_path(from: String, to: String) -> Result<(), String> {
    fs_workspace::fs_move(from, to)
}

#[tauri::command]
fn fs_remove(path: String, recursive: bool) -> Result<(), String> {
    fs_workspace::fs_remove(path, recursive)
}

#[tauri::command]
fn fs_create_file(path: String) -> Result<(), String> {
    fs_workspace::fs_create_file(path)
}

#[tauri::command]
fn fs_create_dir(path: String) -> Result<(), String> {
    fs_workspace::fs_create_dir(path)
}

#[tauri::command]
fn search_file_contents(
    root: String,
    query: String,
) -> Result<Vec<fs_workspace::SearchResult>, String> {
    fs_workspace::search_file_contents(root, query)
}

#[tauri::command]
fn search_files_root(
    root: String,
    query: String,
    mode: String,
    git_aware: bool,
) -> Result<Vec<fs_workspace::SearchResult>, String> {
    fs_workspace::search_files_root(root, query, mode, git_aware)
}

#[tauri::command]
fn detect_shells() -> Vec<pty::DetectedShell> {
    pty::detect_available_shells()
}

#[tauri::command]
fn fs_watch(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    fs_watcher::start_watching(&state.fs_watcher, app, path)
}

#[tauri::command]
fn fs_unwatch(state: State<'_, AppState>) -> Result<(), String> {
    fs_watcher::stop_watching(&state.fs_watcher);
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("only http/https links are allowed".to_string());
    }
    opener::open(trimmed).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_in_editor(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        use windows_sys::Win32::UI::Shell::{
            ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
        };

        let wide_path: Vec<u16> = OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

        let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        sei.hwnd = ptr::null_mut();
        sei.lpVerb = wide_verb.as_ptr();
        sei.lpFile = wide_path.as_ptr();
        sei.nShow = 1; // SW_SHOWNORMAL

        unsafe {
            if ShellExecuteExW(&mut sei) == 0 {
                return Err(format!("failed to open file with ShellExecuteExW"));
            }
        }
    }
    #[cfg(not(windows))]
    {
        opener::open(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show a file in Explorer / Finder, or open a folder.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    // For files, open the parent folder instead of trying to select the file
    let target = if p.is_file() {
        p.parent().unwrap_or(&p)
    } else {
        &p
    };
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        use windows_sys::Win32::UI::Shell::{
            ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
        };
        let wide_path: Vec<u16> = OsStr::new(target)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

        let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        sei.hwnd = ptr::null_mut();
        sei.lpVerb = wide_verb.as_ptr();
        sei.lpFile = wide_path.as_ptr();
        sei.nShow = 1; // SW_SHOWNORMAL

        unsafe {
            if ShellExecuteExW(&mut sei) == 0 {
                // Fallback to explorer.exe
                StdCommand::new("explorer.exe")
                    .arg(target)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        StdCommand::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a new OS terminal window at `cwd` (Windows Terminal if available).
#[tauri::command]
fn open_external_terminal(cwd: String, terminal: Option<String>) -> Result<(), String> {
    let cdir = PathBuf::from(&cwd);
    if !cdir.is_dir() {
        return Err(format!("not a directory: {}", cwd));
    }
    #[cfg(windows)]
    {
        let requested = terminal.unwrap_or_else(|| "wt".to_string()).to_lowercase();

        // Check if it's a full path or a simple token
        let is_full_path = requested.contains('\\') || requested.contains('/');

        if is_full_path {
            // Full path - use ShellExecuteExW to open the terminal
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            use std::ptr;
            use windows_sys::Win32::UI::Shell::{
                ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
            };

            let wide_terminal: Vec<u16> = OsStr::new(&requested)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let wide_cwd: Vec<u16> = OsStr::new(&cwd)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let wide_verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

            let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
            sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
            sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
            sei.hwnd = ptr::null_mut();
            sei.lpVerb = wide_verb.as_ptr();
            sei.lpFile = wide_terminal.as_ptr();
            sei.lpParameters = wide_cwd.as_ptr();
            sei.lpDirectory = ptr::null();
            sei.nShow = 1;

            unsafe {
                if ShellExecuteExW(&mut sei) == 0 {
                    // Fallback to StdCommand
                    StdCommand::new(&requested)
                        .arg(&cwd)
                        .spawn()
                        .map_err(|e| format!("Failed to open terminal: {}", e))?;
                }
            }
        } else {
            // Simple token - use the original logic
            let launched = match requested.as_str() {
                "wt" | "windows terminal" => {
                    StdCommand::new("wt").args(["-d", &cwd]).spawn().is_ok()
                }
                "powershell" | "pwsh" => StdCommand::new("powershell")
                    .args([
                        "-NoExit",
                        "-Command",
                        &format!("Set-Location -LiteralPath '{}'", cwd.replace('\'', "''")),
                    ])
                    .spawn()
                    .is_ok(),
                "cmd" | "command prompt" => StdCommand::new("cmd")
                    .args(["/c", "start", "cmd", "/k", "cd", "/d", &cwd])
                    .spawn()
                    .is_ok(),
                "bash" | "git bash" | "git-bash" => StdCommand::new("cmd")
                    .args([
                        "/c",
                        "start",
                        "bash",
                        "-lc",
                        &format!("cd '{}' ; exec bash", cwd.replace('\'', "''")),
                    ])
                    .spawn()
                    .is_ok(),
                other => StdCommand::new(other).arg(&cwd).spawn().is_ok(),
            };

            if !launched {
                // Fallback to cmd.exe for reliability.
                StdCommand::new("cmd")
                    .args(["/c", "start", "cmd", "/k", "cd", "/d", &cwd])
                    .spawn()
                    .map_err(|e| format!("Failed to open terminal: {}", e))?;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .args(["-a", "Terminal", &cwd])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        StdCommand::new("xdg-terminal")
            .arg("--working-directory")
            .arg(&cwd)
            .spawn()
            .or_else(|_| {
                StdCommand::new("gnome-terminal")
                    .arg("--working-directory")
                    .arg(&cwd)
                    .spawn()
            })
            .or_else(|_| StdCommand::new("x-terminal-emulator").arg(&cwd).spawn())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_with_editor(path: String, editor: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    // Use the editor command directly (already resolved by detection)
    let bin = editor.as_str();
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        use windows_sys::Win32::UI::Shell::{
            ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
        };

        let wide_editor: Vec<u16> = OsStr::new(bin)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_path: Vec<u16> = OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

        let mut sei: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        sei.hwnd = ptr::null_mut();
        sei.lpVerb = wide_verb.as_ptr();
        sei.lpFile = wide_editor.as_ptr();
        sei.lpParameters = wide_path.as_ptr();
        sei.nShow = 1; // SW_SHOWNORMAL

        unsafe {
            if ShellExecuteExW(&mut sei) == 0 {
                // Fallback to StdCommand if ShellExecuteExW fails
                let mut c = StdCommand::new(bin);
                c.arg(&path);
                c.spawn().map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(not(windows))]
    {
        StdCommand::new(bin)
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Extract icon from an executable using Windows SHGetFileInfo API.
/// Returns base64-encoded PNG icon data with MIME type.
#[cfg(windows)]
fn extract_exe_icon(exe_path: &str) -> Option<(String, String)> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, RGBQUAD,
    };
    use windows_sys::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    let wide_path: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut shfi = SHFILEINFOW {
        hIcon: ptr::null_mut(),
        iIcon: 0,
        szDisplayName: [0; 260],
        szTypeName: [0; 80],
        dwAttributes: 0,
    };

    // SHGFI_USEFILEATTRIBUTES allows getting icon without the file existing
    let flags = SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES;

    let result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut shfi,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        )
    };

    if result == 0 || shfi.hIcon.is_null() {
        return None;
    }

    // Convert HICON to PNG bytes
    let png_bytes = unsafe {
        let hicon = shfi.hIcon;

        // Get icon bitmap info
        // Get icon size (assume 32x32 for large icon)

        // Extract raw BGRA from icon
        let mut icon_info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(hicon, &mut icon_info) == 0 {
            DestroyIcon(hicon);
            return None;
        }

        let hbm_color = icon_info.hbmColor;
        let hbm_mask = icon_info.hbmMask;

        if hbm_color.is_null() {
            if !hbm_mask.is_null() {
                DeleteObject(hbm_mask);
            }
            DestroyIcon(hicon);
            return None;
        }

        // Get bitmap dimensions
        let mut bm = BITMAP {
            bmType: 0,
            bmWidth: 0,
            bmHeight: 0,
            bmWidthBytes: 0,
            bmPlanes: 0,
            bmBitsPixel: 0,
            bmBits: ptr::null_mut(),
        };
        GetObjectW(
            hbm_color,
            std::mem::size_of::<BITMAP>() as i32,
            &mut bm as *mut _ as *mut _,
        );

        let bmp_width = bm.bmWidth as u32;
        let bmp_height = bm.bmHeight as u32;

        if bmp_width == 0 || bmp_height == 0 {
            DeleteObject(hbm_color);
            if !hbm_mask.is_null() {
                DeleteObject(hbm_mask);
            }
            DestroyIcon(hicon);
            return None;
        }

        // Read color bitmap
        let mut color_data: Vec<u8> = vec![0; (bmp_width * bmp_height * 4) as usize];
        let mut bmi_color = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: bmp_width as i32,
                biHeight: -(bmp_height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }; 1],
        };

        let hdc = CreateCompatibleDC(ptr::null_mut());
        GetDIBits(
            hdc,
            hbm_color,
            0,
            bmp_height,
            color_data.as_mut_ptr() as *mut _,
            &mut bmi_color,
            DIB_RGB_COLORS,
        );

        // Read mask bitmap for alpha
        let mut mask_data: Vec<u8> = vec![0; ((bmp_width + 7) / 8 * bmp_height) as usize];
        if !hbm_mask.is_null() {
            let mut bmi_mask = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: bmp_width as i32,
                    biHeight: -(bmp_height as i32),
                    biPlanes: 1,
                    biBitCount: 1,
                    biCompression: BI_RGB,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD {
                    rgbBlue: 0,
                    rgbGreen: 0,
                    rgbRed: 0,
                    rgbReserved: 0,
                }; 1],
            };
            GetDIBits(
                hdc,
                hbm_mask,
                0,
                bmp_height,
                mask_data.as_mut_ptr() as *mut _,
                &mut bmi_mask,
                DIB_RGB_COLORS,
            );
        }

        DeleteDC(hdc);
        DeleteObject(hbm_color);
        if !hbm_mask.is_null() {
            DeleteObject(hbm_mask);
        }
        DestroyIcon(hicon);

        // Apply mask as alpha channel
        for y in 0..bmp_height as usize {
            for x in 0..bmp_width as usize {
                let pixel_idx = (y * bmp_width as usize + x) * 4;
                let mask_byte_idx = y * ((bmp_width as usize + 7) / 8) + x / 8;
                let mask_bit = 7 - (x % 8);
                let is_transparent = if mask_byte_idx < mask_data.len() {
                    (mask_data[mask_byte_idx] >> mask_bit) & 1 == 1
                } else {
                    false
                };

                // BGRA to RGBA and apply alpha
                let b = color_data[pixel_idx];
                let g = color_data[pixel_idx + 1];
                let r = color_data[pixel_idx + 2];
                let a = color_data[pixel_idx + 3];

                // If alpha is 0 but mask shows opaque, use full alpha
                let final_alpha = if a == 0 && !is_transparent { 255u8 } else { a };

                color_data[pixel_idx] = r;
                color_data[pixel_idx + 1] = g;
                color_data[pixel_idx + 2] = b;
                color_data[pixel_idx + 3] = final_alpha;
            }
        }

        // Encode as PNG
        let png_data = encode_png(&color_data, bmp_width, bmp_height);

        png_data
    };

    if let Some(bytes) = png_bytes {
        Some((STANDARD.encode(&bytes), "image/png".to_string()))
    } else {
        None
    }
}

/// Simple PNG encoder for RGBA data
#[cfg(windows)]
fn encode_png(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let mut png_data = Vec::new();

    // PNG signature
    png_data.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // IHDR chunk
    let ihdr_data: Vec<u8> = [
        &width.to_be_bytes()[..],
        &height.to_be_bytes()[..],
        &[8], // bit depth
        &[6], // color type: RGBA
        &[0], // compression
        &[0], // filter
        &[0], // interlace
    ]
    .concat();

    write_png_chunk(&mut png_data, b"IHDR", &ihdr_data);

    // IDAT chunk - raw data with filter bytes
    let mut raw_data = Vec::with_capacity(data.len() + height as usize);
    for row in 0..height as usize {
        raw_data.push(0); // filter type: None
        let row_start = row * width as usize * 4;
        raw_data.extend_from_slice(&data[row_start..row_start + width as usize * 4]);
    }

    // Compress with deflate
    let compressed = miniz_oxide::deflate::compress_to_vec(&raw_data, 6);
    write_png_chunk(&mut png_data, b"IDAT", &compressed);

    // IEND chunk
    write_png_chunk(&mut png_data, b"IEND", &[]);

    Some(png_data)
}

#[cfg(windows)]
fn write_png_chunk(output: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    // Length (4 bytes, big-endian)
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());

    // Chunk type (4 bytes)
    output.extend_from_slice(chunk_type);

    // Chunk data
    output.extend_from_slice(data);

    // CRC32 (chunk type + data)
    let crc = crc32fast::hash(&[chunk_type, data].concat());
    output.extend_from_slice(&crc.to_be_bytes());
}

/// Detect installed editors and terminals on the system.
/// Returns a list of available editors and terminals with their display names and command names.
#[tauri::command]
fn detect_installed_apps() -> Result<Vec<DetectedApp>, String> {
    let mut apps = Vec::new();

    #[cfg(windows)]
    {
        let where_first = |cmd: &str| -> Option<String> {
            StdCommand::new("where.exe")
                .arg(cmd)
                .output()
                .ok()
                .and_then(|output| {
                    if output.status.success() {
                        String::from_utf8(output.stdout).ok().and_then(|s| {
                            s.lines()
                                .map(|line| line.trim().to_string())
                                .find(|line| !line.is_empty())
                        })
                    } else {
                        None
                    }
                })
        };

        let resolve_executable =
            |candidates: &[&str], fallback_paths: &[PathBuf]| -> Option<String> {
                for cand in candidates {
                    if let Some(path) = where_first(cand) {
                        return Some(path);
                    }
                }
                for path in fallback_paths {
                    if path.exists() {
                        return Some(path.to_string_lossy().to_string());
                    }
                }
                None
            };

        let local_app_data = std::env::var("LOCALAPPDATA").ok();
        let program_files = std::env::var("ProgramFiles").ok();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").ok();

        let mut seen = std::collections::HashSet::<String>::new();
        let mut push_app =
            |name: &str, command: String, app_type: &str, icon_from: Option<String>| {
                let key = format!("{}:{}", app_type, command.to_lowercase());
                if seen.contains(&key) {
                    return;
                }
                seen.insert(key);
                // Try icon extraction but don't fail if it fails
                let (icon_data, icon_mime) = match icon_from.as_deref().and_then(extract_exe_icon) {
                    Some((data, mime)) => (Some(data), Some(mime)),
                    None => (None, None),
                };
                apps.push(DetectedApp {
                    name: name.to_string(),
                    command,
                    app_type: app_type.to_string(),
                    icon_data,
                    icon_mime,
                });
            };

        let mut fallback = Vec::<PathBuf>::new();
        if let Some(base) = &local_app_data {
            fallback.push(PathBuf::from(base).join("Programs\\Microsoft VS Code\\Code.exe"));
            fallback.push(
                PathBuf::from(base)
                    .join("Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe"),
            );
            fallback.push(PathBuf::from(base).join("Programs\\Cursor\\Cursor.exe"));
            fallback.push(PathBuf::from(base).join("Programs\\Windsurf\\Windsurf.exe"));
            fallback.push(PathBuf::from(base).join("Programs\\Zed\\Zed.exe"));
        }
        if let Some(base) = &program_files {
            fallback.push(PathBuf::from(base).join("Microsoft VS Code\\Code.exe"));
            fallback
                .push(PathBuf::from(base).join("Microsoft VS Code Insiders\\Code - Insiders.exe"));
            fallback.push(PathBuf::from(base).join("Notepad++\\notepad++.exe"));
            fallback.push(PathBuf::from(base).join("Sublime Text\\sublime_text.exe"));
            fallback.push(PathBuf::from(base).join("WindowsApps\\wt.exe"));
        }
        if let Some(base) = &program_files_x86 {
            fallback.push(PathBuf::from(base).join("Notepad++\\notepad++.exe"));
            fallback.push(PathBuf::from(base).join("Sublime Text\\sublime_text.exe"));
            fallback.push(PathBuf::from(base).join("WindowsApps\\wt.exe"));
        }

        let editor_defs: [(&str, &[&str]); 8] = [
            ("Visual Studio Code", &["code.exe", "code"]),
            ("VS Code Insiders", &["code-insiders.exe", "code-insiders"]),
            ("Cursor", &["cursor.exe", "cursor"]),
            ("Windsurf", &["windsurf.exe", "windsurf"]),
            ("Zed", &["zed.exe", "zed"]),
            ("Notepad++", &["notepad++.exe", "notepad++"]),
            ("Sublime Text", &["sublime_text.exe", "sublime_text"]),
            ("Vim", &["gvim.exe", "gvim"]),
        ];

        for (name, cmds) in editor_defs {
            let match_fallbacks: Vec<PathBuf> = fallback
                .iter()
                .filter(|p| {
                    let fname = p
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    cmds.iter().any(|c| fname == c.to_lowercase())
                })
                .cloned()
                .collect();
            if let Some(path) = resolve_executable(cmds, &match_fallbacks) {
                push_app(name, path.clone(), "editor", Some(path));
            }
        }

        let wt_path = resolve_executable(
            &["wt.exe", "wt"],
            &fallback
                .iter()
                .filter(|p| {
                    p.file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| n.eq_ignore_ascii_case("wt.exe"))
                        .unwrap_or(false)
                })
                .cloned()
                .collect::<Vec<_>>(),
        );
        if wt_path.is_some() {
            push_app("Windows Terminal", "wt".to_string(), "terminal", wt_path);
        }

        let pwsh_path = resolve_executable(&["pwsh.exe", "pwsh"], &[]);
        if pwsh_path.is_some() {
            push_app("PowerShell 7", "pwsh".to_string(), "terminal", pwsh_path);
        } else {
            let powershell_path = resolve_executable(&["powershell.exe", "powershell"], &[]);
            if powershell_path.is_some() {
                push_app(
                    "PowerShell",
                    "powershell".to_string(),
                    "terminal",
                    powershell_path,
                );
            }
        }

        let cmd_path = resolve_executable(&["cmd.exe", "cmd"], &[]).or_else(|| {
            std::env::var("WINDIR").ok().map(|w| {
                PathBuf::from(w)
                    .join("System32\\cmd.exe")
                    .to_string_lossy()
                    .to_string()
            })
        });
        push_app("Command Prompt", "cmd".to_string(), "terminal", cmd_path);

        let mut git_bash_fallbacks = Vec::<PathBuf>::new();
        if let Some(base) = &program_files {
            git_bash_fallbacks.push(PathBuf::from(base).join("Git\\bin\\bash.exe"));
            git_bash_fallbacks.push(PathBuf::from(base).join("Git\\git-bash.exe"));
        }
        if let Some(base) = &program_files_x86 {
            git_bash_fallbacks.push(PathBuf::from(base).join("Git\\bin\\bash.exe"));
            git_bash_fallbacks.push(PathBuf::from(base).join("Git\\git-bash.exe"));
        }
        let git_bash_path = resolve_executable(&["bash.exe", "bash"], &git_bash_fallbacks);
        if git_bash_path.is_some() {
            push_app(
                "Git Bash",
                "git-bash".to_string(),
                "terminal",
                git_bash_path,
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS detection using which command
        let mac_editors = vec![
            ("Visual Studio Code", "code"),
            ("Cursor", "cursor"),
            ("Zed", "zed"),
            ("Sublime Text", "subl"),
            ("Vim", "vim"),
            ("Neovim", "nvim"),
        ];

        for (display_name, command) in mac_editors {
            if let Ok(output) = StdCommand::new("which").arg(command).output() {
                if output.status.success() {
                    apps.push(DetectedApp {
                        name: display_name.to_string(),
                        command: command.to_string(),
                        app_type: "editor".to_string(),
                        icon_data: None,
                        icon_mime: None,
                    });
                }
            }
        }

        // macOS terminals
        if let Ok(_) = StdCommand::new("which").arg("Terminal").output() {
            apps.push(DetectedApp {
                name: "Terminal".to_string(),
                command: "Terminal".to_string(),
                app_type: "terminal".to_string(),
                icon_data: None,
                icon_mime: None,
            });
        }

        if let Ok(_) = StdCommand::new("which").arg("iTerm").output() {
            apps.push(DetectedApp {
                name: "iTerm2".to_string(),
                command: "iTerm".to_string(),
                app_type: "terminal".to_string(),
                icon_data: None,
                icon_mime: None,
            });
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux detection using which command
        let linux_editors = vec![
            ("Visual Studio Code", "code"),
            ("Cursor", "cursor"),
            ("Zed", "zed"),
            ("Sublime Text", "subl"),
            ("Vim", "vim"),
            ("Neovim", "nvim"),
            ("Nano", "nano"),
            ("Gedit", "gedit"),
            ("Kate", "kate"),
        ];

        for (display_name, command) in linux_editors {
            if let Ok(output) = StdCommand::new("which").arg(command).output() {
                if output.status.success() {
                    apps.push(DetectedApp {
                        name: display_name.to_string(),
                        command: command.to_string(),
                        app_type: "editor".to_string(),
                        icon_data: None,
                        icon_mime: None,
                    });
                }
            }
        }

        // Linux terminals
        let linux_terminals = vec![
            ("GNOME Terminal", "gnome-terminal"),
            ("Konsole", "konsole"),
            ("xfce4-terminal", "xfce4-terminal"),
            ("Alacritty", "alacritty"),
            ("Kitty", "kitty"),
            ("Terminator", "terminator"),
        ];

        for (display_name, command) in linux_terminals {
            if let Ok(output) = StdCommand::new("which").arg(command).output() {
                if output.status.success() {
                    apps.push(DetectedApp {
                        name: display_name.to_string(),
                        command: command.to_string(),
                        app_type: "terminal".to_string(),
                        icon_data: None,
                        icon_mime: None,
                    });
                }
            }
        }
    }

    Ok(apps)
}

#[derive(serde::Serialize)]
struct DetectedApp {
    name: String,
    command: String,
    app_type: String,
    icon_data: Option<String>, // Base64 encoded icon data
    icon_mime: Option<String>,
}

/// Run a file with the OS shell / file association (exe, bat, cmd, vbs, etc.).
#[tauri::command]
fn run_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }
    #[cfg(windows)]
    {
        opener::open(&p).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        StdCommand::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn pty_identity(prefs: &prefs::Prefs, pane_cwd: Option<&str>) -> String {
    format!(
        "{}\0{}",
        prefs.shell.trim().to_lowercase(),
        pane_cwd.unwrap_or(prefs.initial_cwd.as_deref().unwrap_or(""))
    )
}

fn window_effect_config(prefs: &prefs::Prefs) -> Option<tauri::utils::config::WindowEffectsConfig> {
    match prefs.window_effect_mode.trim().to_ascii_lowercase().as_str() {
        "transparent" => None,
        _ => None,
    }
}

fn apply_window_effects(win: &tauri::WebviewWindow, prefs: &prefs::Prefs) {
    if let Err(e) = win.set_effects(window_effect_config(prefs)) {
        eprintln!("partty: set window effects for {}: {e}", win.label());
    }
}

fn apply_window_effects_to_all(app: &AppHandle, prefs: &prefs::Prefs) {
    for win in app.webview_windows().values() {
        apply_window_effects(win, prefs);
    }
}

fn detached_window_label_for_pane(pane_id: &str) -> String {
    let safe: String = pane_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    format!("{DETACHED_PANE_WINDOW_PREFIX}{safe}")
}

fn kill_pane_session(state: &AppState, pane_id: &str) {
    if let Some(s) = state.pty_panes.lock().remove(pane_id) {
        s.kill();
    }
    state.pty_spawn_identity.lock().remove(pane_id);
    let next = state.pty_panes.lock().keys().next().cloned();
    let mut f = state.focused_pane_id.lock();
    if f.as_deref() == Some(pane_id) {
        *f = next;
    }
}

fn clear_pty_session(state: &AppState) {
    let detached_ids: HashSet<String> = state
        .detached_panes
        .lock()
        .values()
        .map(|x| x.pane_id.clone())
        .collect();
    let mut panes = state.pty_panes.lock();
    let mut keep: Vec<(String, Arc<PtySession>)> = Vec::new();
    for pane_id in &detached_ids {
        if let Some(s) = panes.remove(pane_id) {
            keep.push((pane_id.clone(), s));
        }
    }
    for (_, s) in panes.drain() {
        s.kill();
    }
    for (pane_id, session) in keep {
        panes.insert(pane_id, session);
    }
    state
        .pty_spawn_identity
        .lock()
        .retain(|k, _| detached_ids.contains(k));
    let mut f = state.focused_pane_id.lock();
    if f.as_ref().is_some_and(|x| detached_ids.contains(x)) {
        // keep detached pane focus target
    } else {
        *f = None;
    }
}

#[cfg(windows)]
fn cursor_physical_position() -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut pt) == 0 {
            return (200, 200);
        }
    }
    (pt.x, pt.y)
}

#[cfg(not(windows))]
fn cursor_physical_position() -> (i32, i32) {
    (200, 200)
}

fn position_window_near_cursor(win: &tauri::WebviewWindow, width: u32, height: u32) {
    let (cx, cy) = cursor_physical_position();
    let w = width as i32;
    let h = height as i32;
    let x = cx.saturating_sub(w / 2);
    let y = cy.saturating_sub(h / 2);
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

fn position_main_at_cursor_if_prefs(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // Use disk prefs: this runs from the single-instance callback before `AppState` may exist.
    let st = load_state();
    let at_cursor = st.prefs.summon_spawn_at_cursor;
    if !at_cursor {
        return;
    }
    if let Ok(sz) = win.outer_size() {
        position_window_near_cursor(&win, sz.width, sz.height);
    }
}

fn register_detached_pane_window_events(handle: &AppHandle, win: &tauri::WebviewWindow) {
    let app = handle.clone();
    let label = win.label().to_string();
    win.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { .. } = e {
            let state = app.state::<AppState>();
            let _ = close_detached_pane_inner(&app, &state, &label, false);
        }
    });
}

fn close_detached_pane_inner(
    app: &AppHandle,
    state: &AppState,
    window_label: &str,
    destroy_window: bool,
) -> Result<(), String> {
    let pane = state.detached_panes.lock().remove(window_label);
    let Some(detached) = pane else {
        if destroy_window {
            if let Some(win) = app.get_webview_window(window_label) {
                let _ = win.destroy();
            }
        }
        return Ok(());
    };
    kill_pane_session(state, &detached.pane_id);
    if destroy_window {
        if let Some(win) = app.get_webview_window(window_label) {
            let _ = win.destroy();
        }
    }
    Ok(())
}

#[tauri::command]
fn pop_out_pane(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    title: String,
    snapshot: Option<String>,
) -> Result<String, String> {
    let label = detached_window_label_for_pane(&pane_id);
    {
        let panes = state.detached_panes.lock();
        if panes.contains_key(&label) {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.show();
                let _ = win.set_focus();
            }
            return Ok(label);
        }
    }
    let prefs = state.persisted.lock().prefs.clone();
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        label.as_str(),
        tauri::WebviewUrl::App("detached-pane.html".into()),
    )
    .title(title.as_str())
    .inner_size(760.0, 460.0)
    .min_inner_size(380.0, 220.0)
    .resizable(true)
    .decorations(false)
    .shadow(true)
    .skip_taskbar(false)
    .visible(true);
    let win = builder.build().map_err(|e| e.to_string())?;
    apply_window_effects(&win, &prefs);
    if let Ok(sz) = win.outer_size() {
        position_window_near_cursor(&win, sz.width, sz.height);
    }
    register_detached_pane_window_events(&app, &win);
    state.detached_panes.lock().insert(
        label.clone(),
        DetachedPaneState {
            pane_id,
            title,
            snapshot,
        },
    );
    Ok(label)
}

#[tauri::command]
fn get_detached_pane_bootstrap(
    state: State<'_, AppState>,
    window_label: String,
) -> Result<DetachedPaneBootstrap, String> {
    let panes = state.detached_panes.lock();
    let Some(detached) = panes.get(&window_label) else {
        return Err("detached pane window missing".into());
    };
    Ok(DetachedPaneBootstrap {
        pane_id: detached.pane_id.clone(),
        title: detached.title.clone(),
        snapshot: detached.snapshot.clone(),
    })
}

#[tauri::command]
fn close_detached_pane(
    app: AppHandle,
    state: State<'_, AppState>,
    window_label: String,
) -> Result<(), String> {
    close_detached_pane_inner(&app, &state, &window_label, true)
}

/// Let the `partty-hide` handler finish WebGL/buffer work on the JS thread, then destroy the
/// webview from Rust. Avoids `invoke(request_destroy_webview)` from JS, which can tear down the
/// webview while the IPC promise is still pending (white window, broken show).
fn schedule_destroy_webview_after_hide(app: &AppHandle) {
    let destroy = app
        .state::<AppState>()
        .persisted
        .lock()
        .prefs
        .destroy_webview_on_hide;
    if !destroy {
        return;
    }
    let generation = app
        .state::<AppState>()
        .hide_destroy_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(160));
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            if app2
                .state::<AppState>()
                .hide_destroy_generation
                .load(Ordering::SeqCst)
                != generation
            {
                return;
            }
            app2.state::<AppState>()
                .webview_destroyed_for_hide
                .store(true, Ordering::SeqCst);
            match app2.get_webview_window("main") {
                Some(w) => {
                    let _ = w.destroy();
                }
                None => {}
            }
        });
    });
}

fn register_main_window_events(handle: &AppHandle, win: &tauri::WebviewWindow) {
    let save_handle = handle.clone();
    win.on_window_event(move |ev| {
        let Some(w) = save_handle.get_webview_window("main") else {
            return;
        };
        let state = save_handle.state::<AppState>();
        match ev {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                let mut last = state.last_window_save.lock();
                let now = Instant::now();
                let do_save = match *last {
                    None => true,
                    Some(t) => now.duration_since(t).as_millis() > 250,
                };
                if do_save {
                    state.snapshot_window(&w);
                    *last = Some(now);
                }
            }
            WindowEvent::CloseRequested { .. } => {
                state.snapshot_window(&w);
                save_state(&state.persisted.lock());
            }
            _ => {}
        }
    });
}

async fn recreate_main_window(app: &AppHandle) -> Result<(), String> {
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label.as_str() == "main")
        .cloned()
        .ok_or_else(|| "tauri.conf.json: missing window with label \"main\"".to_string())?;

    let st = app.state::<AppState>().persisted.lock().clone();
    let builder = tauri::WebviewWindowBuilder::from_config(app, &cfg)
        .map_err(|e| e.to_string())?
        .visible(false);
    let win = builder.build().map_err(|e| e.to_string())?;

    apply_window_effects(&win, &st.prefs);
    let _ = win.set_position(tauri::PhysicalPosition::new(st.window.x, st.window.y));
    let _ = win.set_size(tauri::PhysicalSize::new(st.window.width, st.window.height));
    if st.prefs.always_summon_maximized {
        let _ = win.maximize();
    } else if st.window.maximized {
        let _ = win.maximize();
    }
    let _ = win.set_skip_taskbar(st.prefs.hidden_from_taskbar);
    if st.prefs.always_on_top {
        let _ = win.set_always_on_top(true);
    }

    register_main_window_events(app, &win);
    Ok(())
}

fn spawn_show_main_window(app: AppHandle) {
    let defer_prep = load_state().prefs.defer_window_show_until_prepared;
    tauri::async_runtime::spawn(async move {
        // Single-instance / early paths can call this before `AppState` is managed; bail safely.
        if app.try_state::<AppState>().is_none() {
            return;
        }
        app.state::<AppState>()
            .hide_destroy_generation
            .fetch_add(1, Ordering::SeqCst);
        // Set before `recreate_main_window` so the first navigation cannot load JS before the flag exists
        // (otherwise `webview_boot_complete` may no-op and `partty-prepare-show` is never emitted).
        if defer_prep {
            app.state::<AppState>()
                .defer_prepare_show_until_webview_ready
                .store(true, Ordering::SeqCst);
        }
        if let Err(e) = recreate_main_window(&app).await {
            eprintln!("partty: recreate main window: {e}");
            if defer_prep {
                app.state::<AppState>()
                    .defer_prepare_show_until_webview_ready
                    .store(false, Ordering::SeqCst);
            }
            return;
        }
        let Some(w) = app.get_webview_window("main") else {
            if defer_prep {
                app.state::<AppState>()
                    .defer_prepare_show_until_webview_ready
                    .store(false, Ordering::SeqCst);
            }
            return;
        };
        if defer_prep {
            // `partty-prepare-show` is emitted from `webview_boot_complete` once listeners exist.
        } else {
            position_main_at_cursor_if_prefs(&app);
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("partty-show", ());
        }
    });
}

fn toggle_window(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(win) = app.get_webview_window("main") else {
        spawn_show_main_window(app.clone());
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        let shed = state.persisted.lock().prefs.shed_on_hide;
        if shed {
            clear_pty_session(&state);
            let _ = win.emit("pty-session-shed", ());
        }
        save_state(&state.persisted.lock());
        let _ = win.emit("partty-hide", ());
        let _ = win.hide();
        schedule_destroy_webview_after_hide(app);
    } else {
        state.hide_destroy_generation.fetch_add(1, Ordering::SeqCst);
        let (defer, summon) = {
            let p = state.persisted.lock();
            (
                p.prefs.defer_window_show_until_prepared,
                p.prefs.always_summon_maximized,
            )
        };
        if defer {
            state
                .defer_prepare_show_until_webview_ready
                .store(true, Ordering::SeqCst);
            let _ = win.emit("partty-prepare-show", ());
        } else {
            if !summon {
                position_main_at_cursor_if_prefs(app);
            }
            let _ = win.show();
            if summon {
                let _ = win.maximize();
            }
            let _ = win.set_focus();
            let _ = win.emit("partty-show", ());
        }
    }
}

/// Call from the frontend after `partty-prepare-show` listeners are registered (e.g. end of `boot()`).
/// If the main window was just recreated with deferred show, emits `partty-prepare-show` once.
#[tauri::command]
fn webview_boot_complete(app: AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    if !st
        .defer_prepare_show_until_webview_ready
        .swap(false, Ordering::SeqCst)
    {
        return Ok(());
    }
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    let _ = w.emit("partty-prepare-show", ());
    Ok(())
}

#[tauri::command]
fn commit_show_window(app: AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window("main") else {
        return Err("main window missing".into());
    };
    let summon = app
        .state::<AppState>()
        .persisted
        .lock()
        .prefs
        .always_summon_maximized;
    app.state::<AppState>()
        .hide_destroy_generation
        .fetch_add(1, Ordering::SeqCst);
    app.state::<AppState>()
        .defer_prepare_show_until_webview_ready
        .store(false, Ordering::SeqCst);
    if !summon {
        position_main_at_cursor_if_prefs(&app);
    }
    let _ = win.show();
    if summon {
        let _ = win.maximize();
    }
    let _ = win.set_focus();
    let _ = win.emit("partty-show", ());
    Ok(())
}

#[tauri::command]
async fn request_destroy_webview_for_hide(app: AppHandle) -> Result<(), String> {
    let destroy = app
        .state::<AppState>()
        .persisted
        .lock()
        .prefs
        .destroy_webview_on_hide;
    if !destroy {
        return Ok(());
    }
    app.state::<AppState>()
        .hide_destroy_generation
        .fetch_add(1, Ordering::SeqCst);
    app.state::<AppState>()
        .webview_destroyed_for_hide
        .store(true, Ordering::SeqCst);
    match app.get_webview_window("main") {
        Some(w) => w.destroy().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
fn pty_ensure(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
    initial_cwd: Option<String>,
) -> Result<(), String> {
    let prefs = state.persisted.lock().prefs.clone();
    let want = pty_identity(&prefs, initial_cwd.as_deref());
    {
        let panes = state.pty_panes.lock();
        let ids = state.pty_spawn_identity.lock();
        if panes.get(&pane_id).is_some()
            && ids.get(&pane_id).map(|x| x.as_str()) == Some(want.as_str())
        {
            return Ok(());
        }
    }
    if let Some(old) = state.pty_panes.lock().remove(&pane_id) {
        old.kill();
    }
    state.pty_spawn_identity.lock().remove(&pane_id);
    let session = Arc::new(PtySession::spawn(app, pane_id.clone(), cols, rows, &prefs, initial_cwd)?);
    state.pty_panes.lock().insert(pane_id.clone(), session);
    state.pty_spawn_identity.lock().insert(pane_id, want);
    Ok(())
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
    initial_cwd: Option<String>,
) -> Result<(), String> {
    if let Some(old) = state.pty_panes.lock().remove(&pane_id) {
        old.kill();
    }
    state.pty_spawn_identity.lock().remove(&pane_id);
    let prefs = state.persisted.lock().prefs.clone();
    let want = pty_identity(&prefs, initial_cwd.as_deref());
    let session = Arc::new(PtySession::spawn(app, pane_id.clone(), cols, rows, &prefs, initial_cwd)?);
    state.pty_panes.lock().insert(pane_id.clone(), session);
    state.pty_spawn_identity.lock().insert(pane_id, want);
    Ok(())
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, pane_id: String, data: String) -> Result<(), String> {
    let session = {
        let g = state.pty_panes.lock();
        g.get(&pane_id).cloned()
    };
    let Some(s) = session else {
        return Err("no active pty for pane".into());
    };
    s.write(data.as_bytes())
}

#[tauri::command]
fn pty_replay_snapshot(state: State<'_, AppState>, pane_id: String) -> Result<Option<String>, String> {
    let session = {
        let g = state.pty_panes.lock();
        g.get(&pane_id).cloned()
    };
    Ok(session.map(|s| s.replay_snapshot()).filter(|s| !s.is_empty()))
}

#[tauri::command]
fn pty_resize(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let g = state.pty_panes.lock();
    let Some(s) = g.get(&pane_id) else {
        return Ok(());
    };
    s.resize(cols, rows)
}

#[tauri::command]
fn pty_kill(state: State<'_, AppState>) -> Result<(), String> {
    clear_pty_session(&state);
    Ok(())
}

#[tauri::command]
fn pty_kill_pane(state: State<'_, AppState>, pane_id: String) -> Result<(), String> {
    kill_pane_session(&state, &pane_id);
    Ok(())
}

#[tauri::command]
fn pty_ack_exit(state: State<'_, AppState>, pane_id: String) -> Result<(), String> {
    kill_pane_session(&state, &pane_id);
    Ok(())
}

#[tauri::command]
fn pty_focus_pane(state: State<'_, AppState>, pane_id: String) -> Result<(), String> {
    if state.pty_panes.lock().contains_key(&pane_id) {
        *state.focused_pane_id.lock() = Some(pane_id);
    }
    Ok(())
}

/// Live cwd from the focused (or named) PTY.
pub(crate) fn effective_cwd_for_ui(state: &AppState, pane_id: Option<&str>) -> Option<String> {
    let resolved = pane_id
        .map(|s| s.to_string())
        .or_else(|| state.focused_pane_id.lock().clone())
        .or_else(|| state.pty_panes.lock().keys().next().cloned());
    let Some(id) = resolved else {
        return None;
    };
    let g = state.pty_panes.lock();
    let Some(s) = g.get(&id) else {
        return None;
    };
    if let Some(cwd) = s.shell_cwd() {
        let t = cwd.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    None
}

#[tauri::command]
fn pty_shell_cwd(
    state: State<'_, AppState>,
    pane_id: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(pid) = pane_id {
        let g = state.pty_panes.lock();
        let Some(s) = g.get(&pid) else {
            return Ok(None);
        };
        if let Some(cwd) = s.shell_cwd() {
            let t = cwd.trim().to_string();
            if !t.is_empty() {
                return Ok(Some(t));
            }
        }
        return Ok(None);
    }
    Ok(effective_cwd_for_ui(&state, None))
}

/// Foreground shell executable token for a pane (nested shell when detectable), for palette `>` commands.
#[tauri::command]
fn pty_shell_exe_token(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<Option<String>, String> {
    let g = state.pty_panes.lock();
    let Some(s) = g.get(&pane_id) else {
        return Ok(None);
    };
    Ok(s.shell_exe_token())
}

#[tauri::command]
fn get_persisted_state(state: State<'_, AppState>) -> PersistedState {
    state.persisted.lock().clone()
}

#[tauri::command]
fn list_custom_theme_names() -> Result<Vec<String>, String> {
    let dir = prefs::custom_themes_dir()?;
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(stem) = name.strip_suffix(".json") {
            out.push(stem.to_string());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn read_custom_theme_json(name: String) -> Result<String, String> {
    prefs::validate_custom_theme_name(&name)?;
    let path = prefs::custom_themes_dir()?.join(format!("{name}.json"));
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_custom_theme_json(name: String, json: String) -> Result<(), String> {
    prefs::validate_custom_theme_name(&name)?;
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let path = prefs::custom_themes_dir()?.join(format!("{name}.json"));
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_custom_theme_json(name: String) -> Result<(), String> {
    prefs::validate_custom_theme_name(&name)?;
    let path = prefs::custom_themes_dir()?.join(format!("{name}.json"));
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_preset_names() -> Result<Vec<String>, String> {
    let dir = prefs::presets_dir()?;
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(stem) = name.strip_suffix(".json") {
            out.push(stem.to_string());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn read_preset_json(name: String) -> Result<String, String> {
    prefs::validate_preset_name(&name)?;
    let path = prefs::presets_dir()?.join(format!("{name}.json"));
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_preset_json(name: String, json: String) -> Result<(), String> {
    prefs::validate_preset_name(&name)?;
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let path = prefs::presets_dir()?.join(format!("{name}.json"));
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_preset_json(name: String) -> Result<(), String> {
    prefs::validate_preset_name(&name)?;
    let path = prefs::presets_dir()?.join(format!("{name}.json"));
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_prefs(
    app: AppHandle,
    state: State<'_, AppState>,
    prefs: prefs::Prefs,
) -> Result<(), String> {
    {
        let mut p = state.persisted.lock();
        p.prefs = prefs.clone();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_skip_taskbar(prefs.hidden_from_taskbar);
    }
    apply_window_effects_to_all(&app, &prefs);
    Ok(())
}

#[tauri::command]
fn toggle_overlay(app: AppHandle) -> Result<(), String> {
    toggle_window(&app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let loaded = load_state();

    tauri::Builder::default()
        // Single-instance must run before global shortcuts: otherwise a second process tries to
        // register the same hotkeys and the global-shortcut plugin fails to initialize (and the
        // first instance can be left in a bad state depending on platform).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // `AppState` is not available until after `.manage()`; this callback can run earlier.
            let defer_prep = load_state().prefs.defer_window_show_until_prepared;
            if let Some(w) = app.get_webview_window("main") {
                if defer_prep {
                    let _ = w.emit("partty-prepare-show", ());
                } else {
                    position_main_at_cursor_if_prefs(app);
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = w.emit("partty-show", ());
                }
            } else if app.try_state::<AppState>().is_some() {
                spawn_show_main_window(app.clone());
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let mods = shortcut.mods;
                    if shortcut.key == Code::KeyT
                        && mods.contains(Modifiers::ALT)
                        && mods.contains(Modifiers::SHIFT)
                    {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            pty_panes: Mutex::new(HashMap::new()),
            persisted: Mutex::new(loaded.clone()),
            last_window_save: Mutex::new(None),
            pty_spawn_identity: Mutex::new(HashMap::new()),
            focused_pane_id: Mutex::new(Some("main".into())),
            webview_destroyed_for_hide: AtomicBool::new(false),
            defer_prepare_show_until_webview_ready: AtomicBool::new(false),
            hide_destroy_generation: AtomicU64::new(0),
            app_session_id: make_app_session_id(),
            fs_watcher: fs_watcher::create_watcher_handle(),
            detached_panes: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            pty_ensure,
            pty_spawn,
            pty_write,
            pty_replay_snapshot,
            pty_resize,
            pty_kill,
            pty_kill_pane,
            pty_ack_exit,
            pty_focus_pane,
            pty_shell_cwd,
            pty_shell_exe_token,
            get_persisted_state,
            get_app_session_id,
            list_custom_theme_names,
            read_custom_theme_json,
            write_custom_theme_json,
            delete_custom_theme_json,
            list_preset_names,
            read_preset_json,
            write_preset_json,
            delete_preset_json,
            set_prefs,
            toggle_overlay,
            pop_out_pane,
            get_detached_pane_bootstrap,
            close_detached_pane,
            webview_boot_complete,
            commit_show_window,
            request_destroy_webview_for_hide,
            palette_commands::get_palette_commands,
            palette_commands::get_palette_context,
            palette_commands::upsert_palette_command,
            palette_commands::delete_palette_command,
            read_dir_entries,
            read_dir_summary,
            git_workdir_status,
            git_repo_info,
            fs_parent_dir,
            fs_rename,
            fs_move_path,
            fs_remove,
            fs_create_file,
            fs_create_dir,
            search_file_contents,
            search_files_root,
            detect_shells,
            open_in_editor,
            open_external_url,
            reveal_in_explorer,
            open_external_terminal,
            open_with_editor,
            detect_installed_apps,
            run_file,
            fs_watch,
            fs_unwatch,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let win = app
                .get_webview_window("main")
                .expect("main window must exist");

            let st = loaded.clone();
            if let Err(e) = win.set_position(tauri::PhysicalPosition::new(st.window.x, st.window.y))
            {
                eprintln!("set_position: {e}");
            }
            if let Err(e) =
                win.set_size(tauri::PhysicalSize::new(st.window.width, st.window.height))
            {
                eprintln!("set_size: {e}");
            }
            if st.prefs.always_summon_maximized {
                let _ = win.maximize();
            } else if st.window.maximized {
                let _ = win.maximize();
            }
            let _ = win.set_skip_taskbar(st.prefs.hidden_from_taskbar);
            if st.prefs.always_on_top {
                let _ = win.set_always_on_top(true);
            }
            apply_window_effects(&win, &st.prefs);

            register_main_window_events(&handle, &win);

            // Register global shortcuts best-effort so one unavailable combo doesn't crash startup.
            let toggle_main = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT);
            if let Err(e) = app.global_shortcut().register(toggle_main) {
                eprintln!("global shortcut register failed (Alt+Shift+T): {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if app
                    .state::<AppState>()
                    .webview_destroyed_for_hide
                    .swap(false, Ordering::SeqCst)
                {
                    api.prevent_exit();
                } else {
                    save_state(&app.state::<AppState>().persisted.lock());
                }
            }
        });
}
