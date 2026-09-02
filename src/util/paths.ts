/**
 * File-system path utilities: CWD normalization keys and shell-agnostic
 * path translation.
 *
 * PTY output OSC interpretation (OSC 7 / 133 / 633) is handled by the Rust
 * PTY host (pty.rs), which emits `pty-cwd` / `pty-title` / `pty-shell-event`.
 *
 * Any path pasted into a pane's shell must be translated from its origin
 * format (typically an NTFS Windows path) into the format the pane's shell
 * expects. This module is that single layer: style detection from the pane's
 * profile/shell, path translation, and shell-appropriate quoting.
 */

export type PathStyle = "windows" | "msys" | "wsl" | "posix";

export type PastePathSource = {
  style: PathStyle;
  cwd: string | null;
};

/**
 * Resolve the path style a pane's shell expects from its profile and the
 * resolved shell override. SSH path style is resolved per pane (see
 * `pathStyleForPaneId` in main.ts) from the remote `IsWindows` OSC property.
 */
export function pathStyleForProfile(
  profile: { kind?: unknown; shell?: string | null } | undefined,
  shellOverride: string,
): PathStyle {
  if (profile?.kind === "wsl") return "wsl";
  const shell = shellOverride.trim().replace(/\\/g, "/").toLowerCase();
  return /(^|[\\/])(bash|sh|zsh|ksh|dash)(\.exe)?$/.test(shell) ||
    /git[- ]?bash|msys|cygwin/.test(shell)
    ? "msys"
    : "windows";
}

export function sshPathStyleFromRemote(
  remoteIsWindows: boolean | undefined,
  cwd: string | null | undefined,
): PathStyle {
  if (remoteIsWindows === true) return "windows";
  if (remoteIsWindows === false) return "posix";
  if (cwd && (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("\\\\"))) {
    return "windows";
  }
  return "posix";
}

function inferPathStyle(path: string): PathStyle {
  const fwd = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(fwd) || /^\/\/(?!\/)/.test(fwd)) return "windows";
  if (/^\/mnt\/[a-z]\//.test(fwd)) return "wsl";
  if (/^\/(?!\/)/.test(fwd)) return "posix";
  return "windows";
}

/**
 * Translate a Windows-origin path into the pane shell's path format.
 *
 * Known limitation: Windows drive letters map to `/mnt/<drive>` for WSL —
 * the default `automount.root` from wsl.conf. Distros configured with a
 * custom automount root are not detected here.
 */
function translatePath(raw: string, style: PathStyle): string {
  if (style === "windows") return raw;
  const fwd = raw.replace(/\\/g, "/");
  if (style === "posix") return fwd;
  // \\wsl$\<distro>\... or \\wsl.localhost\<distro>\... — Linux filesystem
  // paths. WSL strips the distro (the target distro's own filesystem); msys
  // keeps the UNC server form, forward-slashed (//wsl$/distro/...).
  const wsl = fwd.match(/^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)\/(.+)$/);
  if (wsl) {
    return style === "wsl" ? `/${wsl[2]}` : fwd;
  }
  // C:\... -> /c/... (msys) or /mnt/c/... (wsl)
  const drv = fwd.match(/^([a-zA-Z]):\/(.*)$/);
  if (drv) {
    const drive = drv[1].toLowerCase();
    return style === "wsl" ? `/mnt/${drive}/${drv[2]}` : `/${drive}/${drv[2]}`;
  }
  // Any other UNC/backslash form: forward-slash it for POSIX shells.
  return fwd;
}

/** Quote a path for insertion into the pane shell's input. */
export function quotePath(path: string, style: PathStyle): string {
  if (style === "windows") {
    return /[\s"&|<>^%]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
  }
  // msys, wsl, posix — shell-style quoting
  return /[\s'"$`\\]/.test(path)
    ? `'${path.replace(/'/g, `'\\''`)}'`
    : path;
}

/**
 * Whether clipboard content looks like a single path (drive letter, UNC, or a
 * leading separator), optionally wrapped in a matching pair of quotes (as
 * Explorer's "Copy as path" does). Anything else — multi-line text, prose,
 * relative fragments without a separator — passes through untranslated.
 */
function isPathLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return false;
  const inner = stripMatchingQuotes(trimmed);
  return (
    /^[a-zA-Z]:[\\/]/.test(inner) || // C:\... or C:/...
    /^(\\\\|\/\/)/.test(inner) || // \\server\share or //wsl$...
    /^[\\/]/.test(inner) // \foo or /foo
  );
}

/** Strip a matching outer quote pair ("C:\foo" -> C:\foo); else unchanged. */
function stripMatchingQuotes(text: string): string {
  const q = text[0];
  if (
    (q === '"' || q === "'") &&
    text.length > 1 &&
    text[text.length - 1] === q
  ) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Extract the WSL distro from a pane cwd (`\\wsl$\Ubuntu\...` /
 * `\\wsl.localhost\Ubuntu\...`); null when the cwd is not a WSL UNC.
 */
function wslDistroFromCwd(cwd: string | null): string | null {
  if (!cwd) return null;
  const m = cwd
    .replace(/\\/g, "/")
    .match(/^\/\/wsl(?:\$|\.localhost)\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Translate clipboard content for paste into a pane of the given style:
 * path-shaped text (quoted or not) is translated and quoted for the target shell;
 * everything else is returned untouched.
 */
export function translatePasteText(
  text: string,
  targetStyle: PathStyle,
  source?: PastePathSource | null,
): string {
  if (!isPathLike(text)) return text;
  const raw = stripMatchingQuotes(text.trim());
  const sourceStyle = source?.style ?? inferPathStyle(raw);
  if (sourceStyle === "posix" || targetStyle === "posix") {
    const posix = raw.replace(/\\/g, "/");
    if (sourceStyle === "posix" && targetStyle === "windows") {
      return quotePath(posix, "windows");
    }
    if (sourceStyle === "windows" && targetStyle === "posix") {
      return quotePath(raw, "posix");
    }
    return quotePath(posix, "posix");
  }
  return quotePath(translatePath(raw, targetStyle), targetStyle);
}

/**
 * Resolve a relative path against a working directory, yielding a Windows-
 * oriented absolute path. Handles `.`/`..` segments and preserves UNC roots.
 */
export function expandRelativePath(rel: string, cwd: string): string {
  const isUnc = cwd.startsWith("\\\\");
  const isPosix = cwd.startsWith("/");
  const sep = isPosix ? "/" : "\\";
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  for (const seg of rel.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const joined = parts.join(sep);
  if (isUnc) return `\\\\${joined}`;
  if (isPosix) return `/${joined}`;
  return joined;
}

/**
 * Translate a path extracted from a pane's buffer into the form a target
 * shell expects, using the source pane's cwd to resolve reverse mappings.
 *
 * The forward direction (Windows → msys/WSL) is `translatePath`. Reverse
 * mappings — needed when the clicked pane is POSIX but the target is Windows-
 * native (or a different POSIX flavor) — infer the WSL distro from a
 * `\\wsl$\<distro>\...` cwd, and only treat a leading `/X/` segment as a msys
 * drive when the source pane is itself Windows-shell based.
 *
 * Known limitation (mirrors `translatePath`): WSL drive-letter paths assume
 * the default `automount.root = /mnt` (`/mnt/c/...` → `C:\...`).
 */
export function translatePathFromSource(
  raw: string,
  style: PathStyle,
  sourceCwd: string | null,
): string {
  const fwd = raw.replace(/\\/g, "/");
  const posixAbs = /^\/(?!\/)/.test(fwd) && !/^[a-zA-Z]:\//.test(fwd);
  const sourceIsPosix =
    !!sourceCwd && sourceCwd.replace(/\\/g, "/").startsWith("/");

  if (style === "posix") {
    if (/^[a-zA-Z]:[\\/]/.test(fwd) || /^(\\\\|\/\/)/.test(fwd)) {
      return translatePath(fwd, "posix");
    }
    return fwd;
  }

  if (style === "windows") {
    if (!posixAbs) return raw;
    // /mnt/c/... → C:\... (default automount root)
    const mnt = fwd.match(/^\/mnt\/([a-z])\/(.+)$/);
    if (mnt) return `${mnt[1].toUpperCase()}:\\${mnt[2].replace(/\//g, "\\")}`;
    // /home/user/... → \\wsl$\<distro>\home\user\...
    const distro = wslDistroFromCwd(sourceCwd);
    if (distro) return `\\\\wsl$\\${distro}${fwd.replace(/\//g, "\\")}`;
    // /c/... → C:\... — msys drive form, only from a Windows-shell pane
    const msys = fwd.match(/^\/([a-zA-Z])\/(.+)$/);
    if (msys && !sourceIsPosix) {
      return `${msys[1].toUpperCase()}:\\${msys[2].replace(/\//g, "\\")}`;
    }
    return raw;
  }

  if (/^[a-zA-Z]:[\\/]/.test(fwd) || /^(\\\\|\/\/)/.test(fwd)) {
    return translatePath(fwd, style);
  }

  // POSIX-form raw: msys → //wsl$/<distro>/... when the source is WSL.
  if (style === "msys") {
    const distro = wslDistroFromCwd(sourceCwd);
    return distro ? `//wsl$/${distro}${fwd}` : fwd;
  }

  // WSL target: /c/... → /mnt/c/... (msys drive form from a Windows shell).
  const msys = fwd.match(/^\/([a-zA-Z])\/(.+)$/);
  if (msys && !sourceIsPosix) {
    return `/mnt/${msys[1].toLowerCase()}/${msys[2]}`;
  }
  return fwd;
}

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