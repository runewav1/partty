/**
 * Partty Extension API types (for reference — not imported at runtime).
 *
 * Extension files in %LOCALAPPDATA%/partty/extensions/<name>/index.js
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

export type ExtensionApi = {
  // ── PTY observation (on-demand, zero overhead when unsubscribed) ──
  onPtyOutput(fn: (paneId: string, data: string) => void): () => void;
  onPtyInput(fn: (paneId: string, data: string) => void): () => void;

  // ── Process lifecycle ──
  onProcessStart(fn: (proc: ProcessInfo) => void): () => void;
  onProcessEnd(fn: (proc: ProcessEndInfo) => void): () => void;
  getPaneActiveProcess(paneId: string): ActiveProcess | null;
  getActiveProcesses(): ActiveProcessListEntry[];

  // ── PTY control ──
  writeToPane(paneId: string, text: string): Promise<void>;

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

  // ── Command palette ──
  registerCommand(id: string, label: string, run: () => void): () => void;

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
  getPaneCwd(paneId: string): string | null;
  getPaneName(paneId: string): string | null;
};
