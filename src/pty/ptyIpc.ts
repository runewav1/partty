import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Tauri deserializes command args with camelCase keys; Rust `session_id` → `sessionId`.
 *
 * All PTY commands are keyed by the terminal's stable internal `sessionId`
 * (never the positional pane id), so the session→process association is
 * deterministic across pane moves, tab re-keys, and layout changes.
 */

/**
 * Output channel for a session. Raw PTY bytes arrive as `ArrayBuffer` chunks
 * (Tauri `InvokeResponseBody::Raw`); pass a fresh channel on every
 * ensure/resummon so a rebuilt webview re-subscribes.
 */
export type PtyOutputChannel = Channel<ArrayBuffer>;

export function ptyEnsure(
  sessionId: string,
  cols: number,
  rows: number,
  initialCwd?: string | null,
  shell?: string | null,
  profileId?: string | null,
  startupCommand?: string | null,
  output?: PtyOutputChannel,
): Promise<void> {
  return invoke("pty_ensure", {
    sessionId,
    cols,
    rows,
    initialCwd: initialCwd || null,
    shell: shell || null,
    profileId: profileId || null,
    startupCommand: startupCommand || null,
    output,
  });
}

export type PtyResizeEntry = {
  sessionId: string;
  cols: number;
  rows: number;
};

export function ptyResizeBatch(
  items: ReadonlyArray<PtyResizeEntry>,
): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return invoke("pty_resize_batch", { items });
}

export function ptyWrite(sessionId: string, data: string): Promise<void> {
  return invoke("pty_write", { sessionId, data });
}

/** Raw replay buffer bytes for a session (empty `ArrayBuffer` when none). */
export function ptyReplaySnapshot(sessionId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("pty_replay_snapshot", { sessionId });
}

export function ptyKillPane(sessionId: string): Promise<void> {
  return invoke("pty_kill_pane", { sessionId });
}

export function ptyAckExit(sessionId: string): Promise<void> {
  return invoke("pty_ack_exit", { sessionId });
}

export function ptyFocusPane(sessionId: string): Promise<void> {
  return invoke("pty_focus_pane", { sessionId });
}