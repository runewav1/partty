import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule } from "node:vm";

const file = fileURLToPath(
	new URL("../../src/pty/metricsCore.ts", import.meta.url),
);

async function loadCore() {
	const src = stripTypeScriptTypes(await readFile(file, "utf8"), {
		mode: "transform",
	});
	const mod = new SourceTextModule(src, {
		context: createContext({}),
		identifier: "metricsCore.ts",
	});
	await mod.link(() => {
		throw new Error("metricsCore must not import anything");
	});
	await mod.evaluate();
	return mod.namespace;
}

const core = await loadCore();
const {
	createLatencyWindow,
	pushLatency,
	latencySummary,
	createRateWindow,
	pushRate,
	rateSummary,
	createWriteTokenRegistry,
	beginWriteToken,
	finishWriteToken,
	tokenCounts,
	resetWriteTokens,
	cancelWriteTokensForPane,
	cancelWriteToken,
	pruneExpiredWriteTokens,
	freezeDeep,
	percentile,
} = core;

test("latency window computes p50/p95/max/last over the window", () => {
	const w = createLatencyWindow({ windowMs: 10_000, capacity: 1000 });
	let t = 0;
	for (let i = 1; i <= 100; i++) {
		t += 10;
		pushLatency(w, t, i);
	}
	const s = latencySummary(w, t);
	assert.equal(s.n, 100);
	assert.equal(s.total, 100);
	assert.equal(s.evictions, 0);
	assert.equal(s.max, 100);
	assert.equal(s.last, 100);
	assert.ok(Math.abs(s.p50 - 50.5) < 1e-9);
	assert.ok(Math.abs(s.p95 - 95.05) < 1e-9);
	assert.ok(Math.abs(s.avgMs - 50.5) < 1e-9);
});

test("latency window drops aged-out samples on read without evicting", () => {
	const w = createLatencyWindow({ windowMs: 1000, capacity: 100 });
	pushLatency(w, 0, 10);
	pushLatency(w, 100, 20);
	pushLatency(w, 900, 30);
	assert.equal(latencySummary(w, 950).n, 3);
	const s = latencySummary(w, 1901);
	assert.equal(s.n, 0);
	assert.equal(s.total, 3);
	assert.equal(s.evictions, 0);
	assert.equal(s.p50, null);
	assert.equal(s.p95, null);
	assert.equal(s.max, null);
	assert.equal(s.last, 30);
});

test("latency window evicts oldest at capacity and counts evictions", () => {
	const w = createLatencyWindow({ windowMs: 1000, capacity: 5 });
	for (let i = 0; i < 5; i++) pushLatency(w, i * 10, i + 1);
	assert.equal(latencySummary(w, 50).n, 5);
	for (let i = 5; i < 10; i++) pushLatency(w, i * 10, i + 1);
	const s = latencySummary(w, 100);
	assert.equal(s.n, 5);
	assert.equal(s.total, 10);
	assert.equal(s.evictions, 5);
	assert.equal(s.max, 10);
	assert.equal(s.last, 10);
	assert.equal(s.p50, 8);
});

test("latency window ignores non-finite and negative samples", () => {
	const w = createLatencyWindow({ windowMs: 1000, capacity: 10 });
	pushLatency(w, 0, 5);
	pushLatency(w, 1, Number.NaN);
	pushLatency(w, 2, Number.POSITIVE_INFINITY);
	pushLatency(w, 3, -4);
	pushLatency(w, 4, 6);
	const s = latencySummary(w, 5);
	assert.equal(s.total, 2);
	assert.equal(s.n, 2);
	assert.equal(s.last, 6);
	assert.equal(s.max, 6);
});

test("percentile is null for empty input and interpolates small sets", () => {
	assert.equal(percentile([], 50), null);
	assert.equal(percentile([7], 95), 7);
	assert.ok(Math.abs(percentile([1, 2], 50) - 1.5) < 1e-9);
});

test("rate window sums actual bytes in the trailing window and reports span", () => {
	const w = createRateWindow({ windowMs: 1000, capacity: 100 });
	pushRate(w, 0, 100);
	pushRate(w, 500, 100);
	let s = rateSummary(w, 1000);
	assert.equal(s.samples, 2);
	assert.equal(s.spanMs, 500);
	assert.equal(s.bytesInWindow, 200);
	assert.equal(s.bytesPerSec, 200);
	assert.equal(s.totalBytes, 200);
	s = rateSummary(w, 1500);
	assert.equal(s.samples, 1);
	assert.equal(s.bytesInWindow, 100);
	assert.equal(s.bytesPerSec, 100);
	assert.equal(s.totalBytes, 200);
});

test("rate window evicts at capacity and ignores invalid byte counts", () => {
	const w = createRateWindow({ windowMs: 1000, capacity: 3 });
	pushRate(w, 0, 10);
	pushRate(w, 1, Number.NaN);
	pushRate(w, 2, -5);
	pushRate(w, 3, 0);
	pushRate(w, 10, 20);
	pushRate(w, 20, 30);
	pushRate(w, 30, 40);
	const s = rateSummary(w, 1000);
	assert.equal(s.samples, 3);
	assert.equal(s.evictions, 1);
	assert.equal(s.totalBytes, 100);
	assert.equal(s.bytesInWindow, 90);
	assert.equal(s.lastBytes, 40);
});

test("write tokens complete with age and update counts", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 2000 });
	const { token } = beginWriteToken(r, 1000, "1a", 42);
	assert.equal(token.paneId, "1a");
	assert.equal(tokenCounts(r).outstanding, 1);
	const result = finishWriteToken(r, 1050, token);
	assert.equal(result.status, "completed");
	assert.equal(result.ageMs, 50);
	assert.equal(result.bytes, 42);
	assert.equal(result.paneId, "1a");
	const counts = tokenCounts(r);
	assert.equal(counts.outstanding, 0);
	assert.equal(counts.completed, 1);
	assert.equal(counts.expired, 0);
	assert.equal(counts.cancelled, 0);
	assert.equal(counts.overflow, 0);
});

test("write tokens expire after expireMs and late finishes are ignored", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 2000 });
	const { token } = beginWriteToken(r, 1000, "1a", 10);
	const result = finishWriteToken(r, 3001, token);
	assert.equal(result.status, "expired");
	assert.equal(tokenCounts(r).expired, 1);
	const late = finishWriteToken(r, 4000, token);
	assert.equal(late.status, "ignored");
	assert.equal(tokenCounts(r).completed, 0);
	assert.equal(tokenCounts(r).expired, 1);
});

test("write tokens evict the oldest at capacity and count overflow", () => {
	const r = createWriteTokenRegistry({ maxTokens: 2, expireMs: 5000 });
	const a = beginWriteToken(r, 1000, "1a", 1);
	const b = beginWriteToken(r, 1100, "1b", 1);
	const c = beginWriteToken(r, 1200, "1c", 1);
	assert.equal(c.evictedPaneId, "1a");
	assert.equal(tokenCounts(r).outstanding, 2);
	assert.equal(tokenCounts(r).overflow, 1);
	assert.equal(finishWriteToken(r, 1300, a.token).status, "ignored");
	assert.equal(finishWriteToken(r, 1300, b.token).status, "completed");
	assert.equal(finishWriteToken(r, 1300, c.token).status, "completed");
	assert.equal(tokenCounts(r).completed, 2);
	assert.equal(tokenCounts(r).outstanding, 0);
});

test("reset invalidates tokens epoch-safely and never reuses ids", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 5000 });
	const { token: old } = beginWriteToken(r, 1000, "1a", 5);
	assert.equal(tokenCounts(r).outstanding, 1);
	resetWriteTokens(r);
	assert.equal(tokenCounts(r).cancelled, 1);
	assert.equal(tokenCounts(r).outstanding, 0);
	assert.equal(finishWriteToken(r, 2000, old).status, "ignored");
	const { token: fresh } = beginWriteToken(r, 2000, "1b", 7);
	assert.notEqual(fresh.id, old.id);
	assert.notEqual(fresh.epoch, old.epoch);
	assert.equal(finishWriteToken(r, 2100, fresh).status, "completed");
	assert.equal(tokenCounts(r).completed, 1);
	assert.equal(tokenCounts(r).cancelled, 1);
});

test("begin prunes expired tokens before enforcing capacity", () => {
	const r = createWriteTokenRegistry({ maxTokens: 2, expireMs: 1000 });
	const a = beginWriteToken(r, 0, "1a", 1).token;
	beginWriteToken(r, 10, "1b", 1);
	const c = beginWriteToken(r, 2000, "1c", 1);
	assert.equal(c.evictedPaneId, null);
	assert.equal(tokenCounts(r).expired, 2);
	assert.equal(tokenCounts(r).outstanding, 1);
	assert.equal(finishWriteToken(r, 2001, a).status, "ignored");
});

test("cancelling tokens for one pane leaves other panes intact", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 5000 });
	const a = beginWriteToken(r, 1000, "1a", 1).token;
	const b = beginWriteToken(r, 1100, "1b", 1).token;
	const removed = cancelWriteTokensForPane(r, "1a");
	assert.equal(removed, 1);
	assert.equal(tokenCounts(r).cancelled, 1);
	assert.equal(finishWriteToken(r, 1200, a).status, "ignored");
	assert.equal(finishWriteToken(r, 1200, b).status, "completed");
	assert.equal(tokenCounts(r).completed, 1);
});

test("negative clock drift clamps completed age to zero", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 5000 });
	const { token } = beginWriteToken(r, 2000, "1a", 3);
	const result = finishWriteToken(r, 1500, token);
	assert.equal(result.status, "completed");
	assert.equal(result.ageMs, 0);
});

test("freezeDeep produces an immutable snapshot", () => {
	const snap = freezeDeep({ a: 1, nested: { b: [1, 2] }, list: [3] });
	assert.ok(Object.isFrozen(snap));
	assert.ok(Object.isFrozen(snap.nested));
	assert.ok(Object.isFrozen(snap.list));
	assert.throws(() => {
		snap.a = 2;
	}, TypeError);
	assert.throws(() => {
		snap.nested.b.push(3);
	}, TypeError);
	assert.throws(() => {
		snap.list[0] = 9;
	}, TypeError);
});

test("write token registry is bounded and tracks zero-max tokens safely", () => {
	const r = createWriteTokenRegistry({ maxTokens: 0, expireMs: 5000 });
	const { token, evictedPaneId } = beginWriteToken(r, 0, "1a", 1);
	assert.equal(evictedPaneId, null);
	assert.equal(tokenCounts(r).outstanding, 0);
	assert.equal(finishWriteToken(r, 10, token).status, "ignored");
});

test("registry reconciles: started equals all terminal states", () => {
	const r = createWriteTokenRegistry({ maxTokens: 2, expireMs: 50 });
	beginWriteToken(r, 0, "1a", 1);
	const b = beginWriteToken(r, 10, "1b", 1);
	beginWriteToken(r, 20, "1c", 1);
	finishWriteToken(r, 30, b.token);
	beginWriteToken(r, 100, "1d", 1);
	const counts = tokenCounts(r);
	assert.equal(counts.started, 4);
	assert.equal(
		counts.started,
		counts.outstanding +
			counts.completed +
			counts.expired +
			counts.cancelled +
			counts.overflow,
	);
	assert.equal(counts.completed, 1);
	assert.equal(counts.expired, 1);
	assert.equal(counts.overflow, 1);
	assert.equal(counts.outstanding, 1);
	assert.equal(counts.cancelled, 0);
});

test("pruneExpiredWriteTokens removes overdue tokens and reports panes", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 1000 });
	beginWriteToken(r, 0, "1a", 1);
	const b = beginWriteToken(r, 500, "1b", 2).token;
	const expired = pruneExpiredWriteTokens(r, 1400);
	assert.equal(expired.length, 1);
	assert.equal(expired[0].paneId, "1a");
	assert.equal(expired[0].bytes, 1);
	assert.equal(tokenCounts(r).expired, 1);
	assert.equal(tokenCounts(r).outstanding, 1);
	assert.equal(finishWriteToken(r, 1500, b).status, "completed");
});

test("cancelWriteToken cancels a pending token epoch-safely", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 5000 });
	const { token } = beginWriteToken(r, 1000, "1a", 4);
	assert.equal(cancelWriteToken(r, token), true);
	assert.equal(tokenCounts(r).cancelled, 1);
	assert.equal(tokenCounts(r).outstanding, 0);
	assert.equal(cancelWriteToken(r, token), false);
	assert.equal(finishWriteToken(r, 2000, token).status, "ignored");
	resetWriteTokens(r);
	assert.equal(cancelWriteToken(r, token), false);
});

test("resetWriteTokens returns the cancelled entries with their panes", () => {
	const r = createWriteTokenRegistry({ maxTokens: 4, expireMs: 5000 });
	beginWriteToken(r, 0, "1a", 1);
	beginWriteToken(r, 10, "1b", 1);
	const cancelled = resetWriteTokens(r);
	assert.equal(cancelled.length, 2);
	assert.deepEqual(Array.from(cancelled, (e) => e.paneId).sort(), ["1a", "1b"]);
	assert.equal(tokenCounts(r).cancelled, 2);
	assert.equal(tokenCounts(r).outstanding, 0);
});
