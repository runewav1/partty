/**
 * File tree backend wiring.
 * Handles file system operations, git status polling, and live change tracking.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isNativeAbsoluteFsPath, normalizeFsPathKey } from "./oscCwd";

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  gitStatus?: string | null;
  iconKey?: string | null;
};

export type GitPathStatus = {
  path: string;
  status: string;
  added: number;
  removed: number;
};

export type GitRepoInfo = {
  root: string;
  name: string;
  totalFiles: number;
  changedFiles: number;
  addedLines: number;
  removedLines: number;
  remoteUrl?: string | null;
};

export type FsDirSummary = {
  entries: number;
  dirs: number;
};

export type DetectedApp = {
  name: string;
  command: string;
  app_type: string;
  icon_data?: string | null; // Base64 encoded icon data
  icon_mime?: string | null;
};

export type FileTreeBackendOptions = {
  onGitStatusChange?: (statuses: Map<string, GitPathStatus>) => void;
  onGitRepoInfoChange?: (repoInfo: GitRepoInfo | null) => void;
  onFileSystemChange?: (paths: string[]) => void;
};

/**
 * Backend for file tree operations.
 */
export class FileTreeBackend {
  private readonly options: FileTreeBackendOptions;
  private readonly gitStatusMap = new Map<string, GitPathStatus>();
  private currentRoot: string | null = null;
  private gitPollTimer: number | null = null;
  private fsUnlisten: UnlistenFn | null = null;
  private nativeWatchActive = false;
  private lastGitHash = "";
  private isPolling = false;
  private repoInfo: GitRepoInfo | null = null;

  constructor(options: FileTreeBackendOptions = {}) {
    this.options = options;
  }

  private async refreshRepoInfo(): Promise<void> {
    if (!this.currentRoot) {
      this.repoInfo = null;
      this.options.onGitRepoInfoChange?.(null);
      return;
    }
    try {
      const info = await invoke<GitRepoInfo | null>("git_repo_info", { cwd: this.currentRoot });
      const prev = JSON.stringify(this.repoInfo);
      const next = JSON.stringify(info);
      this.repoInfo = info;
      if (prev !== next) {
        this.options.onGitRepoInfoChange?.(this.getGitRepoInfo());
      }
    } catch (e) {
      this.repoInfo = null;
      this.options.onGitRepoInfoChange?.(null);
      console.warn("Git repo info fetch failed:", e);
    }
  }

  /**
   * Set the git status change callback.
   */
  set onGitStatusChange(callback: ((statuses: Map<string, GitPathStatus>) => void) | undefined) {
    this.options.onGitStatusChange = callback;
  }

  set onGitRepoInfoChange(callback: ((repoInfo: GitRepoInfo | null) => void) | undefined) {
    this.options.onGitRepoInfoChange = callback;
  }

  /**
   * Set the current root directory for the file tree.
   * Clears cached state and starts fresh polling for the new root.
   */
  async setRoot(root: string): Promise<void> {
    if (!isNativeAbsoluteFsPath(root)) {
      await this.stopNativeWatch();
      this.currentRoot = null;
      this.gitStatusMap.clear();
      this.lastGitHash = "";
      this.nativeWatchActive = false;
      this.repoInfo = null;
      this.options.onGitStatusChange?.(this.getAllGitStatuses());
      this.options.onGitRepoInfoChange?.(null);
      return;
    }
    const normalizedRoot = normalizeFsPathKey(root);
    const normalizedCurrent = normalizeFsPathKey(this.currentRoot ?? "");

    if (normalizedRoot === normalizedCurrent) {
      return;
    }

    this.currentRoot = root;
    this.gitStatusMap.clear();
    this.lastGitHash = "";
    this.nativeWatchActive = false;
    this.repoInfo = null;

    await this.stopNativeWatch();
    await this.startNativeWatch();
    await this.refreshRepoInfo();
    await this.pollGitStatus();
  }

  /**
   * Get the current root directory.
   */
  getRoot(): string | null {
    return this.currentRoot;
  }

  /**
   * Read directory entries for a path.
   */
  async readDirectory(path: string): Promise<FsEntry[]> {
    return invoke<FsEntry[]>("read_dir_entries", { path });
  }

  async readDirectorySummary(path: string): Promise<FsDirSummary> {
    return invoke<FsDirSummary>("read_dir_summary", { path });
  }

  /**
   * Detect installed editors and terminals on the system.
   */
  async detectInstalledApps(): Promise<DetectedApp[]> {
    return invoke<DetectedApp[]>("detect_installed_apps");
  }

  /**
   * Get git status for a specific path.
   */
  getGitStatus(path: string): GitPathStatus | undefined {
    return this.gitStatusMap.get(normalizeFsPathKey(path));
  }

  /**
   * Get all git statuses.
   */
  getAllGitStatuses(): Map<string, GitPathStatus> {
    return new Map(this.gitStatusMap);
  }

  getGitRepoInfo(): GitRepoInfo | null {
    return this.repoInfo ? { ...this.repoInfo } : null;
  }

  /**
   * Start polling for git status changes.
   */
  startGitPolling(intervalMs: number = 8000): void {
    this.stopGitPolling();
    const delay = Math.max(5000, intervalMs);
    this.gitPollTimer = window.setInterval(() => {
      void this.pollGitStatus();
    }, delay);
  }

  /**
   * Stop polling for git status changes.
   */
  stopGitPolling(): void {
    if (this.gitPollTimer) {
      window.clearInterval(this.gitPollTimer);
      this.gitPollTimer = null;
    }
  }

  /**
   * Poll for git status changes.
   */
  private async pollGitStatus(): Promise<void> {
    if (this.isPolling || !isNativeAbsoluteFsPath(this.currentRoot)) {
      return;
    }

    this.isPolling = true;

    try {
      const rows = await invoke<GitPathStatus[]>("git_workdir_status", {
        cwd: this.currentRoot,
      });
      rows.sort((a, b) => normalizeFsPathKey(a.path).localeCompare(normalizeFsPathKey(b.path)));

      // Calculate hash to detect changes
      const hash = rows
        .map((r) => `${r.path}:${r.status}:${r.added}:${r.removed}`)
        .join("\n");

      if (hash !== this.lastGitHash) {
        this.lastGitHash = hash;
        this.gitStatusMap.clear();

        for (const row of rows) {
          this.gitStatusMap.set(normalizeFsPathKey(row.path), row);
        }

        this.options.onGitStatusChange?.(this.getAllGitStatuses());
        await this.refreshRepoInfo();
      } else if (!this.repoInfo) {
        await this.refreshRepoInfo();
      }
    } catch (e) {
      // Git not available or other error
      console.warn("Git status poll failed:", e);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Start native file system watcher.
   */
  private async startNativeWatch(): Promise<void> {
    if (!isNativeAbsoluteFsPath(this.currentRoot) || this.nativeWatchActive) {
      return;
    }

    try {
      await invoke("fs_watch", { path: this.currentRoot });
      this.nativeWatchActive = true;
    } catch (e) {
      console.warn("Failed to start native watch:", e);
      this.nativeWatchActive = false;
    }

    if (!this.fsUnlisten) {
      this.fsUnlisten = await listen<{ paths: string[] }>("fs-changed", (event) => {
        void this.pollGitStatus();
        const changed = event.payload?.paths ?? [];
        this.options.onFileSystemChange?.(changed);
      });
    }
  }

  /**
   * Stop native file system watcher.
   */
  private async stopNativeWatch(): Promise<void> {
    if (this.nativeWatchActive) {
      try {
        await invoke("fs_unwatch");
      } catch (e) {
        console.warn("Failed to stop native watch:", e);
      }
      this.nativeWatchActive = false;
    }

    if (this.fsUnlisten) {
      this.fsUnlisten();
      this.fsUnlisten = null;
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.stopGitPolling();
    void this.stopNativeWatch();
    this.gitStatusMap.clear();
    this.currentRoot = null;
    this.lastGitHash = "";
    this.repoInfo = null;
  }

  /**
   * File system operations.
   */
  async createFile(path: string): Promise<void> {
    await invoke("fs_create_file", { path });
  }

  async createDirectory(path: string): Promise<void> {
    await invoke("fs_create_dir", { path });
  }

  async rename(from: string, to: string): Promise<void> {
    await invoke("fs_rename", { from, to });
  }

  async move(from: string, to: string): Promise<void> {
    await invoke("fs_move_path", { from, to });
  }

  async remove(path: string, recursive: boolean = false): Promise<void> {
    await invoke("fs_remove", { path, recursive });
  }

  async getParentDirectory(path: string): Promise<string | null> {
    return invoke<string | null>("fs_parent_dir", { path });
  }
}
