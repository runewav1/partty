import {
	type ConnectionProfile,
	getProfileById,
	LOCAL_DEFAULT_PROFILE_ID,
	resolveDefaultProfileId,
} from "./../pty/connectionProfiles";
import { collectLeafIds } from "./../terminal/paneHost";
import { mapLayoutToTabKey } from "./../terminal/paneIds";
import type { PersistedPaneLayout } from "./../terminal/paneLayout";
import {
	normalizePaneThemePrefs,
	type PaneThemePrefs,
} from "./../terminal/uiTheme";
import type { WorkspaceLayout } from "./workspaces";

/** Runtime per-pane maps that a workspace layout seeds on load. */
export type PaneRuntimeMaps = {
	paneThemes: Map<string, PaneThemePrefs>;
	paneProfileIds: Map<string, string>;
	paneCwdHints: Map<string, string>;
};

/**
 * Convert a workspace layout into a runtime tab layout, remapping the file-local
 * pane ids to `{tabKey}{slot}` ids. Per-pane theme/profile/cwd maps follow the
 * same remap, so they stay attached to the right pane after load.
 */
export function remapWorkspaceLayoutForTab(
	layout: WorkspaceLayout,
	tabKey: string,
	followSlots: Set<string> = new Set(),
): { layout: PersistedPaneLayout; idMap: Map<string, string> } {
	const persisted: PersistedPaneLayout = {
		v: 1,
		tree: layout.tree,
		focusedId: layout.focusedId,
		floating: layout.floating,
		paneThemes: layout.paneThemes,
		paneCwds: layout.paneCwds,
		paneProfileIds: layout.paneProfileIds,
	};
	return mapLayoutToTabKey(persisted, tabKey, followSlots);
}

export type SeedPaneMapsOptions = {
	/** Seed per-pane working directories. Regular tab restore gates this on session retention. */
	seedCwds: boolean;
	/** When a pane has no explicit `paneCwds` entry, fall back to profile then global `initial_cwd`. */
	resolveCwdFallbacks?: boolean;
	profiles?: readonly ConnectionProfile[];
	defaultProfileId?: string;
	globalInitialCwd?: string | null;
};

/**
 * Seed the runtime pane maps from a layout. Idempotent: later layouts overwrite
 * earlier entries. Explicit `paneProfileIds` are stored raw and validated once
 * the profile list is loaded (see `assignPaneProfileId`).
 */
export function seedPaneMapsFromLayout(
	layout: PersistedPaneLayout,
	maps: PaneRuntimeMaps,
	opts: SeedPaneMapsOptions,
): void {
	for (const [paneId, theme] of Object.entries(layout.paneThemes ?? {})) {
		maps.paneThemes.set(paneId, normalizePaneThemePrefs(theme));
	}
	for (const [paneId, profileId] of Object.entries(
		layout.paneProfileIds ?? {},
	)) {
		maps.paneProfileIds.set(paneId, profileId);
	}
	if (!opts.seedCwds) return;

	if (!opts.resolveCwdFallbacks) {
		for (const [paneId, cwd] of Object.entries(layout.paneCwds ?? {})) {
			maps.paneCwdHints.set(paneId, cwd);
		}
		return;
	}

	const profiles = opts.profiles ?? [];
	const defaultProfileId = opts.defaultProfileId ?? LOCAL_DEFAULT_PROFILE_ID;
	const globalCwd = opts.globalInitialCwd?.trim() || null;
	const ids: string[] = [];
	collectLeafIds(layout.tree, ids);
	for (const paneId of ids) {
		const cwd = resolvePaneStartupCwd(
			paneId,
			layout.paneCwds ?? {},
			maps.paneProfileIds,
			profiles,
			defaultProfileId,
			globalCwd,
		);
		if (cwd) maps.paneCwdHints.set(paneId, cwd);
	}
}

/**
 * Starting directory for a workspace pane: explicit `paneCwds` entry, else the
 * selected profile's `initialCwd`, else the global `initial_cwd` preference.
 */
function resolvePaneStartupCwd(
	paneId: string,
	paneCwds: Record<string, string>,
	paneProfileIds: ReadonlyMap<string, string>,
	profiles: readonly ConnectionProfile[],
	defaultProfileId: string,
	globalInitialCwd: string | null,
): string | null {
	const explicit = paneCwds[paneId]?.trim();
	if (explicit) return explicit;
	const preferred = paneProfileIds.get(paneId) ?? defaultProfileId;
	const profile = getProfileById(
		resolveDefaultProfileId(preferred, profiles),
		profiles,
	);
	const fromProfile = profile?.initialCwd?.trim();
	if (fromProfile) return fromProfile;
	const global = globalInitialCwd?.trim();
	return global || null;
}

/**
 * Queue spawn-time startup commands for workspace panes. `startup` keys are
 * file-local pane ids; `idMap` maps them to runtime ids. Commands land in
 * `pendingStartup` and are consumed once when the pane's PTY is ensured, so the
 * shell starts directly at the command instead of having it typed in after
 * startup (same mechanism as the `[editor]` split).
 */
export function queueWorkspaceStartupCommands(
	startup: Record<string, string> | undefined,
	idMap: Map<string, string>,
	pendingStartup: Map<string, string>,
): void {
	if (!startup) return;
	for (const [savedId, cmd] of Object.entries(startup)) {
		const paneId = idMap.get(savedId);
		const trimmed = cmd.trim();
		if (paneId && trimmed) pendingStartup.set(paneId, trimmed);
	}
}
