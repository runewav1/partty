import { invoke } from "@tauri-apps/api/core";

/** Tauri deserializes command args with camelCase keys; Rust `pane_id` → `paneId`. */

export function ptyEnsure(paneId: string, cols: number, rows: number, initialCwd?: string | null): Promise<void> {
  return invoke("pty_ensure", { paneId, cols, rows, initialCwd: initialCwd || null });
}

export function ptyResize(paneId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { paneId, cols, rows });
}

export function ptyWrite(paneId: string, data: string): Promise<void> {
  return invoke("pty_write", { paneId, data });
}

export function ptyReplaySnapshot(paneId: string): Promise<string | null> {
  return invoke<string | null>("pty_replay_snapshot", { paneId });
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

export function ptyShellCwd(paneId: string | null): Promise<string | null> {
  return invoke("pty_shell_cwd", { paneId });
}

/** Foreground shell exe token (e.g. pwsh, bash) for palette `>` commands. */
export function ptyShellExeToken(paneId: string): Promise<string | null> {
  return invoke<string | null>("pty_shell_exe_token", { paneId });
}

