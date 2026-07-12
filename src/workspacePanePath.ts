import type { ConnectionProfile } from "./connectionProfiles";

export function profileSupportsStartupCwd(
  profile: ConnectionProfile | null | undefined,
): boolean {
  if (!profile) return true;
  return profile.kind === "local" || profile.kind === "wsl";
}

function windowsPathToWsl(p: string): string {
  const m = p.trim().match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!m) return p.replace(/\\/g, "/");
  const drive = m[1]!.toLowerCase();
  const rest = m[2]!.replace(/\\/g, "/").replace(/^\/+/, "");
  const joined = rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  return joined.replace(/\/+/g, "/");
}

function wslPathToWindows(p: string): string {
  const raw = p.trim().replace(/\\/g, "/");
  const mnt = raw.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mnt) {
    const drive = mnt[1]!.toUpperCase();
    const rest = mnt[2]!.replace(/\//g, "\\");
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }
  const msys = raw.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) {
    const drive = msys[1]!.toUpperCase();
    const rest = msys[2]!.replace(/\//g, "\\");
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }
  return raw.replace(/\//g, "\\");
}

export function normalizePaneCwdForProfile(
  raw: string,
  profile: ConnectionProfile | null | undefined,
): string {
  const t = raw.trim();
  if (!t) return "";
  if (profile?.kind === "ssh") return "";
  if (profile?.kind === "wsl") {
    if (/^[a-zA-Z]:[\\/]/.test(t) || /^\\\\[^\\]+\\/.test(t)) {
      return windowsPathToWsl(t);
    }
    return t.replace(/\\/g, "/");
  }
  if (t.startsWith("/mnt/") || (t.startsWith("/") && !t.startsWith("//"))) {
    return wslPathToWindows(t);
  }
  return t.replace(/\//g, "\\");
}

export function cwdBasename(cwd: string): string {
  const norm = cwd.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
