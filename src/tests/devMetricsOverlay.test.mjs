/**
 * Deterministic DOM smoke test for the dev metrics overlay.
 *
 * No browser is used and no DOM is fabricated beyond a minimal node stub: the
 * real collector (src/pty/perf.ts) is driven with deterministic inputs and the
 * overlay is rendered against its actual snapshot schema, then the populated
 * DOM text is asserted against exact expected values.
 *
 * Run: node --experimental-strip-types --test src/tests/devMetricsOverlay.test.mjs
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// The real sources use extensionless relative imports; teach Node's resolver to
// append `.ts` so `--experimental-strip-types` can load them as-is.
await register(
	"data:text/javascript," +
		encodeURIComponent(
			[
				"export async function resolve(specifier, context, nextResolve) {",
				"  if (specifier.startsWith('./') && !/\\.[cm]?[jt]s$/.test(specifier)) {",
				"    return nextResolve(specifier + '.ts', context);",
				"  }",
				"  return nextResolve(specifier, context);",
				"}",
			].join("\n"),
		),
	import.meta.url,
);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");

class FakeNode {
	constructor(tag = "div") {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parentNode = null;
		this._text = "";
		this.attrs = {};
		this.listeners = {};
		this.style = {};
		this.tabIndex = undefined;
		this.title = "";
		this.classList = {
			_set: new Set(),
			add: (...names) => {
				names.forEach((n) => {
					this.classList._set.add(n);
				});
			},
			remove: (...names) => {
				names.forEach((n) => {
					this.classList._set.delete(n);
				});
			},
			contains: (n) => this.classList._set.has(n),
		};
	}

	get textContent() {
		return this._text;
	}
	set textContent(value) {
		this._text = String(value);
	}

	appendChild(child) {
		if (child.parentNode) {
			child.parentNode.children = child.parentNode.children.filter(
				(c) => c !== child,
			);
		}
		child.parentNode = this;
		this.children.push(child);
		return child;
	}

	append(...nodes) {
		for (const n of nodes) this.appendChild(n);
	}

	replaceChildren(...nodes) {
		this.children = [];
		for (const n of nodes) this.appendChild(n);
	}

	setAttribute(name, value) {
		this.attrs[name] = String(value);
	}

	getAttribute(name) {
		return this.attrs[name] ?? null;
	}

	addEventListener(type, fn) {
		if (!this.listeners[type]) this.listeners[type] = [];
		this.listeners[type].push(fn);
	}

	removeEventListener(type, fn) {
		this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
	}

	dispatch(type) {
		for (const fn of this.listeners[type] ?? []) fn();
	}

	click() {
		this.dispatch("click");
	}

	focus() {}

	contains(other) {
		if (!other) return false;
		if (other === this) return true;
		return this.children.some((c) => c.contains(other));
	}

	remove() {
		if (this.parentNode) {
			this.parentNode.children = this.parentNode.children.filter(
				(c) => c !== this,
			);
			this.parentNode = null;
		}
	}
}

function installGlobals() {
	globalThis.window = globalThis;
	globalThis.document = {
		createElement: (tag) => new FakeNode(tag),
		addEventListener: () => {},
		removeEventListener: () => {},
		body: new FakeNode("body"),
		activeElement: null,
		hidden: false,
	};
	globalThis.localStorage = {
		_store: new Map(),
		getItem(key) {
			return this._store.has(key) ? this._store.get(key) : null;
		},
		setItem(key, value) {
			this._store.set(key, String(value));
		},
	};
	globalThis.location = { search: "" };
	globalThis.PerformanceObserver = class {
		observe() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	};
	// Keep the rAF probe inert so its cadence values are fully deterministic.
	globalThis.requestAnimationFrame = () => 0;
	globalThis.cancelAnimationFrame = () => {};
	globalThis.URL.createObjectURL = () => "blob:fake";
	globalThis.URL.revokeObjectURL = () => {};
}

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

installGlobals();

const overlayPath = pathToFileURL(
	resolve(REPO, "src/app/devMetricsOverlay.ts"),
).href;
const overlayModule = await import(overlayPath);
const createDevMetricsOverlay = overlayModule.createDevMetricsOverlay;
const parttyPerf = globalThis.__parttyPerf;
assert.ok(parttyPerf, "collector must be exposed on window.__parttyPerf");

let overlay;
let root;

test("overlay renders exact values from the real collector snapshot", () => {
	parttyPerf.configure({ enabled: true, reset: true });

	// Deterministic clock: one collector tick per call, so the enqueue -> write
	// callback latency is exactly 1 ms and rate windows stay fully predictable.
	let fakeNow = 1_000_000;
	globalThis.performance.now = () => fakeNow++;

	parttyPerf.recordPtyInputBytes("p1", 100);
	parttyPerf.recordPtyOutputBytes("p1", 50);
	const token = parttyPerf.beginTermWrite("p1", 10);
	parttyPerf.finishTermWrite(token);
	parttyPerf.mark("main.longtask.count");
	parttyPerf.time("main.longtask.ms", 12);
	parttyPerf.mark("rAF.gap.50ms");
	parttyPerf.mark("rAF.gap.100ms");

	root = new FakeNode("div");
	overlay = createDevMetricsOverlay({ root, getFocusedPaneId: () => "p1" });
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

test("freeze display stops the panel loop but the collector keeps recording", () => {
	const freezeBtn = findButton(root, "Freeze");
	assert.ok(freezeBtn, "freeze display button must exist");
	freezeBtn.click();
	assert.ok(collectText(root).includes("frozen"));
	assert.ok(collectText(root).includes("Resume"));
	assert.equal(overlay.isVisible(), true);

	parttyPerf.recordPtyOutputBytes("p1", 25);
	assert.equal(parttyPerf.snapshot().rates.out.totalBytes, 75);
});

test("hide/show toggles visibility and the panel loop", () => {
	overlay.hide();
	assert.equal(overlay.isVisible(), false);
	const overlayEl = root.children[0];
	assert.equal(overlayEl.classList.contains("dev-overlay--hidden"), true);
	overlay.show();
	assert.equal(overlay.isVisible(), true);
	assert.equal(overlayEl.classList.contains("dev-overlay--hidden"), false);
});

test("export builds a full snapshot payload without throwing", () => {
	const exportBtn = findButton(root, "Export");
	assert.ok(exportBtn, "export button must exist");
	assert.doesNotThrow(() => exportBtn.click());
});
