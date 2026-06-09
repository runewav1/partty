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

fn default_confirm_delete_prompt() -> bool {
    true
}

fn default_file_tree_show_git_info() -> bool {
    true
}

fn default_ui_disable_tooltips() -> bool {
    false
}

fn default_terminal_click_to_cursor() -> bool {
    true
}

fn default_terminal_backspace_delete_selection() -> bool {
    true
}

fn default_scrollback_lines() -> u32 {
    1000
}

fn default_command_history_flush_interval_sec() -> f64 {
    0.0
}

fn default_command_history_max_records_per_pane() -> usize {
    2000
}

fn default_command_history_max_output_bytes() -> usize {
    256 * 1024
}

fn default_command_history_exclude_commands() -> Vec<String> {
    [
        "nvim", "vim", "vi", "nano", "emacs", "less", "more", "man", "top", "htop", "btop", "btm",
        "opencode", "lazygit", "tig", "fzf",
    ]
    .into_iter()
    .map(String::from)
    .collect()
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

fn default_terminal_pane_gap() -> f64 {
    6.0
}

fn default_terminal_sandbox_padding() -> f64 {
    0.0
}

fn default_window_effect_mode() -> String {
    "off".to_string()
}

fn default_window_effect_opacity() -> f64 {
    0.0
}

fn default_pane_background_opacity() -> f64 {
    1.0
}

fn default_pane_background_blur() -> f64 {
    0.0
}

fn default_pane_corner_radius() -> f64 {
    6.0
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
    /// Persist shell-integration command history per pane.
    #[serde(default = "default_true")]
    pub command_history_enabled: bool,
    /// Flush pending command history every N seconds while the app is open (0 = disabled).
    #[serde(default = "default_command_history_flush_interval_sec")]
    pub command_history_flush_interval_sec: f64,
    /// Flush pending command history immediately after a command finishes.
    #[serde(default = "default_true")]
    pub command_history_flush_on_command_end: bool,
    /// Max retained command records per pane on disk.
    #[serde(default = "default_command_history_max_records_per_pane")]
    pub command_history_max_records_per_pane: usize,
    /// Capture command stdout/stderr text into history records.
    #[serde(default = "default_true")]
    pub command_history_capture_output: bool,
    /// Max output bytes retained per command record before truncating oldest output.
    #[serde(default = "default_command_history_max_output_bytes")]
    pub command_history_max_output_bytes: usize,
    /// Flush pending command records when the app is dismissed/hidden.
    #[serde(default = "default_true")]
    pub command_history_flush_on_hide: bool,
    /// If non-empty, matching commands are always tracked, even if also excluded.
    #[serde(default)]
    pub command_history_include_commands: Vec<String>,
    /// Commands excluded from history capture/tracking.
    #[serde(default = "default_command_history_exclude_commands")]
    pub command_history_exclude_commands: Vec<String>,
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
    /// Apply a subtle dimming effect to unfocused panes while split.
    #[serde(default)]
    pub dim_unfocused_panes: bool,
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
    /// Windows: hide window from taskbar (tool window style).
    #[serde(default)]
    pub hidden_from_taskbar: bool,
    /// Show git diff +/- counts next to file panel status badges.
    #[serde(default)]
    pub file_tree_show_diff_counts: bool,
    /// Show git info panel at the bottom of the file tree.
    #[serde(default = "default_file_tree_show_git_info")]
    pub file_tree_show_git_info: bool,
    /// Disable the file tree search/filter bar (reclaims vertical space).
    #[serde(default)]
    pub file_tree_disable_search: bool,
    /// Ask for confirmation before deleting items from the file tree.
    #[serde(default = "default_confirm_delete_prompt")]
    pub confirm_delete_prompt: bool,
    /// Disable native hover tooltips in the UI (also forced while in zen mode).
    #[serde(default = "default_ui_disable_tooltips")]
    pub ui_disable_tooltips: bool,
    /// Allow single-click repositioning of cursor on the active prompt line.
    #[serde(default = "default_terminal_click_to_cursor")]
    pub terminal_click_to_cursor: bool,
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
    /// `off` | `fast` | `normal` | `slow` — scales terminal UI animations.
    #[serde(default = "default_terminal_animation_speed")]
    pub terminal_animation_speed: String,
    /// `off` | `transparent` — Tauri window backdrop mode.
    #[serde(default = "default_window_effect_mode")]
    pub window_effect_mode: String,
    /// Reserved alpha value for window backdrop tinting.
    #[serde(default = "default_window_effect_opacity")]
    pub window_effect_opacity: f64,
    /// CSS opacity for terminal pane backgrounds (0 = fully transparent, 1 = opaque).
    #[serde(default = "default_pane_background_opacity")]
    pub pane_background_opacity: f64,
    /// CSS backdrop blur for terminal pane backgrounds in px.
    #[serde(default = "default_pane_background_blur")]
    pub pane_background_blur: f64,
    /// Pane corner radius in px when square panes are disabled.
    #[serde(default = "default_pane_corner_radius")]
    pub pane_corner_radius: f64,
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
            command_history_enabled: true,
            command_history_flush_interval_sec: default_command_history_flush_interval_sec(),
            command_history_flush_on_command_end: true,
            command_history_max_records_per_pane: default_command_history_max_records_per_pane(),
            command_history_capture_output: true,
            command_history_max_output_bytes: default_command_history_max_output_bytes(),
            command_history_flush_on_hide: true,
            command_history_include_commands: Vec::new(),
            command_history_exclude_commands: default_command_history_exclude_commands(),
            snapshot_max_lines: 2500,
            preload_pty_on_startup: true,
            preload_webgl_on_startup: true,
            defer_window_show_until_prepared: true,
            destroy_webview_on_hide: true,
            focus_follows_cursor: false,
            blur_unfocused_panes: false,
            dim_unfocused_panes: false,
            auto_copy_selection: false,
            shed_workspace_exit: "keep".to_string(),
            always_summon_maximized: false,
            summon_spawn_at_cursor: false,
            hidden_from_taskbar: false,
            ui_theme: default_ui_theme(),
            ui_theme_variant: default_ui_theme_variant(),
            font_terminal: String::new(),
            font_ui: String::new(),
            font_file_tree: String::new(),
            file_tree_show_diff_counts: false,
            file_tree_show_git_info: true,
            file_tree_disable_search: false,
            confirm_delete_prompt: true,
            ui_disable_tooltips: false,
            terminal_click_to_cursor: true,
            terminal_backspace_delete_selection: true,
            always_open_in_zen_mode: false,
            terminal_no_gap: false,
            terminal_pane_gap: default_terminal_pane_gap(),
            terminal_sandbox_padding: default_terminal_sandbox_padding(),
            terminal_no_round: false,
            terminal_animation_speed: default_terminal_animation_speed(),
            window_effect_mode: default_window_effect_mode(),
            window_effect_opacity: default_window_effect_opacity(),
            pane_background_opacity: default_pane_background_opacity(),
            pane_background_blur: default_pane_background_blur(),
            pane_corner_radius: default_pane_corner_radius(),
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
