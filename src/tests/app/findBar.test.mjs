import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { FakeElement } from "../support/dom.mjs";
import { createVmLoader } from "../support/vm.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const match = (line, segments = [{ line, start: 0, length: 3 }]) => ({
	line,
	segments,
});

async function fixture(t, matches = [match(0), match(1)]) {
	const decorations = [];
	const markers = [];
	const scrolls = [];
	const timers = new Map();
	const colors = {
		match: { background: "#112233", foreground: "#ffffff" },
		active: { background: "#445566", foreground: "#ffffff" },
	};
	let onWrite;
	let scans = 0;
	const term = {
		buffer: { active: { baseY: 0, cursorY: 0, viewportY: 0 } },
		registerMarker(line) {
			const marker = {
				line,
				disposed: false,
				dispose() {
					this.disposed = true;
				},
			};
			markers.push(marker);
			return marker;
		},
		registerDecoration(options) {
			const decoration = {
				...options,
				disposed: false,
				dispose() {
					this.disposed = true;
				},
			};
			decorations.push(decoration);
			return decoration;
		},
		scrollToLine: (line) => scrolls.push(line),
		onWriteParsed(callback) {
			onWrite = callback;
			return {
				dispose() {
					onWrite = null;
				},
			};
		},
	};
	const loader = createVmLoader({
		root: ROOT,
		globals: {
			document: { createElement: (tag) => new FakeElement(tag) },
			window: {
				setTimeout: (fn) => {
					timers.set(1, fn);
					return 1;
				},
				clearTimeout: (id) => timers.delete(id),
			},
			requestAnimationFrame: () => 1,
		},
		stubs: {
			[resolve(ROOT, "app/findScan.ts")]: {
				scanBuffer: () => {
					scans++;
					return matches;
				},
			},
			[resolve(ROOT, "terminal/uiTheme.ts")]: {
				terminalFindColors: () => colors,
			},
			[resolve(ROOT, "util/motion.ts")]: {
				showSurface() {},
				hideSurface: (_root, _class, done) => done(),
			},
			[resolve(ROOT, "app/mouseCursor.ts")]: { mouseCursorForceVisible() {} },
			[resolve(ROOT, "app/overlayStack.ts")]: {
				pushOverlay: () => ({ release() {} }),
			},
		},
	});
	const { createFindBar } = await loader.api("app/findBar.ts");
	const root = new FakeElement();
	const bar = createFindBar({
		root,
		getTerminal: () => term,
		getHighlightColors: () => colors,
	});
	t.after(() => bar.dispose());
	const input = root.querySelector(".terminal-find-input");
	input.value = "foo";
	bar.open();
	return {
		bar,
		input,
		colors,
		decorations,
		markers,
		scrolls,
		count: root.querySelector(".terminal-find-count"),
		get scans() {
			return scans;
		},
		step(key = "Enter") {
			input.dispatch("keydown", {
				key,
				preventDefault() {},
				stopPropagation() {},
			});
		},
		flushOutput() {
			onWrite();
			const fn = timers.get(1);
			timers.clear();
			fn();
		},
	};
}

test("navigation keeps background highlights and replaces only the active match", async (t) => {
	const f = await fixture(t);
	const background = f.decorations.filter((d) => d.layer === "bottom");
	const active = f.decorations.at(-1);
	f.step();
	assert.equal(f.scans, 1);
	assert.equal(f.decorations.length, 4);
	assert.ok(background.every((d) => !d.disposed && !d.marker.disposed));
	assert.ok(active.disposed && active.marker.disposed);
	assert.equal(f.count.textContent, "2/2");
	f.step();
	assert.equal(f.count.textContent, "1/2");
	f.step("ArrowUp");
	assert.equal(f.count.textContent, "2/2");
	assert.deepEqual(f.scrolls, [0, 1, 0, 1]);
});

test("wrapped active matches replace all their segments without exceeding the background cap", async (t) => {
	const matches = [
		match(0, [
			{ line: 0, start: 0, length: 3 },
			{ line: 1, start: 0, length: 2 },
		]),
		...Array.from({ length: 405 }, (_, i) => match(i + 2)),
	];
	const f = await fixture(t, matches);
	assert.equal(f.decorations.filter((d) => d.layer === "bottom").length, 400);
	const active = f.decorations.filter((d) => d.layer === "top");
	assert.equal(active.length, 2);
	f.step();
	assert.equal(f.decorations.length, 403);
	assert.ok(active.every((d) => d.disposed && d.marker.disposed));
});

test("theme changes rebuild background colors on navigation", async (t) => {
	const f = await fixture(t);
	const previous = [...f.decorations];
	f.colors.match.background = "#778899";
	f.step();
	assert.ok(previous.every((d) => d.disposed));
	assert.ok(
		f.decorations
			.filter((d) => !d.disposed && d.layer === "bottom")
			.every((d) => d.backgroundColor === "#778899"),
	);
});

test("query changes and output rescans rebuild highlights; close releases all resources", async (t) => {
	const f = await fixture(t);
	const previous = [...f.decorations];
	f.input.value = "bar";
	f.input.dispatch("input");
	assert.equal(f.scans, 2);
	assert.ok(previous.every((d) => d.disposed));
	const afterQuery = [...f.decorations];
	f.flushOutput();
	assert.equal(f.scans, 3);
	assert.ok(afterQuery.every((d) => d.disposed));
	f.bar.close();
	assert.ok(f.decorations.every((d) => d.disposed));
	assert.ok(f.markers.every((m) => m.disposed));
});
