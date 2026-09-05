import {
	PERF_CONSOLE_KEY,
	PERF_INTERVAL_MS_KEY,
	PERF_KEY,
} from "./../util/storageKeys";

type TimingBucket = {
	count: number;
	totalMs: number;
	maxMs: number;
	minMs: number;
	lastMs: number;
};

export type ParttyPerfSnapshot = {
	counters: Record<string, number>;
	gauges: Record<string, number>;
	timings: Record<string, TimingBucket>;
};

const counters: Record<string, number> = {};
const gauges: Record<string, number> = {};
const timings: Record<string, TimingBucket> = {};
let consoleTimer = 0;
let frameRaf = 0;
let frameLast = 0;
let frameWindowStarted = 0;
let frameCount = 0;

const paneCounters = new Map<string, Record<string, number>>();
const paneGauges = new Map<string, Record<string, number>>();
const paneTimings = new Map<string, Record<string, TimingBucket>>();

type ThroughputWindow = {
	totalBytes: number;
	times: Float64Array;
	bytes: Float64Array;
	head: number;
	count: number;
	sum: number;
};

const THROUGHPUT_SLOTS = 4096;
const THROUGHPUT_MASK = THROUGHPUT_SLOTS - 1;

function createThroughputWindow(): ThroughputWindow {
	return {
		totalBytes: 0,
		times: new Float64Array(THROUGHPUT_SLOTS),
		bytes: new Float64Array(THROUGHPUT_SLOTS),
		head: 0,
		count: 0,
		sum: 0,
	};
}

function recordThroughput(
	w: ThroughputWindow,
	now: number,
	bytes: number,
): void {
	w.totalBytes += bytes;
	if (w.count === THROUGHPUT_SLOTS) {
		w.sum -= w.bytes[w.head];
		w.head = (w.head + 1) & THROUGHPUT_MASK;
		w.count--;
	}
	w.times[w.head] = now;
	w.bytes[w.head] = bytes;
	w.head = (w.head + 1) & THROUGHPUT_MASK;
	w.count++;
	w.sum += bytes;
}

function pruneThroughput(w: ThroughputWindow, cutoff: number): void {
	while (w.count > 0) {
		const oldest = (w.head - w.count) & THROUGHPUT_MASK;
		if (w.times[oldest] >= cutoff) break;
		w.sum -= w.bytes[oldest];
		w.count--;
	}
}

function getThroughputRate(
	w: ThroughputWindow,
	now: number,
): { bytesPerSec: number; totalBytes: number } | null {
	if (w.count === 0) return null;
	pruneThroughput(w, now - 1000);
	if (w.count === 0) return null;
	return { bytesPerSec: w.sum, totalBytes: w.totalBytes };
}

const ptyInputThroughput = new Map<string, ThroughputWindow>();
const ptyOutputThroughput = new Map<string, ThroughputWindow>();

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
	if (frameRaf || !parttyPerf.enabled) return;
	frameLast = performance.now();
	frameWindowStarted = frameLast;
	frameCount = 0;
	const tick = (now: number): void => {
		if (!parttyPerf.enabled) {
			frameRaf = 0;
			return;
		}
		const delta = now - frameLast;
		frameLast = now;
		frameCount++;
		parttyPerf.mark("frame.count");
		parttyPerf.time("frame.delta.ms", delta);
		if (delta > 50) parttyPerf.mark("frame.long_50ms");
		if (delta > 100) parttyPerf.mark("frame.long_100ms");
		const elapsed = now - frameWindowStarted;
		if (elapsed >= 1000) {
			parttyPerf.gauge("frame.fps", (frameCount * 1000) / elapsed);
			frameWindowStarted = now;
			frameCount = 0;
		}
		frameRaf = requestAnimationFrame(tick);
	};
	frameRaf = requestAnimationFrame(tick);
}

function stopFrameProbe(): void {
	if (frameRaf) cancelAnimationFrame(frameRaf);
	frameRaf = 0;
}

function installPerformanceObservers(): void {
	if (typeof PerformanceObserver === "undefined") return;
	try {
		const paintObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				parttyPerf.time(`paint.${entry.name}.ms`, entry.startTime);
				parttyPerf.mark("paint.entries");
			}
		});
		paintObserver.observe({ type: "paint", buffered: true });
	} catch {
		/* unsupported in some WebView2 builds */
	}
	try {
		const longTaskObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				parttyPerf.mark("main.longtask.count");
				parttyPerf.time("main.longtask.ms", entry.duration);
			}
		});
		longTaskObserver.observe({ type: "longtask", buffered: true });
	} catch {
		/* unsupported in some WebView2 builds */
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
		layoutShiftObserver.observe({ type: "layout-shift", buffered: true });
	} catch {
		/* unsupported in some WebView2 builds */
	}
}

const INPUT_EVENT_SLOTS = 4096;
const INPUT_EVENT_MASK = INPUT_EVENT_SLOTS - 1;
const inputEventTimes = new Float64Array(INPUT_EVENT_SLOTS);
let inputEventHead = 0;
let inputEventCount = 0;

function pruneInputEvents(cutoff: number): void {
	while (inputEventCount > 0) {
		const oldest = (inputEventHead - inputEventCount) & INPUT_EVENT_MASK;
		if (inputEventTimes[oldest] >= cutoff) break;
		inputEventCount--;
	}
}

type PtyRoundtripProbe = {
	paneId: string;
	ts: number;
	keydownTs: number | null;
};

/**
 * Earliest-first probes of latency-sensitive PTY writes still awaiting their
 * echo. Completed by the first output arrival for the same pane.
 */
const ptyRoundtripProbes: PtyRoundtripProbe[] = [];
/** Per-pane timestamp of the last `term.write`, awaiting the next render. */
const termRenderProbes = new Map<string, number>();
const PTY_PROBE_MAX = 64;
const PTY_PROBE_EXPIRE_MS = 500;

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
		if (this.enabled && !this.observersInstalled) {
			this.observersInstalled = true;
			installPerformanceObservers();
		}
		if (this.enabled) startFrameProbe();
		else stopFrameProbe();
		syncConsoleTimer();
		if (!wasEnabled && this.enabled) this.mark("perf.enabled");
	},
	mark(name: string, amount = 1): void {
		if (!this.enabled) return;
		counters[name] = (counters[name] ?? 0) + amount;
	},
	gauge(name: string, value: number): void {
		if (!(this.enabled && Number.isFinite(value))) return;
		gauges[name] = value;
	},
	time(name: string, ms: number): void {
		if (!(this.enabled && Number.isFinite(ms))) return;
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
		return {
			counters: { ...counters },
			gauges: { ...gauges },
			timings: Object.fromEntries(
				Object.entries(timings).map(([key, value]) => [key, { ...value }]),
			),
		};
	},
	paneMark(paneId: string, name: string, amount = 1): void {
		if (!this.enabled) return;
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
		if (!(this.enabled && Number.isFinite(ms))) return;
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
	getPaneSnapshot(paneId: string): ParttyPerfSnapshot | null {
		const counters = paneCounters.get(paneId);
		const gauges = paneGauges.get(paneId);
		const timings = paneTimings.get(paneId);
		if (!(counters || gauges || timings)) return null;
		return {
			counters: counters ? { ...counters } : {},
			gauges: gauges ? { ...gauges } : {},
			timings: timings
				? Object.fromEntries(
						Object.entries(timings).map(([k, v]) => [k, { ...v }]),
					)
				: {},
		};
	},
	getAllPaneIds(): string[] {
		const ids = new Set<string>();
		for (const id of paneCounters.keys()) ids.add(id);
		for (const id of paneGauges.keys()) ids.add(id);
		for (const id of paneTimings.keys()) ids.add(id);
		return Array.from(ids).sort();
	},
	resetPane(paneId: string): void {
		paneCounters.delete(paneId);
		paneGauges.delete(paneId);
		paneTimings.delete(paneId);
		ptyInputThroughput.delete(paneId);
		ptyOutputThroughput.delete(paneId);
		termRenderProbes.delete(paneId);
		for (let i = ptyRoundtripProbes.length - 1; i >= 0; i--) {
			if (ptyRoundtripProbes[i].paneId === paneId)
				ptyRoundtripProbes.splice(i, 1);
		}
	},
	recordPtyInputBytes(paneId: string, bytes: number): void {
		if (!this.enabled || bytes <= 0) return;
		let w = ptyInputThroughput.get(paneId);
		if (!w) {
			w = createThroughputWindow();
			ptyInputThroughput.set(paneId, w);
		}
		recordThroughput(w, performance.now(), bytes);
		this.paneMark(paneId, "pty.input.bytes", bytes);
	},
	recordPtyOutputBytes(paneId: string, bytes: number): void {
		if (!this.enabled || bytes <= 0) return;
		let w = ptyOutputThroughput.get(paneId);
		if (!w) {
			w = createThroughputWindow();
			ptyOutputThroughput.set(paneId, w);
		}
		recordThroughput(w, performance.now(), bytes);
		this.paneMark(paneId, "pty.output.bytes", bytes);
	},
	getPtyInputRate(
		paneId: string,
	): { bytesPerSec: number; totalBytes: number } | null {
		const w = ptyInputThroughput.get(paneId);
		if (!w) return null;
		return getThroughputRate(w, performance.now());
	},
	getPtyOutputRate(
		paneId: string,
	): { bytesPerSec: number; totalBytes: number } | null {
		const w = ptyOutputThroughput.get(paneId);
		if (!w) return null;
		return getThroughputRate(w, performance.now());
	},
	recordInputEvent(): void {
		if (!this.enabled) return;
		const now = performance.now();
		if (inputEventCount === INPUT_EVENT_SLOTS) {
			inputEventHead = (inputEventHead + 1) & INPUT_EVENT_MASK;
			inputEventCount--;
		}
		inputEventTimes[inputEventHead] = now;
		inputEventHead = (inputEventHead + 1) & INPUT_EVENT_MASK;
		inputEventCount++;
		pruneInputEvents(now - 200);
		this.gauge("input.events.200ms", inputEventCount);
	},
	getInputRate(): number {
		pruneInputEvents(performance.now() - 1000);
		return inputEventCount;
	},
	/**
	 * Mark a latency-sensitive PTY write that is expected to be echoed back.
	 * `keydownTs` (when provided) anchors the full keydown→arrival chain.
	 */
	beginPtyRoundtrip(paneId: string, keydownTs: number | null = null): void {
		if (!this.enabled) return;
		if (ptyRoundtripProbes.length >= PTY_PROBE_MAX) ptyRoundtripProbes.shift();
		ptyRoundtripProbes.push({ paneId, ts: performance.now(), keydownTs });
	},
	/** Complete the oldest live roundtrip probe for a pane on output arrival. */
	completePtyRoundtrip(paneId: string): void {
		if (!this.enabled || ptyRoundtripProbes.length === 0) return;
		const now = performance.now();
		const cutoff = now - PTY_PROBE_EXPIRE_MS;
		let earliest: PtyRoundtripProbe | null = null;
		let earliestIdx = -1;
		for (let i = 0; i < ptyRoundtripProbes.length; i++) {
			const p = ptyRoundtripProbes[i];
			if (p.paneId !== paneId) continue;
			if (p.ts < cutoff) {
				ptyRoundtripProbes.splice(i, 1);
				i--;
				continue;
			}
			if (!earliest || p.ts < earliest.ts) {
				earliest = p;
				earliestIdx = i;
			}
		}
		if (!earliest || earliestIdx < 0) return;
		ptyRoundtripProbes.splice(earliestIdx, 1);
		const delta = now - earliest.ts;
		this.time("input.pty.roundtrip.ms", delta);
		this.paneTime(paneId, "input.pty.roundtrip.ms", delta);
		if (earliest.keydownTs !== null && earliest.keydownTs >= cutoff) {
			const keyToArrival = now - earliest.keydownTs;
			this.time("input.keydown.to.arrival.ms", keyToArrival);
			this.paneTime(paneId, "input.keydown.to.arrival.ms", keyToArrival);
		}
	},
	/** Mark the start of a `term.write`; the next render for the pane completes it. */
	beginTermWrite(paneId: string): void {
		if (!this.enabled) return;
		termRenderProbes.set(paneId, performance.now());
	},
	/** Called from the pane's `onRender`; records write→drawn latency. */
	finishTermRender(paneId: string): void {
		if (!this.enabled || termRenderProbes.size === 0) return;
		const started = termRenderProbes.get(paneId);
		if (started === undefined) return;
		const delta = performance.now() - started;
		termRenderProbes.delete(paneId);
		if (delta > PTY_PROBE_EXPIRE_MS) return;
		this.time("xterm.write.to.render.ms", delta);
		this.paneTime(paneId, "xterm.write.to.render.ms", delta);
	},
	reset(): void {
		for (const key of Object.keys(counters)) delete counters[key];
		for (const key of Object.keys(gauges)) delete gauges[key];
		for (const key of Object.keys(timings)) delete timings[key];
		paneCounters.clear();
		paneGauges.clear();
		paneTimings.clear();
		ptyInputThroughput.clear();
		ptyOutputThroughput.clear();
		inputEventHead = 0;
		inputEventCount = 0;
		ptyRoundtripProbes.length = 0;
		termRenderProbes.clear();
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
