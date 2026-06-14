/**
 * File-system path utilities.
 *
 * PTY output OSC interpretation is now handled exclusively by
 * `shellIntegration.ts` (processShellIntegration) which handles
 * OSC 7 (CWD), OSC 633, and OSC 133 in a single character pass.
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

function isWindowsHost(): boolean {
  return /\bWindows\b/i.test(navigator.userAgent) || /^Win/i.test(navigator.platform);
}

/**
 * True only for paths the native Tauri filesystem backend can open directly.
 * This intentionally rejects WSL/POSIX cwd values on Windows so the file panel
 * does not call Rust commands with paths that Rust will reject as non-absolute.
 */
export function isNativeAbsoluteFsPath(path: string | null | undefined): path is string {
  const p = path?.trim();
  if (!p) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (/^\\\\[^\\]+\\[^\\]+/.test(p)) return true;
  if (/^\/\/[^/]+\/[^/]+/.test(p)) return true;
  if (isWindowsHost()) return false;
  return p.startsWith("/");
}

