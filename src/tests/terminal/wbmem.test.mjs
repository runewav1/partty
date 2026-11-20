import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createVmLoader } from "../support/vm.mjs";

async function harness(invoke = async () => true, { autoIdle = true } = {}) {
	let now = 0;
	let nextId = 0;
	const timers = new Map();
	const idleQueue = new Map();
	const document = { hidden: false };
	const calls = [];
	const warnings = [];
	const loader = createVmLoader({
		root: resolve(import.meta.dirname, "../.."),
		globals: {
			performance: { now: () => now },
			console: { warn: (...args) => warnings.push(args) },
			document,
			window: {
				__TAURI_INTERNALS__: {},
				setTimeout: (fn, delay) => {
					const id = ++nextId;
					timers.set(id, { fn, at: now + delay });
					return id;
				},
				clearTimeout: (id) => timers.delete(id),
				requestIdleCallback: (fn) => {
					const id = ++nextId;
					idleQueue.set(id, fn);
					return id;
				},
				cancelIdleCallback: (id) => idleQueue.delete(id),
			},
		},
		stubs: {
			"@tauri-apps/api/core": {
				invoke: (command) => {
					calls.push({ command, at: now });
					return invoke();
				},
			},
		},
	});
	const api = await loader.api("terminal/wbmem.ts");
	async function advance(ms) {
		const end = now + ms;
		while (true) {
			const next = [...timers.entries()]
				.filter(([, timer]) => timer.at <= end)
				.sort((a, b) => a[1].at - b[1].at)[0];
			if (!next) break;
			now = next[1].at;
			timers.delete(next[0]);
			next[1].fn();
			if (autoIdle && idleQueue.size > 0) runIdle();
			// biome-ignore lint/performance/noAwaitInLoops: Settle each fake timer before advancing the clock.
			await setImmediate();
		}
		now = end;
		await setImmediate();
	}
	function runIdle(didTimeout = false, budget = 16) {
		const pending = [...idleQueue.values()];
		idleQueue.clear();
		for (const fn of pending) fn({ didTimeout, timeRemaining: () => budget });
	}
	async function flushIdle(didTimeout, budget) {
		runIdle(didTimeout, budget);
		await setImmediate();
	}
	return { ...api, advance, flushIdle, calls, warnings, timers, document };
}

test("pane changes coalesce, observe a cooldown, and never start a periodic loop", async () => {
	const h = await harness();
	h.scheduleReclaim();
	await h.advance(1_000);
	h.scheduleReclaim();
	await h.advance(1_999);
	assert.equal(h.calls.length, 0);
	await h.advance(1);
	assert.deepEqual(h.calls, [{ command: "reclaim_wbmem", at: 3_000 }]);
	h.scheduleReclaim();
	await h.advance(29_999);
	assert.equal(h.calls.length, 1);
	await h.advance(1);
	assert.equal(h.calls.length, 2);
	await h.advance(60_000);
	assert.equal(h.calls.length, 2);
	assert.equal(h.timers.size, 0);
});

test("pane changes during an in-flight hint queue one later hint", async () => {
	let complete;
	const h = await harness(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	h.scheduleReclaim();
	await h.advance(2_000);
	h.scheduleReclaim();
	h.scheduleReclaim();
	await h.advance(20_000);
	assert.equal(h.calls.length, 1);
	complete(true);
	await h.advance(0);
	await h.advance(10_000);
	assert.equal(h.calls.length, 2);
	complete(true);
	await h.advance(0);
	assert.equal(h.timers.size, 0);
});

test("unsupported platforms disable reclamation", async () => {
	const h = await harness(async () => false);
	h.scheduleReclaim();
	await h.advance(2_000);
	h.scheduleReclaim();
	await h.advance(60_000);
	assert.equal(h.calls.length, 1);
	assert.equal(h.timers.size, 0);
});

test("failure backs off and retries only on a new disposal", async () => {
	const h = await harness(async () => {
		throw new Error("renderer unavailable");
	});
	h.scheduleReclaim();
	await h.advance(2_000);
	await h.advance(60_000);
	assert.equal(h.calls.length, 1);
	h.scheduleReclaim();
	await h.advance(59_999);
	assert.equal(h.calls.length, 1);
	await h.advance(1);
	assert.equal(h.calls.length, 2);
	assert.equal(h.warnings.length, 1);
	assert.equal(h.timers.size, 0);
});

test("scheduling before any prior request waits only the settle delay", async () => {
	const h = await harness();
	h.scheduleReclaim();
	await h.advance(1_999);
	assert.equal(h.calls.length, 0);
	await h.advance(1);
	assert.equal(h.calls.length, 1);
});

test("the pass waits for an idle callback when one is available", async () => {
	const h = await harness(async () => true, { autoIdle: false });
	h.scheduleReclaim();
	// The settle timer has fired, but no idle callback has run yet.
	await h.advance(2_000);
	assert.equal(h.calls.length, 0);
	await h.flushIdle();
	assert.deepEqual(h.calls, [{ command: "reclaim_wbmem", at: 2_000 }]);
});

test("input/output after a timer fires postpones an already queued idle pass", async () => {
	const h = await harness(undefined, { autoIdle: false });
	h.scheduleReclaim();
	await h.advance(2_000);
	h.noteReclaimActivity();
	await h.flushIdle();
	assert.equal(h.calls.length, 0);
	await h.advance(2_000);
	await h.flushIdle();
	assert.equal(h.calls.length, 1);
});

test("an idle timeout or small idle budget never forces collection", async () => {
	const h = await harness(undefined, { autoIdle: false });
	h.scheduleReclaim();
	await h.advance(2_000);
	await h.flushIdle(true, 0);
	await h.advance(2_000);
	await h.flushIdle(false, 2);
	assert.equal(h.calls.length, 0);
	await h.advance(2_000);
	await h.flushIdle();
	assert.equal(h.calls.length, 1);
});

test("continuous output expires a request without starting a loop", async () => {
	const h = await harness();
	h.scheduleReclaim();
	for (let i = 0; i < 46; i++) {
		h.noteReclaimActivity();
		// biome-ignore lint/performance/noAwaitInLoops: Simulate sustained output over time.
		await h.advance(1_000);
	}
	assert.equal(h.calls.length, 0);
	assert.equal(h.timers.size, 0);
	await h.advance(60_000);
	assert.equal(h.calls.length, 0);
});

test("hide cancels pending idle work and ignores hidden disposals", async () => {
	const h = await harness(undefined, { autoIdle: false });
	h.scheduleReclaim();
	await h.advance(2_000);
	h.cancelReclaim();
	h.document.hidden = true;
	h.scheduleReclaim();
	await h.flushIdle();
	await h.advance(60_000);
	assert.equal(h.calls.length, 0);
	h.document.hidden = false;
	h.scheduleReclaim();
	await h.advance(2_000);
	await h.flushIdle();
	assert.equal(h.calls.length, 1);
});
