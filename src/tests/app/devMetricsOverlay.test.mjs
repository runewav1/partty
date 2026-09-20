/**
 * Deterministic DOM smoke test for the dev metrics overlay.
 *
 * The real collector (`src/pty/perf.ts`) and overlay run inside a per-test VM
 * sandbox with an injected clock and a fake timer queue, so no browser, no
 * native timers and no shared module state are involved. Each test builds a
 * fresh loader (fresh collector instance), configures it *after* the clock is
 * installed, and disposes it afterwards, so tests run standalone.
 *
 * Browser peers are stubbed only at the boundary (`document`, `window`, `URL`,
 * `Blob`, `PerformanceObserver`, `draggablePanel`); the sources under test are
 * otherwise unmodified.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { FakeElement } from "../support/dom.mjs";
import { createVmLoader } from "../support/vm.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function collectText(node, out = []) {
	if (node._text) out.push(node._text);
	for (const child of node.children) collectText(child, out);
	return out.join(" ");
}

function findButton(node, label) {
	if (node.tagName === "BUTTON" && node._text === label) return node;
	for (const child of node.children) {
		const found = findButton(child, label);
		if (found) return found;
	}
	return null;
}

async function createEnv() {
	let fakeNow = 1_000_000;
	const timers = new Map();
	let timerId = 0;
	const storage = new Map();

	const documentStub = {
		createElement: (tag) => new FakeElement(tag),
		addEventListener: () => {},
		removeEventListener: () => {},
		body: new FakeElement("body"),
		activeElement: null,
		hidden: false,
	};
	const windowStub = {
		setTimeout: (fn) => {
			const id = ++timerId;
			timers.set(id, fn);
			return id;
		},
		clearTimeout: (id) => timers.delete(id),
		setInterval: () => 0,
		clearInterval: () => {},
	};
	class FakePerformanceObserver {
		observe() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	}

	const loader = createVmLoader({
		root: ROOT,
		globals: {
			console,
			performance: { now: () => fakeNow++ },
			localStorage: {
				getItem: (key) => (storage.has(key) ? storage.get(key) : null),
				setItem: (key, value) => storage.set(key, String(value)),
				removeItem: (key) => storage.delete(key),
			},
			location: { search: "" },
			URLSearchParams,
			document: documentStub,
			window: windowStub,
			requestAnimationFrame: () => 0,
			cancelAnimationFrame: () => {},
			PerformanceObserver: FakePerformanceObserver,
			URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
			Blob: class {},
		},
		stubs: {
			[resolve(ROOT, "app/draggablePanel.ts")]: { attachDraggablePanel() {} },
		},
	});

	const { createDevMetricsOverlay } = await loader.api(
		"app/devMetricsOverlay.ts",
	);
	const { parttyPerf } = await loader.api("pty/perf.ts");
	return {
		loader,
		createDevMetricsOverlay,
		parttyPerf,
		document: documentStub,
		window: windowStub,
		timers,
	};
}

/**
 * Fresh loader, collector, overlay and deterministic clock per test. The clock
 * is installed before `configure`, and everything is disposed afterwards.
 */
async function setup(t) {
	const env = await createEnv();
	env.parttyPerf.configure({ enabled: true, reset: true });
	t.after(() => {
		env.parttyPerf.dispose();
		env.timers.clear();
	});
	const root = new FakeElement("div");
	const overlay = env.createDevMetricsOverlay({
		root,
		getFocusedPaneId: () => "p1",
	});
	t.after(() => overlay.hide());
	return { ...env, root, overlay };
}

/** Setup plus a representative snapshot already rendered. */
async function setupShown(t) {
	const env = await setup(t);
	env.parttyPerf.recordPtyInputBytes("p1", 100);
	env.parttyPerf.recordPtyOutputBytes("p1", 50);
	const token = env.parttyPerf.beginTermWrite("p1", 10);
	env.parttyPerf.finishTermWrite(token);
	env.overlay.show();
	return env;
}

test("overlay renders exact values from the real collector snapshot", async (t) => {
	const { root, overlay, parttyPerf } = await setup(t);

	// One collector tick per clock read: enqueue -> write callback latency is
	// exactly 1 ms and the trailing rate windows stay fully predictable.
	parttyPerf.recordPtyInputBytes("p1", 100);
	parttyPerf.recordPtyOutputBytes("p1", 50);
	const token = parttyPerf.beginTermWrite("p1", 10);
	parttyPerf.finishTermWrite(token);
	parttyPerf.mark("main.longtask.count");
	parttyPerf.time("main.longtask.ms", 12);
	parttyPerf.mark("rAF.gap.50ms");
	parttyPerf.mark("rAF.gap.100ms");
	overlay.show();

	const text = collectText(root);
	assert.ok(text.includes("Metrics"));
	assert.ok(text.includes("Tools"));
	assert.ok(text.includes("live"));
	assert.ok(text.includes("Freeze"));

	// Readability keeps the four values needed for a quick interpretation together.
	assert.ok(text.includes("Readability"));
	assert.ok(text.includes("Write response"));
	assert.ok(text.includes("p95 · 1 in 10s"));
	assert.ok(text.includes("Frame cadence"));
	assert.ok(text.includes("Output flow"));
	assert.ok(text.includes("50 B/s"));
	assert.ok(text.includes("Pending writes"));
	assert.ok(text.includes("0"));
	assert.ok(text.includes("1 completed · session"));

	// This fixture has no write-call timing sample, so it must be unavailable.
	assert.ok(text.includes("xterm.write call"));
	assert.ok(text.includes("unavailable"));
	assert.ok(text.includes("write latency"));
	assert.ok(text.includes("n=1"));
	assert.ok(text.includes("p50 1.00 ms"));
	assert.ok(text.includes("p95 1.00 ms"));
	assert.ok(text.includes("session avg 1.00 ms"));
	assert.ok(text.includes("window 10s"));
	assert.ok(text.includes("outstanding 0"));
	assert.ok(text.includes("completed 1"));
	assert.ok(text.includes("expired 0"));
	assert.ok(text.includes("cancelled 0"));
	assert.ok(text.includes("overflow 0"));

	// PTY bytes come straight from snap.rates, not summed panes.
	assert.ok(text.includes("PTY in"));
	assert.ok(text.includes("requested UTF-8"));
	assert.ok(text.includes("1s 100 B/s"));
	assert.ok(text.includes("total 100 B"));
	assert.ok(text.includes("1s 50 B/s"));
	assert.ok(text.includes("total 50 B"));

	// rAF state + gap counters.
	assert.ok(text.includes("state active"));
	assert.ok(text.includes(">50ms 1"));
	assert.ok(text.includes(">100ms 1"));

	// Fake observers provide deterministic support independent of the host Node version.
	assert.ok(text.includes("observer supported"));

	// Panes: focused id via textContent, rates + latency + token accounting.
	assert.ok(text.includes("\u25b6 p1"));
	assert.ok(text.includes("in \u00b7 req\u2019d UTF-8"));
	assert.ok(text.includes("write latency"));
	assert.ok(text.includes("write tokens"));

	// Semantics: dev-only + hidden-panel behavior stated exactly.
	assert.ok(text.includes("not a benchmark authority"));
	assert.ok(text.includes("write callbacks are still recorded"));

	const overlayEl = root.children[0];
	assert.equal(overlayEl.getAttribute("role"), "dialog");
	assert.equal(overlay.isVisible(), true);
});

test("freeze display stops the panel loop but the collector keeps recording", async (t) => {
	const { root, overlay, parttyPerf } = await setupShown(t);
	const freezeBtn = findButton(root, "Freeze");
	assert.ok(freezeBtn, "freeze display button must exist");
	freezeBtn.click();
	assert.ok(collectText(root).includes("frozen"));
	assert.ok(collectText(root).includes("Resume"));
	assert.equal(overlay.isVisible(), true);

	parttyPerf.recordPtyOutputBytes("p1", 25);
	assert.equal(parttyPerf.snapshot().rates.out.totalBytes, 75);
});

test("hide/show toggles visibility and the panel loop", async (t) => {
	const { root, overlay } = await setupShown(t);
	overlay.hide();
	assert.equal(overlay.isVisible(), false);
	const overlayEl = root.children[0];
	assert.equal(overlayEl.classList.contains("dev-overlay--hidden"), true);
	overlay.show();
	assert.equal(overlay.isVisible(), true);
	assert.equal(overlayEl.classList.contains("dev-overlay--hidden"), false);
});

test("export builds a full snapshot payload without throwing", async (t) => {
	const { root } = await setupShown(t);
	const exportBtn = findButton(root, "Export");
	assert.ok(exportBtn, "export button must exist");
	assert.doesNotThrow(() => exportBtn.click());
});

test("the refresh loop is driven by the fake timer queue, never native timers", async (t) => {
	const { timers, overlay } = await setupShown(t);
	assert.ok(timers.size >= 1, "show scheduled a refresh on the fake queue");

	overlay.hide();
	assert.equal(timers.size, 0, "hide clears the queued refresh");

	overlay.show();
	assert.ok(timers.size >= 1, "show re-arms the fake queue");
});

test("each loader owns an isolated collector instance", async (t) => {
	const first = await setup(t);
	const second = await setup(t);
	assert.notEqual(first.parttyPerf, second.parttyPerf);
	first.parttyPerf.mark("only.first");
	assert.equal(
		second.parttyPerf.snapshot().counters["only.first"],
		undefined,
		"collector state must not leak across loaders",
	);
});
