import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { PaneHost, type PaneTerminal } from "./paneHost";
import {
  closeDetachedPane,
  getDetachedPaneBootstrap,
  ptyAckExit,
  ptyEnsure,
  ptyFocusPane,
  ptyResize,
  ptyWrite,
} from "./ptyIpc";
import { createWebglAddon } from "./termLifecycle";
import {
  applyUiTheme,
  buildXtermThemeFromDocument,
  DEFAULT_TERMINAL_FONT_STACK,
  loadCustomThemesIntoCache,
  pickUiPrefs,
} from "./uiTheme";
import {
  createShellIntegrationState,
  processShellIntegration,
  type ShellIntegrationState,
} from "./shellIntegration";

const PTY_FALLBACK_COLS = 80;
const PTY_FALLBACK_ROWS = 24;
const RESIZE_DEBOUNCE_MS = 100;

type PersistedPayload = { prefs: Record<string, unknown> };

function terminalFontStackFromDocument(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--font-terminal").trim();
  return raw.replace(/^[\"']|[\"']$/g, "") || DEFAULT_TERMINAL_FONT_STACK;
}

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

const appWindow = getCurrentWindow();
const windowLabel = appWindow.label;

let paneId = "";
let paneHost: PaneHost | null = null;
let paneShellState: ShellIntegrationState | null = null;
let paneWebgl: WebglAddon | null = null;
let resizeObs: ResizeObserver | null = null;
let resizeTimer = 0;
let snapshotReplay: string | null = null;

function scheduleResize(): void {
  if (resizeTimer) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = 0;
    void runResize();
  }, RESIZE_DEBOUNCE_MS);
}

function refreshTerminalChrome(): void {
  const pt = paneId ? paneHost?.getPaneTerminal(paneId) : null;
  if (!pt) return;
  pt.term.options.theme = buildXtermThemeFromDocument();
  pt.term.options.fontFamily = terminalFontStackFromDocument();
  pt.term.refresh(0, pt.term.rows - 1);
}

async function ensureWebgl(): Promise<void> {
  const pt = paneId ? paneHost?.getPaneTerminal(paneId) : null;
  if (!pt || paneWebgl) return;
  const delays = [0, 50, 120, 240];
  for (const delay of delays) {
    if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
    try {
      const addon = await createWebglAddon();
      pt.term.loadAddon(addon);
      paneWebgl = addon;
      pt.term.refresh(0, pt.term.rows - 1);
      return;
    } catch {
      paneWebgl = null;
    }
  }
}

function shedWebgl(): void {
  try {
    paneWebgl?.dispose();
  } catch {
    /* ignore */
  }
  paneWebgl = null;
}

async function runResize(): Promise<void> {
  const pt = paneId ? paneHost?.getPaneTerminal(paneId) : null;
  if (!pt) return;
  pt.fit.fit();
  let d = ptyDims(pt.fit);
  if (!d) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    pt.fit.fit();
    d = ptyDims(pt.fit);
  }
  const raw = d ?? { cols: PTY_FALLBACK_COLS, rows: PTY_FALLBACK_ROWS };
  const safe = clampPtyColsRows(raw.cols, raw.rows);
  try {
    await ptyResize(paneId, safe.cols, safe.rows);
  } catch {
    /* ignore */
  }
}

async function ensurePtyForPane(ptIn?: PaneTerminal): Promise<void> {
  const pt = ptIn ?? (paneId ? paneHost?.getPaneTerminal(paneId) : null);
  if (!pt || !paneId) return;
  pt.fit.fit();
  let d = ptyDims(pt.fit);
  if (!d) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    pt.fit.fit();
    d = ptyDims(pt.fit);
  }
  const raw = d ?? { cols: PTY_FALLBACK_COLS, rows: PTY_FALLBACK_ROWS };
  const safe = clampPtyColsRows(raw.cols, raw.rows);
  try {
    await ptyEnsure(paneId, safe.cols, safe.rows);
  } catch (e) {
    console.error("detached pty_ensure failed:", e);
    try {
      pt.term.write("\r\n\x1b[31mShell failed to start.\x1b[0m\r\n");
    } catch {
      /* ignore */
    }
  }
}

async function mountDetachedPane(prefs: Record<string, unknown>): Promise<void> {
  const root = document.getElementById("detached-pane-root");
  if (!root) throw new Error("#detached-pane-root missing");

  paneHost = new PaneHost(root, {
    rootPaneId: paneId,
    scrollbackLines: Math.max(0, Math.min(50000, Number(prefs.scrollback_lines) || 0)),
    fontStack: terminalFontStackFromDocument(),
    getTheme: () => buildXtermThemeFromDocument(),
    focusFollowsCursor: () => false,
    onPaneFocus: (id) => {
      void ptyFocusPane(id).catch(() => {});
      paneHost?.getPaneTerminal(id)?.term.focus();
    },
    onPaneCreated: (id, pt) => {
      pt.term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          (e.key === "c" || e.key === "C")
        ) {
          if (pt.term.hasSelection()) {
            e.preventDefault();
            void navigator.clipboard.writeText(pt.term.getSelection()).catch(() => {});
            return false;
          }
          return true;
        }
        if (
          e.ctrlKey &&
          e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          (e.key === "w" || e.key === "W")
        ) {
          e.preventDefault();
          void closeDetachedPane(windowLabel).catch(() => {});
          return false;
        }
        if (
          e.ctrlKey &&
          e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          (e.key === "v" || e.key === "V")
        ) {
          e.preventDefault();
          void readText()
            .then((text) => {
              if (text) return ptyWrite(id, text);
              return Promise.resolve();
            })
            .catch(() => {});
          return false;
        }
        return true;
      });
      pt.term.onData((data) => {
        void ptyWrite(id, data).catch((err) => console.error("pty_write", err));
      });
      if (snapshotReplay) {
        pt.term.write(snapshotReplay);
        snapshotReplay = null;
      }
      queueMicrotask(() => {
        void ensurePtyForPane(pt);
        void ensureWebgl();
      });
    },
    onPaneDisposed: () => {
      shedWebgl();
    },
    onPaneLayout: () => scheduleResize(),
  });

  resizeObs = new ResizeObserver(() => scheduleResize());
  resizeObs.observe(root);
}

async function toggleMaximize(): Promise<void> {
  try {
    if (await appWindow.isMaximized()) await appWindow.unmaximize();
    else await appWindow.maximize();
  } catch {
    /* ignore */
  }
}

async function boot(): Promise<void> {
  document.documentElement.classList.add("detached-pane-root-html");
  const persisted = await invoke<PersistedPayload>("get_persisted_state");
  await loadCustomThemesIntoCache();
  applyUiTheme(pickUiPrefs(persisted.prefs));

  const bootstrap = await getDetachedPaneBootstrap(windowLabel);
  paneId = bootstrap.pane_id;
  snapshotReplay = bootstrap.snapshot;
  document.title = bootstrap.title;
  document.getElementById("detached-pane-title")!.textContent = bootstrap.title;

  paneShellState = createShellIntegrationState();
  await mountDetachedPane(persisted.prefs);
  refreshTerminalChrome();
  paneHost?.getPaneTerminal(paneId)?.term.focus();

  await Promise.all([
    listen<{ pane_id: string; data: string }>("pty-output", (event) => {
      const { pane_id, data } = event.payload;
      if (pane_id !== paneId) return;
      const pt = paneHost?.getPaneTerminal(pane_id);
      if (!pt || !paneShellState) return;
      const si = processShellIntegration(data, paneShellState);
      pt.term.write(si.cleaned);
    }),
    listen<{ pane_id: string }>("pty-exit", async (event) => {
      const { pane_id } = event.payload;
      if (pane_id !== paneId) return;
      await ptyAckExit(pane_id);
      const pt = paneHost?.getPaneTerminal(pane_id);
      pt?.term.write("\r\n\x1b[90mReconnecting…\x1b[0m\r\n");
      await ensurePtyForPane(pt ?? undefined);
    }),
  ]);

  document.getElementById("detached-pane-close")?.addEventListener("click", () => {
    void closeDetachedPane(windowLabel).catch(() => {});
  });
  document.getElementById("detached-pane-maximize")?.addEventListener("click", () => {
    void toggleMaximize();
  });
  document.getElementById("detached-pane-chrome")?.addEventListener("dblclick", () => {
    void toggleMaximize();
  });
  document.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement | null;
    if (!e.altKey || e.button !== 0) return;
    if (target?.closest("button, input, textarea, select")) return;
    void appWindow.startDragging().catch(() => {});
  });
  window.addEventListener("resize", () => scheduleResize());
  void appWindow.onResized(() => scheduleResize());
  void appWindow.onScaleChanged(() => scheduleResize());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleResize();
      void ensureWebgl();
      paneHost?.getPaneTerminal(paneId)?.term.focus();
    }
  });
  window.addEventListener("beforeunload", () => {
    resizeObs?.disconnect();
    resizeObs = null;
    shedWebgl();
    paneHost?.dispose();
    paneHost = null;
  });
}

void boot().catch((e) => {
  console.error("detachedPane boot", e);
  void closeDetachedPane(windowLabel).catch(() => {});
});
