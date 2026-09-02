/**
 * File-system path utilities for CWD normalization.
 *
 * PTY output OSC interpretation (OSC 7 / 133 / 633) is handled by the Rust
 * PTY host (pty.rs), which emits `pty-cwd` / `pty-title` / `pty-shell-event`.
 */

/** Stable comparison for Windows paths (separators, casing, trailing slashes). */
export function normalizeFsPathKey(p: string): string {
  return p
    .trim()
    .replace(/^\\\\\?\\unc\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/^\/\/?\?\//i, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}
