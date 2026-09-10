/**
 * Shared command island.
 *
 * A single host positioned inside `#terminal-stage` (directly below the tab
 * area) owns every command-driven surface: the command palette, settings,
 * theme picker, terminal find, and the shortcut reference. Views are adopted
 * once at startup; only one may be presented at a time, so surfaces can never
 * stack, leave stale Escape entries behind, or fight over focus.
 *
 * The host is `position: absolute` inside the stage, so it never affects
 * terminal layout or the pane grid. Views keep their own open/close state and
 * overlay-stack registration; the island only coordinates visibility.
 */

import {
	disposeIslandMotion,
	prepareIslandView,
} from "../util/islandMotion.ts";

export type IslandView = {
	/** Stable identity used by present/dismiss/closeOthers. */
	id: string;
	/** Root element adopted into the island host. */
	element: HTMLElement;
	/** Class toggled while the view is hidden (module-owned). */
	hiddenClass: string;
	/** True while the owning module considers the view open. */
	isOpen(): boolean;
	/** Ask the owning module to close (must release its overlay handle). */
	close(): void;
};

export type CommandIslandApi = {
	readonly host: HTMLElement;
	/** Move a view into the shared host. Safe to call once per view. */
	adopt(view: IslandView): void;
	/** Make `id` the sole visible surface, closing any other open view. */
	present(id: string): void;
	/** Clear the active surface if it matches `id`. */
	dismiss(id: string): void;
	isActive(id: string): boolean;
	activeId(): string | null;
	/** Close every open view except `id`. */
	closeOthers(id: string): void;
	dispose(): void;
};

export function createCommandIsland(host: HTMLElement): CommandIslandApi {
	const views = new Map<string, IslandView>();
	let active: string | null = null;

	function closeOthers(id: string): void {
		// Snapshot the map: a close() may re-enter present/dismiss, which would
		// otherwise mutate the map while iterating.
		for (const [viewId, view] of [...views]) {
			if (viewId === id) continue;
			if (view.isOpen()) view.close();
		}
	}

	return {
		host,
		adopt(view: IslandView): void {
			views.set(view.id, view);
			if (view.element.parentElement !== host) host.append(view.element);
			view.element.classList.add("command-island-view");
			view.element.dataset.islandView = view.id;
		},
		present(id: string): void {
			if (active === id) return;
			const view = views.get(id);
			if (view) prepareIslandView(host, view.element);
			closeOthers(id);
			active = id;
			host.classList.add("command-island--active");
			host.setAttribute("aria-hidden", "false");
		},
		dismiss(id: string): void {
			if (active !== id) return;
			active = null;
			host.classList.remove("command-island--active");
			// Hiding is ARIA-only (the host never changes display), so it is safe
			// mid exit-animation and does not depend on when a view flips its own
			// open/closed state. A switch re-activates the host synchronously.
			host.setAttribute("aria-hidden", "true");
		},
		isActive: (id) => active === id,
		activeId: () => active,
		closeOthers,
		dispose(): void {
			for (const view of views.values()) disposeIslandMotion(view.element);
			views.clear();
			active = null;
		},
	};
}
