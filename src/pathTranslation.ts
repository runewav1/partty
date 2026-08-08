/**
 * Unified shell-agnostic path translation.
 *
 * Any path entering a pane's shell — native OS drops, cross-pane drags,
 * or clipboard paste — must be translated from its origin format (typically
 * an NTFS Windows path) into the format the pane's shell expects. This module
 * is that single layer: style detection from the pane's profile/shell, path
 * translation, and shell-appropriate quoting.
 */

export type PathStyle = "windows" | "msys" | "wsl";

/**
 * Resolve the path style a pane's shell expects from its profile and the
 * resolved shell override: WSL profiles take Linux paths (`/mnt/c/...`),
 * local bash (msys/git-bash) takes `/c/...` style, everything else takes
 * Windows paths as-is.
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

/**
 * Translate a Windows-origin path into the pane shell's path format.
 *
 * Known limitation: Windows drive letters map to `/mnt/<drive>` for WSL —
 * the default `automount.root` from wsl.conf. Distros configured with a
 * custom automount root are not detected here.
 */
export function translatePath(raw: string, style: PathStyle): string {
  if (style === "windows") return raw;
  const fwd = raw.replace(/\\/g, "/");
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
export function isPathLike(text: string): boolean {
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
 * Translate clipboard content for paste into a pane of the given style:
 * path-shaped text (quoted or not) is translated and quoted like a drop;
 * everything else is returned untouched.
 */
export function translatePasteText(text: string, style: PathStyle): string {
  if (!isPathLike(text)) return text;
  return quotePath(
    translatePath(stripMatchingQuotes(text.trim()), style),
    style,
  );
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
