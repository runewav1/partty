/**
 * Connection profiles — spawn identity for panes/tabs (`~/.partty/profiles/*.toml`).
 */

import { invoke } from "@tauri-apps/api/core";

export const LOCAL_DEFAULT_PROFILE_ID = "local-default";

export type ProfileKind = "local" | "wsl" | "ssh";

export type ProfilePaletteAction = "new-tab" | "split-h" | "split-v" | "float";

export type ConnectionProfile = {
  version: number;
  id: string;
  name: string;
  kind: ProfileKind;
  shell?: string | null;
  initialCwd?: string | null;
  wslDistro?: string | null;
  sshHost?: string | null;
  sshUser?: string | null;
  sshPort?: number | null;
  sshIdentityFile?: string | null;
  sshArgs?: string[];
  commandline?: string | null;
  /** After shell ready (local/WSL) or remote command for SSH. */
  startupCommand?: string | null;
  /** Spawn settings from another profile (chainable). */
  base?: string | null;
  /** Overrides global split cwd inheritance for this profile. */
  inheritCwd?: boolean | null;
  icon?: string | null;
  theme?: string | null;
  iconDataUrl?: string | null;
  builtin?: boolean;
};

export type ProfileBehaviorPrefs = {
  default_profile_id: string;
  inherit_profile_on_split: boolean;
  inherit_cwd_on_split: boolean;
  palette_tab_profile_picker: boolean;
  new_tab_uses_default_profile: boolean;
  palette_profile_icons: boolean;
  profile_selection_aliases: Record<string, string>;
};

export const DEFAULT_PROFILE_BEHAVIOR: ProfileBehaviorPrefs = {
  default_profile_id: LOCAL_DEFAULT_PROFILE_ID,
  inherit_profile_on_split: true,
  inherit_cwd_on_split: true,
  palette_tab_profile_picker: true,
  new_tab_uses_default_profile: true,
  palette_profile_icons: true,
  profile_selection_aliases: {},
};

function normalizeKind(v: unknown): ProfileKind {
  return v === "wsl" || v === "ssh" ? v : "local";
}

function readOptionalString(
  o: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    if (typeof o[key] === "string") return o[key] as string;
  }
  return undefined;
}

function readOptionalBool(
  o: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    if (typeof o[key] === "boolean") return o[key] as boolean;
  }
  return undefined;
}

function normalizeProfile(raw: unknown): ConnectionProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  return {
    version:
      typeof o.version === "number"
        ? o.version
        : typeof o.v === "number"
          ? o.v
          : 1,
    id: o.id.trim(),
    name: o.name.trim(),
    kind: normalizeKind(o.kind),
    shell: typeof o.shell === "string" ? o.shell : o.shell === null ? null : undefined,
    initialCwd:
      typeof o.initialCwd === "string"
        ? o.initialCwd
        : o.initialCwd === null
          ? null
          : undefined,
    wslDistro: typeof o.wslDistro === "string" ? o.wslDistro : undefined,
    sshHost: typeof o.sshHost === "string" ? o.sshHost : undefined,
    sshUser: typeof o.sshUser === "string" ? o.sshUser : undefined,
    sshPort: typeof o.sshPort === "number" ? o.sshPort : undefined,
    sshIdentityFile:
      typeof o.sshIdentityFile === "string" ? o.sshIdentityFile : undefined,
    sshArgs: Array.isArray(o.sshArgs)
      ? o.sshArgs.filter((a): a is string => typeof a === "string")
      : undefined,
    commandline: typeof o.commandline === "string" ? o.commandline : undefined,
    startupCommand: readOptionalString(o, "startupCommand", "startup_command"),
    base: readOptionalString(o, "base", "baseProfileId", "base_profile_id"),
    inheritCwd: readOptionalBool(
      o,
      "inheritCwd",
      "inheritCwdOnSplit",
      "inherit_cwd",
      "inherit_cwd_on_split",
    ),
    icon: typeof o.icon === "string" ? o.icon : undefined,
    theme: typeof o.theme === "string" ? o.theme : o.theme === null ? null : undefined,
    iconDataUrl: typeof o.iconDataUrl === "string" ? o.iconDataUrl : undefined,
    builtin: o.builtin === true || o.id === LOCAL_DEFAULT_PROFILE_ID,
  };
}

export async function fetchProfiles(): Promise<ConnectionProfile[]> {
  const raw = await invoke<unknown[]>("list_profiles");
  const profiles = raw
    .map(normalizeProfile)
    .filter((p): p is ConnectionProfile => p != null);
  if (!profiles.some((p) => p.id === LOCAL_DEFAULT_PROFILE_ID)) {
    profiles.unshift({
      version: 1,
      id: LOCAL_DEFAULT_PROFILE_ID,
      name: "Local (default shell)",
      kind: "local",
      shell: null,
      builtin: true,
    });
  }
  return profiles;
}

export function resolveDefaultProfileId(
  preferred: string | undefined | null,
  profiles: readonly ConnectionProfile[],
): string {
  if (preferred && profiles.some((p) => p.id === preferred)) return preferred;
  if (profiles.some((p) => p.id === LOCAL_DEFAULT_PROFILE_ID)) {
    return LOCAL_DEFAULT_PROFILE_ID;
  }
  return profiles[0]?.id ?? LOCAL_DEFAULT_PROFILE_ID;
}

export function getProfileById(
  id: string,
  profiles: readonly ConnectionProfile[],
): ConnectionProfile | null {
  return profiles.find((p) => p.id === id) ?? null;
}

export function resolveEffectiveSpawnProfile(
  profileId: string,
  profiles: readonly ConnectionProfile[],
): ConnectionProfile | null {
  let id = profileId.trim();
  if (!id) return null;
  const seen = new Set<string>();
  let current = getProfileById(id, profiles);
  if (!current) return null;

  for (let i = 0; i < 8; i++) {
    seen.add(id);
    const baseId = current.base?.trim();
    if (!baseId) return current;
    if (seen.has(baseId)) return null;
    const next = getProfileById(baseId, profiles);
    if (!next) return current;
    id = baseId;
    current = next;
  }
  return current;
}

export function profileUsesFrontendStartup(
  profile: ConnectionProfile | null | undefined,
  profiles: readonly ConnectionProfile[],
): boolean {
  if (!profile?.startupCommand?.trim()) return false;
  const spawn = resolveEffectiveSpawnProfile(profile.id, profiles) ?? profile;
  return spawn.kind === "local" || spawn.kind === "wsl";
}

export function resolveProfileShell(
  profile: ConnectionProfile | null | undefined,
  globalShell: string,
  profiles: readonly ConnectionProfile[] = [],
): string | null {
  const spawn =
    profile && profiles.length > 0
      ? resolveEffectiveSpawnProfile(profile.id, profiles) ?? profile
      : profile;
  const override = spawn?.shell?.trim();
  if (override) return override;
  if (spawn?.id === LOCAL_DEFAULT_PROFILE_ID || !spawn?.shell) return null;
  return globalShell.trim() || null;
}

export function profileKindLabel(kind: ProfileKind): string {
  switch (kind) {
    case "local":
      return "Local";
    case "wsl":
      return "WSL";
    case "ssh":
      return "SSH";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function profileActionForPaletteCommandId(
  commandId: string | undefined | null,
): ProfilePaletteAction | null {
  if (!commandId) return null;
  if (commandId === "tab-new") return "new-tab";
  if (commandId === "pane-split-v" || commandId === "pane-profile-split-v")
    return "split-h";
  if (commandId === "pane-split-h" || commandId === "pane-profile-split-h")
    return "split-v";
  if (commandId === "pane-new-floating" || commandId === "pane-profile-float-new")
    return "float";
  return null;
}

export function parseProfilePickerQuery(
  query: string,
): { action: ProfilePaletteAction; filter: string } | null {
  const m = query
    .trimStart()
    .match(/^@profile:(new-tab|split-h|split-v|float)(?:\s+(.*))?$/i);
  if (!m) return null;
  const action = m[1]!.toLowerCase() as ProfilePaletteAction;
  return { action, filter: (m[2] ?? "").trim() };
}

export function isProfilePickerAliasContext(query: string): boolean {
  const parsed = parseProfilePickerQuery(query);
  return parsed != null && parsed.filter.length === 0;
}

export function resolveSelectionAliases(
  aliases: Record<string, string>,
): Record<string, string> {
  const provisional = new Map<string, string>();
  const contested = new Set<string>();
  for (const [rawKey, rawId] of Object.entries(aliases)) {
    const key = rawKey.trim();
    const id = rawId.trim();
    if ([...key].length !== 1 || !id) continue;
    if (contested.has(key)) continue;
    const prev = provisional.get(key);
    if (prev == null) {
      provisional.set(key, id);
    } else if (prev !== id) {
      contested.add(key);
      provisional.delete(key);
    }
  }
  return Object.fromEntries(provisional);
}

export function profileIdAliasMap(
  aliases: Record<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [alias, target] of Object.entries(
    resolveSelectionAliases(aliases),
  )) {
    const id = target.trim();
    if (!id || out.has(id)) continue;
    out.set(id, alias);
  }
  return out;
}
