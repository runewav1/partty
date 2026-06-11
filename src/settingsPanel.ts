import { invoke } from "@tauri-apps/api/core";

/** Mirrors `prefs::Prefs` JSON (snake_case). */
export type ParttyPrefs = {
  shell: string;
  shed_on_hide: boolean;
  always_on_top: boolean;
  initial_cwd: string | null;
  webgl_shed_on_hide: boolean;
  discard_buffer_on_hide: boolean;
  scrollback_lines: number;
  command_history_enabled: boolean;
  command_history_flush_interval_sec: number;
  command_history_flush_on_command_end: boolean;
  command_history_max_records_per_pane: number;
  command_history_capture_output: boolean;
  command_history_max_output_bytes: number;
  command_history_flush_on_hide: boolean;
  command_history_include_commands: string[];
  command_history_exclude_commands: string[];
  snapshot_max_lines: number;
  preload_pty_on_startup: boolean;
  preload_webgl_on_startup: boolean;
  defer_window_show_until_prepared: boolean;
  destroy_webview_on_hide: boolean;
  focus_follows_cursor: boolean;
  blur_unfocused_panes: boolean;
  dim_unfocused_panes: boolean;
  auto_copy_selection: boolean;
  ui_theme: string;
  ui_theme_variant: string;
  font_terminal: string;
  font_ui: string;
  font_file_tree: string;
  shed_workspace_exit: string;
  always_summon_maximized: boolean;
  summon_spawn_at_cursor: boolean;
  hidden_from_taskbar: boolean;
  file_tree_show_diff_counts: boolean;
  file_tree_show_git_info: boolean;
  file_tree_disable_search: boolean;
  /** Respect .gitignore during file panel search. */
  file_search_git_aware: boolean;
  file_tree_side: string;
  confirm_delete_prompt: boolean;
  ui_disable_tooltips: boolean;
  terminal_click_to_cursor: boolean;
  terminal_backspace_delete_selection: boolean;
  always_open_in_zen_mode: boolean;
  terminal_no_gap: boolean;
  terminal_pane_gap: number;
  terminal_sandbox_padding: number;
  terminal_no_round: boolean;
  terminal_no_pane_border: boolean;
  terminal_no_focus_border: boolean;
  split_layout_style: string;
  terminal_animation_speed: string;
  window_effect_mode: string;
  window_effect_opacity: number;
  pane_background_opacity: number;
  pane_background_blur: number;
  pane_corner_radius: number;
  /** `cell` | `row` — minimap rendering granularity. */
  minimap_granularity: string;
  /** Minimap column width in px. */
  minimap_width: number;
  /** When true, minimap is hidden until the cursor hovers over it. */
  minimap_auto_hide: boolean;
  /** Background opacity of the minimap overlay (0–1). */
  minimap_opacity: number;
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
    const split_layout_style = ((v: string) => v === "dwindle" || v === "master" ? v : "balanced")(gs("split_layout_style"));
    const window_effect_mode = gs("window_effect_mode").replace(/-/g, "_") === "transparent" ? "transparent" : "off";
    const clamp01 = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fb; };
    const clampR = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(32, n)) : fb; };
    const clampW = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(16, Math.min(200, n)) : fb; };
    const clampB = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : fb; };
    const clampG = (raw: string, fb: number) => { const n = Number.parseFloat(raw); return Number.isFinite(n) ? Math.max(0, Math.min(32, n)) : fb; };
    const terminal_pane_gap = clampG(g("terminal_pane_gap"), previous.terminal_pane_gap ?? 6);
    const terminal_sandbox_padding = clampG(g("terminal_sandbox_padding"), previous.terminal_sandbox_padding ?? 0);
    const gl = (n: string) => g(n).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

    return {
      shell: g("shell") || "pwsh", shed_on_hide: gc("shed_on_hide"), always_on_top: gc("always_on_top"),
      initial_cwd: cwd || null, webgl_shed_on_hide: gc("webgl_shed_on_hide"), discard_buffer_on_hide: gc("discard_buffer_on_hide"),
      scrollback_lines: Math.max(0, Math.min(50000, parseInt(g("scrollback_lines"), 10) || 0)),
      command_history_enabled: gc("command_history_enabled"),
      command_history_flush_interval_sec: Math.max(0, Math.min(86400, Number.parseFloat(g("command_history_flush_interval_sec")) || 0)),
      command_history_flush_on_command_end: gc("command_history_flush_on_command_end"),
      command_history_max_records_per_pane: Math.max(50, Math.min(50000, parseInt(g("command_history_max_records_per_pane"), 10) || 2000)),
      command_history_capture_output: gc("command_history_capture_output"),
      command_history_max_output_bytes: Math.max(4096, Math.min(10485760, parseInt(g("command_history_max_output_bytes"), 10) || 262144)),
      command_history_flush_on_hide: gc("command_history_flush_on_hide"),
      command_history_include_commands: gl("command_history_include_commands"),
      command_history_exclude_commands: gl("command_history_exclude_commands"),
      snapshot_max_lines: Math.max(50, Math.min(50000, parseInt(g("snapshot_max_lines"), 10) || 2500)),
      preload_pty_on_startup: gc("preload_pty_on_startup"), preload_webgl_on_startup: gc("preload_webgl_on_startup"),
      defer_window_show_until_prepared: gc("defer_window_show_until_prepared"),
      destroy_webview_on_hide: gc("destroy_webview_on_hide"), focus_follows_cursor: gc("focus_follows_cursor"),
      blur_unfocused_panes: gc("blur_unfocused_panes"), dim_unfocused_panes: gc("dim_unfocused_panes"),
      auto_copy_selection: gc("auto_copy_selection"), shed_workspace_exit,
      always_summon_maximized: gc("always_summon_maximized"), summon_spawn_at_cursor: gc("summon_spawn_at_cursor"),
      hidden_from_taskbar: gc("hidden_from_taskbar"),
      ui_theme: previous.ui_theme, ui_theme_variant: previous.ui_theme_variant,
      font_terminal: g("font_terminal"), font_ui: g("font_ui"), font_file_tree: g("font_file_tree"),
      file_tree_show_diff_counts: gc("file_tree_show_diff_counts"), file_tree_show_git_info: gc("file_tree_show_git_info"),
      file_tree_disable_search: gc("file_tree_disable_search"),
      file_search_git_aware: gc("file_search_git_aware"),
      file_tree_side: gs("file_tree_side") === "right" ? "right" : "left",
      confirm_delete_prompt: gc("confirm_delete_prompt"), ui_disable_tooltips: gc("ui_disable_tooltips"),
      terminal_click_to_cursor: gc("terminal_click_to_cursor"), terminal_backspace_delete_selection: gc("terminal_backspace_delete_selection"),
      always_open_in_zen_mode: gc("always_open_in_zen_mode"),
      terminal_no_gap: terminal_pane_gap <= 0, terminal_pane_gap, terminal_sandbox_padding,
      terminal_no_round: gc("terminal_no_round"), terminal_no_pane_border: gc("terminal_no_pane_border"),
      terminal_no_focus_border: gc("terminal_no_focus_border"), split_layout_style, terminal_animation_speed,
      window_effect_mode, window_effect_opacity: clamp01(g("window_effect_opacity"), 0),
      pane_background_opacity: clamp01(g("pane_background_opacity"), 1),
      pane_background_blur: clampB(g("pane_background_blur"), 0),
      pane_corner_radius: clampR(g("pane_corner_radius"), 6),
      minimap_granularity: g("minimap_granularity") === "cell" ? "cell" : "row",
      minimap_width: clampW(g("minimap_width"), 48),
      minimap_auto_hide: gc("minimap_auto_hide"),
      minimap_opacity: clamp01(g("minimap_opacity"), 0.12),
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
  }

  function applySettingsTree(): void {
    // Command history tree
    {
      const parentEl = form?.querySelector('[name="command_history_enabled"]') as HTMLInputElement | null;
      const enabled = parentEl?.checked ?? false;
      const container = root.querySelector('[data-child-of="command_history_enabled"]');
      const siblingRows = root.querySelectorAll('[data-child-of="command_history_enabled"]');
      const section = root.querySelector('[data-parent-section="command_history_enabled"]');
      if (enabled) {
        container?.classList.remove("settings-tree-hidden");
        siblingRows.forEach((r) => (r as HTMLElement).classList.remove("settings-tree-hidden"));
        section?.classList.remove("settings-section--disabled");
      } else {
        container?.classList.add("settings-tree-hidden");
        siblingRows.forEach((r) => (r as HTMLElement).classList.add("settings-tree-hidden"));
        section?.classList.add("settings-section--disabled");
      }
    }
    // File search tree: dim git-aware when search is hidden
    {
      const parentEl = form?.querySelector('[name="file_tree_disable_search"]') as HTMLInputElement | null;
      const hidden = parentEl?.checked ?? false;
      const children = root.querySelectorAll('[data-child-of="file_tree_disable_search"]');
      children.forEach((r) => (r as HTMLElement).classList.toggle("settings-tree-hidden", hidden));
    }
  }

  function applySettingsSearch(): void {
    const input = root.querySelector("#settings-search") as HTMLInputElement | null;
    const q = input?.value.trim().toLowerCase() ?? "";
    const sections = root.querySelectorAll<HTMLElement>(".settings-section");
    for (const section of sections) {
      const title = section.querySelector(".settings-section-hd")?.textContent?.toLowerCase() ?? "";
      const titleMatch = q.length > 0 && title.includes(q);
      let anyVisible = q.length === 0 || titleMatch;
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
    setVal("command_history_flush_interval_sec", String(pr.command_history_flush_interval_sec ?? 0));
    setVal("command_history_max_records_per_pane", String(pr.command_history_max_records_per_pane ?? 2000));
    setVal("command_history_max_output_bytes", String(pr.command_history_max_output_bytes ?? 262144));
    { const el = form.querySelector('[name="command_history_include_commands"]') as HTMLTextAreaElement | null; if (el) el.value = (pr.command_history_include_commands ?? []).join("\n"); }
    { const el = form.querySelector('[name="command_history_exclude_commands"]') as HTMLTextAreaElement | null; if (el) el.value = (pr.command_history_exclude_commands ?? ["nvim","vim","vi","nano","emacs","less","more","man","top","htop","btop","btm","opencode","lazygit","tig","fzf"]).join("\n"); }
    setVal("snapshot_max_lines", String(p.snapshot_max_lines));
    setVal("window_effect_opacity", String(pr.window_effect_opacity ?? 0));
    setVal("pane_background_opacity", String(pr.pane_background_opacity ?? 1));
    setVal("pane_background_blur", String(pr.pane_background_blur ?? 0));
    setVal("pane_corner_radius", String(pr.pane_corner_radius ?? 6));
    setVal("terminal_pane_gap", String(pr.terminal_pane_gap ?? (pr.terminal_no_gap ? 0 : 6)));
    setVal("terminal_sandbox_padding", String(pr.terminal_sandbox_padding ?? 0));

    setSel("shed_workspace_exit", ((v?: string) => { v = (v ?? "keep").toLowerCase(); return v === "shed" ? "shed" : v === "ask" ? "ask" : "keep"; })(pr.shed_workspace_exit));
    setSel("terminal_animation_speed", ((v?: string) => { v = (v ?? "normal").toLowerCase(); return v === "off" || v === "fast" || v === "slow" ? v : "normal"; })(pr.terminal_animation_speed));
    setSel("window_effect_mode", (pr.window_effect_mode ?? "off").toLowerCase() === "transparent" ? "transparent" : "off");
    setSel("file_tree_side", pr.file_tree_side === "right" ? "right" : "left");
    setSel("minimap_granularity", pr.minimap_granularity === "cell" ? "cell" : "row");
    setVal("minimap_width", String(pr.minimap_width ?? 48));
    setChk("minimap_auto_hide", pr.minimap_auto_hide === true);
    setVal("minimap_opacity", String(pr.minimap_opacity ?? 0.12));
    setSel("split_layout_style", ((v?: string) => { v = (v ?? "balanced").toLowerCase(); return v === "dwindle" || v === "master" ? v : "balanced"; })(pr.split_layout_style));

    setChk("command_history_enabled", pr.command_history_enabled === true);
    setChk("command_history_capture_output", pr.command_history_capture_output ?? true);
    setChk("command_history_flush_on_command_end", pr.command_history_flush_on_command_end ?? true);
    setChk("command_history_flush_on_hide", pr.command_history_flush_on_hide ?? true);
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
    setChk("dim_unfocused_panes", pr.dim_unfocused_panes ?? false);
    setChk("auto_copy_selection", pr.auto_copy_selection ?? false);
    setChk("always_summon_maximized", pr.always_summon_maximized ?? false);
    setChk("summon_spawn_at_cursor", pr.summon_spawn_at_cursor ?? false);
    setChk("hidden_from_taskbar", pr.hidden_from_taskbar ?? false);
    setChk("file_tree_show_diff_counts", pr.file_tree_show_diff_counts ?? false);
    setChk("file_tree_show_git_info", pr.file_tree_show_git_info ?? true);
    setChk("file_tree_disable_search", pr.file_tree_disable_search ?? false);
    setChk("file_search_git_aware", pr.file_search_git_aware ?? true);
    setChk("confirm_delete_prompt", pr.confirm_delete_prompt ?? true);
    setChk("ui_disable_tooltips", pr.ui_disable_tooltips ?? false);
    setChk("terminal_click_to_cursor", pr.terminal_click_to_cursor ?? true);
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
    root.classList.add("settings-panel--hidden");
    root.setAttribute("aria-hidden", "true");
    if (save) void doSave();
  }

  let listenersInstalled = false;
  function ensureListeners(): void {
    if (listenersInstalled) return;
    listenersInstalled = true;

    const parentEl = form?.querySelector('[name="command_history_enabled"]') as HTMLInputElement | null;
    parentEl?.addEventListener("change", () => { applySettingsTree(); applySettingsSearch(); });
    const searchToggle = form?.querySelector('[name="file_tree_disable_search"]') as HTMLInputElement | null;
    searchToggle?.addEventListener("change", () => { applySettingsTree(); applySettingsSearch(); });

    root.querySelector(".settings-panel-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) close();
    });
    root.querySelector("#settings-close")?.addEventListener("click", () => close());
    root.querySelector("#settings-search")?.addEventListener("input", () => applySettingsSearch());
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  ensureListeners();

  return {
    open: () => {
      if (open) return;
      open = true;
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
