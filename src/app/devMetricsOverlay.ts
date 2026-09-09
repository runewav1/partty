import type {
	LatencySummary,
	ParttyPerfSnapshot,
	RateSummary,
	TimingBucket,
	TokenCounts,
} from "./../pty/metricsCore";
import { parttyPerf } from "./../pty/perf";
import { DEV_OVERLAY_POS_KEY } from "./../util/storageKeys";
import { attachDraggablePanel } from "./draggablePanel";

export type DevMetricsOverlayApi = {
	show(): void;
	hide(): void;
	toggle(): void;
	isVisible(): boolean;
};

export type DevMetricsOverlayOptions = {
	root: HTMLElement;
	getFocusedPaneId: () => string | null | undefined;
};

const TICK_MS = 500;

function fmtMs(n: number | null, digits = 2): string {
	return n === null ? "\u2014" : `${n.toFixed(digits)} ms`;
}

function fmtBytes(n: number): string {
	if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GiB`;
	if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MiB`;
	if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
	return `${n.toFixed(0)} B`;
}

function fmtRate(bytesPerSec: number): string {
	if (bytesPerSec >= 1_073_741_824) {
		return `${(bytesPerSec / 1_073_741_824).toFixed(2)} GiB/s`;
	}
	if (bytesPerSec >= 1_048_576) {
		return `${(bytesPerSec / 1_048_576).toFixed(2)} MiB/s`;
	}
	if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KiB/s`;
	return `${bytesPerSec.toFixed(0)} B/s`;
}

/** Session aggregate timing bucket (count/totalMs/maxMs/minMs/lastMs). */
function sessionTimingStats(b: TimingBucket | undefined): string[] {
	if (!b || b.count <= 0) return [];
	return [
		`session avg ${fmtMs(b.totalMs / b.count)}`,
		`last ${fmtMs(b.lastMs)}`,
		`max ${fmtMs(b.maxMs)}`,
		`min ${fmtMs(b.minMs)}`,
		`n=${b.count}`,
	];
}

/**
 * Rolling latency summary from the collector. n/p50/p95/max are the trailing
 * window; avgMs is the full-session mean; evictions count dropped samples.
 */
function latencyStats(sum: LatencySummary): string[] {
	const stats: string[] = [`n=${sum.n}`];
	if (sum.p50 !== null) stats.push(`p50 ${fmtMs(sum.p50)}`);
	if (sum.p95 !== null) stats.push(`p95 ${fmtMs(sum.p95)}`);
	if (sum.max !== null) stats.push(`max ${fmtMs(sum.max)}`);
	if (sum.last !== null) stats.push(`last ${fmtMs(sum.last)}`);
	if (sum.avgMs !== null) stats.push(`session avg ${fmtMs(sum.avgMs)}`);
	stats.push(`window ${(sum.windowMs / 1000).toFixed(0)}s`);
	if (sum.evictions > 0) stats.push(`evicted ${sum.evictions}`);
	return stats;
}

/** Trailing-window rate summary; bytesPerSec is the raw in-window sum. */
function rateStats(sum: RateSummary): string[] {
	const stats: string[] = [
		`1s ${fmtRate(sum.bytesPerSec)}`,
		`total ${fmtBytes(sum.totalBytes)}`,
	];
	if (sum.lastBytes > 0) stats.push(`last ${fmtBytes(sum.lastBytes)}`);
	stats.push(`n=${sum.samples}`);
	if (sum.evictions > 0) stats.push(`evicted ${sum.evictions}`);
	return stats;
}

function tokenStats(t: TokenCounts): string[] {
	return [
		`started ${t.started}`,
		`outstanding ${t.outstanding}`,
		`completed ${t.completed}`,
		`expired ${t.expired}`,
		`cancelled ${t.cancelled}`,
		`overflow ${t.overflow}`,
	];
}

function observerStatus(
	gauge: number | undefined,
): "supported" | "unsupported" | "unknown" {
	if (typeof gauge === "number") {
		return gauge === 1 ? "supported" : "unsupported";
	}
	return "unknown";
}

function metricRow(
	label: string,
	stats: string[],
	title?: string,
): HTMLElement {
	const row = document.createElement("div");
	row.className = "dev-metric";
	if (title) row.title = title;

	const lab = document.createElement("span");
	lab.className = "dev-metric-label";
	lab.textContent = label;
	row.appendChild(lab);

	const value = document.createElement("span");
	value.className = "dev-metric-value";
	if (stats.length === 0) {
		const na = document.createElement("span");
		na.className = "dev-stat dev-stat--na";
		na.textContent = "unavailable";
		value.appendChild(na);
	} else {
		for (const s of stats) {
			const sp = document.createElement("span");
			sp.className = "dev-stat";
			sp.textContent = s;
			value.appendChild(sp);
		}
	}
	row.appendChild(value);
	return row;
}

function readabilityCard(
	label: string,
	value: string,
	context: string,
	title: string,
): HTMLElement {
	const card = document.createElement("div");
	card.className = "dev-readability-card";
	card.title = title;

	const lab = document.createElement("span");
	lab.className = "dev-readability-label";
	lab.textContent = label;

	const val = document.createElement("strong");
	val.className = "dev-readability-value";
	val.textContent = value;

	const detail = document.createElement("span");
	detail.className = "dev-readability-context";
	detail.textContent = context;

	card.append(lab, val, detail);
	return card;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
	const sec = document.createElement("section");
	sec.className = "dev-section";
	const hd = document.createElement("h2");
	hd.className = "dev-section-hd";
	hd.textContent = title;
	sec.appendChild(hd);
	for (const r of rows) sec.appendChild(r);
	return sec;
}

function makeButton(
	label: string,
	ariaLabel: string,
	onClick: () => void,
): HTMLButtonElement {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "dev-overlay-btn";
	b.textContent = label;
	b.setAttribute("aria-label", ariaLabel);
	b.addEventListener("click", onClick);
	return b;
}

export function createDevMetricsOverlay(
	opts: DevMetricsOverlayOptions,
): DevMetricsOverlayApi {
	const { root, getFocusedPaneId } = opts;
	let visible = false;
	let frozen = false;
	let timer = 0;

	const el = document.createElement("div");
	el.id = "dev-metrics-overlay";
	el.className = "dev-overlay dev-overlay--hidden";
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-label", "Developer metrics");
	el.setAttribute("aria-hidden", "true");
	el.tabIndex = -1;

	const head = document.createElement("div");
	head.className = "dev-overlay-head";

	const handle = document.createElement("div");
	handle.className = "dev-overlay-handle";
	const title = document.createElement("span");
	title.className = "dev-overlay-title";
	title.textContent = "Metrics";
	const stateEl = document.createElement("span");
	stateEl.className = "dev-overlay-state";
	stateEl.textContent = "live";
	handle.appendChild(title);

	const controls = document.createElement("div");
	controls.className = "dev-overlay-controls";
	// Buttons must never start a panel drag, even if the header shape changes.
	controls.addEventListener("pointerdown", (e) => e.stopPropagation());

	const freezeBtn = makeButton("Freeze", "Freeze display", toggleFreeze);
	const exportBtn = makeButton(
		"Export",
		"Export metrics snapshot as JSON",
		exportJson,
	);
	const resetBtn = makeButton("Reset", "Reset metrics", doReset);
	const closeBtn = makeButton("\u00d7", "Close dev metrics", hide);
	closeBtn.classList.add("dev-overlay-btn--close");

	controls.append(closeBtn);
	head.appendChild(handle);
	head.appendChild(controls);

	const body = document.createElement("div");
	body.className = "dev-overlay-body";

	const tools = document.createElement("details");
	tools.className = "dev-overlay-tools";
	const toolsSummary = document.createElement("summary");
	toolsSummary.className = "dev-overlay-tools-summary";
	const toolsLabel = document.createElement("span");
	toolsLabel.textContent = "Tools";
	toolsSummary.append(toolsLabel, stateEl);
	const toolsActions = document.createElement("div");
	toolsActions.className = "dev-overlay-tools-actions";
	toolsActions.append(freezeBtn, exportBtn, resetBtn);
	tools.append(toolsSummary, toolsActions);

	el.append(head, body, tools);
	root.appendChild(el);

	attachDraggablePanel(el, handle, DEV_OVERLAY_POS_KEY);

	el.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			hide();
		}
	});

	function buildReadabilitySection(snap: ParttyPerfSnapshot): HTMLElement {
		const writeP95 = snap.writeLatency.p95;
		const frameP95 = snap.rAF.gap.p95;
		const readability = section("Readability", []);
		readability.classList.add("dev-section--readability");

		const grid = document.createElement("div");
		grid.className = "dev-readability-grid";
		grid.append(
			readabilityCard(
				"Write response",
				fmtMs(writeP95),
				writeP95 === null
					? "waiting for samples"
					: `p95 · ${snap.writeLatency.n} in 10s`,
				"95th-percentile handed-to-write → completion-callback latency in the trailing window.",
			),
			readabilityCard(
				"Frame cadence",
				fmtMs(frameP95),
				frameP95 === null
					? `${snap.rAF.state} · waiting for samples`
					: `p95 gap · ${snap.rAF.state}`,
				"95th-percentile requestAnimationFrame gap in the trailing window. This is cadence, not FPS.",
			),
			readabilityCard(
				"Output flow",
				fmtRate(snap.rates.out.bytesPerSec),
				"handed to xterm · trailing 1s",
				"PTY output bytes handed to term.write during the trailing one-second window.",
			),
			readabilityCard(
				"Pending writes",
				String(snap.writeTokens.outstanding),
				`${snap.writeTokens.completed} completed · session`,
				"Term writes currently waiting for their completion callback.",
			),
		);
		readability.appendChild(grid);
		return readability;
	}

	function buildWritePathSection(snap: ParttyPerfSnapshot): HTMLElement {
		return section("Write path", [
			metricRow(
				"xterm.write call (session)",
				sessionTimingStats(snap.timings["xterm.write.call.ms"]),
				"Synchronous wall time inside term.write, measured by the parent producer " +
					"(xterm.write.call.ms). May include the synchronous parser path and the dev " +
					"write callback — it is not enqueue-only or CPU time.",
			),
			metricRow(
				"Write latency",
				latencyStats(snap.writeLatency),
				"Enqueue \u2192 term.write callback latency. n/p50/p95/max are the trailing " +
					"rolling window; session avg is the full-session mean; evictions count " +
					"samples dropped when the window was full.",
			),
			metricRow(
				"Write tokens",
				tokenStats(snap.writeTokens),
				"In-flight term.write token lifecycle: outstanding now, plus completed, " +
					"expired, cancelled and overflow since the collector was enabled.",
			),
		]);
	}

	function buildBytesSection(snap: ParttyPerfSnapshot): HTMLElement {
		return section("PTY \u2194 xterm bytes", [
			metricRow(
				"PTY in \u00b7 requested UTF-8",
				rateStats(snap.rates.in),
				"UTF-8 bytes requested by the frontend, not confirmed PTY delivery, recorded only " +
					"while the collector is enabled.",
			),
			metricRow(
				"\u2192 xterm \u00b7 handed bytes",
				rateStats(snap.rates.out),
				"PTY output bytes handed to term.write.",
			),
		]);
	}

	function buildFrameCadenceSection(snap: ParttyPerfSnapshot): HTMLElement {
		const r = snap.rAF;
		const stateStats: string[] = [`state ${r.state}`];
		if (r.state === "paused" && r.staleMs > 0) {
			stateStats.push(`stale ${fmtMs(r.staleMs, 0)}`);
		}
		if (r.pausedAt !== null)
			stateStats.push(`pausedAt ${r.pausedAt.toFixed(0)}`);

		const gaps50: number | undefined = snap.counters["rAF.gap.50ms"];
		const gaps100: number | undefined = snap.counters["rAF.gap.100ms"];
		const gapCounters: string[] = [];
		if (gaps50 !== undefined) gapCounters.push(`>50ms ${gaps50}`);
		if (gaps100 !== undefined) gapCounters.push(`>100ms ${gaps100}`);

		const ltCount: number | undefined = snap.counters["main.longtask.count"];
		const ltTiming = snap.timings["main.longtask.ms"];
		const ltStatus = observerStatus(snap.gauges["observer.longtask"]);
		const ltStats: string[] = [];
		if (ltStatus === "supported") {
			if (ltCount !== undefined) ltStats.push(`count ${ltCount}`);
			if (ltTiming && ltTiming.count > 0) {
				ltStats.push(
					`session avg ${fmtMs(ltTiming.totalMs / ltTiming.count, 0)}`,
				);
			}
			ltStats.push("observer supported");
		} else if (ltStatus === "unsupported") {
			ltStats.push("unsupported \u00b7 no observer");
		} else {
			ltStats.push("observer status unknown");
		}

		const lsCount: number | undefined = snap.counters["layout.shift.count"];
		const lsLast: number | undefined = snap.gauges["layout.shift.last"];
		const lsStatus = observerStatus(snap.gauges["observer.layout-shift"]);
		const lsStats: string[] = [];
		if (lsStatus === "supported") {
			if (lsCount !== undefined) lsStats.push(`count ${lsCount}`);
			if (lsLast !== undefined) lsStats.push(`last ${lsLast.toFixed(3)}`);
			lsStats.push("observer supported");
		} else if (lsStatus === "unsupported") {
			lsStats.push("unsupported \u00b7 no observer");
		} else {
			lsStats.push("observer status unknown");
		}

		return section("Frame cadence", [
			metricRow(
				"rAF",
				stateStats,
				"rAF sampling state. Sampling pauses while the document is hidden; this " +
					"panel's loop also stops, but write callbacks keep being recorded.",
			),
			metricRow(
				"rAF gap",
				latencyStats(r.gap),
				"Inter-frame rAF gap distribution over the trailing window; cadence only, " +
					"not FPS.",
			),
			metricRow(
				"Frame gaps",
				gapCounters,
				"Counters of rAF callbacks whose inter-frame gap exceeded 50/100 ms \u2014 " +
					"gaps, not dropped frames.",
			),
			metricRow(
				"Long tasks (session)",
				ltStats,
				"Session aggregate of observed long tasks. The availability gauge " +
					"distinguishes an unsupported observer from a true zero.",
			),
			metricRow(
				"Layout shift (session)",
				lsStats,
				"Session aggregate of layout shifts. The availability gauge distinguishes " +
					"an unsupported observer from a true zero.",
			),
		]);
	}

	function buildPanesSection(): HTMLElement | null {
		const paneIds = parttyPerf.getAllPaneIds();
		if (paneIds.length === 0) return null;
		const focused = getFocusedPaneId() ?? null;
		const rows: HTMLElement[] = [];

		for (const id of paneIds) {
			const pane = document.createElement("div");
			pane.className = `dev-pane${id === focused ? " dev-pane--focused" : ""}`;
			const idRow = document.createElement("div");
			idRow.className = "dev-pane-id";
			idRow.textContent = `${id === focused ? "\u25b6 " : ""}${id}`;
			pane.appendChild(idRow);

			const snap = parttyPerf.getPaneSnapshot(id);
			if (snap) {
				if (snap.rates.in) {
					pane.appendChild(
						metricRow("in \u00b7 req\u2019d UTF-8", rateStats(snap.rates.in)),
					);
				}
				if (snap.rates.out) {
					pane.appendChild(
						metricRow("\u2192 xterm \u00b7 handed", rateStats(snap.rates.out)),
					);
				}
				if (snap.writeLatency) {
					pane.appendChild(
						metricRow("write latency", latencyStats(snap.writeLatency)),
					);
				}
				pane.appendChild(
					metricRow("write tokens", tokenStats(snap.writeTokens)),
				);
			} else {
				const na = document.createElement("span");
				na.className = "dev-stat dev-stat--na";
				na.textContent = "no data";
				pane.appendChild(na);
			}
			rows.push(pane);
		}

		return section("Panes", rows);
	}

	function buildNote(): HTMLElement {
		const note = document.createElement("div");
		note.className = "dev-overlay-note";
		note.textContent =
			"Dev-only overlay. Instrumentation adds overhead and is not a benchmark " +
			"authority. Hiding the panel stops only this refresh loop; the collector's " +
			"rAF sampling also pauses while the document is hidden, but PTY output and " +
			"write callbacks are still recorded. Rates are raw in-window sums (1s window); " +
			"latency stats use the collector's rolling window, and session aggregates are " +
			"labeled session.";
		return note;
	}

	function render(): void {
		const snap = parttyPerf.snapshot();
		body.replaceChildren();
		body.appendChild(buildReadabilitySection(snap));
		body.appendChild(
			metricRow("Session", [
				`epoch ${snap.meta.epoch}`,
				snap.meta.sessionStartedAt === null
					? "not started"
					: `${((snap.meta.capturedAt - snap.meta.sessionStartedAt) / 1000).toFixed(1)}s since reset`,
				"latency window 10s / rates 1s",
			]),
		);
		body.appendChild(
			metricRow(
				"Terminal input events",
				[`${parttyPerf.getInputRate()} events in trailing 1s`],
				"Terminal onData events, not physical keypresses or bytes.",
			),
		);
		body.appendChild(buildWritePathSection(snap));
		body.appendChild(buildBytesSection(snap));
		body.appendChild(buildFrameCadenceSection(snap));
		const panes = buildPanesSection();
		if (panes) body.appendChild(panes);
		body.appendChild(buildNote());
		updateChrome();
	}

	function updateChrome(): void {
		const stateClass = frozen
			? "dev-overlay-state--paused"
			: parttyPerf.enabled
				? "dev-overlay-state--on"
				: "dev-overlay-state--off";
		stateEl.className = `dev-overlay-state ${stateClass}`;
		stateEl.textContent = frozen
			? "frozen"
			: parttyPerf.enabled
				? "live"
				: "off";
		freezeBtn.setAttribute("aria-pressed", String(frozen));
		freezeBtn.textContent = frozen ? "Resume" : "Freeze";
	}

	function doReset(): void {
		parttyPerf.reset();
		render();
	}

	function exportJson(): void {
		const payload = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			collectedAt: performance.now(),
			collector: { enabled: parttyPerf.enabled },
			snapshot: parttyPerf.snapshot(),
			panes: parttyPerf.getAllPaneIds().map((id) => ({
				paneId: id,
				snapshot: parttyPerf.getPaneSnapshot(id),
			})),
			contracts: parttyPerf.contracts(),
		};
		try {
			const blob = new Blob([JSON.stringify(payload, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `partty-dev-metrics-${Date.now()}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch {
			/* blob export unavailable */
		}
	}

	/** Freeze only the display; the collector keeps recording in the background. */
	function toggleFreeze(): void {
		frozen = !frozen;
		if (frozen) {
			clearTimer();
		} else {
			render();
			schedule();
		}
		updateChrome();
	}

	function clearTimer(): void {
		if (timer) {
			window.clearTimeout(timer);
			timer = 0;
		}
	}

	function schedule(): void {
		if (timer || !visible || frozen || document.hidden) return;
		timer = window.setTimeout(tick, TICK_MS);
	}

	function tick(): void {
		timer = 0;
		if (!visible || frozen || document.hidden) return;
		render();
		schedule();
	}

	function show(): void {
		visible = true;
		el.classList.remove("dev-overlay--hidden");
		el.setAttribute("aria-hidden", "false");
		updateChrome();
		render();
		if (!timer) schedule();
		if (!el.contains(document.activeElement)) {
			el.focus({ preventScroll: true });
		}
	}

	function hide(): void {
		visible = false;
		el.classList.add("dev-overlay--hidden");
		el.setAttribute("aria-hidden", "true");
		clearTimer();
	}

	function toggle(): void {
		if (visible) hide();
		else show();
	}

	function isVisible(): boolean {
		return visible;
	}

	document.addEventListener("visibilitychange", () => {
		clearTimer();
		if (visible && !frozen && !document.hidden) {
			render();
			schedule();
		}
	});

	return { show, hide, toggle, isVisible };
}
