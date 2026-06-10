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
  /** Summon main window near the OS cursor (same monitor). */
  summon_spawn_at_cursor: boolean;
  hidden_from_taskbar: boolean;
  /** File tree: show git diff +/- counts next to status letters. */
  file_tree_show_diff_counts: boolean;
  /** File tree: show git info panel with repo summary. */
  file_tree_show_git_info: boolean;
  /** File tree: hide the file name/content search bar. */
  file_tree_disable_search: boolean;
  /** File tree dock side: left | right. */
  file_tree_side: string;
  /** Ask for delete confirmation before file/folder removal in file tree. */
  confirm_delete_prompt: boolean;
  /** Disable native hover tooltips in the UI. */
  ui_disable_tooltips: boolean;
  /** Allow click-to-reposition cursor on active terminal line. */
  terminal_click_to_cursor: boolean;
  /** When true, backspace deletes the selected text block in the terminal. (Experimental) */
  terminal_backspace_delete_selection: boolean;
  /** Force zen mode on every app open/show. */
  always_open_in_zen_mode: boolean;
  /** Remove pane/container gaps. */
  terminal_no_gap: boolean;
  terminal_pane_gap: number;
  terminal_sandbox_padding: number;
  /** Remove rounded pane/chrome corners. */
  terminal_no_round: boolean;
  terminal_no_pane_border: boolean;
  terminal_no_focus_border: boolean;
  /** balanced | dwindle | master */
  split_layout_style: string;
  /** off | fast | normal | slow */
  terminal_animation_speed: string;
  /** off | transparent */
  window_effect_mode: string;
  window_effect_opacity: number;
  pane_background_opacity: number;
  pane_background_blur: number;
  pane_corner_radius: number;
};

type DetectedShell = { name: string; path: string };

type Persisted = { window: Record<string, unknown>; prefs: ParttyPrefs };
type LocalFontDescriptor = { family: string; fullName?: string; postscriptName?: string };

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontDescriptor[]>;
  }
}

export type SettingsPanelApi = {
  open(): void;
  close(): void;
  isOpen(): boolean;
};

const FALLBACK_FONT_FAMILIES = [
  "JetBrains Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Fira Code",
  "Hack",
  "Iosevka",
  "IBM Plex Mono",
  "Segoe UI",
  "Inter",
  "Arial",
  "system-ui",
];

async function discoverFontFamilies(): Promise<string[]> {
  const families = new Set<string>(FALLBACK_FONT_FAMILIES);
  try {
    const fonts = await window.queryLocalFonts?.();
    for (const font of fonts ?? []) {
      const family = font.family?.trim();
      if (family) families.add(family);
    }
  } catch {
    /* Font Access may be unavailable or denied; typed fallback remains valid. */
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

export function createSettingsPanel(
  root: HTMLElement,
  onSaved?: (next: ParttyPrefs, previous: ParttyPrefs) => void | Promise<void>,
): SettingsPanelApi {
  let open = false;

  function close(): void {
    if (!open) return;
    open = false;
    root.classList.add("settings-panel--hidden");
    root.setAttribute("aria-hidden", "true");
  }

  function applySettingsSearch(): void {
    const input = root.querySelector("#settings-search") as HTMLInputElement | null;
    const q = input?.value.trim().toLowerCase() ?? "";
    const domains = root.querySelectorAll<HTMLElement>(".settings-domain");
    for (const domain of domains) {
      const title = domain.querySelector(".settings-domain-title")?.textContent?.toLowerCase() ?? "";
      const domainMatch = q.length > 0 && title.includes(q);
      let anyVisible = q.length === 0 || domainMatch;
      const rows = domain.querySelectorAll<HTMLElement>(".settings-field, .settings-checkbox-label");
      for (const row of rows) {
        const controls = [...row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")]
          .map((el) => `${el.name} ${el.id} ${"placeholder" in el ? el.placeholder : ""}`)
          .join(" ");
        const text = `${row.textContent ?? ""} ${controls}`.toLowerCase().replace(/[_-]/g, " ");
        const visible = q.length === 0 || domainMatch || text.includes(q);
        row.hidden = !visible;
        if (visible) anyVisible = true;
      }
      domain.hidden = !anyVisible;
    }
  }

  async function loadAndRender(): Promise<void> {
    const data = await invoke<Persisted>("get_persisted_state");
    const p = data.prefs;
    const form = root.querySelector("#settings-form") as HTMLFormElement | null;
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
        const opt = document.createElement("option");
        opt.value = s.name;
        opt.label = s.path;
        shellDatalist.appendChild(opt);
      }
    } catch {
      /* keep datalist empty; user can still type a path */
    }
    shellInput.value = p.shell;
    const fontDatalist = form.querySelector("#font-suggestions") as HTMLDataListElement | null;
    if (fontDatalist) {
      fontDatalist.innerHTML = "";
      const families = await discoverFontFamilies();
      for (const family of families) {
        const opt = document.createElement("option");
        opt.value = family;
        fontDatalist.appendChild(opt);
      }
    }
    (form.querySelector('[name="initial_cwd"]') as HTMLInputElement).value = p.initial_cwd ?? "";
    (form.querySelector('[name="font_terminal"]') as HTMLInputElement).value = pr.font_terminal ?? "";
    (form.querySelector('[name="font_ui"]') as HTMLInputElement).value = pr.font_ui ?? "";
    (form.querySelector('[name="font_file_tree"]') as HTMLInputElement).value = pr.font_file_tree ?? "";
    (form.querySelector('[name="scrollback_lines"]') as HTMLInputElement).value = String(
      p.scrollback_lines,
    );
    (form.querySelector('[name="command_history_flush_interval_sec"]') as HTMLInputElement).value = String(pr.command_history_flush_interval_sec ?? 0);
    (form.querySelector('[name="command_history_max_records_per_pane"]') as HTMLInputElement).value = String(pr.command_history_max_records_per_pane ?? 2000);
    (form.querySelector('[name="command_history_max_output_bytes"]') as HTMLInputElement).value = String(pr.command_history_max_output_bytes ?? 262144);
    const includeCommands = form.querySelector('[name="command_history_include_commands"]') as HTMLTextAreaElement | null;
    if (includeCommands) includeCommands.value = (pr.command_history_include_commands ?? []).join("\n");
    const excludeCommands = form.querySelector('[name="command_history_exclude_commands"]') as HTMLTextAreaElement | null;
    if (excludeCommands) excludeCommands.value = (pr.command_history_exclude_commands ?? ["nvim", "vim", "vi", "nano", "emacs", "less", "more", "man", "top", "htop", "btop", "btm", "opencode", "lazygit", "tig", "fzf"]).join("\n");
    (form.querySelector('[name="snapshot_max_lines"]') as HTMLInputElement).value = String(
      p.snapshot_max_lines,
    );
    const shedSel = form.querySelector('[name="shed_workspace_exit"]') as HTMLSelectElement | null;
    if (shedSel) {
      const raw = (pr.shed_workspace_exit ?? "keep").toLowerCase();
      shedSel.value = raw === "shed" || raw === "always" ? "shed" : raw === "ask" ? "ask" : "keep";
    }
    const animSel = form.querySelector('[name="terminal_animation_speed"]') as HTMLSelectElement | null;
    if (animSel) {
      const raw = (pr.terminal_animation_speed ?? "normal").toLowerCase();
      animSel.value = raw === "off" || raw === "fast" || raw === "slow" ? raw : "normal";
    }
    const effectSel = form.querySelector('[name="window_effect_mode"]') as HTMLSelectElement | null;
    if (effectSel) {
      const raw = (pr.window_effect_mode ?? "off").toLowerCase().replace(/-/g, "_");
      effectSel.value = raw === "transparent" ? "transparent" : "off";
    }
    const effectOpacity = form.querySelector('[name="window_effect_opacity"]') as HTMLInputElement | null;
    if (effectOpacity) effectOpacity.value = String(pr.window_effect_opacity ?? 0);
    const paneOpacity = form.querySelector('[name="pane_background_opacity"]') as HTMLInputElement | null;
    if (paneOpacity) paneOpacity.value = String(pr.pane_background_opacity ?? 1);
    const paneBlur = form.querySelector('[name="pane_background_blur"]') as HTMLInputElement | null;
    if (paneBlur) paneBlur.value = String(pr.pane_background_blur ?? 0);
    const paneRadius = form.querySelector('[name="pane_corner_radius"]') as HTMLInputElement | null;
    if (paneRadius) paneRadius.value = String(pr.pane_corner_radius ?? 6);
    const fileTreeSide = form.querySelector('[name="file_tree_side"]') as HTMLSelectElement | null;
    if (fileTreeSide) fileTreeSide.value = pr.file_tree_side === "right" ? "right" : "left";
    const splitStyle = form.querySelector('[name="split_layout_style"]') as HTMLSelectElement | null;
    if (splitStyle) {
      const raw = (pr.split_layout_style ?? "balanced").toLowerCase();
      splitStyle.value = raw === "dwindle" || raw === "master" ? raw : "balanced";
    }
    const paneGap = form.querySelector('[name="terminal_pane_gap"]') as HTMLInputElement | null;
    if (paneGap) paneGap.value = String(pr.terminal_pane_gap ?? (pr.terminal_no_gap ? 0 : 6));
    const sandboxPadding = form.querySelector('[name="terminal_sandbox_padding"]') as HTMLInputElement | null;
    if (sandboxPadding) sandboxPadding.value = String(pr.terminal_sandbox_padding ?? 0);
    const setChk = (name: keyof ParttyPrefs, v: boolean) => {
      const el = form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
      if (el) el.checked = v;
    };
    setChk("shed_on_hide", p.shed_on_hide);
    setChk("always_on_top", p.always_on_top);
    setChk("webgl_shed_on_hide", p.webgl_shed_on_hide);
    setChk("discard_buffer_on_hide", p.discard_buffer_on_hide);
    setChk("command_history_enabled", pr.command_history_enabled === true);
    setChk("command_history_capture_output", pr.command_history_capture_output ?? true);
    setChk("command_history_flush_on_command_end", pr.command_history_flush_on_command_end ?? true);
    setChk("command_history_flush_on_hide", pr.command_history_flush_on_hide ?? true);
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
    setChk("confirm_delete_prompt", pr.confirm_delete_prompt ?? true);
    setChk("ui_disable_tooltips", pr.ui_disable_tooltips ?? false);
    setChk("terminal_click_to_cursor", pr.terminal_click_to_cursor ?? true);
    setChk("terminal_backspace_delete_selection", pr.terminal_backspace_delete_selection ?? true);
    setChk("always_open_in_zen_mode", pr.always_open_in_zen_mode ?? false);
    setChk("terminal_no_round", pr.terminal_no_round ?? false);
    setChk("terminal_no_pane_border", pr.terminal_no_pane_border ?? false);
    setChk("terminal_no_focus_border", pr.terminal_no_focus_border ?? false);
    applySettingsSearch();
  }

  root.querySelector(".settings-panel-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) close();
  });
  root.querySelector("#settings-close")?.addEventListener("click", () => close());
  root.querySelector("#settings-search")?.addEventListener("input", () => applySettingsSearch());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  root.querySelector("#settings-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const g = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    const gc = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).checked;
    const gs = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLSelectElement).value;
    const cwd = g("initial_cwd").trim();
    void (async () => {
      try {
        const data = await invoke<Persisted>("get_persisted_state");
        const previous = { ...(data.prefs as ParttyPrefs) };
        const shedRaw = gs("shed_workspace_exit").toLowerCase();
        const shed_workspace_exit = shedRaw === "shed" || shedRaw === "ask" ? shedRaw : "keep";
        const animationRaw = gs("terminal_animation_speed").toLowerCase();
        const terminal_animation_speed =
          animationRaw === "off" || animationRaw === "fast" || animationRaw === "slow" ? animationRaw : "normal";
        const splitRaw = gs("split_layout_style").toLowerCase();
        const split_layout_style = splitRaw === "dwindle" || splitRaw === "master" ? splitRaw : "balanced";
        const effectRaw = gs("window_effect_mode").toLowerCase().replace(/-/g, "_");
        const window_effect_mode = effectRaw === "transparent" ? "transparent" : "off";
        const clamp01 = (raw: string, fallback: number) => {
          const n = Number.parseFloat(raw);
          return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
        };
        const clampRadius = (raw: string, fallback: number) => {
          const n = Number.parseFloat(raw);
          return Number.isFinite(n) ? Math.max(0, Math.min(32, n)) : fallback;
        };
        const clampBlur = (raw: string, fallback: number) => {
          const n = Number.parseFloat(raw);
          return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : fallback;
        };
        const clampGap = (raw: string, fallback: number) => {
          const n = Number.parseFloat(raw);
          return Number.isFinite(n) ? Math.max(0, Math.min(32, n)) : fallback;
        };
        const terminal_pane_gap = clampGap(g("terminal_pane_gap"), previous.terminal_pane_gap ?? 6);
        const terminal_sandbox_padding = clampGap(g("terminal_sandbox_padding"), previous.terminal_sandbox_padding ?? 0);
        const gl = (n: string) => g(n).split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
        const prefs: ParttyPrefs = {
          shell: g("shell").trim() || "pwsh",
          shed_on_hide: gc("shed_on_hide"),
          always_on_top: gc("always_on_top"),
          initial_cwd: cwd ? cwd : null,
          webgl_shed_on_hide: gc("webgl_shed_on_hide"),
          discard_buffer_on_hide: gc("discard_buffer_on_hide"),
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
          preload_pty_on_startup: gc("preload_pty_on_startup"),
          preload_webgl_on_startup: gc("preload_webgl_on_startup"),
          defer_window_show_until_prepared: gc("defer_window_show_until_prepared"),
          destroy_webview_on_hide: gc("destroy_webview_on_hide"),
          focus_follows_cursor: gc("focus_follows_cursor"),
          blur_unfocused_panes: gc("blur_unfocused_panes"),
          dim_unfocused_panes: gc("dim_unfocused_panes"),
          auto_copy_selection: gc("auto_copy_selection"),
          shed_workspace_exit,
          always_summon_maximized: gc("always_summon_maximized"),
          summon_spawn_at_cursor: gc("summon_spawn_at_cursor"),
          hidden_from_taskbar: gc("hidden_from_taskbar"),
          ui_theme: previous.ui_theme,
          ui_theme_variant: previous.ui_theme_variant,
          font_terminal: g("font_terminal").trim(),
          font_ui: g("font_ui").trim(),
          font_file_tree: g("font_file_tree").trim(),
          file_tree_show_diff_counts: gc("file_tree_show_diff_counts"),
          file_tree_show_git_info: gc("file_tree_show_git_info"),
          file_tree_disable_search: gc("file_tree_disable_search"),
          file_tree_side: gs("file_tree_side") === "right" ? "right" : "left",
          confirm_delete_prompt: gc("confirm_delete_prompt"),
          ui_disable_tooltips: gc("ui_disable_tooltips"),
          terminal_click_to_cursor: gc("terminal_click_to_cursor"),
          terminal_backspace_delete_selection: gc("terminal_backspace_delete_selection"),
          always_open_in_zen_mode: gc("always_open_in_zen_mode"),
          terminal_no_gap: terminal_pane_gap <= 0,
          terminal_pane_gap,
          terminal_sandbox_padding,
          terminal_no_round: gc("terminal_no_round"),
          terminal_no_pane_border: gc("terminal_no_pane_border"),
          terminal_no_focus_border: gc("terminal_no_focus_border"),
          split_layout_style,
          terminal_animation_speed,
          window_effect_mode,
          window_effect_opacity: clamp01(g("window_effect_opacity"), 0),
          pane_background_opacity: clamp01(g("pane_background_opacity"), 1),
          pane_background_blur: clampBlur(g("pane_background_blur"), 0),
          pane_corner_radius: clampRadius(g("pane_corner_radius"), 6),
        };
        const merged = { ...previous, ...prefs };
        await invoke("set_prefs", {
          prefs: merged,
        });
        await onSaved?.(merged, previous);
        close();
      } catch (err) {
        console.error("set_prefs", err);
      }
    })();
  });


  return {
    open: () => {
      if (open) return;
      open = true;
      root.classList.remove("settings-panel--hidden");
      root.setAttribute("aria-hidden", "false");
      const search = root.querySelector("#settings-search") as HTMLInputElement | null;
      if (search) search.value = "";
      applySettingsSearch();
      void loadAndRender();
      requestAnimationFrame(() => {
        (root.querySelector("#settings-search") as HTMLInputElement | null)?.focus();
      });
    },
    close,
    isOpen: () => open,
  };
}
