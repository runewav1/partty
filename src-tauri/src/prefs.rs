use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: 100,
            y: 100,
            width: 920,
            height: 520,
            maximized: false,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_pane_blur_radius() -> f64 {
    1.6
}

fn default_pane_focus_scale_intensity() -> f64 {
    0.45
}

fn default_confirm_delete_prompt() -> bool {
    true
}

fn default_file_tree_show_git_info() -> bool {
    true
}

fn default_file_tree_side() -> String {
    "left".to_string()
}

fn default_ui_disable_tooltips() -> bool {
    false
}

fn default_terminal_backspace_delete_selection() -> bool {
    true
}

fn default_scrollback_lines() -> u32 {
    1000
}

fn default_snapshot_max_lines() -> u32 {
    2500
}

fn default_ui_theme() -> String {
    "system".to_string()
}

fn default_ui_theme_variant() -> String {
    "default".to_string()
}

fn default_terminal_animation_speed() -> String {
    "normal".to_string()
}

fn default_terminal_animation_style() -> String {
    "smooth".to_string()
}

fn default_split_layout_style() -> String {
    "balanced".to_string()
}

fn default_terminal_pane_gap() -> f64 {
    6.0
}

fn default_terminal_sandbox_padding() -> f64 {
    0.0
}

fn default_window_effect_mode() -> String {
    "transparent".to_string()
}

fn default_window_effect_opacity() -> f64 {
    0.0
}

fn default_pane_corner_radius() -> f64 {
    6.0
}

fn default_cursor_style() -> String {
    "block".to_string()
}

fn default_cursor_inactive_style() -> String {
    "outline".to_string()
}

fn default_cursor_width() -> f64 {
    1.0
}

fn default_font_size() -> f64 {
    12.0
}

fn default_font_weight() -> String {
    "normal".to_string()
}

fn default_font_weight_bold() -> String {
    "bold".to_string()
}

fn default_line_height() -> f64 {
    1.0
}

fn default_letter_spacing() -> f64 {
    0.0
}

fn default_scroll_sensitivity() -> f64 {
    1.0
}

fn default_fast_scroll_sensitivity() -> f64 {
    5.0
}

fn default_minimum_contrast_ratio() -> f64 {
    1.0
}

fn default_process_notification_threshold() -> f64 {
    5.0
}

fn default_process_notification_show_for() -> f64 {
    5000.0
}

fn default_mouse_idle_seconds() -> f64 {
    3.0
}

fn default_dev_perf_console_interval_ms() -> u32 {
    5000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    pub shell: String,
    /// When true, drop ConPTY on hide (new shell on next show).
    pub shed_on_hide: bool,
    pub always_on_top: bool,
    pub initial_cwd: Option<String>,
    /// Dispose WebGL addon when hiding; DOM renderer holds the buffer until next show.
    #[serde(default = "default_true")]
    pub webgl_shed_on_hide: bool,
    /// Snapshot plain text, `reset()` xterm, shed WebGL — replay on next show (saves emulator RAM).
    pub discard_buffer_on_hide: bool,
    /// xterm scrollback capacity (older lines discarded by xterm when over limit).
    #[serde(default = "default_scrollback_lines")]
    pub scrollback_lines: u32,
    /// Max lines kept when building a snapshot for `discard_buffer_on_hide`.
    #[serde(default = "default_snapshot_max_lines")]
    pub snapshot_max_lines: u32,
    /// Spawn ConPTY while the window is still hidden (warm first open).
    #[serde(default = "default_true")]
    pub preload_pty_on_startup: bool,
    /// Load WebGL during hidden startup (with preload PTY).
    #[serde(default = "default_true")]
    pub preload_webgl_on_startup: bool,
    /// Emit prepare-show and wait for `commit_show_window` before `Window::show`.
    #[serde(default = "default_true")]
    pub defer_window_show_until_prepared: bool,
    /// Destroy the main webview window on hide (after JS teardown) to release WebView2 RAM; recreated on next show.
    #[serde(default = "default_true")]
    pub destroy_webview_on_hide: bool,
    /// When true, moving the mouse between terminal panes moves focus (split view). Default: click to focus.
    #[serde(default)]
    pub focus_follows_cursor: bool,
    /// Apply a subtle blur to unfocused panes while split.
    #[serde(default)]
    pub blur_unfocused_panes: bool,
    /// Blur radius in px applied to unfocused split panes when blur is enabled.
    #[serde(default = "default_pane_blur_radius")]
    pub pane_blur_radius: f64,
    /// Apply a subtle dimming effect to unfocused panes while split.
    #[serde(default)]
    pub dim_unfocused_panes: bool,
    /// Slight scale-up on the focused split pane (and scale-down on inactive panes).
    #[serde(default = "default_true")]
    pub focus_pane_scale: bool,
    /// Focus scale intensity from 0 (off) to 1 (strong).
    #[serde(default = "default_pane_focus_scale_intensity")]
    pub pane_focus_scale_intensity: f64,
    /// Automatically copy terminal text whenever the selection changes.
    #[serde(default)]
    pub auto_copy_selection: bool,
    /// `keep` | `shed` | `ask` — workspace localStorage on exit (tabs, layouts, etc.).
    #[serde(default)]
    pub shed_workspace_exit: String,
    /// When true, window is shown maximized (overrides last size until turned off).
    #[serde(default)]
    pub always_summon_maximized: bool,
    /// When true, summoning the main window (overlay toggle) places it at the OS cursor.
    #[serde(default)]
    pub summon_spawn_at_cursor: bool,
    /// When true, moving the window to another monitor (Alt+Shift+Right) warps the OS
    /// cursor along with it, onto the focused pane.
    #[serde(default)]
    pub cursor_follow_window_move: bool,
    /// When true, warp the OS cursor to the focused pane on focus/tab/swap changes.
    #[serde(default = "default_true")]
    pub cursor_follow_pane_focus: bool,
    /// Windows: hide window from taskbar (tool window style).
    #[serde(default)]
    pub hidden_from_taskbar: bool,
    /// Show git diff +/- counts next to file panel status badges.
    #[serde(default)]
    pub file_tree_show_diff_counts: bool,
    /// Show git info panel at the bottom of the file tree.
    #[serde(default = "default_file_tree_show_git_info")]
    pub file_tree_show_git_info: bool,
    /// Hide the file tree completely and disable its shortcuts/commands.
    #[serde(default)]
    pub file_tree_disabled: bool,
    /// Disable the file tree search/filter bar (reclaims vertical space).
    #[serde(default)]
    pub file_tree_disable_search: bool,
    /// `left` | `right` — dock side for the file tree.
    #[serde(default = "default_file_tree_side")]
    pub file_tree_side: String,
    /// Ask for confirmation before deleting items from the file tree.
    #[serde(default = "default_confirm_delete_prompt")]
    pub confirm_delete_prompt: bool,
    /// Disable native hover tooltips in the UI (also forced while in zen mode).
    #[serde(default = "default_ui_disable_tooltips")]
    pub ui_disable_tooltips: bool,
    /// When true, backspace deletes the selected text block in the terminal.
    #[serde(default = "default_terminal_backspace_delete_selection")]
    pub terminal_backspace_delete_selection: bool,
    /// Start the app in zen mode on every launch/show.
    #[serde(default)]
    pub always_open_in_zen_mode: bool,
    /// Remove pane/container gaps for dense terminal layouts.
    #[serde(default)]
    pub terminal_no_gap: bool,
    /// Pane/container gap in px.
    #[serde(default = "default_terminal_pane_gap")]
    pub terminal_pane_gap: f64,
    /// Padding around the pane sandbox in px.
    #[serde(default = "default_terminal_sandbox_padding")]
    pub terminal_sandbox_padding: f64,
    /// Remove rounded pane/chrome corners for dense terminal layouts.
    #[serde(default)]
    pub terminal_no_round: bool,
    /// Hide pane borders entirely, including split/floating borders.
    #[serde(default)]
    pub terminal_no_pane_border: bool,
    /// Keep pane borders but do not accent the focused split pane border.
    #[serde(default)]
    pub terminal_no_focus_border: bool,
    /// `off` | `fast` | `normal` | `slow` — scales terminal UI animations.
    #[serde(default = "default_terminal_animation_speed")]
    pub terminal_animation_speed: String,
    /// `smooth` | `snappy` | `gentle` | `bouncy` — easing character of UI animations.
    #[serde(default = "default_terminal_animation_style")]
    pub terminal_animation_style: String,
    /// Play a subtle settle animation on the panes when the window is
    /// resized/restored/maximized or moved between monitors.
    #[serde(default = "default_true")]
    pub terminal_window_motion: bool,
    /// `balanced` | `dwindle` | `master` — pane split insertion math.
    #[serde(default = "default_split_layout_style")]
    pub split_layout_style: String,
    /// When true, Ctrl+Shift+number moves a pane to another tab without switching to it.
    #[serde(default)]
    pub quiet_pane_deferral: bool,
    /// `off` | `transparent` — Tauri window backdrop mode.
    #[serde(default = "default_window_effect_mode")]
    pub window_effect_mode: String,
    /// Reserved alpha value for window backdrop tinting.
    #[serde(default = "default_window_effect_opacity")]
    pub window_effect_opacity: f64,
    /// Pane corner radius in px when square panes are disabled.
    #[serde(default = "default_pane_corner_radius")]
    pub pane_corner_radius: f64,
    /// `block` | `underline` | `bar` — terminal cursor style.
    #[serde(default = "default_cursor_style")]
    pub terminal_cursor_style: String,
    /// Whether the cursor blinks.
    #[serde(default = "default_true")]
    pub terminal_cursor_blink: bool,
    /// `outline` | `block` | `bar` | `underline` | `none` — cursor style when unfocused.
    #[serde(default = "default_cursor_inactive_style")]
    pub terminal_cursor_inactive_style: String,
    /// Cursor width in px when `cursor_style` is `bar`.
    #[serde(default = "default_cursor_width")]
    pub terminal_cursor_width: f64,
    /// Alt+click repositions the terminal cursor (xterm built-in).
    #[serde(default = "default_true")]
    pub terminal_alt_click_moves_cursor: bool,
    /// Font size in px.
    #[serde(default = "default_font_size")]
    pub terminal_font_size: f64,
    /// Font weight for non‑bold text (CSS value).
    #[serde(default = "default_font_weight")]
    pub terminal_font_weight: String,
    /// Font weight for bold text (CSS value).
    #[serde(default = "default_font_weight_bold")]
    pub terminal_font_weight_bold: String,
    /// Line height multiplier.
    #[serde(default = "default_line_height")]
    pub terminal_line_height: f64,
    /// Letter spacing in px.
    #[serde(default = "default_letter_spacing")]
    pub terminal_letter_spacing: f64,
    /// Draw bold text in bright ANSI colors.
    #[serde(default = "default_true")]
    pub terminal_draw_bold_bright: bool,
    /// Draw custom glyphs for box‑drawing characters.
    #[serde(default = "default_true")]
    pub terminal_custom_glyphs: bool,
    /// Smooth‑scroll duration in ms (0 = instant).
    #[serde(default)]
    pub terminal_smooth_scroll_duration: f64,
    /// Normal scroll speed multiplier.
    #[serde(default = "default_scroll_sensitivity")]
    pub terminal_scroll_sensitivity: f64,
    /// Fast‑scroll (Alt+wheel) speed multiplier.
    #[serde(default = "default_fast_scroll_sensitivity")]
    pub terminal_fast_scroll_sensitivity: f64,
    /// Minimum contrast ratio for foreground text (1 = off).
    #[serde(default = "default_minimum_contrast_ratio")]
    pub terminal_minimum_contrast_ratio: f64,
    /// Minimum command duration (seconds) before a completion notification fires.
    /// Sub‑second granularity is supported (e.g. 2.5 = 2.5 s). Default 5.0.
    #[serde(default = "default_process_notification_threshold")]
    pub process_notification_threshold: f64,
    /// How long the completion toast stays visible in milliseconds (1000–30000). Default 5000.
    #[serde(default = "default_process_notification_show_for")]
    pub process_notification_show_for: f64,
    /// Show millisecond precision in process completion toasts.
    #[serde(default)]
    pub process_notification_show_ms: bool,
    /// Use a translucent process-completion toast background.
    #[serde(default)]
    pub process_notification_transparent: bool,
    /// Always hide the OS mouse cursor over the window (overrides idle hide).
    #[serde(default)]
    pub mouse_hidden: bool,
    /// Hide the OS mouse cursor after it stops moving.
    #[serde(default)]
    pub mouse_hide_on_idle: bool,
    /// Seconds of pointer inactivity before hiding (when `mouse_hide_on_idle`).
    #[serde(default = "default_mouse_idle_seconds")]
    pub mouse_idle_seconds: f64,
    /// Developer metrics collection. Off by default because it adds observers and rAF sampling.
    #[serde(default)]
    pub dev_perf_enabled: bool,
    /// Print metrics snapshots to the WebView console while developer metrics are enabled.
    #[serde(default)]
    pub dev_perf_console: bool,
    /// Console snapshot interval in milliseconds.
    #[serde(default = "default_dev_perf_console_interval_ms")]
    pub dev_perf_console_interval_ms: u32,
    /// App chrome + terminal palette id (see frontend `themePresets`).
    #[serde(default = "default_ui_theme")]
    pub ui_theme: String,
    /// Sub-palette: e.g. gruvbox soft/hard/light; solarized dark/light; catppuccin flavor.
    #[serde(default = "default_ui_theme_variant")]
    pub ui_theme_variant: String,
    /// Font stack for xterm (empty = browser default stack with nerd-font fallbacks).
    #[serde(default)]
    pub font_terminal: String,
    #[serde(default)]
    pub font_ui: String,
    #[serde(default)]
    pub font_file_tree: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            shell: "pwsh".to_string(),
            shed_on_hide: false,
            always_on_top: false,
            initial_cwd: None,
            webgl_shed_on_hide: true,
            discard_buffer_on_hide: false,
            scrollback_lines: 1000,
            snapshot_max_lines: 2500,
            preload_pty_on_startup: true,
            preload_webgl_on_startup: true,
            defer_window_show_until_prepared: true,
            destroy_webview_on_hide: true,
            focus_follows_cursor: false,
            blur_unfocused_panes: false,
            pane_blur_radius: default_pane_blur_radius(),
            dim_unfocused_panes: false,
            focus_pane_scale: true,
            pane_focus_scale_intensity: default_pane_focus_scale_intensity(),
            auto_copy_selection: false,
            shed_workspace_exit: "keep".to_string(),
            always_summon_maximized: false,
            summon_spawn_at_cursor: false,
            cursor_follow_window_move: false,
            cursor_follow_pane_focus: true,
            hidden_from_taskbar: false,
            ui_theme: default_ui_theme(),
            ui_theme_variant: default_ui_theme_variant(),
            font_terminal: String::new(),
            font_ui: String::new(),
            font_file_tree: String::new(),
            file_tree_show_diff_counts: false,
            file_tree_show_git_info: true,
            file_tree_disabled: false,
            file_tree_disable_search: false,
            file_tree_side: default_file_tree_side(),
            confirm_delete_prompt: true,
            ui_disable_tooltips: false,
            terminal_backspace_delete_selection: true,
            always_open_in_zen_mode: false,
            terminal_no_gap: false,
            terminal_pane_gap: default_terminal_pane_gap(),
            terminal_sandbox_padding: default_terminal_sandbox_padding(),
            terminal_no_round: false,
            terminal_no_pane_border: false,
            terminal_no_focus_border: false,
            terminal_animation_speed: default_terminal_animation_speed(),
            terminal_animation_style: default_terminal_animation_style(),
            terminal_window_motion: true,
            split_layout_style: default_split_layout_style(),
            quiet_pane_deferral: false,
            window_effect_mode: default_window_effect_mode(),
            window_effect_opacity: default_window_effect_opacity(),
            pane_corner_radius: default_pane_corner_radius(),
            terminal_cursor_style: default_cursor_style(),
            terminal_cursor_blink: true,
            terminal_cursor_inactive_style: default_cursor_inactive_style(),
            terminal_cursor_width: default_cursor_width(),
            terminal_alt_click_moves_cursor: true,
            terminal_font_size: default_font_size(),
            terminal_font_weight: default_font_weight(),
            terminal_font_weight_bold: default_font_weight_bold(),
            terminal_line_height: default_line_height(),
            terminal_letter_spacing: default_letter_spacing(),
            terminal_draw_bold_bright: true,
            terminal_custom_glyphs: true,
            terminal_smooth_scroll_duration: 0.0,
            terminal_scroll_sensitivity: default_scroll_sensitivity(),
            terminal_fast_scroll_sensitivity: default_fast_scroll_sensitivity(),
            terminal_minimum_contrast_ratio: default_minimum_contrast_ratio(),
            process_notification_threshold: default_process_notification_threshold(),
            process_notification_show_for: default_process_notification_show_for(),
            process_notification_show_ms: false,
            process_notification_transparent: false,
            mouse_hidden: false,
            mouse_hide_on_idle: false,
            mouse_idle_seconds: default_mouse_idle_seconds(),
            dev_perf_enabled: false,
            dev_perf_console: false,
            dev_perf_console_interval_ms: default_dev_perf_console_interval_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PersistedState {
    pub window: WindowState,
    pub prefs: Prefs,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            window: WindowState::default(),
            prefs: Prefs::default(),
        }
    }
}

pub fn state_path() -> Option<PathBuf> {
    let base = dirs::data_local_dir()?;
    let dir = base.join("partty");
    let old_dir = base.join("termie");
    if !dir.exists() && old_dir.exists() {
        let _ = fs::create_dir_all(&dir);
        let old_state = old_dir.join("state.json");
        let new_state = dir.join("state.json");
        if old_state.exists() && !new_state.exists() {
            let _ = fs::copy(old_state, new_state);
        }
        let old_themes = old_dir.join("custom_themes");
        let new_themes = dir.join("custom_themes");
        if old_themes.exists() && !new_themes.exists() {
            let _ = fs::create_dir_all(&new_themes);
            if let Ok(entries) = fs::read_dir(old_themes) {
                for entry in entries.flatten() {
                    let from = entry.path();
                    if from.is_file() {
                        let _ = fs::copy(&from, new_themes.join(entry.file_name()));
                    }
                }
            }
        }
    }
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("state.json"))
}

pub fn load_state() -> PersistedState {
    let Some(path) = state_path() else {
        return PersistedState::default();
    };
    let Ok(s) = fs::read_to_string(&path) else {
        return PersistedState::default();
    };
    let mut v: serde_json::Value = match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(_) => return PersistedState::default(),
    };
    if let Some(prefs) = v.get_mut("prefs") {
        if let Some(obj) = prefs.as_object_mut() {
            if let Some(serde_json::Value::Bool(b)) = obj.remove("shed_workspace_on_exit") {
                obj.insert(
                    "shed_workspace_exit".into(),
                    serde_json::Value::String(if b { "shed".into() } else { "keep".into() }),
                );
            }
            if let Some(serde_json::Value::String(mode)) = obj.get_mut("shed_workspace_exit") {
                let next = match mode.to_lowercase().as_str() {
                    "always" => "shed",
                    "never" => "keep",
                    "ask" => "ask",
                    "shed" => "shed",
                    _ => "keep",
                };
                *mode = next.into();
            }
        }
    }
    serde_json::from_value(v).unwrap_or_default()
}

pub fn save_state(state: &PersistedState) {
    let Some(path) = state_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, bytes);
    }
}

/// Same parent directory as `state.json`, e.g. `%LOCALAPPDATA%/partty/custom_themes/`.
pub fn custom_themes_dir() -> Result<PathBuf, String> {
    let mut p = state_path().ok_or_else(|| "could not resolve app data dir".to_string())?;
    p.pop();
    p.push("custom_themes");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

pub fn validate_custom_theme_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("invalid theme name length".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("theme name: use letters, numbers, dashes, underscores only".into());
    }
    Ok(())
}

/// Presets directory: `%LOCALAPPDATA%/partty/presets/`.
pub fn presets_dir() -> Result<PathBuf, String> {
    let mut p = state_path().ok_or_else(|| "could not resolve app data dir".to_string())?;
    p.pop();
    p.push("presets");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

pub fn validate_preset_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("invalid preset name length".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("preset name: use letters, numbers, dashes, underscores only".into());
    }
    Ok(())
}
