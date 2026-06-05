/**
 * Per-pane current working directory tracking system.
 * Tracks cwd per pane, handles focus changes, and provides cwd change notifications.
 */

import { normalizeFsPathKey } from "./oscCwd";

export type PaneCwdState = {
  paneId: string;
  cwd: string | null;
  lastUpdated: number;
};

export type CwdChangeCallback = (paneId: string, cwd: string | null) => void;

export class CwdTracker {
  private readonly paneStates = new Map<string, PaneCwdState>();
  private readonly callbacks = new Set<CwdChangeCallback>();
  private focusedPaneId: string | null = null;

  constructor() {}

  /**
   * Register a callback for cwd changes.
   */
  onCwdChange(callback: CwdChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Set the currently focused pane.
   */
  setFocusedPane(paneId: string): void {
    this.focusedPaneId = paneId;

    // When focus changes, emit the cwd of the newly focused pane
    const state = this.paneStates.get(paneId);
    if (state?.cwd) {
      this.notifyCallbacks(paneId, state.cwd);
    }
  }

  /**
   * Update cwd for a specific pane.
   * Returns true if the cwd actually changed.
   */
  updatePaneCwd(paneId: string, cwd: string | null): boolean {
    const normalizedCwd = cwd?.trim() || null;
    const state = this.paneStates.get(paneId);

    if (!state) {
      this.paneStates.set(paneId, {
        paneId,
        cwd: normalizedCwd,
        lastUpdated: Date.now(),
      });
      if (normalizedCwd) {
        this.notifyCallbacks(paneId, normalizedCwd);
      }
      return true;
    }

    const prevKey = normalizeFsPathKey(state.cwd ?? "");
    const newKey = normalizeFsPathKey(normalizedCwd ?? "");

    if (prevKey !== newKey) {
      state.cwd = normalizedCwd;
      state.lastUpdated = Date.now();
      if (normalizedCwd) {
        this.notifyCallbacks(paneId, normalizedCwd);
      }
      return true;
    }

    return false;
  }

  /**
   * Get the cwd for a specific pane.
   */
  getPaneCwd(paneId: string): string | null {
    return this.paneStates.get(paneId)?.cwd ?? null;
  }

  /**
   * Get the cwd for the currently focused pane.
   */
  getFocusedPaneCwd(): string | null {
    if (!this.focusedPaneId) return null;
    return this.getPaneCwd(this.focusedPaneId);
  }

  /**
   * Get the currently focused pane ID.
   */
  getFocusedPaneId(): string | null {
    return this.focusedPaneId;
  }

  /**
   * Remove state for a pane (when pane is disposed).
   */
  removePane(paneId: string): void {
    this.paneStates.delete(paneId);
    if (this.focusedPaneId === paneId) {
      this.focusedPaneId = null;
    }
  }

  /**
   * Clear all state.
   */
  clear(): void {
    this.paneStates.clear();
    this.focusedPaneId = null;
  }

  private notifyCallbacks(paneId: string, cwd: string | null): void {
    for (const callback of this.callbacks) {
      try {
        callback(paneId, cwd);
      } catch (e) {
        console.error("CwdTracker callback error:", e);
      }
    }
  }
}
