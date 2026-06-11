/**
 * File tree coordinator - integrates cwd tracking, OSC handling, and file tree backend.
 * This is the main entry point for file tree functionality.
 */

import { CwdTracker } from "./cwdTracker";
import { OscHandler } from "./oscHandler";
import { FileTreeBackend, type GitPathStatus, type GitRepoInfo } from "./fileTreeBackend";
import type { ShellIntegrationEvent } from "./shellIntegration";
import { ptyShellCwd } from "./ptyIpc";
import { isNativeAbsoluteFsPath, normalizeFsPathKey } from "./oscCwd";

export type FileTreeCoordinatorOptions = {
  onFileTreeRootChange?: (root: string | null) => void;
  onGitStatusChange?: (statuses: Map<string, GitPathStatus>) => void;
  onGitRepoInfoChange?: (repoInfo: GitRepoInfo | null) => void;
  onFileSystemChange?: (paths: string[]) => void;
  showDiffCounts?: boolean;
};

/**
 * Coordinator for all file tree related functionality.
 */
export class FileTreeCoordinator {
  private readonly cwdTracker: CwdTracker;
  private readonly oscHandler: OscHandler;
  private readonly fileTreeBackend: FileTreeBackend;
  private readonly options: FileTreeCoordinatorOptions;

  private readonly paneShellStates = new Map<string, any>(); // ShellIntegrationState
  private readonly panesWithLiveCwd = new Set<string>();
  private refreshTimer: number | null = null;
  private lastLiveCwdSignalAt = 0;
  private lastRefreshKey = "";

  constructor(options: FileTreeCoordinatorOptions = {}) {
    this.options = options;

    // Initialize components
    this.cwdTracker = new CwdTracker();
    this.oscHandler = new OscHandler((paneId, cwd) => {
      this.handleOscCwd(paneId, cwd);
    });

    this.fileTreeBackend = new FileTreeBackend({
      onGitStatusChange: (statuses) => {
        this.options.onGitStatusChange?.(statuses);
      },
      onGitRepoInfoChange: (repoInfo) => {
        this.options.onGitRepoInfoChange?.(repoInfo);
      },
      onFileSystemChange: (paths) => {
        this.options.onFileSystemChange?.(paths);
      },
    });

    // Wire up cwd change callback to update file tree root
    this.cwdTracker.onCwdChange((paneId, cwd) => {
      this.handleCwdChange(paneId, cwd);
    });

    // Native FS events (notify watcher) drive all updates — no polling.
  }

  /**
   * Get the cwd tracker instance.
   */
  getCwdTracker(): CwdTracker {
    return this.cwdTracker;
  }

  /**
   * Get the file tree backend instance.
   */
  getFileTreeBackend(): FileTreeBackend {
    return this.fileTreeBackend;
  }

  /**
   * Handle pane focus change.
   */
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

  /**
   * Handle pane disposal.
   */
  handlePaneDispose(paneId: string): void {
    this.cwdTracker.removePane(paneId);
    this.paneShellStates.delete(paneId);
    this.panesWithLiveCwd.delete(paneId);
  }

  /**
   * Process raw terminal output for OSC 7 sequences (before shell integration strips them).
   */
  processRawTerminalOutput(
    paneId: string,
    data: string,
  ): { cleaned: string; cwdDetected: boolean } {
    // Process OSC 7 sequences
    const osc7Result = this.oscHandler.processOsc7(data, paneId);
    return { cleaned: osc7Result.cleaned, cwdDetected: osc7Result.cwd !== null };
  }

  /**
   * Process terminal output for OSC sequences and cwd hints.
   */
  processTerminalOutput(
    paneId: string,
    data: string,
    shellState: any, // ShellIntegrationState
  ): { cleaned: string; cwdDetected: boolean } {
    // Store shell state for later use
    this.paneShellStates.set(paneId, shellState);

    // Process OSC 7 sequences
    const osc7Result = this.oscHandler.processOsc7(data, paneId);
    return { cleaned: osc7Result.cleaned, cwdDetected: osc7Result.cwd !== null };
  }

  /**
   * Process shell integration events for cwd changes.
   */
  processShellIntegrationEvents(
    paneId: string,
    events: ShellIntegrationEvent[],
  ): void {
    const cwdEvents = this.oscHandler.processShellIntegrationEvents(events, paneId);
    for (const event of cwdEvents) {
      this.cwdTracker.updatePaneCwd(paneId, event.cwd);
    }
  }

  /**
   * Handle cwd detected from OSC sequences.
   */
  private handleOscCwd(paneId: string, cwd: string): void {
    this.panesWithLiveCwd.add(paneId);
    this.cwdTracker.updatePaneCwd(paneId, cwd);
    this.lastLiveCwdSignalAt = Date.now();
  }

  /**
   * Handle cwd change from cwd tracker.
   */
  private handleCwdChange(paneId: string, cwd: string | null): void {
    // If this is the focused pane, update the file tree root
    if (paneId === this.cwdTracker.getFocusedPaneId() && cwd) {
      this.updateFileTreeRoot(cwd);
    }
  }

  /**
   * Update the file tree root directory.
   */
  private async updateFileTreeRoot(cwd: string): Promise<void> {
    if (!isNativeAbsoluteFsPath(cwd)) {
      this.options.onFileTreeRootChange?.(null);
      return;
    }
    const currentRoot = this.fileTreeBackend.getRoot();
    const normalizedCwd = normalizePathKey(cwd);
    const normalizedCurrent = normalizePathKey(currentRoot ?? "");

    if (normalizedCwd !== normalizedCurrent) {
      await this.fileTreeBackend.setRoot(cwd);
      this.options.onFileTreeRootChange?.(cwd);
    }
  }

  /**
   * Sync cwd from backend (fallback when OSC sequences aren't available).
   */
  async syncCwdFromBackend(): Promise<void> {
    const focusedPaneId = this.cwdTracker.getFocusedPaneId();
    if (!focusedPaneId) return;

    const hasLive = this.panesWithLiveCwd.has(focusedPaneId);
    const knownCwd = this.cwdTracker.getPaneCwd(focusedPaneId);
    // Don't sync if we recently got a live signal for a pane that is already seeded.
    if (knownCwd && Date.now() - this.lastLiveCwdSignalAt < 1500) {
      return;
    }
    if (hasLive && knownCwd) {
      return;
    }

    try {
      const cwd = await ptyShellCwd(focusedPaneId);
      if (isNativeAbsoluteFsPath(cwd)) {
        this.cwdTracker.updatePaneCwd(focusedPaneId, cwd.trim());
      }
    } catch (e) {
      console.warn("Failed to sync cwd from backend:", e);
    }
  }

  /**
   * Force a refresh of the file tree.
   */
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
    if (key === this.lastRefreshKey && key === normalizeFsPathKey(this.fileTreeBackend.getRoot() ?? "")) {
      return false;
    }
    this.lastRefreshKey = key;
    await this.updateFileTreeRoot(cwd);
    return true;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.fileTreeBackend.dispose();
    this.cwdTracker.clear();
    this.paneShellStates.clear();
  }
}

/**
 * Normalize path key for comparison (case-insensitive, normalize separators).
 */
function normalizePathKey(p: string): string {
  return normalizeFsPathKey(p);
}
