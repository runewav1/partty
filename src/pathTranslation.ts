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

/** Translate a Windows-origin path into the pane shell's path format. */
export function translatePath(raw: string, style: PathStyle): string {
  if (style === "windows") return raw;
  const fwd = raw.replace(/\\/g, "/");
  if (style === "wsl") {
    // \\wsl$\<distro>\home\user\file -> /home/user/file
    const wsl = fwd.match(/^\/\/wsl\$\/([^/]+)\/(.+)$/);
    if (wsl) return "/" + wsl[2];
  }
  // C:\... -> /c/... (msys) or /mnt/c/... (wsl)
  const drv = fwd.match(/^([a-zA-Z]):\/(.*)$/);
  if (drv) {
    const drive = drv[1].toLowerCase();
    return style === "wsl" ? `/mnt/${drive}/${drv[2]}` : `/${drive}/${drv[2]}`;
  }
  return raw;
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
