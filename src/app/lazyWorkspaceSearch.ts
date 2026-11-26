import type { createWorkspaceSearch } from "./workspaceSearch";

type Search = ReturnType<typeof createWorkspaceSearch>;

export function workspaceSearchQuery(raw: string): string | undefined {
	const query = raw.trimStart();
	return query.startsWith(":") ? query.slice(1).trim() : undefined;
}

export function lazyWorkspaceSearch(
	options: Parameters<typeof createWorkspaceSearch>[0],
) {
	let search: Search | undefined;
	let loading = false;
	let refreshActive: (() => void) | undefined;
	let failed = false;

	function clear(): void {
		refreshActive = undefined;
		search?.clear();
	}

	function refreshLoaded(): void {
		const refresh = refreshActive;
		refreshActive = undefined;
		refresh?.();
	}

	return {
		clear,
		get scanning() {
			return !!refreshActive || (search?.scanning ?? false);
		},
		get emptyText() {
			return (
				search?.emptyText ??
				(failed ? "Workspace search unavailable" : "Loading workspace search…")
			);
		},
		filter(raw: string, depth: number, refresh: () => void, enabled: boolean) {
			const query = enabled ? workspaceSearchQuery(raw) : undefined;
			if (query === undefined) {
				clear();
				return undefined;
			}
			if (search) return search.filter(query, depth, refresh);
			if (failed) return [];
			refreshActive = refresh;
			if (!loading) {
				loading = true;
				void import("./workspaceSearch").then(
					({ createWorkspaceSearch }) => {
						search = createWorkspaceSearch(options);
						refreshLoaded();
					},
					() => {
						failed = true;
						refreshLoaded();
					},
				);
			}
			return [];
		},
	};
}
