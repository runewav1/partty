import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
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

async function modules(extraMocks = {}) {
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
			document: { createElement: () => new Element() },
			getComputedStyle: (el) => ({
				scale:
					el && typeof el.focusScale === "number"
						? String(el.focusScale)
						: "none",
			}),
			ResizeObserver: class {
				observe = noop;
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
