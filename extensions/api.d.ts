/**
 * Partty Extension API types (for reference — not imported at runtime).
 *
 * Extension files in %USERPROFILE%/.partty/extensions/<name>/index.js
 * are executed as the body of function(api) { ... }.
 * `api` conforms to this interface.
 */

export type ProcessInfo = {
  paneId: string;
  command: string;
  cwd: string;
};

export type ProcessEndInfo = {
  paneId: string;
  command: string;
  durationMs: number;
  /** OSC 133 exit code, or null when the shell didn't report one. */
  exitCode: number | null;
};

export type ActiveProcess = {
  command: string;
  cwd: string;
  startedAt: number;
};

export type ActiveProcessListEntry = {
  paneId: string;
  command: string;
  cwd: string;
  startedAt: number;
};

export type PaneInfo = {
  id: string;
  /** Effective display name (user name / program / id prefix). */
  name: string;
  userName: string | null;
  programName: string | null;
  cwd: string | null;
  tabId: string | null;
  floating: boolean;
  focused: boolean;
};

export type CursorPosition = {
  /** View-relative cell column. */
  x: number;
  /** View-relative cell row (0 = top visible row). */
  y: number;
};

export type OverlayHandle = {
  /** Canvas overlay, sized to the pane, DPR-scaled; draw in CSS pixels. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Current cell metrics in CSS pixels (refresh before each frame). */
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  /**
   * Schedule one frame. The API clears the canvas before invoking `draw`,
   * and skips frames while the pane's tab is hidden. `draw` receives the
   * timestamp (performance.now()). Re-call requestRender to keep animating.
   */
  requestRender(draw: (t: number) => void): void;
  destroy(): void;
};

export type ExtensionApi = {
  onPtyOutput(fn: (paneId: string, data: string) => void): () => void;
  onPtyInput(fn: (paneId: string, data: string) => void): () => void;

  // ── Process lifecycle ──
  onProcessStart(fn: (proc: ProcessInfo) => void): () => void;
  onProcessEnd(fn: (proc: ProcessEndInfo) => void): () => void;
  getPaneActiveProcess(paneId: string): ActiveProcess | null;
  getActiveProcesses(): ActiveProcessListEntry[];

  // ── PTY control ──
  writeToPane(paneId: string, text: string): void;

  // ── Pane & tab control ──
  focusPane(paneId: string): void;
  closePane(paneId: string): void;
  splitPane(paneId: string, dir: "h" | "v"): string | null;
  getTabs(): { id: string; name: string; active: boolean }[];
  switchTab(tabId: string): void;

  // ── Events ──
  onPaneCreated(fn: (paneId: string) => void): () => void;
  onPaneClosed(fn: (paneId: string) => void): () => void;
  onFocusChanged(fn: (paneId: string) => void): () => void;
  onCwdChanged(fn: (paneId: string, cwd: string) => void): () => void;
  onPaneRenamed(fn: (paneId: string, name: string | null) => void): () => void;
  onTabSwitch(fn: (tabId: string) => void): () => void;
  onWindowShow(fn: () => void): () => void;
  onWindowHide(fn: () => void): () => void;

  // ── Command palette ──
  registerCommand(
    id: string,
    label:
      | string
      | { label: string; keywords?: string; run: () => void },
    run?: () => void,
  ): () => void;

  // ── Notifications ──
  showNotification(command: string, detail: string, paneId?: string): void;

  // ── Preferences (extension-scoped, persisted in localStorage) ──
  getPref<T>(key: string, fallback: T): T;
  setPref<T>(key: string, value: T): void;

  // ── Theme ──
  getAppTheme(): { ui: any; terminal: any };
  getPaneTheme(paneId: string): { theme: any; override: any | null };

  // ── Pane queries ──
  getFocusedPaneId(): string | null;
  getPaneIds(): string[];
  getPaneInfo(paneId: string): PaneInfo | null;
  getPaneCwd(paneId: string): string | null;
  getPaneName(paneId: string): string | null;
  getPaneTerminalDims(paneId: string): { cols: number; rows: number } | null;
  getWindowState(): { visible: boolean; zenMode: boolean };

  // ── Metadata ──
  getAppVersion(): string;

  // ── Rendering & cursor (planned — in development) ──
  /** Per-pane canvas overlay above the terminal surface. */
  createOverlay(
    paneId: string,
    opts?: { hideCursor?: boolean },
  ): OverlayHandle | null;
  /** View-relative cursor cell moves. */
  onCursorMove(
    paneId: string,
    fn: (pos: CursorPosition) => void,
  ): () => void;
  /** Current view-relative cursor cell. */
  getCursorPos(paneId: string): CursorPosition | null;
};
