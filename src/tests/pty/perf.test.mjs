import assert from "node:assert/strict";
import { test } from "node:test";
import { createVmLoader } from "../support/vm.mjs";

const WRITE_TOKEN_EXPIRE_MS = 2000;
const WRITE_TOKEN_MAX = 256;

async function createEnv({ noPerformanceObserver = false } = {}) {
	const clock = { now: 1000 };
	const raf = { nextId: 0, pending: new Map() };
	const observers = [];
	let visibilityHandler = null;
	const documentMock = {
		hidden: false,
		addEventListener: (type, fn) => {
			if (type === "visibilitychange") visibilityHandler = fn;
		},
		removeEventListener: (type) => {
			if (type === "visibilitychange") visibilityHandler = null;
		},
	};
	const storage = new Map();
	const globals = {
		console,
		performance: { now: () => clock.now },
		localStorage: {
			getItem: (k) => storage.get(k) ?? null,
			setItem: (k, v) => storage.set(k, v),
			removeItem: (k) => storage.delete(k),
		},
		location: { search: "" },
		URLSearchParams,
		document: documentMock,
		window: { setInterval: () => 0, clearInterval: () => {} },
		requestAnimationFrame: (cb) => {
			const id = ++raf.nextId;
			raf.pending.set(id, cb);
			return id;
		},
		cancelAnimationFrame: (id) => {
			raf.pending.delete(id);
		},
	};
	if (!noPerformanceObserver) {
		globals.PerformanceObserver = class {
			constructor(cb) {
				this.cb = cb;
				this.observed = [];
				this.records = [];
				this.disconnected = false;
				observers.push(this);
			}
			observe(opts) {
				this.observed.push(opts);
			}
			disconnect() {
				this.disconnected = true;
				this.records = [];
			}
			takeRecords() {
				const records = this.records;
				this.records = [];
				return records;
			}
			deliver(entries) {
				this.cb({ getEntries: () => entries });
			}
		};
	}
	const loader = createVmLoader({
		root: new URL("../../", import.meta.url),
		globals,
	});
	const entry = await loader.api("pty/perf.ts");
	const pumpRaf = (n = 1) => {
		for (let i = 0; i < n; i++) {
			if (raf.pending.size === 0) return;
			const [id, cb] = raf.pending.entries().next().value;
			raf.pending.delete(id);
			cb(clock.now);
		}
	};
	return {
		parttyPerf: entry.parttyPerf,
		clock,
		raf,
		observers,
		document: documentMock,
		storage,
		pumpRaf,
		hide: () => {
			documentMock.hidden = true;
			visibilityHandler?.();
		},
		show: () => {
			documentMock.hidden = false;
			visibilityHandler?.();
		},
	};
}

test("enable installs unbuffered observers and rAF; disable disconnects", async () => {
	const env = await createEnv();
	const { parttyPerf, observers, raf } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	assert.ok(observers.length >= 2);
	for (const o of observers) {
		for (const opts of o.observed) {
			assert.equal(opts.buffered, false);
		}
	}
	assert.ok(raf.pending.size > 0);
	assert.equal(parttyPerf.snapshot().rAF.state, "active");
	parttyPerf.configure({ enabled: false });
	assert.ok(observers.every((o) => o.disconnected));
	assert.equal(raf.pending.size, 0);
});

test("one-second input/output rates reflect actual bytes from parent", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	parttyPerf.recordPtyInputBytes("1a", 100);
	parttyPerf.recordPtyInputBytes("1a", 100);
	clock.now = 1500;
	parttyPerf.recordPtyInputBytes("1a", 100);
	let rate = parttyPerf.getPtyInputRate("1a");
	assert.equal(rate.totalBytes, 300);
	assert.equal(rate.samples, 3);
	assert.equal(rate.bytesPerSec, 300);
	clock.now = 2001;
	rate = parttyPerf.getPtyInputRate("1a");
	assert.equal(rate.samples, 1);
	assert.equal(rate.bytesPerSec, 100);
	assert.equal(rate.totalBytes, 300);
	assert.equal(parttyPerf.snapshot().rates.in.bytesPerSec, 100);
});

test("term write tokens record enqueue to callback latency", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const token = parttyPerf.beginTermWrite("1a", 42);
	clock.now = 1100;
	parttyPerf.finishTermWrite(token);
	const snap = parttyPerf.snapshot();
	assert.equal(snap.writeLatency.n, 1);
	assert.equal(snap.writeLatency.last, 100);
	assert.equal(snap.writeLatency.p50, 100);
	assert.equal(snap.writeLatency.p95, 100);
	assert.equal(snap.writeTokens.completed, 1);
	assert.equal(snap.writeTokens.outstanding, 0);
	assert.equal(snap.counters["write.enqueue.calls"], 1);
	assert.equal(snap.counters["write.enqueue.bytes"], 42);
	const pane = parttyPerf.getPaneSnapshot("1a");
	assert.equal(pane.writeLatency.last, 100);
	assert.equal(pane.writeTokens.completed, 1);
	assert.equal(pane.rates.out, null);
});

// The pure write-token arithmetic (expiry/capacity/reset) is asserted against
// the registry in metricsCore.test.mjs. The collector facade is not a thin
// passthrough: beginTermWrite/finishTermWrite/cancelTermWrite bump *per-pane*
// tallies for expired/overflow/cancelled/completed, and
// snapshot/getPaneSnapshot sweep expiry with per-pane attribution. The tests
// below assert those facade-only outcomes, so they are not registry duplicates.

test("cancelTermWrite attributes the cancel per pane and ignores the late callback", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const cancelled = parttyPerf.beginTermWrite("1a", 8);
	const live = parttyPerf.beginTermWrite("1b", 5);

	parttyPerf.cancelTermWrite(cancelled);
	let snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.cancelled, 1);
	assert.equal(snap.writeTokens.outstanding, 1);
	const paneA = parttyPerf.getPaneSnapshot("1a");
	const paneB = parttyPerf.getPaneSnapshot("1b");
	assert.equal(paneA.writeTokens.cancelled, 1);
	assert.equal(paneA.writeTokens.started, 1);
	assert.equal(paneB.writeTokens.cancelled, 0);
	assert.equal(paneB.writeTokens.outstanding, 1);

	// A late callback for the cancelled token must not complete or sample latency.
	clock.now = 1100;
	parttyPerf.finishTermWrite(cancelled);
	snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(snap.writeLatency.n, 0);

	// The other pane's token still completes normally.
	parttyPerf.finishTermWrite(live);
	assert.equal(parttyPerf.snapshot().writeTokens.completed, 1);
	assert.equal(parttyPerf.getPaneSnapshot("1b").writeTokens.completed, 1);
	assert.equal(parttyPerf.getPaneSnapshot("1b").writeTokens.cancelled, 0);
});

test("reset cancels outstanding tokens, clears panes and ignores late callbacks", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const a = parttyPerf.beginTermWrite("1a", 5);
	const b = parttyPerf.beginTermWrite("1b", 7);

	parttyPerf.reset();
	let snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.cancelled, 2);
	assert.equal(snap.writeTokens.outstanding, 0);
	assert.equal(snap.writeLatency.n, 0);
	assert.equal(parttyPerf.getPaneSnapshot("1a"), null);
	assert.equal(parttyPerf.getPaneSnapshot("1b"), null);

	clock.now = 1100;
	parttyPerf.finishTermWrite(a);
	parttyPerf.finishTermWrite(b);
	snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(snap.writeLatency.n, 0);
});

test("expired tokens are attributed to their own pane on finish", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const aged = parttyPerf.beginTermWrite("1a", 10);
	clock.now = 1000 + WRITE_TOKEN_EXPIRE_MS + 1;
	parttyPerf.finishTermWrite(aged);

	const paneA = parttyPerf.getPaneSnapshot("1a");
	assert.equal(paneA.writeTokens.expired, 1);
	assert.equal(paneA.writeTokens.started, 1);
	assert.equal(parttyPerf.snapshot().writeLatency.n, 0);

	const fresh = parttyPerf.beginTermWrite("1b", 4);
	const paneB = parttyPerf.getPaneSnapshot("1b");
	assert.equal(paneB.writeTokens.expired, 0);
	assert.equal(paneB.writeTokens.outstanding, 1);
	parttyPerf.finishTermWrite(fresh);
	assert.equal(parttyPerf.getPaneSnapshot("1b").writeTokens.completed, 1);
});

test("capacity overflow is attributed to the evicted pane", async () => {
	const env = await createEnv();
	const { parttyPerf } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	for (let i = 0; i < WRITE_TOKEN_MAX; i++) {
		parttyPerf.beginTermWrite("1a", 1);
	}
	// The next token evicts the oldest 1a token as overflow for pane 1a.
	parttyPerf.beginTermWrite("1b", 1);
	const paneA = parttyPerf.getPaneSnapshot("1a");
	assert.equal(paneA.writeTokens.overflow, 1);
	assert.equal(paneA.writeTokens.outstanding, WRITE_TOKEN_MAX - 1);
	const paneB = parttyPerf.getPaneSnapshot("1b");
	assert.equal(paneB.writeTokens.overflow, 0);
	assert.equal(paneB.writeTokens.outstanding, 1);
});

test("resetPane cancels in-flight tokens for that pane only", async () => {
	const env = await createEnv();
	const { parttyPerf } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	const a = parttyPerf.beginTermWrite("1a", 1);
	parttyPerf.beginTermWrite("1b", 1);
	parttyPerf.resetPane("1a");
	parttyPerf.finishTermWrite(a);
	const snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.cancelled, 1);
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(parttyPerf.getPaneSnapshot("1a"), null);
	assert.ok(parttyPerf.getPaneSnapshot("1b") !== null);
});

test("snapshot is deeply immutable", async () => {
	const env = await createEnv();
	const { parttyPerf } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	parttyPerf.mark("x", 1);
	parttyPerf.gauge("g", 5);
	parttyPerf.time("t", 3);
	const snap = parttyPerf.snapshot();
	assert.ok(Object.isFrozen(snap));
	assert.ok(Object.isFrozen(snap.counters));
	assert.ok(Object.isFrozen(snap.gauges));
	assert.ok(Object.isFrozen(snap.timings));
	assert.ok(Object.isFrozen(snap.rates));
	assert.ok(Object.isFrozen(snap.rates.in));
	assert.ok(Object.isFrozen(snap.writeLatency));
	assert.ok(Object.isFrozen(snap.writeTokens));
	assert.ok(Object.isFrozen(snap.rAF));
	assert.ok(Object.isFrozen(snap.rAF.gap));
	assert.throws(() => {
		snap.counters.x = 99;
	}, TypeError);
});

test("rAF probe records gap cadence and pauses while hidden", async () => {
	const env = await createEnv();
	const { parttyPerf, clock, pumpRaf, hide, show } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 5000;
	pumpRaf();
	assert.equal(parttyPerf.snapshot().rAF.gap.n, 0);
	clock.now = 5016;
	pumpRaf();
	let snap = parttyPerf.snapshot();
	assert.equal(snap.rAF.state, "active");
	assert.equal(snap.rAF.gap.n, 1);
	assert.equal(snap.rAF.gap.last, 16);
	assert.equal(snap.gauges["frame.fps"], undefined);
	hide();
	snap = parttyPerf.snapshot();
	assert.equal(snap.rAF.state, "paused");
	assert.equal(snap.rAF.pausedAt, 5016);
	clock.now += 500;
	assert.equal(parttyPerf.snapshot().rAF.staleMs, 500);
	pumpRaf();
	assert.equal(env.raf.pending.size, 0);
	show();
	assert.equal(parttyPerf.snapshot().rAF.state, "active");
});

test("collector is a no-op while disabled", async () => {
	const env = await createEnv();
	const { parttyPerf } = env;
	parttyPerf.configure({ enabled: false, reset: true });
	parttyPerf.mark("x", 1);
	parttyPerf.recordPtyInputBytes("1a", 50);
	const token = parttyPerf.beginTermWrite("1a", 5);
	parttyPerf.finishTermWrite(token);
	const snap = parttyPerf.snapshot();
	assert.equal(snap.counters.x, undefined);
	assert.equal(snap.rates.in.totalBytes, 0);
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(snap.writeLatency.n, 0);
	assert.equal(parttyPerf.getPtyInputRate("1a"), null);
});

test("input event rate counts onData events per second", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	for (let i = 0; i < 5; i++) parttyPerf.recordInputEvent();
	clock.now = 1001;
	for (let i = 0; i < 5; i++) parttyPerf.recordInputEvent();
	assert.equal(parttyPerf.getInputRate(), 10);
	clock.now = 2002;
	assert.equal(parttyPerf.getInputRate(), 0);
});

test("dispose stops instrumentation and invalidates tokens", async () => {
	const env = await createEnv();
	const { parttyPerf, clock, observers } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const token = parttyPerf.beginTermWrite("1a", 3);
	parttyPerf.dispose();
	assert.equal(parttyPerf.enabled, false);
	assert.equal(parttyPerf.snapshot().writeTokens.cancelled, 1);
	assert.ok(observers.every((o) => o.disconnected));
	clock.now = 2000;
	parttyPerf.finishTermWrite(token);
	assert.equal(parttyPerf.snapshot().writeTokens.completed, 0);
});

test("contracts and JSON export expose metadata and unavailable semantics", async () => {
	const env = await createEnv();
	const { parttyPerf } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	const contracts = parttyPerf.contracts();
	assert.ok(contracts.length > 0);
	const write = contracts.find((c) => c.name === "write.latency.ms");
	assert.equal(write.kind, "latency");
	assert.equal(write.windowMs, 10_000);
	assert.equal(write.availability, "dev-only");
	assert.equal(parttyPerf.getPaneSnapshot("nope"), null);
	const json = JSON.parse(parttyPerf.snapshotJson());
	assert.ok(json.counters !== undefined);
	assert.ok(json.rAF !== undefined);
	assert.ok(json.rates !== undefined);
	assert.ok(json.writeLatency !== undefined);
	const viaJSON = JSON.parse(JSON.stringify(parttyPerf));
	assert.ok(viaJSON.writeLatency !== undefined);
	assert.ok(viaJSON.writeTokens !== undefined);
	assert.equal(viaJSON.writeLatency.p50, null);
});

test("reset clears collected data meaningfully", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	parttyPerf.mark("a", 3);
	parttyPerf.recordPtyInputBytes("1a", 10);
	parttyPerf.beginTermWrite("1a", 1);
	parttyPerf.reset();
	const snap = parttyPerf.snapshot();
	assert.equal(snap.counters.a, undefined);
	assert.equal(snap.rates.in.totalBytes, 0);
	assert.equal(snap.writeLatency.n, 0);
	assert.equal(snap.writeTokens.outstanding, 0);
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(snap.writeTokens.expired, 0);
	assert.equal(snap.writeTokens.cancelled, 1);
	assert.equal(snap.writeTokens.overflow, 0);
	assert.equal(parttyPerf.getPaneSnapshot("1a"), null);
});

test("disable cancels pending tokens epoch-safely; late callbacks don't count", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const token = parttyPerf.beginTermWrite("1a", 5);
	parttyPerf.configure({ enabled: false });
	const afterDisable = parttyPerf.snapshot();
	assert.equal(afterDisable.meta.enabled, false);
	assert.equal(afterDisable.writeTokens.cancelled, 1);
	assert.equal(afterDisable.writeTokens.outstanding, 0);
	assert.equal(afterDisable.writeTokens.completed, 0);
	parttyPerf.configure({ enabled: true, reset: false });
	clock.now = 5000;
	parttyPerf.finishTermWrite(token);
	const snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(snap.writeTokens.cancelled, 1);
	assert.equal(snap.writeLatency.n, 0);
});

test("snapshot sweeps tokens whose callback never fires and attributes per-pane", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	parttyPerf.beginTermWrite("1a", 5);
	parttyPerf.beginTermWrite("1b", 7);
	clock.now = 1000 + WRITE_TOKEN_EXPIRE_MS + 1;
	const snap = parttyPerf.snapshot();
	assert.equal(snap.writeTokens.outstanding, 0);
	assert.equal(snap.writeTokens.expired, 2);
	assert.equal(snap.writeTokens.completed, 0);
	assert.equal(snap.writeTokens.started, 2);
	assert.equal(snap.writeLatency.n, 0);
	const paneA = parttyPerf.getPaneSnapshot("1a");
	assert.equal(paneA.writeTokens.expired, 1);
	assert.equal(paneA.writeTokens.started, 1);
	const paneB = parttyPerf.getPaneSnapshot("1b");
	assert.equal(paneB.writeTokens.expired, 1);
});

// Single-token cancel (`cancelTermWrite` → primitive `cancelWriteToken`) is
// covered in metricsCore.test.mjs; the facade adds no behavior here.

test("reset discards queued observer records so pre-reset entries don't count", async () => {
	const env = await createEnv();
	const { parttyPerf, observers } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	const longtask = observers.find((o) =>
		o.observed.some((opts) => opts.type === "longtask"),
	);
	longtask.records.push({ duration: 40 });
	parttyPerf.reset();
	assert.equal(longtask.records.length, 0);
	assert.equal(parttyPerf.snapshot().counters["main.longtask.count"], 0);
	longtask.deliver([{ duration: 50 }]);
	assert.equal(parttyPerf.snapshot().counters["main.longtask.count"], 1);
});

test("observer support gauges distinguish supported from unsupported", async () => {
	const supported = await createEnv();
	const { parttyPerf: supportedPerf } = supported;
	supportedPerf.configure({ enabled: true, reset: true });
	let snap = supportedPerf.snapshot();
	assert.equal(snap.gauges["observer.longtask"], 1);
	assert.equal(snap.gauges["observer.layout-shift"], 1);
	assert.equal(snap.counters["main.longtask.count"], 0);
	assert.equal(snap.counters["layout.shift.count"], 0);
	supportedPerf.reset();
	snap = supportedPerf.snapshot();
	assert.equal(snap.gauges["observer.longtask"], 1);
	assert.equal(snap.counters["main.longtask.count"], 0);

	const unsupported = await createEnv({ noPerformanceObserver: true });
	const { parttyPerf: unsupportedPerf } = unsupported;
	unsupportedPerf.configure({ enabled: true, reset: true });
	snap = unsupportedPerf.snapshot();
	assert.equal(snap.gauges["observer.longtask"], 0);
	assert.equal(snap.gauges["observer.layout-shift"], 0);
	assert.equal(snap.counters["main.longtask.count"], undefined);
});

test("snapshot exposes session metadata", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 5000;
	let meta = parttyPerf.snapshot().meta;
	assert.equal(meta.enabled, true);
	assert.equal(meta.schemaVersion, 2);
	assert.equal(meta.capturedAt, 5000);
	assert.equal(meta.sessionStartedAt, 1000);
	const epochBefore = meta.epoch;
	parttyPerf.reset();
	meta = parttyPerf.snapshot().meta;
	assert.ok(meta.epoch > epochBefore);
	assert.equal(meta.capturedAt, 5000);
});

test("mark/time/pane reject non-finite and negative inputs", async () => {
	const env = await createEnv();
	const { parttyPerf } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	parttyPerf.mark("a", -1);
	parttyPerf.mark("b", Number.NaN);
	parttyPerf.mark("c", 3);
	parttyPerf.time("t1", -5);
	parttyPerf.time("t2", Number.NaN);
	parttyPerf.time("t3", 7);
	parttyPerf.paneTime("1a", "pt", -2);
	parttyPerf.paneMark("1a", "pm", -1);
	const snap = parttyPerf.snapshot();
	assert.equal(snap.counters.a, undefined);
	assert.equal(snap.counters.b, undefined);
	assert.equal(snap.counters.c, 3);
	assert.equal(snap.timings.t1, undefined);
	assert.equal(snap.timings.t2, undefined);
	assert.equal(snap.timings.t3.count, 1);
	assert.equal(parttyPerf.getPaneSnapshot("1a"), null);
});

test("rate evictions are visible and session totals stay correct", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 0;
	for (let i = 0; i < 4200; i++) {
		parttyPerf.recordPtyInputBytes("1a", 10);
	}
	const snap = parttyPerf.snapshot();
	assert.ok(snap.rates.in.evictions > 0);
	assert.equal(snap.rates.in.totalBytes, 42_000);
	const pane = parttyPerf.getPaneSnapshot("1a");
	assert.ok(pane.rates.in.evictions > 0);
	assert.equal(pane.rates.in.totalBytes, 42_000);
});

test("enabling while the document is hidden labels rAF paused, not active", async () => {
	const env = await createEnv();
	const { parttyPerf, document: doc, show } = env;
	doc.hidden = true;
	parttyPerf.configure({ enabled: true, reset: true });
	const snap = parttyPerf.snapshot();
	assert.equal(snap.rAF.state, "paused");
	assert.equal(env.raf.pending.size, 0);
	show();
	assert.equal(parttyPerf.snapshot().rAF.state, "active");
});

test("write token counts reconcile per pane after mixed outcomes", async () => {
	const env = await createEnv();
	const { parttyPerf, clock } = env;
	parttyPerf.configure({ enabled: true, reset: true });
	clock.now = 1000;
	const done = parttyPerf.beginTermWrite("1a", 1);
	const dropped = parttyPerf.beginTermWrite("1a", 1);
	const gone = parttyPerf.beginTermWrite("1a", 1);
	parttyPerf.finishTermWrite(done);
	parttyPerf.cancelTermWrite(dropped);
	clock.now = 1000 + WRITE_TOKEN_EXPIRE_MS + 1;
	parttyPerf.finishTermWrite(gone);
	const pane = parttyPerf.getPaneSnapshot("1a");
	assert.equal(pane.writeTokens.started, 3);
	assert.equal(
		pane.writeTokens.started,
		pane.writeTokens.outstanding +
			pane.writeTokens.completed +
			pane.writeTokens.expired +
			pane.writeTokens.cancelled +
			pane.writeTokens.overflow,
	);
	assert.equal(pane.writeTokens.completed, 1);
	assert.equal(pane.writeTokens.cancelled, 1);
	assert.equal(pane.writeTokens.expired, 1);
	assert.equal(pane.writeTokens.outstanding, 0);
});
