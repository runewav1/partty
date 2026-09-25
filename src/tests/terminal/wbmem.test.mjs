import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createVmLoader } from "../support/vm.mjs";

// `idle` is undefined by default so the module uses its synchronous fallback.
// Supplying one exercises the requestIdleCallback path.
async function harness(invoke = async () => true, idle) {
	let now = 0;
	let nextId = 0;
	const timers = new Map();
	const idleQueue = [];
	const calls = [];
	const warnings = [];
	const loader = createVmLoader({
		root: resolve(import.meta.dirname, "../.."),
		globals: {
			performance: { now: () => now },
			console: { warn: (...args) => warnings.push(args) },
			window: {
				__TAURI_INTERNALS__: {},
				setTimeout: (fn, delay) => {
					const id = ++nextId;
					timers.set(id, { fn, at: now + delay });
					return id;
				},
				clearTimeout: (id) => timers.delete(id),
				...(idle
					? {
							requestIdleCallback: (fn) => {
								idleQueue.push(fn);
								return ++nextId;
							},
						}
					: {}),
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
	const { scheduleReclaim } = await loader.api("terminal/wbmem.ts");
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
			// biome-ignore lint/performance/noAwaitInLoops: Settle each fake timer before advancing the clock.
			await setImmediate();
		}
		now = end;
		await setImmediate();
	}
	async function flushIdle() {
		const pending = idleQueue.splice(0);
		for (const fn of pending) fn();
		await setImmediate();
	}
	return { scheduleReclaim, advance, flushIdle, calls, warnings, timers };
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
	await h.advance(9_999);
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
	await h.advance(2_000);
	assert.equal(h.calls.length, 2);
	complete(true);
	await h.advance(0);
	assert.equal(h.timers.size, 0);
});

test("unsupported platforms and rejected runtime commands disable retries", async () => {
	for (const invoke of [
		async () => false,
		async () => {
			throw new Error("unsupported CDP method");
		},
	]) {
		// biome-ignore lint/performance/noAwaitInLoops: Exercise each isolated scheduler to completion.
		const h = await harness(invoke);
		h.scheduleReclaim();
		await h.advance(2_000);
		h.scheduleReclaim();
		await h.advance(60_000);
		assert.equal(h.calls.length, 1);
		assert.equal(h.timers.size, 0);
	}
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
	const h = await harness(
		async () => true,
		() => {},
	);
	h.scheduleReclaim();
	// The settle timer has fired, but no idle callback has run yet.
	await h.advance(2_000);
	assert.equal(h.calls.length, 0);
	await h.flushIdle();
	assert.deepEqual(h.calls, [{ command: "reclaim_wbmem", at: 2_000 }]);
});
