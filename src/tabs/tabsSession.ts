import {
	collectLeafIds,
	type PaneHostInit,
	type PaneNode,
} from "./../terminal/paneHost";
import {
	emptyTabLayout,
	mapLayoutToTabKey,
	tabRootPaneId,
} from "./../terminal/paneIds";
import {
	loadPaneLayout,
	type PersistedPaneLayout,
} from "./../terminal/paneLayout";
import { TABS_STATE_KEY, tabLayoutKey } from "./../util/storageKeys";

export function duplicateTabLayout(
	layout: PersistedPaneLayout,
	tabKey: string,
	followSlots: Set<string>,
): PersistedPaneLayout {
	return mapLayoutToTabKey(
		{ ...layout, paneSessionIds: undefined },
		tabKey,
		followSlots,
	).layout;
}

export type TabGroup = {
	id: string;
	name: string;
	color: string | null;
	collapsed: boolean;
	order: number;
};

export type TabRecord = {
	id: string;
	name: string;
	userName?: string | null;
	groupId: string | null;
	color: string | null;
	order: number;
};

export type TabsStateV1 = {
	v: 1;
	tabs: TabRecord[];
	activeTabId: string;
	groups: TabGroup[];
};

/** A restored tab whose PaneHost is created lazily on first activation. */
export type DeferredTabInit = {
	init: PaneHostInit;
	rootPaneId: string;
};

/** Seeded per-pane runtime maps that follow a deferred tab's layout ids. */
export type DeferredPaneMaps = {
	paneThemes: Map<string, unknown>;
	paneProfileIds: Map<string, unknown>;
	paneCwdHints: Map<string, unknown>;
};

export type DeferredPaneTeardownOptions = {
	/** A live host owns its panes and kills their sessions through `onPaneDisposed`. */
	hasLiveHost: boolean;
	maps: DeferredPaneMaps;
	killSession: (sessionId: string) => void;
};

/**
 * Consume a deferred tab init for hydration. The returned layout is handed to a
 * new PaneHost, which adopts its session ids; callers must not also run
 * `disposeDeferredTabPanes` for it.
 */
export function takeDeferredTabInit(
	deferred: Map<string, DeferredTabInit>,
	tabId: string,
): DeferredTabInit | undefined {
	const init = deferred.get(tabId);
	if (init) deferred.delete(tabId);
	return init;
}

function paneIdsForDeferredInit(init: PaneHostInit): string[] {
	const paneIds: string[] = [];
	if (init.initialTree) collectLeafIds(init.initialTree, paneIds);
	// Keep session-map keys too: a stale key must not keep seeded metadata alive
	// if the tree and session map ever diverge.
	for (const paneId of Object.keys(init.initialSessionIds ?? {})) {
		if (!paneIds.includes(paneId)) paneIds.push(paneId);
	}
	return paneIds;
}

function sessionIdsForDeferredInit(init: PaneHostInit): string[] {
	const sessionIds: string[] = [];
	const seen = new Set<string>();
	for (const sessionId of Object.values(init.initialSessionIds ?? {})) {
		if (!sessionId || seen.has(sessionId)) continue;
		seen.add(sessionId);
		sessionIds.push(sessionId);
	}
	return sessionIds;
}

/**
 * Permanently release a restored tab that never materialized a PaneHost.
 * Without this, closing an unopened inactive tab leaves its backend PTYs
 * (shells, reader threads, replay buffers) and seeded pane metadata behind.
 * The helper deliberately never constructs a host; hydration uses
 * `takeDeferredTabInit` and transfers ownership to a live host instead.
 */
export function disposeDeferredTabPanes(
	deferred: DeferredTabInit | undefined,
	opts: DeferredPaneTeardownOptions,
): void {
	if (!deferred || opts.hasLiveHost) return;
	for (const paneId of paneIdsForDeferredInit(deferred.init)) {
		opts.maps.paneThemes.delete(paneId);
		opts.maps.paneProfileIds.delete(paneId);
		opts.maps.paneCwdHints.delete(paneId);
	}
	for (const sessionId of sessionIdsForDeferredInit(deferred.init)) {
		opts.killSession(sessionId);
	}
}

function rekeyPaneMap(
	map: Map<string, unknown>,
	from: string,
	to: string,
): void {
	if (from === to || !map.has(from)) return;
	const value = map.get(from);
	map.delete(from);
	map.set(to, value);
}

/**
 * Move deferred-tab pane metadata to its rekeyed layout ids. Every source moves
 * to a temporary key first, so swapping tab indexes cannot overwrite another
 * pane's theme/profile/cwd.
 */
export function rekeyDeferredPaneMaps(
	moves: ReadonlyArray<{ from: string; to: string }>,
	maps: DeferredPaneMaps,
): void {
	const temps = moves.map((move, index) => {
		const temp = `#deferred-${index}`;
		rekeyPaneMap(maps.paneThemes, move.from, temp);
		rekeyPaneMap(maps.paneProfileIds, move.from, temp);
		rekeyPaneMap(maps.paneCwdHints, move.from, temp);
		return temp;
	});
	moves.forEach((move, index) => {
		rekeyPaneMap(maps.paneThemes, temps[index]!, move.to);
		rekeyPaneMap(maps.paneProfileIds, temps[index]!, move.to);
		rekeyPaneMap(maps.paneCwdHints, temps[index]!, move.to);
	});
}

function migrateLayoutFromLegacyMain(
	layout: PersistedPaneLayout,
	tabId: string,
): PersistedPaneLayout {
	const rid = tabRootPaneId(tabId);
	function mapNode(n: PaneNode): PaneNode {
		if (n.kind === "leaf") {
			const id = n.id === "main" ? rid : n.id;
			return { kind: "leaf", id };
		}
		return { ...n, a: mapNode(n.a), b: mapNode(n.b) };
	}
	const focusedId = layout.focusedId === "main" ? rid : layout.focusedId;
	const mapMain = (id: string) => (id === "main" ? rid : id);
	return {
		v: 1,
		tree: mapNode(layout.tree),
		focusedId,
		floating: remapRecordKeys(layout.floating, mapMain, (state) => ({
			...state,
		})),
		paneThemes: remapRecordKeys(layout.paneThemes, mapMain, (theme) => ({
			...theme,
		})),
		paneCwds: remapRecordKeys(layout.paneCwds, mapMain),
		paneProfileIds: remapRecordKeys(layout.paneProfileIds, mapMain),
		paneSessionIds: remapRecordKeys(layout.paneSessionIds, mapMain),
	};
}

function remapRecordKeys<T>(
	rec: Record<string, T> | undefined,
	mapId: (id: string) => string,
	clone: (v: T) => T = (v) => v,
): Record<string, T> | undefined {
	if (!rec) return undefined;
	const out: Record<string, T> = {};
	for (const [id, val] of Object.entries(rec)) out[mapId(id)] = clone(val);
	return out;
}

function loadRawTabs(): TabsStateV1 {
	try {
		const raw = localStorage.getItem(TABS_STATE_KEY);
		if (!raw) throw new Error("empty");
		const p = JSON.parse(raw) as Partial<TabsStateV1>;
		if (
			p.v !== 1 ||
			!Array.isArray(p.tabs) ||
			typeof p.activeTabId !== "string"
		)
			throw new Error("bad");
		if (p.tabs.length === 0) throw new Error("no tabs");
		const tabs = p.tabs.map((t, i) =>
			typeof t.order === "number" ? t : { ...t, order: i },
		);
		const groups = (p.groups ?? []).map((g, i) =>
			typeof g.order === "number" ? g : { ...g, order: i },
		);
		return { v: 1, tabs, activeTabId: p.activeTabId, groups };
	} catch {
		return {
			v: 1,
			tabs: [
				{
					id: "tab-1",
					name: "1",
					userName: null,
					groupId: null,
					color: null,
					order: 0,
				},
			],
			activeTabId: "tab-1",
			groups: [],
		};
	}
}

export function loadTabsState(): TabsStateV1 {
	return loadRawTabs();
}

export function saveTabsState(s: TabsStateV1): void {
	try {
		localStorage.setItem(TABS_STATE_KEY, JSON.stringify(s));
	} catch {
		/* ignore */
	}
}

export function loadLayoutForTab(tabId: string): PersistedPaneLayout | null {
	try {
		const raw = localStorage.getItem(tabLayoutKey(tabId));
		if (!raw) return null;
		const p = JSON.parse(raw) as Partial<PersistedPaneLayout>;
		if (p.v !== 1 || !p.tree || typeof p.focusedId !== "string") return null;
		return {
			v: 1,
			tree: p.tree as PaneNode,
			focusedId: p.focusedId,
			floating: p.floating,
			paneThemes: p.paneThemes,
			paneCwds: p.paneCwds,
			paneProfileIds: p.paneProfileIds,
			paneSessionIds: p.paneSessionIds,
		};
	} catch {
		return null;
	}
}

export function initialLayoutForTab(
	tabId: string,
	isFirstTab: boolean,
): PersistedPaneLayout {
	// Per-tab layout is authoritative: it is rewritten on every hide/persist and
	// carries the pane→sessionId map that re-hooks live PTYs after a webview
	// rebuild. The legacy single-tab layout (partty.pane_layout.v1) is only a
	// migration fallback and must not shadow the per-tab layout, or a lingering
	// copy would silently drop paneSessionIds on the first tab.
	const d = loadLayoutForTab(tabId);
	if (d) return migrateLayoutFromLegacyMain(d, tabId);
	if (isFirstTab) {
		const g = loadPaneLayout();
		if (g) return migrateLayoutFromLegacyMain(g, tabId);
	}
	return emptyTabLayout(tabId);
}

export function persistLayoutForTab(
	tabId: string,
	layout: PersistedPaneLayout,
): void {
	try {
		localStorage.setItem(tabLayoutKey(tabId), JSON.stringify(layout));
	} catch {
		/* ignore */
	}
}

export function nextTabName(tabs: TabRecord[]): string {
	let max = 0;
	for (const t of tabs) {
		const n = Number.parseInt(t.name, 10);
		if (Number.isFinite(n) && n > max) max = n;
	}
	return String(max + 1);
}
