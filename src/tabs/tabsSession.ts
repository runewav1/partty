import type { PaneNode } from "./../terminal/paneHost";
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
	return mapLayoutToTabKey(layout, tabKey, followSlots).layout;
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
		};
	} catch {
		return null;
	}
}

export function initialLayoutForTab(
	tabId: string,
	isFirstTab: boolean,
): PersistedPaneLayout {
	if (isFirstTab) {
		const g = loadPaneLayout();
		if (g) return migrateLayoutFromLegacyMain(g, tabId);
	}
	const d = loadLayoutForTab(tabId);
	if (d) return migrateLayoutFromLegacyMain(d, tabId);
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
		const n = parseInt(t.name, 10);
		if (Number.isFinite(n) && n > max) max = n;
	}
	return String(max + 1);
}
