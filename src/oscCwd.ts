/**
 * Strip OSC 7 (hyperlink cwd) from PTY bytes when the shell emits it.
 * ConPTY cwd from `pty_shell_cwd` is often stale; OSC 7 (injected for PowerShell) keeps the tree aligned.
 */
const OSC7 = /\x1b\]7;([^\x07\x1b]+)(?:\x1b\\|\x07)/g;
const OSC_CWD_PROPERTY = /\x1b\](?:633|133);P;Cwd=([^\x07\x1b]*)(?:\x1b\\|\x07)/g;

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
    if (u.hostname) {
      p = `\\${u.hostname}${p}`.replace(/\//g, "\\");
      return p || null;
    }
    if (/^\/[a-zA-Z]:/.test(p)) {
      p = p.slice(1).replace(/\//g, "\\");
      return p || null;
    }
    return p || null;
  } catch {
    // URL constructor failed (e.g. unencoded spaces). Try to recover.
    let cleaned = raw;
    try { cleaned = decodeURIComponent(cleaned); } catch { /* raw is fine */ }
    cleaned = cleaned.replace(/^file:\/+(\/+)?/i, "");
    if (/^[a-zA-Z]:[\\/]/.test(cleaned)) return cleaned.replace(/\//g, "\\");
    if (cleaned.startsWith("/")) return cleaned;
    return null;
  }
}

function unescapeOscValue(s: string): string {
  return s
    .replace(/\\x3b/gi, ";")
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\/g, "\\");
}

function normalizeCwdPropertyPath(value: string): string | null {
  const raw = unescapeOscValue(value).trim();
  if (!raw) return null;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return raw.replace(/\//g, "\\");
  if (/^\\\\[^\\]+\\[^\\]+/.test(raw)) return raw.replace(/\//g, "\\");
  if (/^\/[a-zA-Z]:\//.test(raw)) return raw.slice(1).replace(/\//g, "\\");
  const msys = raw.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) return `${msys[1]!.toUpperCase()}:\\${msys[2]!.replace(/\//g, "\\")}`;
  const cyg = raw.match(/^\/cygdrive\/([a-zA-Z])\/(.*)$/);
  if (cyg) return `${cyg[1]!.toUpperCase()}:\\${cyg[2]!.replace(/\//g, "\\")}`;
  const wsl = raw.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wsl) return `${wsl[1]!.toUpperCase()}:\\${wsl[2]!.replace(/\//g, "\\")}`;
  return raw;
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

export function stripOscCwd(
  raw: string,
  onCwd: (path: string) => void,
): string {
  return stripOsc7Cwd(raw, onCwd).replace(OSC_CWD_PROPERTY, (_full, payload: string) => {
    const p = normalizeCwdPropertyPath(payload);
    if (p) onCwd(p);
    return "";
  });
}
