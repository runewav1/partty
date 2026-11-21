function cwdBasename(cwd: string): string {
	const norm = cwd.replace(/\\/g, "/");
	const parts = norm.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? cwd;
}

export type PaneNameParts = {
	paneId: string;
	profileName: string;
	cwd?: string | null;
	oscTitle?: string | null;
	processLabel?: string | null;
};

export function cwdLastSegment(cwd: string | null | undefined): string | null {
	if (!cwd) return null;
	const base = cwdBasename(cwd).trim();
	return base || null;
}

export function paneHeadline(p: PaneNameParts): string {
	if (p.oscTitle) return p.oscTitle;
	const rest = p.processLabel || cwdLastSegment(p.cwd);
	return rest ? `${p.profileName} - ${rest}` : p.profileName;
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
