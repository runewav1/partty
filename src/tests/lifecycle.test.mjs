import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const root = fileURLToPath(new URL("../../src/", import.meta.url));
const noop = () => {};
class Element {
	dataset = {};
	style = {};
	classList = { add: noop, remove: noop };
	appendChild = noop;
	addEventListener = noop;
	setAttribute = noop;
}
class Terminal {
	options = {};
	unicode = {};
	loadAddon = noop;
	open = noop;
	refresh = noop;
}

async function modules(extraMocks = {}) {
	const storage = new Map();
	const context = createContext({
		console,
		performance,
		localStorage: {
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: (key) => storage.delete(key),
		},
		document: { createElement: () => new Element() },
		ResizeObserver: class {
			observe = noop;
		},
		requestIdleCallback: noop,
	});
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
	const cache = new Map();
	async function load(specifier, parent = resolve(root, "entry.ts")) {
		const key = specifier.startsWith(".")
			? resolve(
					dirname(parent),
					specifier.endsWith(".ts") ? specifier : `${specifier}.ts`,
				)
			: specifier;
		if (cache.has(key)) return cache.get(key);
		let mod;
		if (mocks[key]) {
			mod = new SyntheticModule(
				Object.keys(mocks[key]),
				function () {
					for (const [name, value] of Object.entries(mocks[key]))
						this.setExport(name, value);
				},
				{ context, identifier: key },
			);
		} else {
			mod = new SourceTextModule(
				stripTypeScriptTypes(await readFile(key, "utf8"), {
					mode: "transform",
				}),
				{
					context,
					identifier: key,
					importModuleDynamically: async (name, ref) => {
						const child = await load(name, ref.identifier);
						if (child.status === "unlinked") await child.link(link);
						if (child.status === "linked") await child.evaluate();
						return child;
					},
				},
			);
		}
		cache.set(key, mod);
		return mod;
	}
	const link = (name, ref) => load(name, ref.identifier);
	const api = async (path) => {
		const mod = await load(resolve(root, path));
		if (mod.status === "unlinked") await mod.link(link);
		if (mod.status === "linked") await mod.evaluate();
		return mod.namespace;
	};
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
