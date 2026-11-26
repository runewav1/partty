import type { Terminal } from "@xterm/xterm";
import {
	COLLAPSED_MATCHES,
	type ScrollbackHits,
	scanScrollback,
} from "../terminal/scrollbackSearch";
import {
	parseWorkspaceSearch,
	type WorkspacePaletteTab,
	workspacePaletteCommands,
} from "./workspacePalette";

type Scan = {
	query: string;
	depth: number;
	pending: boolean;
	hits: Map<string, ScrollbackHits>;
	expanded: Set<string>;
};

export function createWorkspaceSearch(options: {
	tabs: () => WorkspacePaletteTab[];
	activeTabId: () => string;
	focusedPaneId: () => string | null;
	nearbyPaneIds: (focusedId: string) => string[] | null;
	terminal: (sessionId: string) => Terminal | undefined;
}) {
	let scan: Scan | null = null;
	let frame = 0;

	function clear(): void {
		scan = null;
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
	}

	function start(
		tabs: WorkspacePaletteTab[],
		metadata: string,
		phrase: string,
		state: Scan,
		refresh: () => void,
	): void {
		const eligible = metadata
			? new Set(workspacePaletteCommands(tabs, metadata).map((row) => row.id))
			: null;
		const activeId = options.activeTabId();
		const active = tabs.find((tab) => tab.id === activeId);
		const selected = options.focusedPaneId();
		const activeOrder = selected ? options.nearbyPaneIds(selected) : null;
		const nearby = [...tabs].sort(
			(a, b) =>
				Math.abs(a.index - (active?.index ?? 1)) -
				Math.abs(b.index - (active?.index ?? 1)),
		);
		const sessions: string[] = [];
		let focusedSession: string | undefined;
		for (const tab of nearby) {
			const panes =
				tab === active && activeOrder
					? [...tab.panes].sort(
							(a, b) =>
								activeOrder.indexOf(a.paneId) - activeOrder.indexOf(b.paneId),
						)
					: tab.panes;
			for (const { sessionId, paneId } of panes) {
				if (
					!sessionId ||
					!options.terminal(sessionId) ||
					(eligible && !eligible.has(`workspace-pane-${sessionId}`))
				)
					continue;
				if (paneId === selected) focusedSession = sessionId;
				else sessions.push(sessionId);
			}
		}
		if (focusedSession) sessions.push(focusedSession);
		if (!sessions.length || !state.depth) {
			state.pending = false;
			return;
		}
		const queue = sessions.values();
		let current: ReturnType<typeof scanScrollback> | undefined;
		let sessionId: string | undefined;
		function step(): void {
			frame = 0;
			if (scan !== state) return;
			if (sessionId && !options.terminal(sessionId)) current = undefined;
			const deadline = performance.now() + 5;
			let changed = false;
			do {
				if (!current) {
					sessionId = queue.next().value;
					if (!sessionId) {
						state.pending = false;
						refresh();
						return;
					}
					const term = options.terminal(sessionId);
					if (!term) continue;
					current = scanScrollback(term, state.depth, phrase);
				}
				const next = current.next();
				if (next.done) {
					if (next.value.count && sessionId) {
						state.hits.set(sessionId, next.value);
						changed = true;
					}
					current = undefined;
				}
			} while (performance.now() < deadline);
			if (changed) refresh();
			if (scan === state) frame = requestAnimationFrame(step);
		}
		frame = requestAnimationFrame(step);
	}

	return {
		clear,
		get scanning() {
			return scan !== null;
		},
		get emptyText() {
			return scan?.pending
				? "Searching scrollback…"
				: scan
					? "No matches in available scrollback"
					: "No matching tabs or panes";
		},
		filter(query: string, depth: number, refresh: () => void) {
			const parsed = parseWorkspaceSearch(query);
			if (!parsed?.phrase || scan?.query !== query || scan.depth !== depth) {
				clear();
			}
			if (!parsed) return [];
			const tabs = options.tabs();
			if (parsed.phrase && !scan) {
				scan = {
					query,
					depth,
					pending: true,
					hits: new Map(),
					expanded: new Set(),
				};
				start(tabs, parsed.metadata, parsed.phrase, scan, refresh);
				return [];
			}
			if (scan) {
				const { hits, expanded } = scan;
				for (const tab of tabs) {
					for (const pane of tab.panes) {
						const id = pane.sessionId;
						if (!id) continue;
						pane.hits = hits.get(id);
						pane.expanded = expanded.has(id);
						if (pane.hits && pane.hits.matches.length > COLLAPSED_MATCHES) {
							pane.toggleMatches = () => {
								if (!expanded.delete(id)) expanded.add(id);
							};
						}
					}
				}
			}
			return workspacePaletteCommands(
				tabs,
				parsed.metadata,
				Date.now(),
				!!parsed.phrase,
			);
		},
	};
}
