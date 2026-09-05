import { collectLeafIds, type PaneNode } from "./paneHost";
import type { PersistedPaneLayout } from "./paneLayout";

export const FOLLOW_TAB_MARK = "*";

const PANE_ID_RE = /^(\*|\d+)([a-z]+)$/;

export type PaneIdParts = {
	tabKey: string;
	slot: string;
};

export function formatPaneId(tabKey: string, slot: string): string {
	return `${tabKey}${slot}`;
}

export function parsePaneId(id: string): PaneIdParts | null {
	const m = PANE_ID_RE.exec(id);
	if (!m) return null;
	return { tabKey: m[1]!, slot: m[2]! };
}

/** Bijective base-26: 0→a … 25→z, 26→aa. */
function slotAt(index: number): string {
	let n = index + 1;
	let s = "";
	while (n > 0) {
		n -= 1;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return s || "a";
}

export function nextSlot(used: Iterable<string>): string {
	const set = used instanceof Set ? used : new Set(used);
	for (let i = 0; i < 10_000; i++) {
		const slot = slotAt(i);
		if (!set.has(slot)) return slot;
	}
	return slotAt(10_000);
}

function mapLayoutRecords(
	layout: PersistedPaneLayout,
	mapId: (id: string) => string,
): PersistedPaneLayout {
	const mapNode = (n: PaneNode): PaneNode => {
		if (n.kind === "leaf") return { kind: "leaf", id: mapId(n.id) };
		return { ...n, a: mapNode(n.a), b: mapNode(n.b) };
	};
	const mapRec = <T>(
		rec?: Record<string, T>,
	): Record<string, T> | undefined => {
		if (!rec) return undefined;
		const out: Record<string, T> = {};
		for (const [id, val] of Object.entries(rec)) out[mapId(id)] = val;
		return out;
	};
	return {
		v: 1,
		tree: mapNode(layout.tree),
		focusedId: mapId(layout.focusedId),
		floating: mapRec(layout.floating),
		paneThemes: mapRec(layout.paneThemes),
		paneCwds: mapRec(layout.paneCwds),
		paneProfileIds: mapRec(layout.paneProfileIds),
	};
}

/**
 * Assign `{tabKey}{slot}` ids. Follow-floats use `*` and share one slot pool.
 * Existing letters are kept when still free; holes are reused for new panes.
 */
export function mapLayoutToTabKey(
	layout: PersistedPaneLayout,
	tabKey: string,
	followSlots: Set<string>,
): { layout: PersistedPaneLayout; idMap: Map<string, string> } {
	const ids: string[] = [];
	collectLeafIds(layout.tree, ids);
	const localUsed = new Set<string>();
	const idMap = new Map<string, string>();

	for (const id of ids) {
		const follow = !!layout.floating?.[id]?.follow;
		const prev = parsePaneId(id);
		let slot = prev?.slot;
		if (follow) {
			if (!slot || followSlots.has(slot)) slot = nextSlot(followSlots);
			followSlots.add(slot);
			idMap.set(id, formatPaneId(FOLLOW_TAB_MARK, slot));
		} else {
			if (!slot || localUsed.has(slot)) slot = nextSlot(localUsed);
			localUsed.add(slot);
			idMap.set(id, formatPaneId(tabKey, slot));
		}
	}

	return {
		layout: mapLayoutRecords(layout, (id) => idMap.get(id) ?? id),
		idMap,
	};
}

/** Default root leaf id for a tab (`1a`, `2a`, …). */
export function tabRootPaneId(tabKey: string): string {
	return formatPaneId(tabKey, "a");
}

export function emptyTabLayout(tabKey: string): PersistedPaneLayout {
	const id = tabRootPaneId(tabKey);
	return { v: 1, tree: { kind: "leaf", id }, focusedId: id };
}
