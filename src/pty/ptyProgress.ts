/** Resolved OSC 9;4 progress; the backend handles defaults and retention. */
export type PtyProgress = {
	state: "clear" | "normal" | "error" | "indeterminate" | "paused";
	value: number;
};

const priority = {
	clear: 0,
	indeterminate: 1,
	normal: 2,
	paused: 3,
	error: 4,
} satisfies Record<PtyProgress["state"], number>;

/** Windows Terminal chooses the highest-priority state, first pane on ties. */
export function selectTabProgress(
	paneIds: readonly string[],
	getProgress: (paneId: string) => PtyProgress | null,
): PtyProgress | null {
	let best: PtyProgress | null = null;
	for (const id of paneIds) {
		const next = getProgress(id);
		if (next && priority[next.state] > (best ? priority[best.state] : 0)) {
			best = next;
		}
	}
	return best;
}
