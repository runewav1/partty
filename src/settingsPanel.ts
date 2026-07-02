import { invoke } from "@tauri-apps/api/core";
import { mouseCursorForceVisible } from "./mouseCursor";

/** Mirrors `prefs::Prefs` JSON (snake_case). */
export type ParttyPrefs = {
  shell: string;
  shed_on_hide: boolean;
  always_on_top: boolean;
  initial_cwd: string | null;
  webgl_shed_on_hide: boolean;
  discard_buffer_on_hide: boolean;
  scrollback_lines: number;
  snapshot_max_lines: number;
  preload_pty_on_startup: boolean;
  preload_webgl_on_startup: boolean;
  defer_window_show_until_prepared: boolean;
  destroy_webview_on_hide: boolean;
  focus_follows_cursor: boolean;
  blur_unfocused_panes: boolean;
  /** Blur radius in px for unfocused split panes (default 1.6). */
  pane_blur_radius?: number;
  pane_opacity_focused?: number;
  pane_opacity_unfocused?: number;
  pane_variable_opacity?: boolean;
  /** Slight scale emphasis on the focused split pane. */
  focus_pane_scale?: boolean;
  /** Focus scale intensity 0–1 (default 0.45). */
  pane_focus_scale_intensity?: number;
  auto_copy_selection: boolean;
  ui_theme: string;
  ui_theme_variant: string;
  font_terminal: string;
  font_ui: string;
  font_file_tree: string;
  shed_workspace_exit: string;
  always_summon_maximized: boolean;
  summon_spawn_at_cursor: boolean;
  cursor_follow_window_move: boolean;
  /** Warp OS cursor onto the focused pane when focus context changes. */
  cursor_follow_pane_focus?: boolean;
  hidden_from_taskbar: boolean;
  file_tree_show_diff_counts: boolean;
  file_tree_show_git_info: boolean;
  file_tree_disabled: boolean;
  file_tree_disable_search: boolean;
  file_tree_side: string;
  confirm_delete_prompt: boolean;
  ui_disable_tooltips: boolean;
  terminal_backspace_delete_selection: boolean;
  always_open_in_zen_mode: boolean;
  terminal_no_gap: boolean;
  terminal_pane_gap: number;
  terminal_sandbox_padding: number;
  terminal_no_round: boolean;
  terminal_no_pane_border: boolean;
  terminal_no_focus_border: boolean;
  split_layout_style: string;
  quiet_pane_deferral: boolean;
  terminal_animation_speed: string;
  terminal_animation_style: string;
  terminal_window_motion: boolean;
  window_effect_mode: string;
  window_effect_opacity: number;
  pane_corner_radius: number;
  /** `block` | `underline` | `bar` — terminal cursor style. */
  terminal_cursor_style: string;
  /** Whether the cursor blinks. */
  terminal_cursor_blink?: boolean;
  /** `outline` | `block` | `bar` | `underline` | `none` — cursor style when unfocused. */
  terminal_cursor_inactive_style?: string;
  /** Cursor width in px when cursor_style is `bar`. */
  terminal_cursor_width?: number;
  /** Alt+click repositions the terminal cursor to the click position. */
  terminal_alt_click_moves_cursor?: boolean;
  /** Terminal font size in px. */
  terminal_font_size?: number;
  /** Font weight for non‑bold text (CSS value). */
  terminal_font_weight?: string;
  /** Font weight for bold text (CSS value). */
  terminal_font_weight_bold?: string;
  /** Line height multiplier. */
  terminal_line_height?: number;
  /** Letter spacing in px. */
  terminal_letter_spacing?: number;
  /** Draw bold text in bright ANSI colors. */
  terminal_draw_bold_bright?: boolean;
  /** Draw box‑drawing characters with custom glyphs instead of font. */
  terminal_custom_glyphs?: boolean;
  /** Smooth‑scroll duration in ms (0 = instant). */
  terminal_smooth_scroll_duration?: number;
  /** Normal scroll speed multiplier. */
  terminal_scroll_sensitivity?: number;
  /** Fast (Alt+wheel) scroll speed multiplier. */
  terminal_fast_scroll_sensitivity?: number;
  /** Minimum seconds a command must run before a completion toast is shown (default 5.0). */
  process_notification_threshold: number;
  /** How long the toast stays visible in ms (default 5000, min 1000, max 30000). */
  process_notification_show_for: number;
  /** Show millisecond precision in completion toasts. */
  process_notification_show_ms?: boolean;
  /** Use translucent process completion toasts. */
  process_notification_transparent?: boolean;
  /** Always hide the OS mouse cursor (overrides idle hide). */
  mouse_hidden?: boolean;
  /** Hide the OS mouse cursor after pointer inactivity. */
  mouse_hide_on_idle?: boolean;
  /** Seconds before idle hide (default 3). */
  mouse_idle_seconds?: number;
  /** Developer metrics collection. Off by default. */
  dev_perf_enabled?: boolean;
  /** Print metrics snapshots to the console while enabled. */
  dev_perf_console?: boolean;
  /** Console snapshot interval in ms. */
  dev_perf_console_interval_ms?: number;
};

type DetectedShell = { name: string; path: string };
type Persisted = { window: Record<string, unknown>; prefs: ParttyPrefs };
type LocalFontDescriptor = { family: string; fullName?: string; postscriptName?: string };

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontDescriptor[]>;
  }
}

export type SettingsPanelApi = { open(): void; close(): void; isOpen(): boolean };

const FALLBACK_FONT_FAMILIES = [
  "JetBrains Mono", "Cascadia Code", "Cascadia Mono", "Consolas", "Fira Code",
  "Hack", "Iosevka", "IBM Plex Mono", "Segoe UI", "Inter", "Arial", "system-ui",
];

async function discoverFontFamilies(): Promise<string[]> {
  const families = new Set<string>(FALLBACK_FONT_FAMILIES);
  try {
    const fonts = await window.queryLocalFonts?.();
    for (const font of fonts ?? []) {
      const family = font.family?.trim();
      if (family) families.add(family);
    }
  } catch { /* fallback ok */ }
  return [...families].sort((a, b) => a.localeCompare(b));
}

export function createSettingsPanel(
  root: HTMLElement,
  onSaved?: (next: ParttyPrefs, previous: ParttyPrefs) => void | Promise<void>,
): SettingsPanelApi {
  let open = false;
  let saving = false;

  const form = root.querySelector("#settings-form") as HTMLFormElement | null;

  function g(n: string): string {
    return ((form?.querySelector(`[name="${n}"]`) as HTMLInputElement)?.value ?? "").trim();
  }
  function gc(n: string): boolean {
    return (form?.querySelector(`[name="${n}"]`) as HTMLInputElement)?.checked ?? false;
  }
  function gs(n: string): string {
    return ((form?.querySelector(`[name="${n}"]`) as HTMLSelectElement)?.value ?? "").toLowerCase();
  }

  async function buildPrefs(previous: ParttyPrefs): Promise<ParttyPrefs> {
    const cwd = g("initial_cwd");
    const shed_workspace_exit = ((v: string) => v === "shed" || v === "ask" ? v : "keep")(gs("shed_workspace_exit"));
    const terminal_animation_speed = ((v: string) => v === "off" || v === "fast" || v === "slow" ? v : "normal")(gs("terminal_animation_speed"));
    const terminal_animation_style = ((v: string) => v === "snappy" || v === "gentle" || v === "bouncy" ? v : "smooth")(gs("terminal_animation_style"));
    const split_layout_style = ((v: string) => v === "dwindle" || v === "master" ? v : "balanced")(gs("split_layout_style"));
    const window_effect_mode = gs("window_effect_mode").replace(/-/g, "_") === "transparent" ? "transparent" : "off";
    const clamp01 = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fb; };
    const clampR = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(32, n)) : fb; };
    const clampG = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(32, n)) : fb; };
    const clampf = (raw: string, fb: number, min: number, max: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; };
    const clamp1p = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : fb; };
    const terminal_pane_gap = clampG(g("terminal_pane_gap"), previous.terminal_pane_gap ?? 6);
    const terminal_sandbox_padding = clampG(g("terminal_sandbox_padding"), previous.terminal_sandbox_padding ?? 0);

    return {
      shell: g("shell") || "pwsh", shed_on_hide: gc("shed_on_hide"), always_on_top: gc("always_on_top"),
      initial_cwd: cwd || null, webgl_shed_on_hide: gc("webgl_shed_on_hide"), discard_buffer_on_hide: gc("discard_buffer_on_hide"),
      scrollback_lines: Math.max(0, Math.min(50000, parseInt(g("scrollback_lines"), 10) || 0)),
      snapshot_max_lines: Math.max(50, Math.min(50000, parseInt(g("snapshot_max_lines"), 10) || 2500)),
      preload_pty_on_startup: gc("preload_pty_on_startup"), preload_webgl_on_startup: gc("preload_webgl_on_startup"),
      defer_window_show_until_prepared: gc("defer_window_show_until_prepared"),
      destroy_webview_on_hide: gc("destroy_webview_on_hide"), focus_follows_cursor: gc("focus_follows_cursor"),
      blur_unfocused_panes: gc("blur_unfocused_panes"), pane_blur_radius: clampf(g("pane_blur_radius"), 1.6, 0, 10),
      pane_opacity_focused: clamp01(g("pane_opacity_focused"), 1.0),
      pane_opacity_unfocused: clamp01(g("pane_opacity_unfocused"), 1.0),
      pane_variable_opacity: gc("pane_variable_opacity"),
      focus_pane_scale: gc("focus_pane_scale"), pane_focus_scale_intensity: clampf(g("pane_focus_scale_intensity"), 0.45, 0, 1),
      auto_copy_selection: gc("auto_copy_selection"), shed_workspace_exit,
      always_summon_maximized: gc("always_summon_maximized"), summon_spawn_at_cursor: gc("summon_spawn_at_cursor"),
      cursor_follow_window_move: gc("cursor_follow_window_move"),
      cursor_follow_pane_focus: gc("cursor_follow_pane_focus"),
      hidden_from_taskbar: gc("hidden_from_taskbar"),
      ui_theme: previous.ui_theme, ui_theme_variant: previous.ui_theme_variant,
      font_terminal: g("font_terminal"), font_ui: g("font_ui"), font_file_tree: g("font_file_tree"),
      file_tree_show_diff_counts: gc("file_tree_show_diff_counts"), file_tree_show_git_info: gc("file_tree_show_git_info"),
      file_tree_disabled: gc("file_tree_disabled"),
      file_tree_disable_search: gc("file_tree_disable_search"),
      file_tree_side: gs("file_tree_side") === "right" ? "right" : "left",
      confirm_delete_prompt: gc("confirm_delete_prompt"), ui_disable_tooltips: gc("ui_disable_tooltips"),
      terminal_alt_click_moves_cursor: gc("terminal_alt_click_moves_cursor"), terminal_backspace_delete_selection: gc("terminal_backspace_delete_selection"),
      always_open_in_zen_mode: gc("always_open_in_zen_mode"),
      terminal_no_gap: terminal_pane_gap <= 0, terminal_pane_gap, terminal_sandbox_padding,
      terminal_no_round: gc("terminal_no_round"), terminal_no_pane_border: gc("terminal_no_pane_border"),
      terminal_no_focus_border: gc("terminal_no_focus_border"), split_layout_style,
      quiet_pane_deferral: gc("quiet_pane_deferral"), terminal_animation_speed,
      terminal_animation_style, terminal_window_motion: gc("terminal_window_motion"),
      window_effect_mode, window_effect_opacity: clamp01(g("window_effect_opacity"), 0),
      pane_corner_radius: clampR(g("pane_corner_radius"), 6),

      terminal_cursor_style: ((v: string) => v === "underline" || v === "bar" ? v : "block")(gs("terminal_cursor_style")),
      terminal_cursor_blink: gc("terminal_cursor_blink"),
      terminal_cursor_inactive_style: gs("terminal_cursor_inactive_style"),
      terminal_cursor_width: clamp1p(g("terminal_cursor_width"), 1),
      terminal_font_size: clampf(g("terminal_font_size"), 12, 8, 48),
      terminal_font_weight: g("terminal_font_weight") || "normal",
      terminal_font_weight_bold: g("terminal_font_weight_bold") || "bold",
      terminal_line_height: clampf(g("terminal_line_height"), 1, 0.5, 4),
      terminal_letter_spacing: clampf(g("terminal_letter_spacing"), 0, -2, 10),
      terminal_draw_bold_bright: gc("terminal_draw_bold_bright"),
      terminal_custom_glyphs: gc("terminal_custom_glyphs"),
      terminal_smooth_scroll_duration: clampf(g("terminal_smooth_scroll_duration"), 0, 0, 1000),
      terminal_scroll_sensitivity: clampf(g("terminal_scroll_sensitivity"), 1, 0.1, 10),
      terminal_fast_scroll_sensitivity: clampf(g("terminal_fast_scroll_sensitivity"), 5, 1, 50),
      process_notification_threshold: ((): number => {
        const raw = g("process_notification_threshold");
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? Math.max(0.1, n) : 5.0;
      })(),
      process_notification_show_for: ((): number => {
        const raw = g("process_notification_show_for");
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? Math.max(1000, Math.min(30000, n)) : 5000;
      })(),
      process_notification_show_ms: gc("process_notification_show_ms"),
      process_notification_transparent: gc("process_notification_transparent"),
      mouse_hidden: gc("mouse_hidden"),
      mouse_hide_on_idle: gc("mouse_hide_on_idle"),
      mouse_idle_seconds: clampf(g("mouse_idle_seconds"), 3, 0.5, 300),
      dev_perf_enabled: gc("dev_perf_enabled"),
      dev_perf_console: gc("dev_perf_console"),
      dev_perf_console_interval_ms: Math.max(1000, Math.min(60000, parseInt(g("dev_perf_console_interval_ms"), 10) || 5000)),
    };
  }

  async function doSave(): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      const data = await invoke<Persisted>("get_persisted_state");
      const previous = { ...(data.prefs as ParttyPrefs) };
      const next = await buildPrefs(previous);
      const merged = { ...previous, ...next };
      await invoke("set_prefs", { prefs: merged });
      await onSaved?.(merged, previous);
    } catch (err) {
      console.error("set_prefs", err);
    } finally {
      saving = false;
    }
    // Dev tree: console snapshots are only meaningful when metrics are enabled.
    {
      const perfEnabledEl = form?.querySelector('[name="dev_perf_enabled"]') as HTMLInputElement | null;
      const perfEnabled = perfEnabledEl?.checked ?? false;
      root.querySelectorAll('[data-child-of="dev_perf_enabled"]').forEach((r) => {
        (r as HTMLElement).classList.toggle("settings-tree-hidden", !perfEnabled);
      });
    }
  }

  function applySettingsTree(): void {
    // Mouse: idle options are inactive while "hide mouse" is on.
    {
      const mouseHiddenEl = form?.querySelector('[name="mouse_hidden"]') as HTMLInputElement | null;
      const mouseHidden = mouseHiddenEl?.checked ?? false;
      root.querySelectorAll('[data-child-of="mouse_hidden"]').forEach((r) => {
        (r as HTMLElement).classList.toggle("settings-tree-hidden", mouseHidden);
      });
      const hideOnIdleEl = form?.querySelector('[name="mouse_hide_on_idle"]') as HTMLInputElement | null;
      const hideOnIdle = hideOnIdleEl?.checked ?? false;
      root.querySelectorAll('[data-child-of="mouse_hide_on_idle"]').forEach((r) => {
        (r as HTMLElement).classList.toggle("settings-tree-hidden", !hideOnIdle || mouseHidden);
      });
    }
    // File search tree: dim git-aware when search is hidden
    {
      const panelDisabledEl = form?.querySelector('[name="file_tree_disabled"]') as HTMLInputElement | null;
      const panelDisabled = panelDisabledEl?.checked ?? false;
      root.querySelectorAll('[data-child-of="file_tree_disabled"]').forEach((r) => {
        (r as HTMLElement).classList.toggle("settings-tree-hidden", panelDisabled);
      });
      const parentEl = form?.querySelector('[name="file_tree_disable_search"]') as HTMLInputElement | null;
      const hidden = parentEl?.checked ?? false;
      const children = root.querySelectorAll('[data-child-of="file_tree_disable_search"]');
      children.forEach((r) => (r as HTMLElement).classList.toggle("settings-tree-hidden", hidden));
    }
    // Variable opacity: sub-options dimmed when toggle is off.
    {
      const toggleEl = form?.querySelector('[name="pane_variable_opacity"]') as HTMLInputElement | null;
      const enabled = toggleEl?.checked ?? false;
      root.querySelectorAll('[data-child-of="pane_variable_opacity"]').forEach((r) => {
        (r as HTMLElement).classList.toggle("settings-tree-hidden", !enabled);
      });
    }
  }

  function applySettingsSearch(): void {
    const input = root.querySelector("#settings-search") as HTMLInputElement | null;
    const q = input?.value.trim().toLowerCase() ?? "";
    const sections = root.querySelectorAll<HTMLElement>(".settings-section");
    for (const section of sections) {
      const title = section.querySelector(".settings-section-hd")?.textContent?.toLowerCase() ?? "";
      const titleMatch = q.length > 0 && title.includes(q);
      let anyVisible = q.length === 0;
      const rows = section.querySelectorAll<HTMLElement>(".settings-row, .settings-checkbox-label");
      for (const row of rows) {
        if (row.closest(".settings-tree-hidden")) {
          (row as HTMLElement).hidden = true;
          continue;
        }
        const controls = [...row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
          .map((el) => `${el.name ?? ""} ${el.id ?? ""} ${"placeholder" in el ? (el as HTMLInputElement).placeholder : ""}`)
          .join(" ");
        const text = `${row.textContent ?? ""} ${controls}`.toLowerCase().replace(/[_-]/g, " ");
        const visible = q.length === 0 || titleMatch || text.includes(q);
        (row as HTMLElement).hidden = !visible;
        if (visible) anyVisible = true;
      }
      section.hidden = !anyVisible;
      // Auto-expand sections that have matching content or title when searching
      if (q.length > 0 && anyVisible) {
        section.classList.add("settings-section--open");
      } else if (q.length === 0) {
        section.classList.remove("settings-section--open");
      }
    }
  }

  async function loadAndRender(): Promise<void> {
    const data = await invoke<Persisted>("get_persisted_state");
    const p = data.prefs;
    if (!form) return;
    const pr = p as Partial<ParttyPrefs>;

    const shellInput = form.querySelector("#setting-shell") as HTMLInputElement;
    const shellDatalist = form.querySelector("#shell-suggestions") as HTMLDataListElement;
    shellDatalist.innerHTML = "";
    try {
      const shells = await invoke<DetectedShell[]>("detect_shells");
      const seen = new Set<string>();
      for (const s of shells) {
        const key = s.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const opt = document.createElement("option"); opt.value = s.name; opt.label = s.path;
        shellDatalist.appendChild(opt);
      }
    } catch { /* ok */ }
    shellInput.value = p.shell;

    const fontDatalist = form.querySelector("#font-suggestions") as HTMLDataListElement | null;
    if (fontDatalist) {
      fontDatalist.innerHTML = "";
      for (const family of await discoverFontFamilies()) {
        const opt = document.createElement("option"); opt.value = family; fontDatalist.appendChild(opt);
      }
    }

    const setVal = (n: string, v: string) => { const el = form.querySelector(`[name="${n}"]`) as HTMLInputElement | null; if (el) el.value = v; };
    const setChk = (n: keyof ParttyPrefs, v: boolean) => { const el = form.querySelector(`[name="${n}"]`) as HTMLInputElement | null; if (el) el.checked = v; };
    const setSel = (n: string, v: string) => { const el = form.querySelector(`[name="${n}"]`) as HTMLSelectElement | null; if (el) el.value = v; };

    setVal("initial_cwd", p.initial_cwd ?? "");
    setVal("font_terminal", pr.font_terminal ?? "");
    setVal("font_ui", pr.font_ui ?? "");
    setVal("font_file_tree", pr.font_file_tree ?? "");
    setVal("scrollback_lines", String(p.scrollback_lines));
    setVal("snapshot_max_lines", String(p.snapshot_max_lines));
    setVal("window_effect_opacity", String(pr.window_effect_opacity ?? 0));
    setVal("window_effect_opacity", String(pr.window_effect_opacity ?? 0));
    setVal("pane_corner_radius", String(pr.pane_corner_radius ?? 6));
    setVal("terminal_pane_gap", String(pr.terminal_pane_gap ?? (pr.terminal_no_gap ? 0 : 6)));
    setVal("terminal_sandbox_padding", String(pr.terminal_sandbox_padding ?? 0));

    setSel("shed_workspace_exit", ((v?: string) => { v = (v ?? "keep").toLowerCase(); return v === "shed" ? "shed" : v === "ask" ? "ask" : "keep"; })(pr.shed_workspace_exit));
    setSel("terminal_animation_speed", ((v?: string) => { v = (v ?? "normal").toLowerCase(); return v === "off" || v === "fast" || v === "slow" ? v : "normal"; })(pr.terminal_animation_speed));
    setSel("terminal_animation_style", ((v?: string) => { v = (v ?? "smooth").toLowerCase(); return v === "snappy" || v === "gentle" || v === "bouncy" ? v : "smooth"; })(pr.terminal_animation_style));
    setChk("terminal_window_motion", pr.terminal_window_motion ?? true);
    setSel("window_effect_mode", (pr.window_effect_mode ?? "off").toLowerCase() === "transparent" ? "transparent" : "off");
    setSel("file_tree_side", pr.file_tree_side === "right" ? "right" : "left");

    setSel("terminal_cursor_style", ((v?: string) => v === "underline" || v === "bar" ? v : "block")(pr.terminal_cursor_style));
    setChk("terminal_cursor_blink", pr.terminal_cursor_blink ?? true);
    setSel("terminal_cursor_inactive_style", ((v?: string) => (v === "outline" || v === "block" || v === "bar" || v === "underline" || v === "none") ? v : "outline")(pr.terminal_cursor_inactive_style));
    setVal("terminal_cursor_width", String(pr.terminal_cursor_width ?? 1));
    setChk("terminal_alt_click_moves_cursor", pr.terminal_alt_click_moves_cursor ?? true);
    setVal("terminal_font_size", String(pr.terminal_font_size ?? 12));
    setVal("terminal_font_weight", pr.terminal_font_weight ?? "normal");
    setVal("terminal_font_weight_bold", pr.terminal_font_weight_bold ?? "bold");
    setVal("terminal_line_height", String(pr.terminal_line_height ?? 1));
    setVal("terminal_letter_spacing", String(pr.terminal_letter_spacing ?? 0));
    setChk("terminal_draw_bold_bright", pr.terminal_draw_bold_bright ?? true);
    setChk("terminal_custom_glyphs", pr.terminal_custom_glyphs ?? true);
    setVal("terminal_smooth_scroll_duration", String(pr.terminal_smooth_scroll_duration ?? 0));
    setVal("terminal_scroll_sensitivity", String(pr.terminal_scroll_sensitivity ?? 1));
    setVal("terminal_fast_scroll_sensitivity", String(pr.terminal_fast_scroll_sensitivity ?? 5));
    setVal("process_notification_threshold", String(pr.process_notification_threshold ?? 5.0));
    setVal("process_notification_show_for", String(pr.process_notification_show_for ?? 5000));
    setChk("process_notification_show_ms", pr.process_notification_show_ms ?? false);
    setChk("process_notification_transparent", pr.process_notification_transparent ?? false);
    setChk("mouse_hidden", pr.mouse_hidden ?? false);
    setChk("mouse_hide_on_idle", pr.mouse_hide_on_idle ?? false);
    setVal("mouse_idle_seconds", String(pr.mouse_idle_seconds ?? 3));
    setChk("dev_perf_enabled", pr.dev_perf_enabled ?? false);
    setChk("dev_perf_console", pr.dev_perf_console ?? false);
    setVal("dev_perf_console_interval_ms", String(pr.dev_perf_console_interval_ms ?? 5000));
    setSel("split_layout_style", ((v?: string) => { v = (v ?? "balanced").toLowerCase(); return v === "dwindle" || v === "master" ? v : "balanced"; })(pr.split_layout_style));
    setChk("quiet_pane_deferral", pr.quiet_pane_deferral ?? false);

    setChk("shed_on_hide", p.shed_on_hide);
    setChk("always_on_top", p.always_on_top);
    setChk("webgl_shed_on_hide", p.webgl_shed_on_hide);
    setChk("discard_buffer_on_hide", p.discard_buffer_on_hide);
    setChk("preload_pty_on_startup", p.preload_pty_on_startup);
    setChk("preload_webgl_on_startup", p.preload_webgl_on_startup);
    setChk("defer_window_show_until_prepared", p.defer_window_show_until_prepared);
    setChk("destroy_webview_on_hide", p.destroy_webview_on_hide);
    setChk("focus_follows_cursor", p.focus_follows_cursor);
    setChk("blur_unfocused_panes", pr.blur_unfocused_panes ?? false);
    setVal("pane_blur_radius", String(pr.pane_blur_radius ?? 1.6));
    setVal("pane_opacity_focused", String(pr.pane_opacity_focused ?? 1.0));
    setVal("pane_opacity_unfocused", String(pr.pane_opacity_unfocused ?? 1.0));
    setChk("pane_variable_opacity", pr.pane_variable_opacity ?? false);
    setChk("focus_pane_scale", pr.focus_pane_scale ?? true);
    setVal("pane_focus_scale_intensity", String(pr.pane_focus_scale_intensity ?? 0.45));
    setChk("auto_copy_selection", pr.auto_copy_selection ?? false);
    setChk("always_summon_maximized", pr.always_summon_maximized ?? false);
    setChk("summon_spawn_at_cursor", pr.summon_spawn_at_cursor ?? false);
    setChk("cursor_follow_window_move", pr.cursor_follow_window_move ?? false);
    setChk("cursor_follow_pane_focus", pr.cursor_follow_pane_focus ?? true);
    setChk("hidden_from_taskbar", pr.hidden_from_taskbar ?? false);
    setChk("file_tree_show_diff_counts", pr.file_tree_show_diff_counts ?? false);
    setChk("file_tree_show_git_info", pr.file_tree_show_git_info ?? true);
    setChk("file_tree_disabled", pr.file_tree_disabled ?? false);
    setChk("file_tree_disable_search", pr.file_tree_disable_search ?? false);
    setChk("confirm_delete_prompt", pr.confirm_delete_prompt ?? true);
    setChk("ui_disable_tooltips", pr.ui_disable_tooltips ?? false);
    setChk("terminal_backspace_delete_selection", pr.terminal_backspace_delete_selection ?? true);
    setChk("always_open_in_zen_mode", pr.always_open_in_zen_mode ?? false);
    setChk("terminal_no_round", pr.terminal_no_round ?? false);
    setChk("terminal_no_pane_border", pr.terminal_no_pane_border ?? false);
    setChk("terminal_no_focus_border", pr.terminal_no_focus_border ?? false);

    applySettingsTree();
    applySettingsSearch();
  }

  function close(save = true): void {
    if (!open) return;
    open = false;
    mouseCursorForceVisible(false);
    root.classList.add("settings-panel--hidden");
    root.setAttribute("aria-hidden", "true");
    if (save) void doSave();
  }

  let listenersInstalled = false;
  function ensureListeners(): void {
    if (listenersInstalled) return;
    listenersInstalled = true;

    const searchToggle = form?.querySelector('[name="file_tree_disable_search"]') as HTMLInputElement | null;
    searchToggle?.addEventListener("change", () => { applySettingsTree(); applySettingsSearch(); });
    const filesToggle = form?.querySelector('[name="file_tree_disabled"]') as HTMLInputElement | null;
    filesToggle?.addEventListener("change", () => { applySettingsTree(); applySettingsSearch(); });
    const mouseHiddenToggle = form?.querySelector('[name="mouse_hidden"]') as HTMLInputElement | null;
    mouseHiddenToggle?.addEventListener("change", () => applySettingsTree());
    const mouseIdleToggle = form?.querySelector('[name="mouse_hide_on_idle"]') as HTMLInputElement | null;
    mouseIdleToggle?.addEventListener("change", () => applySettingsTree());
    const devPerfToggle = form?.querySelector('[name="dev_perf_enabled"]') as HTMLInputElement | null;
    devPerfToggle?.addEventListener("change", () => { applySettingsTree(); applySettingsSearch(); });
    const varOpacityToggle = form?.querySelector('[name="pane_variable_opacity"]') as HTMLInputElement | null;
    varOpacityToggle?.addEventListener("change", () => applySettingsTree());

    root.querySelector(".settings-panel-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) close();
    });
    root.querySelector("#settings-close")?.addEventListener("click", () => close());
    root.querySelector("#settings-search")?.addEventListener("input", () => applySettingsSearch());
    // Click section headers to toggle fold
    form?.addEventListener("click", (e) => {
      const hd = (e.target as HTMLElement).closest(".settings-section-hd");
      if (!hd) return;
      hd.closest(".settings-section")?.classList.toggle("settings-section--open");
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  ensureListeners();

  return {
    open: () => {
      if (open) return;
      open = true;
      mouseCursorForceVisible(true);
      ensureListeners();
      root.classList.remove("settings-panel--hidden");
      root.setAttribute("aria-hidden", "false");
      const search = root.querySelector("#settings-search") as HTMLInputElement | null;
      if (search) search.value = "";
      void loadAndRender();
      requestAnimationFrame(() => {
        (root.querySelector("#settings-search") as HTMLInputElement | null)?.focus();
      });
    },
    close: () => close(),
    isOpen: () => open,
  };
}
