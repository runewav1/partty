import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  capturePlainBuffer,
  createWebglAddon,
  mergeLifecyclePrefs,
  type ParttyLifecyclePrefs,
} from "./termLifecycle";
import { findPaneLeaf, type PaneHostInit, type PaneTerminal, PaneHost } from "./paneHost";
import {
  clearPaneLayout,
  isLayoutValidForRoot,
  type PersistedPaneLayout,
} from "./paneLayout";
import {
  duplicateTabLayout,
  emptyWorkspaceLayout,
  initialLayoutForTab,
  loadLayoutForTab,
  loadTabsState,
  nextTabName,
  persistLayoutForTab,
  saveTabsState,
  type TabRecord,
  type TabGroup,
  type TabsStateV1,
} from "./tabsSession";
import { initParttyScrollFade } from "./scrollChrome";
import { workspaceRootPaneId } from "./workspacePaneIds";
import { attachDraggablePanel } from "./draggablePanel";
import {
  getShedWorkspaceExitMode,
  shedWorkspaceLocalState,
  shouldShedWorkspaceOnExitSilent,
  syncRuntimeShedFromPrefs,
} from "./workspaceShed";
import {
  applyUiTheme,
  buildXtermThemeFromPrefs,
  buildXtermThemeFromDocument,
  DEFAULT_TERMINAL_FONT_STACK,
  loadCustomThemesIntoCache,
  pickUiPrefs,
  themeCssVarsForPrefs,
  type PaneThemePrefs,
  uiPrefsChanged,
  type UiThemePrefs,
} from "./uiTheme";
import {
  createShellIntegrationState,
  processShellIntegration,
  type ShellIntegrationState,
} from "./shellIntegration";
import {
  createCommandPalette,
  isCommandPaletteChord,
  isHelpHotkeysChord,
  type PaletteCommand,
} from "./commandPalette";
import { createPaneRenamePanel, type PaneRenamePanelApi } from "./paneRenamePanel";
import { showAlert } from "./dialog";
import {
  type PaletteContext,
  type SavedPaletteCommand,
  savedCommandMatchesContext,
} from "./paletteCommands";
import { normalizeFsPathKey, stripOscCwd } from "./oscCwd";
import { createSettingsPanel, type ParttyPrefs } from "./settingsPanel";
import { createThemeBuilderModal, type ThemeBuilderApi } from "./themeBuilderModal";
import { createThemeModal, type ThemeModalApi } from "./themeModal";
import { createPresetsModal, type PresetsModalApi } from "./presetsModal";
import { createPresetEditorModal, type PresetEditorApi } from "./presetEditorModal";
import { writePresetJson, type Preset } from "./presets";
import { FileTreePanel } from "./fileTreePanel";
import { FileTreeCoordinator } from "./fileTreeCoordinator";
import { FileTreeBackend } from "./fileTreeBackend";
import {
  ptyAckExit,
  popOutPane,
  ptyEnsure,
  ptyFocusPane,
  ptyKillPane,
  ptyReplaySnapshot,
  ptyResize,
  ptyShellCwd,
  ptyShellExeToken,
  ptyWrite,
} from "./ptyIpc";
import {
  createTabCloseIcon,
  mountFileTreeFolderIcons,
  mountSettingsCogIcon,
  mountTabNewPlusIcon,
  syncFileTreeFolderIcon,
} from "./toolbarIcons";
import { parttyPerf } from "./perf";

// Terminal color constants with fallbacks
// CSS variables are read after DOM is ready in boot()
const TERM_BG_FALLBACK = "#2e2e32";


const RESIZE_DEBOUNCE_MS = 100;
const PTY_OUTPUT_FLUSH_MS = 4;
const PTY_OUTPUT_BACKGROUND_FLUSH_MS = 33;
const PTY_OUTPUT_INTERACTIVE_CHARS = 2048;
const PTY_OUTPUT_MAX_BATCH_CHARS = 128 * 1024;

const FILE_TREE_STORAGE_KEY = "partty.filetree.visible";
const FILE_TREE_WIDTH_KEY = "partty.filetree.widthPx";
const ZEN_MODE_STORAGE_KEY = "partty.zen.enabled";
const TOOLTIP_STASH_ATTR = "data-partty-tooltip-title";
/** Set when shell / initial cwd change; next `partty-prepare-show` runs a full PTY reinit. */
const DEFER_PTY_REINIT_KEY = "partty.defer_pty_reinit";
const IDLE_WEBGL_MS = 400;

type PersistedPayload = { prefs: Record<string, unknown> };

const STORAGE_KEY_MIGRATIONS: [string, string][] = [

  ["termie.filetree.visible", FILE_TREE_STORAGE_KEY],
  ["termie.filetree.widthPx", FILE_TREE_WIDTH_KEY],
  ["termie.zen.enabled", ZEN_MODE_STORAGE_KEY],
  ["termie.defer_pty_reinit", DEFER_PTY_REINIT_KEY],
  ["termie.tabs.v1", "partty.tabs.v1"],
  ["termie.pane_layout.v1", "partty.pane_layout.v1"],
  ["termie.runtime.shed_workspace_exit", "partty.runtime.shed_workspace_exit"],
  ["termie.themeModal.pos", "partty.themeModal.pos"],
  ["termie.searchModal.pos", "partty.searchModal.pos"],
  ["termie.settingsPanel.pos", "partty.settingsPanel.pos"],
  ["termie.helpPanel.pos", "partty.helpPanel.pos"],
  ["termie.commandPalette.pos", "partty.commandPalette.pos"],
  ["termie.perf", "partty.perf"],
];

function migrateParttyLocalStorage(): void {
  try {
    for (const [oldKey, newKey] of STORAGE_KEY_MIGRATIONS) {
      const oldValue = localStorage.getItem(oldKey);
      if (oldValue != null && localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, oldValue);
      }
    }
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("termie.tab.layout.v1.")) continue;
      const nextKey = `partty.tab.layout.v1.${key.slice("termie.tab.layout.v1.".length)}`;
      const oldValue = localStorage.getItem(key);
      if (oldValue != null && localStorage.getItem(nextKey) == null) {
        localStorage.setItem(nextKey, oldValue);
      }
    }
  } catch {
    /* localStorage may be unavailable; ignore migration. */
  }
}

/** Fallback when fit has no dimensions yet (e.g. new pane before layout). */
const PTY_FALLBACK_COLS = 80;
const PTY_FALLBACK_ROWS = 24;

function ptyDims(fit: FitAddon): { cols: number; rows: number } | null {
  const d = fit.proposeDimensions();
  if (!d) return null;
  const cols = Math.floor(Number(d.cols));
  const rows = Math.floor(Number(d.rows));
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 1) {
    return null;
  }
  return { cols, rows };
}

function clampPtyColsRows(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.max(2, Math.min(65535, Math.floor(cols))),
    rows: Math.max(1, Math.min(65535, Math.floor(rows))),
  };
}

function scheduleIdle(cb: () => void, timeout = IDLE_WEBGL_MS): void {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => cb(), { timeout });
  } else {
    setTimeout(cb, 1);
  }
}

function animationScaleForPref(value: unknown): string {
  const raw = typeof value === "string" ? value.toLowerCase() : "normal";
  if (raw === "off") return "0";
  if (raw === "fast") return "0.55";
  if (raw === "slow") return "1.65";
  return "1";
}

function applyTerminalDisplayPrefs(raw: Partial<ParttyPrefs>): void {
  const root = document.documentElement;
  const paneGap = typeof raw.terminal_pane_gap === "number" ? raw.terminal_pane_gap : raw.terminal_no_gap ? 0 : 6;
  const sandboxPadding = typeof raw.terminal_sandbox_padding === "number" ? raw.terminal_sandbox_padding : 0;
  root.classList.toggle("terminal-no-gap", paneGap <= 0);
  root.classList.toggle("terminal-no-round", Boolean(raw.terminal_no_round));
  root.classList.toggle("terminal-no-pane-border", Boolean(raw.terminal_no_pane_border));
  root.classList.toggle("terminal-no-focus-border", Boolean(raw.terminal_no_focus_border));
  root.classList.toggle("terminal-motion-off", animationScaleForPref(raw.terminal_animation_speed) === "0");
  root.style.setProperty("--termie-animation-scale", animationScaleForPref(raw.terminal_animation_speed));
  const backdropAlpha = typeof raw.window_effect_opacity === "number" ? raw.window_effect_opacity : 0;
  const appAlpha = raw.window_effect_mode === "transparent" ? backdropAlpha : 1;
  const paneRadius = typeof raw.pane_corner_radius === "number" ? raw.pane_corner_radius : 6;
  root.style.setProperty("--pane-outer-gap", `${Math.max(0, Math.min(32, paneGap))}px`);
  root.style.setProperty("--pane-sandbox-padding", `${Math.max(0, Math.min(32, sandboxPadding))}px`);
  root.style.setProperty("--termie-app-bg-alpha", String(appAlpha));
  root.style.setProperty("--termie-pane-radius", `${Math.max(0, Math.min(32, paneRadius))}px`);
}

function normalizeFileTreeSide(raw: unknown): "left" | "right" {
  return raw === "right" ? "right" : "left";
}

function applyFileTreeSide(side: "left" | "right"): void {
  document.documentElement.classList.toggle("file-tree-right", side === "right");
}

function normalizeSplitLayoutStyle(raw: unknown): "balanced" | "dwindle" | "master" {
  return raw === "dwindle" || raw === "master" ? raw : "balanced";
}

function isWorkspaceLayoutUsable(p: PersistedPaneLayout, tabId: string): boolean {
  const rid = workspaceRootPaneId(tabId);
  if (!isLayoutValidForRoot(p, rid)) return false;
  return findPaneLeaf(p.tree, p.focusedId) != null;
}

type PtyOutputEvent = { pane_id: string; data: string };
type PtyExitEvent = { pane_id: string };
type PaneWebglStatus = "pending" | "ready" | "failed" | "disposed";
type PaneWebglState = {
  status: PaneWebglStatus;
  attempts: number;
  generation: number;
  addon?: WebglAddon;
  lastError?: unknown;
  lastFailureAt?: number;
  contextLossDispose?: { dispose(): void };
};
type PendingPtyOutput = {
  data: string;
  eventCount: number;
  queuedAt: number;
};

function isTargetInsideXterm(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.(".xterm"));
}

/** Block browser print dialog (Ctrl+P) when focus is not in a terminal so TUIs receive Ctrl+P. */
function maybeBlockBrowserPrintShortcut(e: KeyboardEvent): void {
  if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const k = e.key;
  if (k !== "p" && k !== "P") return;
  if (isTargetInsideXterm(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
}

function terminalFontStackFromDocument(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--font-terminal").trim();
  return raw.replace(/^["']|["']$/g, "") || DEFAULT_TERMINAL_FONT_STACK;
}

async function boot(): Promise<void> {
  migrateParttyLocalStorage();
  mountSettingsCogIcon();
  const persisted = await invoke<PersistedPayload>("get_persisted_state");
  syncRuntimeShedFromPrefs(persisted.prefs as ParttyPrefs);
  await loadCustomThemesIntoCache();
  const lp: ParttyLifecyclePrefs = mergeLifecyclePrefs(persisted.prefs);
  const uiPrefs = pickUiPrefs(persisted.prefs);
  let currentUiPrefs = uiPrefs;
  applyUiTheme(uiPrefs);
  applyTerminalDisplayPrefs(persisted.prefs as Partial<ParttyPrefs>);
  applyFileTreeSide(normalizeFileTreeSide((persisted.prefs as Partial<ParttyPrefs>).file_tree_side));

  document.documentElement.classList.toggle("pane-blur-unfocused", Boolean((persisted.prefs as Partial<ParttyPrefs>).blur_unfocused_panes));
  document.documentElement.style.setProperty("--pane-blur-radius", String((persisted.prefs as Partial<ParttyPrefs>).pane_blur_radius ?? 1.6));
  document.documentElement.style.setProperty("--pane-padding", String((persisted.prefs as Partial<ParttyPrefs>).terminal_pane_padding ?? 0));
  document.documentElement.classList.toggle("pane-dim-unfocused", Boolean((persisted.prefs as Partial<ParttyPrefs>).dim_unfocused_panes));

  const fileTreeUserEnabled = localStorage.getItem(FILE_TREE_STORAGE_KEY) === "1";
  document.documentElement.classList.toggle("file-tree-on", fileTreeUserEnabled);
  const prefAlwaysZen = Boolean((persisted.prefs as Partial<ParttyPrefs>).always_open_in_zen_mode);
  const zenModeEnabled = prefAlwaysZen || localStorage.getItem(ZEN_MODE_STORAGE_KEY) === "1";
  document.documentElement.classList.toggle("zen-mode", zenModeEnabled);
  mountFileTreeFolderIcons();
  mountTabNewPlusIcon();
  syncFileTreeFolderIcon(fileTreeUserEnabled);
  const ftW = localStorage.getItem(FILE_TREE_WIDTH_KEY);
  if (ftW) {
    const n = Math.max(160, Math.min(560, parseInt(ftW, 10) || 260));
    document.documentElement.style.setProperty("--file-tree-user-width", `${n}px`);
  }

  const releaseBootSurface = (): void => {
    document.documentElement.classList.remove("partty-booting");
  };

  let paneHost: PaneHost | null = null;
  const paneCwdHints = new Map<string, string>();
  const paneShellState = new Map<string, ShellIntegrationState>();
  const paneNames = new Map<string, string>();
  const paneThemes = new Map<string, PaneThemePrefs>();
  const lastPtyDims = new Map<string, { cols: number; rows: number }>();
  const pendingNewPaneCwd = { v: null as string | null };
  const focusFollowsRef = { v: lp.focus_follows_cursor };
  const autoCopySelectionRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).auto_copy_selection),
  };
  const showDiffCountsRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).file_tree_show_diff_counts),
  };
  const showGitInfoRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).file_tree_show_git_info ?? true,
  };
  const fileTreeSideRef = {
    v: normalizeFileTreeSide((persisted.prefs as Partial<ParttyPrefs>).file_tree_side),
  };
  const splitLayoutStyleRef = {
    v: normalizeSplitLayoutStyle((persisted.prefs as Partial<ParttyPrefs>).split_layout_style),
  };
  const disableSearchRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).file_tree_disable_search),
  };
  const gitAwareSearchRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).file_search_git_aware ?? true,
  };
  const disableTooltipsRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).ui_disable_tooltips ?? false,
  };
  const altClickCursorRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_alt_click_moves_cursor ?? true,
  };
  const cursorBlinkRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_blink ?? true,
  };
  const cursorInactiveStyleRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_inactive_style as "outline" | "block" | "bar" | "underline" | "none" | undefined ?? "outline",
  };
  const cursorWidthRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_width ?? 1,
  };
  const fontSizeRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_font_size ?? 12,
  };
  const fontWeightRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_font_weight ?? "normal",
  };
  const fontWeightBoldRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_font_weight_bold ?? "bold",
  };
  const lineHeightRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_line_height ?? 1,
  };
  const letterSpacingRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_letter_spacing ?? 0,
  };
  const drawBoldBrightRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_draw_bold_bright ?? true,
  };
  const customGlyphsRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_custom_glyphs ?? true,
  };
  const smoothScrollRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_smooth_scroll_duration ?? 0,
  };
  const scrollSensitivityRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_scroll_sensitivity ?? 1,
  };
  const fastScrollSensitivityRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_fast_scroll_sensitivity ?? 5,
  };
  const contrastRatioRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_minimum_contrast_ratio ?? 1,
  };
  const backspaceDeleteSelectionRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_backspace_delete_selection ?? true,
  };
  const confirmDeletePromptRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).confirm_delete_prompt ?? true,
  };
  const cursorStyleRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_style as "block" | "underline" | "bar" | undefined ?? "block",
  };
  const processNotificationThresholdRef = {
    v: ((p) => Number.isFinite(p) ? Math.max(0.1, p) : 5.0)((persisted.prefs as Partial<ParttyPrefs>).process_notification_threshold ?? 5.0),
  };
  const processNotificationShowForRef = {
    v: ((p) => Number.isFinite(p) ? Math.max(1000, Math.min(30000, p)) : 5000)((persisted.prefs as Partial<ParttyPrefs>).process_notification_show_for ?? 5000),
  };

  const activeProcesses = new Map<string, { command: string; startedAt: number; cwd: string }>();
  const processInputBuffers = new Map<string, string>();
  const paneHostCleanups = new Map<string, Array<() => void>>();
  let windowsPtyInfo: { backend: "conpty" | "winpty"; buildNumber: number } | undefined;

  // Fetch Windows ConPTY info for xterm.js heuristics (scrollback, reflow).
  invoke<{ backend: string; build_number: number } | null>("get_windows_pty_info").then((info) => {
    if (info && info.backend === "conpty") {
      windowsPtyInfo = { backend: "conpty", buildNumber: info.build_number };
    }
  }).catch(() => {});

  const pendingPtyWriteByPane = new Map<string, string>();
  const pendingPtyOutputByPane = new Map<string, PendingPtyOutput>();
  let pendingPtyWriteRaf = 0;
  let pendingPtyOutputRaf = 0;
  let pendingPtyOutputTimer = 0;
  let liveCwd: string | null = null;
  let lastLiveCwdSignalAt = 0;
  let lastFocusedPaneId = "";
  let tooltipObserver: MutationObserver | null = null;
  let bridgeScrollCleanup: (() => void) | null = null;

  const flushPendingPtyWrites = (): void => {
    pendingPtyWriteRaf = 0;
    if (pendingPtyWriteByPane.size === 0) return;
    for (const [paneId, data] of pendingPtyWriteByPane) {
      pendingPtyWriteByPane.delete(paneId);
      void ptyWrite(paneId, data).catch((e) => console.error("pty_write", e));
    }
  };

  const flushPendingPtyWriteForPane = (paneId: string): void => {
    const pending = pendingPtyWriteByPane.get(paneId);
    if (!pending) return;
    pendingPtyWriteByPane.delete(paneId);
    void ptyWrite(paneId, pending).catch((e) => console.error("pty_write", e));
  };

  const isLatencySensitiveInput = (data: string): boolean => {
    if (data.length > 8) return false;
    if (data.includes("\x1b")) return true;
    return data.length <= 2;
  };

  const queuePtyWrite = (paneId: string, data: string, immediate = false): void => {
    if (!data) return;
    if (immediate || isLatencySensitiveInput(data)) {
      flushPendingPtyWriteForPane(paneId);
      void ptyWrite(paneId, data).catch((e) => console.error("pty_write", e));
      parttyPerf.mark("pty.input.immediate");
      return;
    }
    const prior = pendingPtyWriteByPane.get(paneId);
    pendingPtyWriteByPane.set(paneId, prior ? `${prior}${data}` : data);
    if (pendingPtyWriteRaf) return;
    pendingPtyWriteRaf = requestAnimationFrame(flushPendingPtyWrites);
  };

  function processPtyOutputBatch(paneId: string, data: string, eventCount: number, queuedAt: number): void {
    const pt = getPaneTerminalById(paneId);
    if (!pt) return;
    parttyPerf.mark("pty.output.events", eventCount);
    parttyPerf.mark("pty.output.chars", data.length);
    parttyPerf.time("pty.output.queue.ms", performance.now() - queuedAt);

    // Hidden-tab panes: skip all processing, just stream to xterm buffer.
    const inActiveTab = paneHost?.getPaneTerminal(paneId) !== null;
    if (!inActiveTab) {
      try { pt.term.write(data); } catch { /* ignore */ }
      return;
    }

    // Fast path: no OSC escape in data → no parsing at all.
    if (!data.includes("\x1b]")) {
      try { pt.term.write(data); } catch { /* ignore */ }
      return;
    }

    const siState = ensureShellState(paneId);

    // Extended fast path: no pending parser state.
    if (!data.includes("\x1b]") && siState.parserRemainder.length === 0) {
      try { pt.term.write(data); } catch { /* ignore */ }
      return;
    }

    const cwdHandler = (p: string): void => {
      paneCwdHints.set(paneId, p);
      lastLiveCwdSignalAt = Date.now();
      fileTreeCoordinator?.seedPaneCwd(paneId, p);
      if (paneId !== paneHost?.getFocusedPaneId()) return;
      if (normalizeFsPathKey(p) === normalizeFsPathKey(liveCwd ?? "")) return;
      liveCwd = p;
      scheduleFileTreeRefresh();
    };

    const cleanedCwdInput = data.includes("\x1b]") ? stripOscCwd(data, cwdHandler) : data;
    const parseStarted = performance.now();
    let si: ReturnType<typeof processShellIntegration>;
    try {
      si = processShellIntegration(cleanedCwdInput, siState, cwdHandler, { commandEvents: true });
    } catch (err) {
      console.error("[proc] shell integration parse error", err);
      try { pt.term.write(cleanedCwdInput); } catch { /* ignore */ }
      return;
    }
    parttyPerf.time("pty.output.cwd_parse.ms", performance.now() - parseStarted);

    // Process shell integration events for CWD + command tracking
    for (const evt of si.events) {
      if (evt.kind === "command-line") {
        // Push update: if the shell integration hook emits a better command name,
        // update the entry that was already created by input observation.
        const entry = activeProcesses.get(paneId);
        if (entry && evt.text) entry.command = evt.text;
      } else if (evt.kind === "command-done" || evt.kind === "prompt-start") {
        const entry = activeProcesses.get(paneId);
        if (entry) {
          const durS = (Date.now() - entry.startedAt) / 1000;
          if (durS >= processNotificationThresholdRef.v) {
            const paneName = paneNames.get(paneId) || paneId.slice(0, 8);
            showProcessNotification(
              entry.command,
              paneName,
              entry.cwd,
              entry.startedAt,
              paneId,
            );
          }
          activeProcesses.delete(paneId);
        }
      }
    }

    if (fileTreeCoordinator && si.events.length > 0) {
      fileTreeCoordinator.processShellIntegrationEvents(paneId, si.events);
    }

    const writeStarted = performance.now();
    try {
      pt.term.write(si.cleaned, () => {
        parttyPerf.time("xterm.write.callback.ms", performance.now() - writeStarted);
      });
      parttyPerf.time("xterm.write.call.ms", performance.now() - writeStarted);
    } catch (e) {
      console.warn("xterm.write", e);
    }
  }

  function clearPtyOutputFlushHandles(): void {
    if (pendingPtyOutputRaf) {
      cancelAnimationFrame(pendingPtyOutputRaf);
      pendingPtyOutputRaf = 0;
    }
    if (pendingPtyOutputTimer) {
      window.clearTimeout(pendingPtyOutputTimer);
      pendingPtyOutputTimer = 0;
    }
  }

  function flushPendingPtyOutputs(): void {
    clearPtyOutputFlushHandles();
    if (pendingPtyOutputByPane.size === 0) return;
    const now = performance.now();
    const focusedPaneId = paneHost?.getFocusedPaneId();
    const batches = [...pendingPtyOutputByPane.entries()];
    pendingPtyOutputByPane.clear();
    for (const [paneId, batch] of batches) {
      const isFocused = paneId === focusedPaneId;
      const age = now - batch.queuedAt;
      if (!isFocused && age < PTY_OUTPUT_BACKGROUND_FLUSH_MS && batch.data.length < PTY_OUTPUT_MAX_BATCH_CHARS) {
        pendingPtyOutputByPane.set(paneId, batch);
        continue;
      }
      processPtyOutputBatch(paneId, batch.data, batch.eventCount, batch.queuedAt);
    }
    if (pendingPtyOutputByPane.size > 0) schedulePtyOutputFlush();
  }

  function schedulePtyOutputFlush(): void {
    if (!pendingPtyOutputRaf) {
      pendingPtyOutputRaf = requestAnimationFrame(flushPendingPtyOutputs);
    }
    if (!pendingPtyOutputTimer) {
      pendingPtyOutputTimer = window.setTimeout(flushPendingPtyOutputs, PTY_OUTPUT_FLUSH_MS);
    }
  }

  function queuePtyOutput(paneId: string, data: string): void {
    if (!data) return;
    if (
      data.length <= PTY_OUTPUT_INTERACTIVE_CHARS &&
      !pendingPtyOutputByPane.has(paneId) &&
      paneId === paneHost?.getFocusedPaneId()
    ) {
      processPtyOutputBatch(paneId, data, 1, performance.now());
      parttyPerf.mark("pty.output.immediate");
      return;
    }
    const existing = pendingPtyOutputByPane.get(paneId);
    if (existing) {
      existing.data += data;
      existing.eventCount++;
    } else {
      pendingPtyOutputByPane.set(paneId, {
        data,
        eventCount: 1,
        queuedAt: performance.now(),
      });
    }
    const batch = pendingPtyOutputByPane.get(paneId);
    if (batch && batch.data.length >= PTY_OUTPUT_MAX_BATCH_CHARS) {
      flushPendingPtyOutputs();
      return;
    }
    schedulePtyOutputFlush();
  }

  const getTerminalClickCell = (
    term: Terminal,
    host: HTMLElement,
    ev: MouseEvent,
  ): { col: number; row: number } | null => {
    const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    if (
      ev.clientX < rect.left ||
      ev.clientX > rect.right ||
      ev.clientY < rect.top ||
      ev.clientY > rect.bottom
    ) {
      return null;
    }
    const cols = Math.max(1, term.cols);
    const rows = Math.max(1, term.rows);
    const cellW = rect.width / cols;
    const cellH = rect.height / rows;
    if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 0 || cellH <= 0) return null;
    const col = Math.max(0, Math.min(cols - 1, Math.floor((ev.clientX - rect.left) / cellW)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((ev.clientY - rect.top) / cellH)));
    return { col, row };
  };

  const extractUrlAtColumn = (line: string, column: number): string | null => {
    const re = /(https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+)/gi;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (column < start || column >= end) continue;
      const raw = m[0].replace(/[),.;:!?]+$/g, "");
      const normalized = raw.startsWith("www.") ? `https://${raw}` : raw;
      try {
        const u = new URL(normalized);
        if (u.protocol === "http:" || u.protocol === "https:") {
          return u.toString();
        }
      } catch {
        return null;
      }
      return null;
    }
    return null;
  };

  const openLinkFromCtrlClick = (term: Terminal, host: HTMLElement, ev: MouseEvent): boolean => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.button !== 0) return false;
    const cell = getTerminalClickCell(term, host, ev);
    if (!cell) return false;
    const b = term.buffer.active;
    const clickAbsY = b.viewportY + cell.row;
    const line = b.getLine(clickAbsY)?.translateToString(false) ?? "";
    if (!line) return false;
    const url = extractUrlAtColumn(line, cell.col);
    if (!url) return false;

    ev.preventDefault();
    ev.stopPropagation();
    void invoke("open_external_url", { url }).catch((e) => void showAlert(String(e), "Open link"));
    return true;
  };

  const updateCtrlLinkHover = (term: Terminal, host: HTMLElement, ev: MouseEvent): void => {
    if (!(ev.ctrlKey || ev.metaKey)) {
      host.classList.remove("pane-terminal-host--ctrl-link-hover");
      host.removeAttribute("title");
      return;
    }
    const cell = getTerminalClickCell(term, host, ev);
    if (!cell) {
      host.classList.remove("pane-terminal-host--ctrl-link-hover");
      host.removeAttribute("title");
      return;
    }
    const b = term.buffer.active;
    const clickAbsY = b.viewportY + cell.row;
    const line = b.getLine(clickAbsY)?.translateToString(false) ?? "";
    const url = line ? extractUrlAtColumn(line, cell.col) : null;
    if (!url) {
      host.classList.remove("pane-terminal-host--ctrl-link-hover");
      host.removeAttribute("title");
      return;
    }
    host.classList.add("pane-terminal-host--ctrl-link-hover");
    host.setAttribute("title", `Ctrl+Click to open ${url}`);
  };

  const isTooltipSuppressed = (): boolean =>
    disableTooltipsRef.v || document.documentElement.classList.contains("zen-mode");

  const syncTooltipForElement = (el: HTMLElement, suppress: boolean): void => {
    if (suppress) {
      if (el.hasAttribute("title")) {
        const title = el.getAttribute("title");
        if (title != null) {
          el.setAttribute(TOOLTIP_STASH_ATTR, title);
          el.removeAttribute("title");
        }
      }
      return;
    }

    if (!el.hasAttribute("title") && el.hasAttribute(TOOLTIP_STASH_ATTR)) {
      const original = el.getAttribute(TOOLTIP_STASH_ATTR) ?? "";
      el.setAttribute("title", original);
      el.removeAttribute(TOOLTIP_STASH_ATTR);
    }
  };

  const applyTooltipPolicy = (root: ParentNode = document): void => {
    const suppress = isTooltipSuppressed();
    document.documentElement.classList.toggle("tooltips-disabled", suppress);
    const all = (root as Document | Element).querySelectorAll<HTMLElement>(
      `[title], [${TOOLTIP_STASH_ATTR}]`,
    );
    all.forEach((el) => syncTooltipForElement(el, suppress));
    if (root instanceof HTMLElement) syncTooltipForElement(root, suppress);
  };

  const ensureTooltipObserver = (): void => {
    if (tooltipObserver) return;
    tooltipObserver = new MutationObserver((mutations) => {
      const suppress = isTooltipSuppressed();
      for (const m of mutations) {
        if (m.type === "attributes" && m.target instanceof HTMLElement && m.attributeName === "title") {
          syncTooltipForElement(m.target, suppress);
          continue;
        }
        if (m.type !== "childList") continue;
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          syncTooltipForElement(n, suppress);
          n.querySelectorAll<HTMLElement>("[title], [data-partty-tooltip-title]").forEach((el) =>
            syncTooltipForElement(el, suppress),
          );
        });
      }
    });
    tooltipObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
  };

  ensureTooltipObserver();
  applyTooltipPolicy(document);

  function ensureShellState(paneId: string): ShellIntegrationState {
    let s = paneShellState.get(paneId);
    if (!s) {
      s = createShellIntegrationState();
      paneShellState.set(paneId, s);
    }
    return s;
  }

  function copyToClipboard(text: string): void {
    if (!text) return;
    void navigator.clipboard.writeText(text).catch(() => {});
  }

  function cleanupPaneVisualState(paneId: string): void {
    // Clean up event listeners registered in onPaneCreated.
    const cleanups = paneHostCleanups.get(paneId);
    if (cleanups) {
      for (const fn of cleanups) fn();
      paneHostCleanups.delete(paneId);
    }
    disposeWebglForPane(paneId);
    paneShellState.delete(paneId);
    paneCwdHints.delete(paneId);
    lastPtyDims.delete(paneId);
    pendingPtyWriteByPane.delete(paneId);
    pendingPtyOutputByPane.delete(paneId);
    activeProcesses.delete(paneId);
    processInputBuffers.delete(paneId);
  }

  const paneWebglStates = new Map<string, PaneWebglState>();
  const backendReplayRestoredPanes = new Set<string>();
  /** Pending plain-text replay after `discard_buffer_on_hide` (focused pane). */
  let pendingSnapshot: string | null = null;

  function getFocusedTerm(): Terminal | null {
    const id = paneHost?.getFocusedPaneId();
    if (!id) return null;
    return paneHost?.getPaneTerminal(id)?.term ?? null;
  }

  function getPaneTerminalById(paneId: string): PaneTerminal | null {
    const active = paneHost?.getPaneTerminal(paneId);
    if (active) return active;
    for (const host of tabPaneHosts.values()) {
      const pt = host.getPaneTerminal(paneId);
      if (pt) return pt;
    }
    return null;
  }

  function focusActiveTerminal(): void {
    const id = paneHost?.getFocusedPaneId();
    if (!id) return;
    const term = paneHost?.getPaneTerminal(id)?.term ?? null;
    if (!term) return;
    term.focus();
    void ptyFocusPane(id).catch(() => {});
  }

  function focusFileTreePanel(): boolean {
    if (!document.documentElement.classList.contains("file-tree-on")) return false;
    const dock = document.getElementById("file-tree-dock");
    if (!dock || dock.getAttribute("aria-hidden") === "true") return false;
    const scroll = document.getElementById("file-tree-scroll") as HTMLElement | null;
    if (!scroll) return false;
    scroll.focus();
    return true;
  }

  function focusAdjacentPaneByArrow(key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): boolean {
    const host = paneHost;
    if (!host) return false;
    const currentId = host.getFocusedPaneId();
    if (!currentId) return false;

    const root = host.getHostRoot();
    const leaves = host
      .getLeafIdsInOrder()
      .map((id) => {
        const el = root.querySelector(`.pane-leaf[data-pane-id="${CSS.escape(id)}"]`) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          id,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        };
      })
      .filter((x): x is { id: string; cx: number; cy: number } => x !== null);

    const current = leaves.find((x) => x.id === currentId);
    if (!current) return false;

    let best: { id: string; score: number } | null = null;
    for (const leaf of leaves) {
      if (leaf.id === currentId) continue;
      const dx = leaf.cx - current.cx;
      const dy = leaf.cy - current.cy;

      let directional = false;
      if (key === "ArrowLeft") directional = dx < -8;
      else if (key === "ArrowRight") directional = dx > 8;
      else if (key === "ArrowUp") directional = dy < -8;
      else directional = dy > 8;
      if (!directional) continue;

      const primary = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dx) : Math.abs(dy);
      const secondary = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 0.35;

      if (!best || score < best.score) {
        best = { id: leaf.id, score };
      }
    }

    if (!best) return false;
    host.setFocusedPaneId(best.id);
    return true;
  }

  async function closeFocusedPane(): Promise<void> {
    const id = paneHost?.getFocusedPaneId();
    const root = paneHost?.getRootPaneId();
    if (!id || !root || id === root) return;
    try {
      await ptyKillPane(id);
      paneHost?.removePane(id);
    } catch (e) {
      console.warn("pty_kill_pane", e);
    }
  }

  async function popOutFocusedPane(): Promise<void> {
    const id = paneHost?.getFocusedPaneId();
    const root = paneHost?.getRootPaneId();
    if (!id || !root) return;
    const pt = paneHost?.getPaneTerminal(id);
    if (!pt) return;
    if (id === root) {
      pt.term.write("\r\n\x1b[90mPop out currently requires a child pane.\x1b[0m\r\n");
      return;
    }
    const cwd = paneCwdHints.get(id) ?? liveCwd ?? "";
    const title = cwd ? `Partty - ${cwd}` : "Partty - Detached Pane";
    const snapshot = capturePlainBuffer(pt.term, lp.snapshot_max_lines) || null;
    try {
      await popOutPane(id, title, snapshot);
      paneHost?.removePane(id, { notifyDisposed: false });
      cleanupPaneVisualState(id);
      persistCurrentWorkspaceTabLayout();
      scheduleResizeImmediate();
      scheduleCwdSync();
      const focusedId = paneHost?.getFocusedPaneId();
      if (focusedId) {
        paneHost?.getPaneTerminal(focusedId)?.term.focus();
        void ptyFocusPane(focusedId).catch(() => {});
      }
    } catch (e) {
      console.warn("pop_out_pane", e);
      pt.term.write("\r\n\x1b[31mFailed to pop out pane.\x1b[0m\r\n");
    }
  }

  async function closeAllChildPanes(): Promise<void> {
    const removed = paneHost?.closeAllChildPanes() ?? [];
    for (const id of removed) {
      try {
        await ptyKillPane(id);
      } catch (e) {
        console.warn("pty_kill_pane", e);
      }
    }
    const r = paneHost?.getRootPaneId();
    if (r) {
      paneHost?.getPaneTerminal(r)?.term.focus();
      void ptyFocusPane(r).catch(() => {});
    }
    scheduleResizeImmediate();
    scheduleCwdSync();
  }

  function disposeWebglForPane(paneId: string): void {
    const state = paneWebglStates.get(paneId);
    if (!state) return;
    state.status = "disposed";
    try {
      state.contextLossDispose?.dispose();
    } catch {
      /* ignore */
    }
    try {
      state.addon?.dispose();
    } catch {
      /* ignore */
    }
    paneWebglStates.delete(paneId);
    parttyPerf.mark("webgl.dispose");
    updateWebglPerfGauges();
  }

  function shedWebgl(): void {
    for (const paneId of [...paneWebglStates.keys()]) disposeWebglForPane(paneId);
  }

  function updateWebglPerfGauges(): void {
    let pending = 0;
    let ready = 0;
    let failed = 0;
    for (const state of paneWebglStates.values()) {
      if (state.status === "pending") pending++;
      else if (state.status === "ready") ready++;
      else if (state.status === "failed") failed++;
    }
    parttyPerf.gauge("webgl.panes.pending", pending);
    parttyPerf.gauge("webgl.panes.ready", ready);
    parttyPerf.gauge("webgl.panes.failed", failed);
  }

  async function ensureWebglOnPane(paneId: string): Promise<void> {
    if (!lp.preload_webgl_on_startup && document.visibilityState === "hidden") return;
    const pt = paneHost?.getPaneTerminal(paneId);
    if (!pt) return;
    const existing = paneWebglStates.get(paneId);
    if (existing?.status === "ready" || existing?.status === "pending") return;
    if (existing?.status === "failed" && existing.lastFailureAt && Date.now() - existing.lastFailureAt < 10_000) {
      return;
    }

    const generation = (existing?.generation ?? 0) + 1;
    const state: PaneWebglState = {
      status: "pending",
      attempts: existing?.attempts ?? 0,
      generation,
    };
    paneWebglStates.set(paneId, state);
    updateWebglPerfGauges();
    parttyPerf.mark("webgl.mount.start");

    const delays = [0, 50, 120, 240];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise<void>((r) => setTimeout(r, delays[i]));
      if (paneWebglStates.get(paneId)?.generation !== generation) return;
      const started = performance.now();
      try {
        state.attempts++;
        const addon = await createWebglAddon();
        pt.term.loadAddon(addon);
        const maybeContextLoss = addon as WebglAddon & {
          onContextLoss?: (listener: () => void) => { dispose(): void };
        };
        state.contextLossDispose = maybeContextLoss.onContextLoss?.(() => {
          parttyPerf.mark("webgl.context_loss");
          disposeWebglForPane(paneId);
          void ensureWebglOnPane(paneId);
        });
        state.addon = addon;
        state.status = "ready";
        paneWebglStates.set(paneId, state);
        updateWebglPerfGauges();
        pt.term.refresh(0, pt.term.rows - 1);
        parttyPerf.mark("webgl.mount.ready");
        parttyPerf.time("webgl.mount.ms", performance.now() - started);
        return;
      } catch (e) {
        state.lastError = e;
        parttyPerf.mark("webgl.mount.failure");
      }
    }

    state.status = "failed";
    state.lastFailureAt = Date.now();
    paneWebglStates.set(paneId, state);
    updateWebglPerfGauges();
  }

  async function mountWebglForFocused(): Promise<void> {
    const id = paneHost?.getFocusedPaneId();
    if (!id) return;
    await ensureWebglOnPane(id);
  }

  async function setBackgroundWorkMode(keepAlive: boolean): Promise<void> {
    const current = persisted.prefs as Partial<ParttyPrefs>;
    const next: ParttyPrefs = {
      ...(current as ParttyPrefs),
      shed_on_hide: !keepAlive,
      destroy_webview_on_hide: true,
      webgl_shed_on_hide: true,
      discard_buffer_on_hide: !keepAlive,
    };
    await invoke("set_prefs", { prefs: next });
    persisted.prefs = next as unknown as Record<string, unknown>;
    Object.assign(lp, mergeLifecyclePrefs(persisted.prefs));
  }

  function isBackgroundWorkMode(): boolean {
    const p = persisted.prefs as Partial<ParttyPrefs>;
    return p.shed_on_hide !== true && p.discard_buffer_on_hide !== true;
  }

  function isTerminalVisiblyEmpty(term: Terminal): boolean {
    const active = term.buffer.active;
    if (active.length > 1) return false;
    return (active.getLine(0)?.translateToString(false).trim() ?? "") === "";
  }

  async function replayBackendSnapshotOnce(paneId: string, pt: PaneTerminal): Promise<void> {
    if (backendReplayRestoredPanes.has(paneId)) return;
    backendReplayRestoredPanes.add(paneId);
    if (!isTerminalVisiblyEmpty(pt.term)) return;
    try {
      const snapshot = await ptyReplaySnapshot(paneId);
      if (snapshot) pt.term.write(snapshot);
    } catch (e) {
      console.warn("pty_replay_snapshot", e);
    }
  }

  function toggleFocusedPaneFloating(): boolean {
    const changed = paneHost?.toggleFocusedFloating() ?? false;
    if (!changed) return false;
    persistCurrentWorkspaceTabLayout();
    scheduleResizeImmediate();
    return true;
  }

  function splitFocusedWithCwd(dir: "h" | "v"): string | null {
    const parentId = paneHost?.getFocusedPaneId();
    if (!parentId) return null;
    pendingNewPaneCwd.v = paneCwdHints.get(parentId) ?? null;
    const newId = paneHost?.splitFocused(dir) ?? null;
    if (!newId) pendingNewPaneCwd.v = null;
    return newId;
  }

  function zoomPaneTerminal(paneId: string, direction: number): void {
    const pt = paneHost?.getPaneTerminal(paneId);
    if (!pt || !paneHost) return;
    const current = Number(pt.term.options.fontSize ?? 12);
    const next = Math.max(6, Math.min(32, current + direction));
    if (next === current) return;
    paneHost.setPaneFontSize(paneId, next);
    lastPtyDims.delete(paneId);
    scheduleResizeImmediate(true);
  }

  const pendingZoomByPane = new Map<string, number>();
  let zoomRaf = 0;

  function flushPendingPaneZoom(): void {
    zoomRaf = 0;
    const entries = [...pendingZoomByPane.entries()];
    pendingZoomByPane.clear();
    for (const [paneId, delta] of entries) {
      zoomPaneTerminal(paneId, Math.sign(delta));
    }
  }

  function handlePaneZoomWheel(paneId: string, ev: WheelEvent): void {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    const direction = ev.deltaY < 0 ? 1 : -1;
    pendingZoomByPane.set(paneId, (pendingZoomByPane.get(paneId) ?? 0) + direction);
    if (!zoomRaf) zoomRaf = requestAnimationFrame(flushPendingPaneZoom);
  }

  function openFocusedPaneRename(): void {
    const paneId = paneHost?.getFocusedPaneId();
    if (!paneId) return;
    paneRenamePanel?.open(paneId, paneNames.get(paneId) ?? "");
  }

  function installPaneControlSurface(): void {
    (window as unknown as { parttyPanes?: unknown }).parttyPanes = {
      list: () => paneHost?.getPaneDescriptors() ?? [],
      focused: () => paneHost?.getFocusedPaneDescriptor() ?? null,
      metrics: (paneId?: string) => {
        const id = paneId || paneHost?.getFocusedPaneId();
        return id ? paneHost?.getPaneDescriptor(id, true) ?? null : null;
      },
      focus: (paneId: string) => paneHost?.setFocusedPaneId(paneId),
      rename: (paneId: string, name: string) => {
        const trimmed = String(name ?? "").trim().replace(/\s+/g, "_");
        if (trimmed) paneNames.set(paneId, trimmed);
        else paneNames.delete(paneId);
        persistCurrentWorkspaceTabLayout();
      },
      zoom: (paneId: string, delta: number) => zoomPaneTerminal(paneId, Number(delta) || 0),
    };
  }

  function attachTermKeyHandler(term: Terminal, paneId: string): void {
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key === "Enter"
      ) {
        e.preventDefault();
        queuePtyWrite(paneId, "\n", true);
        return false;
      }
      if (
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        if (focusAdjacentPaneByArrow(e.key)) {
          e.preventDefault();
          return false;
        }
      }
      if (
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        (e.key === "c" || e.key === "C")
      ) {
        if (term.hasSelection()) {
          e.preventDefault();
          copyToClipboard(term.getSelection());
          return false;
        }
        return true;
      }
      // Backspace delete selection
      if (
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key === "Backspace" &&
        term.hasSelection() &&
        backspaceDeleteSelectionRef.v
      ) {
        e.preventDefault();
        // Get the selection using xterm's selection API
        const selection = (term as any)._core._selectionService.selection;
        if (selection) {
          const start = selection.start;
          const end = selection.end;
          const buffer = term.buffer.active;

          // Calculate the actual number of characters between selection start and end
          let backspaceCount = 0;
          if (start && end) {
            if (start.y === end.y) {
              // Single line selection
              backspaceCount = end.x - start.x;
            } else {
              // Multi-line selection: count characters from cursor to selection start
              const cursorX = buffer.cursorX;
              const cursorY = buffer.cursorY;
              if (start.y === cursorY) {
                backspaceCount = cursorX - start.x;
              } else if (end.y === cursorY) {
                backspaceCount = cursorX - end.x;
              } else {
                // Selection doesn't include cursor, just clear it
                term.clearSelection();
                return false;
              }
            }
          }

          // Ensure we don't send negative or zero backspaces
          if (backspaceCount > 0) {
            term.clearSelection();
            // Send backspaces with a small delay to ensure proper rendering
            setTimeout(() => {
              term.paste("\b".repeat(backspaceCount));
            }, 10);
          } else {
            term.clearSelection();
          }
        } else {
          term.clearSelection();
        }
        return false;
      }
      if (isCommandPaletteChord(e)) {
        e.preventDefault();
        return false;
      }
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey &&
        (e.key === "v" || e.key === "V")
      ) {
        e.preventDefault();
        splitFocusedWithCwd("h");
        return false;
      }
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey &&
        (e.key === "h" || e.key === "H")
      ) {
        e.preventDefault();
        splitFocusedWithCwd("v");
        return false;
      }
      if (
        e.ctrlKey &&
        e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        (e.key === "o" || e.key === "O")
      ) {
        e.preventDefault();
        toggleFocusedPaneFloating();
        return false;
      }
      if (
        e.ctrlKey &&
        e.shiftKey &&
        !e.altKey &&
        (e.key === "w" || e.key === "W")
      ) {
        e.preventDefault();
        if (e.metaKey) {
          void closeAllChildPanes();
        } else {
          void closeFocusedPane();
        }
        return false;
      }
      if (
        e.ctrlKey &&
        e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        (e.key === "e" || e.key === "E")
      ) {
        e.preventDefault();
        toggleFileTree();
        return false;
      }
      return true;
    });
  }

  const terminalContent = document.getElementById("terminal-content");
  const stage = document.getElementById("terminal-stage");

  let fileTreePanel: FileTreePanel | null = null;
  let fileTreeBackend: FileTreeBackend | null = null;
  let fileTreeCoordinator: FileTreeCoordinator | null = null;
  let fileTreeRefreshTimer = 0;
  let cwdSyncTimer = 0;

  function refreshAllTerminalThemes(): void {
    // Refresh all tabs so theme changes don't drift on inactive tabs
    for (const host of tabPaneHosts.values()) {
      host.remountPaneSurfaces();
      host.forEachPane((id, pt) => {
        const th = xtermThemeForPane(id);
        pt.term.options.theme = { ...th, cursorAccent: th.background ?? TERM_BG_FALLBACK };
        pt.term.refresh(0, pt.term.rows - 1);
      });
    }
  }

  function applyPaneTheme(paneId: string, prefs: PaneThemePrefs | null): void {
    if (prefs) paneThemes.set(paneId, { ...prefs });
    else paneThemes.delete(paneId);
    paneHost?.remountPaneSurfaces();
    const pt = paneHost?.getPaneTerminal(paneId);
    if (pt) {
      const th = xtermThemeForPane(paneId);
      pt.term.options.theme = { ...th, cursorAccent: th.background ?? TERM_BG_FALLBACK };
      pt.term.refresh(0, pt.term.rows - 1);
    }
  }

  let debounceTimer = 0;
  let layoutRaf = 0;
  let layoutForceRefresh = false;
  let terminalLayoutSuspended = false;
  let pendingSuspendedLayout = false;

  function runLayoutPass(forceRefresh = false): void {
    layoutRaf = 0;
    const shouldForceRefresh = forceRefresh || layoutForceRefresh;
    layoutForceRefresh = false;
    paneHost?.forEachPane((paneId, pt) => {
      const fitStarted = performance.now();
      pt.fit.fit();
      parttyPerf.time("layout.fit.ms", performance.now() - fitStarted);
      const d = ptyDims(pt.fit);
      if (!d) return;
      const safe = clampPtyColsRows(d.cols, d.rows);
      const prev = lastPtyDims.get(paneId);
      const unchanged = prev?.cols === safe.cols && prev?.rows === safe.rows;
      if (unchanged) {
        if (shouldForceRefresh) pt.term.refresh(0, pt.term.rows - 1);
        return;
      }
      lastPtyDims.set(paneId, safe);
      parttyPerf.mark("layout.pty_resize");
      void ptyResize(paneId, safe.cols, safe.rows)
        .then(() => {
          pt.term.refresh(0, pt.term.rows - 1);
        })
        .catch((e) => console.warn("pty_resize", e));
    });
  }

  /** PTY + xterm stay aligned after pane/window refocus (TUIs need SIGWINCH-sized PTY + refresh). */
  function reflowAllPanes(): void {
    lastPtyDims.clear();
    scheduleResizeImmediate(true);
  }

  function scheduleFileTreeRefresh(): void {
    if (fileTreeRefreshTimer) window.clearTimeout(fileTreeRefreshTimer);
    fileTreeRefreshTimer = window.setTimeout(() => {
      fileTreeRefreshTimer = 0;
      if (fileTreeCoordinator) {
        void fileTreeCoordinator.refresh();
      } else {
        void fileTreePanel?.refresh();
      }
    }, 280);
  }

  async function syncCwdFromBackend(): Promise<void> {
    try {
      if (Date.now() - lastLiveCwdSignalAt < 1500) return;
      if (fileTreeCoordinator) {
        await fileTreeCoordinator.syncCwdFromBackend();
        await fileTreeCoordinator.refresh();
        return;
      }
      const paneId = paneHost?.getFocusedPaneId() ?? null;
      const p = await ptyShellCwd(paneId);
      if (p == null || !p.trim()) return;
      const next = p.trim();
      if (normalizeFsPathKey(next) === normalizeFsPathKey(liveCwd ?? "")) return;
      liveCwd = next;
      scheduleFileTreeRefresh();
    } catch {
      /* ignore */
    }
  }

  async function setDeleteConfirmPrompt(enabled: boolean): Promise<void> {
    try {
      const state = await invoke<{ window: Record<string, unknown>; prefs: ParttyPrefs }>(
        "get_persisted_state",
      );
      const next = { ...state.prefs, confirm_delete_prompt: enabled };
      await invoke("set_prefs", { prefs: next });
      confirmDeletePromptRef.v = enabled;
    } catch (e) {
      console.warn("set_prefs(confirm_delete_prompt)", e);
    }
  }

  function setZenMode(next: boolean): void {
    document.documentElement.classList.toggle("zen-mode", next);
    localStorage.setItem(ZEN_MODE_STORAGE_KEY, next ? "1" : "0");
    applyTooltipPolicy(document);
    if (next) setFileTreeEnabled(false);
    scheduleResizeImmediate();
  }

  async function reloadFileTree(): Promise<void> {
    await fileTreePanel?.forceReload();
  }

  function scheduleCwdSync(): void {
    if (cwdSyncTimer) window.clearTimeout(cwdSyncTimer);
    cwdSyncTimer = window.setTimeout(() => {
      cwdSyncTimer = 0;
      void syncCwdFromBackend();
    }, 120);
  }

  function setFileTreeEnabled(on: boolean): void {
    localStorage.setItem(FILE_TREE_STORAGE_KEY, on ? "1" : "0");
    document.documentElement.classList.toggle("file-tree-on", on);
    const btn = document.getElementById("file-tree-toggle");
    if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
    const dock = document.getElementById("file-tree-dock");
    if (dock) dock.setAttribute("aria-hidden", on ? "false" : "true");
    syncFileTreeFolderIcon(on);
    scheduleResizeImmediate();
    void fileTreePanel?.refresh();
  }

  function toggleFileTree(): void {
    setFileTreeEnabled(!document.documentElement.classList.contains("file-tree-on"));
  }

  function focusFileTreeFilter(): boolean {
    if (!document.documentElement.classList.contains("file-tree-on")) {
      setFileTreeEnabled(true);
    }
    if (fileTreePanel?.isFilterFocused()) {
      // If already focused, clear filter and close
      fileTreePanel?.focusFilter();
      return true;
    }
    fileTreePanel?.focusFilter();
    return true;
  }

  function requestLayoutPass(forceRefresh = false): void {
    layoutForceRefresh ||= forceRefresh;
    if (terminalLayoutSuspended) {
      pendingSuspendedLayout = true;
      return;
    }
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      requestAnimationFrame(() => runLayoutPass());
    });
  }

  function scheduleResizeDebounced(forceRefresh = false): void {
    layoutForceRefresh ||= forceRefresh;
    if (terminalLayoutSuspended) {
      pendingSuspendedLayout = true;
      return;
    }
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      requestLayoutPass();
    }, RESIZE_DEBOUNCE_MS);
  }

  function scheduleResizeImmediate(forceRefresh = false): void {
    layoutForceRefresh ||= forceRefresh;
    if (terminalLayoutSuspended) {
      pendingSuspendedLayout = true;
      return;
    }
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = 0;
    requestLayoutPass();
  }

  function setTerminalLayoutSuspended(suspended: boolean): void {
    if (terminalLayoutSuspended === suspended) return;
    terminalLayoutSuspended = suspended;
    document.documentElement.classList.toggle("terminal-layout-suspended", suspended);
    if (!suspended && pendingSuspendedLayout) {
      pendingSuspendedLayout = false;
      scheduleResizeImmediate(true);
    }
  }

  async function ensurePtyForPane(paneId: string, ptIn?: PaneTerminal, initialCwd?: string | null): Promise<void> {
    const pt = ptIn ?? paneHost?.getPaneTerminal(paneId);
    if (!pt) return;
    const effectiveCwd = initialCwd ?? paneCwdHints.get(paneId) ?? null;
    const ensureStarted = performance.now();
    pt.fit.fit();
    let d = ptyDims(pt.fit);
    if (!d) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      pt.fit.fit();
      d = ptyDims(pt.fit);
    }
    if (!d) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      pt.fit.fit();
      d = ptyDims(pt.fit);
    }
    let raw = d ?? { cols: PTY_FALLBACK_COLS, rows: PTY_FALLBACK_ROWS };
    let safe = clampPtyColsRows(raw.cols, raw.rows);
    const maxAttempts = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, 55 * attempt));
        pt.fit.fit();
        const d2 = ptyDims(pt.fit);
        raw = d2 ?? raw;
        safe = clampPtyColsRows(raw.cols, raw.rows);
      }
      try {
        await ptyEnsure(paneId, safe.cols, safe.rows, effectiveCwd);
        await replayBackendSnapshotOnce(paneId, pt);
        lastPtyDims.set(paneId, safe);
        parttyPerf.mark("pty.ensure.success");
        parttyPerf.time("pty.ensure.ms", performance.now() - ensureStarted);
        if (paneId === paneHost?.getFocusedPaneId()) scheduleCwdSync();
        return;
      } catch (e) {
        lastErr = e;
        const msg = String(e).toLowerCase();
        if (/not found|cannot find|does not exist|no such file|access denied|permission denied|invalid/i.test(msg)) {
          break;
        }
      }
    }
    const msg = String(lastErr);
    console.error("pty_ensure failed:", lastErr);
    parttyPerf.mark("pty.ensure.failure");
    parttyPerf.time("pty.ensure.ms", performance.now() - ensureStarted);
    try {
      pt.term.write(`\r\n\x1b[31mShell failed after retries.\x1b[0m \x1b[90m${msg}\x1b[0m\r\n`);
    } catch {
      /* ignore */
    }
  }

  async function remountAuxiliaryForFocus(paneId: string): Promise<void> {
    const pt = paneHost?.getPaneTerminal(paneId);
    if (!pt) return;

    await ensureWebglOnPane(paneId);

    bridgeScrollCleanup?.();
    bridgeScrollCleanup = null;
    const termEl = pt.term.element;
    const bridge = document.getElementById("terminal-chrome-bridge");
    if (termEl && bridge) {
      const vp = termEl.querySelector(".xterm-viewport") as HTMLElement | null;
      if (vp) {
        const onScroll = (): void => {
          const max = vp.scrollHeight - vp.clientHeight;
          const t = max > 0 ? vp.scrollTop / max : 0;
          const intensity = Math.max(0.22, 0.88 - t * 0.66);
          bridge.style.setProperty("--terminal-bridge-intensity", intensity.toFixed(3));
        };
        vp.addEventListener("scroll", onScroll, { passive: true });
        bridgeScrollCleanup = () => vp.removeEventListener("scroll", onScroll);
        onScroll();
      }
    }

    pt.term.focus();
  }

  let tabsState: TabsStateV1 = loadTabsState();
  let activeWorkspaceTabId =
    tabsState.tabs.find((t) => t.id === tabsState.activeTabId)?.id ?? tabsState.tabs[0]?.id ?? "tab-1";
  tabsState = { ...tabsState, activeTabId: activeWorkspaceTabId };
  saveTabsState(tabsState);
  /** One pane host per workspace tab so shells + scrollback survive tab switches. */
  const tabPaneHosts = new Map<string, PaneHost>();
  const tabPaneShells = new Map<string, HTMLElement>();

  function xtermThemeForPane(paneId: string) {
    const paneTheme = paneThemes.get(paneId);
    return paneTheme ? buildXtermThemeFromPrefs(paneTheme) : buildXtermThemeFromDocument();
  }

  function cssVarsForPane(paneId: string): Record<string, string> | null {
    const paneTheme = paneThemes.get(paneId);
    return paneTheme ? themeCssVarsForPrefs(paneTheme) : null;
  }

  function createPaneHost(container: HTMLElement, init: PaneHostInit | undefined, rootPaneId: string): PaneHost {
    return new PaneHost(
      container,
      {
      rootPaneId,
      scrollbackLines: lp.scrollback_lines,
      fontStack: terminalFontStackFromDocument(),
      cursorStyle: cursorStyleRef.v,
      cursorBlink: cursorBlinkRef.v,
      cursorInactiveStyle: cursorInactiveStyleRef.v,
      cursorWidth: cursorWidthRef.v,
      altClickMovesCursor: altClickCursorRef.v,
      fontSize: fontSizeRef.v,
      fontWeight: fontWeightRef.v,
      fontWeightBold: fontWeightBoldRef.v,
      lineHeight: lineHeightRef.v,
      letterSpacing: letterSpacingRef.v,
      drawBoldTextInBrightColors: drawBoldBrightRef.v,
      customGlyphs: customGlyphsRef.v,
      smoothScrollDuration: smoothScrollRef.v,
      scrollSensitivity: scrollSensitivityRef.v,
      fastScrollSensitivity: fastScrollSensitivityRef.v,
      minimumContrastRatio: contrastRatioRef.v,
      windowsPty: windowsPtyInfo,
      linkHandler: {
        activate: (_event, uri) => {
          if (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("mailto:")) {
            void invoke("open_external_url", { url: uri }).catch((e) => void showAlert(String(e), "Open link"));
          }
        },
      },
      getTheme: (paneId) => xtermThemeForPane(paneId),
      getPaneName: (paneId) => paneNames.get(paneId),
      getPaneCssVars: (paneId) => cssVarsForPane(paneId),
      getSplitLayoutStyle: () => splitLayoutStyleRef.v,
      focusFollowsCursor: () => focusFollowsRef.v,
      onPaneFocus: (id) => {
        lastFocusedPaneId = id;
        if (paneRenamePanel?.isOpen()) paneRenamePanel.setPane(id, paneNames.get(id) ?? "");
        paneHost?.getPaneTerminal(id)?.term.focus();
        void ptyFocusPane(id).catch(() => {});
        fileTreePanel?.setActivePane(id);
        if (fileTreeCoordinator) {
          fileTreeCoordinator.seedPaneCwd(id, paneCwdHints.get(id));
          fileTreeCoordinator.handlePaneFocus(id);
        } else {
          const hint = paneCwdHints.get(id);
          if (hint) {
            liveCwd = hint;
            scheduleFileTreeRefresh();
          }
        }
        void syncCwdFromBackend();
        void remountAuxiliaryForFocus(id);
      },
      onPaneCreated: (id, pt) => {
        attachTermKeyHandler(pt.term, id);
        pt.term.onData((data) => {
          queuePtyWrite(id, data);
          // Observe input keystrokes for process tracking (command start detection).
          // Mirrors the old CommandHistoryStore.observeInput approach: parse raw
          // keystrokes, strip ANSI/OSC sequences, handle editing keystrokes.
          {
            let buf = processInputBuffers.get(id) ?? "";
            let i = 0;
            while (i < data.length) {
              const ch = data[i];
              const code = ch.charCodeAt(0);

              // Skip ANSI escape / CSI / OSC sequences entirely.
              if (ch === "\x1b") {
                if (data[i + 1] === "]") {
                  // OSC: \x1b] ... BEL or ST
                  const end = data.indexOf("\x07", i + 2);
                  const st = data.indexOf("\x1b\\", i + 2);
                  let n = end === -1 ? st : st === -1 ? end : Math.min(end, st);
                  i = n === -1 ? data.length : n + (data[n] === "\x1b" ? 2 : 1);
                  continue;
                }
                if (data[i + 1] === "[") {
                  // CSI: \x1b[ ... final byte @–~
                  let j = i + 2;
                  while (j < data.length && data.charCodeAt(j) < 0x40) j++;
                  i = j < data.length ? j + 1 : data.length;
                  continue;
                }
                if (data[i + 1] === "P" || data[i + 1] === "_" || data[i + 1] === "^" || data[i + 1] === "X") {
                  // DCS / APC / PM / SOS terminated by ST
                  const st = data.indexOf("\x1b\\", i + 2);
                  i = st === -1 ? data.length : st + 2;
                  continue;
                }
                // Other escape (e.g. \x1bO for SS3 sequences): skip 2 chars
                i += 2;
                continue;
              }

              // Enter — finalize the command.
              if (ch === "\r" || ch === "\n") {
                const cmd = buf.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
                if (cmd) {
                  activeProcesses.set(id, { command: cmd, startedAt: Date.now(), cwd: paneCwdHints.get(id) || "" });
                }
                buf = "";
                i++;
                continue;
              }

              // Backspace (BS or DEL).
              if (ch === "\b" || code === 0x7f) {
                buf = buf.slice(0, -1);
                i++;
                continue;
              }

              // Ctrl+W  or  Ctrl+Backspace → delete last word.
              if (code === 0x17 || ch === "\x1b\x7f" || ch === "\x1b\x08") {
                buf = buf.replace(/\S+\s*$/, "").trimEnd();
                i++;
                continue;
              }

              // Ctrl+U → clear line.
              if (code === 0x15) {
                buf = "";
                i++;
                continue;
              }

              // Printable character or tab.
              if ((code >= 0x20 && code !== 0x7f) || code === 0x09) {
                buf += ch;
                i++;
                continue;
              }

              // Unknown control char — skip.
              i++;
            }
            processInputBuffers.set(id, buf);
          }
          if (data.includes("\r") || data.includes("\n")) {
            scheduleCwdSync();
          }
        });
        const onHostClick = (ev: MouseEvent) => {
          if (openLinkFromCtrlClick(pt.term, pt.host, ev)) return;
        };
        const onHostWheel = (ev: WheelEvent) => handlePaneZoomWheel(id, ev);
        const onHostMouseMove = (ev: MouseEvent) => {
          updateCtrlLinkHover(pt.term, pt.host, ev);
        };
        const onHostMouseLeave = () => {
          pt.host.classList.remove("pane-terminal-host--ctrl-link-hover");
          pt.host.removeAttribute("title");
        };
        pt.host.addEventListener("click", onHostClick);
        pt.host.addEventListener("wheel", onHostWheel, { passive: false });
        pt.host.addEventListener("mousemove", onHostMouseMove);
        pt.host.addEventListener("mouseleave", onHostMouseLeave);
        const onSelDispose = pt.term.onSelectionChange(() => {
          if (!autoCopySelectionRef.v || !pt.term.hasSelection()) return;
          copyToClipboard(pt.term.getSelection());
        });

        // Register cleanup for pane teardown.
        paneHostCleanups.set(id, [
          () => pt.host.removeEventListener("click", onHostClick),
          () => pt.host.removeEventListener("wheel", onHostWheel),
          () => pt.host.removeEventListener("mousemove", onHostMouseMove),
          () => pt.host.removeEventListener("mouseleave", onHostMouseLeave),
          () => onSelDispose.dispose(),
        ]);
        if (lp.preload_webgl_on_startup) void ensureWebglOnPane(id);
        const explicitCwd = pendingNewPaneCwd.v;
        pendingNewPaneCwd.v = null;
        const inheritedCwd = explicitCwd ?? paneCwdHints.get(id) ?? null;
        if (inheritedCwd) paneCwdHints.set(id, inheritedCwd);
        queueMicrotask(() => {
          void ensurePtyForPane(id, pt, inheritedCwd);
        });
      },
      onPaneDisposed: (pid) => {
        void ptyKillPane(pid).catch(() => {});
        paneNames.delete(pid);
        paneThemes.delete(pid);
        cleanupPaneVisualState(pid);
        fileTreePanel?.clearPaneState(pid);
        fileTreeCoordinator?.handlePaneDispose(pid);
      },
      onPaneLayout: () => scheduleResizeImmediate(),
      onPaneLayoutDrag: (dragging) => setTerminalLayoutSuspended(dragging),
      onPaneReorder: () => persistCurrentWorkspaceTabLayout(),
    },
      init,
    );
  }

  function createTabPaneShellAndHost(tabId: string, init: PaneHostInit): PaneHost {
    const paneRoot = document.getElementById("terminal-pane-root");
    if (!paneRoot) throw new Error("#terminal-pane-root missing");
    const shell = document.createElement("div");
    shell.className = "term-tab-pane-shell";
    shell.dataset.tabId = tabId;
    paneRoot.appendChild(shell);
    const rid = workspaceRootPaneId(tabId);
    const host = createPaneHost(shell, init, rid);
    tabPaneHosts.set(tabId, host);
    tabPaneShells.set(tabId, shell);
    return host;
  }

  for (let i = 0; i < tabsState.tabs.length; i++) {
    const tab = tabsState.tabs[i]!;
    let layout = initialLayoutForTab(tab.id, i === 0);
    if (!isWorkspaceLayoutUsable(layout, tab.id)) {
      layout = emptyWorkspaceLayout(tab.id);
    }
    for (const [paneId, theme] of Object.entries(layout.paneThemes ?? {})) {
      paneThemes.set(paneId, { ...theme });
    }
    for (const [paneId, name] of Object.entries(layout.paneNames ?? {})) {
      const cleaned = name.trim().replace(/\s+/g, "_");
      if (cleaned) paneNames.set(paneId, cleaned);
    }
    createTabPaneShellAndHost(tab.id, {
      initialTree: layout.tree,
      initialFocusedId: layout.focusedId,
      initialFloating: layout.floating,
    });
    if (tab.id !== activeWorkspaceTabId) {
      tabPaneShells.get(tab.id)?.classList.add("term-tab-pane-shell--hidden");
    }
  }
  paneHost = tabPaneHosts.get(activeWorkspaceTabId)!;
  lastFocusedPaneId = paneHost.getFocusedPaneId();
  installPaneControlSurface();

  function persistCurrentWorkspaceTabLayout(): void {
    if (!paneHost) return;
    const pl = layoutForPaneHost(paneHost);
    if (!pl) return;
    persistLayoutForTab(activeWorkspaceTabId, pl);
  }

  function layoutForPaneHost(host: PaneHost): PersistedPaneLayout | null {
    const tree = host.getTree();
    const rid = host.getRootPaneId();
    if (!tree || !findPaneLeaf(tree, rid)) return null;
    const panes = host.getPaneDescriptors();
    return {
      v: 1,
      tree,
      focusedId: host.getFocusedPaneId(),
      floating: host.getFloatingState(),
      paneThemes: Object.fromEntries(
        panes
          .filter((pane) => paneThemes.has(pane.id))
          .map((pane) => [pane.id, paneThemes.get(pane.id)!]),
      ),
      paneNames: Object.fromEntries(
        panes
          .filter((pane) => paneNames.has(pane.id))
          .map((pane) => [pane.id, paneNames.get(pane.id)!]),
      ),
    };
  }

  function switchWorkspaceTab(tabId: string): void {
    if (tabId === activeWorkspaceTabId) return;
    const nextHost = tabPaneHosts.get(tabId);
    if (!nextHost) return;
    persistCurrentWorkspaceTabLayout();

    const nextShell = tabPaneShells.get(tabId);

    activeWorkspaceTabId = tabId;
    tabsState = { ...tabsState, activeTabId: tabId };
    saveTabsState(tabsState);

    // Clean up stale animation classes from any previous rapid switches,
    // then hide all shells except the target. We'll animate just the target entering.
    for (const shell of tabPaneShells.values()) {
      shell.classList.remove("term-tab-pane-shell--entering", "term-tab-pane-shell--leaving");
    }
    for (const [id, shell] of tabPaneShells) {
      shell.classList.toggle("term-tab-pane-shell--hidden", id !== tabId);
    }

    if (nextShell) {
      nextShell.classList.remove("term-tab-pane-shell--hidden");
      nextShell.classList.add("term-tab-pane-shell--entering");
      const capturedTabId = tabId;
      const onDone = () => {
        nextShell.removeEventListener("animationend", onDone);
        if (activeWorkspaceTabId !== capturedTabId) {
          nextShell.classList.remove("term-tab-pane-shell--entering");
          if (!tabPaneShells.get(capturedTabId)?.classList.contains("term-tab-pane-shell--entering")) {
            tabPaneShells.get(capturedTabId)?.classList.add("term-tab-pane-shell--hidden");
          }
          return;
        }
        nextShell.classList.remove("term-tab-pane-shell--entering");
      };
      nextShell.addEventListener("animationend", onDone);
    }

    paneHost = nextHost;
    lastFocusedPaneId = paneHost.getFocusedPaneId();
    fileTreePanel?.setActivePane(lastFocusedPaneId);
    if (fileTreeCoordinator) {
      fileTreeCoordinator.seedPaneCwd(lastFocusedPaneId, paneCwdHints.get(lastFocusedPaneId));
      fileTreeCoordinator.handlePaneFocus(lastFocusedPaneId);
    } else {
      const hint = paneCwdHints.get(lastFocusedPaneId);
      if (hint) {
        liveCwd = hint;
        scheduleFileTreeRefresh();
      }
    }
    document.documentElement.classList.toggle("term-tabs-multiple", tabsState.tabs.length > 1);
    renderWorkspaceTabsBar();
    scheduleResizeImmediate();
    scheduleCwdSync();
    getFocusedTerm()?.focus();
  }

  function visibleWorkspaceTabsInOrder(): TabRecord[] {
    const sortedTabs = [...tabsState.tabs].sort((a, b) => a.order - b.order);
    const sortedGroups = [...tabsState.groups].sort((a, b) => a.order - b.order);
    const groupedTabs = new Map<string, TabRecord[]>();
    for (const tab of sortedTabs) {
      if (!tab.groupId) continue;
      const bucket = groupedTabs.get(tab.groupId) ?? [];
      bucket.push(tab);
      groupedTabs.set(tab.groupId, bucket);
    }
    const items: Array<{ type: "tab" | "group"; order: number; tab?: TabRecord; group?: TabGroup }> = [];
    for (const tab of sortedTabs) {
      if (!tab.groupId) items.push({ type: "tab", order: tab.order, tab });
    }
    for (const group of sortedGroups) items.push({ type: "group", order: group.order, group });
    items.sort((a, b) => a.order - b.order);

    const visible: TabRecord[] = [];
    for (const item of items) {
      if (item.type === "tab" && item.tab) visible.push(item.tab);
      else if (item.type === "group" && item.group && !item.group.collapsed) {
        visible.push(...(groupedTabs.get(item.group.id) ?? []));
      }
    }
    return visible;
  }

  function tabForHotkeyIndex(index: number): TabRecord | null {
    return visibleWorkspaceTabsInOrder()[index] ?? null;
  }

  function switchOrCreateTabForHotkeyIndex(index: number): void {
    const existing = tabForHotkeyIndex(index);
    if (existing) switchWorkspaceTab(existing.id);
    else openNewWorkspaceTab();
  }

  function moveFocusedPaneToTabHotkeyIndex(index: number): void {
    const sourceTabId = activeWorkspaceTabId;
    const sourceHost = paneHost;
    const paneId = sourceHost?.getFocusedPaneId();
    if (!sourceHost || !paneId || paneId === sourceHost.getRootPaneId()) return;
    const existing = tabForHotkeyIndex(index);
    const targetTabId = existing?.id ?? openNewWorkspaceTab(false);
    if (targetTabId === sourceTabId) return;
    const targetHost = tabPaneHosts.get(targetTabId);
    if (!targetHost) return;
    const pt = sourceHost.takePane(paneId);
    if (!pt) return;
    if (!targetHost.receivePane(paneId, pt, "h")) return;
    const sourceLayout = layoutForPaneHost(sourceHost);
    if (sourceLayout) persistLayoutForTab(sourceTabId, sourceLayout);
    const targetLayout = layoutForPaneHost(targetHost);
    if (targetLayout) persistLayoutForTab(targetTabId, targetLayout);
    switchWorkspaceTab(targetTabId);
    scheduleResizeImmediate(true);
  }

  const tabMenuEl = document.getElementById("tab-context-menu");

  function hideTabContextMenu(): void {
    tabMenuEl?.classList.add("tab-context-menu--hidden");
    tabMenuEl?.replaceChildren();
    tabMenuEl?.setAttribute("aria-hidden", "true");
  }

  function duplicateWorkspaceTab(fromTabId: string): void {
    persistCurrentWorkspaceTabLayout();
    const raw = loadLayoutForTab(fromTabId) ?? emptyWorkspaceLayout(fromTabId);
    const newId = crypto.randomUUID();
    const dup = duplicateTabLayout(raw, fromTabId, newId);
    persistLayoutForTab(newId, dup);
    const sourceName = tabsState.tabs.find((t) => t.id === fromTabId)?.name ?? nextTabName(tabsState.tabs);
    const existing = new Set(tabsState.tabs.map((t) => t.name.toLowerCase()));
    const m = sourceName.match(/^(.*?)(\d+)?$/);
    const base = (m?.[1] ?? sourceName).trimEnd() || sourceName;
    let n = Number.parseInt(m?.[2] ?? "", 10);
    if (!Number.isFinite(n)) n = 1;
    let candidate = `${base}${n + 1}`;
    while (existing.has(candidate.toLowerCase())) {
      n += 1;
      candidate = `${base}${n + 1}`;
    }
    const sourceTab = tabsState.tabs.find((t) => t.id === fromTabId);
const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
tabsState = { ...tabsState, tabs: [...tabsState.tabs, { id: newId, name: candidate, groupId: sourceTab?.groupId ?? null, color: sourceTab?.color ?? null, order: maxOrder + 1 }] };
    saveTabsState(tabsState);
    createTabPaneShellAndHost(newId, { initialTree: dup.tree, initialFocusedId: dup.focusedId });
    switchWorkspaceTab(newId);
  }

  function disposeTabPaneHost(tabId: string): void {
    const h = tabPaneHosts.get(tabId);
    if (h) {
      h.dispose();
      tabPaneHosts.delete(tabId);
    }
    const shell = tabPaneShells.get(tabId);
    shell?.remove();
    tabPaneShells.delete(tabId);
  }

  function closeWorkspaceTab(tabId: string): void {
    if (tabsState.tabs.length <= 1) return;
    const idx = tabsState.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    persistCurrentWorkspaceTabLayout();
    if (tabId === activeWorkspaceTabId) {
      const other = tabsState.tabs[idx + 1] ?? tabsState.tabs[idx - 1];
      if (!other) return;
      switchWorkspaceTab(other.id);
    }
    tabsState = { ...tabsState, tabs: tabsState.tabs.filter((t) => t.id !== tabId) };
    saveTabsState(tabsState);
    disposeTabPaneHost(tabId);
    try {
      localStorage.removeItem(`partty.tab.layout.v1.${tabId}`);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle("term-tabs-multiple", tabsState.tabs.length > 1);
    renderWorkspaceTabsBar();
    scheduleResizeImmediate();
    getFocusedTerm()?.focus();
  }

  let renamingTabId: string | null = null;
  let renamingGroupId: string | null = null;

  function finishTabRename(commit: boolean): void {
    const id = renamingTabId;
    if (!id) return;
    const strip = document.getElementById("term-tabs-strip");
    const inp = strip?.querySelector(`input[data-tab-rename="${id}"]`) as HTMLInputElement | null;
    const raw = inp?.value ?? "";
    renamingTabId = null;
    if (commit) {
      const v = raw.trim();
      if (v) {
        const t = tabsState.tabs.find((x) => x.id === id);
        if (t) t.name = v;
        saveTabsState(tabsState);
      }
    }
    renderWorkspaceTabsBar();
  }

  function openZenRenameModal(): void {
    const modal = document.getElementById("zen-rename-modal");
    const input = document.getElementById("zen-rename-input") as HTMLInputElement | null;
    const form = modal?.querySelector(".zen-rename-form") as HTMLFormElement | null;
    if (!modal || !input || !form) return;
    const tab = tabsState.tabs.find((t) => t.id === renamingTabId);
    input.value = tab?.name ?? "";
    modal.classList.remove("zen-rename-modal--hidden");
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function closeZenRenameModal(commit: boolean): void {
    const modal = document.getElementById("zen-rename-modal");
    if (!modal) return;
    modal.classList.add("zen-rename-modal--hidden");
    modal.setAttribute("aria-hidden", "true");
    if (commit) {
      const id = renamingTabId;
      const input = document.getElementById("zen-rename-input") as HTMLInputElement | null;
      const v = input?.value.trim();
      if (id && v) {
        const t = tabsState.tabs.find((x) => x.id === id);
        if (t) t.name = v;
        saveTabsState(tabsState);
      }
    }
    renamingTabId = null;
    renderWorkspaceTabsBar();
    getFocusedTerm()?.focus();
  }

  function beginTabRename(tabId: string): void {
    renamingTabId = tabId;
    if (document.documentElement.classList.contains("zen-mode")) {
      openZenRenameModal();
      return;
    }
    renderWorkspaceTabsBar();
    requestAnimationFrame(() => {
      const strip = document.getElementById("term-tabs-strip");
      const inp = strip?.querySelector(`input[data-tab-rename="${tabId}"]`) as HTMLInputElement | null;
      inp?.focus();
      inp?.select();
    });
  }

  function finishGroupRename(commit: boolean): void {
    const id = renamingGroupId;
    if (!id) return;
    const strip = document.getElementById("term-tabs-strip");
    const inp = strip?.querySelector(`input[data-group-rename="${id}"]`) as HTMLInputElement | null;
    const raw = inp?.value ?? "";
    renamingGroupId = null;
    if (commit) {
      const v = raw.trim();
      if (v) {
        const g = tabsState.groups.find((x) => x.id === id);
        if (g) g.name = v;
        saveTabsState(tabsState);
      }
    }
    renderWorkspaceTabsBar();
  }

  function beginGroupRename(groupId: string): void {
    renamingGroupId = groupId;
    renderWorkspaceTabsBar();
    requestAnimationFrame(() => {
      const strip = document.getElementById("term-tabs-strip");
      const inp = strip?.querySelector(`input[data-group-rename="${groupId}"]`) as HTMLInputElement | null;
      inp?.focus();
      inp?.select();
    });
  }

  function openNewWorkspaceTab(switchTo = true): string {
    const id = crypto.randomUUID();
    const name = nextTabName(tabsState.tabs);
    const empty = emptyWorkspaceLayout(id);
    const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
    tabsState = { ...tabsState, tabs: [...tabsState.tabs, { id, name, groupId: null, color: null, order: maxOrder + 1 }] };
    saveTabsState(tabsState);
    persistLayoutForTab(id, empty);
    createTabPaneShellAndHost(id, { initialTree: empty.tree, initialFocusedId: empty.focusedId });
    if (switchTo) switchWorkspaceTab(id);
    else renderWorkspaceTabsBar();
    return id;
  }

  function openTabContextMenu(clientX: number, clientY: number, tab: TabRecord): void {
    if (!tabMenuEl) return;
    tabMenuEl.replaceChildren();
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab-context-menu-item";
      b.role = "menuitem";
      b.textContent = label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hideTabContextMenu();
        fn();
      });
      tabMenuEl.appendChild(b);
    };
    mk("Rename", () => {
      beginTabRename(tab.id);
    });
    mk("Set color", () => {
      const input = document.createElement("input");
      input.type = "color";
      input.value = tab.color || "#ffffff";
      input.style.position = "absolute";
      input.style.left = "-9999px";
      input.style.top = "-9999px";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.addEventListener("input", () => {
        tabsState = {
          ...tabsState,
          tabs: tabsState.tabs.map((t) => t.id === tab.id ? { ...t, color: input.value } : t),
        };
        saveTabsState(tabsState);
        renderWorkspaceTabsBar();
      });
      input.addEventListener("change", () => {
        document.body.removeChild(input);
      });
      input.addEventListener("cancel", () => {
        document.body.removeChild(input);
      });
      input.click();
    });
    mk("Duplicate", () => duplicateWorkspaceTab(tab.id));
    mk("Add to new group", () => {
      const groupId = crypto.randomUUID();
      const groupName = `Group ${tabsState.groups.length + 1}`;
      const maxOrder = Math.max(0, ...tabsState.groups.map((g) => g.order));
      tabsState = {
        ...tabsState,
        groups: [...tabsState.groups, { id: groupId, name: groupName, color: null, collapsed: false, order: maxOrder + 1 }],
        tabs: tabsState.tabs.map((t) => t.id === tab.id ? { ...t, groupId } : t),
      };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    });
    if (tabsState.groups.length > 0) {
      mk("Add to existing group", () => {
        const groupNames = tabsState.groups.map((g) => g.name);
        const groupName = prompt("Enter group name:", groupNames[0]);
        if (groupName) {
          const group = tabsState.groups.find((g) => g.name === groupName);
          if (group) {
            tabsState = {
              ...tabsState,
              tabs: tabsState.tabs.map((t) => t.id === tab.id ? { ...t, groupId: group.id } : t),
            };
            saveTabsState(tabsState);
            renderWorkspaceTabsBar();
          }
        }
      });
    }
    if (tab.groupId) {
      mk("Remove from group", () => {
        tabsState = {
          ...tabsState,
          tabs: tabsState.tabs.map((t) => t.id === tab.id ? { ...t, groupId: null } : t),
        };
        saveTabsState(tabsState);
        renderWorkspaceTabsBar();
      });
    }
    if (tabsState.tabs.length > 1) {
      mk("Close", () => closeWorkspaceTab(tab.id));
    }
    tabMenuEl.style.left = `${Math.min(clientX, window.innerWidth - 160)}px`;
    tabMenuEl.style.top = `${Math.min(clientY, window.innerHeight - 120)}px`;
    tabMenuEl.classList.remove("tab-context-menu--hidden");
    tabMenuEl.setAttribute("aria-hidden", "false");
  }

  function openGroupContextMenu(clientX: number, clientY: number, group: TabGroup): void {
    if (!tabMenuEl) return;
    tabMenuEl.replaceChildren();
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab-context-menu-item";
      b.role = "menuitem";
      b.textContent = label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hideTabContextMenu();
        fn();
      });
      tabMenuEl.appendChild(b);
    };
    mk("Rename group", () => {
      beginGroupRename(group.id);
    });
    mk("Set group color", () => {
      const input = document.createElement("input");
      input.type = "color";
      input.value = group.color || "#ffffff";
      input.style.position = "absolute";
      input.style.left = "-9999px";
      input.style.top = "-9999px";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.addEventListener("input", () => {
        tabsState = {
          ...tabsState,
          groups: tabsState.groups.map((g) => g.id === group.id ? { ...g, color: input.value } : g),
        };
        saveTabsState(tabsState);
        renderWorkspaceTabsBar();
      });
      input.addEventListener("change", () => {
        document.body.removeChild(input);
      });
      input.addEventListener("cancel", () => {
        document.body.removeChild(input);
      });
      input.click();
    });
    mk(group.collapsed ? "Expand group" : "Collapse group", () => {
      tabsState = {
        ...tabsState,
        groups: tabsState.groups.map((g) => g.id === group.id ? { ...g, collapsed: !g.collapsed } : g),
      };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    });
    mk("Disband group", () => {
      tabsState = {
        ...tabsState,
        groups: tabsState.groups.filter((g) => g.id !== group.id),
        tabs: tabsState.tabs.map((t) => (t.groupId === group.id ? { ...t, groupId: null } : t)),
      };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    });
    tabMenuEl.style.left = `${Math.min(clientX, window.innerWidth - 160)}px`;
    tabMenuEl.style.top = `${Math.min(clientY, window.innerHeight - 120)}px`;
    tabMenuEl.classList.remove("tab-context-menu--hidden");
    tabMenuEl.setAttribute("aria-hidden", "false");
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (tabMenuEl?.classList.contains("tab-context-menu--hidden")) return;
      if (tabMenuEl && !tabMenuEl.contains(e.target as Node)) hideTabContextMenu();
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (/^[0-9]$/.test(e.key)) {
        const index = e.key === "0" ? 9 : Number.parseInt(e.key, 10) - 1;
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) moveFocusedPaneToTabHotkeyIndex(index);
        else switchOrCreateTabForHotkeyIndex(index);
        return;
      }
      if (e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
        return;
      }

      const t = e.target as HTMLElement | null;
      const inFileTree = Boolean(t?.closest("#file-tree-dock"));
      if (inFileTree) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          focusActiveTerminal();
        }
        return;
      }

      if (e.key === "ArrowLeft" && focusFileTreePanel()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (focusAdjacentPaneByArrow(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("#file-tree-dock")) return;
      const terminalRoot = document.getElementById("terminal-pane-root");
      if (!terminalRoot || !terminalRoot.contains(target)) return;
      if (target.closest("input, textarea, select, button, [contenteditable='true']")) return;
      focusActiveTerminal();
    },
    true,
  );

  function renderWorkspaceTabsBar(): void {
    const strip = document.getElementById("term-tabs-strip");
    if (!strip) return;
    strip.replaceChildren();
    const mult = tabsState.tabs.length > 1;
    document.documentElement.classList.toggle("term-tabs-multiple", mult);

    // Sort tabs and groups by order
    const sortedTabs = [...tabsState.tabs].sort((a, b) => a.order - b.order);
    const sortedGroups = [...tabsState.groups].sort((a, b) => a.order - b.order);

    // Group tabs by groupId
    const groupedTabs = new Map<string, TabRecord[]>();
    for (const tab of sortedTabs) {
      if (tab.groupId) {
        if (!groupedTabs.has(tab.groupId)) {
          groupedTabs.set(tab.groupId, []);
        }
        groupedTabs.get(tab.groupId)!.push(tab);
      }
    }

    // Create a unified list of items (tabs and groups) sorted by order
    const items: Array<{ type: "tab" | "group", order: number, tab?: TabRecord, group?: TabGroup }> = [];
    for (const tab of sortedTabs) {
      if (!tab.groupId) {
        items.push({ type: "tab", order: tab.order, tab });
      }
    }
    for (const group of sortedGroups) {
      items.push({ type: "group", order: group.order, group });
    }

    // Render items in order
    for (const item of items) {
      if (item.type === "tab" && item.tab) {
        renderTab(strip, item.tab);
      } else if (item.type === "group" && item.group) {
        const group = item.group;
        const tabs = groupedTabs.get(group.id) || [];

        // Render group header
        if (renamingGroupId === group.id) {
          const renameWrap = document.createElement("div");
          renameWrap.className = "term-tab-rename-row";
          renameWrap.dataset.groupId = group.id;
          const input = document.createElement("input");
          input.type = "text";
          input.className = "term-tab-rename-input";
          input.dataset.groupRename = group.id;
          input.value = group.name;
          input.autocomplete = "off";
          input.spellcheck = false;
          input.setAttribute("aria-label", "Group name");
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finishGroupRename(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finishGroupRename(false);
            }
          });
          input.addEventListener("blur", () => finishGroupRename(true));
          renameWrap.appendChild(input);
          strip.appendChild(renameWrap);
          continue;
        }

        const groupHeader = document.createElement("div");
        groupHeader.className = "term-tab-group";
        groupHeader.draggable = true;
        if (group.color) {
          groupHeader.style.setProperty("--tab-group-color", group.color);
        }

        const groupName = document.createElement("span");
        groupName.className = "term-tab-group-name";
        groupName.textContent = group.name;
        groupHeader.appendChild(groupName);

        groupHeader.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          openGroupContextMenu(ev.clientX, ev.clientY, group);
        });

        groupHeader.addEventListener("dragstart", (e) => {
          groupDragId = group.id;
          groupHeader.classList.add("term-tab-group--dragging");
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", group.id);
          }
        });

        groupHeader.addEventListener("dragend", () => {
          groupDragId = null;
          groupHeader.classList.remove("term-tab-group--dragging");
        });

        groupHeader.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        });

        groupHeader.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const from = tabDragId;
          tabDragId = null;
          document.querySelectorAll(".term-tab--dragging").forEach((el) => el.classList.remove("term-tab--dragging"));
          if (!from) return;
          tabsState = {
            ...tabsState,
            tabs: tabsState.tabs.map((t) => t.id === from ? { ...t, groupId: group.id } : t),
          };
          saveTabsState(tabsState);
          renderWorkspaceTabsBar();
        });

        strip.appendChild(groupHeader);

        // Render tabs in group (if not collapsed)
        if (!group.collapsed) {
          const groupTabsContainer = document.createElement("div");
          groupTabsContainer.className = "term-tab-group-tabs";
          if (group.color) {
            groupTabsContainer.style.setProperty("--tab-group-color", group.color);
          }
          for (const tab of tabs) {
            renderTab(groupTabsContainer, tab, group.color);
          }
          strip.appendChild(groupTabsContainer);
        }
      }
    }

    function renderTab(strip: HTMLElement, tab: TabRecord, groupColor: string | null = null): void {
      if (renamingTabId === tab.id) {
        const renameWrap = document.createElement("div");
        renameWrap.className = "term-tab-rename-row";
        renameWrap.dataset.tabId = tab.id;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "term-tab-rename-input";
        input.dataset.tabRename = tab.id;
        input.value = tab.name;
        input.autocomplete = "off";
        input.spellcheck = false;
        input.setAttribute("aria-label", "Tab name");
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finishTabRename(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finishTabRename(false);
          }
        });
        input.addEventListener("blur", () => finishTabRename(true));
        renameWrap.appendChild(input);
        strip.appendChild(renameWrap);
        return;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "term-tab";
      btn.dataset.tabId = tab.id;
      btn.title = "Right-click for tab actions";
      btn.draggable = true;
      btn.role = "tab";
      btn.setAttribute("aria-selected", tab.id === activeWorkspaceTabId ? "true" : "false");
      if (tab.id === activeWorkspaceTabId) btn.classList.add("term-tab--active");

      // Apply tab color (from tab itself or from group)
      const tabColor = tab.color || groupColor;
      if (tabColor) {
        btn.style.setProperty("--tab-color", tabColor);
      }

      const label = document.createElement("span");
      label.className = "term-tab-label";
      label.textContent = tab.name;
      btn.appendChild(label);

      if (tabsState.tabs.length > 1) {
        const closeHit = document.createElement("span");
        closeHit.className = "term-tab-close-hit";
        closeHit.setAttribute("aria-hidden", "true");
        closeHit.title = "Close tab";
        closeHit.appendChild(createTabCloseIcon());
        btn.appendChild(closeHit);
      }

      btn.addEventListener("click", (ev) => {
        if (performance.now() < suppressTabClickUntilMs) return;
        const t = ev.target as HTMLElement;
        if (tabsState.tabs.length > 1 && t.closest(".term-tab-close-hit")) {
          ev.preventDefault();
          ev.stopPropagation();
          closeWorkspaceTab(tab.id);
          return;
        }
        switchWorkspaceTab(tab.id);
      });
      btn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        openTabContextMenu(ev.clientX, ev.clientY, tab);
      });

      // Attach dragstart directly to the tab element
      btn.addEventListener("dragstart", (e) => {
        tabDragId = tab.id;
        btn.classList.add("term-tab--dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tab.id);
        }
      });

      strip.appendChild(btn);
    }
  }

  document.getElementById("term-tab-new")?.addEventListener("click", () => {
    openNewWorkspaceTab();
  });

  let tabDragId: string | null = null;
  let groupDragId: string | null = null;
  let suppressTabClickUntilMs = 0;
  document.getElementById("term-tabs-strip")?.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });
  document.getElementById("term-tabs-strip")?.addEventListener("drop", (e) => {
    e.preventDefault();
    const fromTab = tabDragId;
    const fromGroup = groupDragId;
    tabDragId = null;
    groupDragId = null;
    suppressTabClickUntilMs = performance.now() + 150;
    document.querySelectorAll(".term-tab--dragging").forEach((el) => el.classList.remove("term-tab--dragging"));
    document.querySelectorAll(".term-tab-group--dragging").forEach((el) => el.classList.remove("term-tab-group--dragging"));

    // Handle tab reordering
    if (fromTab) {
      const over = (e.target as HTMLElement).closest?.(".term-tab") as HTMLElement | null;
      const toTabId = over?.dataset.tabId;
      if (!fromTab || !toTabId || fromTab === toTabId) return;
      const a = tabsState.tabs.findIndex((x) => x.id === fromTab);
      const b = tabsState.tabs.findIndex((x) => x.id === toTabId);
      if (a < 0 || b < 0) return;
      const next = [...tabsState.tabs];
      const [mv] = next.splice(a, 1);
      next.splice(b, 0, mv);
      // Update order values
      next.forEach((tab, i) => tab.order = i);
      tabsState = { ...tabsState, tabs: next };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    }

    // Handle group reordering
    if (fromGroup) {
      const over = (e.target as HTMLElement).closest?.(".term-tab-group") as HTMLElement | null;
      const toGroup = tabsState.groups.find((g) => over?.textContent?.includes(g.name));
      if (!fromGroup || !toGroup || fromGroup === toGroup.id) return;
      const a = tabsState.groups.findIndex((x) => x.id === fromGroup);
      const b = tabsState.groups.findIndex((x) => x.id === toGroup.id);
      if (a < 0 || b < 0) return;
      const next = [...tabsState.groups];
      const [mv] = next.splice(a, 1);
      next.splice(b, 0, mv);
      // Update order values
      next.forEach((group, i) => group.order = i);
      tabsState = { ...tabsState, groups: next };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    }
  });

  renderWorkspaceTabsBar();
  initParttyScrollFade();

  window.addEventListener("beforeunload", () => {
    try {
      persistCurrentWorkspaceTabLayout();
      if (shouldShedWorkspaceOnExitSilent()) {
        shedWorkspaceLocalState();
      }
    } catch {
      /* ignore */
    }
  });

  void (async () => {
    const appWin = getCurrentWindow();
    await appWin.onCloseRequested(async (event) => {
      const mode = getShedWorkspaceExitMode();
      if (mode === "keep") return;
      if (mode === "shed") {
        shedWorkspaceLocalState();
        return;
      }
      event.preventDefault();
      const root = document.getElementById("shed-exit-dialog");
      const choice = await showShedExitDialog(root);
      if (choice === "cancel") return;
      if (choice === "discard") shedWorkspaceLocalState();
      void appWin.destroy().catch(() => {});
    });
  })();

  function showShedExitDialog(root: HTMLElement | null): Promise<"keep" | "discard" | "cancel"> {
    if (!root) return Promise.resolve("cancel");
    return new Promise((resolve) => {
      root.classList.remove("shed-exit-dialog--hidden");
      root.setAttribute("aria-hidden", "false");
      const finish = (v: "keep" | "discard" | "cancel") => {
        root.classList.add("shed-exit-dialog--hidden");
        root.setAttribute("aria-hidden", "true");
        resolve(v);
      };
      root.querySelector("#shed-exit-keep")?.addEventListener("click", () => finish("keep"), { once: true });
      root.querySelector("#shed-exit-discard")?.addEventListener("click", () => finish("discard"), {
        once: true,
      });
      root.querySelector("#shed-exit-cancel")?.addEventListener("click", () => finish("cancel"), {
        once: true,
      });
    });
  }

  void remountAuxiliaryForFocus(paneHost?.getFocusedPaneId() ?? paneHost.getRootPaneId());

  const paneRenameRoot = document.getElementById("pane-rename-root") as HTMLElement | null;
  const paneRenamePanel: PaneRenamePanelApi | null = paneRenameRoot
    ? createPaneRenamePanel({
        root: paneRenameRoot,
        onCommit: (paneId, name) => {
          const trimmed = name.trim().replace(/\s+/g, "_");
          if (trimmed) paneNames.set(paneId, trimmed);
          else paneNames.delete(paneId);
          persistCurrentWorkspaceTabLayout();
        },
      })
    : null;

  const themeBuilderRoot = document.getElementById("theme-builder-root");
  let themeBuilder: ThemeBuilderApi | null = null;
  if (themeBuilderRoot) {
    themeBuilder = createThemeBuilderModal(themeBuilderRoot as HTMLElement, (prefs) => {
      currentUiPrefs = prefs;
      applyUiTheme(prefs);
      refreshAllTerminalThemes();
    });
  }

  const themeModalRoot = document.getElementById("theme-modal-root");
  let themeModal: ThemeModalApi | null = null;
  let openFocusedPaneTheme = (): void => {};
  if (themeModalRoot) {
    let themePreviewPaneId: string | null = null;
    let paneThemeRestore: { id: string; theme: PaneThemePrefs | null } | null = null;
    themeModal = createThemeModal(
      themeModalRoot as HTMLElement,
      (prefs) => {
        if (themePreviewPaneId) {
          applyPaneTheme(themePreviewPaneId, prefs);
          return;
        }
        currentUiPrefs = prefs;
        applyUiTheme(prefs);
        refreshAllTerminalThemes();
      },
      (request) => themeBuilder?.open(request),
    );
    const originalClose = themeModal.close;
    themeModal.close = () => {
      originalClose();
      if (paneThemeRestore) {
        applyPaneTheme(paneThemeRestore.id, paneThemeRestore.theme);
        paneThemeRestore = null;
      }
      themePreviewPaneId = null;
    };
    openFocusedPaneTheme = () => {
      const paneId = paneHost?.getFocusedPaneId();
      if (!paneId) return;
      themePreviewPaneId = paneId;
      const existing = paneThemes.get(paneId);
      paneThemeRestore = { id: paneId, theme: existing ? { ...existing } : null };
      const appPrefs = currentUiPrefs;
      const initialPrefs: UiThemePrefs = {
        ...appPrefs,
        ui_theme: existing?.ui_theme ?? appPrefs.ui_theme,
        ui_theme_variant: existing?.ui_theme_variant ?? appPrefs.ui_theme_variant,
      };
      themeModal?.open({
        title: "Pane Theme",
        initialPrefs,
        onCommit: (prefs) => {
          paneThemeRestore = null;
          applyPaneTheme(paneId, prefs);
          persistCurrentWorkspaceTabLayout();
        },
      });
    };
  }

  const presetsModalRoot = document.getElementById("presets-modal-root");
  const presetEditorRoot = document.getElementById("preset-editor-root");
  const presetEditor: PresetEditorApi | null = presetEditorRoot
    ? createPresetEditorModal(presetEditorRoot as HTMLElement)
    : null;
  let presetsModal: PresetsModalApi | null = null;
  if (presetsModalRoot) {
    presetsModal = createPresetsModal({
      root: presetsModalRoot as HTMLElement,
      onEdit: (preset) => presetEditor?.open(preset),
      onSave: async (name) => {
        const pl = paneHost ? layoutForPaneHost(paneHost) : null;
        if (!pl) return null;
        const pids: string[] = [];
        (function collect(n: typeof pl.tree): void {
          if (n.kind === "leaf") { pids.push(n.id); return; }
          collect(n.a); collect(n.b);
        })(pl.tree);
        // Normalize root pane id to a stable neutral value
        const rootId = pids[0] ?? "";
        const idNorm = new Map<string, string>();
        if (rootId) idNorm.set(rootId, "root");
        for (let i = 1; i < pids.length; i++) idNorm.set(pids[i]!, `p${i}`);
        function normTree(n: NonNullable<typeof pl>["tree"]): NonNullable<typeof pl>["tree"] {
          if (n.kind === "leaf") return { kind: "leaf", id: idNorm.get(n.id) ?? n.id };
          return { ...n, a: normTree(n.a), b: normTree(n.b) };
        }
        function normMap<T>(src: Record<string, T>): Record<string, T> {
          const out: Record<string, T> = {};
          for (const [id, val] of Object.entries(src)) {
            const nid = idNorm.get(id) ?? id;
            out[nid] = val;
          }
          return out;
        }
        const preset: Preset = {
          v: 1,
          name,
          tabName: tabsState.tabs.find((t) => t.id === activeWorkspaceTabId)?.name ?? name,
          tree: normTree(pl!.tree),
          focusedId: idNorm.get(pl!.focusedId) ?? pl!.focusedId,
          floating: Object.fromEntries(
            Object.entries(pl!.floating ?? {}).map(([id, state]) => [idNorm.get(id) ?? id, state]),
          ),
          paneThemes: normMap(Object.fromEntries(pids.filter((id) => paneThemes.has(id)).map((id) => [id, paneThemes.get(id)!]))),
          paneNames: normMap(Object.fromEntries(pids.filter((id) => paneNames.has(id)).map((id) => [id, paneNames.get(id)!]))),
          paneCwds: normMap(Object.fromEntries(pids.filter((id) => paneCwdHints.has(id)).map((id) => [id, paneCwdHints.get(id)!]))),
          paneFontSizes: normMap(Object.fromEntries(
            pids.map((id) => {
              const pt = paneHost?.getPaneTerminal(id);
              const sz = pt ? Number(pt.term.options.fontSize ?? 12) : 12;
              return [id, sz] as [string, number];
            }).filter(([, sz]) => sz !== 12),
          )),
          startupCommands: {},
        };
        // Preserve existing startup commands when re-saving
        try {
          const existing = await invoke<string>("read_preset_json", { name }).catch(() => null);
          if (existing) {
            const prev = JSON.parse(existing) as Preset;
            if (prev.startupCommands) preset.startupCommands = { ...prev.startupCommands };
          }
        } catch { /* first save, no existing file */ }
        await writePresetJson(name, JSON.stringify(preset));
        return name;
      },
      onLoad: async (preset) => {
        const ids: string[] = [];
        (function collect(n: typeof preset.tree): void {
          if (n.kind === "leaf") { ids.push(n.id); return; }
          collect(n.a); collect(n.b);
        })(preset.tree);
        const newTabId = crypto.randomUUID();
        const newRoot = workspaceRootPaneId(newTabId);
        const idMap = new Map<string, string>();
        // First leaf is the root — map it to the tab's root pane id
        if (ids.length > 0) idMap.set(ids[0]!, newRoot);
        for (const id of ids) {
          if (!idMap.has(id)) idMap.set(id, crypto.randomUUID());
        }
        function mapNode(n: typeof preset.tree): typeof preset.tree {
          if (n.kind === "leaf") return { kind: "leaf", id: idMap.get(n.id) ?? crypto.randomUUID() };
          return { ...n, a: mapNode(n.a), b: mapNode(n.b) };
        }
        const tree = mapNode(preset.tree);
        const focusedId = idMap.get(preset.focusedId) ?? "";
        const floating: Record<string, typeof preset.floating[string]> = {};
        for (const [oid, state] of Object.entries(preset.floating)) {
          const nid = idMap.get(oid);
          if (nid) floating[nid] = { ...state };
        }

        const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
        tabsState = { ...tabsState, tabs: [...tabsState.tabs, { id: newTabId, name: preset.tabName || preset.name, groupId: null, color: null, order: maxOrder + 1 }] };
        saveTabsState(tabsState);
        const pl: PersistedPaneLayout = { v: 1, tree, focusedId, floating };
        persistLayoutForTab(newTabId, pl);
        // Seed pane state BEFORE creating host so PTYs inherit parent cwd/theme on spawn
        for (const [oid, theme] of Object.entries(preset.paneThemes)) {
          const nid = idMap.get(oid);
          if (nid && theme) paneThemes.set(nid, { ...theme });
        }
        for (const [oid, pn] of Object.entries(preset.paneNames)) {
          const nid = idMap.get(oid);
          if (nid && pn) paneNames.set(nid, pn.replace(/\s+/g, "_"));
        }
        for (const [oid, cwd] of Object.entries(preset.paneCwds)) {
          const nid = idMap.get(oid);
          if (nid && cwd) paneCwdHints.set(nid, cwd);
        }
        createTabPaneShellAndHost(newTabId, { initialTree: tree, initialFocusedId: focusedId, initialFloating: floating });
        switchWorkspaceTab(newTabId);
        // Send startup commands after PTYs are spawned.
        // Root pane: inject cd to its cwd first, then the startup command.
        const rootOldId = ids[0];
        const rootNewId = idMap.get(rootOldId ?? "");
        if (preset.startupCommands && Object.keys(preset.startupCommands).length > 0) {
          setTimeout(() => {
            for (const [oid, cmd] of Object.entries(preset.startupCommands)) {
              const nid = idMap.get(oid);
              if (!nid || !cmd) continue;
              if (nid === rootNewId) {
                const cwd = preset.paneCwds?.[oid];
                if (cwd) void ptyWrite(nid, `cd "${cwd}"\r`).catch(() => {});
              }
              void ptyWrite(nid, cmd + "\r").catch(() => {});
            }
          }, 1500);
        }
      },
    });
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && (e.key === "o" || e.key === "O")) {
        const t = e.target as HTMLElement | null;
        if (t?.closest("#command-palette") || t?.closest("#settings-panel") || t?.closest(".term-search")) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFocusedPaneFloating();
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && (e.key === "e" || e.key === "E")) {
        const t = e.target as HTMLElement | null;
        if (t?.closest("#command-palette") || t?.closest("#settings-panel") || t?.closest(".term-search")) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFileTree();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey && e.key === ",") {
        const t = e.target as HTMLElement | null;
        if (t?.closest("#command-palette") || t?.closest("#settings-panel") || t?.closest(".term-search")) return;
        e.preventDefault();
        e.stopPropagation();
        settingsApi?.open();
        return;
      }
    },
    true,
  );

  async function pasteFromClipboard(): Promise<void> {
    try {
      const text = await readText();
      const pid = paneHost?.getFocusedPaneId();
      if (text && pid)
        await ptyWrite(pid, text).catch((e) => console.warn("paste", e));
    } catch {
      /* empty clipboard or read failed */
    }
  }

  window.addEventListener("keydown", maybeBlockBrowserPrintShortcut, true);

  document.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      const target = e.target as Node | null;
      if (target && terminalContent?.contains(target)) {
        void pasteFromClipboard();
        getFocusedTerm()?.focus();
      }
    },
    true,
  );

  document.getElementById("file-tree-toggle")?.addEventListener("click", () => toggleFileTree());
  const fileTreeDockEl = document.getElementById("file-tree-dock");
  const fileTreeResizeHandle = document.getElementById("file-tree-resize-handle");
  async function setFileTreeSide(side: "left" | "right"): Promise<void> {
    const normalized = normalizeFileTreeSide(side);
    fileTreeSideRef.v = normalized;
    applyFileTreeSide(normalized);
    const current = persisted.prefs as Partial<ParttyPrefs>;
    const next = { ...(current as ParttyPrefs), file_tree_side: normalized };
    persisted.prefs = next as unknown as Record<string, unknown>;
    await invoke("set_prefs", { prefs: next }).catch((e) => console.warn("set_prefs file_tree_side", e));
    scheduleResizeImmediate();
  }
  if (fileTreeDockEl) {
    fileTreeDockEl.setAttribute("aria-hidden", fileTreeUserEnabled ? "false" : "true");
  }

  fileTreeResizeHandle?.addEventListener("pointerdown", (e) => {
    if (!document.documentElement.classList.contains("file-tree-on")) return;
    e.preventDefault();
    setTerminalLayoutSuspended(true);
    fileTreeResizeHandle.classList.add("file-tree-resize-active");
    const startX = e.clientX;
    const startW = fileTreeDockEl?.getBoundingClientRect().width ?? 260;
    const onMove = (ev: PointerEvent): void => {
      const delta = fileTreeSideRef.v === "right" ? startX - ev.clientX : ev.clientX - startX;
      const next = Math.round(Math.max(160, Math.min(560, startW + delta)));
      document.documentElement.style.setProperty("--file-tree-user-width", `${next}px`);
    };
    const onUp = (): void => {
      fileTreeResizeHandle.classList.remove("file-tree-resize-active");
      window.removeEventListener("pointermove", onMove);
      const w = fileTreeDockEl?.getBoundingClientRect().width;
      if (w) localStorage.setItem(FILE_TREE_WIDTH_KEY, String(Math.round(w)));
      setTerminalLayoutSuspended(false);
      scheduleResizeImmediate(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  });
  document.getElementById("file-tree-toggle")?.setAttribute(
    "aria-pressed",
    fileTreeUserEnabled ? "true" : "false",
  );

  async function newTerminalSession(): Promise<void> {
    const killIds = paneHost?.getLeafIdsInOrder() ?? [];
    for (const pid of killIds) {
      await invoke("pty_kill_pane", { paneId: pid }).catch(() => {});
    }
    liveCwd = null;
    paneCwdHints.clear();
    lastPtyDims.clear();
    pendingSnapshot = null;
    bridgeScrollCleanup?.();
    bridgeScrollCleanup = null;
    shedWebgl();
    const tabId = activeWorkspaceTabId;
    disposeTabPaneHost(tabId);
    clearPaneLayout();
    const rid = workspaceRootPaneId(tabId);
    paneHost = createTabPaneShellAndHost(tabId, {
      initialTree: { kind: "leaf", id: rid },
      initialFocusedId: rid,
    });
    for (const [id, shell] of tabPaneShells) {
      shell.classList.toggle("term-tab-pane-shell--hidden", id !== tabId);
    }
    lastFocusedPaneId = rid;
    await remountAuxiliaryForFocus(paneHost.getFocusedPaneId());
    await ensurePtyForPane(rid);
    getFocusedTerm()?.writeln("\r\n\x1b[90m[new session]\x1b[0m\r\n");
  }

  let savedPaletteCommands: SavedPaletteCommand[] = [];
  let paletteContext: PaletteContext = { shell: "", cwd: null };
  let builderMode = false;

  async function refreshPaletteCommandsAndContext(): Promise<void> {
    const [cmds, ctx] = await Promise.all([
      invoke<SavedPaletteCommand[]>("get_palette_commands"),
      invoke<PaletteContext>("get_palette_context"),
    ]);
    savedPaletteCommands = cmds;
    paletteContext = {
      shell: ctx.shell,
      cwd: liveCwd ?? ctx.cwd ?? null,
    };
  }

  const cpRoot = document.getElementById("command-palette");
  const cpInput = document.getElementById("command-palette-input") as HTMLInputElement | null;
  const cpList = document.getElementById("command-palette-list");
  const cpListView = document.getElementById("command-palette-list-view");
  const cpBuilder = document.getElementById("command-palette-builder");
  const cpBuilderBack = document.getElementById("command-palette-builder-back");
  const paletteCmdName = document.getElementById("palette-cmd-name") as HTMLInputElement | null;
  const paletteCmdText = document.getElementById("palette-cmd-text") as HTMLTextAreaElement | null;
  const paletteCmdGlobal = document.getElementById("palette-cmd-global") as HTMLInputElement | null;
  const paletteCmdCwd = document.getElementById("palette-cmd-cwd") as HTMLInputElement | null;
  const paletteCmdSave = document.getElementById("palette-cmd-save");

  const helpPanelEl = document.getElementById("help-panel");
  const settingsPanelEl = document.getElementById("settings-panel");
  function shellPrefKey(s: string): string {
    return s.trim().replace(/\\/g, "/").toLowerCase();
  }

  /** Apply live-updatable xterm.js options to all active terminals. */
  const applyTerminalDisplayOptions = (): void => {
    for (const host of tabPaneHosts.values()) {
      for (const leafId of host.getLeafIdsInOrder()) {
        const pt = host.getPaneTerminal(leafId);
        if (!pt) continue;
        const t = pt.term;
        t.options.cursorBlink = cursorBlinkRef.v;
        t.options.cursorInactiveStyle = cursorInactiveStyleRef.v;
        t.options.cursorWidth = cursorWidthRef.v;
        t.options.altClickMovesCursor = altClickCursorRef.v;
        t.options.fontSize = fontSizeRef.v;
        t.options.fontWeight = fontWeightRef.v as any;
        t.options.fontWeightBold = fontWeightBoldRef.v as any;
        t.options.lineHeight = lineHeightRef.v;
        t.options.letterSpacing = letterSpacingRef.v;
        t.options.drawBoldTextInBrightColors = drawBoldBrightRef.v;
        t.options.customGlyphs = customGlyphsRef.v;
        t.options.smoothScrollDuration = smoothScrollRef.v;
        t.options.scrollSensitivity = scrollSensitivityRef.v;
        t.options.fastScrollSensitivity = fastScrollSensitivityRef.v;
        t.options.minimumContrastRatio = contrastRatioRef.v;
      }
    }
  };

  const settingsApi = settingsPanelEl
    ? createSettingsPanel(settingsPanelEl, async (saved: ParttyPrefs, previous: ParttyPrefs) => {
        syncRuntimeShedFromPrefs(saved);
        focusFollowsRef.v = saved.focus_follows_cursor;
        persisted.prefs = saved as unknown as Record<string, unknown>;
        Object.assign(lp, mergeLifecyclePrefs(persisted.prefs));
        autoCopySelectionRef.v = saved.auto_copy_selection;
        showDiffCountsRef.v = saved.file_tree_show_diff_counts;
        showGitInfoRef.v = saved.file_tree_show_git_info;
        fileTreeSideRef.v = normalizeFileTreeSide(saved.file_tree_side);
        applyFileTreeSide(fileTreeSideRef.v);
        splitLayoutStyleRef.v = normalizeSplitLayoutStyle(saved.split_layout_style);
        disableSearchRef.v = saved.file_tree_disable_search ?? false;
        gitAwareSearchRef.v = saved.file_search_git_aware ?? true;
        confirmDeletePromptRef.v = saved.confirm_delete_prompt ?? true;
        disableTooltipsRef.v = saved.ui_disable_tooltips ?? false;
        altClickCursorRef.v = saved.terminal_alt_click_moves_cursor ?? true;
        cursorBlinkRef.v = saved.terminal_cursor_blink ?? true;
        cursorInactiveStyleRef.v = (saved as Partial<ParttyPrefs>).terminal_cursor_inactive_style as "outline" | "block" | "bar" | "underline" | "none" | undefined ?? "outline";
        cursorWidthRef.v = (saved as Partial<ParttyPrefs>).terminal_cursor_width ?? 1;
        fontSizeRef.v = (saved as Partial<ParttyPrefs>).terminal_font_size ?? 12;
        fontWeightRef.v = (saved as Partial<ParttyPrefs>).terminal_font_weight ?? "normal";
        fontWeightBoldRef.v = (saved as Partial<ParttyPrefs>).terminal_font_weight_bold ?? "bold";
        lineHeightRef.v = (saved as Partial<ParttyPrefs>).terminal_line_height ?? 1;
        letterSpacingRef.v = (saved as Partial<ParttyPrefs>).terminal_letter_spacing ?? 0;
        drawBoldBrightRef.v = (saved as Partial<ParttyPrefs>).terminal_draw_bold_bright ?? true;
        customGlyphsRef.v = (saved as Partial<ParttyPrefs>).terminal_custom_glyphs ?? true;
        smoothScrollRef.v = (saved as Partial<ParttyPrefs>).terminal_smooth_scroll_duration ?? 0;
        scrollSensitivityRef.v = (saved as Partial<ParttyPrefs>).terminal_scroll_sensitivity ?? 1;
        fastScrollSensitivityRef.v = (saved as Partial<ParttyPrefs>).terminal_fast_scroll_sensitivity ?? 5;
        contrastRatioRef.v = (saved as Partial<ParttyPrefs>).terminal_minimum_contrast_ratio ?? 1;
        applyTerminalDisplayOptions();
        backspaceDeleteSelectionRef.v = saved.terminal_backspace_delete_selection ?? true;
        if ((saved.terminal_cursor_style ?? "block") !== cursorStyleRef.v) {
          cursorStyleRef.v = (saved.terminal_cursor_style as "block" | "underline" | "bar") ?? "block";
          for (const host of tabPaneHosts.values()) {
            host.setCursorStyle(cursorStyleRef.v);
          }
        }
        const threshold = (saved as Partial<ParttyPrefs>).process_notification_threshold;
        if (typeof threshold === "number" && Number.isFinite(threshold)) {
          processNotificationThresholdRef.v = Math.max(0.1, threshold);
        }
        const showFor = (saved as Partial<ParttyPrefs>).process_notification_show_for;
        if (typeof showFor === "number" && Number.isFinite(showFor)) {
          processNotificationShowForRef.v = Math.max(1000, Math.min(30000, showFor));
        }
        fileTreePanel?.setSearchEnabled(!(saved.file_tree_disable_search ?? false));
        applyTerminalDisplayPrefs(saved);
        if (saved.scrollback_lines !== previous.scrollback_lines) {
          for (const host of tabPaneHosts.values()) {
            host.setScrollbackLines(saved.scrollback_lines);
          }
        }
        applyTooltipPolicy(document);
        document.documentElement.classList.toggle("pane-blur-unfocused", saved.blur_unfocused_panes);
        document.documentElement.style.setProperty("--pane-blur-radius", String((saved as Partial<ParttyPrefs>).pane_blur_radius ?? 1.6));
        document.documentElement.style.setProperty("--pane-padding", String((saved as Partial<ParttyPrefs>).terminal_pane_padding ?? 5));
        document.documentElement.classList.toggle("pane-dim-unfocused", saved.dim_unfocused_panes);
        if (saved.always_open_in_zen_mode) {
          setZenMode(true);
        }
        const prevUi = pickUiPrefs(previous as unknown as Record<string, unknown>);
        const nextUi = pickUiPrefs(saved as unknown as Record<string, unknown>);
        if (uiPrefsChanged(prevUi, nextUi)) {
          currentUiPrefs = nextUi;
          applyUiTheme(nextUi);
          refreshAllTerminalThemes();
        }
        const shellChanged = shellPrefKey(saved.shell) !== shellPrefKey(previous.shell);
        const cwdChanged = (saved.initial_cwd ?? "").trim() !== (previous.initial_cwd ?? "").trim();
        if (shellChanged || cwdChanged) {
          localStorage.setItem(DEFER_PTY_REINIT_KEY, "1");
        }
      })
    : null;

  const cpPanel = document.querySelector(".command-palette-panel");
  const cpToolbar = document.querySelector(".command-palette-toolbar");
  if (cpPanel instanceof HTMLElement && cpToolbar instanceof HTMLElement) {
    cpPanel.style.position = "fixed";
    attachDraggablePanel(cpPanel, cpToolbar, "partty.commandPalette.pos");
  }

  if (settingsPanelEl) {
    const card = settingsPanelEl.querySelector(".settings-panel-card");
    const head = settingsPanelEl.querySelector(".settings-panel-head");
    if (card instanceof HTMLElement && head instanceof HTMLElement) {
      card.style.position = "fixed";
      attachDraggablePanel(card, head, "partty.settingsPanel.pos");
    }
  }

  if (helpPanelEl) {
    const hcard = helpPanelEl.querySelector(".help-panel-card");
    const hhead = helpPanelEl.querySelector(".help-panel-head");
    if (hcard instanceof HTMLElement && hhead instanceof HTMLElement) {
      hcard.style.position = "fixed";
      attachDraggablePanel(hcard, hhead, "partty.helpPanel.pos");
    }
  }

  let openHelpPanel: () => void = () => {};
  let closeHelpPanel: () => void = () => {};
  let toggleHelp: () => void = () => {};

  function syncCwdScopeDisabled(): void {
    const g = paletteCmdGlobal?.checked ?? true;
    if (paletteCmdCwd) {
      paletteCmdCwd.disabled = g;
      paletteCmdCwd.classList.toggle("cp-field-cwd--off", g);
    }
  }

  function hideBuilder(): void {
    builderMode = false;
    cpListView?.classList.remove("command-palette-list-view--hidden");
    cpBuilder?.classList.add("command-palette-builder--hidden");
  }

  function showBuilder(): void {
    builderMode = true;
    cpListView?.classList.add("command-palette-list-view--hidden");
    cpBuilder?.classList.remove("command-palette-builder--hidden");
    if (paletteCmdName) paletteCmdName.value = "";
    if (paletteCmdText) paletteCmdText.value = "";
    if (paletteCmdGlobal) paletteCmdGlobal.checked = true;
    syncCwdScopeDisabled();
    const cwd = paletteContext.cwd?.trim() ?? "";
    if (paletteCmdCwd) paletteCmdCwd.value = cwd;
    requestAnimationFrame(() => paletteCmdName?.focus());
  }

  function clearLineForToken(token: string | null, prefsShell: string): string {
    const t = (token ?? "").toLowerCase();
    const p = prefsShell.toLowerCase();
    if (t === "cmd" || t.includes("cmd")) return "cls\r";
    if (!t && p.includes("cmd") && !p.includes("pwsh") && !p.includes("powershell")) return "cls\r";
    return "clear\r";
  }

  function restartLineForToken(token: string | null, prefsShell: string): string {
    const t = (token ?? "").toLowerCase();
    const p = prefsShell.toLowerCase();
    if (t.includes("pwsh")) return "pwsh\r";
    if (t.includes("powershell")) return "powershell\r";
    if (t === "bash" || t.endsWith("bash")) return "bash\r";
    if (t === "zsh" || t.endsWith("zsh")) return "zsh\r";
    if (t === "cmd") return "cmd\r";
    if (t === "sh" || t === "dash") return "sh\r";
    if (t.includes("wslhost") || t === "wsl") return "wsl\r";
    if (t.includes("fish")) return "fish\r";
    if (p.includes("pwsh")) return "pwsh\r";
    if (p.includes("powershell")) return "powershell\r";
    if (p.includes("bash")) return "bash\r";
    if (p.includes("zsh")) return "zsh\r";
    const trimmed = prefsShell.trim();
    if (!trimmed) return "pwsh\r";
    const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
    return `${base}\r`;
  }

  async function runPaneCmdClear(): Promise<void> {
    const prefsShell = paletteContext.shell.trim() || "pwsh";
    for (const host of tabPaneHosts.values()) {
      for (const id of host.getLeafIdsInOrder()) {
        let token: string | null = null;
        try {
          token = await ptyShellExeToken(id);
        } catch {
          token = null;
        }
        const line = clearLineForToken(token, prefsShell);
        void ptyWrite(id, line).catch((e) => console.warn("> clear", e));
      }
    }
  }

  function runPaneCmdExit(): void {
    for (const host of tabPaneHosts.values()) {
      for (const id of host.getLeafIdsInOrder()) {
        void ptyWrite(id, "\x03").catch((e) => console.warn("> exit", e));
      }
    }
  }

  async function runPaneCmdRestartShell(): Promise<void> {
    const prefsShell = paletteContext.shell.trim() || "pwsh";
    for (const host of tabPaneHosts.values()) {
      for (const id of host.getLeafIdsInOrder()) {
        let token: string | null = null;
        try {
          token = await ptyShellExeToken(id);
        } catch {
          token = null;
        }
        const line = restartLineForToken(token, prefsShell);
        void ptyWrite(id, line).catch((e) => console.warn("> restart shell", e));
      }
    }
  }

  function getTabPaletteCommands(): PaletteCommand[] {
    return visibleWorkspaceTabsInOrder().map((tab, index) => {
      const host = tabPaneHosts.get(tab.id);
      const leafIds = host?.getLeafIdsInOrder() ?? [];
      const paneKeywords: string[] = [];
      for (const lid of leafIds) {
        const pn = paneNames.get(lid);
        if (pn) paneKeywords.push(pn.toLowerCase());
        const cwd = paneCwdHints.get(lid);
        if (cwd) {
          const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
          for (const part of parts) paneKeywords.push(part.toLowerCase());
        }
      }
      const extra = [...new Set(paneKeywords)].slice(0, 32).join(" ");
      return {
        id: `tab-switch-${tab.id}`,
        label: `: ${tab.name}`,
        keywords: `tab workspace ${tab.name} ${extra} alt ${index + 1}`,
        hotkey: index < 9 ? `Alt+${index + 1}` : index === 9 ? "Alt+0" : undefined,
        run: () => switchWorkspaceTab(tab.id),
      };
    });
  }

  function getPaneTargetCommands(query: string): PaletteCommand[] {
    const afterTag = query.slice(6);
    const spaceIdx = afterTag.indexOf(" ");
    const panePart = (spaceIdx === -1 ? afterTag : afterTag.slice(0, spaceIdx)).trimStart().toLowerCase();

    // When a command follows the pane name, show a single dispatch entry.
    // This prevents the palette's word-split filter from eliminating pane entries
    // because command words like "rm" don't match pane keywords.
    if (spaceIdx !== -1 && panePart) {
      const command = afterTag.slice(spaceIdx + 1).trim();
      // Find which pane this name refers to
      for (const host of tabPaneHosts.values()) {
        for (const leafId of host.getLeafIdsInOrder()) {
          const name = paneNames.get(leafId) || leafId.slice(0, 8);
          if (name.toLowerCase() !== panePart && leafId.slice(0, 8).toLowerCase() !== panePart) continue;
          const cwd = paneCwdHints.get(leafId) || "";
          const shortCwd = cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || cwd;
          return [{
            id: `pane-dispatch-${leafId}`,
            label: `@pane:${name}${command ? ` → ${command}` : ""}`,
            labelHtml: `<span class="cp-label-prefix">@pane:</span><span class="cp-label-name">${escapeHtml(name)}</span>` +
              (shortCwd ? ` <span class="cp-label-cwd">${escapeHtml(shortCwd)}</span>` : "") +
              (command ? ` <span class="cp-label-prefix" style="font-weight:400">→</span> ${escapeHtml(command)}` : ""),
            keywords: `${name} ${cwd} ${command}`,
            run: () => dispatchPaneCommand(leafId, query),
          }];
        }
      }
      // No pane matched — show empty
      return [];
    }

    // No command yet — show filterable pane list
    const items: PaletteCommand[] = [];
    for (const [tabId, host] of tabPaneHosts) {
      const tab = tabsState.tabs.find((t) => t.id === tabId);
      const tabLabel = tab ? (tab.name || `Tab ${tabsState.tabs.indexOf(tab) + 1}`) : tabId.slice(0, 6);
      for (const leafId of host.getLeafIdsInOrder()) {
        const name = paneNames.get(leafId) || leafId.slice(0, 8);
        const cwd = paneCwdHints.get(leafId) || "";
        const shortCwd = cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || cwd;
        const hay = `${name} ${cwd} ${tabLabel}`.toLowerCase();
        if (panePart && !hay.includes(panePart)) continue;
        const cwdHtml = shortCwd ? ` <span class="cp-label-cwd">${escapeHtml(shortCwd)}</span>` : "";
        items.push({
          id: `pane-target-${leafId}`,
          label: `@pane:${name}  ${shortCwd}  [${tabLabel}]`,
          labelHtml: `<span class="cp-label-prefix">@pane:</span><span class="cp-label-name">${escapeHtml(name)}</span>${cwdHtml} <span class="cp-label-tab">${escapeHtml(tabLabel)}</span>`,
          keywords: `${name} ${cwd} ${tabLabel} @pane:${panePart}`,
          run: () => dispatchPaneCommand(leafId, query),
        });
      }
    }
    return items;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  let processToastTimer = 0;
  const processToast = document.getElementById("proc-toast") as HTMLElement | null;

  function navigateToPane(paneId: string): void {
    for (const [tabId, host] of tabPaneHosts) {
      if (host.getPaneTerminal(paneId)) {
        if (tabId !== activeWorkspaceTabId) switchWorkspaceTab(tabId);
        host.getPaneTerminal(paneId)?.term.focus();
        return;
      }
    }
  }

  function showProcessNotification(command: string, paneName: string, cwd: string, startedAt: number, paneId: string): void {
    if (!processToast) return;
    const shortCmd = command.length > 60 ? command.slice(0, 57) + "\u2026" : command;
    const shortCwd = cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || cwd;
    const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
    processToast.dataset.paneId = paneId;
    processToast.innerHTML = `<span class="proc-toast-cmd">${escapeHtml(shortCmd)}</span> finished in <span class="proc-toast-pane">${escapeHtml(paneName)}</span> <span class="proc-toast-cwd">${escapeHtml(shortCwd)}</span> \u00b7 ${dur}s <button class="proc-toast-nav" title="Go to pane">\u2192</button>`;
    processToast.classList.remove("proc-toast--hidden");
    if (processToastTimer) clearTimeout(processToastTimer);
    processToastTimer = window.setTimeout(() => {
      processToast.classList.add("proc-toast--hidden");
    }, processNotificationShowForRef.v);
  }

  processToast?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".proc-toast-nav");
    if (btn) {
      const paneId = processToast.dataset.paneId;
      if (paneId) navigateToPane(paneId);
      processToast.classList.add("proc-toast--hidden");
    }
  });

  function getProcCommands(query: string): PaletteCommand[] {
    const afterTag = query.slice(query.startsWith("@proc:") ? 6 : 5).trimStart();
    const words = afterTag ? afterTag.split(/\s+/) : [];
    const prefix = words.join(" ").toLowerCase();

    if (activeProcesses.size === 0) return [{
      id: "proc-none",
      label: "No active processes",
      keywords: "@proc proc process",
      run: () => {},
    }];

    const items: PaletteCommand[] = [];
    for (const [leafId, proc] of activeProcesses) {
      if (prefix && !proc.command.toLowerCase().startsWith(prefix) && !proc.command.toLowerCase().includes(prefix)) continue;
      const name = paneNames.get(leafId) || leafId.slice(0, 8);
      const shortCwd = proc.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || proc.cwd;
      const dur = ((Date.now() - proc.startedAt) / 1000).toFixed(0);
      const displayCmd = proc.command.length > 50 ? proc.command.slice(0, 47) + "\u2026" : proc.command;
      let tabLabel = "";
      for (const [tid, host] of tabPaneHosts) {
        if (host.getPaneTerminal(leafId)) {
          const t = tabsState.tabs.find((x) => x.id === tid);
          tabLabel = t ? (t.name || `T${tabsState.tabs.indexOf(t) + 1}`) : "";
          break;
        }
      }
      items.push({
        id: `proc-${leafId}`,
        label: `@proc:${displayCmd}  ${dur}s`,
        labelHtml: `<span class="cp-label-prefix">@proc:</span><span class="cp-label-name">${escapeHtml(displayCmd)}</span>` +
          (shortCwd ? ` <span class="cp-label-cwd">${escapeHtml(shortCwd)}</span>` : "") +
          (tabLabel ? ` <span class="cp-label-tab">${escapeHtml(tabLabel)}</span>` : "") +
          ` <span style="color:var(--ui-chrome-muted);margin-left:0.4em">${dur}s</span>`,
        keywords: `@proc proc ${displayCmd} ${proc.cwd} ${name} ${tabLabel}`,
        run: () => {
          for (const [tid, host] of tabPaneHosts) {
            if (host.getPaneTerminal(leafId)) {
              if (tid !== activeWorkspaceTabId) switchWorkspaceTab(tid);
              host.getPaneTerminal(leafId)?.term.focus();
              return;
            }
          }
        },
      });
    }
    return items.length > 0 ? items : [{
      id: "proc-none",
      label: prefix ? `No process matching "${prefix}"` : "No active processes",
      keywords: "@proc proc process",
      run: () => {},
    }];
  }

  function dispatchPaneCommand(targetPaneId: string, query: string): void {
    const tagIdx = query.indexOf("@pane:");
    if (tagIdx === -1) return;
    const afterTagStart = tagIdx + 6;
    const spaceIdx = query.indexOf(" ", afterTagStart);
    const command = spaceIdx === -1 ? "" : query.slice(spaceIdx + 1).trim();
    if (!command) {
      // No command — switch to the pane's tab and focus it.
      for (const [tabId, host] of tabPaneHosts) {
        if (host.getPaneTerminal(targetPaneId)) {
          if (tabId !== activeWorkspaceTabId) switchWorkspaceTab(tabId);
          host.getPaneTerminal(targetPaneId)?.term.focus();
          return;
        }
      }
      return;
    }
    void ptyWrite(targetPaneId, `${command}\r`).catch((e) => console.warn("pty_write @pane:", e));
  }

  function getMergedPaletteCommands(query: string): PaletteCommand[] {
    const q = query.trimStart();
    if (q.startsWith(":")) {
      return getTabPaletteCommands();
    }
    if (q.startsWith(">")) {
      return [
        {
          id: "pane-cmd-clear",
          label: ">c — clear",
          labelHtml: `<span class="cp-label-prefix">${escapeHtml(">c")}</span> — clear`,
          keywords: ">c >clear >cls clear screen reset terminal",
          run: () => void runPaneCmdClear(),
        },
        {
          id: "pane-cmd-exit",
          label: ">e — exit (Ctrl+C)",
          labelHtml: `<span class="cp-label-prefix">${escapeHtml(">e")}</span> — exit (Ctrl+C)`,
          keywords: ">e >exit ctrl c interrupt break cancel",
          run: () => runPaneCmdExit(),
        },
        {
          id: "pane-cmd-restart-shell",
          label: ">r — restart shell",
          labelHtml: `<span class="cp-label-prefix">${escapeHtml(">r")}</span> — restart shell`,
          keywords: ">r >restart shell respawn",
          run: () => void runPaneCmdRestartShell(),
        },
      ];
    }

    if (q.startsWith("@pane:")) {
      return getPaneTargetCommands(q);
    }
    if (q.startsWith("@proc")) {
      return getProcCommands(q);
    }

    const ctx = paletteContext;
    const customRuns: PaletteCommand[] = [];
    for (const c of savedPaletteCommands) {
      if (!savedCommandMatchesContext(c, ctx)) continue;
      const id = c.id;
      const payload = c;
      customRuns.push({
        id: `saved-${id}`,
        label: payload.name,
        keywords: `${payload.command} ${payload.shell} ${payload.cwd_scope ?? ""}`,
        run: () => {
          const pid = paneHost?.getFocusedPaneId();
          if (!pid) return;
          void ptyWrite(pid, `${payload.command}\r`).catch((e) =>
            console.warn("pty_write custom palette", e),
          );
        },
        remove: async () => {
          await invoke("delete_palette_command", { id: payload.id });
          await refreshPaletteCommandsAndContext();
        },
        removeLabel: `Remove ${payload.name}`,
      });
    }

    const commands: PaletteCommand[] = [
      {
        id: "help-hotkeys",
        label: "Help: Shortcuts",
        keywords: "hotkeys bindings reference help",
        hotkey: "Ctrl+Shift+/",
        run: () => openHelpPanel(),
      },
      {
        id: "open-settings",
        label: "Settings",
        keywords: "preferences config options",
        hotkey: "Ctrl+,",
        run: () => settingsApi?.open(),
      },
      {
        id: "open-themes",
        label: "Change app theme…",
        keywords: "theme appearance colors ui palette app global",
        run: () => themeModal?.open({ title: "App Theme" }),
      },
      {
        id: "open-pane-theme",
        label: "Pane: Change focused theme…",
        keywords: "theme appearance colors focused pane local override",
        run: () => openFocusedPaneTheme(),
      },
      {
        id: "open-theme-builder",
        label: "Theme builder…",
        keywords: "theme custom colors editor create css variables",
        run: () => {
          themeModal?.close();
          themeBuilder?.open();
        },
      },
      {
        id: "tab-new",
        label: "New tab",
        keywords: "workspace create add",
        run: () => openNewWorkspaceTab(),
      },
      {
        id: "tab-duplicate",
        label: "Duplicate tab",
        keywords: "workspace copy clone",
        run: () => duplicateWorkspaceTab(activeWorkspaceTabId),
      },
      {
        id: "tab-close",
        label: "Close tab",
        keywords: "workspace remove delete",
        run: () => closeWorkspaceTab(activeWorkspaceTabId),
      },
      {
        id: "tab-rename",
        label: "Rename tab…",
        keywords: "workspace title edit",
        run: () => beginTabRename(activeWorkspaceTabId),
      },
      {
        id: "new-custom",
        label: "New command…",
        keywords: "create builder save",
        run: () => {
          showBuilder();
        },
      },
      {
        id: "toggle-file-tree",
        label: "Toggle files",
        keywords: "files explorer sidebar workspace ctrl shift e",
        hotkey: "Ctrl+Shift+E",
        run: () => {
          toggleFileTree();
        },
      },
      {
        id: "filter-file-tree",
        label: "Find in files",
        keywords: "filter search grep rg find",
        run: () => {
          focusFileTreeFilter();
        },
      },
      {
        id: "reload-file-tree",
        label: "Reload files",
        keywords: "refresh explorer rescan restart watch cwd",
        run: () => void reloadFileTree(),
      },
      {
        id: "presets-save",
        label: "Presets: Save tab as preset\u2026",
        keywords: "workspace layout snapshot save template reuse",
        run: () => presetsModal?.open(),
      },
      {
        id: "presets-open",
        label: "Presets: Open preset\u2026",
        keywords: "workspace layout restore load template",
        run: () => presetsModal?.open(),
      },
      {
        id: "toggle-zen-mode",
        label: document.documentElement.classList.contains("zen-mode")
          ? "Exit zen"
          : "Enter zen",
        keywords: "focus session hide toolbar chrome distraction free",
        run: () => {
          setZenMode(!document.documentElement.classList.contains("zen-mode"));
        },
      },
      {
        id: "paste",
        label: "Edit: Paste from clipboard",
        keywords: "clipboard context",
        run: () => void pasteFromClipboard(),
      },
      {
        id: "new-session",
        label: "Terminal: New session",
        keywords: "restart shell pty",
        run: () => void newTerminalSession(),
      },
      {
        id: "toggle-background-work",
        label: isBackgroundWorkMode()
          ? "Session: Shed PTYs on hide"
          : "Session: Keep PTYs alive on hide",
        keywords: "background keep alive pty buffer webview shed hide memory agent logs tui",
        run: () => void setBackgroundWorkMode(!isBackgroundWorkMode()),
      },
      {
        id: "hide-overlay",
        label: "Window: Hide Partty",
        keywords: "close overlay tray background hotkey",
        hotkey: "Alt+Shift+T",
        run: () => void invoke("toggle_overlay").catch(() => {}),
      },
      {
        id: "quit-app",
        label: "App: Quit Partty",
        keywords: "exit app quit close traffic light red",
        run: () => void appWindow.destroy().catch(() => {}),
      },
      {
        id: "focus-terminal",
        label: "Terminal: Focus",
        keywords: "keyboard input",
        run: () => {
          getFocusedTerm()?.focus();
        },
      },
      {
        id: "pane-split-v",
        label: "Pane: Split vertically (side by side)",
        keywords: "split columns layout",
        hotkey: "Alt+V",
        run: () => {
          splitFocusedWithCwd("h");
        },
      },
      {
        id: "pane-split-h",
        label: "Pane: Split horizontally (stacked)",
        keywords: "split rows layout",
        hotkey: "Alt+H",
        run: () => {
          splitFocusedWithCwd("v");
        },
      },
      {
        id: "pane-close",
        label: "Pane: Close focused",
        keywords: "remove split",
        run: () => {
          void closeFocusedPane();
        },
      },
      {
        id: "pane-toggle-floating",
        label: "Pane: Float or tile focused",
        keywords: "float pop out pop in tile hyprland layout",
        hotkey: "Ctrl+Shift+O",
        run: () => {
          toggleFocusedPaneFloating();
        },
      },
      {
        id: "pane-rename",
        label: "Pane: Rename focused…",
        keywords: "pane name title label friendly id",
        run: () => openFocusedPaneRename(),
      },
      {
        id: "pane-pop-out",
        label: "Pane: Pop out focused pane",
        keywords: "detach separate window float eject external",
        run: () => {
          void popOutFocusedPane();
        },
      },
      {
        id: "pane-close-children",
        label: "Pane: Close all child panes",
        keywords: "reset layout keep main root initial close children",
        hotkey: "Win+Shift+W",
        run: () => {
          void closeAllChildPanes();
        },
      },
      ...customRuns,
    ];
    return commands;
  }

  function renderHelpShortcuts(): void {
    const list = helpPanelEl?.querySelector(".help-shortcuts") as HTMLElement | null;
    if (!list) return;
    const seen = new Set<string>();
    const rows: { hotkey: string; label: string }[] = [{ hotkey: "Ctrl+Shift+P", label: "Command palette" }];
    for (const cmd of getMergedPaletteCommands("")) {
      const hotkey = cmd.hotkey?.trim();
      if (!hotkey || seen.has(hotkey)) continue;
      seen.add(hotkey);
      rows.push({ hotkey, label: cmd.label.replace(/…$/, "") });
    }
    rows.push(
      { hotkey: "Ctrl+Wheel", label: "Zoom focused pane" },
      { hotkey: "Alt+Drag", label: "Move floating pane or swap tiled panes" },
      { hotkey: "Right-click", label: "Paste from clipboard" },
    );
    list.replaceChildren(...rows.map(({ hotkey, label }) => {
      const row = document.createElement("div");
      row.className = "help-shortcut";
      for (const part of hotkey.split("+")) {
        const key = document.createElement("kbd");
        key.className = "help-key";
        key.textContent = part;
        row.appendChild(key);
      }
      const desc = document.createElement("span");
      desc.className = "help-desc";
      desc.textContent = label;
      row.appendChild(desc);
      return row;
    }));
  }

  const commandPalette =
    cpRoot && cpInput && cpList
      ? createCommandPalette({
          root: cpRoot,
          input: cpInput,
          list: cpList,
          getCommands: () => getMergedPaletteCommands(cpInput?.value ?? ""),
          onBeforeOpen: async () => {
            closeHelpPanel();
            await refreshPaletteCommandsAndContext();
          },
          onClosed: () => {
            hideBuilder();
            getFocusedTerm()?.focus();
          },
          onTabComplete: (currentInput: string, selected) => {
            if (currentInput.startsWith("@pane:") && selected && selected.id.startsWith("pane-target-")) {
              const label = selected.label;
              const nameEnd = label.indexOf("  ");
              const paneName = nameEnd === -1 ? label.slice(6) : label.slice(6, nameEnd);
              return `@pane:${paneName} `;
            }
            if ((currentInput.startsWith("@proc:") || currentInput === "@proc") && selected && selected.id.startsWith("proc-")) {
              // Find the process command from the activeProcesses map
              const leafId = selected.id.slice(5); // "proc-<leafId>"
              const proc = activeProcesses.get(leafId);
              if (proc) return `@proc:${proc.command} `;
            }
            return null;
          },
          refreshMs: 500,
        })
      : null;

  openHelpPanel = () => {
    if (!helpPanelEl || builderMode) return;
    commandPalette?.close();
    hideBuilder();
    settingsApi?.close();
    renderHelpShortcuts();
    helpPanelEl.classList.remove("help-panel--hidden");
    helpPanelEl.setAttribute("aria-hidden", "false");
  };
  closeHelpPanel = () => {
    helpPanelEl?.classList.add("help-panel--hidden");
    helpPanelEl?.setAttribute("aria-hidden", "true");
    getFocusedTerm()?.focus();
  };
  toggleHelp = () => {
    if (!helpPanelEl) return;
    if (helpPanelEl.classList.contains("help-panel--hidden")) openHelpPanel();
    else closeHelpPanel();
  };

  document.getElementById("help-close")?.addEventListener("click", () => closeHelpPanel());
  helpPanelEl?.querySelector("[data-close-help]")?.addEventListener("click", () => closeHelpPanel());

  // Zen tab rename modal
  const zenModal = document.getElementById("zen-rename-modal");
  zenModal?.querySelector(".zen-rename-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    closeZenRenameModal(true);
  });
  zenModal?.querySelectorAll("[data-zen-rename-close]").forEach((el) => {
    el.addEventListener("click", () => closeZenRenameModal(false));
  });
  zenModal?.querySelector(".zen-rename-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeZenRenameModal(false);
  });
  zenModal?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeZenRenameModal(false);
  });
  document.getElementById("settings-toggle")?.addEventListener("click", () => settingsApi?.open());
  const appWindow = getCurrentWindow();
  async function syncMaximizeButtonTitle(): Promise<void> {
    const btn = document.getElementById("window-maximize");
    if (!btn) return;
    try {
      const m = await appWindow.isMaximized();
      btn.title = m ? "Restore" : "Maximize";
      btn.setAttribute("aria-label", m ? "Restore" : "Maximize");
    } catch {
      /* ignore */
    }
  }
  void syncMaximizeButtonTitle();
  void appWindow.onResized(() => {
    void syncMaximizeButtonTitle();
  });
  document.getElementById("window-maximize")?.addEventListener("pointerenter", () => {
    void syncMaximizeButtonTitle();
  });
  document.getElementById("window-quit")?.addEventListener("click", () => {
    void appWindow.destroy().catch(() => {});
  });
  document.getElementById("window-suspend")?.addEventListener("click", () => {
    void invoke("toggle_overlay").catch(() => {});
  });
  document.getElementById("window-minimize")?.addEventListener("click", () => {
    void appWindow.minimize().catch(() => {});
  });
  document.getElementById("window-maximize")?.addEventListener("click", () => {
    void (async () => {
      try {
        const isMax = await appWindow.isMaximized();
        if (isMax) await appWindow.unmaximize();
        else await appWindow.maximize();
        await syncMaximizeButtonTitle();
      } catch {
        /* ignore */
      }
    })();
  });

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isHelpHotkeysChord(e)) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest("#command-palette") &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA")
      )
        return;
      if (
        t?.closest("#settings-panel") &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
      )
        return;
      if (t?.closest(".termie-dialog-input") || t?.closest(".termie-dialog-panel")) return;
      e.preventDefault();
      e.stopPropagation();
      toggleHelp();
    },
    true,
  );

  paletteCmdGlobal?.addEventListener("change", () => syncCwdScopeDisabled());

  cpBuilderBack?.addEventListener("click", () => {
    hideBuilder();
  });

  paletteCmdSave?.addEventListener("click", () => {
    const name = paletteCmdName?.value.trim() ?? "";
    const cmdText = paletteCmdText?.value ?? "";
    if (!name || !cmdText.trim()) return;
    const global = paletteCmdGlobal?.checked ?? true;
    const cwdScope = global ? null : paletteCmdCwd?.value.trim() || null;
    const shell = paletteContext.shell.trim().toLowerCase() || "pwsh";
    void (async () => {
      try {
        await invoke("upsert_palette_command", {
          cmd: {
            id: crypto.randomUUID(),
            name,
            command: cmdText,
            shell,
            cwd_scope: cwdScope,
          },
        });
        await refreshPaletteCommandsAndContext();
        hideBuilder();
        commandPalette?.close();
      } catch (e) {
        console.error("upsert_palette_command", e);
      }
    })();
  });

  if (commandPalette && cpRoot) {
    window.addEventListener(
      "keydown",
      (e) => {
        if (!isCommandPaletteChord(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (builderMode) {
          hideBuilder();
          return;
        }
        if (commandPalette.isOpen()) {
          commandPalette.close();
          return;
        }
        commandPalette.open();
      },
      true,
    );

    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || !commandPalette.isOpen() || !builderMode) return;
        e.preventDefault();
        e.stopPropagation();
        hideBuilder();
      },
      true,
    );
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (commandPalette?.isOpen()) return;
      if (settingsApi?.isOpen()) return;
      if (themeModal?.isOpen()) {
        e.preventDefault();
        themeModal.close();
        return;
      }
      if (helpPanelEl && !helpPanelEl.classList.contains("help-panel--hidden")) {
        e.preventDefault();
        closeHelpPanel();
      }
    },
    true,
  );

  async function runPrepareShow(): Promise<void> {
    if (localStorage.getItem(DEFER_PTY_REINIT_KEY) === "1") {
      localStorage.removeItem(DEFER_PTY_REINIT_KEY);
      await newTerminalSession();
    }
    scheduleResizeImmediate();
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    paneHost?.forEachPane((id) => {
      void ensurePtyForPane(id);
    });

    if (pendingSnapshot !== null) {
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      const t = getFocusedTerm();
      t?.reset();
      if (snap.length && t) {
        const tail = /\r|\n/.test(snap.slice(-1)) ? "" : "\r\n";
        t.write(snap + tail);
      }
    }

    await mountWebglForFocused();
    const ft = getFocusedTerm();
    if (ft) ft.refresh(0, ft.rows - 1);
    scheduleResizeImmediate();
    scheduleCwdSync();
    reflowAllPanes();

    if (lp.defer_window_show_until_prepared) {
      await invoke("commit_show_window").catch((e) => console.error("commit_show_window", e));
    }
  }

  await Promise.all([
    listen<PtyOutputEvent>("pty-output", (event) => {
      const { pane_id, data } = event.payload;
      queuePtyOutput(pane_id, data);
    }),
    listen<PtyExitEvent>("pty-exit", async (event) => {
      const { pane_id } = event.payload;
      const pending = pendingPtyOutputByPane.get(pane_id);
      if (pending) {
        pendingPtyOutputByPane.delete(pane_id);
        processPtyOutputBatch(pane_id, pending.data, pending.eventCount, pending.queuedAt);
      }
      await ptyAckExit(pane_id);
      const pt = getPaneTerminalById(pane_id);
      pt?.term.write("\r\n\x1b[90mReconnecting…\x1b[0m\r\n");
      if (document.visibilityState === "visible") {
        await ensurePtyForPane(pane_id);
      }
    }),
    listen("pty-session-shed", () => {
      liveCwd = null;
      paneCwdHints.clear();
      pendingPtyOutputByPane.clear();
      pendingSnapshot = null;
      paneHost?.forEachPane((_id, p) => {
        p.term.reset();
      });
      scheduleFileTreeRefresh();
      scheduleCwdSync();
    }),
    listen("partty-hide", () => {
      if (paneHost && lp.destroy_webview_on_hide) {
        persistCurrentWorkspaceTabLayout();
      }
      if (lp.discard_buffer_on_hide) {
        pendingSnapshot = null;
        paneHost?.forEachPane((_id, p) => p.term.reset());
      }
      if (lp.webgl_shed_on_hide) {
        shedWebgl();
      }
      // WebView teardown is scheduled from Rust after hide (see `schedule_destroy_webview_after_hide`).
    }),
    listen("partty-prepare-show", () => {
      void runPrepareShow().catch((e) => {
        console.error("partty-prepare-show", e);
        void invoke("commit_show_window").catch(() => {
          /* still try to show */
        });
      });
    }),
    listen("partty-show", async () => {
      await mountWebglForFocused();
      getFocusedTerm()?.focus();
      scheduleResizeImmediate();
      scheduleFileTreeRefresh();
      scheduleCwdSync();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      releaseBootSurface();
      if (!lp.defer_window_show_until_prepared) {
        paneHost?.forEachPane((id) => {
          void ensurePtyForPane(id);
        });
      }
      reflowAllPanes();
      const ft = getFocusedTerm();
      if (ft) ft.refresh(0, ft.rows - 1);
      getFocusedTerm()?.focus();
    }),
  ]);

  // After destroy+recreate, Rust no longer emits `partty-prepare-show` until we signal listeners exist.
  await invoke("webview_boot_complete").catch(() => {
    /* ignore */
  });

  window.addEventListener("resize", () => scheduleResizeDebounced());
  void appWindow.onResized(() => scheduleResizeImmediate());
  void appWindow.onScaleChanged(() => scheduleResizeImmediate());
  if (terminalContent && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleResizeDebounced());
    ro.observe(terminalContent);
  }

  stage?.addEventListener("mousedown", () => {
    getFocusedTerm()?.focus();
  });

  requestAnimationFrame(() => {
    scheduleResizeImmediate();
    if (lp.preload_pty_on_startup) {
      paneHost?.forEachPane((id) => {
        void ensurePtyForPane(id);
      });
    } else {
      scheduleCwdSync();
    }
  });

  scheduleIdle(() => {
    void (async () => {
      const fts = document.getElementById("file-tree-scroll");
      if (fts && !fileTreePanel) {
        fileTreeCoordinator = new FileTreeCoordinator({
          onFileTreeRootChange: (root) => {
            liveCwd = root;
            void fileTreePanel?.setRoot(root);
          },
          onGitStatusChange: (statuses) => {
            fileTreePanel?.updateGitStatuses(statuses);
          },
          onGitRepoInfoChange: (repoInfo) => {
            fileTreePanel?.updateRepoInfo(repoInfo);
          },
          onFileSystemChange: (paths) => {
            fileTreePanel?.handleFileSystemChange(paths);
          },
        });
        fileTreeBackend = fileTreeCoordinator.getFileTreeBackend();
        fileTreePanel = new FileTreePanel(
          fts,
          fileTreeBackend,
          () => showDiffCountsRef.v,
          () => showGitInfoRef.v,
          () => confirmDeletePromptRef.v,
          (enabled) => {
            confirmDeletePromptRef.v = enabled;
            void setDeleteConfirmPrompt(enabled);
          },
          () => fileTreeSideRef.v,
          (side) => {
            void setFileTreeSide(side);
          },
          () => gitAwareSearchRef.v,
        );
        fileTreePanel.setSearchEnabled(!disableSearchRef.v);
        const focusedPaneId = paneHost?.getFocusedPaneId();
        if (focusedPaneId) {
          fileTreePanel.setActivePane(focusedPaneId);
          fileTreeCoordinator.seedPaneCwd(focusedPaneId, paneCwdHints.get(focusedPaneId) ?? liveCwd);
          fileTreeCoordinator.handlePaneFocus(focusedPaneId);
        }
        void fileTreeCoordinator.syncCwdFromBackend().then(() => fileTreeCoordinator?.refresh());
      }
      scheduleResizeImmediate();
    })();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleResizeDebounced();
      scheduleCwdSync();
      reflowAllPanes();
      getFocusedTerm()?.focus();
    }
  });

  window.addEventListener("beforeunload", () => {
    bridgeScrollCleanup?.();
    fileTreePanel?.dispose();
    fileTreeCoordinator?.dispose();
    fileTreeBackend?.dispose();
    paneHost = null;
    commandPalette?.dispose();
  });
}

void boot();
