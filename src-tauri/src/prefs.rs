use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// WindowState — stored in ~/.partty/state.json (hidden, for rehydration)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Default helpers (unchanged)
// ---------------------------------------------------------------------------

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

// ===========================================================================
// Prefs — flat, in-memory representation (unchanged field names for IPC compat)
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    pub shell: String,
    pub shed_on_hide: bool,
    pub always_on_top: bool,
    pub initial_cwd: Option<String>,
    #[serde(default = "default_true")]
    pub webgl_shed_on_hide: bool,
    pub discard_buffer_on_hide: bool,
    #[serde(default = "default_scrollback_lines")]
    pub scrollback_lines: u32,
    #[serde(default = "default_snapshot_max_lines")]
    pub snapshot_max_lines: u32,
    #[serde(default = "default_true")]
    pub preload_pty_on_startup: bool,
    #[serde(default = "default_true")]
    pub preload_webgl_on_startup: bool,
    #[serde(default = "default_true")]
    pub defer_window_show_until_prepared: bool,
    #[serde(default = "default_true")]
    pub destroy_webview_on_hide: bool,
    #[serde(default)]
    pub focus_follows_cursor: bool,
    #[serde(default)]
    pub blur_unfocused_panes: bool,
    #[serde(default = "default_pane_blur_radius")]
    pub pane_blur_radius: f64,
    #[serde(default)]
    pub dim_unfocused_panes: bool,
    #[serde(default = "default_true")]
    pub focus_pane_scale: bool,
    #[serde(default = "default_pane_focus_scale_intensity")]
    pub pane_focus_scale_intensity: f64,
    #[serde(default)]
    pub auto_copy_selection: bool,
    #[serde(default)]
    pub shed_workspace_exit: String,
    #[serde(default)]
    pub always_summon_maximized: bool,
    #[serde(default)]
    pub summon_spawn_at_cursor: bool,
    #[serde(default)]
    pub cursor_follow_window_move: bool,
    #[serde(default = "default_true")]
    pub cursor_follow_pane_focus: bool,
    #[serde(default)]
    pub hidden_from_taskbar: bool,
    #[serde(default)]
    pub file_tree_show_diff_counts: bool,
    #[serde(default = "default_file_tree_show_git_info")]
    pub file_tree_show_git_info: bool,
    #[serde(default)]
    pub file_tree_disabled: bool,
    #[serde(default)]
    pub file_tree_disable_search: bool,
    #[serde(default = "default_file_tree_side")]
    pub file_tree_side: String,
    #[serde(default = "default_confirm_delete_prompt")]
    pub confirm_delete_prompt: bool,
    #[serde(default = "default_ui_disable_tooltips")]
    pub ui_disable_tooltips: bool,
    #[serde(default = "default_terminal_backspace_delete_selection")]
    pub terminal_backspace_delete_selection: bool,
    #[serde(default)]
    pub always_open_in_zen_mode: bool,
    #[serde(default)]
    pub terminal_no_gap: bool,
    #[serde(default = "default_terminal_pane_gap")]
    pub terminal_pane_gap: f64,
    #[serde(default = "default_terminal_sandbox_padding")]
    pub terminal_sandbox_padding: f64,
    #[serde(default)]
    pub terminal_no_round: bool,
    #[serde(default)]
    pub terminal_no_pane_border: bool,
    #[serde(default)]
    pub terminal_no_focus_border: bool,
    #[serde(default = "default_terminal_animation_speed")]
    pub terminal_animation_speed: String,
    #[serde(default = "default_terminal_animation_style")]
    pub terminal_animation_style: String,
    #[serde(default = "default_true")]
    pub terminal_window_motion: bool,
    #[serde(default = "default_split_layout_style")]
    pub split_layout_style: String,
    #[serde(default)]
    pub quiet_pane_deferral: bool,
    #[serde(default = "default_window_effect_mode")]
    pub window_effect_mode: String,
    #[serde(default = "default_window_effect_opacity")]
    pub window_effect_opacity: f64,
    #[serde(default = "default_pane_corner_radius")]
    pub pane_corner_radius: f64,
    #[serde(default = "default_cursor_style")]
    pub terminal_cursor_style: String,
    #[serde(default = "default_true")]
    pub terminal_cursor_blink: bool,
    #[serde(default = "default_cursor_inactive_style")]
    pub terminal_cursor_inactive_style: String,
    #[serde(default = "default_cursor_width")]
    pub terminal_cursor_width: f64,
    #[serde(default = "default_true")]
    pub terminal_alt_click_moves_cursor: bool,
    #[serde(default = "default_font_size")]
    pub terminal_font_size: f64,
    #[serde(default = "default_font_weight")]
    pub terminal_font_weight: String,
    #[serde(default = "default_font_weight_bold")]
    pub terminal_font_weight_bold: String,
    #[serde(default = "default_line_height")]
    pub terminal_line_height: f64,
    #[serde(default = "default_letter_spacing")]
    pub terminal_letter_spacing: f64,
    #[serde(default = "default_true")]
    pub terminal_draw_bold_bright: bool,
    #[serde(default = "default_true")]
    pub terminal_custom_glyphs: bool,
    #[serde(default)]
    pub terminal_smooth_scroll_duration: f64,
    #[serde(default = "default_scroll_sensitivity")]
    pub terminal_scroll_sensitivity: f64,
    #[serde(default = "default_fast_scroll_sensitivity")]
    pub terminal_fast_scroll_sensitivity: f64,
    #[serde(default = "default_minimum_contrast_ratio")]
    pub terminal_minimum_contrast_ratio: f64,
    #[serde(default = "default_process_notification_threshold")]
    pub process_notification_threshold: f64,
    #[serde(default = "default_process_notification_show_for")]
    pub process_notification_show_for: f64,
    #[serde(default)]
    pub process_notification_show_ms: bool,
    #[serde(default)]
    pub process_notification_transparent: bool,
    #[serde(default)]
    pub mouse_hidden: bool,
    #[serde(default)]
    pub mouse_hide_on_idle: bool,
    #[serde(default = "default_mouse_idle_seconds")]
    pub mouse_idle_seconds: f64,
    #[serde(default)]
    pub dev_perf_enabled: bool,
    #[serde(default)]
    pub dev_perf_console: bool,
    #[serde(default = "default_dev_perf_console_interval_ms")]
    pub dev_perf_console_interval_ms: u32,
    #[serde(default = "default_ui_theme")]
    pub ui_theme: String,
    #[serde(default = "default_ui_theme_variant")]
    pub ui_theme_variant: String,
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

// ===========================================================================
// ConfigToml — organized TOML sections for disk persistence
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigToml {
    #[serde(default)]
    pub shell: ShellSection,
    #[serde(default)]
    pub cursor: CursorSection,
    #[serde(default)]
    pub font: FontSection,
    #[serde(default)]
    pub scroll: ScrollSection,
    #[serde(default)]
    pub display: DisplaySection,
    #[serde(default)]
    pub pane: PaneSection,
    #[serde(default)]
    pub animation: AnimationSection,
    #[serde(default)]
    pub split: SplitSection,
    #[serde(default)]
    pub window: WindowSection,
    #[serde(default)]
    pub lifecycle: LifecycleSection,
    #[serde(default)]
    pub focus: FocusSection,
    #[serde(default)]
    pub file_tree: FileTreeSection,
    #[serde(default)]
    pub workspace: WorkspaceSection,
    #[serde(default)]
    pub notifications: NotificationsSection,
    #[serde(default)]
    pub mouse: MouseSection,
    #[serde(default)]
    pub ui: UiSection,
    #[serde(default)]
    pub theme: ThemeSection,
    #[serde(default)]
    pub font_terminal: FontFamilySection,
    #[serde(default)]
    pub font_ui: FontFamilySection,
    #[serde(default)]
    pub font_file_tree: FontFamilySection,
    #[serde(default)]
    pub dev: DevSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellSection {
    #[serde(default = "default_shell_command")]
    pub command: String,
    pub initial_dir: Option<String>,
}

fn default_shell_command() -> String {
    "pwsh".to_string()
}

impl Default for ShellSection {
    fn default() -> Self {
        Self {
            command: default_shell_command(),
            initial_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorSection {
    #[serde(default = "default_cursor_style")]
    pub style: String,
    #[serde(default = "default_true")]
    pub blink: bool,
    #[serde(default = "default_cursor_width")]
    pub width: f64,
    #[serde(default = "default_cursor_inactive_style")]
    pub inactive_style: String,
    #[serde(default = "default_true")]
    pub alt_click_moves: bool,
}

impl Default for CursorSection {
    fn default() -> Self {
        Self {
            style: default_cursor_style(),
            blink: true,
            width: default_cursor_width(),
            inactive_style: default_cursor_inactive_style(),
            alt_click_moves: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontSection {
    #[serde(default = "default_font_size")]
    pub size: f64,
    #[serde(default = "default_font_weight")]
    pub weight: String,
    #[serde(default = "default_font_weight_bold")]
    pub weight_bold: String,
    #[serde(default = "default_line_height")]
    pub line_height: f64,
    #[serde(default = "default_letter_spacing")]
    pub letter_spacing: f64,
}

impl Default for FontSection {
    fn default() -> Self {
        Self {
            size: default_font_size(),
            weight: default_font_weight(),
            weight_bold: default_font_weight_bold(),
            line_height: default_line_height(),
            letter_spacing: default_letter_spacing(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrollSection {
    #[serde(default = "default_scrollback_lines")]
    pub backlog: u32,
    #[serde(default = "default_snapshot_max_lines")]
    pub snapshot_max: u32,
    #[serde(default)]
    pub smooth_duration_ms: f64,
    #[serde(default = "default_scroll_sensitivity")]
    pub sensitivity: f64,
    #[serde(default = "default_fast_scroll_sensitivity")]
    pub fast_sensitivity: f64,
}

impl Default for ScrollSection {
    fn default() -> Self {
        Self {
            backlog: default_scrollback_lines(),
            snapshot_max: default_snapshot_max_lines(),
            smooth_duration_ms: 0.0,
            sensitivity: default_scroll_sensitivity(),
            fast_sensitivity: default_fast_scroll_sensitivity(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplaySection {
    #[serde(default = "default_true")]
    pub bright_bold: bool,
    #[serde(default = "default_true")]
    pub custom_glyphs: bool,
    #[serde(default = "default_minimum_contrast_ratio")]
    pub contrast_ratio: f64,
    #[serde(default = "default_terminal_backspace_delete_selection")]
    pub backspace_deletes_selection: bool,
}

impl Default for DisplaySection {
    fn default() -> Self {
        Self {
            bright_bold: true,
            custom_glyphs: true,
            contrast_ratio: default_minimum_contrast_ratio(),
            backspace_deletes_selection: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneSection {
    #[serde(default)]
    pub blur: bool,
    #[serde(default = "default_pane_blur_radius")]
    pub blur_radius: f64,
    #[serde(default)]
    pub dim: bool,
    #[serde(default = "default_true")]
    pub focus_scale: bool,
    #[serde(default = "default_pane_focus_scale_intensity")]
    pub focus_scale_intensity: f64,
    #[serde(default = "default_pane_corner_radius")]
    pub corner_radius: f64,
    #[serde(default = "default_terminal_pane_gap")]
    pub gap: f64,
    #[serde(default = "default_terminal_sandbox_padding")]
    pub padding: f64,
    #[serde(default)]
    pub square: bool,
    #[serde(default)]
    pub no_border: bool,
    #[serde(default)]
    pub no_focus_border: bool,
}

impl Default for PaneSection {
    fn default() -> Self {
        Self {
            blur: false,
            blur_radius: default_pane_blur_radius(),
            dim: false,
            focus_scale: true,
            focus_scale_intensity: default_pane_focus_scale_intensity(),
            corner_radius: default_pane_corner_radius(),
            gap: default_terminal_pane_gap(),
            padding: default_terminal_sandbox_padding(),
            square: false,
            no_border: false,
            no_focus_border: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimationSection {
    #[serde(default = "default_terminal_animation_speed")]
    pub speed: String,
    #[serde(default = "default_terminal_animation_style")]
    pub easing: String,
    #[serde(default = "default_true")]
    pub window_motion: bool,
}

impl Default for AnimationSection {
    fn default() -> Self {
        Self {
            speed: default_terminal_animation_speed(),
            easing: default_terminal_animation_style(),
            window_motion: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitSection {
    #[serde(default = "default_split_layout_style")]
    pub layout: String,
    #[serde(default)]
    pub quiet_defer: bool,
}

impl Default for SplitSection {
    fn default() -> Self {
        Self {
            layout: default_split_layout_style(),
            quiet_defer: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSection {
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub summon_maximized: bool,
    #[serde(default)]
    pub summon_at_cursor: bool,
    #[serde(default)]
    pub hidden_from_taskbar: bool,
    #[serde(default = "default_window_effect_mode")]
    pub effect: String,
    #[serde(default = "default_window_effect_opacity")]
    pub effect_opacity: f64,
}

impl Default for WindowSection {
    fn default() -> Self {
        Self {
            always_on_top: false,
            summon_maximized: false,
            summon_at_cursor: false,
            hidden_from_taskbar: false,
            effect: default_window_effect_mode(),
            effect_opacity: default_window_effect_opacity(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleSection {
    #[serde(default)]
    pub shed_on_hide: bool,
    #[serde(default = "default_true")]
    pub webgl_shed_on_hide: bool,
    #[serde(default)]
    pub discard_buffer: bool,
    #[serde(default = "default_true")]
    pub prewarm_pty: bool,
    #[serde(default = "default_true")]
    pub prewarm_webgl: bool,
    #[serde(default = "default_true")]
    pub defer_show: bool,
    #[serde(default = "default_true")]
    pub destroy_webview: bool,
}

impl Default for LifecycleSection {
    fn default() -> Self {
        Self {
            shed_on_hide: false,
            webgl_shed_on_hide: true,
            discard_buffer: false,
            prewarm_pty: true,
            prewarm_webgl: true,
            defer_show: true,
            destroy_webview: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusSection {
    #[serde(default)]
    pub follows_mouse: bool,
    #[serde(default = "default_true")]
    pub warp_to_pane: bool,
    #[serde(default)]
    pub warp_with_window: bool,
}

impl Default for FocusSection {
    fn default() -> Self {
        Self {
            follows_mouse: false,
            warp_to_pane: true,
            warp_with_window: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeSection {
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub hide_search: bool,
    #[serde(default = "default_file_tree_side")]
    pub side: String,
    #[serde(default)]
    pub diff_counts: bool,
    #[serde(default = "default_file_tree_show_git_info")]
    pub git_info: bool,
    #[serde(default = "default_confirm_delete_prompt")]
    pub confirm_delete: bool,
}

impl Default for FileTreeSection {
    fn default() -> Self {
        Self {
            disabled: false,
            hide_search: false,
            side: default_file_tree_side(),
            diff_counts: false,
            git_info: true,
            confirm_delete: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSection {
    #[serde(default)]
    pub shed_on_exit: String,
    #[serde(default)]
    pub auto_copy: bool,
}

impl Default for WorkspaceSection {
    fn default() -> Self {
        Self {
            shed_on_exit: "keep".to_string(),
            auto_copy: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationsSection {
    #[serde(default = "default_process_notification_threshold")]
    pub command_threshold_secs: f64,
    #[serde(default = "default_process_notification_show_for")]
    pub toast_duration_ms: f64,
    #[serde(default)]
    pub show_milliseconds: bool,
    #[serde(default)]
    pub translucent: bool,
}

impl Default for NotificationsSection {
    fn default() -> Self {
        Self {
            command_threshold_secs: default_process_notification_threshold(),
            toast_duration_ms: default_process_notification_show_for(),
            show_milliseconds: false,
            translucent: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseSection {
    #[serde(default)]
    pub always_hidden: bool,
    #[serde(default)]
    pub hide_on_idle: bool,
    #[serde(default = "default_mouse_idle_seconds")]
    pub idle_timeout_secs: f64,
}

impl Default for MouseSection {
    fn default() -> Self {
        Self {
            always_hidden: false,
            hide_on_idle: false,
            idle_timeout_secs: default_mouse_idle_seconds(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiSection {
    #[serde(default = "default_ui_disable_tooltips")]
    pub hide_tooltips: bool,
    #[serde(default)]
    pub zen_on_start: bool,
}

impl Default for UiSection {
    fn default() -> Self {
        Self {
            hide_tooltips: false,
            zen_on_start: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSection {
    #[serde(default = "default_ui_theme")]
    pub active: String,
    #[serde(default = "default_ui_theme_variant")]
    pub variant: String,
}

impl Default for ThemeSection {
    fn default() -> Self {
        Self {
            active: default_ui_theme(),
            variant: default_ui_theme_variant(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontFamilySection {
    #[serde(default)]
    pub family: String,
}

impl Default for FontFamilySection {
    fn default() -> Self {
        Self {
            family: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DevSection {
    #[serde(default)]
    pub perf: DevPerfSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevPerfSection {
    #[serde(default)]
    pub enable: bool,
    #[serde(default)]
    pub console: bool,
    #[serde(default = "default_dev_perf_console_interval_ms")]
    pub console_interval_ms: u32,
}

impl Default for DevPerfSection {
    fn default() -> Self {
        Self {
            enable: false,
            console: false,
            console_interval_ms: default_dev_perf_console_interval_ms(),
        }
    }
}

// ===========================================================================
// Conversions between flat Prefs (IPC) and organized ConfigToml (disk)
// ===========================================================================

impl From<ConfigToml> for Prefs {
    fn from(c: ConfigToml) -> Self {
        Self {
            shell: c.shell.command,
            initial_cwd: c.shell.initial_dir,
            terminal_cursor_style: c.cursor.style,
            terminal_cursor_blink: c.cursor.blink,
            terminal_cursor_width: c.cursor.width,
            terminal_cursor_inactive_style: c.cursor.inactive_style,
            terminal_alt_click_moves_cursor: c.cursor.alt_click_moves,
            terminal_font_size: c.font.size,
            terminal_font_weight: c.font.weight,
            terminal_font_weight_bold: c.font.weight_bold,
            terminal_line_height: c.font.line_height,
            terminal_letter_spacing: c.font.letter_spacing,
            scrollback_lines: c.scroll.backlog,
            snapshot_max_lines: c.scroll.snapshot_max,
            terminal_smooth_scroll_duration: c.scroll.smooth_duration_ms,
            terminal_scroll_sensitivity: c.scroll.sensitivity,
            terminal_fast_scroll_sensitivity: c.scroll.fast_sensitivity,
            terminal_draw_bold_bright: c.display.bright_bold,
            terminal_custom_glyphs: c.display.custom_glyphs,
            terminal_minimum_contrast_ratio: c.display.contrast_ratio,
            terminal_backspace_delete_selection: c.display.backspace_deletes_selection,
            blur_unfocused_panes: c.pane.blur,
            pane_blur_radius: c.pane.blur_radius,
            dim_unfocused_panes: c.pane.dim,
            focus_pane_scale: c.pane.focus_scale,
            pane_focus_scale_intensity: c.pane.focus_scale_intensity,
            pane_corner_radius: c.pane.corner_radius,
            terminal_pane_gap: c.pane.gap,
            terminal_sandbox_padding: c.pane.padding,
            terminal_no_gap: c.pane.gap <= 0.0 && c.pane.square,
            terminal_no_round: c.pane.square,
            terminal_no_pane_border: c.pane.no_border,
            terminal_no_focus_border: c.pane.no_focus_border,
            terminal_animation_speed: c.animation.speed,
            terminal_animation_style: c.animation.easing,
            terminal_window_motion: c.animation.window_motion,
            split_layout_style: c.split.layout,
            quiet_pane_deferral: c.split.quiet_defer,
            always_on_top: c.window.always_on_top,
            always_summon_maximized: c.window.summon_maximized,
            summon_spawn_at_cursor: c.window.summon_at_cursor,
            hidden_from_taskbar: c.window.hidden_from_taskbar,
            window_effect_mode: c.window.effect,
            window_effect_opacity: c.window.effect_opacity,
            shed_on_hide: c.lifecycle.shed_on_hide,
            webgl_shed_on_hide: c.lifecycle.webgl_shed_on_hide,
            discard_buffer_on_hide: c.lifecycle.discard_buffer,
            preload_pty_on_startup: c.lifecycle.prewarm_pty,
            preload_webgl_on_startup: c.lifecycle.prewarm_webgl,
            defer_window_show_until_prepared: c.lifecycle.defer_show,
            destroy_webview_on_hide: c.lifecycle.destroy_webview,
            focus_follows_cursor: c.focus.follows_mouse,
            cursor_follow_pane_focus: c.focus.warp_to_pane,
            cursor_follow_window_move: c.focus.warp_with_window,
            file_tree_disabled: c.file_tree.disabled,
            file_tree_disable_search: c.file_tree.hide_search,
            file_tree_side: c.file_tree.side,
            file_tree_show_diff_counts: c.file_tree.diff_counts,
            file_tree_show_git_info: c.file_tree.git_info,
            confirm_delete_prompt: c.file_tree.confirm_delete,
            shed_workspace_exit: c.workspace.shed_on_exit,
            auto_copy_selection: c.workspace.auto_copy,
            process_notification_threshold: c.notifications.command_threshold_secs,
            process_notification_show_for: c.notifications.toast_duration_ms,
            process_notification_show_ms: c.notifications.show_milliseconds,
            process_notification_transparent: c.notifications.translucent,
            mouse_hidden: c.mouse.always_hidden,
            mouse_hide_on_idle: c.mouse.hide_on_idle,
            mouse_idle_seconds: c.mouse.idle_timeout_secs,
            ui_disable_tooltips: c.ui.hide_tooltips,
            always_open_in_zen_mode: c.ui.zen_on_start,
            ui_theme: c.theme.active,
            ui_theme_variant: c.theme.variant,
            font_terminal: c.font_terminal.family,
            font_ui: c.font_ui.family,
            font_file_tree: c.font_file_tree.family,
            dev_perf_enabled: c.dev.perf.enable,
            dev_perf_console: c.dev.perf.console,
            dev_perf_console_interval_ms: c.dev.perf.console_interval_ms,
        }
    }
}

impl From<&Prefs> for ConfigToml {
    fn from(p: &Prefs) -> Self {
        Self {
            shell: ShellSection {
                command: p.shell.clone(),
                initial_dir: p.initial_cwd.clone(),
            },
            cursor: CursorSection {
                style: p.terminal_cursor_style.clone(),
                blink: p.terminal_cursor_blink,
                width: p.terminal_cursor_width,
                inactive_style: p.terminal_cursor_inactive_style.clone(),
                alt_click_moves: p.terminal_alt_click_moves_cursor,
            },
            font: FontSection {
                size: p.terminal_font_size,
                weight: p.terminal_font_weight.clone(),
                weight_bold: p.terminal_font_weight_bold.clone(),
                line_height: p.terminal_line_height,
                letter_spacing: p.terminal_letter_spacing,
            },
            scroll: ScrollSection {
                backlog: p.scrollback_lines,
                snapshot_max: p.snapshot_max_lines,
                smooth_duration_ms: p.terminal_smooth_scroll_duration,
                sensitivity: p.terminal_scroll_sensitivity,
                fast_sensitivity: p.terminal_fast_scroll_sensitivity,
            },
            display: DisplaySection {
                bright_bold: p.terminal_draw_bold_bright,
                custom_glyphs: p.terminal_custom_glyphs,
                contrast_ratio: p.terminal_minimum_contrast_ratio,
                backspace_deletes_selection: p.terminal_backspace_delete_selection,
            },
            pane: PaneSection {
                blur: p.blur_unfocused_panes,
                blur_radius: p.pane_blur_radius,
                dim: p.dim_unfocused_panes,
                focus_scale: p.focus_pane_scale,
                focus_scale_intensity: p.pane_focus_scale_intensity,
                corner_radius: p.pane_corner_radius,
                gap: p.terminal_pane_gap,
                padding: p.terminal_sandbox_padding,
                square: p.terminal_no_round,
                no_border: p.terminal_no_pane_border,
                no_focus_border: p.terminal_no_focus_border,
            },
            animation: AnimationSection {
                speed: p.terminal_animation_speed.clone(),
                easing: p.terminal_animation_style.clone(),
                window_motion: p.terminal_window_motion,
            },
            split: SplitSection {
                layout: p.split_layout_style.clone(),
                quiet_defer: p.quiet_pane_deferral,
            },
            window: WindowSection {
                always_on_top: p.always_on_top,
                summon_maximized: p.always_summon_maximized,
                summon_at_cursor: p.summon_spawn_at_cursor,
                hidden_from_taskbar: p.hidden_from_taskbar,
                effect: p.window_effect_mode.clone(),
                effect_opacity: p.window_effect_opacity,
            },
            lifecycle: LifecycleSection {
                shed_on_hide: p.shed_on_hide,
                webgl_shed_on_hide: p.webgl_shed_on_hide,
                discard_buffer: p.discard_buffer_on_hide,
                prewarm_pty: p.preload_pty_on_startup,
                prewarm_webgl: p.preload_webgl_on_startup,
                defer_show: p.defer_window_show_until_prepared,
                destroy_webview: p.destroy_webview_on_hide,
            },
            focus: FocusSection {
                follows_mouse: p.focus_follows_cursor,
                warp_to_pane: p.cursor_follow_pane_focus,
                warp_with_window: p.cursor_follow_window_move,
            },
            file_tree: FileTreeSection {
                disabled: p.file_tree_disabled,
                hide_search: p.file_tree_disable_search,
                side: p.file_tree_side.clone(),
                diff_counts: p.file_tree_show_diff_counts,
                git_info: p.file_tree_show_git_info,
                confirm_delete: p.confirm_delete_prompt,
            },
            workspace: WorkspaceSection {
                shed_on_exit: p.shed_workspace_exit.clone(),
                auto_copy: p.auto_copy_selection,
            },
            notifications: NotificationsSection {
                command_threshold_secs: p.process_notification_threshold,
                toast_duration_ms: p.process_notification_show_for,
                show_milliseconds: p.process_notification_show_ms,
                translucent: p.process_notification_transparent,
            },
            mouse: MouseSection {
                always_hidden: p.mouse_hidden,
                hide_on_idle: p.mouse_hide_on_idle,
                idle_timeout_secs: p.mouse_idle_seconds,
            },
            ui: UiSection {
                hide_tooltips: p.ui_disable_tooltips,
                zen_on_start: p.always_open_in_zen_mode,
            },
            theme: ThemeSection {
                active: p.ui_theme.clone(),
                variant: p.ui_theme_variant.clone(),
            },
            font_terminal: FontFamilySection {
                family: p.font_terminal.clone(),
            },
            font_ui: FontFamilySection {
                family: p.font_ui.clone(),
            },
            font_file_tree: FontFamilySection {
                family: p.font_file_tree.clone(),
            },
            dev: DevSection {
                perf: DevPerfSection {
                    enable: p.dev_perf_enabled,
                    console: p.dev_perf_console,
                    console_interval_ms: p.dev_perf_console_interval_ms,
                },
            },
        }
    }
}

// ===========================================================================
// PersistedState — convenience wrapper returned to frontend over IPC
// ===========================================================================

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

// ===========================================================================
// Paths — ~/.partty/
// ===========================================================================

fn config_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".partty"))
}

fn ensure_config_dir() -> Option<PathBuf> {
    let dir = config_dir()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

pub fn state_path() -> Option<PathBuf> {
    let dir = ensure_config_dir()?;
    Some(dir.join("state.json"))
}

fn config_toml_path() -> Option<PathBuf> {
    let dir = ensure_config_dir()?;
    Some(dir.join("config.toml"))
}

// ===========================================================================
// Load / Save
// ===========================================================================

pub fn load_window_state() -> WindowState {
    let Some(path) = state_path() else {
        return WindowState::default();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_window_state(ws: &WindowState) {
    let Some(path) = state_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_string_pretty(ws) {
        let _ = fs::write(path, bytes);
    }
}

pub fn load_prefs() -> Prefs {
    let Some(path) = config_toml_path() else {
        return Prefs::default();
    };
    let Ok(s) = fs::read_to_string(&path) else {
        return Prefs::default();
    };
    let config: ConfigToml = toml::from_str(&s).unwrap_or_default();
    config.into()
}

pub fn save_prefs(prefs: &Prefs) {
    let Some(path) = config_toml_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let config = ConfigToml::from(prefs);
    if let Ok(bytes) = toml::to_string_pretty(&config) {
        let _ = fs::write(path, bytes);
    }
}

pub fn load_persisted() -> PersistedState {
    PersistedState {
        window: load_window_state(),
        prefs: load_prefs(),
    }
}

pub fn save_state(ws: &WindowState) {
    save_window_state(ws);
}

// ===========================================================================
// Subdirectory helpers — under ~/.partty/
// ===========================================================================

pub fn custom_themes_dir() -> Result<PathBuf, String> {
    let dir = ensure_config_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join("themes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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

pub fn presets_dir() -> Result<PathBuf, String> {
    let dir = ensure_config_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join("presets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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

/// Extension state path (still JSON, one file for all extension toggles).
pub fn extension_state_path() -> Option<PathBuf> {
    let dir = ensure_config_dir()?;
    Some(dir.join("extension_state.json"))
}

/// Palette commands path.
pub fn palette_commands_path() -> Option<PathBuf> {
    let dir = ensure_config_dir()?;
    Some(dir.join("palette_commands.json"))
}

/// Extensions directory.
pub fn extensions_dir() -> Option<PathBuf> {
    let dir = ensure_config_dir()?;
    Some(dir.join("extensions"))
}
