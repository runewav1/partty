/**
 * Strip OSC 7 (hyperlink cwd) from PTY bytes when the shell emits it.
 * ConPTY cwd from `pty_shell_cwd` is often stale; OSC 7 (injected for PowerShell) keeps the tree aligned.
 */
const OSC7 = /\x1b\]7;([^\x07\x1b]+)(?:\x1b\\|\x07)/g;

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

function uriToLocalPath(payload: string): string | null {
  const raw = payload.trim();
  if (!raw) return null;
  try {
    const href = raw.includes("://") ? raw : `file:///${raw.replace(/^\/+/, "")}`;
    const u = new URL(href);
    if (u.protocol !== "file:") return null;
    let p = decodeURIComponent(u.pathname);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    p = p.replace(/\//g, "\\");
    return p || null;
  } catch {
    if (/^[a-zA-Z]:[\\/]/.test(raw)) return raw.replace(/\//g, "\\");
    return null;
  }
}

export function stripOsc7Cwd(
  raw: string,
  onCwd: (path: string) => void,
): string {
  return raw.replace(OSC7, (_full, payload: string) => {
    const p = uriToLocalPath(payload);
    if (p) onCwd(p);
    return "";
  });
}
