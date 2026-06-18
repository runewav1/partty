//! Persisted main-window geometry: capture, sanitize, and restore.
//!
//! Move/resize updates only the in-memory `AppState.persisted` (debounced).
//! Disk writes happen on intentional lifecycle points (hide, close, exit).

use crate::prefs::{save_state, PersistedState, WindowState};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Manager, WebviewWindow};

const MIN_WINDOW_WIDTH: u32 = 360;
const MIN_WINDOW_HEIGHT: u32 = 240;
const MEMORY_SNAPSHOT_DEBOUNCE_MS: u128 = 250;

static SUPPRESS_SNAPSHOT_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Ignore move/resize snapshots briefly after programmatic reposition (e.g. summon-at-cursor).
pub fn suppress_snapshot_for(ms: u64) {
    SUPPRESS_SNAPSHOT_UNTIL_MS.store(now_ms().saturating_add(ms), Ordering::SeqCst);
}

fn snapshot_suppressed() -> bool {
    now_ms() < SUPPRESS_SNAPSHOT_UNTIL_MS.load(Ordering::SeqCst)
}

pub fn sanitize_window_state(ws: &mut WindowState) {
    ws.width = ws.width.clamp(MIN_WINDOW_WIDTH, 16_000);
    ws.height = ws.height.clamp(MIN_WINDOW_HEIGHT, 16_000);

    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN,
        };
        let vx = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
        let vy = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
        let vw = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) } as i32;
        let vh = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) } as i32;
        let min_visible = 96i32;
        let w = ws.width as i32;
        let h = ws.height as i32;

        if ws.x + w < vx + min_visible {
            ws.x = vx + min_visible - w;
        }
        if ws.x > vx + vw - min_visible {
            ws.x = (vx + vw - min_visible).max(vx);
        }
        if ws.y + h < vy + min_visible {
            ws.y = vy + min_visible - h;
        }
        if ws.y > vy + vh - min_visible {
            ws.y = (vy + vh - min_visible).max(vy);
        }
    }
}

#[cfg(windows)]
fn read_normal_placement(window: &WebviewWindow) -> Option<(i32, i32, u32, u32)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT};

    let hwnd = window.hwnd().ok()?;
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        flags: 0,
        showCmd: 0,
        ptMinPosition: windows_sys::Win32::Foundation::POINT { x: 0, y: 0 },
        ptMaxPosition: windows_sys::Win32::Foundation::POINT { x: 0, y: 0 },
        rcNormalPosition: windows_sys::Win32::Foundation::RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
    };
    unsafe {
        if GetWindowPlacement(hwnd.0 as _, &mut placement) == 0 {
            return None;
        }
        let r = placement.rcNormalPosition;
        let width = (r.right - r.left).max(MIN_WINDOW_WIDTH as i32) as u32;
        let height = (r.bottom - r.top).max(MIN_WINDOW_HEIGHT as i32) as u32;
        Some((r.left, r.top, width, height))
    }
}

#[cfg(not(windows))]
fn read_normal_placement(_window: &WebviewWindow) -> Option<(i32, i32, u32, u32)> {
    None
}

/// Read the window's current geometry into `PersistedState.window`.
pub fn snapshot_window_into(persisted: &mut PersistedState, window: &WebviewWindow) {
    let maximized = window.is_maximized().unwrap_or(false);
    persisted.window.maximized = maximized;

    if let Some((x, y, width, height)) = read_normal_placement(window) {
        persisted.window.x = x;
        persisted.window.y = y;
        persisted.window.width = width;
        persisted.window.height = height;
        sanitize_window_state(&mut persisted.window);
        return;
    }

    if maximized {
        // Keep the last known restore rect; only the maximized flag changed.
        return;
    }

    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(sz) = window.outer_size() else {
        return;
    };
    persisted.window.x = pos.x;
    persisted.window.y = pos.y;
    persisted.window.width = sz.width.max(MIN_WINDOW_WIDTH);
    persisted.window.height = sz.height.max(MIN_WINDOW_HEIGHT);
    sanitize_window_state(&mut persisted.window);
}

/// Debounced in-memory snapshot during drag-resize (no disk write).
pub fn debounced_snapshot_to_memory(
    app: &AppHandle,
    last_snapshot: &Mutex<Option<Instant>>,
) {
    if snapshot_suppressed() {
        return;
    }
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<crate::AppState>();
    let now = Instant::now();
    let mut last = last_snapshot.lock();
    let should_snap = match *last {
        None => true,
        Some(t) => now.duration_since(t).as_millis() > MEMORY_SNAPSHOT_DEBOUNCE_MS,
    };
    if should_snap {
        let mut persisted = state.persisted.lock();
        snapshot_window_into(&mut persisted, &win);
        *last = Some(now);
    }
}

/// Snapshot current geometry and flush `state.json` (hide / close / exit only).
pub fn snapshot_and_save(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<crate::AppState>();
    let mut persisted = state.persisted.lock();
    snapshot_window_into(&mut persisted, &win);
    save_state(&persisted);
}

/// Apply saved bounds before show/maximize dance.
pub fn apply_saved_window_bounds(window: &WebviewWindow, ws: &WindowState) {
    let mut ws = ws.clone();
    sanitize_window_state(&mut ws);
    let _ = window.set_position(tauri::PhysicalPosition::new(ws.x, ws.y));
    let _ = window.set_size(tauri::PhysicalSize::new(ws.width, ws.height));
    suppress_snapshot_for(500);
}

pub fn should_maximize_on_show(always_summon_maximized: bool, ws: &WindowState) -> bool {
    always_summon_maximized || ws.maximized
}
