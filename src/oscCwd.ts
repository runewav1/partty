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
