/**
 * File tree coordinator — owns cwd tracking and the file tree backend.
 * Stripped of git/search plumbing; renders the file tree at the focused
 * pane's cwd. The "free-roam" split (bottom of the inline file-tree) does
 * cwd tracking itself and does not go through this coordinator.
 */

import { CwdTracker } from "./cwdTracker";
import { FileTreeBackend } from "./fileTreeBackend";
import { ptyShellCwd } from "./ptyIpc";
import { isNativeAbsoluteFsPath, normalizeFsPathKey } from "./oscCwd";

export type FileTreeCoordinatorOptions = {
  onFileTreeRootChange?: (root: string | null) => void;
  onFileSystemChange?: (paths: string[]) => void;
};

/**
 * Coordinator for the cwd-tracking file tree.
 */
export class FileTreeCoordinator {
  private readonly cwdTracker: CwdTracker;
  private readonly fileTreeBackend: FileTreeBackend;
  private readonly options: FileTreeCoordinatorOptions;
  private readonly panesWithLiveCwd = new Set<string>();
  private lastLiveCwdSignalAt = 0;
  private lastRefreshKey = "";

  constructor(options: FileTreeCoordinatorOptions = {}) {
    this.options = options;
    this.cwdTracker = new CwdTracker();

    this.fileTreeBackend = new FileTreeBackend({
      onFileSystemChange: (paths) => {
        this.options.onFileSystemChange?.(paths);
      },
    });

    this.cwdTracker.onCwdChange((paneId, cwd) => {
      this.handleCwdChange(paneId, cwd);
    });
  }

  getCwdTracker(): CwdTracker {
    return this.cwdTracker;
  }

  getFileTreeBackend(): FileTreeBackend {
    return this.fileTreeBackend;
  }

  handlePaneFocus(paneId: string): void {
    this.cwdTracker.setFocusedPane(paneId);
    const cwd = this.cwdTracker.getPaneCwd(paneId);
    if (!isNativeAbsoluteFsPath(cwd)) {
      this.options.onFileTreeRootChange?.(null);
      this.lastRefreshKey = "";
      return;
    }
    void this.refresh();
  }

  seedPaneCwd(paneId: string, cwd: string | null | undefined): void {
    if (!paneId || !isNativeAbsoluteFsPath(cwd)) return;
    this.panesWithLiveCwd.add(paneId);
    this.cwdTracker.updatePaneCwd(paneId, cwd.trim());
    this.lastLiveCwdSignalAt = Date.now();
  }

  handlePaneDispose(paneId: string): void {
    this.cwdTracker.removePane(paneId);
    this.panesWithLiveCwd.delete(paneId);
  }

  /** Set the cwd of a pane (e.g. on `pty-cwd` events). */
  updatePaneCwd(paneId: string, cwd: string): void {
    if (!paneId || !isNativeAbsoluteFsPath(cwd)) return;
    this.panesWithLiveCwd.add(paneId);
    this.cwdTracker.updatePaneCwd(paneId, cwd.trim());
    this.lastLiveCwdSignalAt = Date.now();
  }

  private handleCwdChange(paneId: string, cwd: string | null): void {
    if (paneId === this.cwdTracker.getFocusedPaneId() && cwd) {
      void this.updateFileTreeRoot(cwd);
    }
  }

  private async updateFileTreeRoot(cwd: string): Promise<void> {
    if (!isNativeAbsoluteFsPath(cwd)) {
      this.options.onFileTreeRootChange?.(null);
      return;
    }
    const currentRoot = this.fileTreeBackend.getRoot();
    const normalizedCwd = normalizeFsPathKey(cwd);
    const normalizedCurrent = normalizeFsPathKey(currentRoot ?? "");

    if (normalizedCwd !== normalizedCurrent) {
      await this.fileTreeBackend.setRoot(cwd);
      this.options.onFileTreeRootChange?.(cwd);
    }
  }

  async syncCwdFromBackend(): Promise<void> {
    const focusedPaneId = this.cwdTracker.getFocusedPaneId();
    if (!focusedPaneId) return;

    const hasLive = this.panesWithLiveCwd.has(focusedPaneId);
    const knownCwd = this.cwdTracker.getPaneCwd(focusedPaneId);
    if (knownCwd && Date.now() - this.lastLiveCwdSignalAt < 1500) return;
    if (hasLive && knownCwd) return;

    try {
      const cwd = await ptyShellCwd(focusedPaneId);
      if (isNativeAbsoluteFsPath(cwd)) {
        this.cwdTracker.updatePaneCwd(focusedPaneId, cwd.trim());
      }
    } catch (e) {
      console.warn("Failed to sync cwd from backend:", e);
    }
  }

  async refresh(): Promise<boolean> {
    const cwd = this.cwdTracker.getFocusedPaneCwd();
    if (!isNativeAbsoluteFsPath(cwd)) {
      if (this.lastRefreshKey) {
        this.lastRefreshKey = "";
        this.options.onFileTreeRootChange?.(null);
      }
      return false;
    }
    const key = normalizeFsPathKey(cwd);
    if (
      key === this.lastRefreshKey &&
      key === normalizeFsPathKey(this.fileTreeBackend.getRoot() ?? "")
    ) {
      return false;
    }
    this.lastRefreshKey = key;
    await this.updateFileTreeRoot(cwd);
    return true;
  }

  dispose(): void {
    this.fileTreeBackend.dispose();
    this.cwdTracker.clear();
    this.panesWithLiveCwd.clear();
  }
}