mod keybinds;
mod peb_cwd_windows;
mod prefs;
mod profile_icons;
mod profiles;
mod pty;
mod subprocess;
mod theme;
mod win_console;
mod window_state;

use parking_lot::Mutex;
use prefs::{load_persisted, save_prefs, PersistedState};
use pty::PtySession;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// A fully-spawned PTY session kept ready for instant adoption by the next
/// `pty_spawn` / `pty_ensure` call with a matching shell identity.
pub struct WarmPty {
    pub session: Arc<PtySession>,
    pub identity: String,
}

pub struct AppState {
    pub pty_panes: Mutex<HashMap<String, Arc<PtySession>>>,
    pub persisted: Mutex<PersistedState>,
    /// Debounce in-memory window geometry snapshots during move/resize.
    last_window_snapshot: Mutex<Option<Instant>>,
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
    /// Pre-warmed PTY session ready for instant pane creation.
    pub warm_pty: Mutex<Option<WarmPty>>,
    /// xterm SerializeAddon payloads stashed across webview destroy-on-hide.
    pub terminal_serialize_stash: Mutex<Option<HashMap<String, String>>>,
    /// Set by `stash_terminal_buffers` so delayed destroy waits for JS serialize+IPC.
    pub hide_buffers_ready: AtomicBool,
    /// When false, PTY emitter holds output (webview recreated but scrollback
    /// not rehydrated yet). Avoids flooding empty terminals before restore.
    pub pty_output_unlocked: AtomicBool,
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

/// Hold serialized terminal buffers in the Rust process so they survive webview destroy.
/// Also marks hide-buffers ready so delayed destroy can proceed.
#[tauri::command]
fn stash_terminal_buffers(
    state: State<'_, AppState>,
    buffers: HashMap<String, String>,
) -> Result<(), String> {
    *state.terminal_serialize_stash.lock() = Some(buffers);
    state.hide_buffers_ready.store(true, Ordering::SeqCst);
    Ok(())
}

/// Take (and clear) any stashed terminal buffers from the last hide.
#[tauri::command]
fn take_terminal_buffers(state: State<'_, AppState>) -> Option<HashMap<String, String>> {
    state.terminal_serialize_stash.lock().take()
}

/// True if the webview was destroyed for hide (needs scrollback restore). Clears the flag.
///
/// Note: `ExitRequested` must only *read* this flag (not clear it), or prepare-show
/// never sees a destroy and skips SerializeAddon rehydration.
#[tauri::command]
fn take_webview_destroyed_for_hide(state: State<'_, AppState>) -> bool {
    state
        .webview_destroyed_for_hide
        .swap(false, Ordering::SeqCst)
}

/// Start a fresh in-memory stash map (does not release the destroy gate yet).
#[tauri::command]
fn begin_terminal_buffer_stash(state: State<'_, AppState>) {
    *state.terminal_serialize_stash.lock() = Some(HashMap::new());
}

/// Stash one pane payload (avoids one giant IPC message for many panes).
#[tauri::command]
fn stash_terminal_buffer(
    state: State<'_, AppState>,
    pane_id: String,
    payload: String,
) -> Result<(), String> {
    let mut guard = state.terminal_serialize_stash.lock();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(pane_id, payload);
    Ok(())
}

/// Mark hide-buffer stash complete so delayed destroy can proceed.
#[tauri::command]
fn finalize_terminal_buffer_stash(state: State<'_, AppState>) {
    state.hide_buffers_ready.store(true, Ordering::SeqCst);
}

/// Allow or block PTY → webview delivery (see `pty_output_unlocked`).
#[tauri::command]
fn set_pty_output_unlocked(state: State<'_, AppState>, unlocked: bool) {
    state.pty_output_unlocked.store(unlocked, Ordering::SeqCst);
}

#[tauri::command]
fn detect_shells() -> Vec<pty::DetectedShell> {
    pty::detect_available_shells()
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

fn prefs_for_spawn(
    base: &prefs::Prefs,
    shell_override: Option<&str>,
    initial_cwd: Option<String>,
) -> prefs::Prefs {
    let mut prefs = base.clone();
    if let Some(shell) = shell_override.map(str::trim).filter(|s| !s.is_empty()) {
        prefs.shell = shell.to_string();
    }
    if let Some(cwd) = initial_cwd {
        prefs.initial_cwd = Some(cwd);
    }
    prefs
}

/// Resolve prefs + optional profile for a PTY spawn.
fn resolve_spawn(
    base: &prefs::Prefs,
    profile_id: Option<&str>,
    shell: Option<&str>,
    initial_cwd: Option<String>,
) -> Result<(prefs::Prefs, Option<profiles::ConnectionProfile>, String), String> {
    let profile = match profile_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => match profiles::get_profile(id) {
            Ok(p) => Some(p),
            Err(e) => {
                eprintln!("partty: profile `{id}`: {e}; falling back to local shell");
                None
            }
        },
        None => None,
    };

    let mut cwd = initial_cwd;
    if cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_none()
    {
        if let Some(pc) = profile
            .as_ref()
            .and_then(|p| p.initial_cwd.as_deref())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            cwd = Some(pc.to_string());
        }
    }

    let shell_from_profile = profile.as_ref().and_then(|p| match p.kind {
        profiles::ProfileKind::Local => p
            .shell
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        _ => None,
    });
    let shell_override = shell
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(shell_from_profile);

    let spawn_prefs = prefs_for_spawn(base, shell_override.as_deref(), cwd.clone());

    let backend_key = match profile.as_ref() {
        Some(p) if matches!(p.kind, profiles::ProfileKind::Wsl) => {
            format!(
                "wsl:{}",
                p.wsl_distro
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .to_lowercase()
            )
        }
        Some(p) if matches!(p.kind, profiles::ProfileKind::Ssh) => {
            let host = p
                .ssh_host
                .as_deref()
                .or(p.commandline.as_deref())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            format!(
                "ssh:{}:{}:{}",
                p.ssh_user.as_deref().unwrap_or("").trim().to_lowercase(),
                p.ssh_port.map(|n| n.to_string()).unwrap_or_default(),
                host
            )
        }
        _ => spawn_prefs.shell.trim().to_lowercase(),
    };
    let want = format!(
        "{}\0{}\0{}",
        profile.as_ref().map(|p| p.id.as_str()).unwrap_or(""),
        backend_key,
        cwd.as_deref()
            .unwrap_or(base.initial_cwd.as_deref().unwrap_or(""))
    );

    Ok((spawn_prefs, profile, want))
}

fn window_effect_config(prefs: &prefs::Prefs) -> Option<tauri::utils::config::WindowEffectsConfig> {
    match prefs
        .window_effect_mode
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
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

/// Spawn a background thread that pre-warms a PTY session so the NEXT split
/// can be served instantly (no shell startup wait).
fn refill_warm_pty(
    app: &AppHandle,
    prefs: &prefs::Prefs,
    identity: String,
    profile: Option<profiles::ConnectionProfile>,
) {
    let app = app.clone();
    let prefs = prefs.clone();
    thread::spawn(move || {
        // Small delay so the warm spawn doesn't compete with the just-completed
        // pane spawn for CPU/IO on the same shell binary.
        thread::sleep(Duration::from_millis(150));
        // Give the warm session a well-known placeholder ID; it is updated to
        // the real pane_id atomically when the session is adopted.
        let warm_id = "__partty_warm__".to_string();
        match PtySession::spawn_with_profile(
            app.clone(),
            warm_id,
            80,
            24,
            &prefs,
            None,
            profile.as_ref(),
        ) {
            Ok(session) => {
                if let Some(state) = app.try_state::<AppState>() {
                    let mut g = state.warm_pty.lock();
                    *g = Some(WarmPty {
                        session: Arc::new(session),
                        identity,
                    });
                }
            }
            Err(e) => {
                eprintln!("partty: warm pty spawn failed: {e}");
            }
        }
    });
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
    for (_, s) in state.pty_panes.lock().drain() {
        s.kill();
    }
    state.pty_spawn_identity.lock().clear();
    *state.focused_pane_id.lock() = None;
}

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

fn position_window_near_cursor(win: &tauri::WebviewWindow, width: u32, height: u32) {
    let (cx, cy) = cursor_physical_position();
    let w = width as i32;
    let h = height as i32;
    let x = cx.saturating_sub(w / 2);
    let y = cy.saturating_sub(h / 2);
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    window_state::suppress_snapshot_for(500);
}

fn position_main_at_cursor_if_prefs(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // Use disk prefs: this runs from the single-instance callback before `AppState` may exist.
    let st = load_persisted();
    let at_cursor = st.prefs.summon_spawn_at_cursor;
    if !at_cursor {
        return;
    }
    if let Ok(sz) = win.outer_size() {
        position_window_near_cursor(&win, sz.width, sz.height);
    }
}

/// Let the `partty-hide` handler finish serialize+stash IPC, then destroy the
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
    // `hide_buffers_ready` was cleared in `toggle_window` before `partty-hide`.
    let app = app.clone();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if app
                .state::<AppState>()
                .hide_destroy_generation
                .load(Ordering::SeqCst)
                != generation
            {
                return;
            }
            if app
                .state::<AppState>()
                .hide_buffers_ready
                .load(Ordering::SeqCst)
            {
                break;
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        // Brief settle after IPC marks ready.
        thread::sleep(Duration::from_millis(20));
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
        let state = save_handle.state::<AppState>();
        match ev {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                window_state::debounced_snapshot_to_memory(
                    &save_handle,
                    &state.last_window_snapshot,
                );
            }
            WindowEvent::CloseRequested { .. } => {
                window_state::snapshot_and_save(&save_handle);
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

    // Always start un-maximized — show then maximize gives Windows
    // a clean visible rect to compute the maximized bounds from.
    if window_state::should_maximize_on_show(st.prefs.always_summon_maximized, &st.window) {
        let _ = win.unmaximize();
    }

    apply_window_effects(&win, &st.prefs);
    if !st.window.maximized && !st.prefs.always_summon_maximized {
        window_state::apply_saved_window_bounds(&win, &st.window);
    }
    // Maximize deferred to spawn_show_main_window — calling maximize()
    // before show() causes Windows to miscalculate the maximized client
    // rect, leaving a white bar at the bottom.
    let _ = win.set_skip_taskbar(st.prefs.hidden_from_taskbar);
    if st.prefs.always_on_top {
        let _ = win.set_always_on_top(true);
    }

    register_main_window_events(app, &win);
    Ok(())
}

fn spawn_show_main_window(app: AppHandle) {
    let defer_prep = load_persisted().prefs.defer_window_show_until_prepared;
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
            // Maximize AFTER show — calling maximize() before the window
            // is visible causes Windows to miscompute the maximized client rect.
            let app_state = app.state::<AppState>();
            let st = app_state.persisted.lock();
            let should_max =
                window_state::should_maximize_on_show(st.prefs.always_summon_maximized, &st.window);
            drop(st);
            if should_max {
                let _ = w.maximize();
            }
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
        // When destroying the webview on hide, un-maximize before saving
        // so the persisted dimensions reflect the normal rect. The window is
        // recreated from these dimensions on next summon, then maximized after show.
        if state.persisted.lock().prefs.destroy_webview_on_hide {
            let _ = win.unmaximize();
            // JS must stash (or ack empty) before delayed destroy proceeds.
            state.hide_buffers_ready.store(false, Ordering::SeqCst);
            // Hold PTY output until the next webview finishes scrollback restore.
            state.pty_output_unlocked.store(false, Ordering::SeqCst);
        }
        window_state::snapshot_and_save(app);
        let _ = win.emit("partty-hide", ());
        let _ = win.hide();
        schedule_destroy_webview_after_hide(app);
    } else {
        // Cancel any pending destroy-on-hide. If the webview is still alive,
        // unlock PTY immediately — scrollback is still in the live xterm.
        state.hide_destroy_generation.fetch_add(1, Ordering::SeqCst);
        state.pty_output_unlocked.store(true, Ordering::SeqCst);
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
            // Show → unmaximize → maximize forces Windows to recalculate
            // the client rect from scratch. maximize() on an already-maximized
            // hidden window is a no-op — the OS won't recompute the bounds.
            if summon || win.is_maximized().unwrap_or(false) {
                let st = state.persisted.lock();
                let restore_max = window_state::should_maximize_on_show(
                    st.prefs.always_summon_maximized,
                    &st.window,
                );
                drop(st);
                if restore_max {
                    let _ = win.unmaximize();
                    let _ = win.maximize();
                }
            }
            let _ = win.set_focus();
            let _ = win.emit("partty-show", ());
        }
    }
}

/// Call from the frontend after `partty-prepare-show` listeners are registered (e.g. end of `boot()`).
/// If the main window was just recreated with deferred show, emits `partty-prepare-show` once.
/// On first boot with `window_startup_visible`, auto-shows the window.
#[tauri::command]
fn webview_boot_complete(app: AppHandle) -> Result<(), String> {
    let st = app.state::<AppState>();
    let was_deferred = st
        .defer_prepare_show_until_webview_ready
        .swap(false, Ordering::SeqCst);

    if was_deferred {
        let Some(w) = app.get_webview_window("main") else {
            return Ok(());
        };
        let _ = w.emit("partty-prepare-show", ());
        return Ok(());
    }

    let p = st.persisted.lock().prefs.clone();
    if p.window_startup_visible {
        if p.defer_window_show_until_prepared {
            st.defer_prepare_show_until_webview_ready
                .store(true, Ordering::SeqCst);
            let Some(w) = app.get_webview_window("main") else {
                return Ok(());
            };
            let _ = w.emit("partty-prepare-show", ());
        } else {
            let Some(w) = app.get_webview_window("main") else {
                return Ok(());
            };
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("partty-show", ());
        }
    }

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
    let saved_maximized = app.state::<AppState>().persisted.lock().window.maximized;
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
    if summon || saved_maximized {
        let _ = win.unmaximize();
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
    shell: Option<String>,
    profile_id: Option<String>,
) -> Result<(), String> {
    let base = state.persisted.lock().prefs.clone();
    let (spawn_prefs, profile, want) =
        resolve_spawn(&base, profile_id.as_deref(), shell.as_deref(), initial_cwd)?;
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
    let session = Arc::new(PtySession::spawn_with_profile(
        app.clone(),
        pane_id.clone(),
        cols,
        rows,
        &spawn_prefs,
        None,
        profile.as_ref(),
    )?);
    state.pty_panes.lock().insert(pane_id.clone(), session);
    state
        .pty_spawn_identity
        .lock()
        .insert(pane_id, want.clone());

    // Prime the warm pool for the first pane split.
    refill_warm_pty(&app, &spawn_prefs, want, profile);
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
    shell: Option<String>,
    profile_id: Option<String>,
) -> Result<(), String> {
    if let Some(old) = state.pty_panes.lock().remove(&pane_id) {
        old.kill();
    }
    state.pty_spawn_identity.lock().remove(&pane_id);
    let base = state.persisted.lock().prefs.clone();
    let (spawn_prefs, profile, want) =
        resolve_spawn(&base, profile_id.as_deref(), shell.as_deref(), initial_cwd)?;

    // Try to adopt a pre-warmed session (identity must match; cwd ignored for warm
    // sessions since they start at the prefs default and the shell will cd via OSC).
    let session: Arc<PtySession> = {
        let warm = {
            let mut g = state.warm_pty.lock();
            if g.as_ref().map(|w| w.identity.as_str()) == Some(want.as_str()) {
                g.take()
            } else {
                None
            }
        };
        if let Some(warm) = warm {
            // Adopt: update the session's pane_id atomically and resize.
            *warm.session.pane_id.lock() = pane_id.clone();
            let _ = warm.session.resize(cols, rows);
            warm.session
        } else {
            // Cold spawn.
            Arc::new(PtySession::spawn_with_profile(
                app.clone(),
                pane_id.clone(),
                cols,
                rows,
                &spawn_prefs,
                None,
                profile.as_ref(),
            )?)
        }
    };

    state.pty_panes.lock().insert(pane_id.clone(), session);
    state
        .pty_spawn_identity
        .lock()
        .insert(pane_id, want.clone());

    // Refill the warm slot in the background for the next split.
    refill_warm_pty(&app, &spawn_prefs, want, profile);
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
fn pty_replay_snapshot(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<Option<String>, String> {
    let session = {
        let g = state.pty_panes.lock();
        g.get(&pane_id).cloned()
    };
    Ok(session
        .map(|s| s.replay_snapshot())
        .filter(|s| !s.is_empty()))
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
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<profiles::ProfileDto>, String> {
    let prefs = state.persisted.lock().prefs.clone();
    profiles::list_profiles(&prefs)
}

#[tauri::command]
fn get_profile(id: String) -> Result<profiles::ProfileDto, String> {
    let p = profiles::get_profile(&id)?;
    Ok(profiles::ProfileDto::from(&p))
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
    save_prefs(&prefs);
    // Invalidate the warm PTY — the shell identity may have changed.
    *state.warm_pty.lock() = None;
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ExtensionManifest {
    name: String,
    version: String,
    description: String,
}

#[derive(Clone, serde::Serialize)]
struct ExtensionInfo {
    id: String,
    name: String,
    version: String,
    description: String,
    code: String,
    enabled: bool,
}

fn extension_state_path() -> Option<PathBuf> {
    prefs::extension_state_path()
}

fn load_extension_state() -> HashMap<String, bool> {
    let path = match extension_state_path() {
        Some(p) => p,
        None => return HashMap::new(),
    };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<HashMap<String, bool>>(&s).ok())
        .unwrap_or_default()
}

fn save_extension_state(state: &HashMap<String, bool>) {
    if let Some(path) = extension_state_path() {
        let _ = std::fs::write(&path, serde_json::to_string(state).unwrap_or_default());
    }
}

/// Scan ~/.partty/extensions/ for extension folders containing a manifest.json and index.js.
#[tauri::command]
fn list_extensions() -> Vec<ExtensionInfo> {
    let mut exts = Vec::new();
    let base = match prefs::extensions_dir() {
        Some(d) => d,
        None => return exts,
    };
    let dir = match std::fs::read_dir(&base) {
        Ok(d) => d,
        Err(_) => return exts,
    };
    let state = load_extension_state();
    for entry in dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if id.is_empty() || id.starts_with('.') {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        let manifest: ExtensionManifest = std::fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(ExtensionManifest {
                name: id.clone(),
                version: "0.0.0".into(),
                description: String::new(),
            });

        let index_path = path.join("index.js");
        let code = std::fs::read_to_string(&index_path).unwrap_or_default();
        if code.trim().is_empty() {
            continue;
        }

        let enabled = state.get(&id).copied().unwrap_or(true);
        exts.push(ExtensionInfo {
            id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            code,
            enabled,
        });
    }
    exts
}

#[tauri::command]
fn set_extension_enabled(id: String, enabled: bool) {
    let mut state = load_extension_state();
    state.insert(id, enabled);
    save_extension_state(&state);
}

pub fn run() {
    let mut loaded = load_persisted();
    window_state::sanitize_window_state(&mut loaded.window);

    let kb = keybinds::load_keybinds();
    let toggle_binding = kb
        .bind
        .get("window_toggle")
        .cloned()
        .unwrap_or_else(|| "Alt+Shift+T".to_string());
    let (toggle_mods, toggle_code) = keybinds::parse_global_shortcut(&toggle_binding);

    tauri::Builder::default()
        // Single-instance must run before global shortcuts: otherwise a second process tries to
        // register the same hotkeys and the global-shortcut plugin fails to initialize (and the
        // first instance can be left in a bad state depending on platform).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // `AppState` is not available until after `.manage()`; this callback can run earlier.
            let defer_prep = load_persisted().prefs.defer_window_show_until_prepared;
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
                .with_handler(|app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    toggle_window(app);
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            pty_panes: Mutex::new(HashMap::new()),
            persisted: Mutex::new(loaded.clone()),
            last_window_snapshot: Mutex::new(None),
            pty_spawn_identity: Mutex::new(HashMap::new()),
            focused_pane_id: Mutex::new(Some("main".into())),
            webview_destroyed_for_hide: AtomicBool::new(false),
            defer_prepare_show_until_webview_ready: AtomicBool::new(false),
            hide_destroy_generation: AtomicU64::new(0),
            app_session_id: make_app_session_id(),
            warm_pty: Mutex::new(None),
            terminal_serialize_stash: Mutex::new(None),
            hide_buffers_ready: AtomicBool::new(true),
            pty_output_unlocked: AtomicBool::new(true),
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
            stash_terminal_buffers,
            begin_terminal_buffer_stash,
            stash_terminal_buffer,
            finalize_terminal_buffer_stash,
            take_terminal_buffers,
            take_webview_destroyed_for_hide,
            set_pty_output_unlocked,
            theme::list_themes,
            theme::read_theme,
            theme::write_theme,
            theme::delete_theme,
            theme::get_theme_effective_prefs,
            list_profiles,
            get_profile,
            list_preset_names,
            read_preset_json,
            write_preset_json,
            delete_preset_json,
            set_prefs,
            toggle_overlay,
            list_extensions,
            set_extension_enabled,
            webview_boot_complete,
            commit_show_window,
            request_destroy_webview_for_hide,
            keybinds::get_keybinds,
            keybinds::set_keybind,
            keybinds::reset_keybinds,
            detect_shells,
            open_external_url,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let win = app
                .get_webview_window("main")
                .expect("main window must exist");

            let mut st = loaded.clone();
            window_state::sanitize_window_state(&mut st.window);
            if !st.window.maximized && !st.prefs.always_summon_maximized {
                window_state::apply_saved_window_bounds(&win, &st.window);
            }
            // Maximize is deferred to spawn_show_main_window (after show).
            let _ = win.set_skip_taskbar(st.prefs.hidden_from_taskbar);
            if st.prefs.always_on_top {
                let _ = win.set_always_on_top(true);
            }
            apply_window_effects(&win, &st.prefs);

            register_main_window_events(&handle, &win);

            // Register the summon/dismiss global shortcut from keybinds config.
            let toggle_sc = Shortcut::new(Some(toggle_mods), toggle_code);
            if let Err(e) = app.global_shortcut().register(toggle_sc) {
                eprintln!("[partty] global shortcut register failed for \"{toggle_binding}\": {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Resumed = event {
                let st = app.state::<AppState>();
                let prefs = st.persisted.lock().prefs.clone();
                apply_window_effects_to_all(app, &prefs);
            }
            if let RunEvent::ExitRequested { api, .. } = event {
                // Destroy-on-hide tears down the last window and fires ExitRequested.
                // Keep `webview_destroyed_for_hide` set — JS reads it on the next
                // prepare-show to know scrollback must be restored. Clearing it here
                // (via swap) skipped rehydration entirely.
                if app
                    .state::<AppState>()
                    .webview_destroyed_for_hide
                    .load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                } else {
                    window_state::snapshot_and_save(app);
                }
            }
        });
}
