import { Channel, invoke } from "@tauri-apps/api/core";

/** Tauri deserializes command args with camelCase keys; Rust `pane_id` → `paneId`. */

/**
 * Output channel for a pane.  Raw PTY bytes arrive as `ArrayBuffer` chunks
 * (Tauri `InvokeResponseBody::Raw`); pass a fresh channel on every
 * ensure/resummon so a rebuilt webview re-subscribes.
 */
export type PtyOutputChannel = Channel<ArrayBuffer>;

export function ptyEnsure(
  paneId: string,
  cols: number,
  rows: number,
  initialCwd?: string | null,
  shell?: string | null,
  profileId?: string | null,
  output?: PtyOutputChannel,
): Promise<void> {
  return invoke("pty_ensure", {
    paneId,
    cols,
    rows,
    initialCwd: initialCwd || null,
    shell: shell || null,
    profileId: profileId || null,
    output,
  });
}

export type PtyResizeEntry = {
  paneId: string;
  cols: number;
  rows: number;
};

export function ptyResizeBatch(
  items: ReadonlyArray<PtyResizeEntry>,
): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return invoke("pty_resize_batch", { items });
}

export function ptyResize(
  paneId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return ptyResizeBatch([{ paneId, cols, rows }]);
}

export function ptyWrite(paneId: string, data: string): Promise<void> {
  return invoke("pty_write", { paneId, data });
}

/** Raw replay buffer bytes for a pane (empty `ArrayBuffer` when none). */
export function ptyReplaySnapshot(paneId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("pty_replay_snapshot", { paneId });
}

export function ptyKillPane(paneId: string): Promise<void> {
  return invoke("pty_kill_pane", { paneId });
}

export function ptyAckExit(paneId: string): Promise<void> {
  return invoke("pty_ack_exit", { paneId });
}

export function ptyFocusPane(paneId: string): Promise<void> {
  return invoke("pty_focus_pane", { paneId });
}
