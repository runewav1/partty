import {
	PERF_CONSOLE_KEY,
	PERF_INTERVAL_MS_KEY,
	PERF_KEY,
} from "./../util/storageKeys";
import {
	beginWriteToken,
	cancelWriteToken,
	cancelWriteTokensForPane,
	createLatencyWindow,
	createRateWindow,
	createWriteTokenRegistry,
	finishWriteToken,
	freezeDeep,
	type LatencyWindow,
	latencySummary,
	type MetricContract,
	type PanePerfSnapshot,
	type ParttyPerfSnapshot,
	pruneExpiredWriteTokens,
	pushLatency,
	pushRate,
	type RateSummary,
	type RateWindow,
	rateSummary,
	resetLatencyWindow,
	resetRateWindow,
	resetWriteTokens,
	type TimingBucket,
	tokenCounts,
	type WriteToken,
} from "./metricsCore";

const LATENCY_WINDOW_MS = 10_000;
const LATENCY_CAPACITY = 4096;
const RATE_WINDOW_MS = 1000;
const RATE_CAPACITY = 4096;
const WRITE_TOKEN_MAX = 256;
const WRITE_TOKEN_EXPIRE_MS = 2000;
const SNAPSHOT_SCHEMA_VERSION = 2;

type TokenTally = {
	started: number;
	completed: number;
	expired: number;
	cancelled: number;
	overflow: number;
};

const counters: Record<string, number> = {};
const gauges: Record<string, number> = {};
const timings: Record<string, TimingBucket> = {};

const paneCounters = new Map<string, Record<string, number>>();
const paneGauges = new Map<string, Record<string, number>>();
const paneTimings = new Map<string, Record<string, TimingBucket>>();

const globalInRate = createRateWindow({
	windowMs: RATE_WINDOW_MS,
	capacity: RATE_CAPACITY,
});
const globalOutRate = createRateWindow({
	windowMs: RATE_WINDOW_MS,
	capacity: RATE_CAPACITY,
});
const inputEventRate = createRateWindow({
	windowMs: RATE_WINDOW_MS,
	capacity: RATE_CAPACITY,
});
const globalWriteLatency = createLatencyWindow({
	windowMs: LATENCY_WINDOW_MS,
	capacity: LATENCY_CAPACITY,
});
const rAFGapWindow = createLatencyWindow({
	windowMs: LATENCY_WINDOW_MS,
	capacity: LATENCY_CAPACITY,
});
const writeTokens = createWriteTokenRegistry({
	maxTokens: WRITE_TOKEN_MAX,
	expireMs: WRITE_TOKEN_EXPIRE_MS,
});

const paneInRates = new Map<string, RateWindow>();
const paneOutRates = new Map<string, RateWindow>();
const paneWriteLatency = new Map<string, LatencyWindow>();
const paneWriteTokens = new Map<string, TokenTally>();

let rafState: "active" | "paused" = "paused";
let rafPausedAt: number | null = null;
let rafHandle = 0;
let rafLast = 0;
let rafLastSampleAt: number | null = null;

let consoleTimer = 0;
let observersInstalled = false;
let visibilityListener: (() => void) | null = null;
let performanceObservers: PerformanceObserver[] = [];
let sessionStartedAt: number | null = null;
const observerSupport: {
	longtask: number | null;
	layoutShift: number | null;
} = { longtask: null, layoutShift: null };

const CONTRACTS: readonly MetricContract[] = freezeDeep([
	{
		name: "rAF.gap.50ms",
		kind: "counter",
		unit: "count",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description: "rAF callbacks whose inter-frame gap exceeded 50ms",
	},
	{
		name: "rAF.gap.100ms",
		kind: "counter",
		unit: "count",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description: "rAF callbacks whose inter-frame gap exceeded 100ms",
	},
	{
		name: "main.longtask.count",
		kind: "counter",
		unit: "count",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description:
			"long task entries observed since install/reset; initialized to 0 when the observer is supported",
	},
	{
		name: "main.longtask.ms",
		kind: "timing",
		unit: "ms",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description: "long task durations as a cumulative session timing bucket",
	},
	{
		name: "layout.shift.count",
		kind: "counter",
		unit: "count",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description:
			"layout shift entries observed since install/reset; initialized to 0 when the observer is supported",
	},
	{
		name: "layout.shift.last",
		kind: "gauge",
		unit: "score",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description: "most recent layout shift score",
	},
	{
		name: "observer.longtask",
		kind: "gauge",
		unit: "1",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description:
			"1 when the longtask observer installed, 0 when unsupported; absent before the first install so a panel can distinguish unsupported from zero events",
	},
	{
		name: "observer.layout-shift",
		kind: "gauge",
		unit: "1",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description:
			"1 when the layout-shift observer installed, 0 when unsupported; absent before the first install so a panel can distinguish unsupported from zero events",
	},
	{
		name: "pty.input",
		kind: "rate",
		unit: "bytes/s",
		windowMs: RATE_WINDOW_MS,
		maxSamples: RATE_CAPACITY,
		availability: "dev-only",
		description:
			"actual PTY input bytes reported by the parent over the trailing one-second window; bytesPerSec is the raw in-window sum, evictions count capacity drops",
	},
	{
		name: "pty.output",
		kind: "rate",
		unit: "bytes/s",
		windowMs: RATE_WINDOW_MS,
		maxSamples: RATE_CAPACITY,
		availability: "dev-only",
		description:
			"actual PTY output bytes reported by the parent over the trailing one-second window; bytesPerSec is the raw in-window sum, evictions count capacity drops",
	},
	{
		name: "input.events",
		kind: "rate",
		unit: "events/s",
		windowMs: RATE_WINDOW_MS,
		maxSamples: RATE_CAPACITY,
		availability: "dev-only",
		description:
			"terminal onData input events over the trailing one-second window",
	},
	{
		name: "write.enqueue.calls",
		kind: "counter",
		unit: "count",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description: "term write opens via beginTermWrite",
	},
	{
		name: "write.enqueue.bytes",
		kind: "counter",
		unit: "bytes",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description: "bytes handed into term writes via beginTermWrite",
	},
	{
		name: "write.latency.ms",
		kind: "latency",
		unit: "ms",
		windowMs: LATENCY_WINDOW_MS,
		maxSamples: LATENCY_CAPACITY,
		availability: "dev-only",
		description:
			"handed-to-write to write completion callback latency; p50/p95/max are computed over the bounded rolling window and are null when the window is empty",
	},
	{
		name: "write.tokens",
		kind: "token",
		unit: "count",
		windowMs: null,
		maxSamples: WRITE_TOKEN_MAX,
		availability: "dev-only",
		description:
			"in-flight term write token lifecycle counts; started reconciles as started = outstanding + completed + expired + cancelled + overflow",
	},
	{
		name: "rAF.gap",
		kind: "latency",
		unit: "ms",
		windowMs: LATENCY_WINDOW_MS,
		maxSamples: LATENCY_CAPACITY,
		availability: "dev-only",
		description:
			"inter-frame rAF callback cadence as a rolling gap distribution; cadence only, not FPS/presentation, and sampling pauses while the document is hidden",
	},
	{
		name: "rAF.state",
		kind: "state",
		unit: "1",
		windowMs: null,
		maxSamples: null,
		availability: "dev-only",
		description:
			"active|paused rAF sampling state with pausedAt and staleMs exposing hidden/paused periods explicitly",
	},
]);

function readEnabled(): boolean {
	try {
		return (
			localStorage.getItem(PERF_KEY) === "1" ||
			new URLSearchParams(location.search).has("parttyPerf")
		);
	} catch {
		return false;
	}
}

function readConsoleEnabled(): boolean {
	try {
		return (
			localStorage.getItem(PERF_CONSOLE_KEY) === "1" ||
			new URLSearchParams(location.search).has("parttyPerfConsole")
		);
	} catch {
		return false;
	}
}

function readIntervalMs(): number {
	try {
		const raw = localStorage.getItem(PERF_INTERVAL_MS_KEY);
		const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
		return Number.isFinite(n) ? Math.max(1000, Math.min(60_000, n)) : 5000;
	} catch {
		return 5000;
	}
}

function clearConsoleTimer(): void {
	if (consoleTimer) {
		window.clearInterval(consoleTimer);
		consoleTimer = 0;
	}
}

function syncConsoleTimer(): void {
	clearConsoleTimer();
	if (!(parttyPerf.enabled && parttyPerf.consoleEnabled)) return;
	consoleTimer = window.setInterval(() => {
		// biome-ignore lint/suspicious/noConsole: This optional diagnostics timer intentionally writes performance snapshots to the console.
		console.debug("[partty:perf]", parttyPerf.snapshot());
	}, parttyPerf.consoleIntervalMs);
}

function startFrameProbe(): void {
	if (rafHandle !== 0 || !parttyPerf.enabled) return;
	if (document.hidden) {
		rafState = "paused";
		rafPausedAt = performance.now();
		rafLastSampleAt = performance.now();
		return;
	}
	rafState = "active";
	rafPausedAt = null;
	rafLast = 0;
	const tick = (now: number): void => {
		if (!parttyPerf.enabled || rafHandle === 0) return;
		if (document.hidden) {
			rafHandle = 0;
			rafState = "paused";
			rafPausedAt = now;
			rafLastSampleAt = now;
			return;
		}
		if (rafLast > 0) {
			const delta = now - rafLast;
			if (delta > 0) {
				pushLatency(rAFGapWindow, now, delta);
				if (delta > 50) {
					counters["rAF.gap.50ms"] = (counters["rAF.gap.50ms"] ?? 0) + 1;
				}
				if (delta > 100) {
					counters["rAF.gap.100ms"] = (counters["rAF.gap.100ms"] ?? 0) + 1;
				}
			}
		}
		rafLast = now;
		rafLastSampleAt = now;
		rafHandle = requestAnimationFrame(tick);
	};
	rafHandle = requestAnimationFrame(tick);
}

function stopFrameProbe(): void {
	if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
	rafHandle = 0;
	rafState = "paused";
	rafPausedAt = performance.now();
}

function syncVisibilityListener(): void {
	if (visibilityListener) {
		document.removeEventListener("visibilitychange", visibilityListener);
		visibilityListener = null;
	}
	if (!parttyPerf.enabled) return;
	visibilityListener = (): void => {
		if (document.hidden) {
			if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
			rafHandle = 0;
			rafState = "paused";
			rafPausedAt = performance.now();
			rafLastSampleAt = performance.now();
		} else {
			startFrameProbe();
		}
	};
	document.addEventListener("visibilitychange", visibilityListener);
}

function discardObserverRecords(): void {
	for (const observer of performanceObservers) {
		try {
			(
				observer as PerformanceObserver & {
					takeRecords?: () => unknown[];
				}
			).takeRecords?.();
		} catch {
			/* ignore */
		}
	}
}

function assertObserverSupportState(): void {
	if (observerSupport.longtask !== null) {
		gauges["observer.longtask"] = observerSupport.longtask;
		if (observerSupport.longtask === 1) counters["main.longtask.count"] = 0;
	}
	if (observerSupport.layoutShift !== null) {
		gauges["observer.layout-shift"] = observerSupport.layoutShift;
		if (observerSupport.layoutShift === 1) counters["layout.shift.count"] = 0;
	}
}

function installPerformanceObservers(): void {
	if (observersInstalled) return;
	observersInstalled = true;
	if (typeof PerformanceObserver === "undefined") {
		observerSupport.longtask = 0;
		observerSupport.layoutShift = 0;
		gauges["observer.longtask"] = 0;
		gauges["observer.layout-shift"] = 0;
		return;
	}
	try {
		const longTaskObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				parttyPerf.mark("main.longtask.count");
				parttyPerf.time("main.longtask.ms", entry.duration);
			}
		});
		longTaskObserver.observe({ type: "longtask", buffered: false });
		performanceObservers.push(longTaskObserver);
		observerSupport.longtask = 1;
		gauges["observer.longtask"] = 1;
		counters["main.longtask.count"] = 0;
	} catch {
		/* unsupported in some WebView2 builds */
		observerSupport.longtask = 0;
		gauges["observer.longtask"] = 0;
	}
	try {
		const layoutShiftObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const value = (entry as PerformanceEntry & { value?: number }).value;
				if (typeof value === "number") {
					parttyPerf.mark("layout.shift.count");
					parttyPerf.gauge("layout.shift.last", value);
				}
			}
		});
		layoutShiftObserver.observe({ type: "layout-shift", buffered: false });
		performanceObservers.push(layoutShiftObserver);
		observerSupport.layoutShift = 1;
		gauges["observer.layout-shift"] = 1;
		counters["layout.shift.count"] = 0;
	} catch {
		/* unsupported in some WebView2 builds */
		observerSupport.layoutShift = 0;
		gauges["observer.layout-shift"] = 0;
	}
}

function disconnectPerformanceObservers(): void {
	discardObserverRecords();
	for (const observer of performanceObservers) {
		try {
			observer.disconnect();
		} catch {
			/* ignore */
		}
	}
	performanceObservers = [];
	observersInstalled = false;
}

function writeTokensOutstandingForPane(paneId: string): number {
	let n = 0;
	for (const entry of writeTokens.byId.values()) {
		if (entry.paneId === paneId) n++;
	}
	return n;
}

function bumpPaneTokenTally(
	paneId: string,
	key: "started" | "completed" | "expired" | "cancelled" | "overflow",
): void {
	let tally = paneWriteTokens.get(paneId);
	if (!tally) {
		tally = { started: 0, completed: 0, expired: 0, cancelled: 0, overflow: 0 };
		paneWriteTokens.set(paneId, tally);
	}
	tally[key]++;
}

function sweepExpiredTokens(now: number): void {
	const expired = pruneExpiredWriteTokens(writeTokens, now);
	for (const entry of expired) {
		bumpPaneTokenTally(entry.paneId, "expired");
	}
}

export const parttyPerf = {
	enabled: readEnabled(),
	consoleEnabled: readConsoleEnabled(),
	consoleIntervalMs: readIntervalMs(),
	observersInstalled: false,
	configure(opts: {
		enabled?: boolean;
		consoleEnabled?: boolean;
		consoleIntervalMs?: number;
		reset?: boolean;
	}): void {
		const wasEnabled = this.enabled;
		if (typeof opts.enabled === "boolean") this.enabled = opts.enabled;
		if (typeof opts.consoleEnabled === "boolean")
			this.consoleEnabled = opts.consoleEnabled;
		if (
			typeof opts.consoleIntervalMs === "number" &&
			Number.isFinite(opts.consoleIntervalMs)
		) {
			this.consoleIntervalMs = Math.max(
				1000,
				Math.min(60_000, Math.floor(opts.consoleIntervalMs)),
			);
		}
		try {
			localStorage.setItem(PERF_KEY, this.enabled ? "1" : "0");
			localStorage.setItem(PERF_CONSOLE_KEY, this.consoleEnabled ? "1" : "0");
			localStorage.setItem(
				PERF_INTERVAL_MS_KEY,
				String(this.consoleIntervalMs),
			);
		} catch {
			/* localStorage unavailable */
		}
		if (opts.reset) this.reset();
		if (this.enabled) {
			installPerformanceObservers();
			startFrameProbe();
			syncVisibilityListener();
		} else {
			disconnectPerformanceObservers();
			stopFrameProbe();
			syncVisibilityListener();
			const cancelled = resetWriteTokens(writeTokens);
			for (const entry of cancelled) {
				bumpPaneTokenTally(entry.paneId, "cancelled");
			}
		}
		syncConsoleTimer();
		if (!wasEnabled && this.enabled) {
			sessionStartedAt = performance.now();
			this.mark("perf.enabled");
		}
	},
	mark(name: string, amount = 1): void {
		if (!(this.enabled && Number.isFinite(amount) && amount >= 0)) return;
		counters[name] = (counters[name] ?? 0) + amount;
	},
	gauge(name: string, value: number): void {
		if (!(this.enabled && Number.isFinite(value))) return;
		gauges[name] = value;
	},
	time(name: string, ms: number): void {
		if (!(this.enabled && Number.isFinite(ms) && ms >= 0)) return;
		const bucket = timings[name] ?? {
			count: 0,
			totalMs: 0,
			maxMs: 0,
			minMs: Number.POSITIVE_INFINITY,
			lastMs: 0,
		};
		bucket.count++;
		bucket.totalMs += ms;
		bucket.maxMs = Math.max(bucket.maxMs, ms);
		bucket.minMs = Math.min(bucket.minMs, ms);
		bucket.lastMs = ms;
		timings[name] = bucket;
	},
	measure(name: string, start: number): void {
		this.time(name, performance.now() - start);
	},
	snapshot(): ParttyPerfSnapshot {
		const now = performance.now();
		sweepExpiredTokens(now);
		return freezeDeep({
			counters: { ...counters },
			gauges: { ...gauges },
			timings: Object.fromEntries(
				Object.entries(timings).map(([key, value]) => [key, { ...value }]),
			),
			rates: {
				in: rateSummary(globalInRate, now),
				out: rateSummary(globalOutRate, now),
			},
			writeLatency: latencySummary(globalWriteLatency, now),
			writeTokens: tokenCounts(writeTokens),
			rAF: {
				state: rafState,
				pausedAt: rafPausedAt,
				staleMs:
					rafState === "paused" && rafLastSampleAt !== null
						? now - rafLastSampleAt
						: 0,
				gap: latencySummary(rAFGapWindow, now),
			},
			meta: {
				schemaVersion: SNAPSHOT_SCHEMA_VERSION,
				capturedAt: now,
				sessionStartedAt,
				epoch: writeTokens.epoch,
				enabled: this.enabled,
			},
		});
	},
	snapshotJson(): string {
		return JSON.stringify(this.snapshot());
	},
	toJSON(): ParttyPerfSnapshot {
		return this.snapshot();
	},
	contracts(): readonly MetricContract[] {
		return CONTRACTS;
	},
	paneMark(paneId: string, name: string, amount = 1): void {
		if (!(this.enabled && Number.isFinite(amount) && amount >= 0)) return;
		let bucket = paneCounters.get(paneId);
		if (!bucket) {
			bucket = {};
			paneCounters.set(paneId, bucket);
		}
		bucket[name] = (bucket[name] ?? 0) + amount;
	},
	paneGauge(paneId: string, name: string, value: number): void {
		if (!(this.enabled && Number.isFinite(value))) return;
		let bucket = paneGauges.get(paneId);
		if (!bucket) {
			bucket = {};
			paneGauges.set(paneId, bucket);
		}
		bucket[name] = value;
	},
	paneTime(paneId: string, name: string, ms: number): void {
		if (!(this.enabled && Number.isFinite(ms) && ms >= 0)) return;
		let bucket = paneTimings.get(paneId);
		if (!bucket) {
			bucket = {};
			paneTimings.set(paneId, bucket);
		}
		const entry = bucket[name] ?? {
			count: 0,
			totalMs: 0,
			maxMs: 0,
			minMs: Number.POSITIVE_INFINITY,
			lastMs: 0,
		};
		entry.count++;
		entry.totalMs += ms;
		entry.maxMs = Math.max(entry.maxMs, ms);
		entry.minMs = Math.min(entry.minMs, ms);
		entry.lastMs = ms;
		bucket[name] = entry;
	},
	paneMeasure(paneId: string, name: string, start: number): void {
		this.paneTime(paneId, name, performance.now() - start);
	},
	getPaneSnapshot(paneId: string): PanePerfSnapshot | null {
		sweepExpiredTokens(performance.now());
		const paneCountersEntry = paneCounters.get(paneId);
		const paneGaugesEntry = paneGauges.get(paneId);
		const paneTimingsEntry = paneTimings.get(paneId);
		const inRate = paneInRates.get(paneId);
		const outRate = paneOutRates.get(paneId);
		const latency = paneWriteLatency.get(paneId);
		const tally = paneWriteTokens.get(paneId);
		if (
			!(
				paneCountersEntry ||
				paneGaugesEntry ||
				paneTimingsEntry ||
				inRate ||
				outRate ||
				latency ||
				tally
			)
		) {
			return null;
		}
		const now = performance.now();
		return freezeDeep({
			capturedAt: now,
			counters: paneCountersEntry ? { ...paneCountersEntry } : {},
			gauges: paneGaugesEntry ? { ...paneGaugesEntry } : {},
			timings: paneTimingsEntry
				? Object.fromEntries(
						Object.entries(paneTimingsEntry).map(([key, value]) => [
							key,
							{ ...value },
						]),
					)
				: {},
			rates: {
				in: inRate ? rateSummary(inRate, now) : null,
				out: outRate ? rateSummary(outRate, now) : null,
			},
			writeLatency: latency ? latencySummary(latency, now) : null,
			writeTokens: {
				started: tally?.started ?? 0,
				outstanding: writeTokensOutstandingForPane(paneId),
				completed: tally?.completed ?? 0,
				expired: tally?.expired ?? 0,
				cancelled: tally?.cancelled ?? 0,
				overflow: tally?.overflow ?? 0,
			},
		});
	},
	getAllPaneIds(): string[] {
		const ids = new Set<string>();
		for (const id of paneCounters.keys()) ids.add(id);
		for (const id of paneGauges.keys()) ids.add(id);
		for (const id of paneTimings.keys()) ids.add(id);
		for (const id of paneInRates.keys()) ids.add(id);
		for (const id of paneOutRates.keys()) ids.add(id);
		for (const id of paneWriteLatency.keys()) ids.add(id);
		for (const id of paneWriteTokens.keys()) ids.add(id);
		for (const entry of writeTokens.byId.values()) ids.add(entry.paneId);
		return Array.from(ids).sort();
	},
	resetPane(paneId: string): void {
		paneCounters.delete(paneId);
		paneGauges.delete(paneId);
		paneTimings.delete(paneId);
		paneInRates.delete(paneId);
		paneOutRates.delete(paneId);
		paneWriteLatency.delete(paneId);
		paneWriteTokens.delete(paneId);
		cancelWriteTokensForPane(writeTokens, paneId);
	},
	recordPtyInputBytes(paneId: string, bytes: number): void {
		if (!(this.enabled && Number.isFinite(bytes) && bytes > 0)) return;
		const now = performance.now();
		pushRate(globalInRate, now, bytes);
		let w = paneInRates.get(paneId);
		if (!w) {
			w = createRateWindow({
				windowMs: RATE_WINDOW_MS,
				capacity: RATE_CAPACITY,
			});
			paneInRates.set(paneId, w);
		}
		pushRate(w, now, bytes);
		this.paneMark(paneId, "pty.input.bytes", bytes);
	},
	recordPtyOutputBytes(paneId: string, bytes: number): void {
		if (!(this.enabled && Number.isFinite(bytes) && bytes > 0)) return;
		const now = performance.now();
		pushRate(globalOutRate, now, bytes);
		let w = paneOutRates.get(paneId);
		if (!w) {
			w = createRateWindow({
				windowMs: RATE_WINDOW_MS,
				capacity: RATE_CAPACITY,
			});
			paneOutRates.set(paneId, w);
		}
		pushRate(w, now, bytes);
		this.paneMark(paneId, "pty.output.bytes", bytes);
	},
	getPtyInputRate(paneId: string): RateSummary | null {
		const w = paneInRates.get(paneId);
		if (!w) return null;
		return freezeDeep(rateSummary(w, performance.now()));
	},
	getPtyOutputRate(paneId: string): RateSummary | null {
		const w = paneOutRates.get(paneId);
		if (!w) return null;
		return freezeDeep(rateSummary(w, performance.now()));
	},
	recordInputEvent(): void {
		if (!this.enabled) return;
		pushRate(inputEventRate, performance.now(), 1);
	},
	getInputRate(): number {
		return rateSummary(inputEventRate, performance.now()).bytesPerSec;
	},
	beginTermWrite(paneId: string, bytes: number): WriteToken {
		if (!this.enabled) return { id: 0, paneId, epoch: 0 };
		const now = performance.now();
		const result = beginWriteToken(writeTokens, now, paneId, bytes);
		for (const entry of result.expired) {
			bumpPaneTokenTally(entry.paneId, "expired");
		}
		if (result.evictedPaneId !== null) {
			bumpPaneTokenTally(result.evictedPaneId, "overflow");
		}
		bumpPaneTokenTally(paneId, "started");
		this.mark("write.enqueue.calls");
		this.paneMark(paneId, "write.enqueue.calls");
		if (Number.isFinite(bytes) && bytes > 0) {
			this.mark("write.enqueue.bytes", bytes);
			this.paneMark(paneId, "write.enqueue.bytes", bytes);
		}
		return result.token;
	},
	finishTermWrite(token: WriteToken): void {
		if (!this.enabled) return;
		const now = performance.now();
		const result = finishWriteToken(writeTokens, now, token);
		if (result.status === "completed") {
			pushLatency(globalWriteLatency, now, result.ageMs);
			let w = paneWriteLatency.get(result.paneId);
			if (!w) {
				w = createLatencyWindow({
					windowMs: LATENCY_WINDOW_MS,
					capacity: LATENCY_CAPACITY,
				});
				paneWriteLatency.set(result.paneId, w);
			}
			pushLatency(w, now, result.ageMs);
			bumpPaneTokenTally(result.paneId, "completed");
		} else if (result.status === "expired") {
			bumpPaneTokenTally(result.paneId, "expired");
		}
	},
	cancelTermWrite(token: WriteToken): void {
		if (!this.enabled) return;
		if (cancelWriteToken(writeTokens, token)) {
			bumpPaneTokenTally(token.paneId, "cancelled");
		}
	},
	reset(): void {
		discardObserverRecords();
		for (const key of Object.keys(counters)) delete counters[key];
		for (const key of Object.keys(gauges)) delete gauges[key];
		for (const key of Object.keys(timings)) delete timings[key];
		paneCounters.clear();
		paneGauges.clear();
		paneTimings.clear();
		paneInRates.clear();
		paneOutRates.clear();
		paneWriteLatency.clear();
		paneWriteTokens.clear();
		resetLatencyWindow(globalWriteLatency);
		resetLatencyWindow(rAFGapWindow);
		resetRateWindow(globalInRate);
		resetRateWindow(globalOutRate);
		resetRateWindow(inputEventRate);
		resetWriteTokens(writeTokens);
		rafLast = 0;
		rafLastSampleAt = null;
		assertObserverSupportState();
	},
	dispose(): void {
		this.enabled = false;
		this.consoleEnabled = false;
		try {
			localStorage.setItem(PERF_KEY, "0");
			localStorage.setItem(PERF_CONSOLE_KEY, "0");
		} catch {
			/* localStorage unavailable */
		}
		disconnectPerformanceObservers();
		stopFrameProbe();
		syncVisibilityListener();
		clearConsoleTimer();
		this.reset();
	},
};

declare global {
	interface Window {
		__parttyPerf?: typeof parttyPerf;
	}
}

window.__parttyPerf = parttyPerf;
parttyPerf.configure({
	enabled: parttyPerf.enabled,
	consoleEnabled: parttyPerf.consoleEnabled,
	consoleIntervalMs: parttyPerf.consoleIntervalMs,
});
