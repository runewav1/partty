/**
 * OSC 7 / 133 / 633 shell-integration parsing lives in the Rust PTY host
 * (pty.rs), which emits `pty-cwd` / `pty-title` / `pty-shell-event`. This file
 * only retains the frontend state shape for that data.
 */
export type ShellIntegrationState = {
  properties: Map<string, string>;
  parserRemainder: string;
};