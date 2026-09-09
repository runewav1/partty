export type LatencyWindowOptions = {
	windowMs: number;
	capacity: number;
};

export type LatencyWindow = {
	windowMs: number;
	capacity: number;
	times: Float64Array;
	values: Float64Array;
	head: number;
	count: number;
	evictions: number;
	total: number;
	totalSumMs: number;
	last: number | null;
};

export type LatencySummary = {
	windowMs: number;
	capacity: number;
	n: number;
	p50: number | null;
	p95: number | null;
	max: number | null;
	last: number | null;
	avgMs: number | null;
	evictions: number;
	total: number;
	totalSumMs: number;
};

export type RateWindowOptions = {
	windowMs: number;
	capacity: number;
};

export type RateWindow = {
	windowMs: number;
	capacity: number;
	times: Float64Array;
	bytes: Float64Array;
	head: number;
	count: number;
	evictions: number;
	totalBytes: number;
	lastBytes: number;
};

export type RateSummary = {
	windowMs: number;
	capacity: number;
	samples: number;
	spanMs: number;
	bytesInWindow: number;
	bytesPerSec: number;
	totalBytes: number;
	lastBytes: number;
	evictions: number;
};

export type WriteToken = {
	readonly id: number;
	readonly paneId: string;
	readonly epoch: number;
};

export type WriteTokenEntry = {
	paneId: string;
	epoch: number;
	startedAt: number;
	bytes: number;
};

export type TokenCounts = {
	started: number;
	outstanding: number;
	completed: number;
	expired: number;
	cancelled: number;
	overflow: number;
};

export type WriteTokenRegistry = {
	maxTokens: number;
	expireMs: number;
	epoch: number;
	nextId: number;
	byId: Map<number, WriteTokenEntry>;
	counts: TokenCounts;
};

export type BeginWriteTokenResult = {
	token: WriteToken;
	evictedPaneId: string | null;
	expired: Array<{ paneId: string; bytes: number }>;
};

export type FinishWriteTokenResult =
	| { status: "completed"; ageMs: number; paneId: string; bytes: number }
	| { status: "expired"; paneId: string; bytes: number }
	| { status: "ignored" };

export type TimingBucket = {
	count: number;
	totalMs: number;
	maxMs: number;
	minMs: number;
	lastMs: number;
};

export type MetricKind =
	| "counter"
	| "gauge"
	| "timing"
	| "latency"
	| "rate"
	| "token"
	| "state";

export type MetricContract = {
	name: string;
	kind: MetricKind;
	unit: string;
	windowMs: number | null;
	maxSamples: number | null;
	availability: "dev-only";
	description: string;
};

export type RafState = {
	state: "active" | "paused";
	pausedAt: number | null;
	staleMs: number;
	gap: LatencySummary;
};

export type PerfSessionMetadata = {
	schemaVersion: number;
	capturedAt: number;
	sessionStartedAt: number | null;
	epoch: number;
	enabled: boolean;
};

export type ParttyPerfSnapshot = {
	counters: Record<string, number>;
	gauges: Record<string, number>;
	timings: Record<string, TimingBucket>;
	rates: { in: RateSummary; out: RateSummary };
	writeLatency: LatencySummary;
	writeTokens: TokenCounts;
	rAF: RafState;
	meta: PerfSessionMetadata;
};

export type PanePerfSnapshot = {
	capturedAt: number;
	counters: Record<string, number>;
	gauges: Record<string, number>;
	timings: Record<string, TimingBucket>;
	rates: { in: RateSummary | null; out: RateSummary | null };
	writeLatency: LatencySummary | null;
	writeTokens: TokenCounts;
};

export function createLatencyWindow(opts: LatencyWindowOptions): LatencyWindow {
	return {
		windowMs: opts.windowMs,
		capacity: opts.capacity,
		times: new Float64Array(opts.capacity),
		values: new Float64Array(opts.capacity),
		head: 0,
		count: 0,
		evictions: 0,
		total: 0,
		totalSumMs: 0,
		last: null,
	};
}

export function pushLatency(
	w: LatencyWindow,
	now: number,
	value: number,
): void {
	if (!Number.isFinite(value) || value < 0) return;
	if (w.count === w.capacity) {
		w.count--;
		w.evictions++;
	}
	const idx = w.head;
	w.times[idx] = now;
	w.values[idx] = value;
	w.head = (w.head + 1) % w.capacity;
	w.count++;
	w.total++;
	w.totalSumMs += value;
	w.last = value;
}

export function percentile(
	values: readonly number[],
	p: number,
): number | null {
	const n = values.length;
	if (n === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const pos = (p / 100) * (n - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	if (lo === hi) return sorted[lo] ?? null;
	const lower = sorted[lo] ?? 0;
	const upper = sorted[hi] ?? lower;
	return lower + (upper - lower) * (pos - lo);
}

export function latencySummary(w: LatencyWindow, now: number): LatencySummary {
	const values: number[] = [];
	if (w.count > 0) {
		const start = (w.head - w.count + w.capacity) % w.capacity;
		for (let i = 0; i < w.count; i++) {
			const idx = (start + i) % w.capacity;
			if (now - w.times[idx] <= w.windowMs) values.push(w.values[idx] ?? 0);
		}
	}
	return {
		windowMs: w.windowMs,
		capacity: w.capacity,
		n: values.length,
		p50: percentile(values, 50),
		p95: percentile(values, 95),
		max: values.length > 0 ? Math.max(...values) : null,
		last: w.last,
		avgMs: w.total > 0 ? w.totalSumMs / w.total : null,
		evictions: w.evictions,
		total: w.total,
		totalSumMs: w.totalSumMs,
	};
}

export function resetLatencyWindow(w: LatencyWindow): void {
	w.times.fill(0);
	w.values.fill(0);
	w.head = 0;
	w.count = 0;
	w.evictions = 0;
	w.total = 0;
	w.totalSumMs = 0;
	w.last = null;
}

export function createRateWindow(opts: RateWindowOptions): RateWindow {
	return {
		windowMs: opts.windowMs,
		capacity: opts.capacity,
		times: new Float64Array(opts.capacity),
		bytes: new Float64Array(opts.capacity),
		head: 0,
		count: 0,
		evictions: 0,
		totalBytes: 0,
		lastBytes: 0,
	};
}

export function pushRate(w: RateWindow, now: number, bytes: number): void {
	if (!Number.isFinite(bytes) || bytes <= 0) return;
	if (w.count === w.capacity) {
		w.count--;
		w.evictions++;
	}
	const idx = w.head;
	w.times[idx] = now;
	w.bytes[idx] = bytes;
	w.head = (w.head + 1) % w.capacity;
	w.count++;
	w.totalBytes += bytes;
	w.lastBytes = bytes;
}

export function rateSummary(w: RateWindow, now: number): RateSummary {
	let samples = 0;
	let sum = 0;
	let oldest = 0;
	let newest = 0;
	if (w.count > 0) {
		const start = (w.head - w.count + w.capacity) % w.capacity;
		for (let i = 0; i < w.count; i++) {
			const idx = (start + i) % w.capacity;
			const age = now - w.times[idx];
			if (age < 0 || age > w.windowMs) continue;
			sum += w.bytes[idx] ?? 0;
			if (samples === 0) {
				oldest = w.times[idx] ?? 0;
				newest = oldest;
			} else {
				if ((w.times[idx] ?? 0) < oldest) oldest = w.times[idx] ?? 0;
				if ((w.times[idx] ?? 0) > newest) newest = w.times[idx] ?? 0;
			}
			samples++;
		}
	}
	return {
		windowMs: w.windowMs,
		capacity: w.capacity,
		samples,
		spanMs: samples > 0 ? newest - oldest : 0,
		bytesInWindow: sum,
		bytesPerSec: sum,
		totalBytes: w.totalBytes,
		lastBytes: w.lastBytes,
		evictions: w.evictions,
	};
}

export function resetRateWindow(w: RateWindow): void {
	w.times.fill(0);
	w.bytes.fill(0);
	w.head = 0;
	w.count = 0;
	w.evictions = 0;
	w.totalBytes = 0;
	w.lastBytes = 0;
}

export function createWriteTokenRegistry(opts: {
	maxTokens: number;
	expireMs: number;
}): WriteTokenRegistry {
	return {
		maxTokens: opts.maxTokens,
		expireMs: opts.expireMs,
		epoch: 0,
		nextId: 1,
		byId: new Map(),
		counts: {
			started: 0,
			outstanding: 0,
			completed: 0,
			expired: 0,
			cancelled: 0,
			overflow: 0,
		},
	};
}

export function pruneExpiredWriteTokens(
	r: WriteTokenRegistry,
	now: number,
): Array<{ paneId: string; bytes: number }> {
	const expired: Array<{ paneId: string; bytes: number }> = [];
	for (const [id, entry] of r.byId) {
		if (now - entry.startedAt > r.expireMs) {
			r.byId.delete(id);
			r.counts.expired++;
			r.counts.outstanding--;
			expired.push({ paneId: entry.paneId, bytes: entry.bytes });
		}
	}
	return expired;
}

export function beginWriteToken(
	r: WriteTokenRegistry,
	now: number,
	paneId: string,
	bytes: number,
): BeginWriteTokenResult {
	const expired = pruneExpiredWriteTokens(r, now);
	let evictedPaneId: string | null = null;
	if (r.maxTokens > 0 && r.byId.size >= r.maxTokens) {
		let oldestId = 0;
		let oldestAt = Number.POSITIVE_INFINITY;
		for (const [id, entry] of r.byId) {
			if (entry.startedAt < oldestAt) {
				oldestAt = entry.startedAt;
				oldestId = id;
			}
		}
		if (oldestId !== 0) {
			evictedPaneId = r.byId.get(oldestId)?.paneId ?? null;
			r.byId.delete(oldestId);
			r.counts.overflow++;
			r.counts.outstanding--;
		}
	}
	const token: WriteToken = {
		id: r.nextId++,
		paneId,
		epoch: r.epoch,
	};
	if (r.maxTokens > 0) {
		r.byId.set(token.id, {
			paneId,
			epoch: token.epoch,
			startedAt: now,
			bytes: Math.max(0, Number.isFinite(bytes) ? bytes : 0),
		});
		r.counts.outstanding++;
		r.counts.started++;
	}
	return { token, evictedPaneId, expired };
}

export function finishWriteToken(
	r: WriteTokenRegistry,
	now: number,
	token: WriteToken,
): FinishWriteTokenResult {
	const entry = r.byId.get(token.id);
	if (!entry || entry.epoch !== token.epoch) return { status: "ignored" };
	r.byId.delete(token.id);
	r.counts.outstanding--;
	const age = now - entry.startedAt;
	if (age > r.expireMs) {
		r.counts.expired++;
		return { status: "expired", paneId: entry.paneId, bytes: entry.bytes };
	}
	r.counts.completed++;
	return {
		status: "completed",
		ageMs: age < 0 ? 0 : age,
		paneId: entry.paneId,
		bytes: entry.bytes,
	};
}

export function tokenCounts(r: WriteTokenRegistry): TokenCounts {
	return { ...r.counts };
}

export function cancelWriteToken(
	r: WriteTokenRegistry,
	token: WriteToken,
): boolean {
	const entry = r.byId.get(token.id);
	if (!entry || entry.epoch !== token.epoch) return false;
	r.byId.delete(token.id);
	r.counts.cancelled++;
	r.counts.outstanding--;
	return true;
}

export function resetWriteTokens(
	r: WriteTokenRegistry,
): Array<{ paneId: string; bytes: number }> {
	const cancelled: Array<{ paneId: string; bytes: number }> = [];
	for (const entry of r.byId.values()) {
		cancelled.push({ paneId: entry.paneId, bytes: entry.bytes });
	}
	r.counts.cancelled += cancelled.length;
	r.byId.clear();
	r.counts.outstanding = 0;
	r.epoch++;
	return cancelled;
}

export function cancelWriteTokensForPane(
	r: WriteTokenRegistry,
	paneId: string,
): number {
	let cancelled = 0;
	for (const [id, entry] of r.byId) {
		if (entry.paneId === paneId) {
			r.byId.delete(id);
			r.counts.cancelled++;
			r.counts.outstanding--;
			cancelled++;
		}
	}
	return cancelled;
}

export function freezeDeep<T>(value: T): Readonly<T> {
	if (value !== null && typeof value === "object") {
		if (Array.isArray(value)) {
			for (const item of value) freezeDeep(item);
		} else {
			const record = value as Record<string, unknown>;
			for (const key of Object.keys(record)) freezeDeep(record[key]);
		}
		Object.freeze(value);
	}
	return value as Readonly<T>;
}
