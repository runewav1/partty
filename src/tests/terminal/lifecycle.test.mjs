import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { FakeElement } from "../support/dom.mjs";
import { createVmLoader } from "../support/vm.mjs";

const root = resolve(import.meta.dirname, "../..");
const noop = () => {};
const ADAPTER_UNAVAILABLE_RE = /adapter unavailable/;
const ALREADY_FAILED_RE = /already failed/;
class Element {
	dataset = {};
	style = {};
	classList = { add: noop, remove: noop };
	appendChild = noop;
	addEventListener = noop;
	setAttribute = noop;
}
class Terminal {
	options;
	unicode = {};
	loadAddon = noop;
	open = noop;
	refresh = noop;
	constructor(options = {}) {
		// Mirror xterm.js: constructor options seed `term.options` (shallow copy).
		this.options = { ...options };
	}
}

const defaultComputedStyle = (el) => ({
	scale:
		el && typeof el.focusScale === "number" ? String(el.focusScale) : "none",
});

async function modules(
	extraMocks = {},
	{ elementClass = Element, computedStyle = defaultComputedStyle } = {},
) {
	const storage = new Map();
	const mocks = {
		"@xterm/xterm": { Terminal },
		"@xterm/addon-fit": { FitAddon: class {} },
		"@xterm/addon-unicode11": { Unicode11Addon: class {} },
		"@xterm/addon-unicode-graphemes": { UnicodeGraphemesAddon: class {} },
		[resolve(root, "pty/perf.ts")]: { parttyPerf: { mark: noop, time: noop } },
		[resolve(root, "util/motion.ts")]: {
			afterAnimationFrames: noop,
			animateClass: noop,
			motionDisabled: () => true,
		},
		...extraMocks,
	};
	const loader = createVmLoader({
		root,
		globals: {
			console,
			performance,
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => storage.set(key, value),
				removeItem: (key) => storage.delete(key),
			},
			document: { createElement: (tag) => new elementClass(tag) },
			CSS: { escape: (value) => String(value) },
			getComputedStyle: computedStyle,
			ResizeObserver: class {
				observe = noop;
				disconnect = noop;
			},
			requestIdleCallback: noop,
		},
		stubs: mocks,
	});
	const api = (path) => loader.api(path);
	api.storage = storage;
	return api;
}

test("dismiss/rebuild preserves each PTY through storage, tab rekey and hydration", async () => {
	const load = await modules();
	const { PaneHost, collectLeafIds } = await load("terminal/paneHost.ts");
	const tabs = await load("tabs/tabsSession.ts");
	const { mapLayoutToTabKey } = await load("terminal/paneIds.ts");
	// Exercise real terminal allocation, replacing only unrelated DOM layout work.
	PaneHost.prototype.mountTree = function () {
		const ids = [];
		collectLeafIds(this.getTree(), ids);
		for (const id of ids) this.renderNode({ kind: "leaf", id });
	};
	const createHost = (tree, sessions) =>
		new PaneHost(
			new Element(),
			{
				rootPaneId: tree.kind === "leaf" ? tree.id : tree.a.id,
				getTheme: () => ({}),
				onPaneCreated: noop,
				suppressEnterAnimation: () => true,
			},
			{ initialTree: tree, initialSessionIds: sessions },
		);
	const tree = {
		kind: "split",
		dir: "h",
		ratio: 0.5,
		a: { kind: "leaf", id: "1a" },
		b: { kind: "leaf", id: "1b" },
	};
	const original = createHost(tree);
	const sessions = {};
	original.forEachPane((id, pt) => {
		sessions[id] = pt.sessionId;
	});
	assert.notEqual(sessions["1a"], sessions["1b"]);
	tabs.persistLayoutForTab("tab-1", {
		v: 1,
		tree,
		focusedId: "1b",
		paneSessionIds: sessions,
	});
	const saved = tabs.initialLayoutForTab("tab-1", false);
	const restored = mapLayoutToTabKey(saved, "2", new Set()).layout;
	const rebuilt = createHost(restored.tree, restored.paneSessionIds);
	assert.equal(rebuilt.getPaneTerminal("2a").sessionId, sessions["1a"]);
	assert.equal(rebuilt.getPaneTerminal("2b").sessionId, sessions["1b"]);
	// Reusing a pane slot after closing must not reuse its old process.
	rebuilt.terminals.delete("2a");
	rebuilt.renderNode({ kind: "leaf", id: "2a" });
	assert.notEqual(rebuilt.getPaneTerminal("2a").sessionId, sessions["1a"]);
	const duplicate = tabs.duplicateTabLayout(saved, "3", new Set());
	const copied = createHost(duplicate.tree, duplicate.paneSessionIds);
	assert.notEqual(copied.getPaneTerminal("3a").sessionId, sessions["1a"]);
	assert.notEqual(copied.getPaneTerminal("3b").sessionId, sessions["1b"]);
});

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test("dismiss→rebuild re-hooks the same PTY session (regression: session must survive webview teardown)", async () => {
	const load = await modules();
	const { PaneHost, collectLeafIds } = await load("terminal/paneHost.ts");
	const tabs = await load("tabs/tabsSession.ts");
	const { mapLayoutToTabKey } = await load("terminal/paneIds.ts");
	PaneHost.prototype.mountTree = function () {
		const ids = [];
		collectLeafIds(this.getTree(), ids);
		for (const id of ids) this.renderNode({ kind: "leaf", id });
	};
	const createHost = (tree, sessions) =>
		new PaneHost(
			new Element(),
			{
				rootPaneId: tree.kind === "leaf" ? tree.id : tree.a.id,
				getTheme: () => ({}),
				onPaneCreated: noop,
				suppressEnterAnimation: () => true,
			},
			{ initialTree: tree, initialSessionIds: sessions },
		);

	// Round trip mirrors the real flow: webview A lives → hide persists the
	// layout (including per-pane session ids) → webview A is destroyed →
	// webview B boots from the persisted layout and must re-hook the SAME
	// backend session ids (the PTY processes kept alive in Rust).
	const tree = {
		kind: "split",
		dir: "h",
		ratio: 0.5,
		a: { kind: "leaf", id: "1a" },
		b: { kind: "leaf", id: "1b" },
	};
	const webviewA = createHost(tree);
	const sessions = {};
	webviewA.forEachPane((id, pt) => {
		sessions[id] = pt.sessionId;
	});
	// Simulate the `partty-hide` persist-all-hosts path.
	tabs.persistLayoutForTab("tab-1", {
		v: 1,
		tree,
		focusedId: "1b",
		paneSessionIds: sessions,
	});
	const layoutOnDisk = tabs.initialLayoutForTab("tab-1", false);
	const restored = mapLayoutToTabKey(layoutOnDisk, "1", new Set()).layout;
	const webviewB = createHost(restored.tree, restored.paneSessionIds);
	assert.equal(webviewB.getPaneTerminal("1a").sessionId, sessions["1a"]);
	assert.equal(webviewB.getPaneTerminal("1b").sessionId, sessions["1b"]);
	// The backend re-subscribe in pty_ensure keys purely on sessionId, so a
	// preserved id proves the correct process is re-attached rather than respawned.

	// Guard: WITHOUT the persisted session ids (pre-fix behavior), every rebuilt
	// pane would allocate a fresh session and pty_ensure would spawn a new shell.
	const noSessionMap = createHost(restored.tree);
	assert.notEqual(noSessionMap.getPaneTerminal("1a").sessionId, sessions["1a"]);
	assert.notEqual(noSessionMap.getPaneTerminal("1b").sessionId, sessions["1b"]);
});

test("first tab rehydrates the per-tab layout (with session ids) even when a legacy layout lingers", async () => {
	const load = await modules();
	const tabs = await load("tabs/tabsSession.ts");
	const { PANE_LAYOUT_KEY } = await load("util/storageKeys.ts");
	const sessions = { "1a": "sid-a", "1b": "sid-b" };
	tabs.persistLayoutForTab("tab-1", {
		v: 1,
		tree: {
			kind: "split",
			dir: "h",
			ratio: 0.5,
			a: { kind: "leaf", id: "1a" },
			b: { kind: "leaf", id: "1b" },
		},
		focusedId: "1b",
		paneSessionIds: sessions,
	});
	// A stale legacy single-tab layout must not shadow the per-tab layout.
	load.storage.set(
		PANE_LAYOUT_KEY,
		JSON.stringify({
			v: 1,
			tree: { kind: "leaf", id: "main" },
			focusedId: "main",
		}),
	);
	const first = tabs.initialLayoutForTab("tab-1", true);
	assert.equal(first.paneSessionIds?.["1a"], "sid-a");
	assert.equal(first.paneSessionIds?.["1b"], "sid-b");
	// Migration still works when there is no per-tab layout yet.
	const fresh = await modules();
	const freshTabs = await fresh("tabs/tabsSession.ts");
	const freshIds = await fresh("terminal/paneIds.ts");
	const { PANE_LAYOUT_KEY: LegacyKey } = await fresh("util/storageKeys.ts");
	fresh.storage.set(
		LegacyKey,
		JSON.stringify({
			v: 1,
			tree: { kind: "leaf", id: "main" },
			focusedId: "main",
		}),
	);
	const migrated = freshTabs.initialLayoutForTab("tab-1", true);
	// Boot reconciles the legacy `main` root through mapLayoutToTabKey.
	const reconciled = freshIds.mapLayoutToTabKey(
		migrated,
		"1",
		new Set(),
	).layout;
	assert.equal(reconciled.tree.id, "1a");
	assert.equal(reconciled.focusedId, "1a");
});

test("renderer creation is shared and a late completion cannot survive hide", async () => {
	const creations = [];
	const load = await modules({
		"@partty/addon-webgpu": {
			WebgpuSession: {
				create: () => {
					const creation = deferred();
					creations.push(creation);
					return creation.promise;
				},
			},
		},
	});
	const lifecycle = await load("terminal/termLifecycle.ts");
	const first = lifecycle.createRendererAddon(true);
	const second = lifecycle.createRendererAddon(true);
	const oldResults = Promise.allSettled([first, second]);
	await new Promise(setImmediate);
	assert.equal(creations.length, 1);
	lifecycle.disposeWebgpuSession();
	const next = lifecycle.createRendererAddon(true);
	await new Promise(setImmediate);
	assert.equal(creations.length, 2);
	let oldDisposed = 0;
	creations[0].resolve({
		dispose: () => oldDisposed++,
		createAddon: () => "stale",
		onError: noop,
		onContextLoss: noop,
	});
	assert.ok((await oldResults).every((result) => result.status === "rejected"));
	assert.equal(oldDisposed, 1);
	creations[1].resolve({
		dispose: noop,
		createAddon: () => "current",
		onError: noop,
		onContextLoss: noop,
	});
	assert.equal(await next, "current");
	assert.equal(await lifecycle.createRendererAddon(true), "current");
	lifecycle.disposeWebgpuSession();
});

test("WebGPU shedding releases ready sessions and summon creates fresh pane addons", async () => {
	const sessions = [];
	const load = await modules({
		"@partty/addon-webgpu": {
			WebgpuSession: {
				create: async () => {
					const session = {
						disposed: 0,
						addons: [],
						onError(callback) {
							this.error = callback;
						},
						onContextLoss(callback) {
							this.loss = callback;
						},
						createAddon() {
							assert.equal(this.disposed, 0);
							const addon = {
								session: this,
								disposed: false,
								dispose() {
									this.disposed = true;
								},
							};
							this.addons.push(addon);
							return addon;
						},
						dispose() {
							assert.ok(this.addons.every((addon) => addon.disposed));
							this.disposed++;
						},
					};
					sessions.push(session);
					return session;
				},
			},
		},
	});
	const lifecycle = await load("terminal/termLifecycle.ts");
	for (let cycle = 0; cycle < 3; cycle++) {
		// biome-ignore lint/performance/noAwaitInLoops: Each summon must follow the previous dismiss of the shared session.
		const addons = await Promise.all([
			lifecycle.createRendererAddon(true),
			lifecycle.createRendererAddon(true),
		]);
		assert.equal(sessions.length, cycle + 1);
		assert.notEqual(addons[0], addons[1]);
		assert.ok(addons.every((addon) => addon.session === sessions[cycle]));
		if (cycle > 0) {
			// Delayed callbacks from a disposed device cannot poison the new session.
			sessions[cycle - 1].error();
			sessions[cycle - 1].loss();
		}
		const extra = await lifecycle.createRendererAddon(true);
		assert.equal(extra.session, sessions[cycle]);
		// Same disposal order as main.ts shedWebgl: pane addons, then session.
		for (const addon of [...addons, extra]) addon.dispose();
		lifecycle.disposeWebgpuSession();
		lifecycle.disposeWebgpuSession();
		assert.equal(sessions[cycle].disposed, 1);
	}
});

test("WebGPU creation failure does not prevent retry after dismiss and summon", async () => {
	let attempts = 0;
	const addon = {};
	const load = await modules({
		"@partty/addon-webgpu": {
			WebgpuSession: {
				create: async () => {
					if (++attempts === 1) throw new Error("adapter unavailable");
					return {
						onError: noop,
						onContextLoss: noop,
						dispose: noop,
						createAddon: () => addon,
					};
				},
			},
		},
	});
	const lifecycle = await load("terminal/termLifecycle.ts");
	await assert.rejects(
		lifecycle.createRendererAddon(true),
		ADAPTER_UNAVAILABLE_RE,
	);
	await assert.rejects(lifecycle.createRendererAddon(true), ALREADY_FAILED_RE);
	assert.equal(attempts, 1);
	lifecycle.disposeWebgpuSession();
	assert.equal(await lifecycle.createRendererAddon(true), addon);
	assert.equal(attempts, 2);
	lifecycle.disposeWebgpuSession();
});

/**
 * Pane motion FLIP regression.
 *
 * `playPaneMotion` must finish every geometry read before it writes any custom
 * property, keep the movement thresholds/values and preserve animation order.
 * The real `swapPanes` controller path runs; only `leafEl`/`mountTree` are
 * stubbed so the capture -> mount -> play ordering is exercised unchanged.
 */
function motionMock(events) {
	return {
		afterAnimationFrames: noop,
		animateClass: (el, _className, onFinish) => {
			events.animates.push(el.id);
			onFinish?.();
		},
		motionDisabled: () => false,
	};
}

function createMotionPaneHost(PaneHost, events) {
	const log = [];
	const leaves = new Map();
	const makeLeaf = (id) => {
		const leaf = {
			id,
			rect: { left: 0, top: 0, width: 100, height: 100 },
			nextRect: null,
			// Uniform focus-scale factor about the bounding-box centre, mirrored
			// by the `getComputedStyle` global above.
			focusScale: 1,
			style: {
				setProperty(name, value) {
					log.push({ type: "write", id, name, value });
				},
				removeProperty(name) {
					log.push({ type: "remove", id, name });
				},
			},
			classList: { add: noop, remove: noop, toggle: noop },
			getBoundingClientRect() {
				log.push({ type: "read", id });
				const width = this.rect.width * this.focusScale;
				const height = this.rect.height * this.focusScale;
				return {
					left: this.rect.left + (this.rect.width - width) / 2,
					top: this.rect.top + (this.rect.height - height) / 2,
					width,
					height,
				};
			},
		};
		leaves.set(id, leaf);
		return leaf;
	};
	makeLeaf("1a");
	makeLeaf("1b");
	PaneHost.prototype.leafEl = (id) => leaves.get(id) ?? null;
	PaneHost.prototype.mountTree = () => {
		for (const leaf of leaves.values()) {
			if (leaf.nextRect) {
				leaf.rect = leaf.nextRect;
				leaf.nextRect = null;
			}
		}
		log.length = 0;
	};
	const host = new PaneHost(
		new Element(),
		{
			rootPaneId: "1a",
			getTheme: () => ({}),
			onPaneCreated: noop,
			onPaneFocus: noop,
			onPaneDisposed: noop,
			suppressEnterAnimation: () => true,
		},
		{
			initialTree: {
				kind: "split",
				dir: "h",
				ratio: 0.5,
				a: { kind: "leaf", id: "1a" },
				b: { kind: "leaf", id: "1b" },
			},
		},
	);
	return { host, leaves, log, events };
}

test("pane motion batches every geometry read before writing custom properties", async () => {
	const events = { animates: [] };
	const load = await modules({
		[resolve(root, "util/motion.ts")]: motionMock(events),
	});
	const { PaneHost } = await load("terminal/paneHost.ts");
	const { host, leaves, log } = createMotionPaneHost(PaneHost, events);
	leaves.get("1a").rect = { left: 0, top: 0, width: 100, height: 100 };
	leaves.get("1a").nextRect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").rect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").nextRect = { left: 0, top: 0, width: 100, height: 100 };

	assert.equal(host.swapPanes("1a", "1b"), true);
	const reads = log.filter((e) => e.type === "read");
	assert.deepEqual(
		reads.map((e) => e.id),
		["1a", "1b"],
		"one measure per moving pane",
	);
	const firstWrite = log.findIndex((e) => e.type === "write");
	assert.equal(firstWrite, reads.length, "all reads precede the first write");
	assert.ok(
		log.slice(0, firstWrite).every((e) => e.type === "read"),
		"no writes during the measure pass",
	);
	assert.deepEqual(
		log
			.filter((e) => e.type === "write" && e.id === "1a")
			.map((e) => [e.name, e.value]),
		[
			["--pane-motion-dx", "-100px"],
			["--pane-motion-dy", "0px"],
			["--pane-motion-sx", "1"],
			["--pane-motion-sy", "1"],
		],
	);
	assert.deepEqual(events.animates, ["1a", "1b"], "animation order preserved");
	assert.deepEqual(
		log.filter((e) => e.type === "remove" && e.id === "1a").map((e) => e.name),
		[
			"--pane-motion-dx",
			"--pane-motion-dy",
			"--pane-motion-sx",
			"--pane-motion-sy",
		],
		"completion cleanup removes all four custom properties",
	);
});

test("pane motion skips panes inside the no-op thresholds", async () => {
	const events = { animates: [] };
	const load = await modules({
		[resolve(root, "util/motion.ts")]: motionMock(events),
	});
	const { PaneHost } = await load("terminal/paneHost.ts");
	const { host, leaves, log } = createMotionPaneHost(PaneHost, events);
	leaves.get("1a").rect = { left: 0, top: 0, width: 100, height: 100 };
	leaves.get("1a").nextRect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").rect = { left: 50, top: 50, width: 100, height: 100 };
	leaves.get("1b").nextRect = { left: 50.2, top: 50, width: 100, height: 100 };

	assert.equal(host.swapPanes("1a", "1b"), true);
	assert.deepEqual(events.animates, ["1a"]);
	assert.equal(
		log.some((e) => e.type === "write" && e.id === "1b"),
		false,
		"a no-op pane is never written",
	);
});

test("pane motion skips a pane whose element vanished after capture", async () => {
	const events = { animates: [] };
	const load = await modules({
		[resolve(root, "util/motion.ts")]: motionMock(events),
	});
	const { PaneHost } = await load("terminal/paneHost.ts");
	const { host, leaves, log } = createMotionPaneHost(PaneHost, events);
	leaves.get("1a").rect = { left: 0, top: 0, width: 100, height: 100 };
	leaves.get("1a").nextRect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").rect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").nextRect = { left: 0, top: 0, width: 100, height: 100 };
	// Drop 1b's element between capture and play, like a disposed leaf.
	PaneHost.prototype.mountTree = () => {
		const a = leaves.get("1a");
		if (a?.nextRect) {
			a.rect = a.nextRect;
			a.nextRect = null;
		}
		leaves.delete("1b");
		log.length = 0;
	};

	assert.equal(host.swapPanes("1a", "1b"), true);
	assert.deepEqual(events.animates, ["1a"]);
	assert.equal(
		log.some((e) => e.id === "1b"),
		false,
		"the missing pane produces no motion work",
	);
});

test("pane motion is fully skipped under reduced motion", async () => {
	const events = { animates: [] };
	const load = await modules({
		[resolve(root, "util/motion.ts")]: {
			afterAnimationFrames: noop,
			animateClass: (el, _className, onFinish) => {
				events.animates.push(el.id);
				onFinish?.();
			},
			motionDisabled: () => true,
		},
	});
	const { PaneHost } = await load("terminal/paneHost.ts");
	const { host, leaves, log } = createMotionPaneHost(PaneHost, events);
	leaves.get("1a").rect = { left: 0, top: 0, width: 100, height: 100 };
	leaves.get("1a").nextRect = { left: 100, top: 0, width: 100, height: 100 };

	assert.equal(host.swapPanes("1a", "1b"), true);
	assert.deepEqual(events.animates, []);
	assert.deepEqual(log, [], "no reads or writes when motion is disabled");
});

test("first split starts at the original size when the surviving pane becomes unfocused", async () => {
	const events = { animates: [] };
	const load = await modules({
		[resolve(root, "util/motion.ts")]: motionMock(events),
	});
	const { PaneHost } = await load("terminal/paneHost.ts");
	const { host, leaves, log } = createMotionPaneHost(PaneHost, events);
	const before = host.capturePaneMotion(["1a"]);
	leaves.get("1a").rect = { left: 0, top: 0, width: 50, height: 100 };
	leaves.get("1a").focusScale = 0.994;
	host.playPaneMotion(before);
	const written = (name) =>
		log.find((e) => e.type === "write" && e.name === name)?.value;
	assert.equal(written("--pane-motion-sx"), "2");
	assert.equal(written("--pane-motion-sy"), "1");
	assert.equal(written("--pane-motion-dx"), "0px");
	assert.equal(written("--pane-motion-dy"), "0px");
});

test("pane motion starts at the visible source without double-counting destination focus scale", async () => {
	const events = { animates: [] };
	const load = await modules({
		[resolve(root, "util/motion.ts")]: motionMock(events),
	});
	const { PaneHost } = await load("terminal/paneHost.ts");
	const { host, leaves, log } = createMotionPaneHost(PaneHost, events);

	// The source may already have focus scaling; preserve its visible bounds.
	leaves.get("1a").rect = { left: 0, top: 0, width: 100, height: 100 };
	leaves.get("1a").nextRect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").rect = { left: 100, top: 0, width: 100, height: 100 };
	leaves.get("1b").nextRect = { left: 0, top: 0, width: 100, height: 100 };

	// The destination's focus scale disappears when the moving class is added.
	// It must not contaminate the FLIP denominator or destination position.
	const delta = 0.006;
	leaves.get("1a").focusScale = 1 + delta;
	leaves.get("1b").focusScale = 1 - delta;
	const baseMount = PaneHost.prototype.mountTree;
	PaneHost.prototype.mountTree = function () {
		baseMount.call(this);
		leaves.get("1a").focusScale = 1 - delta;
		leaves.get("1b").focusScale = 1 + delta;
	};

	assert.equal(host.swapPanes("1a", "1b"), true);
	const written = (id, name) =>
		log.find((e) => e.type === "write" && e.id === id && e.name === name)
			?.value;
	const near = (actual, expected) =>
		assert.ok(Math.abs(actual - expected) < 1e-9);
	near(Number(written("1a", "--pane-motion-sx")) * 100, 100 * (1 + delta));
	near(
		100 + Number.parseFloat(written("1a", "--pane-motion-dx")),
		(-100 * delta) / 2,
	);
	near(Number(written("1b", "--pane-motion-sx")) * 100, 100 * (1 - delta));
});

test("cursor trail applies to live panes and to panes created after a change", async () => {
	const load = await modules();
	const { PaneHost, collectLeafIds } = await load("terminal/paneHost.ts");
	PaneHost.prototype.mountTree = function () {
		const ids = [];
		collectLeafIds(this.getTree(), ids);
		for (const id of ids) this.renderNode({ kind: "leaf", id });
	};
	const first = {
		cursorTrail: 140,
		cursorTrailDecay: [0.1, 0.4],
		cursorTrailStartThreshold: 2,
		cursorTrailColor: "none",
	};
	const second = {
		cursorTrail: 0,
		cursorTrailDecay: [0.2, 0.5],
		cursorTrailStartThreshold: [1, 3],
		cursorTrailColor: "#ff0000",
	};
	const host = new PaneHost(
		new Element(),
		{
			rootPaneId: "1a",
			...first,
			getTheme: () => ({}),
			onPaneCreated: noop,
			suppressEnterAnimation: () => true,
		},
		{
			initialTree: {
				kind: "split",
				dir: "h",
				ratio: 0.5,
				a: { kind: "leaf", id: "1a" },
				b: { kind: "leaf", id: "1b" },
			},
		},
	);
	// Initial construction propagates the flat options to every existing pane.
	assert.equal(host.getPaneTerminal("1a").term.options.cursorTrail, 140);
	assert.deepEqual(
		host.getPaneTerminal("1a").term.options.cursorTrailDecay,
		[0.1, 0.4],
	);
	assert.equal(host.getPaneTerminal("1b").term.options.cursorTrail, 140);

	// A runtime change reaches every live pane, including an explicit zero.
	host.setCursorTrail(second);
	assert.equal(host.getPaneTerminal("1a").term.options.cursorTrail, 0);
	assert.deepEqual(
		host.getPaneTerminal("1a").term.options.cursorTrailDecay,
		[0.2, 0.5],
	);
	assert.deepEqual(
		host.getPaneTerminal("1a").term.options.cursorTrailStartThreshold,
		[1, 3],
	);
	assert.equal(
		host.getPaneTerminal("1b").term.options.cursorTrailColor,
		"#ff0000",
	);

	// A pane (re)created after the change inherits the latest flat options.
	host.terminals.delete("1b");
	host.renderNode({ kind: "leaf", id: "1b" });
	assert.equal(host.getPaneTerminal("1b").term.options.cursorTrail, 0);
	assert.equal(
		host.getPaneTerminal("1b").term.options.cursorTrailColor,
		"#ff0000",
	);
});

test("cursor trail is left to the core default when the preference is absent", async () => {
	const load = await modules();
	const { PaneHost, collectLeafIds } = await load("terminal/paneHost.ts");
	PaneHost.prototype.mountTree = function () {
		const ids = [];
		collectLeafIds(this.getTree(), ids);
		for (const id of ids) this.renderNode({ kind: "leaf", id });
	};
	const host = new PaneHost(
		new Element(),
		{
			rootPaneId: "1a",
			getTheme: () => ({}),
			onPaneCreated: noop,
			suppressEnterAnimation: () => true,
		},
		{ initialTree: { kind: "leaf", id: "1a" } },
	);
	assert.equal(host.getPaneTerminal("1a").term.options.cursorTrail, undefined);
});

test("cursor trail survives a webview shed/rebuild (recreated host)", async () => {
	const load = await modules();
	const { PaneHost, collectLeafIds } = await load("terminal/paneHost.ts");
	PaneHost.prototype.mountTree = function () {
		const ids = [];
		collectLeafIds(this.getTree(), ids);
		for (const id of ids) this.renderNode({ kind: "leaf", id });
	};
	const trail = {
		cursorTrail: 200,
		cursorTrailDecay: [0.15, 0.45],
		cursorTrailStartThreshold: [2, 4],
		cursorTrailColor: "#20b2aa",
	};
	const tree = { kind: "leaf", id: "1a" };
	const opts = {
		rootPaneId: "1a",
		...trail,
		getTheme: () => ({}),
		onPaneCreated: noop,
		suppressEnterAnimation: () => true,
	};
	const before = new PaneHost(new Element(), opts, { initialTree: tree });
	assert.equal(before.getPaneTerminal("1a").term.options.cursorTrail, 200);

	// Webview teardown discards the host; the rebuilt host is constructed with
	// the current preference (as createPaneHost does from its ref), so the
	// recreated pane keeps the trail instead of falling back to the default.
	const after = new PaneHost(new Element(), opts, { initialTree: tree });
	assert.notEqual(after, before);
	assert.equal(after.getPaneTerminal("1a").term.options.cursorTrail, 200);
	assert.deepEqual(
		after.getPaneTerminal("1a").term.options.cursorTrailDecay,
		[0.15, 0.45],
	);
	assert.equal(
		after.getPaneTerminal("1a").term.options.cursorTrailColor,
		"#20b2aa",
	);
});

/**
 * Pane-host focus listener lifecycle regression.
 *
 * `mountTree` replaces the host's descendants on every remount. Leaf focus is a
 * bubble-phase listener on the persistent host root, so it must be registered
 * once with the host rather than re-added by each mount (which accumulated
 * duplicate handlers and repeated focus work on every pointerdown).
 */
function rootPointerDownListeners(host) {
	return host.root.listeners.get("pointerdown") ?? [];
}

function leafTarget(leaf) {
	return {
		closest: (selector) => (selector === ".pane-leaf" ? leaf : null),
	};
}

test("pane host leaf focus keeps one listener across remounts and drops it on dispose", async () => {
	const load = await modules({}, { elementClass: FakeElement });
	const { PaneHost } = await load("terminal/paneHost.ts");
	const focused = [];
	const host = new PaneHost(
		new FakeElement(),
		{
			rootPaneId: "1a",
			getTheme: () => ({}),
			onPaneCreated: noop,
			onPaneFocus: (id) => focused.push(id),
			onPaneDisposed: noop,
			suppressEnterAnimation: () => true,
		},
		{
			initialTree: {
				kind: "split",
				dir: "h",
				ratio: 0.5,
				a: { kind: "leaf", id: "1a" },
				b: { kind: "leaf", id: "1b" },
			},
		},
	);

	// One capture-phase alt-drag listener plus one bubble-phase focus listener.
	assert.equal(rootPointerDownListeners(host).length, 2);
	for (let i = 0; i < 3; i += 1) host.mountTree();
	assert.equal(
		rootPointerDownListeners(host).length,
		2,
		"remounting must not re-register root pointerdown handlers",
	);

	// The stable handler still resolves the freshly mounted leaf.
	const leaf = host.root
		.querySelectorAll(".pane-leaf")
		.find((el) => el.dataset.paneId === "1b");
	host.root.dispatch("pointerdown", {
		target: leafTarget(leaf),
		altKey: false,
		button: 0,
		preventDefault: noop,
		stopPropagation: noop,
	});
	assert.equal(host.getFocusedPaneId(), "1b");
	assert.deepEqual(focused, ["1b"]);

	host.dispose();
	assert.equal(
		rootPointerDownListeners(host).length,
		0,
		"dispose must remove the stable root handlers",
	);
});

/**
 * Shared follow-layer ownership regression.
 *
 * Every live tab host renders follow floats into one shared followMount.
 * `wireFocus` wires resize handles by querying that layer, so it must ignore
 * leaves owned by other hosts: otherwise a foreign follow leaf retains this
 * host's closures and receives its resize handling.
 */
function followHandles(leaf) {
	return [
		...leaf.querySelectorAll(".pane-corner-handle"),
		...leaf.querySelectorAll(".pane-floating-resize"),
	];
}

function assertWired(leaf, label) {
	const handles = followHandles(leaf);
	assert.equal(handles.length, 8, `${label} renders every resize handle`);
	for (const handle of handles) {
		assert.equal(
			(handle.listeners.get("pointerdown") ?? []).length,
			1,
			`${label} wires each follow resize handle exactly once`,
		);
	}
	return handles.map((handle) => handle.listeners.get("pointerdown")[0]);
}

test("shared follow mount only wires resize handles owned by each host", async () => {
	const load = await modules({}, { elementClass: FakeElement });
	const { PaneHost } = await load("terminal/paneHost.ts");
	const followMount = new FakeElement();
	const followLeaf = (id) =>
		followMount
			.querySelectorAll(".pane-leaf")
			.find((el) => el.dataset.paneId === id) ?? null;
	const createHost = (rootId, followId) =>
		new PaneHost(
			new FakeElement(),
			{
				rootPaneId: rootId,
				followMount,
				getTheme: () => ({}),
				onPaneCreated: noop,
				onPaneFocus: noop,
				onPaneDisposed: noop,
				suppressEnterAnimation: () => true,
			},
			{
				initialTree: {
					kind: "split",
					dir: "h",
					ratio: 0.5,
					a: { kind: "leaf", id: rootId },
					b: { kind: "leaf", id: followId },
				},
				initialFloating: {
					[followId]: {
						x: 0,
						y: 0,
						width: 320,
						height: 200,
						z: 1,
						follow: true,
					},
				},
			},
		);

	const hostA = createHost("1a", "*a");
	const leafA = followLeaf("*a");
	assert.ok(leafA);
	const listenersA = assertWired(leafA, "host A");

	// A second live host mounting into the shared layer must not touch A's DOM.
	const hostB = createHost("2a", "*b");
	const leafB = followLeaf("*b");
	assert.ok(leafB);
	const listenersB = assertWired(leafB, "host B");
	assert.notDeepEqual(listenersA, listenersB);
	assert.deepEqual(assertWired(leafA, "host A after host B mount"), listenersA);

	// Remounting either host rebuilds only its own follow leaf.
	hostB.mountTree();
	assert.equal(followLeaf("*a"), leafA, "host B remount leaves A's DOM alone");
	const listenersBAfter = assertWired(followLeaf("*b"), "host B after remount");
	assert.deepEqual(
		assertWired(leafA, "host A after host B remount"),
		listenersA,
	);

	hostA.mountTree();
	const nextLeafA = followLeaf("*a");
	assert.ok(nextLeafA);
	assert.notEqual(nextLeafA, leafA);
	const listenersAAfter = assertWired(nextLeafA, "host A after remount");
	assert.deepEqual(
		assertWired(followLeaf("*b"), "host B after host A remount"),
		listenersBAfter,
	);
	assert.notDeepEqual(listenersAAfter, listenersA);

	// Disposing the unrelated host removes only its follow leaf; A's surviving
	// handles keep exactly their own callbacks and no stale B closures.
	hostB.dispose();
	assert.equal(followLeaf("*b"), null);
	assert.deepEqual(
		assertWired(followLeaf("*a"), "host A after host B disposal"),
		listenersAAfter,
	);

	hostA.dispose();
	assert.equal(followLeaf("*a"), null);
});

/**
 * Deferred restored-tab teardown regression.
 *
 * Boot parks inactive tabs in `deferredTabInits` with their restored layout and
 * stable PTY session ids. Closing one before activation must release those
 * backend sessions and the metadata seeded for its panes, without constructing
 * a terminal host. Hydration instead consumes the init and transfers ownership.
 */
test("deferred tab teardown kills restored sessions and clears seeded metadata after rekey", async () => {
	const load = await modules();
	const tabs = await load("tabs/tabsSession.ts");
	const { mapLayoutToTabKey } = await load("terminal/paneIds.ts");
	const saved = {
		v: 1,
		tree: {
			kind: "split",
			dir: "h",
			ratio: 0.5,
			a: { kind: "leaf", id: "1a" },
			b: { kind: "leaf", id: "1b" },
		},
		focusedId: "1b",
		paneSessionIds: { "1a": "sid-a", "1b": "sid-b" },
		paneThemes: {
			"1a": { background: "#111111" },
			"1b": { background: "#222222" },
		},
		paneProfileIds: { "1a": "profile-a", "1b": "profile-b" },
		paneCwds: { "1a": "C:\\a", "1b": "C:\\b" },
	};
	const mapped = mapLayoutToTabKey(saved, "3", new Set()).layout;
	// Session ids stay stable by value even though their pane-id keys rekey.
	assert.equal(mapped.paneSessionIds["3a"], "sid-a");
	assert.equal(mapped.paneSessionIds["3b"], "sid-b");
	const maps = {
		paneThemes: new Map(Object.entries(mapped.paneThemes)),
		paneProfileIds: new Map(Object.entries(mapped.paneProfileIds)),
		paneCwdHints: new Map(Object.entries(mapped.paneCwds)),
	};
	const killed = [];
	tabs.disposeDeferredTabPanes(
		{
			init: {
				initialTree: mapped.tree,
				initialSessionIds: mapped.paneSessionIds,
			},
			rootPaneId: "3a",
		},
		{
			hasLiveHost: false,
			maps,
			killSession: (sessionId) => killed.push(sessionId),
		},
	);
	assert.deepEqual(killed.sort(), ["sid-a", "sid-b"]);
	assert.equal(maps.paneThemes.size, 0);
	assert.equal(maps.paneProfileIds.size, 0);
	assert.equal(maps.paneCwdHints.size, 0);
});

test("deferred tab teardown without session ids only clears metadata", async () => {
	const load = await modules();
	const tabs = await load("tabs/tabsSession.ts");
	const tree = {
		kind: "split",
		dir: "v",
		ratio: 0.5,
		a: { kind: "leaf", id: "4a" },
		b: { kind: "leaf", id: "4b" },
	};
	const maps = {
		paneThemes: new Map([
			["4a", { background: "#111111" }],
			["4b", { background: "#222222" }],
		]),
		paneProfileIds: new Map([
			["4a", "profile-a"],
			["4b", "profile-b"],
		]),
		paneCwdHints: new Map([
			["4a", "C:\\a"],
			["4b", "C:\\b"],
		]),
	};
	const killed = [];
	tabs.disposeDeferredTabPanes(
		{ init: { initialTree: tree }, rootPaneId: "4a" },
		{
			hasLiveHost: false,
			maps,
			killSession: (sessionId) => killed.push(sessionId),
		},
	);
	assert.deepEqual(killed, [], "a layout without session ids spawns no kill");
	assert.equal(maps.paneThemes.size, 0);
	assert.equal(maps.paneProfileIds.size, 0);
	assert.equal(maps.paneCwdHints.size, 0);
});

test("deferred pane metadata follows layout rekey without overwriting a swapped tab", async () => {
	const load = await modules();
	const tabs = await load("tabs/tabsSession.ts");
	const maps = {
		paneThemes: new Map([
			["1a", "theme-a"],
			["2a", "theme-b"],
		]),
		paneProfileIds: new Map([
			["1a", "profile-a"],
			["2a", "profile-b"],
		]),
		paneCwdHints: new Map([
			["1a", "C:\\a"],
			["2a", "C:\\b"],
		]),
	};
	// Tab indexes swapped: each pane must keep its own metadata.
	tabs.rekeyDeferredPaneMaps(
		[
			{ from: "1a", to: "2a" },
			{ from: "2a", to: "1a" },
		],
		maps,
	);
	assert.equal(maps.paneThemes.get("1a"), "theme-b");
	assert.equal(maps.paneThemes.get("2a"), "theme-a");
	assert.equal(maps.paneProfileIds.get("1a"), "profile-b");
	assert.equal(maps.paneProfileIds.get("2a"), "profile-a");
	assert.equal(maps.paneCwdHints.get("1a"), "C:\\b");
	assert.equal(maps.paneCwdHints.get("2a"), "C:\\a");
});

test("hydration consumes deferred sessions while live host disposal stays the owner", async () => {
	const load = await modules({}, { elementClass: FakeElement });
	const { PaneHost, collectLeafIds } = await load("terminal/paneHost.ts");
	const tabs = await load("tabs/tabsSession.ts");
	PaneHost.prototype.mountTree = function () {
		const ids = [];
		collectLeafIds(this.getTree(), ids);
		for (const id of ids) this.renderNode({ kind: "leaf", id });
	};
	const tree = {
		kind: "split",
		dir: "h",
		ratio: 0.5,
		a: { kind: "leaf", id: "2a" },
		b: { kind: "leaf", id: "2b" },
	};
	const sessions = { "2a": "sid-a", "2b": "sid-b" };
	const deferred = new Map([
		[
			"tab-2",
			{
				init: { initialTree: tree, initialSessionIds: sessions },
				rootPaneId: "2a",
			},
		],
	]);
	const hydrated = tabs.takeDeferredTabInit(deferred, "tab-2");
	assert.ok(hydrated);
	assert.equal(deferred.size, 0);
	const killed = [];
	tabs.disposeDeferredTabPanes(deferred.get("tab-2"), {
		hasLiveHost: false,
		maps: {
			paneThemes: new Map(),
			paneProfileIds: new Map(),
			paneCwdHints: new Map(),
		},
		killSession: (sessionId) => killed.push(sessionId),
	});
	assert.deepEqual(
		killed,
		[],
		"hydration transfers ownership instead of killing",
	);

	const host = new PaneHost(
		new FakeElement(),
		{
			rootPaneId: "2a",
			getTheme: () => ({}),
			onPaneCreated: noop,
			onPaneDisposed: noop,
			suppressEnterAnimation: () => true,
		},
		hydrated.init,
	);
	assert.equal(host.getPaneTerminal("2a").sessionId, "sid-a");
	assert.equal(host.getPaneTerminal("2b").sessionId, "sid-b");
	host.dispose();

	// A live host keeps its existing disposal path; the deferred helper must not
	// duplicate its kills or clear metadata the host still owns.
	const liveTree = {
		kind: "split",
		dir: "h",
		ratio: 0.5,
		a: { kind: "leaf", id: "5a" },
		b: { kind: "leaf", id: "5b" },
	};
	const disposed = [];
	const live = new PaneHost(
		new FakeElement(),
		{
			rootPaneId: "5a",
			getTheme: () => ({}),
			onPaneCreated: noop,
			onPaneDisposed: (paneId, sessionId) => disposed.push([paneId, sessionId]),
			suppressEnterAnimation: () => true,
		},
		{
			initialTree: liveTree,
			initialSessionIds: { "5a": "live-a", "5b": "live-b" },
		},
	);
	const liveMaps = {
		paneThemes: new Map([["5a", "theme-a"]]),
		paneProfileIds: new Map([["5a", "profile-a"]]),
		paneCwdHints: new Map([["5a", "C:\\a"]]),
	};
	const liveKilled = [];
	tabs.disposeDeferredTabPanes(
		{
			init: {
				initialTree: liveTree,
				initialSessionIds: { "5a": "live-a", "5b": "live-b" },
			},
			rootPaneId: "5a",
		},
		{
			hasLiveHost: true,
			maps: liveMaps,
			killSession: (sessionId) => liveKilled.push(sessionId),
		},
	);
	assert.deepEqual(liveKilled, [], "live host disposal owns the kill");
	assert.equal(liveMaps.paneThemes.size, 1);
	live.dispose();
	assert.deepEqual(disposed.sort(), [
		["5a", "live-a"],
		["5b", "live-b"],
	]);
});

const PTY_IPC_MOCKS = {
	"@tauri-apps/api/core": { invoke: async () => undefined },
};

async function loadPtyIpc() {
	const load = await modules(PTY_IPC_MOCKS);
	return load("pty/ptyIpc.ts");
}

/**
 * Exercise the production PTY startup loop with only I/O boundaries faked.
 * Ownership is the real stable session→terminal map, so a pane slot can be
 * reused without the old terminal regaining ownership.
 */
function ptyStartupHarness(ptyIpc, overrides = {}) {
	const pt = { sessionId: "sid-1", paneId: "1a" };
	const paneBySessionId = new Map([[pt.sessionId, pt]]);
	const calls = {
		fit: 0,
		ensure: 0,
		replay: 0,
		kill: [],
		ensured: [],
		failure: [],
		sleeps: [],
	};
	const ensureGate = overrides.ensureGate ?? deferred();
	const opts = {
		sessionId: pt.sessionId,
		isOwned: () => ptyIpc.isPtyOwner(paneBySessionId, pt),
		fit: () => {
			calls.fit++;
		},
		readDims: () => ({ cols: 100, rows: 30 }),
		waitFrame: async () => {},
		sleep: async (ms) => {
			calls.sleeps.push(ms);
		},
		ensure: async (dims) => {
			calls.ensure++;
			calls.dims = dims;
			await ensureGate.promise;
		},
		replay: async () => {
			calls.replay++;
		},
		fallbackDims: { cols: 80, rows: 24 },
		clampDims: (dims) => dims,
		onEnsured: (dims) => {
			calls.ensured.push(dims);
		},
		onFailure: (error) => {
			calls.failure.push(error);
		},
		onAttemptFailure: noop,
		kill: async (sessionId) => {
			calls.kill.push(sessionId);
		},
	};
	return { pt, paneBySessionId, calls, ensureGate, opts };
}

test("PTY startup closed before ensure never spawns, fits again or reports failure", async () => {
	const ptyIpc = await loadPtyIpc();
	const { pt, paneBySessionId, calls, opts } = ptyStartupHarness(ptyIpc);
	opts.readDims = () => null;
	opts.waitFrame = async () => {
		// Disposal lands while the startup loop is waiting for layout.
		paneBySessionId.delete(pt.sessionId);
	};
	const outcome = await ptyIpc.runPtyStartup(opts);
	assert.equal(outcome, "aborted");
	assert.equal(calls.ensure, 0, "no pty_ensure after ownership loss");
	assert.equal(calls.fit, 1, "no re-fit after ownership loss");
	assert.equal(calls.replay, 0);
	assert.equal(calls.kill.length, 0);
	assert.deepEqual(calls.ensured, []);
	assert.deepEqual(calls.failure, []);

	// Closed even before the startup loop begins: no work at all.
	const second = ptyStartupHarness(ptyIpc);
	second.paneBySessionId.delete(second.pt.sessionId);
	assert.equal(await ptyIpc.runPtyStartup(second.opts), "aborted");
	assert.equal(second.calls.fit, 0);
	assert.equal(second.calls.ensure, 0);
});

test("late successful ensure after disposal is killed without retry, replay or state", async () => {
	const ptyIpc = await loadPtyIpc();
	const { pt, paneBySessionId, calls, ensureGate, opts } =
		ptyStartupHarness(ptyIpc);
	const run = ptyIpc.runPtyStartup(opts);
	assert.equal(calls.ensure, 1, "ensure is in flight");
	paneBySessionId.delete(pt.sessionId);
	// A replacement terminal reuses the same positional pane id.
	const replacement = { sessionId: "sid-2", paneId: pt.paneId };
	paneBySessionId.set(replacement.sessionId, replacement);
	ensureGate.resolve();
	assert.equal(await run, "aborted");
	assert.deepEqual(calls.kill, [pt.sessionId], "late process is killed");
	assert.equal(calls.ensure, 1, "no retry after disposal");
	assert.equal(calls.replay, 0, "no replay after disposal");
	assert.deepEqual(calls.ensured, [], "no success bookkeeping after disposal");
	assert.deepEqual(calls.failure, []);
	assert.equal(ptyIpc.isPtyOwner(paneBySessionId, pt), false);
	assert.equal(
		ptyIpc.isPtyOwner(paneBySessionId, replacement),
		true,
		"reused pane slot belongs to the replacement terminal",
	);
});

test("ensure rejection after disposal is not retried or written to the pane", async () => {
	const ptyIpc = await loadPtyIpc();
	const { pt, paneBySessionId, calls, ensureGate, opts } =
		ptyStartupHarness(ptyIpc);
	const run = ptyIpc.runPtyStartup(opts);
	paneBySessionId.delete(pt.sessionId);
	ensureGate.reject(new Error("spawn failed"));
	assert.equal(await run, "aborted");
	assert.equal(calls.ensure, 1, "a lost pane must not retry pty_ensure");
	assert.deepEqual(calls.sleeps, []);
	assert.deepEqual(calls.failure, [], "no terminal error write after disposal");
	assert.deepEqual(calls.kill, []);
});

test("re-key or transfer keeps the same owner and is not cancelled", async () => {
	const ptyIpc = await loadPtyIpc();
	const { pt, paneBySessionId, calls, ensureGate, opts } =
		ptyStartupHarness(ptyIpc);
	const run = ptyIpc.runPtyStartup(opts);
	// Re-key/transfer preserves the PaneTerminal identity and session; only the
	// mutable positional pane id changes.
	pt.paneId = "2a";
	ensureGate.resolve();
	assert.equal(await run, "ensured");
	assert.deepEqual(calls.kill, [], "a live re-keyed owner is not killed");
	assert.equal(calls.replay, 1);
	assert.deepEqual(calls.ensured, [{ cols: 100, rows: 30 }]);
	assert.equal(ptyIpc.isPtyOwner(paneBySessionId, pt), true);
});

test("parallel ensure calls for the same live owner do not cancel each other", async () => {
	const ptyIpc = await loadPtyIpc();
	const { calls, opts } = ptyStartupHarness(ptyIpc);
	const firstGate = deferred();
	const secondGate = deferred();
	const first = ptyIpc.runPtyStartup({
		...opts,
		ensure: async () => {
			calls.ensure++;
			await firstGate.promise;
		},
	});
	const second = ptyIpc.runPtyStartup({
		...opts,
		ensure: async () => {
			calls.ensure++;
			await secondGate.promise;
		},
	});
	assert.equal(calls.ensure, 2);
	firstGate.resolve();
	secondGate.resolve();
	assert.deepEqual(await Promise.all([first, second]), ["ensured", "ensured"]);
	assert.deepEqual(calls.kill, []);
	assert.equal(calls.ensured.length, 2);
});

test("still-owned retryable ensure failure retries and succeeds", async () => {
	const ptyIpc = await loadPtyIpc();
	const { calls, opts } = ptyStartupHarness(ptyIpc);
	let attempts = 0;
	const outcome = await ptyIpc.runPtyStartup({
		...opts,
		ensure: async () => {
			calls.ensure++;
			if (++attempts === 1) throw new Error("ConPTY busy");
		},
	});
	assert.equal(outcome, "ensured");
	assert.equal(calls.ensure, 2);
	assert.deepEqual(calls.sleeps, [55]);
	assert.equal(calls.replay, 1);
	assert.equal(calls.ensured.length, 1);
	assert.deepEqual(calls.failure, []);
});

test("closure during a retry sleep stops further work and state", async () => {
	const ptyIpc = await loadPtyIpc();
	const { pt, paneBySessionId, calls, opts } = ptyStartupHarness(ptyIpc);
	const sleepGate = deferred();
	const run = ptyIpc.runPtyStartup({
		...opts,
		ensure: async () => {
			calls.ensure++;
			throw new Error("ConPTY busy");
		},
		sleep: async (ms) => {
			calls.sleeps.push(ms);
			await sleepGate.promise;
		},
	});
	await new Promise(setImmediate);
	assert.equal(calls.ensure, 1);
	assert.deepEqual(calls.sleeps, [55]);
	paneBySessionId.delete(pt.sessionId);
	sleepGate.resolve();
	assert.equal(await run, "aborted");
	assert.equal(calls.ensure, 1, "no retry after disposal");
	assert.equal(calls.fit, 1, "no re-fit after disposal");
	assert.equal(calls.replay, 0);
	assert.deepEqual(calls.ensured, []);
	assert.deepEqual(calls.failure, []);
	assert.deepEqual(calls.kill, [], "no successful ensure to kill");
});

test("closure during replay stops success state and swallows a failed late kill", async () => {
	const ptyIpc = await loadPtyIpc();
	const { pt, paneBySessionId, calls, ensureGate, opts } =
		ptyStartupHarness(ptyIpc);
	const replayGate = deferred();
	const run = ptyIpc.runPtyStartup({
		...opts,
		replay: async () => {
			calls.replay++;
			await replayGate.promise;
		},
		kill: async (sessionId) => {
			calls.kill.push(sessionId);
			throw new Error("kill failed");
		},
	});
	ensureGate.resolve();
	await new Promise(setImmediate);
	assert.equal(calls.replay, 1);
	paneBySessionId.delete(pt.sessionId);
	replayGate.resolve();
	assert.equal(await run, "aborted");
	assert.deepEqual(calls.kill, [pt.sessionId], "late success is still killed");
	assert.deepEqual(calls.ensured, [], "no success bookkeeping after disposal");
	assert.deepEqual(calls.failure, []);
	assert.equal(calls.ensure, 1);
});
