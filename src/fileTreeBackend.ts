/**
 * File tree backend wiring.
 * Handles file system operations and live change tracking via the Rust fs_watcher.
 *
 * Removed in the lean-up:
 *   - git status polling + GitRepoInfo (libgit2 dependency dropped)
 *   - content/file search (fff-search dependency dropped)
 *   - detected-app / editor list with extracted icons (base64/miniz deps dropped)
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isNativeAbsoluteFsPath, normalizeFsPathKey } from "./oscCwd";

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

export type FsDirSummary = {
  entries: number;
  dirs: number;
};

export type FileTreeBackendOptions = {
  onFileSystemChange?: (paths: string[]) => void;
};

/**
 * Backend for file tree operations.
 */
export class FileTreeBackend {
  private readonly options: FileTreeBackendOptions;
  private currentRoot: string | null = null;
  private fsUnlisten: UnlistenFn | null = null;
  private nativeWatchActive = false;

  constructor(options: FileTreeBackendOptions = {}) {
    this.options = options;
  }

  /**
   * Set the current root directory for the file tree.
   * Restarts the native watcher when the root actually changes.
   */
  async setRoot(root: string): Promise<void> {
    if (!isNativeAbsoluteFsPath(root)) {
      await this.stopNativeWatch();
      this.currentRoot = null;
      this.nativeWatchActive = false;
      return;
    }
    const normalizedRoot = normalizeFsPathKey(root);
    const normalizedCurrent = normalizeFsPathKey(this.currentRoot ?? "");
    if (normalizedRoot === normalizedCurrent) return;

    this.currentRoot = root;
    this.nativeWatchActive = false;
    await this.stopNativeWatch();
    await this.startNativeWatch();
  }

  /** True if the watcher is currently attached to `root`. */
  isWatching(): boolean {
    return this.nativeWatchActive;
  }

  getRoot(): string | null {
    return this.currentRoot;
  }

  async readDirectory(path: string): Promise<FsEntry[]> {
    return invoke<FsEntry[]>("read_dir_entries", { path });
  }

  async readDirectorySummary(path: string): Promise<FsDirSummary> {
    return invoke<FsDirSummary>("read_dir_summary", { path });
  }

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

  async remove(path: string, recursive = false): Promise<void> {
    await invoke("fs_remove", { path, recursive });
  }

  async getParentDirectory(path: string): Promise<string | null> {
    return invoke<string | null>("fs_parent_dir", { path });
  }

  private async startNativeWatch(): Promise<void> {
    if (!isNativeAbsoluteFsPath(this.currentRoot) || this.nativeWatchActive) return;
    try {
      await invoke("fs_watch", { path: this.currentRoot });
      this.nativeWatchActive = true;
    } catch (e) {
      console.warn("Failed to start native watch:", e);
      this.nativeWatchActive = false;
    }
    if (!this.fsUnlisten) {
      this.fsUnlisten = await listen<{ paths: string[] }>("fs-changed", (event) => {
        this.options.onFileSystemChange?.(event.payload?.paths ?? []);
      });
    }
  }

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

  dispose(): void {
    void this.stopNativeWatch();
    this.currentRoot = null;
  }
}