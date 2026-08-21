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
  /** Composed display name (OSC title, or profile + cwd/process). */
  name: string;
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
  /** "move" = the cursor actually moved; "sync" = view-relative re-emission
   *  (scroll/resize) where the cursor teleports. */
  kind: "move" | "sync";
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

export type TabBarJustify = "start" | "center" | "end";

export type TabBarSlot = "leading" | "trailing" | "background";

export type TabBarLayout = {
  tabJustify?: TabBarJustify;
  /** When true, keep the strip visible even with a single tab. */
  showSingleTab?: boolean;
  /** Do not append the built-in close control; render it yourself if needed. */
  omitDefaultClose?: boolean;
  /** When false, hug content so leftover width is the window drag region. */
  grow?: boolean;
  /** CSS gap between leading / strip / trailing. */
  gap?: string;
  /** CSS gap between items inside a slot. */
  itemGap?: string;
};

export type HostIdentity = {
  user: string;
  host: string;
};

export type TabInfo = {
  id: string;
  /** 1-based strip index (matches the number in live pane ids). */
  index: number;
  name: string;
  displayName: string;
  userName: string | null;
  color: string | null;
  groupId: string | null;
  groupName: string | null;
  groupColor: string | null;
  active: boolean;
  focusedPaneId: string | null;
};

export type TabGroupInfo = {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
  tabIds: string[];
};

export type TabBarItem = {
  id: string;
  slot: TabBarSlot;
  order?: number;
  /** Called once. Return a disposer (clearInterval, etc.). */
  mount: (el: HTMLElement) => void | (() => void);
  /** Called after each host strip rebuild. `el` is the same node as mount. */
  update?: (el: HTMLElement) => void;
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
  getTabs(): TabInfo[];
  getTabGroups(): TabGroupInfo[];
  switchTab(tabId: string): void;

  // ── Events ──
  onPaneCreated(fn: (paneId: string) => void): () => void;
  onPaneClosed(fn: (paneId: string) => void): () => void;
  onFocusChanged(fn: (paneId: string) => void): () => void;
  onCwdChanged(fn: (paneId: string, cwd: string) => void): () => void;
  onTabSwitch(fn: (tabId: string) => void): () => void;
  /**
   * Fires after the host rebuilds the tab strip (switch, rename, reorder,
   * title, custom renderer). Do not call requestTabBarRender from here.
   */
  onTabsChanged(fn: () => void): () => void;
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
  /** Composed display name (OSC title, or profile + cwd/process). */
  getPaneName(paneId: string): string | null;
  getPaneTerminalDims(paneId: string): { cols: number; rows: number } | null;
  getWindowState(): { visible: boolean; zenMode: boolean };

  // ── Metadata ──
  getAppVersion(): string;
  /** Local account and machine name (`user` / `host`). */
  getHostIdentity(): HostIdentity;

  // ── Rendering & cursor (pane overlay surface) ──
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

  // ── Tab bar chrome ──
  getTabBarLayout(): {
    tabJustify: TabBarJustify;
    showSingleTab: boolean;
    omitDefaultClose: boolean;
    grow: boolean;
    gap: string;
    itemGap: string;
  };
  /**
   * Layout of the host strip. Last writer wins; the returned function
   * restores the previous layout.
   */
  setTabBarLayout(layout: TabBarLayout): () => void;
  /**
   * Replace the contents of each tab button. The host still creates the
   * button, wires click / drag / context menu, and optionally the close hit.
   */
  registerTabRenderer(fn: (tab: TabInfo, el: HTMLElement) => void): () => void;
  registerGroupRenderer(
    fn: (group: TabGroupInfo, el: HTMLElement) => void,
  ): () => void;
  /**
   * Persistent widget in the tab-bar area. Survives strip rebuilds.
   * Use `trailing` / `leading` for clocks and labels; `background` is
   * pointer-events: none and fills the wrap.
   */
  registerTabBarItem(item: TabBarItem): () => void;
  requestTabBarRender(): void;
  /** Run accessory `update` hooks without rebuilding the strip. */
  refreshTabBarItems(): void;
};
