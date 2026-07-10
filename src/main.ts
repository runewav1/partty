import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { FitAddon } from "@xterm/addon-fit";

import type { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  createWebglAddon,
  firstContentScrollbackLine,
  mergeLifecyclePrefs,
  type ParttyLifecyclePrefs,
} from "./termLifecycle";
import {
  LOCAL_DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_BEHAVIOR,
  profileIdAliasMap,
  resolveSelectionAliases,
  fetchProfiles,
  getProfileById,
  isProfilePickerAliasContext,
  parseProfilePickerQuery,
  profileActionForPaletteCommandId,
  resolveDefaultProfileId,
  resolveProfileShell,
  type ConnectionProfile,
  type ProfileBehaviorPrefs,
  type ProfilePaletteAction,
} from "./connectionProfiles";
import {
  findPaneLeaf,
  collectLeafIds,
  type PaneHostInit,
  type PaneTerminal,
  type SplitLayoutStyle,
  PaneHost,
} from "./paneHost";
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
import type { ShellIntegrationState } from "./shellIntegration";
import {
  createCommandPalette,
  type PaletteCommand,
} from "./commandPalette";
import {
  createPaneRenamePanel,
  type PaneRenamePanelApi,
} from "./paneRenamePanel";
import {
  createKeybinds,
} from "./keybinds";
import { showAlert } from "./dialog";
import pkg from "../package.json";
import { normalizeFsPathKey } from "./oscCwd";
import { createSettingsPanel, type ParttyPrefs } from "./settingsPanel";
import { createExtensionManager } from "./extensionManager";
import {
  createThemeBuilderModal,
  type ThemeBuilderApi,
} from "./themeBuilderModal";
import { createThemeModal, type ThemeModalApi } from "./themeModal";
import { createPresetsModal, type PresetsModalApi } from "./presetsModal";
import {
  createPresetEditorModal,
  type PresetEditorApi,
} from "./presetEditorModal";
import { writePresetJson, type Preset } from "./presets";

import {
  ptyAckExit,
  ptyEnsure,
  ptyFocusPane,
  ptyKillPane,
  ptyReplaySnapshot,
  ptyResize,
  ptyShellCwd,
  ptyWrite,
} from "./ptyIpc";
import { createTabCloseIcon } from "./toolbarIcons";
import { parttyPerf } from "./perf";
import { createDevMetricsOverlay, type DevMetricsOverlayApi } from "./devMetricsOverlay";
import {
  bindMouseCursorForceVisible,
  createMouseCursorController,
  mouseCursorForceVisible,
  type MouseCursorController,
} from "./mouseCursor";
import {
  applyShellCommandLine,
  createActiveProcessEntry,
  displayProcessCommand,
  markProcessExecStart,
  mergeProcessCommand,
  normalizeCommandLine,
  processDurationMs,
  shouldEndOnPromptStart,
  type ActiveProcessEntry,
} from "./processTracking";

// Terminal color constants with fallbacks
// CSS variables are read after DOM is ready in boot()
const TERM_BG_FALLBACK = "#2e2e32";

const RESIZE_DEBOUNCE_MS = 100;
const PTY_OUTPUT_FLUSH_MS = 4;
const PTY_OUTPUT_BACKGROUND_FLUSH_MS = 33;
const PTY_OUTPUT_MAX_BATCH_CHARS = 128 * 1024;

const ZEN_MODE_STORAGE_KEY = "partty.zen.enabled";
const TOOLTIP_STASH_ATTR = "data-partty-tooltip-title";
/** Set when shell / initial cwd change; next `partty-prepare-show` runs a full PTY reinit. */
const DEFER_PTY_REINIT_KEY = "partty.defer_pty_reinit";
const IDLE_WEBGL_MS = 400;

type PersistedPayload = { prefs: Record<string, unknown> };

const STORAGE_KEY_MIGRATIONS: [string, string][] = [
  ["termie.zen.enabled", ZEN_MODE_STORAGE_KEY],
  ["termie.defer_pty_reinit", DEFER_PTY_REINIT_KEY],
  ["termie.tabs.v1", "partty.tabs.v1"],
  ["termie.pane_layout.v1", "partty.pane_layout.v1"],
  ["termie.runtime.shed_workspace_exit", "partty.runtime.shed_workspace_exit"],
  ["termie.themeModal.pos", "partty.themeModal.pos"],
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
    // Legacy hide serialize path — scrollback now lives in process memory only.
    localStorage.removeItem("partty.terminal.serialize");
    localStorage.removeItem("termie.terminal.serialize");
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
  if (
    !Number.isFinite(cols) ||
    !Number.isFinite(rows) ||
    cols < 2 ||
    rows < 1
  ) {
    return null;
  }
  return { cols, rows };
}

function clampPtyColsRows(
  cols: number,
  rows: number,
): { cols: number; rows: number } {
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

function motionStyleForPref(value: unknown): string {
  const raw = typeof value === "string" ? value.toLowerCase() : "smooth";
  if (raw === "snappy" || raw === "gentle" || raw === "bouncy") return raw;
  return "smooth";
}

function applyTerminalDisplayPrefs(raw: Partial<ParttyPrefs>): void {
  const root = document.documentElement;
  const paneGap =
    typeof raw.terminal_pane_gap === "number"
      ? raw.terminal_pane_gap
      : raw.terminal_no_gap
        ? 0
        : 6;
  const sandboxPadding =
    typeof raw.terminal_sandbox_padding === "number"
      ? raw.terminal_sandbox_padding
      : 0;
  root.classList.toggle("terminal-no-gap", paneGap <= 0);
  root.classList.toggle("terminal-no-round", Boolean(raw.terminal_no_round));
  root.classList.toggle(
    "terminal-no-pane-border",
    Boolean(raw.terminal_no_pane_border),
  );
  root.classList.toggle(
    "terminal-no-focus-border",
    Boolean(raw.terminal_no_focus_border),
  );
  root.classList.toggle(
    "terminal-motion-off",
    animationScaleForPref(raw.terminal_animation_speed) === "0",
  );
  root.style.setProperty(
    "--termie-animation-scale",
    animationScaleForPref(raw.terminal_animation_speed),
  );
  root.dataset.motionStyle = motionStyleForPref(raw.terminal_animation_style);
  const backdropAlpha =
    typeof raw.window_effect_opacity === "number"
      ? raw.window_effect_opacity
      : 0;
  const appAlpha = raw.window_effect_mode === "transparent" ? backdropAlpha : 1;
  const paneRadius =
    typeof raw.pane_corner_radius === "number" ? raw.pane_corner_radius : 6;
  root.style.setProperty(
    "--pane-outer-gap",
    `${Math.max(0, Math.min(32, paneGap))}px`,
  );
  root.style.setProperty(
    "--pane-sandbox-padding",
    `${Math.max(0, Math.min(32, sandboxPadding))}px`,
  );
  root.style.setProperty("--termie-app-bg-alpha", String(appAlpha));
  root.style.setProperty(
    "--termie-pane-radius",
    `${Math.max(0, Math.min(32, paneRadius))}px`,
  );
}

function applyPaneFocusScalePrefs(raw: Partial<ParttyPrefs>): void {
  const enabled = raw.focus_pane_scale ?? true;
  const intensity = Math.max(
    0,
    Math.min(
      1,
      typeof raw.pane_focus_scale_intensity === "number"
        ? raw.pane_focus_scale_intensity
        : 0.45,
    ),
  );
  document.documentElement.classList.toggle(
    "pane-focus-scale",
    enabled && intensity > 0,
  );
  document.documentElement.style.setProperty(
    "--pane-focus-scale-delta",
    String(intensity * 0.014),
  );
}

function configureDevPerfPrefs(raw: Partial<ParttyPrefs>): void {
  parttyPerf.configure({
    enabled: Boolean(raw.dev_perf_enabled),
    consoleEnabled: Boolean(raw.dev_perf_console),
    consoleIntervalMs: raw.dev_perf_console_interval_ms ?? 5000,
  });
}

function normalizeSplitLayoutStyle(raw: unknown): SplitLayoutStyle {
  return raw === "dwindle" || raw === "master" ? raw : "balanced";
}

function resolveTabRootPaneId(
  layout: PersistedPaneLayout,
  tabId: string,
): string {
  const wsroot = workspaceRootPaneId(tabId);
  if (findPaneLeaf(layout.tree, wsroot)) return wsroot;
  const ids: string[] = [];
  collectLeafIds(layout.tree, ids);
  return ids[0] ?? wsroot;
}

function isWorkspaceLayoutUsable(
  p: PersistedPaneLayout,
  tabId: string,
): boolean {
  const rid = resolveTabRootPaneId(p, tabId);
  if (!isLayoutValidForRoot(p, rid)) return false;
  return findPaneLeaf(p.tree, p.focusedId) != null;
}

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

/** Tab index 0–9 from `Digit0`–`Digit9` (Ctrl+Shift+digit yields symbols in `e.key`, not digits). */
function tabHotkeyIndexFromEvent(e: KeyboardEvent): number | null {
  const match = e.code.match(/^Digit([0-9])$/);
  if (!match) return null;
  return match[1] === "0" ? 9 : Number.parseInt(match[1]!, 10) - 1;
}

/** Split axis when grafting a transferred pane onto an occupied tab (not pristine / new). */
const PANE_TRANSFER_SPLIT_DIR: "h" | "v" = "v";

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
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-terminal")
    .trim();
  return raw.replace(/^["']|["']$/g, "") || DEFAULT_TERMINAL_FONT_STACK;
}

async function boot(): Promise<void> {
  migrateParttyLocalStorage();
  const k = createKeybinds();
  const persisted = await invoke<PersistedPayload>("get_persisted_state");
  syncRuntimeShedFromPrefs(persisted.prefs as ParttyPrefs);
  configureDevPerfPrefs(persisted.prefs as Partial<ParttyPrefs>);
  parttyPerf.mark("boot.start");
  await loadCustomThemesIntoCache();
  const lp: ParttyLifecyclePrefs = mergeLifecyclePrefs(persisted.prefs);
  const uiPrefs = pickUiPrefs(persisted.prefs);
  let currentUiPrefs = uiPrefs;
  applyUiTheme(uiPrefs);
  applyTerminalDisplayPrefs(persisted.prefs as Partial<ParttyPrefs>  );

  document.documentElement.classList.toggle(
    "pane-blur-unfocused",
    Boolean((persisted.prefs as Partial<ParttyPrefs>).blur_unfocused_panes),
  );
  document.documentElement.style.setProperty(
    "--pane-blur-radius",
    String((persisted.prefs as Partial<ParttyPrefs>).pane_blur_radius ?? 1.6),
  );
  document.documentElement.style.setProperty(
    "--pane-opacity-focused",
    String((persisted.prefs as Partial<ParttyPrefs>).pane_opacity_focused ?? 1.0),
  );
  document.documentElement.style.setProperty(
    "--pane-opacity-unfocused",
    String((persisted.prefs as Partial<ParttyPrefs>).pane_opacity_unfocused ?? 1.0),
  );
  document.documentElement.classList.toggle(
    "pane-variable-opacity",
    Boolean((persisted.prefs as Partial<ParttyPrefs>).pane_variable_opacity),
  );
  applyPaneFocusScalePrefs(persisted.prefs as Partial<ParttyPrefs>);

  const prefAlwaysZen = Boolean(
    (persisted.prefs as Partial<ParttyPrefs>).always_open_in_zen_mode,
  );
  const zenModeEnabled =
    prefAlwaysZen || localStorage.getItem(ZEN_MODE_STORAGE_KEY) === "1";
  document.documentElement.classList.toggle("zen-mode", zenModeEnabled);
  const releaseBootSurface = (): void => {
    document.documentElement.classList.remove("partty-booting");
  };

  /** True from prepare-show until partty-show finishes (suppresses duplicate reflows). */
  let summonInProgress = false;
  /** Prepare already restored/mounted under defer-show; partty-show should no-op. */
  let summonPreparedByDefer = false;

  let paneHost: PaneHost | null = null;
  const paneCwdHints = new Map<string, string>();
  const paneProfileIds = new Map<string, string>();
  const paneShellState = new Map<string, ShellIntegrationState>();
  const paneNames = new Map<string, string>();
  const paneThemes = new Map<string, PaneThemePrefs>();
  const lastPtyDims = new Map<string, { cols: number; rows: number }>();
  const pendingNewPaneCwd = { v: null as string | null };
  const pendingPaneSpawnCwd = new Map<string, string>();
  const pendingNewPaneProfile = { v: null as string | null };
  const pendingPaneSpawnProfile = new Map<string, string>();
  let profilesList: ConnectionProfile[] = [];
  const focusFollowsRef = { v: lp.focus_follows_cursor };
  const autoCopySelectionRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).auto_copy_selection),
  };
  const rightClickPasteRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).right_click_paste ?? true,
  };
  const retainSessionStateRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).retain_session_state ?? true,
  };
  const splitLayoutStyleRef = {
    v: normalizeSplitLayoutStyle(
      (persisted.prefs as Partial<ParttyPrefs>).split_layout_style,
    ),
  };
  const profileBehaviorRef = {
    v: {
      default_profile_id:
        (persisted.prefs as Partial<ParttyPrefs>).default_profile_id ??
        DEFAULT_PROFILE_BEHAVIOR.default_profile_id,
      inherit_profile_on_split:
        (persisted.prefs as Partial<ParttyPrefs>).inherit_profile_on_split ??
        DEFAULT_PROFILE_BEHAVIOR.inherit_profile_on_split,
      inherit_cwd_on_split:
        (persisted.prefs as Partial<ParttyPrefs>).inherit_cwd_on_split ??
        DEFAULT_PROFILE_BEHAVIOR.inherit_cwd_on_split,
      palette_tab_profile_picker:
        (persisted.prefs as Partial<ParttyPrefs>).palette_tab_profile_picker ??
        DEFAULT_PROFILE_BEHAVIOR.palette_tab_profile_picker,
      new_tab_uses_default_profile:
        (persisted.prefs as Partial<ParttyPrefs>).new_tab_uses_default_profile ??
        DEFAULT_PROFILE_BEHAVIOR.new_tab_uses_default_profile,
      palette_profile_icons:
        (persisted.prefs as Partial<ParttyPrefs>).palette_profile_icons ??
        DEFAULT_PROFILE_BEHAVIOR.palette_profile_icons,
      profile_selection_aliases: resolveSelectionAliases(
        (persisted.prefs as Partial<ParttyPrefs>).profile_selection_aliases ??
          DEFAULT_PROFILE_BEHAVIOR.profile_selection_aliases,
      ),
    } satisfies ProfileBehaviorPrefs,
  };

  async function refreshProfilesList(): Promise<void> {
    try {
      profilesList = await fetchProfiles();
      profileBehaviorRef.v.default_profile_id = resolveDefaultProfileId(
        profileBehaviorRef.v.default_profile_id,
        profilesList,
      );
    } catch (e) {
      console.warn("list_profiles", e);
      if (profilesList.length === 0) {
        profilesList = [
          {
            version: 1,
            id: LOCAL_DEFAULT_PROFILE_ID,
            name: "Local",
            kind: "local",
            shell: null,
            builtin: true,
          },
        ];
      }
    }
  }
  const disableTooltipsRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).ui_disable_tooltips ?? false,
  };
  const altClickCursorRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>)
        .terminal_alt_click_moves_cursor ?? true,
  };
  const cursorBlinkRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_blink ?? true,
  };
  const cursorInactiveStyleRef = {
    v:
      ((persisted.prefs as Partial<ParttyPrefs>)
        .terminal_cursor_inactive_style as
        | "outline"
        | "block"
        | "bar"
        | "underline"
        | "none"
        | undefined) ?? "outline",
  };
  const cursorWidthRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_width ?? 1,
  };
  const fontSizeRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_font_size ?? 12,
  };
  const fontWeightRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).terminal_font_weight ??
      "normal",
  };
  const fontWeightBoldRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).terminal_font_weight_bold ??
      "bold",
  };
  const lineHeightRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_line_height ?? 1,
  };
  const letterSpacingRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_letter_spacing ?? 0,
  };
  const drawBoldBrightRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).terminal_draw_bold_bright ??
      true,
  };
  const customGlyphsRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_custom_glyphs ?? true,
  };
  const smoothScrollRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>)
        .terminal_smooth_scroll_duration ?? 0,
  };
  const scrollSensitivityRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).terminal_scroll_sensitivity ??
      1,
  };
  const fastScrollSensitivityRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>)
        .terminal_fast_scroll_sensitivity ?? 5,
  };
  const backspaceDeleteSelectionRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>)
        .terminal_backspace_delete_selection ?? true,
  };
  
  const cursorStyleRef = {
    v:
      ((persisted.prefs as Partial<ParttyPrefs>).terminal_cursor_style as
        | "block"
        | "underline"
        | "bar"
        | undefined) ?? "block",
  };
  const processNotificationThresholdRef = {
    v: ((p) => (Number.isFinite(p) ? Math.max(0.1, p) : 5.0))(
      (persisted.prefs as Partial<ParttyPrefs>)
        .process_notification_threshold ?? 5.0,
    ),
  };
  const processNotificationShowForRef = {
    v: ((p) =>
      Number.isFinite(p) ? Math.max(1000, Math.min(30000, p)) : 5000)(
      (persisted.prefs as Partial<ParttyPrefs>).process_notification_show_for ??
        5000,
    ),
  };
  const processNotificationShowMsRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).process_notification_show_ms ??
      false,
  };
  const processNotificationTransparentRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>)
        .process_notification_transparent ?? false,
  };
  const processNotificationEnabledRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>)
        .process_notification_enabled ?? false,
  };
  const cursorFollowWindowMoveRef = {
    v: Boolean(
      (persisted.prefs as Partial<ParttyPrefs>).cursor_follow_window_move,
    ),
  };
  const cursorFollowPaneFocusRef = {
    v:
      (persisted.prefs as Partial<ParttyPrefs>).cursor_follow_pane_focus ??
      true,
  };
  const windowMotionRef = {
    v: (persisted.prefs as Partial<ParttyPrefs>).terminal_window_motion ?? true,
  };
  const quietPaneDeferralRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).quiet_pane_deferral),
  };
  const mouseHiddenRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).mouse_hidden),
  };
  const mouseHideOnIdleRef = {
    v: Boolean((persisted.prefs as Partial<ParttyPrefs>).mouse_hide_on_idle),
  };
  const mouseIdleSecondsRef = {
    v: Math.max(
      0.5,
      Math.min(
        300,
        (persisted.prefs as Partial<ParttyPrefs>).mouse_idle_seconds ?? 3,
      ),
    ),
  };
  let mouseCursorController: MouseCursorController | null = null;
  const mouseCursorDragRef = {
    suppress: null as ((dragging: boolean) => void) | null,
  };

  const bootAppWindow = getCurrentWindow();
  mouseCursorController = createMouseCursorController(
    () => bootAppWindow,
    () => ({
      hidden: mouseHiddenRef.v,
      hideOnIdle: mouseHideOnIdleRef.v,
      idleSeconds: mouseIdleSecondsRef.v,
    }),
  );
  bindMouseCursorForceVisible((active) =>
    mouseCursorController?.setSuppress(active),
  );
  mouseCursorDragRef.suppress = (dragging) =>
    mouseCursorController?.setSuppress(dragging);
  mouseCursorController.sync();
  window.addEventListener(
    "mousemove",
    () => mouseCursorController?.notifyActivity(),
    { passive: true },
  );
  window.addEventListener(
    "mousedown",
    () => mouseCursorController?.notifyActivity(),
    { passive: true },
  );
  window.addEventListener(
    "keydown",
    () => mouseCursorController?.notifyActivity(),
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") mouseCursorController?.sync();
  });

  const activeProcesses = new Map<string, ActiveProcessEntry>();
  /** Latest OSC 633;E line per pane, merged until pre-exec or finish. */
  const pendingShellCommandLine = new Map<string, string>();
  const processInputBuffers = new Map<string, string>();
  const paneHostCleanups = new Map<string, Array<() => void>>();
  /** Extension PTY input subscribers — zero-cost when empty. */
  const extPtyInputSubs: Array<(paneId: string, data: string) => void> = [];
  /** Extension PTY output subscribers — zero-cost when empty. */
  const extPtyOutputSubs: Array<(paneId: string, data: string) => void> = [];
  /** Extension process lifecyle subscribers — zero-cost when empty. */
  const extProcStartSubs: Array<
    (proc: { paneId: string; command: string; cwd: string }) => void
  > = [];
  const extProcEndSubs: Array<
    (proc: { paneId: string; command: string; durationMs: number }) => void
  > = [];
  /** Extension pane lifecycle subscribers. */
  const extPaneCreatedSubs: Array<(paneId: string) => void> = [];
  const extPaneClosedSubs: Array<(paneId: string) => void> = [];
  const extFocusSubs: Array<(paneId: string) => void> = [];
  /** Extension palette commands. */
  const extPaletteCommands: Array<{
    id: string;
    label: string;
    run: () => void;
  }> = [];
  /** Extension tab lifecycle subscribers. */
  const extTabSwitchSubs: Array<(tabId: string) => void> = [];
  /** Extension window visibility subscribers. */
  const extWindowShowSubs: Array<() => void> = [];
  const extWindowHideSubs: Array<() => void> = [];

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

  // ConPTY input buffers are small (~1–2KB). Fast shells drain fine; busy TUIs
  // (OpenCode, etc.) don't — a single large write silently drops. Chunk + pace.
  const PTY_BULK_CHARS = 512;
  const PTY_CHUNK_CHARS = 256;
  const PTY_CHUNK_DELAY_MS = 4;
  /** Serializes bulk/chunked writes per pane so they don't race RAF keystrokes. */
  const ptyBulkWriteTailByPane = new Map<string, Promise<void>>();
  const ptyBulkActiveByPane = new Set<string>();

  const flushPendingPtyWrites = (): void => {
    pendingPtyWriteRaf = 0;
    if (pendingPtyWriteByPane.size === 0) return;
    for (const [paneId, data] of pendingPtyWriteByPane) {
      // Don't interleave with an in-flight chunked paste.
      if (ptyBulkActiveByPane.has(paneId)) continue;
      pendingPtyWriteByPane.delete(paneId);
      parttyPerf.mark("pty.input.flushes");
      parttyPerf.mark("pty.input.flush.chars", data.length);
      void writePtyPayload(paneId, data);
    }
  };

  const flushPendingPtyWriteForPane = (paneId: string): void => {
    if (ptyBulkActiveByPane.has(paneId)) return;
    const pending = pendingPtyWriteByPane.get(paneId);
    if (!pending) return;
    pendingPtyWriteByPane.delete(paneId);
    parttyPerf.mark("pty.input.flush_pane");
    parttyPerf.mark("pty.input.flush_pane.chars", pending.length);
    void writePtyPayload(paneId, pending);
  };

  const isLatencySensitiveInput = (data: string): boolean => {
    if (data.length > 8) return false;
    if (data.includes("\x1b")) return true;
    return data.length <= 2;
  };

  const isBulkPtyInput = (data: string): boolean =>
    data.length > PTY_BULK_CHARS || data.includes("\x1b[200~");

  const sleepMs = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /** Write to PTY, chunking large payloads so ConPTY doesn't drop bytes. */
  function writePtyPayload(paneId: string, data: string): Promise<void> {
    if (!data) return Promise.resolve();
    if (!isBulkPtyInput(data)) {
      return ptyWrite(paneId, data).catch((e) => {
        console.error("pty_write", e);
      });
    }
    const prev = ptyBulkWriteTailByPane.get(paneId) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        ptyBulkActiveByPane.add(paneId);
        try {
          const queued = pendingPtyWriteByPane.get(paneId);
          if (queued) {
            pendingPtyWriteByPane.delete(paneId);
            await ptyWrite(paneId, queued).catch((e) =>
              console.error("pty_write", e),
            );
          }
          for (let i = 0; i < data.length; i += PTY_CHUNK_CHARS) {
            const chunk = data.slice(i, i + PTY_CHUNK_CHARS);
            await ptyWrite(paneId, chunk).catch((e) =>
              console.error("pty_write", e),
            );
            if (i + PTY_CHUNK_CHARS < data.length) {
              await sleepMs(PTY_CHUNK_DELAY_MS);
            }
          }
        } finally {
          ptyBulkActiveByPane.delete(paneId);
          const after = pendingPtyWriteByPane.get(paneId);
          if (after) {
            pendingPtyWriteByPane.delete(paneId);
            await ptyWrite(paneId, after).catch((e) =>
              console.error("pty_write", e),
            );
          }
        }
      });
    ptyBulkWriteTailByPane.set(paneId, next);
    return next;
  }

  let lastKeydownTs = 0;
  document.addEventListener("keydown", () => {
    lastKeydownTs = performance.now();
  }, true);

  const queuePtyWrite = (
    paneId: string,
    data: string,
    immediate = false,
  ): void => {
    if (!data) return;
    parttyPerf.recordPtyInputBytes(paneId, data.length);
    if (lastKeydownTs) {
      parttyPerf.time("input.keydown.to.onData.ms", performance.now() - lastKeydownTs);
      lastKeydownTs = 0;
    }
    // Pastes / large bursts: don't RAF-coalesce into one oversized ConPTY write.
    if (isBulkPtyInput(data)) {
      flushPendingPtyWriteForPane(paneId);
      parttyPerf.mark("pty.input.bulk.calls");
      parttyPerf.mark("pty.input.bulk.chars", data.length);
      void writePtyPayload(paneId, data);
      return;
    }
    // During chunked paste, hold keystrokes until the paste finishes.
    if (ptyBulkActiveByPane.has(paneId)) {
      const held = pendingPtyWriteByPane.get(paneId);
      pendingPtyWriteByPane.set(paneId, held ? `${held}${data}` : data);
      return;
    }
    if (immediate || isLatencySensitiveInput(data)) {
      flushPendingPtyWriteForPane(paneId);
      parttyPerf.mark("pty.input.immediate.calls");
      parttyPerf.mark("pty.input.immediate.chars", data.length);
      void writePtyPayload(paneId, data);
      parttyPerf.mark("pty.input.immediate");
      return;
    }
    parttyPerf.mark("pty.input.queued.calls");
    parttyPerf.mark("pty.input.queued.chars", data.length);
    const prior = pendingPtyWriteByPane.get(paneId);
    pendingPtyWriteByPane.set(paneId, prior ? `${prior}${data}` : data);
    if (pendingPtyWriteRaf) return;
    pendingPtyWriteRaf = requestAnimationFrame(flushPendingPtyWrites);
  };

  function finishActiveProcess(paneId: string, endedAt: number): void {
    const entry = activeProcesses.get(paneId);
    if (!entry) return;
    const command = displayProcessCommand(entry.command);
    const durMs = processDurationMs(entry, endedAt);
    if (durMs / 1000 >= processNotificationThresholdRef.v) {
      if (!processNotificationEnabledRef.v) {
        activeProcesses.delete(paneId);
        return;
      }
      const paneName = paneNames.get(paneId) || paneId.slice(0, 8);
      showProcessNotification(
        command,
        paneName,
        entry.cwd,
        entry.startedAt,
        paneId,
        endedAt,
      );
    }
    if (extProcEndSubs.length > 0) {
      const proc = { paneId, command, durationMs: durMs };
      for (const fn of extProcEndSubs) {
        try {
          fn(proc);
        } catch {
          /* ignore */
        }
      }
    }
    activeProcesses.delete(paneId);
    pendingShellCommandLine.delete(paneId);
  }

  function processPtyOutputBatch(
    paneId: string,
    data: string,
    eventCount: number,
    queuedAt: number,
  ): void {
    const pt = getPaneTerminalById(paneId);
    if (!pt) return;
    parttyPerf.recordPtyOutputBytes(paneId, data.length);
    parttyPerf.mark("pty.output.flushes");
    parttyPerf.mark("pty.output.events", eventCount);
    parttyPerf.mark("pty.output.chars", data.length);
    parttyPerf.time("pty.output.queue.ms", performance.now() - queuedAt);

    // OSC 7 / 133 / 633 are stripped and forwarded as structured `pty-cwd` /
    // `pty-shell-event` side-channel events by the Rust emitter.  Write the
    // pre-cleaned bytes directly — no character-by-character JS parsing needed.
    const writeStarted = performance.now();
    try {
      pt.term.write(data);
      const elapsed = performance.now() - writeStarted;
      parttyPerf.time("xterm.write.ms", elapsed);
      parttyPerf.paneTime(paneId, "xterm.render.ms", elapsed);
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
      if (
        !isFocused &&
        age < PTY_OUTPUT_BACKGROUND_FLUSH_MS &&
        batch.data.length < PTY_OUTPUT_MAX_BATCH_CHARS
      ) {
        pendingPtyOutputByPane.set(paneId, batch);
        continue;
      }
      processPtyOutputBatch(
        paneId,
        batch.data,
        batch.eventCount,
        batch.queuedAt,
      );
    }
    if (pendingPtyOutputByPane.size > 0) schedulePtyOutputFlush();
  }

  function schedulePtyOutputFlush(): void {
    if (!pendingPtyOutputRaf) {
      pendingPtyOutputRaf = requestAnimationFrame(flushPendingPtyOutputs);
    }
    if (!pendingPtyOutputTimer) {
      pendingPtyOutputTimer = window.setTimeout(
        flushPendingPtyOutputs,
        PTY_OUTPUT_FLUSH_MS,
      );
    }
  }

  function queuePtyOutput(paneId: string, data: string): void {
    if (!data) return;
    if (
      !pendingPtyOutputByPane.has(paneId) &&
      paneId === paneHost?.getFocusedPaneId()
    ) {
      parttyPerf.mark("pty.output.immediate.chars", data.length);
      processPtyOutputBatch(paneId, data, 1, performance.now());
      parttyPerf.mark("pty.output.immediate");
      return;
    }
    parttyPerf.mark("pty.output.queued.events");
    parttyPerf.mark("pty.output.queued.chars", data.length);
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

  /**
   * Direct-eval PTY output from Rust (`window.__partty_out`). Rust holds
   * output until `set_pty_output_unlocked` after scrollback restore.
   */
  function deliverDirectPtyOut(paneId: string, data: string): void {
    queuePtyOutput(paneId, data);
    if (extPtyOutputSubs.length > 0) {
      for (const fn of extPtyOutputSubs) {
        try {
          fn(paneId, data);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function releasePtyHydrationGate(): Promise<void> {
    try {
      await invoke("set_pty_output_unlocked", { unlocked: true });
    } catch (e) {
      console.warn("set_pty_output_unlocked", e);
    }
  }

  (window as any).__partty_out = (paneId: string, data: string) => {
    deliverDirectPtyOut(paneId, data);
  };

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
    if (
      !Number.isFinite(cellW) ||
      !Number.isFinite(cellH) ||
      cellW <= 0 ||
      cellH <= 0
    )
      return null;
    const col = Math.max(
      0,
      Math.min(cols - 1, Math.floor((ev.clientX - rect.left) / cellW)),
    );
    const row = Math.max(
      0,
      Math.min(rows - 1, Math.floor((ev.clientY - rect.top) / cellH)),
    );
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

  /** Absolute / home-anchored paths only — avoids `foo/bar` false positives. */
  const extractPathAtColumn = (line: string, column: number): string | null => {
    const re =
      /(?:"([^"\n]+)"|'([^'\n]+)'|(?:\\\\|\/\/)[^\s<>"'`]+|[A-Za-z]:[\\/][^\s<>"'`]+|~\/[^\s<>"'`]+|\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap)(?:\/[^\s<>"'`]*)?)/g;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (column < start || column >= end) continue;
      const quoted = m[1] ?? m[2];
      let raw = (quoted ?? m[0]).replace(/[),.;:!?\]]+$/g, "");
      if (!raw) continue;
      // Quoted match must still look like a path.
      if (quoted) {
        const looksAbsolute =
          /^[A-Za-z]:[\\/]/.test(raw) ||
          /^\\\\|^\/\//.test(raw) ||
          raw.startsWith("~/") ||
          /^\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap)(?:\/|$)/.test(
            raw,
          );
        if (!looksAbsolute) continue;
      }
      return raw;
    }
    return null;
  };

  const handleCtrlClickToken = (
    term: Terminal,
    host: HTMLElement,
    ev: MouseEvent,
  ): boolean => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.button !== 0) return false;
    const cell = getTerminalClickCell(term, host, ev);
    if (!cell) return false;
    const b = term.buffer.active;
    const clickAbsY = b.viewportY + cell.row;
    const line = b.getLine(clickAbsY)?.translateToString(false) ?? "";
    if (!line) return false;

    // URLs win over paths when both could match.
    const url = extractUrlAtColumn(line, cell.col);
    if (url) {
      ev.preventDefault();
      ev.stopPropagation();
      void invoke("open_external_url", { url }).catch(
        (e) => void showAlert(String(e), "Open link"),
      );
      return true;
    }

    const path = extractPathAtColumn(line, cell.col);
    if (path) {
      ev.preventDefault();
      ev.stopPropagation();
      copyToClipboard(path);
      return true;
    }
    return false;
  };

  const updateCtrlLinkHover = (
    term: Terminal,
    host: HTMLElement,
    ev: MouseEvent,
  ): void => {
    const clear = () => {
      host.classList.remove("pane-terminal-host--ctrl-link-hover");
    };
    if (!(ev.ctrlKey || ev.metaKey)) {
      clear();
      return;
    }
    const cell = getTerminalClickCell(term, host, ev);
    if (!cell) {
      clear();
      return;
    }
    const b = term.buffer.active;
    const clickAbsY = b.viewportY + cell.row;
    const line = b.getLine(clickAbsY)?.translateToString(false) ?? "";
    const hit =
      !!line &&
      (!!extractUrlAtColumn(line, cell.col) ||
        !!extractPathAtColumn(line, cell.col));
    if (!hit) {
      clear();
      return;
    }
    host.classList.add("pane-terminal-host--ctrl-link-hover");
  };

  const isTooltipSuppressed = (): boolean =>
    disableTooltipsRef.v ||
    document.documentElement.classList.contains("zen-mode");

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
        if (
          m.type === "attributes" &&
          m.target instanceof HTMLElement &&
          m.attributeName === "title"
        ) {
          syncTooltipForElement(m.target, suppress);
          continue;
        }
        if (m.type !== "childList") continue;
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          syncTooltipForElement(n, suppress);
          n.querySelectorAll<HTMLElement>(
            "[title], [data-partty-tooltip-title]",
          ).forEach((el) => syncTooltipForElement(el, suppress));
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
    paneProfileIds.delete(paneId);
    lastPtyDims.delete(paneId);
    pendingPtyWriteByPane.delete(paneId);
    pendingPtyOutputByPane.delete(paneId);
    activeProcesses.delete(paneId);
    pendingShellCommandLine.delete(paneId);
    processInputBuffers.delete(paneId);
    backendReplayRestoredPanes.delete(paneId);
  }

  const paneWebglStates = new Map<string, PaneWebglState>();
  const backendReplayRestoredPanes = new Set<string>();

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

  function getPaneHostByPaneId(paneId: string): PaneHost | null {
    for (const host of tabPaneHosts.values()) {
      if (host.getPaneTerminal(paneId)) return host;
      if (findPaneLeaf(host.getTree(), paneId)) return host;
    }
    return null;
  }

  function reflowPane(paneId: string, force = true): void {
    const host = getPaneHostByPaneId(paneId);
    const pt = host?.getPaneTerminal(paneId);
    if (!pt) return;
    lastPtyDims.delete(paneId);
    pt.fit.fit();
    if (host === paneHost) {
      scheduleResizeImmediate(force);
    } else {
      runLayoutPassForHost(host!, force);
    }
  }

  function focusActiveTerminal(): void {
    const id = paneHost?.getFocusedPaneId();
    if (!id) return;
    const term = paneHost?.getPaneTerminal(id)?.term ?? null;
    if (!term) return;
    term.focus();
    void ptyFocusPane(id).catch(() => {});
  }

  function focusAdjacentPaneByArrow(
    key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  ): boolean {
    const host = paneHost;
    if (host) {
      const currentId = host.getFocusedPaneId();
      if (currentId) {
        const next = host.getDirectionalAdjacentLeafId(currentId, key);
        if (next) {
          host.setFocusedPaneId(next);
          scheduleCursorWarpToPane(next, { force: true });
          return true;
        }
      }
    }
    return false;
  }

  function swapFocusedPaneWithAdjacent(
    key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  ): boolean {
    const host = paneHost;
    if (!host) return false;
    const currentId = host.getFocusedPaneId();
    if (!currentId) return false;
    const swapped = host.swapPaneWithAdjacent(currentId, key);
    if (swapped) {
      const motionOn =
        !document.documentElement.classList.contains("terminal-motion-off") &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scheduleCursorWarpToPane(currentId, {
        force: true,
        delayMs: motionOn ? 480 : 0,
      });
    }
    return swapped;
  }

  async function closeFocusedPane(): Promise<void> {
    const host = paneHost;
    const id = host?.getFocusedPaneId();
    if (!host || !id) return;
    if (host.isPristineRootTab()) {
      closeWorkspaceTab(activeWorkspaceTabId);
      return;
    }
    try {
      await ptyKillPane(id);
      host.removePane(id);
      parttyPerf.resetPane(id);
    } catch (e) {
      console.warn("pty_kill_pane", e);
    }
  }

  async function closeAllChildPanes(): Promise<void> {
    const removed = paneHost?.closeAllChildPanes() ?? [];
    for (const id of removed) {
      try {
        await ptyKillPane(id);
        parttyPerf.resetPane(id);
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
    const started = performance.now();
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
    parttyPerf.time("webgl.dispose.ms", performance.now() - started);
    updateWebglPerfGauges();
  }

  function shedWebgl(): void {
    for (const paneId of [...paneWebglStates.keys()])
      disposeWebglForPane(paneId);
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
    if (!lp.preload_webgl_on_startup && document.visibilityState === "hidden")
      return;
    const pt = paneHost?.getPaneTerminal(paneId);
    if (!pt) return;
    const existing = paneWebglStates.get(paneId);
    if (existing?.status === "ready" || existing?.status === "pending") return;
    if (
      existing?.status === "failed" &&
      existing.lastFailureAt &&
      Date.now() - existing.lastFailureAt < 10_000
    ) {
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
      if (delays[i] > 0)
        await new Promise<void>((r) => setTimeout(r, delays[i]));
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

  /** Remount WebGL on panes in the active tab host (e.g. after hide shed). */
  async function mountWebglForActivePanes(): Promise<void> {
    const ids: string[] = [];
    paneHost?.forEachPane((id) => ids.push(id));
    await Promise.all(ids.map((id) => ensureWebglOnPane(id)));
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

  async function replayBackendSnapshotOnce(
    paneId: string,
    pt: PaneTerminal,
  ): Promise<void> {
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

  function splitFocusedWithCwd(dir: "h" | "v", profileId?: string | null): string | null {
    const parentId = paneHost?.getFocusedPaneId();
    if (!parentId) return null;
    if (profileBehaviorRef.v.inherit_cwd_on_split) {
      pendingNewPaneCwd.v = paneCwdHints.get(parentId) ?? null;
    } else {
      pendingNewPaneCwd.v = null;
    }
    if (profileId) {
      pendingNewPaneProfile.v = resolveDefaultProfileId(profileId, profilesList);
    } else if (profileBehaviorRef.v.inherit_profile_on_split) {
      pendingNewPaneProfile.v =
        paneProfileIds.get(parentId) ??
        resolveDefaultProfileId(profileBehaviorRef.v.default_profile_id, profilesList);
    } else {
      pendingNewPaneProfile.v = resolveDefaultProfileId(
        profileBehaviorRef.v.default_profile_id,
        profilesList,
      );
    }
    const newId = paneHost?.splitFocused(dir) ?? null;
    if (!newId) {
      pendingNewPaneCwd.v = null;
      pendingNewPaneProfile.v = null;
    }
    return newId;
  }

  function resolveProfileForNewTab(explicit?: string | null): string {
    if (explicit) return resolveDefaultProfileId(explicit, profilesList);
    if (!profileBehaviorRef.v.new_tab_uses_default_profile) {
      const focused = paneHost?.getFocusedPaneId();
      if (focused) {
        const inherited = paneProfileIds.get(focused);
        if (inherited) return resolveDefaultProfileId(inherited, profilesList);
      }
    }
    return resolveDefaultProfileId(
      profileBehaviorRef.v.default_profile_id,
      profilesList,
    );
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
    pendingZoomByPane.set(
      paneId,
      (pendingZoomByPane.get(paneId) ?? 0) + direction,
    );
    if (!zoomRaf) zoomRaf = requestAnimationFrame(flushPendingPaneZoom);
  }

  /** Map wheel deltas to xterm scrollLines (Alt = fast). */
  function scrollTermByWheel(term: Terminal, ev: WheelEvent): void {
    if (ev.deltaY === 0 && ev.deltaX === 0) return;
    const sens = Math.max(0.1, Number(term.options.scrollSensitivity) || 1);
    const fast = ev.altKey
      ? Math.max(1, Number(term.options.fastScrollSensitivity) || 5)
      : 1;
    const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    let lines: number;
    if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      lines = delta * sens;
    } else if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      lines = delta * term.rows * sens;
    } else {
      lines = (delta / 16) * sens;
    }
    lines *= fast;
    let amount = Math.round(lines);
    if (amount === 0) amount = delta < 0 ? -1 : 1;
    term.scrollLines(amount);
  }

  /** Reclaim wheel for scrollback when mouse-tracking would swallow it. */
  function attachTermWheelHandler(term: Terminal, paneId: string): void {
    term.attachCustomWheelEventHandler((ev) => {
      if (ev.ctrlKey) {
        handlePaneZoomWheel(paneId, ev);
        return false;
      }
      const forceScrollback =
        ev.shiftKey ||
        (term.modes.mouseTrackingMode !== "none" &&
          term.buffer.active.type === "normal");
      if (!forceScrollback) return true;
      ev.preventDefault();
      ev.stopPropagation();
      scrollTermByWheel(term, ev);
      return false;
    });
  }

  /** Forward wheel from host padding (misses xterm's scrollable element). */
  function handlePaneHostWheel(paneId: string, ev: WheelEvent): void {
    if (ev.ctrlKey) {
      handlePaneZoomWheel(paneId, ev);
      return;
    }
    const target = ev.target as HTMLElement | null;
    if (
      target?.closest(".xterm-scrollable-element") ||
      target?.closest(".xterm-viewport") ||
      target?.closest(".xterm-screen")
    ) {
      return;
    }
    const pt = getPaneHostByPaneId(paneId)?.getPaneTerminal(paneId);
    if (!pt) return;
    ev.preventDefault();
    ev.stopPropagation();
    scrollTermByWheel(pt.term, ev);
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
        return id ? (paneHost?.getPaneDescriptor(id, true) ?? null) : null;
      },
      focus: (paneId: string) => paneHost?.setFocusedPaneId(paneId),
      rename: (paneId: string, name: string) => {
        const trimmed = String(name ?? "")
          .trim()
          .replace(/\s+/g, "_");
        if (trimmed) paneNames.set(paneId, trimmed);
        else paneNames.delete(paneId);
        persistCurrentWorkspaceTabLayout();
      },
      zoom: (paneId: string, delta: number) =>
        zoomPaneTerminal(paneId, Number(delta) || 0),
    };
  }

  function attachTermKeyHandler(term: Terminal, paneId: string): void {
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;

      const m = k.match(e,
        "terminal_newline",
        "pane_focus_left", "pane_focus_right", "pane_focus_up", "pane_focus_down",
        "terminal_copy",
        "terminal_paste",
        "palette_chord",
        "pane_split_right",
        "pane_split_down",
        "profile_split_right",
        "profile_split_down",
        "pane_move_to_tab",
        "pane_float_toggle",
        "pane_swap_left", "pane_swap_right", "pane_swap_up", "pane_swap_down",
        "pane_close",

      );

      if (m) {
        switch (m) {
          case "terminal_newline":
            e.preventDefault();
            queuePtyWrite(paneId, "\n", true);
            return false;
          case "pane_focus_left":
          case "pane_focus_right":
          case "pane_focus_up":
          case "pane_focus_down":
            if (focusAdjacentPaneByArrow(e.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown")) {
              e.preventDefault();
              return false;
            }
            break;
          case "terminal_copy":
            if (term.hasSelection()) {
              e.preventDefault();
              copyToClipboard(term.getSelection());
              return false;
            }
            break;
          case "terminal_paste":
            e.preventDefault();
            void pasteFromClipboard();
            return false;
          case "palette_chord":
            e.preventDefault();
            return false;
          case "pane_split_right":
            e.preventDefault();
            splitFocusedWithCwd("h");
            return false;
          case "pane_split_down":
            e.preventDefault();
            splitFocusedWithCwd("v");
            return false;
          case "profile_split_right":
          case "profile_split_down":
            e.preventDefault();
            return false;
          case "pane_move_to_tab": {
            const idx = tabHotkeyIndexFromEvent(e);
            if (idx != null) {
              e.preventDefault();
              moveFocusedPaneToTabHotkeyIndex(idx);
              return false;
            }
            break;
          }
          case "pane_float_toggle":
            e.preventDefault();
            toggleFocusedPaneFloating();
            return false;
          case "pane_swap_left":
          case "pane_swap_right":
          case "pane_swap_up":
          case "pane_swap_down":
            e.preventDefault();
            return swapFocusedPaneWithAdjacent(e.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown");
          case "pane_close":
            e.preventDefault();
            void closeFocusedPane();
            return false;
        }
        return true;
      }

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
        // Delete the selected region by moving to its end and sending N DELs.
        // Only single-line selections on the cursor line — multi-line / scrollback
        // is a no-op beyond clearing the selection (TUIs / history aren't editable).
        const range = term.getSelectionPosition();
        term.clearSelection();
        if (!range) return false;

        const buf = term.buffer.active;
        const cursorX = buf.cursorX;
        const cursorAbsY = buf.baseY + buf.cursorY;
        // getSelectionPosition returns 0-based coords (typings incorrectly say 1-based).
        let x0 = range.start.x;
        let y0 = range.start.y;
        let x1 = range.end.x;
        let y1 = range.end.y;
        if (y0 > y1 || (y0 === y1 && x0 > x1)) {
          const tx = x0;
          const ty = y0;
          x0 = x1;
          y0 = y1;
          x1 = tx;
          y1 = ty;
        }
        if (y0 !== y1 || y0 !== cursorAbsY) return false;

        const left = x0;
        const right = x1; // exclusive end column
        const cellCount = right - left;
        if (cellCount <= 0) return false;

        let payload = "";
        if (cursorX < right) {
          payload += "\x1b[C".repeat(right - cursorX);
        } else if (cursorX > right) {
          payload += "\x1b[D".repeat(cursorX - right);
        }
        // DEL — same as xterm's default Backspace on Windows hosts.
        payload += "\x7f".repeat(cellCount);
        queuePtyWrite(paneId, payload, true);
        return false;
      }
      return true;
    });
  }

  const terminalContent = document.getElementById("terminal-content");
  const stage = document.getElementById("terminal-stage");


  function refreshAllTerminalThemes(): void {
    // Refresh all tabs so theme changes don't drift on inactive tabs
    for (const host of tabPaneHosts.values()) {
      host.remountPaneSurfaces();
      host.forEachPane((id, pt) => {
        const th = xtermThemeForPane(id);
        pt.term.options.theme = {
          ...th,
          cursorAccent: th.background ?? TERM_BG_FALLBACK,
        };
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
      pt.term.options.theme = {
        ...th,
        cursorAccent: th.background ?? TERM_BG_FALLBACK,
      };
      pt.term.refresh(0, pt.term.rows - 1);
    }
  }

  let debounceTimer = 0;
  let layoutRaf = 0;
  let cwdSyncTimer = 0;
  let layoutForceRefresh = false;
  let terminalLayoutSuspended = false;
  let pendingSuspendedLayout = false;

  function runLayoutPassForHost(host: PaneHost, forceRefresh = false): void {
    const passStarted = performance.now();
    let paneCount = 0;
    host.forEachPane((paneId, pt) => {
      paneCount++;
      const fitStarted = performance.now();
      pt.fit.fit();
      parttyPerf.time("layout.fit.ms", performance.now() - fitStarted);
      const d = ptyDims(pt.fit);
      if (!d) return;
      const safe = clampPtyColsRows(d.cols, d.rows);
      const prev = lastPtyDims.get(paneId);
      const unchanged = prev?.cols === safe.cols && prev?.rows === safe.rows;
      if (unchanged) {
        if (forceRefresh) pt.term.refresh(0, pt.term.rows - 1);
        return;
      }
      lastPtyDims.set(paneId, safe);
      parttyPerf.mark("layout.pty_resize");
      parttyPerf.time("layout.pty_resize.invoke.ms", performance.now() - fitStarted);
      void ptyResize(paneId, safe.cols, safe.rows)
        .then(() => {
          pt.term.refresh(0, pt.term.rows - 1);
        })
        .catch((e) => console.warn("pty_resize", e));
    });
    parttyPerf.mark("layout.pass");
    parttyPerf.gauge("layout.pass.panes", paneCount);
    parttyPerf.time("layout.pass.ms", performance.now() - passStarted);
  }

  function runLayoutPass(forceRefresh = false): void {
    parttyPerf.mark(forceRefresh || layoutForceRefresh ? "layout.pass.force" : "layout.pass.normal");
    layoutRaf = 0;
    const shouldForceRefresh = forceRefresh || layoutForceRefresh;
    layoutForceRefresh = false;
    if (!paneHost) return;
    runLayoutPassForHost(paneHost, shouldForceRefresh);
  }

  /** PTY + xterm stay aligned after pane/window refocus (TUIs need SIGWINCH-sized PTY + refresh). */
  function reflowAllPanes(): void {
    parttyPerf.mark("layout.reflow_all");
    lastPtyDims.clear();
    scheduleResizeImmediate(true);
  }

  // A freshly created pane's first fit can quantize against not-yet-settled
  // metrics (the viewport's scrollbar width and final host layout resolve a frame
  // or two after the terminal opens), so the grid mis-centers until a manual
  // resize busts the cached dims. Replicate that resize: once the pane has
  // settled, drop its cached dims and force a corrective re-fit. Staggered over a
  // couple of frames + one post-animation tick so late-resolving metrics converge.
  function scheduleCreationReflow(paneId: string): void {
    const run = (): void => {
      reflowPane(paneId, true);
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    window.setTimeout(run, 50);
    window.setTimeout(run, 150);
    window.setTimeout(run, 320);
    if (document.fonts && document.fonts.status === "loading") {
      void document.fonts.ready.then(run);
    }
  }

  function scheduleCreationReflowForHost(host: PaneHost): void {
    const ids: string[] = [];
    collectLeafIds(host.getTree(), ids);
    for (const id of ids) scheduleCreationReflow(id);
  }

  /**
   * After a pane-tree remount (transfer take, tab close → reveal), bust cached
   * PTY dims and run the staggered creation reflow so flex-centered `.xterm`
   * grids re-quantize against the settled host. Only call while `host` is
   * visible — fitting a `display:none` tab can write 0×0 metrics.
   */
  function scheduleHostGeometryRepair(host: PaneHost): void {
    const ids: string[] = [];
    collectLeafIds(host.getTree(), ids);
    for (const id of ids) lastPtyDims.delete(id);
    scheduleCreationReflowForHost(host);
  }

  async function syncCwdFromBackend(): Promise<void> {
    try {
      if (Date.now() - lastLiveCwdSignalAt < 1500) return;
      const paneId = paneHost?.getFocusedPaneId() ?? null;
      const p = await ptyShellCwd(paneId);
      if (p == null || !p.trim()) return;
      const next = p.trim();
      if (normalizeFsPathKey(next) === normalizeFsPathKey(liveCwd ?? ""))
        return;
      liveCwd = next;
    } catch {
      /* ignore */
    }
  }

  function setZenMode(next: boolean): void {
    document.documentElement.classList.toggle("zen-mode", next);
    localStorage.setItem(ZEN_MODE_STORAGE_KEY, next ? "1" : "0");
    applyTooltipPolicy(document);
    scheduleResizeImmediate();
  }

  function scheduleCwdSync(): void {
    if (cwdSyncTimer) window.clearTimeout(cwdSyncTimer);
    cwdSyncTimer = window.setTimeout(() => {
      cwdSyncTimer = 0;
      void syncCwdFromBackend();
    }, 120);
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
    document.documentElement.classList.toggle(
      "terminal-layout-suspended",
      suspended,
    );
    if (!suspended && pendingSuspendedLayout) {
      pendingSuspendedLayout = false;
      scheduleResizeImmediate(true);
    }
  }

  async function ensurePtyForPane(
    paneId: string,
    ptIn?: PaneTerminal,
    initialCwd?: string | null,
  ): Promise<void> {
    const pt = ptIn ?? getPaneTerminalById(paneId);
    if (!pt) return;
    const effectiveCwd = initialCwd ?? paneCwdHints.get(paneId) ?? null;
    const profileId =
      paneProfileIds.get(paneId) ??
      resolveDefaultProfileId(profileBehaviorRef.v.default_profile_id, profilesList);
    const profile = getProfileById(profileId, profilesList);
    const globalShell =
      ((persisted.prefs as Partial<ParttyPrefs>).shell as string | undefined) ??
      "pwsh";
    const shellOverride = resolveProfileShell(profile, globalShell);
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
        await ptyEnsure(
          paneId,
          safe.cols,
          safe.rows,
          effectiveCwd,
          shellOverride,
          profileId,
        );
        await replayBackendSnapshotOnce(paneId, pt);
        lastPtyDims.set(paneId, safe);
        parttyPerf.mark("pty.ensure.success");
        parttyPerf.time("pty.ensure.ms", performance.now() - ensureStarted);
        if (paneId === paneHost?.getFocusedPaneId()) scheduleCwdSync();
        return;
      } catch (e) {
        lastErr = e;
        parttyPerf.mark("pty.ensure.failure");
        const msg = String(e).toLowerCase();
        if (
          /not found|cannot find|does not exist|no such file|access denied|permission denied|invalid/i.test(
            msg,
          )
        ) {
          break;
        }
      }
    }
    const msg = String(lastErr);
    console.error("pty_ensure failed:", lastErr);
    parttyPerf.mark("pty.ensure.failure");
    parttyPerf.time("pty.ensure.ms", performance.now() - ensureStarted);
    try {
      pt.term.write(
        `\r\n\x1b[31mShell failed after retries.\x1b[0m \x1b[90m${msg}\x1b[0m\r\n`,
      );
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
          bridge.style.setProperty(
            "--terminal-bridge-intensity",
            intensity.toFixed(3),
          );
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
    tabsState.tabs.find((t) => t.id === tabsState.activeTabId)?.id ??
    tabsState.tabs[0]?.id ??
    "tab-1";
  tabsState = { ...tabsState, activeTabId: activeWorkspaceTabId };
  saveTabsState(tabsState);
  /** One pane host per workspace tab so shells + scrollback survive tab switches. */
  const tabPaneHosts = new Map<string, PaneHost>();
  const tabPaneShells = new Map<string, HTMLElement>();

  type CursorWarpOptions = {
    /** Warp even when pointer-follow-focus is enabled. */
    force?: boolean;
    /** Wait for layout/animation before measuring pane bounds. */
    delayMs?: number;
    /** Skip the cursor-follow-pane pref check (monitor moves). */
    bypassPanePref?: boolean;
  };

  let cursorWarpReady = false;

  function scheduleCursorWarpToPane(
    paneId?: string,
    opts: CursorWarpOptions = {},
  ): void {
    if (!cursorWarpReady) return;
    if (!opts.bypassPanePref && !cursorFollowPaneFocusRef.v) return;
    if (!opts.force && focusFollowsRef.v) return;

    const run = (): void => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void warpCursorToPane(paneId);
        }),
      );
    };

    const delay = opts.delayMs ?? 0;
    if (delay > 0) window.setTimeout(run, delay);
    else run();
  }

  async function warpCursorToPane(paneId?: string): Promise<void> {
    try {
      const id = paneId ?? paneHost?.getFocusedPaneId();
      if (!id) return;
      const host = getPaneHostByPaneId(id) ?? paneHost;
      if (!host) return;
      const el = host
        .getHostRoot()
        .querySelector(
          `.pane-leaf[data-pane-id="${CSS.escape(id)}"]`,
        ) as HTMLElement | null;
      const rect = el?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      await appWindow.setCursorPosition(
        new LogicalPosition(Math.round(cx), Math.round(cy)),
      );
      if (host === paneHost) {
        getFocusedTerm()?.focus();
      } else {
        host.getPaneTerminal(id)?.term.focus();
      }
    } catch {
      /* ignore */
    }
  }

  function xtermThemeForPane(paneId: string) {
    const paneTheme = paneThemes.get(paneId);
    return paneTheme
      ? buildXtermThemeFromPrefs(paneTheme)
      : buildXtermThemeFromDocument();
  }

  function cssVarsForPane(paneId: string): Record<string, string> | null {
    const paneTheme = paneThemes.get(paneId);
    return paneTheme ? themeCssVarsForPrefs(paneTheme) : null;
  }

  function createPaneHost(
    container: HTMLElement,
    init: PaneHostInit | undefined,
    rootPaneId: string,
  ): PaneHost {
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
        linkHandler: {
          activate: (_event, uri) => {
            if (
              uri.startsWith("http://") ||
              uri.startsWith("https://") ||
              uri.startsWith("mailto:")
            ) {
              void invoke("open_external_url", { url: uri }).catch(
                (e) => void showAlert(String(e), "Open link"),
              );
            }
          },
        },
        getTheme: (paneId) => xtermThemeForPane(paneId),
        getPaneName: (paneId) => paneNames.get(paneId),
        getPaneCssVars: (paneId) => cssVarsForPane(paneId),
        getSplitLayoutStyle: () => splitLayoutStyleRef.v,
        focusFollowsCursor: () => focusFollowsRef.v,
        suppressEnterAnimation: () =>
          document.documentElement.classList.contains("partty-booting"),
        onPaneFocus: (id) => {
          lastFocusedPaneId = id;
          if (paneRenamePanel?.isOpen())
            paneRenamePanel.setPane(id, paneNames.get(id) ?? "");
          const pt = paneHost?.getPaneTerminal(id);
          if (pt) {
            lastPtyDims.delete(id);
            requestAnimationFrame(() => {
              pt.fit.fit();
              scheduleResizeImmediate(true);
            });
            pt.term.focus();
          }
          void ptyFocusPane(id).catch(() => {});
          const hint = paneCwdHints.get(id);
          if (hint) {
            liveCwd = hint;
          }
          void syncCwdFromBackend();
          void remountAuxiliaryForFocus(id);
          try {
            scheduleCursorWarpToPane(id);
          } catch {
            /* ignore */
          }
          // Notify extension subscribers.
          if (extFocusSubs.length > 0) {
            for (const fn of extFocusSubs) {
              try {
                fn(id);
              } catch {
                /* ignore */
              }
            }
          }
        },
        onPaneCreated: (id, pt) => {
          attachTermKeyHandler(pt.term, id);
          attachTermWheelHandler(pt.term, id);
          pt.term.onData((data) => {
            parttyPerf.recordInputEvent();
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
                    let n =
                      end === -1 ? st : st === -1 ? end : Math.min(end, st);
                    i =
                      n === -1 ? data.length : n + (data[n] === "\x1b" ? 2 : 1);
                    continue;
                  }
                  if (data[i + 1] === "[") {
                    // CSI: \x1b[ ... final byte @–~
                    let j = i + 2;
                    while (j < data.length && data.charCodeAt(j) < 0x40) j++;
                    i = j < data.length ? j + 1 : data.length;
                    continue;
                  }
                  if (
                    data[i + 1] === "P" ||
                    data[i + 1] === "_" ||
                    data[i + 1] === "^" ||
                    data[i + 1] === "X"
                  ) {
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
                  const cmd = normalizeCommandLine(buf);
                  if (cmd) {
                    // Only start tracking if no process is already active for this pane.
                    // This prevents Enter keystrokes inside a TUI (nvim, htop, etc.) from
                    // overwriting the command that originally started the process.
                    if (!activeProcesses.has(id)) {
                      const proc = createActiveProcessEntry(
                        cmd,
                        paneCwdHints.get(id) || "",
                      );
                      activeProcesses.set(id, proc);
                      // Notify extension subscribers.
                      if (extProcStartSubs.length > 0) {
                        const start = {
                          paneId: id,
                          command: displayProcessCommand(cmd),
                          cwd: proc.cwd,
                        };
                        for (const fn of extProcStartSubs) {
                          try {
                            fn(start);
                          } catch {
                            /* ignore */
                          }
                        }
                      }
                    }
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
            // Notify extension PTY input subscribers (zero-cost when empty).
            if (extPtyInputSubs.length > 0) {
              for (const fn of extPtyInputSubs) {
                try {
                  fn(id, data);
                } catch {
                  /* ignore */
                }
              }
            }
            if (data.includes("\r") || data.includes("\n")) {
              scheduleCwdSync();
            }
          });
          const onHostClick = (ev: MouseEvent) => {
            if (handleCtrlClickToken(pt.term, pt.host, ev)) return;
          };
          const onHostWheel = (ev: WheelEvent) => handlePaneHostWheel(id, ev);
          const onHostMouseMove = (ev: MouseEvent) => {
            updateCtrlLinkHover(pt.term, pt.host, ev);
          };
          const onHostMouseLeave = () => {
            pt.host.classList.remove("pane-terminal-host--ctrl-link-hover");
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
          const explicitCwd =
            pendingPaneSpawnCwd.get(id) ?? pendingNewPaneCwd.v;
          pendingPaneSpawnCwd.delete(id);
          pendingNewPaneCwd.v = null;
          const inheritedCwd = explicitCwd ?? paneCwdHints.get(id) ?? null;
          if (inheritedCwd) paneCwdHints.set(id, inheritedCwd);

          const explicitProfile =
            pendingPaneSpawnProfile.get(id) ?? pendingNewPaneProfile.v;
          pendingPaneSpawnProfile.delete(id);
          pendingNewPaneProfile.v = null;
          const resolvedProfile = resolveDefaultProfileId(
            explicitProfile ??
              paneProfileIds.get(id) ??
              profileBehaviorRef.v.default_profile_id,
            profilesList,
          );
          paneProfileIds.set(id, resolvedProfile);

          // During destroy→recreate boot, prepare-show owns ensure after scrollback
          // restore — avoid a premature ensure that races rehydration.
          if (!document.documentElement.classList.contains("partty-booting")) {
            queueMicrotask(() => {
              void ensurePtyForPane(id, pt, inheritedCwd);
            });
          }
          // Boot/rehydrate: prepare-show does one host repair; skip staggered bounce.
          if (!document.documentElement.classList.contains("partty-booting")) {
            scheduleCreationReflow(id);
          }
          const paneResizeObs = new ResizeObserver(() => {
            if (terminalLayoutSuspended) return;
            if (pt.host.clientWidth < 2 || pt.host.clientHeight < 2) return;
            lastPtyDims.delete(id);
            pt.fit.fit();
            if (getPaneHostByPaneId(id) === paneHost) scheduleResizeImmediate();
          });
          paneResizeObs.observe(pt.host);
          const priorCleanups = paneHostCleanups.get(id) ?? [];
          paneHostCleanups.set(id, [
            ...priorCleanups,
            () => paneResizeObs.disconnect(),
          ]);
          // Notify extension subscribers.
          if (extPaneCreatedSubs.length > 0) {
            for (const fn of extPaneCreatedSubs) {
              try {
                fn(id);
              } catch {
                /* ignore */
              }
            }
          }
        },
  onPaneDisposed: (pid) => {
    void ptyKillPane(pid).catch(() => {});
    paneNames.delete(pid);
    paneThemes.delete(pid);
    cleanupPaneVisualState(pid);
    parttyPerf.resetPane(pid);
          // Notify extension subscribers.
          if (extPaneClosedSubs.length > 0) {
            for (const fn of extPaneClosedSubs) {
              try {
                fn(pid);
              } catch {
                /* ignore */
              }
            }
          }
        },
        onPaneLayout: () => scheduleResizeImmediate(),
        onPaneLayoutDrag: (dragging) => {
          setTerminalLayoutSuspended(dragging);
          mouseCursorDragRef.suppress?.(dragging);
        },
        onPaneReorder: () => persistCurrentWorkspaceTabLayout(),
      },
      init,
    );
  }

  function createTabPaneShellAndHost(
    tabId: string,
    init: PaneHostInit,
    rootPaneId?: string,
  ): PaneHost {
    const paneRoot = document.getElementById("terminal-pane-root");
    if (!paneRoot) throw new Error("#terminal-pane-root missing");
    const shell = document.createElement("div");
    shell.className = "term-tab-pane-shell";
    shell.dataset.tabId = tabId;
    paneRoot.appendChild(shell);
    const rid = rootPaneId ?? workspaceRootPaneId(tabId);
    const host = createPaneHost(shell, init, rid);
    tabPaneHosts.set(tabId, host);
    tabPaneShells.set(tabId, shell);
    if (tabId !== activeWorkspaceTabId) {
      shell.classList.add("term-tab-pane-shell--hidden");
    }
    return host;
  }

  await refreshProfilesList();

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
    if (retainSessionStateRef.v) {
      for (const [paneId, cwd] of Object.entries(layout.paneCwds ?? {})) {
        paneCwdHints.set(paneId, cwd);
      }
    }
    for (const [paneId, profileId] of Object.entries(layout.paneProfileIds ?? {})) {
      paneProfileIds.set(
        paneId,
        resolveDefaultProfileId(profileId, profilesList),
      );
    }
    createTabPaneShellAndHost(
      tab.id,
      {
        initialTree: layout.tree,
        initialFocusedId: layout.focusedId,
        initialFloating: layout.floating,
      },
      resolveTabRootPaneId(layout, tab.id),
    );
    if (tab.id !== activeWorkspaceTabId) {
      tabPaneShells.get(tab.id)?.classList.add("term-tab-pane-shell--hidden");
    }
  }
  paneHost = tabPaneHosts.get(activeWorkspaceTabId)!;
  lastFocusedPaneId = paneHost.getFocusedPaneId();
  installPaneControlSurface();
  cursorWarpReady = true;

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
      paneCwds: retainSessionStateRef.v
        ? Object.fromEntries(
            panes
              .filter((pane) => paneCwdHints.has(pane.id))
              .map((pane) => [pane.id, paneCwdHints.get(pane.id)!]),
          )
        : undefined,
      paneProfileIds: Object.fromEntries(
        panes
          .filter((pane) => paneProfileIds.has(pane.id))
          .map((pane) => [pane.id, paneProfileIds.get(pane.id)!]),
      ),
    };
  }

  function switchWorkspaceTab(tabId: string): void {
    if (tabId === activeWorkspaceTabId) return;
    const nextHost = tabPaneHosts.get(tabId);
    if (!nextHost) return;
    persistCurrentWorkspaceTabLayout();

    const prevTabId = activeWorkspaceTabId;
    const prevShell = tabPaneShells.get(prevTabId);
    const nextShell = tabPaneShells.get(tabId);
    const motionOn =
      !document.documentElement.classList.contains("terminal-motion-off") &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    activeWorkspaceTabId = tabId;
    tabsState = { ...tabsState, activeTabId: tabId };
    saveTabsState(tabsState);

    for (const fn of extTabSwitchSubs) {
      try { fn(tabId); } catch { /* ignore */ }
    }

    for (const shell of tabPaneShells.values()) {
      shell.classList.remove(
        "term-tab-pane-shell--entering",
        "term-tab-pane-shell--leaving",
      );
    }

    paneHost = nextHost;
    lastFocusedPaneId = paneHost.getFocusedPaneId();

    if (nextShell) {
      nextShell.classList.remove("term-tab-pane-shell--hidden");
      if (motionOn) nextShell.classList.add("term-tab-pane-shell--entering");
    }

    if (prevShell && prevShell !== nextShell && motionOn) {
      prevShell.classList.remove("term-tab-pane-shell--hidden");
      prevShell.classList.add("term-tab-pane-shell--leaving");
      const capturedPrev = prevTabId;
      const onLeave = (): void => {
        prevShell.removeEventListener("animationend", onLeave);
        if (activeWorkspaceTabId === capturedPrev) return;
        prevShell.classList.remove("term-tab-pane-shell--leaving");
        prevShell.classList.add("term-tab-pane-shell--hidden");
      };
      prevShell.addEventListener("animationend", onLeave);
      window.setTimeout(onLeave, 420);
    } else {
      for (const [id, shell] of tabPaneShells) {
        shell.classList.toggle("term-tab-pane-shell--hidden", id !== tabId);
      }
    }

    if (nextShell && motionOn) {
      const capturedTabId = tabId;
      const onEnter = (): void => {
        nextShell.removeEventListener("animationend", onEnter);
        if (activeWorkspaceTabId !== capturedTabId) return;
        nextShell.classList.remove("term-tab-pane-shell--entering");
        for (const [id, shell] of tabPaneShells) {
          if (id !== capturedTabId)
            shell.classList.add("term-tab-pane-shell--hidden");
        }
        scheduleCreationReflowForHost(nextHost);
        scheduleResizeImmediate(true);
      };
      nextShell.addEventListener("animationend", onEnter);
      window.setTimeout(onEnter, 420);
    } else {
      for (const [id, shell] of tabPaneShells) {
        shell.classList.toggle("term-tab-pane-shell--hidden", id !== tabId);
      }
      scheduleCreationReflowForHost(nextHost);
      scheduleResizeImmediate(true);
    }

    const hint = paneCwdHints.get(lastFocusedPaneId);
    if (hint) {
      liveCwd = hint;
    }
    document.documentElement.classList.toggle(
      "term-tabs-multiple",
      tabsState.tabs.length > 1,
    );
    renderWorkspaceTabsBar();
    scheduleCwdSync();
    getFocusedTerm()?.focus();
    const tabMotionOn =
      !document.documentElement.classList.contains("terminal-motion-off") &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scheduleCursorWarpToPane(lastFocusedPaneId, {
      force: true,
      delayMs: tabMotionOn ? 420 : 0,
    });
    // Notify extension subscribers on tab switch (onPaneFocus only fires within a tab).
    if (extFocusSubs.length > 0 && lastFocusedPaneId) {
      for (const fn of extFocusSubs) {
        try {
          fn(lastFocusedPaneId);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function visibleWorkspaceTabsInOrder(): TabRecord[] {
    const sortedTabs = [...tabsState.tabs].sort((a, b) => a.order - b.order);
    const sortedGroups = [...tabsState.groups].sort(
      (a, b) => a.order - b.order,
    );
    const groupedTabs = new Map<string, TabRecord[]>();
    for (const tab of sortedTabs) {
      if (!tab.groupId) continue;
      const bucket = groupedTabs.get(tab.groupId) ?? [];
      bucket.push(tab);
      groupedTabs.set(tab.groupId, bucket);
    }
    const items: Array<{
      type: "tab" | "group";
      order: number;
      tab?: TabRecord;
      group?: TabGroup;
    }> = [];
    for (const tab of sortedTabs) {
      if (!tab.groupId) items.push({ type: "tab", order: tab.order, tab });
    }
    for (const group of sortedGroups)
      items.push({ type: "group", order: group.order, group });
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

  function openTabWithTransferredPane(
    paneId: string,
    pt: PaneTerminal,
    switchTo: boolean,
  ): string {
    const tabId = crypto.randomUUID();
    const name = nextTabName(tabsState.tabs);
    const layout: PersistedPaneLayout = {
      v: 1,
      tree: { kind: "leaf", id: paneId },
      focusedId: paneId,
    };
    const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
    tabsState = {
      ...tabsState,
      tabs: [
        ...tabsState.tabs,
        { id: tabId, name, groupId: null, color: null, order: maxOrder + 1 },
      ],
    };
    saveTabsState(tabsState);
    persistLayoutForTab(tabId, layout);
    createTabPaneShellAndHost(
      tabId,
      {
        initialTree: layout.tree,
        initialFocusedId: paneId,
        preloadedPanes: { [paneId]: pt },
      },
      paneId,
    );
    if (switchTo) switchWorkspaceTab(tabId);
    else renderWorkspaceTabsBar();
    return tabId;
  }

  function rootPaneHasUserState(host: PaneHost): boolean {
    const rootId = host.getRootPaneId();
    if (lastPtyDims.has(rootId)) return true;
    if (activeProcesses.has(rootId)) return true;
    const pt = host.getPaneTerminal(rootId);
    if (!pt) return false;
    const buf = pt.term.buffer.active;
    if (buf.length > 1 || buf.baseY > 0) return true;
    if (buf.length === 1) {
      const text = buf.getLine(0)?.translateToString() ?? "";
      if (text.trim().length > 0) return true;
    }
    return false;
  }

  function receiveTransferredPane(
    targetHost: PaneHost,
    paneId: string,
    pt: PaneTerminal,
  ): boolean {
    if (targetHost.isPristineRootTab() && !rootPaneHasUserState(targetHost)) {
      return targetHost.rebindAsTransferredRoot(paneId, pt);
    }
    return targetHost.receivePaneAtRoot(paneId, pt, PANE_TRANSFER_SPLIT_DIR);
  }

  function takePaneForTransfer(
    host: PaneHost,
    paneId: string,
  ): PaneTerminal | null {
    if (host.isPristineRootTab()) {
      return host.takeSolePane(paneId, { saveRollback: true });
    }
    return host.takePane(paneId, { saveRollback: true });
  }

  function moveFocusedPaneToTabHotkeyIndex(index: number): void {
    const sourceTabId = activeWorkspaceTabId;
    const sourceHost = paneHost;
    const paneId = sourceHost?.getFocusedPaneId();
    if (!sourceHost || !paneId) return;

    const closingSourceTab = sourceHost.isPristineRootTab();
    const pt = takePaneForTransfer(sourceHost, paneId);
    if (!pt) return;

    // Survivors expand (split → full) via mountTree; they need the same
    // staggered reflow as new panes, but only while their tab stays visible.
    const sourceSurvivorIds: string[] = [];
    if (!closingSourceTab) {
      collectLeafIds(sourceHost.getTree(), sourceSurvivorIds);
      for (const id of sourceSurvivorIds) lastPtyDims.delete(id);
    }

    const existing = tabForHotkeyIndex(index);
    if (existing?.id === sourceTabId) {
      sourceHost.restoreTakenPane(paneId, pt);
      return;
    }

    let targetTabId: string;
    let targetHost: PaneHost;

    if (existing) {
      targetTabId = existing.id;
      const host = tabPaneHosts.get(targetTabId);
      if (!host || !receiveTransferredPane(host, paneId, pt)) {
        sourceHost.restoreTakenPane(paneId, pt);
        return;
      }
      targetHost = host;
    } else {
      targetTabId = openTabWithTransferredPane(paneId, pt, false);
      targetHost = tabPaneHosts.get(targetTabId)!;
      if (!targetHost) {
        sourceHost.restoreTakenPane(paneId, pt);
        return;
      }
    }

    sourceHost.clearPaneMoveRollback();
    if (!closingSourceTab) {
      const sourceLayout = layoutForPaneHost(sourceHost);
      if (sourceLayout) persistLayoutForTab(sourceTabId, sourceLayout);
    }
    const targetLayout = layoutForPaneHost(targetHost);
    if (targetLayout) persistLayoutForTab(targetTabId, targetLayout);
    targetHost.setFocusedPaneId(paneId);
    if (closingSourceTab) {
      closeWorkspaceTab(sourceTabId);
      if (!quietPaneDeferralRef.v) {
        switchWorkspaceTab(targetTabId);
      }
    } else if (quietPaneDeferralRef.v) {
      renderWorkspaceTabsBar();
      sourceHost.getPaneTerminal(sourceHost.getFocusedPaneId())?.term.focus();
    } else {
      switchWorkspaceTab(targetTabId);
    }
    scheduleCreationReflow(paneId);
    // Quiet deferral keeps the source tab active — repair survivors now.
    // If we switched away, do not fit a hidden host; close/switch-back repairs.
    if (!closingSourceTab && paneHost === sourceHost) {
      scheduleHostGeometryRepair(sourceHost);
    }
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
    const sourceName =
      tabsState.tabs.find((t) => t.id === fromTabId)?.name ??
      nextTabName(tabsState.tabs);
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
    tabsState = {
      ...tabsState,
      tabs: [
        ...tabsState.tabs,
        {
          id: newId,
          name: candidate,
          groupId: sourceTab?.groupId ?? null,
          color: sourceTab?.color ?? null,
          order: maxOrder + 1,
        },
      ],
    };
    saveTabsState(tabsState);
    createTabPaneShellAndHost(newId, {
      initialTree: dup.tree,
      initialFocusedId: dup.focusedId,
    });
    switchWorkspaceTab(newId);
  }

  function tabIdForPaneHost(host: PaneHost): string | null {
    for (const [tabId, h] of tabPaneHosts) {
      if (h === host) return tabId;
    }
    return null;
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
    tabsState = {
      ...tabsState,
      tabs: tabsState.tabs.filter((t) => t.id !== tabId),
    };
    saveTabsState(tabsState);
    disposeTabPaneHost(tabId);
    try {
      localStorage.removeItem(`partty.tab.layout.v1.${tabId}`);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle(
      "term-tabs-multiple",
      tabsState.tabs.length > 1,
    );
    renderWorkspaceTabsBar();
    // Force refresh + staggered reflow: survivors may have expanded while this
    // tab was hidden, leaving a flex-centered grid offset until a full repaint.
    scheduleResizeImmediate(true);
    if (paneHost) scheduleHostGeometryRepair(paneHost);
    getFocusedTerm()?.focus();
  }

  let renamingTabId: string | null = null;
  let renamingGroupId: string | null = null;

  function finishTabRename(commit: boolean): void {
    const id = renamingTabId;
    if (!id) return;
    const strip = document.getElementById("term-tabs-strip");
    const inp = strip?.querySelector(
      `input[data-tab-rename="${id}"]`,
    ) as HTMLInputElement | null;
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
    const input = document.getElementById(
      "zen-rename-input",
    ) as HTMLInputElement | null;
    const form = modal?.querySelector(
      ".zen-rename-form",
    ) as HTMLFormElement | null;
    if (!modal || !input || !form) return;
    const tab = tabsState.tabs.find((t) => t.id === renamingTabId);
    input.value = tab?.name ?? "";
    modal.classList.remove("zen-rename-modal--hidden");
    modal.setAttribute("aria-hidden", "false");
    mouseCursorForceVisible(true);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function closeZenRenameModal(commit: boolean): void {
    const modal = document.getElementById("zen-rename-modal");
    if (!modal) return;
    modal.classList.add("zen-rename-modal--hidden");
    modal.setAttribute("aria-hidden", "true");
    mouseCursorForceVisible(false);
    if (commit) {
      const id = renamingTabId;
      const input = document.getElementById(
        "zen-rename-input",
      ) as HTMLInputElement | null;
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
      const inp = strip?.querySelector(
        `input[data-tab-rename="${tabId}"]`,
      ) as HTMLInputElement | null;
      inp?.focus();
      inp?.select();
    });
  }

  function finishGroupRename(commit: boolean): void {
    const id = renamingGroupId;
    if (!id) return;
    const strip = document.getElementById("term-tabs-strip");
    const inp = strip?.querySelector(
      `input[data-group-rename="${id}"]`,
    ) as HTMLInputElement | null;
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
      const inp = strip?.querySelector(
        `input[data-group-rename="${groupId}"]`,
      ) as HTMLInputElement | null;
      inp?.focus();
      inp?.select();
    });
  }

  function openNewWorkspaceTab(
    switchTo = true,
    profileId?: string | null,
  ): string {
    const id = crypto.randomUUID();
    const name = nextTabName(tabsState.tabs);
    const empty = emptyWorkspaceLayout(id);
    const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
    const resolvedProfile = resolveProfileForNewTab(profileId);
    const rootId = empty.focusedId;
    paneProfileIds.set(rootId, resolvedProfile);
    pendingPaneSpawnProfile.set(rootId, resolvedProfile);
    tabsState = {
      ...tabsState,
      tabs: [
        ...tabsState.tabs,
        { id, name, groupId: null, color: null, order: maxOrder + 1 },
      ],
    };
    saveTabsState(tabsState);
    persistLayoutForTab(id, {
      ...empty,
      paneProfileIds: { [rootId]: resolvedProfile },
    });
    createTabPaneShellAndHost(id, {
      initialTree: empty.tree,
      initialFocusedId: empty.focusedId,
    });
    if (switchTo) switchWorkspaceTab(id);
    else renderWorkspaceTabsBar();
    return id;
  }

  function openTabContextMenu(
    clientX: number,
    clientY: number,
    tab: TabRecord,
  ): void {
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
          tabs: tabsState.tabs.map((t) =>
            t.id === tab.id ? { ...t, color: input.value } : t,
          ),
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
        groups: [
          ...tabsState.groups,
          {
            id: groupId,
            name: groupName,
            color: null,
            collapsed: false,
            order: maxOrder + 1,
          },
        ],
        tabs: tabsState.tabs.map((t) =>
          t.id === tab.id ? { ...t, groupId } : t,
        ),
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
              tabs: tabsState.tabs.map((t) =>
                t.id === tab.id ? { ...t, groupId: group.id } : t,
              ),
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
          tabs: tabsState.tabs.map((t) =>
            t.id === tab.id ? { ...t, groupId: null } : t,
          ),
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

  function openGroupContextMenu(
    clientX: number,
    clientY: number,
    group: TabGroup,
  ): void {
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
          groups: tabsState.groups.map((g) =>
            g.id === group.id ? { ...g, color: input.value } : g,
          ),
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
        groups: tabsState.groups.map((g) =>
          g.id === group.id ? { ...g, collapsed: !g.collapsed } : g,
        ),
      };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    });
    mk("Disband group", () => {
      tabsState = {
        ...tabsState,
        groups: tabsState.groups.filter((g) => g.id !== group.id),
        tabs: tabsState.tabs.map((t) =>
          t.groupId === group.id ? { ...t, groupId: null } : t,
        ),
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
      if (tabMenuEl && !tabMenuEl.contains(e.target as Node))
        hideTabContextMenu();
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (e) => {
      const mMoveTab = k.matchParam(e, "pane_move_to_tab");
      if (mMoveTab) {
        const t = e.target as HTMLElement | null;
        if (
          t?.closest("#command-palette") ||
          t?.closest("#settings-panel")
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        moveFocusedPaneToTabHotkeyIndex(mMoveTab.param === 0 ? 9 : mMoveTab.param - 1);
        return;
      }

      const mSwitchTab = k.matchParam(e, "tab_switch");
      if (mSwitchTab) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) return;
        switchOrCreateTabForHotkeyIndex(mSwitchTab.param === 0 ? 9 : mSwitchTab.param - 1);
        return;
      }

      const m = k.match(e,
        "window_toggle",
        "window_move_next_monitor",
        "window_move_prev_monitor",
        "window_maximize",
        "window_restore",
        "focus_terminal",
        "focus_pane_up", "focus_pane_down",
      );

      if (m === "window_toggle") {
        e.preventDefault();
        e.stopPropagation();
        void invoke("toggle_overlay").catch(() => {});
        return;
      }
      if (m === "window_move_next_monitor") {
        e.preventDefault();
        e.stopPropagation();
        void moveWindowToAdjacentMonitor(1);
        return;
      }
      if (m === "window_move_prev_monitor") {
        e.preventDefault();
        e.stopPropagation();
        void moveWindowToAdjacentMonitor(-1);
        return;
      }
      if (m === "window_maximize") {
        e.preventDefault();
        e.stopPropagation();
        void setWindowMaximized(true);
        return;
      }
      if (m === "window_restore") {
        e.preventDefault();
        e.stopPropagation();
        void setWindowMaximized(false);
        return;
      }

      if (m === "focus_pane_up" || m === "focus_terminal" || m === "focus_pane_down") {
        if (focusAdjacentPaneByArrow(e.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const terminalRoot = document.getElementById("terminal-pane-root");
      if (!terminalRoot || !terminalRoot.contains(target)) return;
      if (
        target.closest(
          "input, textarea, select, button, [contenteditable='true']",
        )
      )
        return;
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
    const sortedGroups = [...tabsState.groups].sort(
      (a, b) => a.order - b.order,
    );

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
    const items: Array<{
      type: "tab" | "group";
      order: number;
      tab?: TabRecord;
      group?: TabGroup;
    }> = [];
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
          document
            .querySelectorAll(".term-tab--dragging")
            .forEach((el) => el.classList.remove("term-tab--dragging"));
          if (!from) return;
          tabsState = {
            ...tabsState,
            tabs: tabsState.tabs.map((t) =>
              t.id === from ? { ...t, groupId: group.id } : t,
            ),
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
            groupTabsContainer.style.setProperty(
              "--tab-group-color",
              group.color,
            );
          }
          for (const tab of tabs) {
            renderTab(groupTabsContainer, tab, group.color);
          }
          strip.appendChild(groupTabsContainer);
        }
      }
    }

    function renderTab(
      strip: HTMLElement,
      tab: TabRecord,
      groupColor: string | null = null,
    ): void {
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
      btn.setAttribute(
        "aria-selected",
        tab.id === activeWorkspaceTabId ? "true" : "false",
      );
      if (tab.id === activeWorkspaceTabId)
        btn.classList.add("term-tab--active");

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

  let tabDragId: string | null = null;
  let groupDragId: string | null = null;
  let suppressTabClickUntilMs = 0;
  document
    .getElementById("term-tabs-strip")
    ?.addEventListener("dragover", (e) => {
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
    document
      .querySelectorAll(".term-tab--dragging")
      .forEach((el) => el.classList.remove("term-tab--dragging"));
    document
      .querySelectorAll(".term-tab-group--dragging")
      .forEach((el) => el.classList.remove("term-tab-group--dragging"));

    // Handle tab reordering
    if (fromTab) {
      const over = (e.target as HTMLElement).closest?.(
        ".term-tab",
      ) as HTMLElement | null;
      const toTabId = over?.dataset.tabId;
      if (!fromTab || !toTabId || fromTab === toTabId) return;
      const a = tabsState.tabs.findIndex((x) => x.id === fromTab);
      const b = tabsState.tabs.findIndex((x) => x.id === toTabId);
      if (a < 0 || b < 0) return;
      const next = [...tabsState.tabs];
      const [mv] = next.splice(a, 1);
      next.splice(b, 0, mv);
      // Update order values
      next.forEach((tab, i) => (tab.order = i));
      tabsState = { ...tabsState, tabs: next };
      saveTabsState(tabsState);
      renderWorkspaceTabsBar();
    }

    // Handle group reordering
    if (fromGroup) {
      const over = (e.target as HTMLElement).closest?.(
        ".term-tab-group",
      ) as HTMLElement | null;
      const toGroup = tabsState.groups.find((g) =>
        over?.textContent?.includes(g.name),
      );
      if (!fromGroup || !toGroup || fromGroup === toGroup.id) return;
      const a = tabsState.groups.findIndex((x) => x.id === fromGroup);
      const b = tabsState.groups.findIndex((x) => x.id === toGroup.id);
      if (a < 0 || b < 0) return;
      const next = [...tabsState.groups];
      const [mv] = next.splice(a, 1);
      next.splice(b, 0, mv);
      // Update order values
      next.forEach((group, i) => (group.order = i));
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
      if (!retainSessionStateRef.v) {
        shedWorkspaceLocalState();
      } else if (shouldShedWorkspaceOnExitSilent()) {
        shedWorkspaceLocalState();
      }
    } catch {
      /* ignore */
    }
  });

  void (async () => {
    const appWin = getCurrentWindow();
    await appWin.onCloseRequested(async (event) => {
      if (!retainSessionStateRef.v) {
        shedWorkspaceLocalState();
        return;
      }
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

  function showShedExitDialog(
    root: HTMLElement | null,
  ): Promise<"keep" | "discard" | "cancel"> {
    if (!root) return Promise.resolve("cancel");
    return new Promise((resolve) => {
      root.classList.remove("shed-exit-dialog--hidden");
      root.setAttribute("aria-hidden", "false");
      mouseCursorForceVisible(true);
      const finish = (v: "keep" | "discard" | "cancel") => {
        root.classList.add("shed-exit-dialog--hidden");
        root.setAttribute("aria-hidden", "true");
        mouseCursorForceVisible(false);
        resolve(v);
      };
      root
        .querySelector("#shed-exit-keep")
        ?.addEventListener("click", () => finish("keep"), { once: true });
      root
        .querySelector("#shed-exit-discard")
        ?.addEventListener("click", () => finish("discard"), {
          once: true,
        });
      root
        .querySelector("#shed-exit-cancel")
        ?.addEventListener("click", () => finish("cancel"), {
          once: true,
        });
    });
  }

  if (paneHost) {
    void remountAuxiliaryForFocus(
      paneHost.getFocusedPaneId() ?? paneHost.getRootPaneId(),
    );
  }

  const paneRenameRoot = document.getElementById(
    "pane-rename-root",
  ) as HTMLElement | null;
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
    themeBuilder = createThemeBuilderModal(
      themeBuilderRoot as HTMLElement,
      (prefs) => {
        currentUiPrefs = prefs;
        applyUiTheme(prefs);
        refreshAllTerminalThemes();
      },
    );
  }

  const themeModalRoot = document.getElementById("theme-modal-root");
  let themeModal: ThemeModalApi | null = null;
  let openFocusedPaneTheme = (): void => {};
  let themeTargetPaneId: string | null = null;
  let paneThemeRestore: { id: string; theme: PaneThemePrefs | null } | null =
    null;
  if (themeModalRoot) {
    const resetThemeModalTarget = (): void => {
      if (paneThemeRestore) {
        applyPaneTheme(paneThemeRestore.id, paneThemeRestore.theme);
        paneThemeRestore = null;
      }
      themeTargetPaneId = null;
    };
    themeModal = createThemeModal(
      themeModalRoot as HTMLElement,
      (prefs) => {
        if (themeTargetPaneId) {
          applyPaneTheme(themeTargetPaneId, prefs);
          return;
        }
        currentUiPrefs = prefs;
        applyUiTheme(prefs);
        refreshAllTerminalThemes();
      },
      (request) => themeBuilder?.open(request),
      resetThemeModalTarget,
    );
    openFocusedPaneTheme = () => {
      const paneId = paneHost?.getFocusedPaneId();
      if (!paneId) return;
      themeTargetPaneId = paneId;
      const existing = paneThemes.get(paneId);
      paneThemeRestore = {
        id: paneId,
        theme: existing ? { ...existing } : null,
      };
      const appPrefs = currentUiPrefs;
      const initialPrefs: UiThemePrefs = {
        ...appPrefs,
        ui_theme: existing?.ui_theme ?? appPrefs.ui_theme,
        ui_theme_variant:
          existing?.ui_theme_variant ?? appPrefs.ui_theme_variant,
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
          if (n.kind === "leaf") {
            pids.push(n.id);
            return;
          }
          collect(n.a);
          collect(n.b);
        })(pl.tree);
        // Normalize root pane id to a stable neutral value
        const rootId = pids[0] ?? "";
        const idNorm = new Map<string, string>();
        if (rootId) idNorm.set(rootId, "root");
        for (let i = 1; i < pids.length; i++) idNorm.set(pids[i]!, `p${i}`);
        function normTree(
          n: NonNullable<typeof pl>["tree"],
        ): NonNullable<typeof pl>["tree"] {
          if (n.kind === "leaf")
            return { kind: "leaf", id: idNorm.get(n.id) ?? n.id };
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
          tabName:
            tabsState.tabs.find((t) => t.id === activeWorkspaceTabId)?.name ??
            name,
          tree: normTree(pl!.tree),
          focusedId: idNorm.get(pl!.focusedId) ?? pl!.focusedId,
          floating: Object.fromEntries(
            Object.entries(pl!.floating ?? {}).map(([id, state]) => [
              idNorm.get(id) ?? id,
              state,
            ]),
          ),
          paneThemes: normMap(
            Object.fromEntries(
              pids
                .filter((id) => paneThemes.has(id))
                .map((id) => [id, paneThemes.get(id)!]),
            ),
          ),
          paneNames: normMap(
            Object.fromEntries(
              pids
                .filter((id) => paneNames.has(id))
                .map((id) => [id, paneNames.get(id)!]),
            ),
          ),
          paneCwds: normMap(
            Object.fromEntries(
              pids
                .filter((id) => paneCwdHints.has(id))
                .map((id) => [id, paneCwdHints.get(id)!]),
            ),
          ),
          paneProfileIds: normMap(
            Object.fromEntries(
              pids
                .filter((id) => paneProfileIds.has(id))
                .map((id) => [id, paneProfileIds.get(id)!]),
            ),
          ),
          paneFontSizes: normMap(
            Object.fromEntries(
              pids
                .map((id) => {
                  const pt = paneHost?.getPaneTerminal(id);
                  const sz = pt ? Number(pt.term.options.fontSize ?? 12) : 12;
                  return [id, sz] as [string, number];
                })
                .filter(([, sz]) => sz !== 12),
            ),
          ),
          startupCommands: {},
        };
        // Preserve existing startup commands when re-saving
        try {
          const existing = await invoke<string>("read_preset_json", {
            name,
          }).catch(() => null);
          if (existing) {
            const prev = JSON.parse(existing) as Preset;
            if (prev.startupCommands)
              preset.startupCommands = { ...prev.startupCommands };
          }
        } catch {
          /* first save, no existing file */
        }
        await writePresetJson(name, JSON.stringify(preset));
        return name;
      },
      onLoad: async (preset) => {
        const ids: string[] = [];
        (function collect(n: typeof preset.tree): void {
          if (n.kind === "leaf") {
            ids.push(n.id);
            return;
          }
          collect(n.a);
          collect(n.b);
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
          if (n.kind === "leaf")
            return { kind: "leaf", id: idMap.get(n.id) ?? crypto.randomUUID() };
          return { ...n, a: mapNode(n.a), b: mapNode(n.b) };
        }
        const tree = mapNode(preset.tree);
        const focusedId = idMap.get(preset.focusedId) ?? "";
        const floating: Record<string, (typeof preset.floating)[string]> = {};
        for (const [oid, state] of Object.entries(preset.floating)) {
          const nid = idMap.get(oid);
          if (nid) floating[nid] = { ...state };
        }

        const maxOrder = Math.max(0, ...tabsState.tabs.map((t) => t.order));
        tabsState = {
          ...tabsState,
          tabs: [
            ...tabsState.tabs,
            {
              id: newTabId,
              name: preset.tabName || preset.name,
              groupId: null,
              color: null,
              order: maxOrder + 1,
            },
          ],
        };
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
          if (nid && cwd) {
            paneCwdHints.set(nid, cwd);
            pendingPaneSpawnCwd.set(nid, cwd);
          }
        }
        for (const [oid, profileId] of Object.entries(
          preset.paneProfileIds ?? {},
        )) {
          const nid = idMap.get(oid);
          if (nid && profileId) {
            const resolved = resolveDefaultProfileId(profileId, profilesList);
            paneProfileIds.set(nid, resolved);
            pendingPaneSpawnProfile.set(nid, resolved);
          }
        }
        createTabPaneShellAndHost(
          newTabId,
          {
            initialTree: tree,
            initialFocusedId: focusedId,
            initialFloating: floating,
          },
          resolveTabRootPaneId({ v: 1, tree, focusedId, floating }, newTabId),
        );
        switchWorkspaceTab(newTabId);
        const presetHost = tabPaneHosts.get(newTabId);
        if (presetHost) scheduleCreationReflowForHost(presetHost);
        if (
          preset.startupCommands &&
          Object.keys(preset.startupCommands).length > 0
        ) {
          setTimeout(() => {
            for (const [oid, cmd] of Object.entries(preset.startupCommands)) {
              const nid = idMap.get(oid);
              if (!nid || !cmd) continue;
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
      const m = k.match(e, "pane_float_toggle", "settings_open");
      if (!m) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest("#command-palette") ||
        t?.closest("#settings-panel")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      switch (m) {
        case "pane_float_toggle":
          toggleFocusedPaneFloating();
          break;
        case "settings_open":
          settingsApi?.open();
          break;
      }
    },
    true,
  );

  async function pasteFromClipboard(): Promise<void> {
    try {
      const text = await readText();
      if (!text) return;
      const pid = paneHost?.getFocusedPaneId();
      if (!pid) return;
      const term = paneHost?.getPaneTerminal(pid)?.term;
      if (!term) return;
      // Go through xterm so newlines normalize and bracketed paste wraps when
      // the app (TUI) enabled it — raw ptyWrite skipped both and broke OpenCode etc.
      term.focus();
      term.paste(text);
    } catch {
      /* empty clipboard or read failed */
    }
  }

  window.addEventListener("keydown", maybeBlockBrowserPrintShortcut, true);

  document.addEventListener(
    "contextmenu",
    (e) => {
      const target = e.target as Node | null;
      if (!target || !terminalContent?.contains(target)) return;
      e.preventDefault();
      if (!rightClickPasteRef.v) {
        getFocusedTerm()?.focus();
        return;
      }
      void pasteFromClipboard();
      getFocusedTerm()?.focus();
    },
    true,
  );

  async function newTerminalSession(): Promise<void> {
    const killIds = paneHost?.getLeafIdsInOrder() ?? [];
    for (const pid of killIds) {
      await invoke("pty_kill_pane", { paneId: pid }).catch(() => {});
    }
    liveCwd = null;
    paneCwdHints.clear();
    lastPtyDims.clear();
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

  const cpRoot = document.getElementById("command-palette");
  const cpInput = document.getElementById(
    "command-palette-input",
  ) as HTMLInputElement | null;
  const cpList = document.getElementById("command-palette-list");
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
      }
    }
  };

  const settingsApi = settingsPanelEl
    ? createSettingsPanel(
        settingsPanelEl,
        async (saved: ParttyPrefs, previous: ParttyPrefs) => {
          syncRuntimeShedFromPrefs(saved);
          configureDevPerfPrefs(saved);
          focusFollowsRef.v = saved.focus_follows_cursor;
          persisted.prefs = saved as unknown as Record<string, unknown>;
          Object.assign(lp, mergeLifecyclePrefs(persisted.prefs));
          autoCopySelectionRef.v = saved.auto_copy_selection;
          rightClickPasteRef.v = saved.right_click_paste ?? true;
          retainSessionStateRef.v = saved.retain_session_state ?? true;
          splitLayoutStyleRef.v = normalizeSplitLayoutStyle(
            saved.split_layout_style,
          );
          profileBehaviorRef.v = {
            default_profile_id: resolveDefaultProfileId(
              saved.default_profile_id,
              profilesList,
            ),
            inherit_profile_on_split: saved.inherit_profile_on_split ?? true,
            inherit_cwd_on_split: saved.inherit_cwd_on_split ?? true,
            palette_tab_profile_picker:
              saved.palette_tab_profile_picker ?? true,
            new_tab_uses_default_profile:
              saved.new_tab_uses_default_profile ?? true,
            palette_profile_icons: saved.palette_profile_icons ?? true,
            profile_selection_aliases: resolveSelectionAliases(
              saved.profile_selection_aliases ??
                previous.profile_selection_aliases ??
                {},
            ),
          };
          void refreshProfilesList();
          disableTooltipsRef.v = saved.ui_disable_tooltips ?? false;
          altClickCursorRef.v = saved.terminal_alt_click_moves_cursor ?? true;
          cursorBlinkRef.v = saved.terminal_cursor_blink ?? true;
          cursorInactiveStyleRef.v =
            ((saved as Partial<ParttyPrefs>).terminal_cursor_inactive_style as
              | "outline"
              | "block"
              | "bar"
              | "underline"
              | "none"
              | undefined) ?? "outline";
          cursorWidthRef.v =
            (saved as Partial<ParttyPrefs>).terminal_cursor_width ?? 1;
          fontSizeRef.v =
            (saved as Partial<ParttyPrefs>).terminal_font_size ?? 12;
          fontWeightRef.v =
            (saved as Partial<ParttyPrefs>).terminal_font_weight ?? "normal";
          fontWeightBoldRef.v =
            (saved as Partial<ParttyPrefs>).terminal_font_weight_bold ?? "bold";
          lineHeightRef.v =
            (saved as Partial<ParttyPrefs>).terminal_line_height ?? 1;
          letterSpacingRef.v =
            (saved as Partial<ParttyPrefs>).terminal_letter_spacing ?? 0;
          drawBoldBrightRef.v =
            (saved as Partial<ParttyPrefs>).terminal_draw_bold_bright ?? true;
          customGlyphsRef.v =
            (saved as Partial<ParttyPrefs>).terminal_custom_glyphs ?? true;
          smoothScrollRef.v =
            (saved as Partial<ParttyPrefs>).terminal_smooth_scroll_duration ??
            0;
          scrollSensitivityRef.v =
            (saved as Partial<ParttyPrefs>).terminal_scroll_sensitivity ?? 1;
          fastScrollSensitivityRef.v =
            (saved as Partial<ParttyPrefs>).terminal_fast_scroll_sensitivity ??
            5;
          applyTerminalDisplayOptions();
          backspaceDeleteSelectionRef.v =
            saved.terminal_backspace_delete_selection ?? true;
          if ((saved.terminal_cursor_style ?? "block") !== cursorStyleRef.v) {
            cursorStyleRef.v =
              (saved.terminal_cursor_style as "block" | "underline" | "bar") ??
              "block";
            for (const host of tabPaneHosts.values()) {
              host.setCursorStyle(cursorStyleRef.v);
            }
          }
          const threshold = (saved as Partial<ParttyPrefs>)
            .process_notification_threshold;
          if (typeof threshold === "number" && Number.isFinite(threshold)) {
            processNotificationThresholdRef.v = Math.max(0.1, threshold);
          }
          const showFor = (saved as Partial<ParttyPrefs>)
            .process_notification_show_for;
          if (typeof showFor === "number" && Number.isFinite(showFor)) {
            processNotificationShowForRef.v = Math.max(
              1000,
              Math.min(30000, showFor),
            );
          }
          processNotificationShowMsRef.v =
            (saved as Partial<ParttyPrefs>).process_notification_show_ms ??
            false;
          processNotificationTransparentRef.v =
            (saved as Partial<ParttyPrefs>).process_notification_transparent ??
            false;
          processNotificationEnabledRef.v =
            (saved as Partial<ParttyPrefs>).process_notification_enabled ??
            false;
          cursorFollowWindowMoveRef.v = Boolean(
            (saved as Partial<ParttyPrefs>).cursor_follow_window_move,
          );
          cursorFollowPaneFocusRef.v =
            (saved as Partial<ParttyPrefs>).cursor_follow_pane_focus ?? true;
          mouseHiddenRef.v = Boolean(
            (saved as Partial<ParttyPrefs>).mouse_hidden,
          );
          mouseHideOnIdleRef.v = Boolean(
            (saved as Partial<ParttyPrefs>).mouse_hide_on_idle,
          );
          mouseIdleSecondsRef.v = Math.max(
            0.5,
            Math.min(
              300,
              (saved as Partial<ParttyPrefs>).mouse_idle_seconds ?? 3,
            ),
          );
          mouseCursorController?.sync();
          windowMotionRef.v =
            (saved as Partial<ParttyPrefs>).terminal_window_motion ?? true;
          quietPaneDeferralRef.v = Boolean(
            (saved as Partial<ParttyPrefs>).quiet_pane_deferral,
          );
          applyTerminalDisplayPrefs(saved);
          if (saved.scrollback_lines !== previous.scrollback_lines) {
            for (const host of tabPaneHosts.values()) {
              host.setScrollbackLines(saved.scrollback_lines);
            }
          }
          applyTooltipPolicy(document);
          document.documentElement.classList.toggle(
            "pane-blur-unfocused",
            saved.blur_unfocused_panes,
          );
          document.documentElement.style.setProperty(
            "--pane-blur-radius",
            String((saved as Partial<ParttyPrefs>).pane_blur_radius ?? 1.6),
          );
          document.documentElement.style.setProperty(
            "--pane-opacity-focused",
            String((saved as Partial<ParttyPrefs>).pane_opacity_focused ?? 1.0),
          );
          document.documentElement.style.setProperty(
            "--pane-opacity-unfocused",
            String((saved as Partial<ParttyPrefs>).pane_opacity_unfocused ?? 1.0),
          );
          document.documentElement.classList.toggle(
            "pane-variable-opacity",
            Boolean((saved as Partial<ParttyPrefs>).pane_variable_opacity),
          );
          applyPaneFocusScalePrefs(saved);
          // Gap / sandbox padding changes resize each pane's content box but not the
          // observed container, so re-fit explicitly to apply them live.
          scheduleResizeImmediate(true);
          if (saved.always_open_in_zen_mode) {
            setZenMode(true);
          }
          const prevUi = pickUiPrefs(
            previous as unknown as Record<string, unknown>,
          );
          const nextUi = pickUiPrefs(
            saved as unknown as Record<string, unknown>,
          );
          if (uiPrefsChanged(prevUi, nextUi)) {
            currentUiPrefs = nextUi;
            applyUiTheme(nextUi);
            refreshAllTerminalThemes();
          }
          const shellChanged =
            shellPrefKey(saved.shell) !== shellPrefKey(previous.shell);
          const cwdChanged =
            (saved.initial_cwd ?? "").trim() !==
            (previous.initial_cwd ?? "").trim();
          if (shellChanged || cwdChanged) {
            localStorage.setItem(DEFER_PTY_REINIT_KEY, "1");
          }
        },
      )
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
        hotkey:
          index < 9 ? `Alt+${index + 1}` : index === 9 ? "Alt+0" : undefined,
        run: () => switchWorkspaceTab(tab.id),
      };
    });
  }

  function getPaneTargetCommands(query: string): PaletteCommand[] {
    const afterTag = query.slice(6);
    const spaceIdx = afterTag.indexOf(" ");
    const panePart = (spaceIdx === -1 ? afterTag : afterTag.slice(0, spaceIdx))
      .trimStart()
      .toLowerCase();

    // When a command follows the pane name, show a single dispatch entry.
    // This prevents the palette's word-split filter from eliminating pane entries
    // because command words like "rm" don't match pane keywords.
    if (spaceIdx !== -1 && panePart) {
      const command = afterTag.slice(spaceIdx + 1).trim();
      // Find which pane this name refers to
      for (const host of tabPaneHosts.values()) {
        for (const leafId of host.getLeafIdsInOrder()) {
          const name = paneNames.get(leafId) || leafId.slice(0, 8);
          if (
            name.toLowerCase() !== panePart &&
            leafId.slice(0, 8).toLowerCase() !== panePart
          )
            continue;
          const cwd = paneCwdHints.get(leafId) || "";
          const shortCwd =
            cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || cwd;
          return [
            {
              id: `pane-dispatch-${leafId}`,
              label: `@pane:${name}${command ? ` → ${command}` : ""}`,
              labelHtml:
                `<span class="cp-label-prefix">@pane:</span><span class="cp-label-name">${escapeHtml(name)}</span>` +
                (shortCwd
                  ? ` <span class="cp-label-cwd">${escapeHtml(shortCwd)}</span>`
                  : "") +
                (command
                  ? ` <span class="cp-label-prefix" style="font-weight:400">→</span> ${escapeHtml(command)}`
                  : ""),
              keywords: `${name} ${cwd} ${command}`,
              run: () => dispatchPaneCommand(leafId, query),
            },
          ];
        }
      }
      // No pane matched — show empty
      return [];
    }

    // No command yet — show filterable pane list
    const items: PaletteCommand[] = [];
    for (const [tabId, host] of tabPaneHosts) {
      const tab = tabsState.tabs.find((t) => t.id === tabId);
      const tabLabel = tab
        ? tab.name || `Tab ${tabsState.tabs.indexOf(tab) + 1}`
        : tabId.slice(0, 6);
      for (const leafId of host.getLeafIdsInOrder()) {
        const name = paneNames.get(leafId) || leafId.slice(0, 8);
        const cwd = paneCwdHints.get(leafId) || "";
        const shortCwd =
          cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || cwd;
        const hay = `${name} ${cwd} ${tabLabel}`.toLowerCase();
        if (panePart && !hay.includes(panePart)) continue;
        const cwdHtml = shortCwd
          ? ` <span class="cp-label-cwd">${escapeHtml(shortCwd)}</span>`
          : "";
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
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let processToastTimer = 0;
  const processToast = document.getElementById(
    "proc-toast",
  ) as HTMLElement | null;

  function navigateToPane(paneId: string): void {
    for (const [tabId, host] of tabPaneHosts) {
      if (host.getPaneTerminal(paneId)) {
        if (tabId !== activeWorkspaceTabId) switchWorkspaceTab(tabId);
        host.getPaneTerminal(paneId)?.term.focus();
        return;
      }
    }
  }

  function showProcessNotification(
    command: string,
    paneName: string,
    cwd: string,
    startedAt: number,
    paneId: string,
    endedAt = Date.now(),
  ): void {
    if (!processToast) return;
    processToast.classList.toggle(
      "proc-toast--transparent",
      processNotificationTransparentRef.v,
    );
    const shortCmd =
      command.length > 50 ? command.slice(0, 47) + "\u2026" : command;
    const shortCwd =
      cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || cwd;
    const ms = Math.max(0, endedAt - startedAt);
    let durStr: string;
    if (processNotificationShowMsRef.v) {
      durStr = ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${ms}ms`;
    } else {
      durStr = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
    }
    processToast.dataset.paneId = paneId;
    processToast.innerHTML = `<span class="proc-toast-cmd">${escapeHtml(shortCmd)}</span> \u00b7 ${durStr} \u00b7 <span class="proc-toast-pane">${escapeHtml(paneName)}</span> <span class="proc-toast-cwd">${escapeHtml(shortCwd)}</span><button class="proc-toast-nav" title="Go to pane">\u2192</button>`;
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
    const afterTag = query
      .slice(query.startsWith("@proc:") ? 6 : 5)
      .trimStart();
    const words = afterTag ? afterTag.split(/\s+/) : [];
    const prefix = words.join(" ").toLowerCase();

    if (activeProcesses.size === 0)
      return [
        {
          id: "proc-none",
          label: "No active processes",
          keywords: "@proc proc process",
          run: () => {},
        },
      ];

    const items: PaletteCommand[] = [];
    for (const [leafId, proc] of activeProcesses) {
      const displayCmd = displayProcessCommand(proc.command);
      if (
        prefix &&
        !displayCmd.toLowerCase().startsWith(prefix) &&
        !displayCmd.toLowerCase().includes(prefix)
      )
        continue;
      const name = paneNames.get(leafId) || leafId.slice(0, 8);
      const shortCwd =
        proc.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || proc.cwd;
      const dur = ((Date.now() - proc.startedAt) / 1000).toFixed(0);
      const shortDisplayCmd =
        displayCmd.length > 50
          ? displayCmd.slice(0, 47) + "\u2026"
          : displayCmd;
      let tabLabel = "";
      for (const [tid, host] of tabPaneHosts) {
        if (host.getPaneTerminal(leafId)) {
          const t = tabsState.tabs.find((x) => x.id === tid);
          tabLabel = t ? t.name || `T${tabsState.tabs.indexOf(t) + 1}` : "";
          break;
        }
      }
      items.push({
        id: `proc-${leafId}`,
        label: `@proc:${shortDisplayCmd}  ${dur}s`,
        labelHtml:
          `<span class="cp-label-prefix">@proc:</span><span class="cp-label-name">${escapeHtml(shortDisplayCmd)}</span>` +
          (shortCwd
            ? ` <span class="cp-label-cwd">${escapeHtml(shortCwd)}</span>`
            : "") +
          (tabLabel
            ? ` <span class="cp-label-tab">${escapeHtml(tabLabel)}</span>`
            : "") +
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
    return items.length > 0
      ? items
      : [
          {
            id: "proc-none",
            label: prefix
              ? `No process matching "${prefix}"`
              : "No active processes",
            keywords: "@proc proc process",
            run: () => {},
          },
        ];
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
    void ptyWrite(targetPaneId, `${command}\r`).catch((e) =>
      console.warn("pty_write @pane:", e),
    );
  }

  async function toggleMouseHidden(): Promise<void> {
    mouseHiddenRef.v = !mouseHiddenRef.v;
    try {
      const state = await invoke<{ prefs: ParttyPrefs }>("get_persisted_state");
      const next = { ...state.prefs, mouse_hidden: mouseHiddenRef.v };
      await invoke("set_prefs", { prefs: next });
      persisted.prefs = next as unknown as Record<string, unknown>;
    } catch (e) {
      console.warn("toggleMouseHidden", e);
    }
    mouseCursorController?.sync();
  }

  function runWithProfile(action: ProfilePaletteAction, profileId: string): void {
    const id = resolveDefaultProfileId(profileId, profilesList);
    switch (action) {
      case "new-tab":
        openNewWorkspaceTab(true, id);
        return;
      case "split-h":
        splitFocusedWithCwd("h", id);
        return;
      case "split-v":
        splitFocusedWithCwd("v", id);
        return;
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
  }

  const PROFILE_ACTION_LABEL: Record<ProfilePaletteAction, string> = {
    "new-tab": "New tab",
    "split-h": "Split right",
    "split-v": "Split down",
  };

  /** Active profile-picker session (hotkey / Tab). Input is filter-only; no `@profile:` prefix. */
  let profilePickerSession: ProfilePaletteAction | null = null;

  function beginProfilePicker(action: ProfilePaletteAction): void {
    profilePickerSession = action;
    commandPalette?.open({ placeholder: "Profile" });
  }

  function listProfileCommands(
    action: ProfilePaletteAction,
    filter: string,
  ): PaletteCommand[] {
    const filterLower = filter.toLowerCase();
    const actionLabel = PROFILE_ACTION_LABEL[action];
    const idToAlias = !filterLower
      ? profileIdAliasMap(profileBehaviorRef.v.profile_selection_aliases)
      : null;
    return profilesList
      .filter((p) => {
        if (!filterLower) return true;
        const hay =
          `${p.name} ${p.kind} ${p.id} ${p.shell ?? ""} ${p.wslDistro ?? ""} ${p.sshHost ?? ""}`.toLowerCase();
        return hay.includes(filterLower);
      })
      .map((p: ConnectionProfile) => {
        const sshDetail = p.kind === "ssh" ? p.sshHost?.trim() || "" : "";
        const showDetail =
          sshDetail && sshDetail.toLowerCase() !== p.name.toLowerCase()
            ? sshDetail
            : "";
        const showIcon =
          profileBehaviorRef.v.palette_profile_icons && !!p.iconDataUrl;
        const iconHtml = showIcon
          ? `<img class="cp-profile-icon" src="${escapeHtml(p.iconDataUrl!)}" alt="" width="16" height="16" />`
          : "";
        const alias = idToAlias?.get(p.id) ?? null;
        return {
          id: `profile-run-${action}-${p.id}`,
          label: p.name,
          labelHtml:
            iconHtml +
            `<span class="cp-label-name">${escapeHtml(p.name)}</span>` +
            (showDetail
              ? ` <span class="cp-label-cwd">${escapeHtml(showDetail)}</span>`
              : ""),
          keywords: `@profile:${action} ${p.name} ${p.kind} ${p.id} ${sshDetail} ${p.shell ?? ""} ${p.wslDistro ?? ""} ${actionLabel}`,
          hotkey: alias ?? undefined,
          run: () => runWithProfile(action, p.id),
        };
      });
  }

  function getProfileActionCommands(query: string): PaletteCommand[] {
    const parsed = parseProfilePickerQuery(query);
    if (!parsed) {
      return [
        {
          id: "profile-picker-hint",
          label: "Select a profile",
          labelHtml:
            `<span class="cp-label-prefix">@profile:</span>` +
            `<span class="cp-label-name">new-tab</span>` +
            `<span class="cp-label-kind"> · split-h · split-v</span>`,
          keywords: "@profile new-tab split-h split-v",
          run: () => {},
        },
      ];
    }
    return listProfileCommands(parsed.action, parsed.filter);
  }

  function openProfileSplitPicker(action: "split-h" | "split-v"): void {
    beginProfilePicker(action);
  }

  function quickSelectProfileByAlias(
    key: string,
    currentInput: string,
  ): PaletteCommand | null {
    if (key.length !== 1) return null;
    let action: ProfilePaletteAction | null = profilePickerSession;
    if (action) {
      if (currentInput.trim().length > 0) return null;
    } else {
      if (!isProfilePickerAliasContext(currentInput)) return null;
      action = parseProfilePickerQuery(currentInput)?.action ?? null;
    }
    if (!action) return null;
    const profileId = profileBehaviorRef.v.profile_selection_aliases[key];
    if (!profileId) return null;
    const profile = getProfileById(profileId, profilesList);
    if (!profile) return null;
    return {
      id: `profile-run-${action}-${profile.id}`,
      label: profile.name,
      run: () => runWithProfile(action!, profile.id),
    };
  }

  function getMergedPaletteCommands(query: string): PaletteCommand[] {
    if (profilePickerSession) {
      return listProfileCommands(profilePickerSession, query.trim());
    }
    const q = query.trimStart();
    if (q.startsWith(":")) {
      return getTabPaletteCommands();
    }

    if (q.startsWith("@pane:")) {
      return getPaneTargetCommands(q);
    }
    if (q.startsWith("@proc")) {
      return getProcCommands(q);
    }
    if (q.startsWith("@profile")) {
      return getProfileActionCommands(q);
    }

    const commands: PaletteCommand[] = [
      // --- Tabs ---
      {
        id: "tab-new",
        label: "New tab",
        keywords: "workspace create add profile",
        run: () => {
          openNewWorkspaceTab();
        },
      },
      {
        id: "tab-duplicate",
        label: "Duplicate tab",
        keywords: "workspace copy clone",
        run: () => duplicateWorkspaceTab(activeWorkspaceTabId),
      },
      {
        id: "tab-rename",
        label: "Rename tab",
        keywords: "workspace title edit",
        run: () => beginTabRename(activeWorkspaceTabId),
      },
      {
        id: "tab-close",
        label: "Close tab",
        keywords: "workspace remove delete",
        run: () => closeWorkspaceTab(activeWorkspaceTabId),
      },
      // --- Panes ---
      {
        id: "pane-split-v",
        label: "Split right",
        keywords: "split vertical columns side by side layout profile",
        hotkey: k.label("pane_split_right"),
        run: () => {
          splitFocusedWithCwd("h");
        },
      },
      {
        id: "pane-split-h",
        label: "Split down",
        keywords: "split horizontal rows stacked layout profile",
        hotkey: k.label("pane_split_down"),
        run: () => {
          splitFocusedWithCwd("v");
        },
      },
      {
        id: "pane-profile-split-v",
        label: "Split right with profile…",
        keywords: "split vertical profile picker alias",
        hotkey: k.label("profile_split_right"),
        run: () => openProfileSplitPicker("split-h"),
      },
      {
        id: "pane-profile-split-h",
        label: "Split down with profile…",
        keywords: "split horizontal profile picker alias",
        hotkey: k.label("profile_split_down"),
        run: () => openProfileSplitPicker("split-v"),
      },
      {
        id: "pane-close",
        label: "Close pane",
        keywords: "remove split focused",
        hotkey: "Ctrl+Shift+W",
        run: () => {
          void closeFocusedPane();
        },
      },
      {
        id: "pane-toggle-floating",
        label: "Float pane",
        keywords: "float pop out pop in tile hyprland layout",
        hotkey: "Ctrl+Shift+O",
        run: () => {
          toggleFocusedPaneFloating();
        },
      },
      {
        id: "pane-rename",
        label: "Rename pane",
        keywords: "pane name title label friendly id",
        run: () => openFocusedPaneRename(),
      },
      {
        id: "pane-close-children",
        label: "Reset layout",
        keywords: "reset layout keep main root initial close children",
        run: () => {
          void closeAllChildPanes();
        },
      },
      {
        id: "open-pane-theme",
        label: "Theme pane",
        keywords: "theme appearance colors focused pane local override",
        run: () => openFocusedPaneTheme(),
      },
      // --- View / appearance ---
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
        id: "toggle-mouse-hidden",
        label: mouseHiddenRef.v ? "Show cursor" : "Hide cursor",
        keywords: "mouse pointer cursor hide show invisible os",
        run: () => {
          void toggleMouseHidden();
        },
      },
      {
        id: "open-themes",
        label: "Theme",
        keywords: "theme appearance colors ui palette app global",
        run: () => {
          themeTargetPaneId = null;
          paneThemeRestore = null;
          themeModal?.open({
            title: "App Theme",
            initialPrefs: currentUiPrefs,
          });
        },
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
      // --- Terminal / session ---
      {
        id: "new-session",
        label: "Restart session",
        keywords: "restart shell pty new terminal",
        run: () => void newTerminalSession(),
      },
      {
        id: "focus-terminal",
        label: "Focus terminal",
        keywords: "keyboard input",
        run: () => {
          getFocusedTerm()?.focus();
        },
      },
      {
        id: "paste",
        label: "Paste",
        keywords: "clipboard context edit",
        run: () => void pasteFromClipboard(),
      },
      {
        id: "toggle-background-work",
        label: isBackgroundWorkMode()
          ? "Shed on hide"
          : "Keep alive on hide",
        keywords:
          "background keep alive pty buffer webview shed hide memory agent logs tui session",
        run: () => void setBackgroundWorkMode(!isBackgroundWorkMode()),
      },
      // --- Window ---
      {
        id: "window-maximize",
        label: "Maximize",
        keywords: "window maximize fullscreen grow zoom",
        hotkey: "Alt+Shift+Up",
        run: () => void setWindowMaximized(true),
      },
      {
        id: "window-restore",
        label: "Restore",
        keywords: "window restore unmaximize shrink",
        hotkey: "Alt+Shift+Down",
        run: () => void setWindowMaximized(false),
      },
      {
        id: "window-next-monitor",
        label: "Next monitor",
        keywords: "window monitor screen display move next",
        hotkey: "Alt+Shift+Right",
        run: () => void moveWindowToAdjacentMonitor(1),
      },
      {
        id: "window-prev-monitor",
        label: "Previous monitor",
        keywords: "window monitor screen display move previous prev",
        hotkey: "Alt+Shift+Left",
        run: () => void moveWindowToAdjacentMonitor(-1),
      },
      {
        id: "hide-overlay",
        label: "Hide",
        keywords: "close overlay tray background hotkey dismiss",
        hotkey: "Alt+Shift+T",
        run: () => void invoke("toggle_overlay").catch(() => {}),
      },
      // --- Presets / saved commands ---
      {
        id: "presets-save",
        label: "Save as preset",
        keywords: "presets workspace layout snapshot save template reuse",
        run: () => presetsModal?.open(),
      },
      {
        id: "presets-open",
        label: "Open preset",
        keywords: "presets workspace layout restore load template",
        run: () => presetsModal?.open(),
      },
      // --- App ---
      {
        id: "open-settings",
        label: "Settings",
        keywords: "preferences config options",
        hotkey: "Ctrl+,",
        run: () => settingsApi?.open(),
      },
      {
        id: "open-extensions",
        label: "Extensions",
        keywords: "plugins addons extensions manager",
        run: () => extManagerApi?.open(),
      },
      {
        id: "help-hotkeys",
        label: "Shortcuts",
        keywords: "hotkeys bindings reference help",
        hotkey: "Ctrl+Shift+/",
        run: () => openHelpPanel(),
      },
      {
        id: "quit-app",
        label: "Quit",
        keywords: "exit app quit close traffic light red",
        run: () => void appWindow.destroy().catch(() => {}),
      },
      ...extPaletteCommands.map((c) => ({
        id: `ext-${c.id}`,
        label: c.label,
        keywords: "extension",
        run: c.run,
      })),
    ];
    return commands;
  }

  function renderHelpShortcuts(): void {
    const list = helpPanelEl?.querySelector(
      ".help-shortcuts",
    ) as HTMLElement | null;
    if (!list) return;
    const seen = new Set<string>();
    const rows: { hotkey: string; label: string }[] = [
      { hotkey: "Ctrl+Shift+P", label: "Command palette" },
    ];
    for (const cmd of getMergedPaletteCommands("")) {
      const hotkey = cmd.hotkey?.trim();
      if (!hotkey || seen.has(hotkey)) continue;
      seen.add(hotkey);
      rows.push({ hotkey, label: cmd.label.replace(/…$/, "") });
    }
    // Keyboard + mouse shortcuts that aren't palette commands.
    rows.push(
      { hotkey: "Tab", label: "New tab / Split → pick profile" },
      { hotkey: "@profile", label: "New tab or split with a profile" },
      {
        hotkey: "a / A",
        label: "In profile picker: selection alias (case-sensitive; config.toml)",
      },
      { hotkey: "Ctrl+Arrows", label: "Focus adjacent pane" },
      { hotkey: "Ctrl+Shift+Arrows", label: "Swap pane with neighbor" },
      { hotkey: "Alt+1–9", label: "Switch to tab" },
      { hotkey: "Ctrl+Shift+1–9, 0", label: "Move pane to tab" },
      { hotkey: "Shift+Enter", label: "Insert newline" },
      { hotkey: "Ctrl+Wheel", label: "Zoom focused pane" },
      { hotkey: "Alt+Drag", label: "Move floating pane or swap tiled panes" },
      { hotkey: "Alt+Shift+Drag", label: "Move window from anywhere" },
      { hotkey: "Ctrl+V", label: "Paste from clipboard" },
      { hotkey: "Right-click", label: "Paste from clipboard" },
    );
    list.replaceChildren(
      ...rows.map(({ hotkey, label }) => {
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
      }),
    );
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
            // Don't block open on profile re-detection (shell/WSL probes).
            // Cache from boot / settings save is enough; refresh in background.
            void refreshProfilesList();
          },
          onClosed: () => {
            profilePickerSession = null;
            getFocusedTerm()?.focus();
            if (cpInput) cpInput.placeholder = "Command or > …";
          },
          onTabComplete: (currentInput: string, selected) => {
            if (
              currentInput.startsWith("@pane:") &&
              selected &&
              selected.id.startsWith("pane-target-")
            ) {
              const label = selected.label;
              const nameEnd = label.indexOf("  ");
              const paneName =
                nameEnd === -1 ? label.slice(6) : label.slice(6, nameEnd);
              return `@pane:${paneName} `;
            }
            if (
              (currentInput.startsWith("@proc:") || currentInput === "@proc") &&
              selected &&
              selected.id.startsWith("proc-")
            ) {
              const leafId = selected.id.slice(5);
              const proc = activeProcesses.get(leafId);
              if (proc) return `@proc:${displayProcessCommand(proc.command)} `;
            }
            if (profileBehaviorRef.v.palette_tab_profile_picker) {
              const action = profileActionForPaletteCommandId(selected?.id);
              if (action) {
                profilePickerSession = action;
                if (cpInput) cpInput.placeholder = "Profile";
                return "";
              }
            }
            return null;
          },
          onQuickSelectKey: (key, currentInput) =>
            quickSelectProfileByAlias(key, currentInput),
          refreshMs: 500,
        })
      : null;

  openHelpPanel = () => {
    if (!helpPanelEl) return;
    commandPalette?.close();
    settingsApi?.close();
    renderHelpShortcuts();
    helpPanelEl.classList.remove("help-panel--hidden");
    helpPanelEl.setAttribute("aria-hidden", "false");
    mouseCursorForceVisible(true);
  };
  closeHelpPanel = () => {
    helpPanelEl?.classList.add("help-panel--hidden");
    helpPanelEl?.setAttribute("aria-hidden", "true");
    mouseCursorForceVisible(false);
    getFocusedTerm()?.focus();
  };
  toggleHelp = () => {
    if (!helpPanelEl) return;
    if (helpPanelEl.classList.contains("help-panel--hidden")) openHelpPanel();
    else closeHelpPanel();
  };

  helpPanelEl
    ?.querySelector("[data-close-help]")
    ?.addEventListener("click", () => closeHelpPanel());

  // Zen tab rename modal
  const zenModal = document.getElementById("zen-rename-modal");
  zenModal
    ?.querySelector(".zen-rename-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      closeZenRenameModal(true);
    });
  zenModal?.querySelectorAll("[data-zen-rename-close]").forEach((el) => {
    el.addEventListener("click", () => closeZenRenameModal(false));
  });
  zenModal
    ?.querySelector(".zen-rename-backdrop")
    ?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeZenRenameModal(false);
    });
  zenModal?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeZenRenameModal(false);
  });
  const extManagerEl = document.getElementById(
    "extension-manager",
  ) as HTMLElement | null;
  const extManagerApi = extManagerEl
    ? createExtensionManager(extManagerEl)
    : null;
  extManagerEl
    ?.querySelector("#ext-close")
    ?.addEventListener("click", () => extManagerApi?.close());
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
  document
    .getElementById("window-maximize")
    ?.addEventListener("pointerenter", () => {
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
  // Subtle "settle" animation on the pane stack after the window itself is
  // resized/restored/maximized or hops monitors. These operations intentionally
  // restore→maximize the Tauri window (avoids a Windows render fault), which snaps
  // the panes into their new size; the brief scale+fade makes that snap feel
  // intentional and fluid instead of abrupt. Skipped when motion is off / pref
  // disabled, and never hooked to continuous manual drag-resize.
  let windowMotionTimer = 0;
  function playWindowMotion(): void {
    if (!windowMotionRef.v) return;
    if (document.documentElement.classList.contains("terminal-motion-off"))
      return;
    const el = document.getElementById("terminal-pane-root") ?? terminalContent;
    if (!el) return;
    el.classList.remove("window-motion-settle");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("window-motion-settle");
    if (windowMotionTimer) window.clearTimeout(windowMotionTimer);
    windowMotionTimer = window.setTimeout(() => {
      el.classList.remove("window-motion-settle");
      windowMotionTimer = 0;
    }, 700);
  }

  async function toggleMaximizeRestore(): Promise<void> {
    try {
      const isMax = await appWindow.isMaximized();
      if (isMax) await appWindow.unmaximize();
      else await appWindow.maximize();
      await syncMaximizeButtonTitle();
      playWindowMotion();
    } catch {
      /* ignore */
    }
  }
  // Alt+Shift+Up maximizes, Alt+Shift+Down restores (see the Alt keydown handler).
  async function setWindowMaximized(max: boolean): Promise<void> {
    try {
      if (max) await appWindow.maximize();
      else await appWindow.unmaximize();
      await syncMaximizeButtonTitle();
      playWindowMotion();
    } catch {
      /* ignore */
    }
  }
  document.getElementById("window-maximize")?.addEventListener("click", () => {
    void toggleMaximizeRestore();
  });

  // Move the window to an adjacent monitor: +1 = next (Alt+Shift+Right), -1 = previous
  // (Alt+Shift+Left), wrapping around the list. Preserves the window's offset within
  // the monitor, clamped to fit, and re-maximizes on the destination if it was maximized.
  async function moveWindowToAdjacentMonitor(direction: 1 | -1): Promise<void> {
    try {
      const monitors = await availableMonitors();
      if (monitors.length < 2) return;
      const cur = await currentMonitor();
      let idx = cur
        ? monitors.findIndex(
            (m) =>
              m.position.x === cur.position.x &&
              m.position.y === cur.position.y &&
              m.size.width === cur.size.width &&
              m.size.height === cur.size.height,
          )
        : 0;
      if (idx < 0) idx = 0;
      const from = cur ?? monitors[idx];
      const n = monitors.length;
      const to = monitors[(((idx + direction) % n) + n) % n];
      const wasMaximized = await appWindow.isMaximized();
      if (wasMaximized) await appWindow.unmaximize();
      const pos = await appWindow.outerPosition();
      const size = await appWindow.outerSize();
      const relX = pos.x - from.position.x;
      const relY = pos.y - from.position.y;
      const maxX = to.position.x + Math.max(0, to.size.width - size.width);
      const maxY = to.position.y + Math.max(0, to.size.height - size.height);
      const nextX = Math.round(
        Math.min(Math.max(to.position.x + relX, to.position.x), maxX),
      );
      const nextY = Math.round(
        Math.min(Math.max(to.position.y + relY, to.position.y), maxY),
      );
      await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
      if (wasMaximized) await appWindow.maximize();
      await syncMaximizeButtonTitle();
      playWindowMotion();
      if (cursorFollowWindowMoveRef.v) {
        scheduleCursorWarpToPane(undefined, {
          force: true,
          bypassPanePref: true,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Alt+Shift + primary-button drag moves the window from anywhere in the client
  // area. Useful in zen mode, where the toolbar drag handle is hidden. Capture
  // phase + stopPropagation so it wins over terminal/text selection handlers.
  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0 || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey)
        return;
      e.preventDefault();
      e.stopPropagation();
      void appWindow.startDragging().catch(() => {});
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (!k.match(e, "help_toggle")) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest("#command-palette") &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA")
      )
        return;
      if (
        t?.closest("#settings-panel") &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      )
        return;
      if (
        t?.closest(".termie-dialog-input") ||
        t?.closest(".termie-dialog-panel")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      toggleHelp();
    },
    true,
  );


  if (commandPalette && cpRoot) {
    window.addEventListener(
      "keydown",
      (e) => {
        if (!k.match(e, "palette_open")) return;
        e.preventDefault();
        e.stopPropagation();
        if (commandPalette.isOpen()) {
          commandPalette.close();
          return;
        }
        profilePickerSession = null;
        commandPalette.open();
      },
      true,
    );

    window.addEventListener(
      "keydown",
      (e) => {
        const m = k.match(e, "profile_split_right", "profile_split_down");
        if (!m) return;
        const t = e.target as HTMLElement | null;
        if (
          t?.closest("#command-palette") &&
          (t.tagName === "INPUT" || t.tagName === "TEXTAREA")
        )
          return;
        if (
          t?.closest("#settings-panel") &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT")
        )
          return;
        if (
          t?.closest(".termie-dialog-input") ||
          t?.closest(".termie-dialog-panel")
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        openProfileSplitPicker(
          m === "profile_split_right" ? "split-h" : "split-v",
        );
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
      if (
        helpPanelEl &&
        !helpPanelEl.classList.contains("help-panel--hidden")
      ) {
        e.preventDefault();
        closeHelpPanel();
      }
    },
    true,
  );

  type StashedPaneBuffer = {
    data: string;
    cols: number;
    rows: number;
  };

  async function persistTerminalBuffersForHide(): Promise<void> {
    if (!lp.destroy_webview_on_hide) return;

    const buffers: Record<string, string> = {};
    if (!lp.discard_buffer_on_hide) {
      for (const host of tabPaneHosts.values()) {
        host.forEachPane((id, pt) => {
          try {
            const start = firstContentScrollbackLine(pt.term);
            const end = Math.max(0, pt.term.buffer.normal.length - 1);
            const payload: StashedPaneBuffer = {
              data: pt.serialize.serialize({ range: { start, end } }),
              cols: pt.term.cols,
              rows: pt.term.rows,
            };
            buffers[id] = JSON.stringify(payload);
          } catch (e) {
            console.warn("serialize pane", id, e);
          }
        });
      }
    } else {
      for (const host of tabPaneHosts.values()) {
        host.forEachPane((_id, pt) => {
          try {
            pt.term.reset();
          } catch {
            /* ignore */
          }
        });
      }
    }

    try {
      await invoke("stash_terminal_buffers", { buffers });
    } catch (e) {
      console.warn("stash_terminal_buffers", e);
    }
  }

  function writeTerminalSerialized(term: Terminal, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        term.write(data, () => resolve());
      } catch (e) {
        reject(e);
      }
    });
  }

  async function restoreSerializedTerminals(): Promise<void> {
    if (lp.discard_buffer_on_hide) {
      try {
        await invoke("take_terminal_buffers");
      } catch {
        /* ignore */
      }
      return;
    }

    let map: Record<string, string> | null = null;
    try {
      map = await invoke<Record<string, string> | null>("take_terminal_buffers");
    } catch {
      /* ignore */
    }
    if (!map || Object.keys(map).length === 0) return;

    const writes: Promise<void>[] = [];
    for (const host of tabPaneHosts.values()) {
      host.forEachPane((id, pt) => {
        const rawPane = map![id];
        if (!rawPane) return;
        writes.push(
          (async () => {
            try {
              let data = rawPane;
              let cols = 0;
              let rows = 0;
              if (rawPane.startsWith("{")) {
                const parsed = JSON.parse(rawPane) as StashedPaneBuffer;
                if (typeof parsed.data === "string") {
                  data = parsed.data;
                  cols = Number(parsed.cols) || 0;
                  rows = Number(parsed.rows) || 0;
                }
              }
              if (cols >= 2 && rows >= 1) {
                pt.term.resize(cols, rows);
              }
              await writeTerminalSerialized(pt.term, data);
              backendReplayRestoredPanes.add(id);
            } catch (e) {
              console.warn("restoreSerializedTerminals", id, e);
            }
          })(),
        );
      });
    }
    await Promise.all(writes);
  }

  async function takeNeedsScrollbackRestore(
    fallback: boolean,
  ): Promise<boolean> {
    try {
      return await invoke<boolean>("take_webview_destroyed_for_hide");
    } catch (e) {
      console.warn("take_webview_destroyed_for_hide", e);
      return fallback;
    }
  }

  async function restoreScrollbackIfNeeded(fallback: boolean): Promise<void> {
    if (await takeNeedsScrollbackRestore(fallback)) {
      await restoreSerializedTerminals();
    }
  }

  function waitAnimationFrames(count = 2): Promise<void> {
    return new Promise((resolve) => {
      const step = (left: number) => {
        if (left <= 0) resolve();
        else requestAnimationFrame(() => step(left - 1));
      };
      step(count);
    });
  }

  async function ensurePtyForAllTabHosts(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const host of tabPaneHosts.values()) {
      host.forEachPane((id, pt) => {
        jobs.push(ensurePtyForPane(id, pt));
      });
    }
    await Promise.all(jobs);
  }

  async function unlockSummonSurface(): Promise<void> {
    await releasePtyHydrationGate();
    releaseBootSurface();
  }

  async function runPrepareShow(): Promise<void> {
    summonInProgress = true;
    summonPreparedByDefer = false;
    try {
      if (localStorage.getItem(DEFER_PTY_REINIT_KEY) === "1") {
        localStorage.removeItem(DEFER_PTY_REINIT_KEY);
        await newTerminalSession();
      }
      scheduleResizeImmediate();
      await waitAnimationFrames(2);

      // Restore before PTY ensure/replay so catch-up cannot race an empty buffer.
      await restoreScrollbackIfNeeded(lp.destroy_webview_on_hide);
      await ensurePtyForAllTabHosts();

      await mountWebglForActivePanes();
      const ft = getFocusedTerm();
      if (ft) ft.refresh(0, ft.rows - 1);
      if (paneHost) scheduleHostGeometryRepair(paneHost);
      scheduleResizeImmediate(true);
      scheduleCwdSync();
      await waitAnimationFrames(2);

      await unlockSummonSurface();
      summonPreparedByDefer = lp.defer_window_show_until_prepared;
      if (lp.defer_window_show_until_prepared) {
        await invoke("commit_show_window").catch((e) =>
          console.error("commit_show_window", e),
        );
      }
    } catch (e) {
      summonInProgress = false;
      summonPreparedByDefer = false;
      await releasePtyHydrationGate().catch(() => {});
      releaseBootSurface();
      throw e;
    }
  }

  await Promise.all([
    listen<{ paneId: string; cwd: string }>("pty-cwd", (event) => {
      const { paneId, cwd } = event.payload;
      paneCwdHints.set(paneId, cwd);
      lastLiveCwdSignalAt = Date.now();
      if (paneId !== paneHost?.getFocusedPaneId()) return;
      if (normalizeFsPathKey(cwd) === normalizeFsPathKey(liveCwd ?? "")) return;
      liveCwd = cwd;
    }),

    listen<{
      paneId: string;
      kind: string;
      exitCode?: number | null;
      text?: string;
    }>("pty-shell-event", (event) => {
      const { paneId, kind, text } = event.payload;
      switch (kind) {
        case "commandLine": {
          if (!text) break;
          const merged = mergeProcessCommand(
            pendingShellCommandLine.get(paneId) ?? "",
            text,
          );
          if (merged) pendingShellCommandLine.set(paneId, merged);
          const entry = activeProcesses.get(paneId);
          if (entry) {
            applyShellCommandLine(entry, text);
          }
          break;
        }
        case "preExec": {
          let entry = activeProcesses.get(paneId);
          if (!entry) {
            const cmd = pendingShellCommandLine.get(paneId);
            if (!cmd) break;
            entry = createActiveProcessEntry(
              cmd,
              paneCwdHints.get(paneId) || "",
            );
            activeProcesses.set(paneId, entry);
            if (extProcStartSubs.length > 0) {
              const start = {
                paneId,
                command: displayProcessCommand(entry.command),
                cwd: entry.cwd,
              };
              for (const fn of extProcStartSubs) {
                try {
                  fn(start);
                } catch {
                  /* ignore */
                }
              }
            }
          }
          markProcessExecStart(entry);
          pendingShellCommandLine.delete(paneId);
          break;
        }
        case "commandDone": {
          finishActiveProcess(paneId, Date.now());
          break;
        }
        case "promptStart": {
          const entry = activeProcesses.get(paneId);
          if (entry && shouldEndOnPromptStart(entry)) {
            finishActiveProcess(paneId, Date.now());
          }
          break;
        }
      }
    }),

    listen<PtyExitEvent>("pty-exit", async (event) => {
      const { pane_id } = event.payload;
      const pending = pendingPtyOutputByPane.get(pane_id);
      if (pending) {
        pendingPtyOutputByPane.delete(pane_id);
        processPtyOutputBatch(
          pane_id,
          pending.data,
          pending.eventCount,
          pending.queuedAt,
        );
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
      paneHost?.forEachPane((_id, p) => {
        p.term.reset();
      });
      scheduleCwdSync();
    }),
    listen("partty-hide", () => {
      void (async () => {
        for (const fn of extWindowHideSubs) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
        if (paneHost && lp.destroy_webview_on_hide) {
          persistCurrentWorkspaceTabLayout();
        }
        await persistTerminalBuffersForHide();
        if (lp.webgl_shed_on_hide) {
          shedWebgl();
        }
        // WebView teardown waits for stash (see schedule_destroy_webview_after_hide).
      })();
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
      for (const fn of extWindowShowSubs) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }

      // Defer-show: prepare already restored/painted — avoid a second pass.
      if (summonPreparedByDefer) {
        summonPreparedByDefer = false;
        summonInProgress = false;
        getFocusedTerm()?.focus();
        mouseCursorController?.sync();
        return;
      }

      // Non-defer summon (or prepare skipped): restore → paint → unlock, then PTY.
      summonInProgress = true;
      try {
        await restoreScrollbackIfNeeded(false);
        await mountWebglForActivePanes();
        getFocusedTerm()?.focus();
        scheduleResizeImmediate();
        scheduleCwdSync();
        await waitAnimationFrames(2);
        await unlockSummonSurface();
        mouseCursorController?.sync();
        if (!lp.defer_window_show_until_prepared) {
          const jobs: Promise<void>[] = [];
          paneHost?.forEachPane((id, pt) => {
            jobs.push(ensurePtyForPane(id, pt));
          });
          await Promise.all(jobs);
        }
        reflowAllPanes();
        const ft = getFocusedTerm();
        if (ft) ft.refresh(0, ft.rows - 1);
        getFocusedTerm()?.focus();
      } finally {
        summonInProgress = false;
      }
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
  // The first fit() can run before the terminal's custom font finishes loading, so
  // xterm measures cell width with a fallback font and computes the wrong cols/rows
  // (mis-sized canvas). Re-fit once fonts are ready, and again on any late font load.
  if (document.fonts) {
    void document.fonts.ready.then(() => {
      if (summonInProgress || summonPreparedByDefer) return;
      reflowAllPanes();
    });
    document.fonts.addEventListener("loadingdone", () => {
      if (summonInProgress || summonPreparedByDefer) return;
      reflowAllPanes();
    });
  }

  stage?.addEventListener("mousedown", () => {
    getFocusedTerm()?.focus();
  });

  requestAnimationFrame(() => {
    scheduleResizeImmediate();
    // prepare-show ensures PTYs after scrollback restore while booting.
    if (
      lp.preload_pty_on_startup &&
      !document.documentElement.classList.contains("partty-booting")
    ) {
      paneHost?.forEachPane((id) => {
        void ensurePtyForPane(id);
      });
    } else {
      scheduleCwdSync();
    }
  });

  scheduleIdle(() => {
    void (async () => {
      scheduleResizeImmediate();
    })();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // prepare-show already reflowed; a second pass here (from commit_show)
      // causes a post-reveal layout bounce.
      if (summonInProgress || summonPreparedByDefer) return;
      scheduleResizeDebounced();
      scheduleCwdSync();
      reflowAllPanes();
      getFocusedTerm()?.focus();
    }
  });

  // ── Extensions ──────────────────────────────────────────────
  // Load extensions from %LOCALAPPDATA%/partty/extensions/<name>/index.js
  // at runtime. Each extension receives an `api` object with the full
  // ExtensionApi surface. The code runs as the body of function(api) { ... }
  // — no export or build step required.
  void (async () => {
    try {
      const allExts = await invoke<
        Array<{
          id: string;
          name: string;
          version: string;
          description: string;
          code: string;
          enabled: boolean;
        }>
      >("list_extensions");
      const exts = allExts.filter((e) => e.enabled);
      if (exts.length === 0) return;

      // Listener registries — zero overhead when no extensions subscribe.
      const extApi: Record<string, unknown> = {
        onPtyOutput(fn: (paneId: string, data: string) => void) {
          extPtyOutputSubs.push(fn);
          return () => {
            const idx = extPtyOutputSubs.indexOf(fn);
            if (idx !== -1) extPtyOutputSubs.splice(idx, 1);
          };
        },
        onPtyInput(fn: (paneId: string, data: string) => void) {
          extPtyInputSubs.push(fn);
          return () => {
            const idx = extPtyInputSubs.indexOf(fn);
            if (idx !== -1) extPtyInputSubs.splice(idx, 1);
          };
        },
        onProcessStart(
          fn: (proc: { paneId: string; command: string; cwd: string }) => void,
        ) {
          extProcStartSubs.push(fn);
          return () => {
            const idx = extProcStartSubs.indexOf(fn);
            if (idx !== -1) extProcStartSubs.splice(idx, 1);
          };
        },
        onProcessEnd(
          fn: (proc: {
            paneId: string;
            command: string;
            durationMs: number;
          }) => void,
        ) {
          extProcEndSubs.push(fn);
          return () => {
            const idx = extProcEndSubs.indexOf(fn);
            if (idx !== -1) extProcEndSubs.splice(idx, 1);
          };
        },
        getPaneActiveProcess(paneId: string) {
          const entry = activeProcesses.get(paneId);
          if (!entry) return null;
          return {
            command: displayProcessCommand(entry.command),
            cwd: entry.cwd,
            startedAt: entry.startedAt,
          };
        },
        getActiveProcesses() {
          const result: Array<{
            paneId: string;
            command: string;
            cwd: string;
            startedAt: number;
          }> = [];
          for (const [paneId, entry] of activeProcesses) {
            result.push({
              paneId,
              command: displayProcessCommand(entry.command),
              cwd: entry.cwd,
              startedAt: entry.startedAt,
            });
          }
          return result;
        },
        writeToPane(paneId: string, text: string) {
          queuePtyWrite(paneId, text);
        },
        showNotification(command: string, detail: string, paneId?: string) {
    if (!processNotificationEnabledRef.v) return;
    if (!processToast) return;
          processToast.dataset.paneId = paneId ?? "";
          const navArrow = paneId
            ? `<button class="proc-toast-nav" title="Go to pane">\u2192</button>`
            : "";
          processToast.innerHTML = `<span class="proc-toast-cmd">${escapeHtml(command)}</span> ${escapeHtml(detail)}${navArrow}`;
          processToast.classList.remove("proc-toast--hidden");
          if (processToastTimer) clearTimeout(processToastTimer);
          processToastTimer = window.setTimeout(() => {
            processToast.classList.add("proc-toast--hidden");
          }, processNotificationShowForRef.v);
        },
        getPref<T>(key: string, fallback: T): T {
          try {
            const raw = localStorage.getItem(`partty.ext.${key}`);
            return raw ? JSON.parse(raw) : fallback;
          } catch {
            return fallback;
          }
        },
        setPref<T>(key: string, value: T): void {
          localStorage.setItem(`partty.ext.${key}`, JSON.stringify(value));
        },
        getAppTheme() {
          return {
            ui: currentUiPrefs,
            terminal: buildXtermThemeFromPrefs(
              persisted.prefs as PaneThemePrefs,
            ),
          };
        },
        getPaneTheme(paneId: string) {
          const pt = getPaneTerminalById(paneId);
          const theme = pt
            ? { ...pt.term.options.theme }
            : buildXtermThemeFromPrefs(persisted.prefs as PaneThemePrefs);
          const override = paneThemes.get(paneId);
          return { theme, override: override ?? null };
        },
        getFocusedPaneId: () => paneHost?.getFocusedPaneId() ?? null,
        getPaneIds: () => {
          const ids: string[] = [];
          for (const host of tabPaneHosts.values())
            ids.push(...host.getLeafIdsInOrder());
          return ids;
        },
        getPaneCwd: (paneId: string) => paneCwdHints.get(paneId) ?? null,
        getPaneName: (paneId: string) => paneNames.get(paneId) ?? null,

        // ── Pane & tab control ──
        focusPane(paneId: string) {
          if (typeof paneId !== "string" || !paneId) return;
          navigateToPane(paneId);
        },
        closePane(paneId: string) {
          if (typeof paneId !== "string" || !paneId) return;
          const host = getPaneHostByPaneId(paneId);
          if (!host) return;
          if (host.isPristineRootTab()) {
            const tabId = tabIdForPaneHost(host);
            if (tabId) closeWorkspaceTab(tabId);
            return;
          }
          void ptyKillPane(paneId).catch(() => {});
          host.removePane(paneId);
        },
        splitPane(paneId: string, dir: "h" | "v") {
          if (typeof paneId !== "string" || !paneId) return null;
          const host = getPaneHostByPaneId(paneId);
          if (!host) return null;
          host.setFocusedPaneId(paneId);
          return splitFocusedWithCwd(dir) ?? null;
        },
        getTabs() {
          const tabs = visibleWorkspaceTabsInOrder();
          return tabs.map((t) => ({
            id: t.id,
            name: t.name,
            active: t.id === activeWorkspaceTabId,
          }));
        },
        switchTab(tabId: string) {
          if (typeof tabId !== "string" || !tabId) return;
          if (tabPaneHosts.has(tabId)) switchWorkspaceTab(tabId);
        },

        // ── Events ──
        onPaneCreated(fn: (paneId: string) => void) {
          extPaneCreatedSubs.push(fn);
          return () => {
            const idx = extPaneCreatedSubs.indexOf(fn);
            if (idx !== -1) extPaneCreatedSubs.splice(idx, 1);
          };
        },
        onPaneClosed(fn: (paneId: string) => void) {
          extPaneClosedSubs.push(fn);
          return () => {
            const idx = extPaneClosedSubs.indexOf(fn);
            if (idx !== -1) extPaneClosedSubs.splice(idx, 1);
          };
        },
        onFocusChanged(fn: (paneId: string) => void) {
          extFocusSubs.push(fn);
          return () => {
            const idx = extFocusSubs.indexOf(fn);
            if (idx !== -1) extFocusSubs.splice(idx, 1);
          };
        },

        // ── Command palette ──
        registerCommand(id: string, label: string, run: () => void) {
          extPaletteCommands.push({ id, label, run });
          return () => {
            const idx = extPaletteCommands.findIndex((c) => c.id === id);
            if (idx !== -1) extPaletteCommands.splice(idx, 1);
          };
        },

        // ── Tab lifecycle ──
        onTabSwitch(fn: (tabId: string) => void) {
          extTabSwitchSubs.push(fn);
          return () => {
            const idx = extTabSwitchSubs.indexOf(fn);
            if (idx !== -1) extTabSwitchSubs.splice(idx, 1);
          };
        },

        // ── Window lifecycle ──
        onWindowShow(fn: () => void) {
          extWindowShowSubs.push(fn);
          return () => {
            const idx = extWindowShowSubs.indexOf(fn);
            if (idx !== -1) extWindowShowSubs.splice(idx, 1);
          };
        },
        onWindowHide(fn: () => void) {
          extWindowHideSubs.push(fn);
          return () => {
            const idx = extWindowHideSubs.indexOf(fn);
            if (idx !== -1) extWindowHideSubs.splice(idx, 1);
          };
        },

        // ── Metadata ──
        getAppVersion: () => pkg.version,
      };

      for (const ext of exts) {
        try {
          // Extension code is the body of a function receiving `api`.
          // e.g.:  api.onPtyOutput((paneId, data) => { ... });
          //         api.showNotification("Hello", "World");
          const wrapped = `"use strict";\n${ext.code}\n//# sourceURL=extension:${ext.id}`;
          const fn = new Function("api", wrapped);
          fn(extApi);
        } catch (e) {
          console.error(`Extension "${ext.name}" activation failed`, e);
        }
      }
    } catch {
      // Extensions directory doesn't exist or is empty — nothing to load.
    }
  })();

  let devMetricsOverlay: DevMetricsOverlayApi | null = null;
  const appRoot = document.getElementById("app");
  const getFocusedPaneId = (): string | null | undefined => paneHost?.getFocusedPaneId();
  if (parttyPerf.enabled && appRoot) {
    devMetricsOverlay = createDevMetricsOverlay({ root: appRoot, getFocusedPaneId });
  }

  window.addEventListener("keydown", (e) => {
    if (!k.match(e, "dev_toggle")) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("#command-palette") || t?.closest("#settings-panel")) return;
    if (!parttyPerf.enabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!devMetricsOverlay && appRoot) {
      devMetricsOverlay = createDevMetricsOverlay({ root: appRoot, getFocusedPaneId });
    }
    devMetricsOverlay?.toggle();
  }, true);

  window.addEventListener("beforeunload", () => {
    mouseCursorController?.dispose();
    bridgeScrollCleanup?.();
    paneHost = null;
    commandPalette?.dispose();
  });
}

void boot().catch((e) => {
  console.error("boot failed", e);
});
