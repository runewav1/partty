import { cwdBasename } from "./workspacePanePath";

export type PaneNameParts = {
  paneId: string;
  profileName: string;
  cwd?: string | null;
  oscTitle?: string | null;
  processLabel?: string | null;
  /** Explicit user tab name only; auto tab titles are omitted from palette sublines. */
  tabName: string;
};

export function cwdLastSegment(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const base = cwdBasename(cwd).trim();
  return base || null;
}

function foldLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[:/\\|_]+/g, " ")
    .replace(/[\s\-–—·]+/g, " ")
    .trim();
}

/** True when `bit` restates `headline` (same tokens, possibly different punctuation). */
export function labelRedundant(bit: string, headline: string): boolean {
  const b = foldLabel(bit);
  const h = foldLabel(headline);
  if (!b) return true;
  if (h === b) return true;
  if (h.includes(b)) return true;
  return false;
}

export function paneHeadline(p: PaneNameParts): string {
  if (p.oscTitle) return p.oscTitle;
  const rest = p.processLabel || cwdLastSegment(p.cwd);
  return rest ? `${p.profileName} - ${rest}` : p.profileName;
}

export function paneSubline(
  p: PaneNameParts,
  headline: string,
  showIndex: boolean,
): string {
  const bits: string[] = [];
  const add = (raw: string | null | undefined): void => {
    if (!raw) return;
    if (labelRedundant(raw, headline)) return;
    if (bits.some((b) => labelRedundant(raw, b) || labelRedundant(b, raw))) return;
    bits.push(raw);
  };
  if (p.oscTitle) {
    add(p.profileName);
    add(cwdLastSegment(p.cwd));
  }
  add(p.tabName);
  if (showIndex) bits.push(p.paneId);
  return bits.join(" · ");
}

/** Group key for palette uniqueness (profile / cwd / process / OSC). */
export function paneCollisionKey(p: PaneNameParts): string {
  return [
    p.oscTitle ?? "",
    p.profileName,
    cwdLastSegment(p.cwd) ?? "",
    p.processLabel ?? "",
  ].join("\0");
}

export function autoTabNameFromPane(p: PaneNameParts): string {
  if (p.oscTitle) return p.oscTitle;
  const cwd = cwdLastSegment(p.cwd);
  return cwd ? `${p.profileName} - ${cwd}` : p.profileName;
}

export function tabDisplayName(
  tab: { name: string; userName?: string | null } | undefined,
  focusedOscTitle: string | undefined,
  tabId: string,
): string {
  if (!tab) return tabId;
  if (tab.userName) {
    return focusedOscTitle ? `${tab.name} - (${focusedOscTitle})` : tab.name;
  }
  return tab.name;
}

export function applyUserTabRename(
  tab: { name: string; userName?: string | null },
  name: string,
): void {
  tab.name = name;
  tab.userName = name;
}

export function procPaletteHeadline(p: PaneNameParts): string {
  const proc = p.processLabel ?? "";
  const cwd = cwdLastSegment(p.cwd);
  const right = cwd ? `${p.profileName}:${cwd}` : p.profileName;
  return proc ? `${proc} - ${right}` : right;
}
