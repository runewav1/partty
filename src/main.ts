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
  type TermieLifecyclePrefs,
} from "./termLifecycle";
import { findPaneLeaf, type PaneHostInit, type PaneTerminal, PaneHost } from "./paneHost";
import {
  clearPaneLayout,
  isLayoutValidForRoot,
  savePaneLayout,
  snapshotTreeFromPaneHost,
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
import { initTermieScrollFade } from "./scrollChrome";
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
  buildXtermThemeFromDocument,
  DEFAULT_TERMINAL_FONT_STACK,
  loadCustomThemesIntoCache,
  pickUiPrefs,
  uiPrefsChanged,
} from "./uiTheme";
import {
  createShellIntegrationState,
  processShellIntegration,
  type ShellIntegrationState,
} from "./shellIntegration";
import { createBlockOverlay, type BlockOverlayHandle, type SendToBuilderHandler } from "./commandBlockOverlay";
import {
  createCommandPalette,
  isCommandPaletteChord,
  isHelpHotkeysChord,
  type PaletteCommand,
} from "./commandPalette";
import { showAlert } from "./dialog";
import {
  type PaletteContext,
  type SavedPaletteCommand,
  savedCommandMatchesContext,
} from "./paletteCommands";
import { normalizeFsPathKey } from "./oscCwd";
import { createSettingsPanel, type TermiePrefs } from "./settingsPanel";
import { createTerminalSearch } from "./searchModal";
import { createThemeBuilderModal, type ThemeBuilderApi } from "./themeBuilderModal";
import { createThemeModal, type ThemeModalApi } from "./themeModal";
import { FileTreePanel } from "./fileTreePanel";
import { FileTreeCoordinator } from "./fileTreeCoordinator";
import { FileTreeBackend } from "./fileTreeBackend";
import {
  ptyAckExit,
  popOutPane,
  ptyEnsure,
  ptyFocusPane,
  ptyKillPane,
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
import { termiePerf } from "./perf";

// Terminal color constants with fallbacks
// CSS variables are read after DOM is ready in boot()
const TERM_BG_FALLBACK = "#2e2e32";
const TERM_FG_FALLBACK = "#d4d4d8";

const RESIZE_DEBOUNCE_MS = 100;
const PTY_OUTPUT_FLUSH_MS = 8;
const PTY_OUTPUT_INTERACTIVE_CHARS = 2048;
const PTY_OUTPUT_MAX_BATCH_CHARS = 128 * 1024;
const MINIMAP_STORAGE_KEY = "termie.minimap.enabled";
const MINIMAP_HIDDEN_PANES_KEY = "termie.minimap.hiddenPanes";
const FILE_TREE_STORAGE_KEY = "termie.filetree.visible";
const FILE_TREE_WIDTH_KEY = "termie.filetree.widthPx";
const ZEN_MODE_STORAGE_KEY = "termie.zen.enabled";
const TOOLTIP_STASH_ATTR = "data-termie-tooltip-title";
/** Set when shell / initial cwd change; next `termie-prepare-show` runs a full PTY reinit. */
const DEFER_PTY_REINIT_KEY = "termie.defer_pty_reinit";
const IDLE_WEBGL_MS = 400;

type PersistedPayload = { prefs: Record<string, unknown> };

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

function applyTerminalDisplayPrefs(raw: Partial<TermiePrefs>): void {
  const root = document.documentElement;
  const paneGap = typeof raw.terminal_pane_gap === "number" ? raw.terminal_pane_gap : raw.terminal_no_gap ? 0 : 6;
  root.classList.toggle("terminal-no-gap", paneGap <= 0);
  root.classList.toggle("terminal-no-round", Boolean(raw.terminal_no_round));
  root.classList.toggle("terminal-motion-off", animationScaleForPref(raw.terminal_animation_speed) === "0");
  root.style.setProperty("--termie-animation-scale", animationScaleForPref(raw.terminal_animation_speed));
  const paneAlpha = typeof raw.pane_background_opacity === "number" ? raw.pane_background_opacity : 1;
  const backdropAlpha = typeof raw.window_effect_opacity === "number" ? raw.window_effect_opacity : 0;
  const appAlpha = raw.window_effect_mode === "transparent" ? backdropAlpha : 1;
  const paneRadius = typeof raw.pane_corner_radius === "number" ? raw.pane_corner_radius : 6;
  root.style.setProperty("--pane-outer-gap", `${Math.max(0, Math.min(32, paneGap))}px`);
  root.style.setProperty("--termie-app-bg-alpha", String(appAlpha));
  root.style.setProperty("--termie-pane-bg-alpha", String(Math.max(0, Math.min(1, paneAlpha))));
  root.style.setProperty("--termie-pane-radius", `${Math.max(0, Math.min(32, paneRadius))}px`);
  root.classList.toggle("pane-bg-transparent", paneAlpha < 0.999);
}

function loadMinimapHiddenPaneIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MINIMAP_HIDDEN_PANES_KEY);
    if (!raw) return new Set();
    const a = JSON.parse(raw) as unknown;
    if (!Array.isArray(a)) return new Set();
    return new Set(a.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveMinimapHiddenPaneIds(ids: Set<string>): void {
  try {
    localStorage.setItem(MINIMAP_HIDDEN_PANES_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function isWorkspaceLayoutUsable(p: PersistedPaneLayout, tabId: string): boolean {
  const rid = workspaceRootPaneId(tabId);
  if (!isLayoutValidForRoot(p, rid)) return false;
  return findPaneLeaf(p.tree, p.focusedId) != null;
}

type MinimapHandle = {
  dispose(): void;
  attach(): void;
  resizeToHost(): void;
  setSearchHighlights(lines: Iterable<number> | null): void;
};

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

/** Block browser print (Ctrl+P) only when focus is not in a terminal so TUIs receive Ctrl+P. */
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
  mountSettingsCogIcon();
  const persisted = await invoke<PersistedPayload>("get_persisted_state");
  syncRuntimeShedFromPrefs(persisted.prefs as TermiePrefs);
  await loadCustomThemesIntoCache();
  const lp: TermieLifecyclePrefs = mergeLifecyclePrefs(persisted.prefs);
  const uiPrefs = pickUiPrefs(persisted.prefs);
  applyUiTheme(uiPrefs);
  applyTerminalDisplayPrefs(persisted.prefs as Partial<TermiePrefs>);

  const minimapUserEnabled = localStorage.getItem(MINIMAP_STORAGE_KEY) !== "0";
  document.documentElement.classList.toggle("minimap-off", !minimapUserEnabled);
  document.documentElement.classList.toggle("pane-blur-unfocused", Boolean((persisted.prefs as Partial<TermiePrefs>).blur_unfocused_panes));
  document.documentElement.classList.toggle("pane-dim-unfocused", Boolean((persisted.prefs as Partial<TermiePrefs>).dim_unfocused_panes));

  const fileTreeUserEnabled = localStorage.getItem(FILE_TREE_STORAGE_KEY) === "1";
  document.documentElement.classList.toggle("file-tree-on", fileTreeUserEnabled);
  const prefAlwaysZen = Boolean((persisted.prefs as Partial<TermiePrefs>).always_open_in_zen_mode);
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

  const TERM_BG = getComputedStyle(document.documentElement).getPropertyValue("--term-bg").trim() || TERM_BG_FALLBACK;
  const TERM_FG = getComputedStyle(document.documentElement).getPropertyValue("--term-fg").trim() || TERM_FG_FALLBACK;
  const defaultFg = hexRgb(TERM_FG);
  const defaultBg = hexRgb(TERM_BG);
  const emptyLineRgb: [number, number, number] = [
    Math.round(defaultFg[0] * 0.5 + defaultBg[0] * 0.5),
    Math.round(defaultFg[1] * 0.5 + defaultBg[1] * 0.5),
    Math.round(defaultFg[2] * 0.5 + defaultBg[2] * 0.5),
  ];

  let paneHost: PaneHost | null = null;
  const paneCwdHints = new Map<string, string>();
  const paneShellState = new Map<string, ShellIntegrationState>();
  const paneBlockOverlays = new Map<string, BlockOverlayHandle>();
  const pendingBlockOverlayRefreshPanes = new Set<string>();
  const lastPtyDims = new Map<string, { cols: number; rows: number }>();
  const focusFollowsRef = { v: lp.focus_follows_cursor };
  const autoCopySelectionRef = {
    v: Boolean((persisted.prefs as Partial<TermiePrefs>).auto_copy_selection),
  };
  const showDiffCountsRef = {
    v: Boolean((persisted.prefs as Partial<TermiePrefs>).file_tree_show_diff_counts),
  };
  const showGitInfoRef = {
    v: (persisted.prefs as Partial<TermiePrefs>).file_tree_show_git_info ?? true,
  };
  const disableSearchRef = {
    v: Boolean((persisted.prefs as Partial<TermiePrefs>).file_tree_disable_search),
  };
  const disableTooltipsRef = {
    v: (persisted.prefs as Partial<TermiePrefs>).ui_disable_tooltips ?? false,
  };
  const clickToCursorRef = {
    v: (persisted.prefs as Partial<TermiePrefs>).terminal_click_to_cursor ?? true,
  };
  const backspaceDeleteSelectionRef = {
    v: (persisted.prefs as Partial<TermiePrefs>).terminal_backspace_delete_selection ?? true,
  };
  const confirmDeletePromptRef = {
    v: (persisted.prefs as Partial<TermiePrefs>).confirm_delete_prompt ?? true,
  };
  const pendingPtyWriteByPane = new Map<string, string>();
  const pendingPtyOutputByPane = new Map<string, PendingPtyOutput>();
  let pendingPtyWriteRaf = 0;
  let pendingPtyOutputRaf = 0;
  let pendingPtyOutputTimer = 0;
  let pendingBlockOverlayRaf = 0;
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
      termiePerf.mark("pty.input.immediate");
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
    termiePerf.mark("pty.output.events", eventCount);
    termiePerf.mark("pty.output.chars", data.length);
    termiePerf.time("pty.output.queue.ms", performance.now() - queuedAt);

    // Pre-process: let the coordinator detect OSC 7 cwd before shell integration strips it.
    // This is a defence-in-depth pass — processShellIntegration also handles OSC 7/633.
    let parseInput = data;
    if (fileTreeCoordinator) {
      const pre = fileTreeCoordinator.processRawTerminalOutput(paneId, data);
      parseInput = pre.cleaned;
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

    const siState = ensureShellState(paneId);
    const parseStarted = performance.now();
    const si = processShellIntegration(parseInput, siState, pt.term, cwdHandler);
    termiePerf.time("pty.output.parse.ms", performance.now() - parseStarted);

    if (fileTreeCoordinator && si.events.length > 0) {
      fileTreeCoordinator.processShellIntegrationEvents(paneId, si.events);
    }

    if (si.cleaned) {
      const writeStarted = performance.now();
      try {
        pt.term.write(si.cleaned, () => {
          termiePerf.time("xterm.write.callback.ms", performance.now() - writeStarted);
        });
        termiePerf.time("xterm.write.call.ms", performance.now() - writeStarted);
      } catch (e) {
        console.warn("xterm.write", e);
      }
    }

    if (si.commandsChanged || si.events.length > 0) {
      queueBlockOverlayRefresh(paneId);
    }
    scheduleCwdSync();
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
    const batches = [...pendingPtyOutputByPane.entries()];
    pendingPtyOutputByPane.clear();
    for (const [paneId, batch] of batches) {
      processPtyOutputBatch(paneId, batch.data, batch.eventCount, batch.queuedAt);
    }
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
      termiePerf.mark("pty.output.immediate");
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

  const repositionCursorFromClick = (
    paneId: string,
    term: Terminal,
    host: HTMLElement,
    ev: MouseEvent,
  ): void => {
    if (!clickToCursorRef.v) return;
    if (ev.button !== 0 || ev.defaultPrevented) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    if (ev.detail !== 1) return;
    if (term.hasSelection()) return;

    const cell = getTerminalClickCell(term, host, ev);
    if (!cell) return;

    const b = term.buffer.active;
    const cursorAbsY = b.baseY + b.cursorY;
    const clickAbsY = b.viewportY + cell.row;
    if (clickAbsY !== cursorAbsY) return;

    const delta = cell.col - b.cursorX;
    if (delta === 0) return;
    const n = Math.abs(delta);
    const seq = delta > 0 ? "\x1b[C".repeat(n) : "\x1b[D".repeat(n);
    queuePtyWrite(paneId, seq);
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
          n.querySelectorAll<HTMLElement>("[title], [data-termie-tooltip-title]").forEach((el) =>
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

  let blockOverlayRerunRef: ((paneId: string, command: string) => void) | null = null;
  let blockOverlaySendToBuilderRef: SendToBuilderHandler | null = null;

  function ensureBlockOverlay(paneId: string): void {
    if (paneBlockOverlays.has(paneId)) return;
    const pt = paneHost?.getPaneTerminal(paneId);
    if (!pt) return;
    const siState = ensureShellState(paneId);
    const overlay = createBlockOverlay(
      pt.term,
      siState,
      paneId,
      copyToClipboard,
      (cmd) => blockOverlayRerunRef?.(paneId, cmd),
      (cmd) => blockOverlaySendToBuilderRef?.(cmd),
    );
    paneBlockOverlays.set(paneId, overlay);
  }

  function disposeBlockOverlay(paneId: string): void {
    paneBlockOverlays.get(paneId)?.dispose();
    paneBlockOverlays.delete(paneId);
    pendingBlockOverlayRefreshPanes.delete(paneId);
  }

  function flushBlockOverlayRefreshes(): void {
    pendingBlockOverlayRaf = 0;
    if (pendingBlockOverlayRefreshPanes.size === 0) return;
    const paneIds = [...pendingBlockOverlayRefreshPanes];
    pendingBlockOverlayRefreshPanes.clear();
    for (const paneId of paneIds) {
      const started = performance.now();
      paneBlockOverlays.get(paneId)?.refresh();
      termiePerf.mark("overlay.refresh");
      termiePerf.time("overlay.refresh.ms", performance.now() - started);
    }
  }

  function queueBlockOverlayRefresh(paneId: string): void {
    pendingBlockOverlayRefreshPanes.add(paneId);
    if (pendingBlockOverlayRaf) return;
    pendingBlockOverlayRaf = requestAnimationFrame(flushBlockOverlayRefreshes);
  }

  function cleanupPaneVisualState(paneId: string): void {
    minimapHiddenPanes.delete(paneId);
    saveMinimapHiddenPaneIds(minimapHiddenPanes);
    disposeWebglForPane(paneId);
    disposeMinimapForPane(paneId);
    disposeBlockOverlay(paneId);
    paneShellState.delete(paneId);
    paneCwdHints.delete(paneId);
    lastPtyDims.delete(paneId);
    pendingPtyWriteByPane.delete(paneId);
    pendingPtyOutputByPane.delete(paneId);
  }

  const paneWebglStates = new Map<string, PaneWebglState>();
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
    const title = cwd ? `Termie - ${cwd}` : "Termie - Detached Pane";
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
    termiePerf.mark("webgl.dispose");
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
    termiePerf.gauge("webgl.panes.pending", pending);
    termiePerf.gauge("webgl.panes.ready", ready);
    termiePerf.gauge("webgl.panes.failed", failed);
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
    termiePerf.mark("webgl.mount.start");

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
          termiePerf.mark("webgl.context_loss");
          disposeWebglForPane(paneId);
          void ensureWebglOnPane(paneId);
        });
        state.addon = addon;
        state.status = "ready";
        paneWebglStates.set(paneId, state);
        updateWebglPerfGauges();
        pt.term.refresh(0, pt.term.rows - 1);
        termiePerf.mark("webgl.mount.ready");
        termiePerf.time("webgl.mount.ms", performance.now() - started);
        return;
      } catch (e) {
        state.lastError = e;
        termiePerf.mark("webgl.mount.failure");
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

  function attachTermKeyHandler(term: Terminal): void {
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
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
        paneHost?.splitFocused("h");
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
        paneHost?.splitFocused("v");
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
        e.altKey &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === "m" || e.key === "M")
      ) {
        e.preventDefault();
        toggleMinimapForFocusedPane();
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

  const paneMinimaps = new Map<string, MinimapHandle>();
  let minimapOn = minimapUserEnabled;
  let minimapHiddenPanes = loadMinimapHiddenPaneIds();
  let fileTreePanel: FileTreePanel | null = null;
  let fileTreeBackend: FileTreeBackend | null = null;
  let fileTreeCoordinator: FileTreeCoordinator | null = null;
  let fileTreeRefreshTimer = 0;
  let cwdSyncTimer = 0;

  const minimapTheme: {
    track: string;
    thumb: string;
    thumbBorder: string;
    defaultFg: [number, number, number];
    defaultBg: [number, number, number];
    emptyLineRgb: [number, number, number];
    searchHighlight: string;
  } = {
    track: getComputedStyle(document.documentElement).getPropertyValue("--minimap-track").trim() || "rgba(0,0,0,0.32)",
    thumb: getComputedStyle(document.documentElement).getPropertyValue("--minimap-thumb").trim() || "rgba(255,255,255,0.26)",
    thumbBorder: getComputedStyle(document.documentElement).getPropertyValue("--minimap-thumb-border").trim() || "rgba(255,255,255,0.48)",
    defaultFg,
    defaultBg,
    emptyLineRgb,
    searchHighlight:
      getComputedStyle(document.documentElement).getPropertyValue("--minimap-search-highlight").trim() ||
      "rgba(255, 230, 90, 0.92)",
  };

  function syncMinimapThemeFromCss(): void {
    const cs = getComputedStyle(document.documentElement);
    minimapTheme.track = cs.getPropertyValue("--minimap-track").trim() || "rgba(0,0,0,0.32)";
    minimapTheme.thumb = cs.getPropertyValue("--minimap-thumb").trim() || "rgba(255,255,255,0.26)";
    minimapTheme.thumbBorder = cs.getPropertyValue("--minimap-thumb-border").trim() || "rgba(255,255,255,0.48)";
    const fg = cs.getPropertyValue("--term-fg").trim() || TERM_FG_FALLBACK;
    const bg = cs.getPropertyValue("--term-bg").trim() || TERM_BG_FALLBACK;
    const f = hexRgb(fg);
    const b = hexRgb(bg);
    minimapTheme.defaultFg = f;
    minimapTheme.defaultBg = b;
    minimapTheme.emptyLineRgb = [
      Math.round(f[0] * 0.5 + b[0] * 0.5),
      Math.round(f[1] * 0.5 + b[1] * 0.5),
      Math.round(f[2] * 0.5 + b[2] * 0.5),
    ];
    minimapTheme.searchHighlight =
      cs.getPropertyValue("--minimap-search-highlight").trim() || "rgba(255, 230, 90, 0.92)";
  }

  function refreshAllTerminalThemes(): void {
    const th = buildXtermThemeFromDocument();
    paneHost?.forEachPane((_id, pt) => {
      pt.term.options.theme = { ...th, cursorAccent: th.background ?? TERM_BG_FALLBACK };
      pt.term.refresh(0, pt.term.rows - 1);
    });
  }

  function setMinimapGutter(css: string): void {
    document.documentElement.style.setProperty("--term-minimap-gutter", css);
  }

  if (minimapOn) setMinimapGutter("11px");
  else setMinimapGutter("0px");

  function disposeMinimapForPane(paneId: string): void {
    paneMinimaps.get(paneId)?.dispose();
    paneMinimaps.delete(paneId);
  }

  function disposeAllMinimaps(): void {
    for (const id of [...paneMinimaps.keys()]) disposeMinimapForPane(id);
  }

  async function ensureMinimapForPane(paneId: string): Promise<void> {
    if (!minimapOn || minimapHiddenPanes.has(paneId)) return;
    const pt = paneHost?.getPaneTerminal(paneId);
    if (!pt) return;
    const existing = paneMinimaps.get(paneId);
    if (existing) {
      existing.resizeToHost();
      return;
    }
    const compact = pt.minimapAside.querySelector(".minimap-compact") as HTMLElement | null;
    if (!compact) return;
    const minimapMod = await import("./terminalMinimap");
    const m = new minimapMod.TerminalMinimap(pt.term, compact, pt.minimapCanvas, {
      theme: minimapTheme,
    });
    m.attach();
    paneMinimaps.set(paneId, m);
  }

  function resizeAllMinimaps(): void {
    for (const m of paneMinimaps.values()) m.resizeToHost();
  }

  function setMinimapEnabled(on: boolean): void {
    minimapOn = on;
    localStorage.setItem(MINIMAP_STORAGE_KEY, on ? "1" : "0");
    document.documentElement.classList.toggle("minimap-off", !on);
    if (!on) {
      disposeAllMinimaps();
      setMinimapGutter("0px");
    } else {
      setMinimapGutter("11px");
      paneHost?.forEachPane((id) => {
        if (!minimapHiddenPanes.has(id)) void ensureMinimapForPane(id);
      });
    }
    scheduleResizeImmediate();
  }

  function syncPaneMinimapClass(paneId: string): void {
    const root = paneHost?.getHostRoot();
    if (!root) return;
    const leaf = root.querySelector(`.pane-leaf[data-pane-id="${CSS.escape(paneId)}"]`);
    if (!leaf) return;
    const hide = minimapOn && minimapHiddenPanes.has(paneId);
    leaf.classList.toggle("pane-leaf--minimap-off", hide);
  }

  function syncAllPaneMinimapClasses(): void {
    paneHost?.forEachPane((id) => syncPaneMinimapClass(id));
  }

  function toggleMinimapForFocusedPane(): void {
    if (!minimapOn) return;
    const id = paneHost?.getFocusedPaneId();
    if (!id) return;
    if (minimapHiddenPanes.has(id)) {
      minimapHiddenPanes.delete(id);
      saveMinimapHiddenPaneIds(minimapHiddenPanes);
      void ensureMinimapForPane(id);
    } else {
      minimapHiddenPanes.add(id);
      saveMinimapHiddenPaneIds(minimapHiddenPanes);
      disposeMinimapForPane(id);
    }
    syncPaneMinimapClass(id);
    scheduleResizeImmediate();
  }

  let debounceTimer = 0;
  let layoutRaf = 0;
  let layoutForceRefresh = false;

  function runLayoutPass(forceRefresh = false): void {
    layoutRaf = 0;
    const shouldForceRefresh = forceRefresh || layoutForceRefresh;
    layoutForceRefresh = false;
    paneHost?.forEachPane((paneId, pt) => {
      const fitStarted = performance.now();
      pt.fit.fit();
      termiePerf.time("layout.fit.ms", performance.now() - fitStarted);
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
      termiePerf.mark("layout.pty_resize");
      void ptyResize(paneId, safe.cols, safe.rows)
        .then(() => {
          pt.term.refresh(0, pt.term.rows - 1);
        })
        .catch((e) => console.warn("pty_resize", e));
    });
    resizeAllMinimaps();
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
      const state = await invoke<{ window: Record<string, unknown>; prefs: TermiePrefs }>(
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
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      requestAnimationFrame(() => runLayoutPass());
    });
  }

  function scheduleResizeDebounced(forceRefresh = false): void {
    layoutForceRefresh ||= forceRefresh;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      requestLayoutPass();
    }, RESIZE_DEBOUNCE_MS);
  }

  function scheduleResizeImmediate(forceRefresh = false): void {
    layoutForceRefresh ||= forceRefresh;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = 0;
    requestLayoutPass();
  }

  async function ensurePtyForPane(paneId: string, ptIn?: PaneTerminal): Promise<void> {
    const pt = ptIn ?? paneHost?.getPaneTerminal(paneId);
    if (!pt) return;
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
        await ptyEnsure(paneId, safe.cols, safe.rows);
        lastPtyDims.set(paneId, safe);
        termiePerf.mark("pty.ensure.success");
        termiePerf.time("pty.ensure.ms", performance.now() - ensureStarted);
        if (paneId === paneHost?.getFocusedPaneId()) scheduleCwdSync();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    const msg = String(lastErr);
    console.error("pty_ensure failed:", lastErr);
    termiePerf.mark("pty.ensure.failure");
    termiePerf.time("pty.ensure.ms", performance.now() - ensureStarted);
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

    paneMinimaps.get(paneId)?.resizeToHost();

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

  function createPaneHost(container: HTMLElement, init: PaneHostInit | undefined, rootPaneId: string): PaneHost {
    return new PaneHost(
      container,
      {
      rootPaneId,
      scrollbackLines: lp.scrollback_lines,
      fontStack: terminalFontStackFromDocument(),
      getTheme: () => buildXtermThemeFromDocument(),
      focusFollowsCursor: () => focusFollowsRef.v,
      onPaneFocus: (id) => {
        lastFocusedPaneId = id;
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
        attachTermKeyHandler(pt.term);
        pt.term.onData((data) => {
          queuePtyWrite(id, data);
          if (data.includes("\r") || data.includes("\n")) {
            scheduleCwdSync();
          }
        });
        pt.host.addEventListener("click", (ev) => {
          if (openLinkFromCtrlClick(pt.term, pt.host, ev)) return;
          repositionCursorFromClick(id, pt.term, pt.host, ev);
        });
        pt.host.addEventListener("mousemove", (ev) => {
          updateCtrlLinkHover(pt.term, pt.host, ev);
        });
        pt.host.addEventListener("mouseleave", () => {
          pt.host.classList.remove("pane-terminal-host--ctrl-link-hover");
          pt.host.removeAttribute("title");
        });
        pt.term.onSelectionChange(() => {
          if (!autoCopySelectionRef.v || !pt.term.hasSelection()) return;
          copyToClipboard(pt.term.getSelection());
        });
        if (lp.preload_webgl_on_startup) void ensureWebglOnPane(id);
        if (minimapOn && !minimapHiddenPanes.has(id)) void ensureMinimapForPane(id);
        ensureBlockOverlay(id);
        queueMicrotask(() => {
          void ensurePtyForPane(id, pt);
        });
      },
      onPaneDisposed: (pid) => {
        void ptyKillPane(pid).catch(() => {});
        cleanupPaneVisualState(pid);
        fileTreePanel?.clearPaneState(pid);
        fileTreeCoordinator?.handlePaneDispose(pid);
      },
      onPaneLayout: () => scheduleResizeImmediate(),
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
    createTabPaneShellAndHost(tab.id, {
      initialTree: layout.tree,
      initialFocusedId: layout.focusedId,
    });
    if (tab.id !== activeWorkspaceTabId) {
      tabPaneShells.get(tab.id)?.classList.add("term-tab-pane-shell--hidden");
    }
  }
  paneHost = tabPaneHosts.get(activeWorkspaceTabId)!;
  lastFocusedPaneId = paneHost.getFocusedPaneId();
  syncAllPaneMinimapClasses();

  function persistCurrentWorkspaceTabLayout(): void {
    if (!paneHost) return;
    const tree = snapshotTreeFromPaneHost(paneHost.getHostRoot());
    const rid = paneHost.getRootPaneId();
    if (!tree || !findPaneLeaf(tree, rid)) return;
    const pl: PersistedPaneLayout = {
      v: 1,
      tree,
      focusedId: paneHost.getFocusedPaneId(),
    };
    savePaneLayout(paneHost.getHostRoot(), paneHost.getFocusedPaneId());
    persistLayoutForTab(activeWorkspaceTabId, pl);
  }

  function switchWorkspaceTab(tabId: string): void {
    if (tabId === activeWorkspaceTabId) return;
    const nextHost = tabPaneHosts.get(tabId);
    if (!nextHost) return;
    persistCurrentWorkspaceTabLayout();
    activeWorkspaceTabId = tabId;
    tabsState = { ...tabsState, activeTabId: tabId };
    saveTabsState(tabsState);
    for (const [id, shell] of tabPaneShells) {
      shell.classList.toggle("term-tab-pane-shell--hidden", id !== tabId);
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
      localStorage.removeItem(`termie.tab.layout.v1.${tabId}`);
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

  function beginTabRename(tabId: string): void {
    renamingTabId = tabId;
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

  function openNewWorkspaceTab(): void {
    const id = crypto.randomUUID();
    const name = nextTabName(tabsState.tabs);
    const empty = emptyWorkspaceLayout(id);
    const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
    tabsState = { ...tabsState, tabs: [...tabsState.tabs, { id, name, groupId: null, color: null, order: maxOrder + 1 }] };
    saveTabsState(tabsState);
    persistLayoutForTab(id, empty);
    createTabPaneShellAndHost(id, { initialTree: empty.tree, initialFocusedId: empty.focusedId });
    switchWorkspaceTab(id);
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
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
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
  initTermieScrollFade();

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

  const searchModalRoot = document.getElementById("search-modal-root");
  const terminalSearch = searchModalRoot
    ? createTerminalSearch({
        root: searchModalRoot,
        getPaneHost: () => paneHost,
        getMinimapForPane: (id) => paneMinimaps.get(id),
        focusPane: (id) => {
          paneHost?.setFocusedPaneId(id);
        },
      })
    : null;

  const themeBuilderRoot = document.getElementById("theme-builder-root");
  let themeBuilder: ThemeBuilderApi | null = null;
  if (themeBuilderRoot) {
    themeBuilder = createThemeBuilderModal(themeBuilderRoot as HTMLElement, (prefs) => {
      applyUiTheme(prefs);
      syncMinimapThemeFromCss();
      disposeAllMinimaps();
      refreshAllTerminalThemes();
      if (minimapOn) {
        paneHost?.forEachPane((id) => {
          void ensureMinimapForPane(id);
        });
      }
    });
  }

  const themeModalRoot = document.getElementById("theme-modal-root");
  let themeModal: ThemeModalApi | null = null;
  if (themeModalRoot) {
    themeModal = createThemeModal(themeModalRoot as HTMLElement, (prefs) => {
      applyUiTheme(prefs);
      syncMinimapThemeFromCss();
      disposeAllMinimaps();
      refreshAllTerminalThemes();
      if (minimapOn) {
        paneHost?.forEachPane((id) => {
          void ensureMinimapForPane(id);
        });
      }
    });
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "f" && e.key !== "F") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("#command-palette") || t?.closest("#settings-panel")) return;
      if (terminalSearch?.isOpen()) return;
      if (t?.closest(".term-search")) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !t.closest(".pane-terminal-host")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) terminalSearch?.openAllPanes();
      else terminalSearch?.openSinglePane();
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
        if ((target as HTMLElement | null)?.closest?.(".termie-cmd-decoration, .cmd-block-ctx")) return;
        void pasteFromClipboard();
        getFocusedTerm()?.focus();
      }
    },
    true,
  );

  document.getElementById("file-tree-toggle")?.addEventListener("click", () => toggleFileTree());
  const fileTreeDockEl = document.getElementById("file-tree-dock");
  const fileTreeResizeHandle = document.getElementById("file-tree-resize-handle");
  if (fileTreeDockEl) {
    fileTreeDockEl.setAttribute("aria-hidden", fileTreeUserEnabled ? "false" : "true");
  }

  fileTreeResizeHandle?.addEventListener("pointerdown", (e) => {
    if (!document.documentElement.classList.contains("file-tree-on")) return;
    e.preventDefault();
    fileTreeResizeHandle.classList.add("file-tree-resize-active");
    const startX = e.clientX;
    const startW = fileTreeDockEl?.getBoundingClientRect().width ?? 260;
    const onMove = (ev: PointerEvent): void => {
      const delta = ev.clientX - startX;
      const next = Math.round(Math.max(160, Math.min(560, startW + delta)));
      document.documentElement.style.setProperty("--file-tree-user-width", `${next}px`);
    };
    const onUp = (): void => {
      fileTreeResizeHandle.classList.remove("file-tree-resize-active");
      window.removeEventListener("pointermove", onMove);
      const w = fileTreeDockEl?.getBoundingClientRect().width;
      if (w) localStorage.setItem(FILE_TREE_WIDTH_KEY, String(Math.round(w)));
      scheduleResizeImmediate();
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
    disposeAllMinimaps();
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
    syncAllPaneMinimapClasses();
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

  const settingsApi = settingsPanelEl
    ? createSettingsPanel(settingsPanelEl, async (saved: TermiePrefs, previous: TermiePrefs) => {
        syncRuntimeShedFromPrefs(saved);
        focusFollowsRef.v = saved.focus_follows_cursor;
        autoCopySelectionRef.v = saved.auto_copy_selection;
        showDiffCountsRef.v = saved.file_tree_show_diff_counts;
        showGitInfoRef.v = saved.file_tree_show_git_info;
        disableSearchRef.v = saved.file_tree_disable_search ?? false;
        confirmDeletePromptRef.v = saved.confirm_delete_prompt ?? true;
        disableTooltipsRef.v = saved.ui_disable_tooltips ?? false;
        clickToCursorRef.v = saved.terminal_click_to_cursor ?? true;
        backspaceDeleteSelectionRef.v = saved.terminal_backspace_delete_selection ?? true;
        fileTreePanel?.setSearchEnabled(!(saved.file_tree_disable_search ?? false));
        applyTerminalDisplayPrefs(saved);
        applyTooltipPolicy(document);
        document.documentElement.classList.toggle("pane-blur-unfocused", saved.blur_unfocused_panes);
        document.documentElement.classList.toggle("pane-dim-unfocused", saved.dim_unfocused_panes);
        if (saved.always_open_in_zen_mode) {
          setZenMode(true);
        }
        const prevUi = pickUiPrefs(previous as unknown as Record<string, unknown>);
        const nextUi = pickUiPrefs(saved as unknown as Record<string, unknown>);
        if (uiPrefsChanged(prevUi, nextUi)) {
          applyUiTheme(nextUi);
          syncMinimapThemeFromCss();
          disposeAllMinimaps();
          refreshAllTerminalThemes();
          if (minimapOn) {
            paneHost?.forEachPane((id) => {
              void ensureMinimapForPane(id);
            });
          }
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
    attachDraggablePanel(cpPanel, cpToolbar, "termie.commandPalette.pos");
  }

  if (settingsPanelEl) {
    const card = settingsPanelEl.querySelector(".settings-panel-card");
    const head = settingsPanelEl.querySelector(".settings-panel-head");
    if (card instanceof HTMLElement && head instanceof HTMLElement) {
      card.style.position = "fixed";
      attachDraggablePanel(card, head, "termie.settingsPanel.pos");
    }
  }

  if (helpPanelEl) {
    const hcard = helpPanelEl.querySelector(".help-panel-card");
    const hhead = helpPanelEl.querySelector(".help-panel-head");
    if (hcard instanceof HTMLElement && hhead instanceof HTMLElement) {
      hcard.style.position = "fixed";
      attachDraggablePanel(hcard, hhead, "termie.helpPanel.pos");
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

  function getMergedPaletteCommands(query: string): PaletteCommand[] {
    const q = query.trimStart();
    if (q.startsWith(">")) {
      return [
        {
          id: "pane-cmd-clear",
          label: "> clear",
          keywords: "> clear screen cls reset terminal",
          run: () => void runPaneCmdClear(),
        },
        {
          id: "pane-cmd-exit",
          label: "> exit",
          keywords: "> exit ctrl c interrupt break cancel",
          run: () => runPaneCmdExit(),
        },
        {
          id: "pane-cmd-restart-shell",
          label: "> restart shell",
          keywords: "> restart shell respawn bash pwsh zsh",
          run: () => void runPaneCmdRestartShell(),
        },
      ];
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

    return [
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
        label: "Themes…",
        keywords: "theme appearance colors ui palette",
        run: () => themeModal?.open(),
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
        id: "find-in-pane",
        label: "Find pane",
        keywords: "search buffer ctrl f",
        hotkey: "Ctrl+F",
        run: () => terminalSearch?.openSinglePane(),
      },
      {
        id: "find-in-workspace",
        label: "Find workspace",
        keywords: "search workspace multi ctrl shift f",
        hotkey: "Ctrl+Shift+F",
        run: () => terminalSearch?.openAllPanes(),
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
        id: "minimap-global",
        label: minimapOn ? "View: Hide all minimaps" : "View: Show all minimaps",
        keywords: "minimap gutter global all panes",
        hotkey: "",
        run: () => {
          setMinimapEnabled(!minimapOn);
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
        keywords: "filter search grep rg find ctrl p",
        hotkey: "Ctrl+P",
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
        id: "hide-overlay",
        label: "Window: Hide Termie",
        keywords: "close overlay tray background hotkey",
        hotkey: "Alt+Shift+T",
        run: () => void invoke("toggle_overlay").catch(() => {}),
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
          paneHost?.splitFocused("h");
        },
      },
      {
        id: "pane-split-h",
        label: "Pane: Split horizontally (stacked)",
        keywords: "split rows layout",
        hotkey: "Alt+H",
        run: () => {
          paneHost?.splitFocused("v");
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
        })
      : null;

  blockOverlayRerunRef = (paneId: string, command: string) => {
    void ptyWrite(paneId, `${command}\r`).catch((e) => console.warn("rerun", e));
  };

  blockOverlaySendToBuilderRef = (command: string) => {
    commandPalette?.open();
    showBuilder();
    if (paletteCmdText) paletteCmdText.value = command;
    if (paletteCmdName) {
      paletteCmdName.value = "";
      requestAnimationFrame(() => paletteCmdName?.focus());
    }
  };

  openHelpPanel = () => {
    if (!helpPanelEl || builderMode) return;
    commandPalette?.close();
    hideBuilder();
    settingsApi?.close();
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
      if (terminalSearch?.isOpen()) {
        e.preventDefault();
        terminalSearch.close();
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
    resizeAllMinimaps();
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
    listen("termie-hide", () => {
      if (paneHost && lp.destroy_webview_on_hide) {
        persistCurrentWorkspaceTabLayout();
      }
      if (lp.discard_buffer_on_hide) {
        const t = getFocusedTerm();
        if (t) {
          pendingSnapshot = capturePlainBuffer(t, lp.snapshot_max_lines);
          t.reset();
        }
      }
      if (lp.webgl_shed_on_hide) {
        shedWebgl();
      }
      // WebView teardown is scheduled from Rust after hide (see `schedule_destroy_webview_after_hide`).
    }),
    listen("termie-prepare-show", () => {
      void runPrepareShow().catch((e) => {
        console.error("termie-prepare-show", e);
        void invoke("commit_show_window").catch(() => {
          /* still try to show */
        });
      });
    }),
    listen("termie-show", async () => {
      await mountWebglForFocused();
      getFocusedTerm()?.focus();
      scheduleResizeImmediate();
      scheduleFileTreeRefresh();
      scheduleCwdSync();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
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

  // After destroy+recreate, Rust no longer emits `termie-prepare-show` until we signal listeners exist.
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
      if (lp.preload_webgl_on_startup) {
        await mountWebglForFocused();
      }
      if (minimapOn) {
        paneHost?.forEachPane((id) => {
          void ensureMinimapForPane(id);
        });
      }
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
    disposeAllMinimaps();
    shedWebgl();
    for (const tid of [...tabPaneHosts.keys()]) {
      disposeTabPaneHost(tid);
    }
    paneHost = null;
    commandPalette?.dispose();
  });
}

void boot();
