import type { PtyProgress } from "../pty/ptyProgress";

export function createProgressRing(): HTMLSpanElement {
	const ring = document.createElement("span");
	ring.className = "progress-ring";
	ring.hidden = true;
	ring.setAttribute("aria-hidden", "true");
	return ring;
}

/** Paint only when the visible state changes. The host describes the ring to AT. */
export function updateProgressRing(
	host: HTMLElement,
	ring: HTMLElement,
	progress: PtyProgress | null | undefined,
): void {
	const state = progress?.state ?? "clear";
	const value =
		state === "clear" || state === "indeterminate" ? 0 : (progress?.value ?? 0);
	const signature = `${state}:${value}`;
	if (ring.dataset.progress === signature) return;
	ring.dataset.progress = signature;
	ring.dataset.state = state;
	ring.hidden = state === "clear";
	if (state === "indeterminate") ring.removeAttribute("style");
	else ring.setAttribute("style", `--progress-fill: ${value}%`);
	if (state === "clear") {
		host.removeAttribute("aria-description");
		ring.title = "";
		return;
	}
	const description =
		state === "indeterminate"
			? "In progress"
			: state === "paused"
				? `Paused at ${value}%`
				: state === "error"
					? `Error at ${value}%`
					: `${value}% complete`;
	host.setAttribute("aria-description", description);
	ring.title = description;
}
