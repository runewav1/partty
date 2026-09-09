import type {
	MetricContract,
	PanePerfSnapshot,
	ParttyPerfSnapshot,
	RateSummary,
	WriteToken,
} from "./metricsCore";

const emptyRateSummary = {
	windowMs: 1000,
	capacity: 0,
	samples: 0,
	spanMs: 0,
	bytesInWindow: 0,
	bytesPerSec: 0,
	totalBytes: 0,
	lastBytes: 0,
	evictions: 0,
};

const emptyLatencySummary = {
	windowMs: 10_000,
	capacity: 0,
	n: 0,
	p50: null,
	p95: null,
	max: null,
	last: null,
	avgMs: null,
	evictions: 0,
	total: 0,
	totalSumMs: 0,
};

const emptySnapshot = (): ParttyPerfSnapshot => ({
	counters: {},
	gauges: {},
	timings: {},
	rates: { in: emptyRateSummary, out: emptyRateSummary },
	writeLatency: emptyLatencySummary,
	writeTokens: {
		started: 0,
		outstanding: 0,
		completed: 0,
		expired: 0,
		cancelled: 0,
		overflow: 0,
	},
	rAF: {
		state: "paused",
		pausedAt: null,
		staleMs: 0,
		gap: emptyLatencySummary,
	},
	meta: {
		schemaVersion: 2,
		capturedAt: 0,
		sessionStartedAt: null,
		epoch: 0,
		enabled: false,
	},
});

/** No-op perf collector — production builds alias `perf.ts` to this file. */
export const parttyPerf = {
	enabled: false,
	consoleEnabled: false,
	consoleIntervalMs: 5000,
	observersInstalled: false,
	configure(): void {},
	mark(): void {},
	gauge(): void {},
	time(): void {},
	measure(): void {},
	snapshot: emptySnapshot,
	snapshotJson(): string {
		return "{}";
	},
	toJSON: emptySnapshot,
	contracts(): readonly MetricContract[] {
		return [];
	},
	paneMark(): void {},
	paneGauge(): void {},
	paneTime(): void {},
	paneMeasure(): void {},
	getPaneSnapshot(): PanePerfSnapshot | null {
		return null;
	},
	getAllPaneIds(): string[] {
		return [];
	},
	resetPane(): void {},
	recordPtyInputBytes(): void {},
	recordPtyOutputBytes(): void {},
	getPtyInputRate(): RateSummary | null {
		return null;
	},
	getPtyOutputRate(): RateSummary | null {
		return null;
	},
	recordInputEvent(): void {},
	getInputRate(): number {
		return 0;
	},
	beginTermWrite(_paneId: string, _bytes: number): WriteToken {
		return { id: 0, paneId: _paneId, epoch: 0 };
	},
	finishTermWrite(): void {},
	cancelTermWrite(): void {},
	reset(): void {},
	dispose(): void {},
};
