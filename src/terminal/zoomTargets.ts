/**
 * Pure "which panes are visible" selection for the all-visible wheel zoom.
 * No DOM, no Tauri, no side effects: production feeds normalized per-pane
 * descriptors in from `main.ts` and Node unit tests exercise the selection
 * rules directly (hidden inactive tabs excluded, follow floats included,
 * dedup across hosts, only live terminals).
 */

export type ZoomPaneDescriptor = {
	id: string;
	/** Leaf belongs to the active tab host (tiled or floating over it). */
	hostActive: boolean;
	/** Follow float mounted in the global follow layer (visible across tabs). */
	following: boolean;
	/** Has a live PaneTerminal (deferred/dismissed panes are excluded). */
	live: boolean;
};

/**
 * Order-preserving, dedup'd pane ids that are currently on screen: leaves of
 * the active tab host plus follow floats from any host, restricted to panes
 * with a live terminal. Panes hidden inside an inactive tab shell (not active,
 * not following) never qualify.
 */
export function selectVisibleZoomPaneIds(
	panes: readonly ZoomPaneDescriptor[],
): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const pane of panes) {
		if (seen.has(pane.id)) continue;
		if (!(pane.hostActive || pane.following)) continue;
		if (!pane.live) continue;
		seen.add(pane.id);
		ids.push(pane.id);
	}
	return ids;
}
