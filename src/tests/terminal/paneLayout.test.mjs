/**
 * Deterministic tests for pane-layout persistence validation
 * (src/terminal/paneLayout.ts).
 *
 * Only the module's real dependencies are stubbed (`paneHost.findPaneLeaf`,
 * `storageKeys.PANE_LAYOUT_KEY`); the validation itself runs unmodified against
 * a Map-backed localStorage. This pins the rejection boundary — malformed JSON,
 * wrong version, illegal split ratios/directions and empty leaf ids — that
 * keeps a corrupt or stale layout from being restored.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { createVmLoader } from "../support/vm.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const PANE_LAYOUT_KEY = "partty.pane_layout.v1";

function findPaneLeaf(tree, id) {
	if (tree.kind === "leaf") return tree.id === id ? tree : null;
	return findPaneLeaf(tree.a, id) ?? findPaneLeaf(tree.b, id);
}

async function createEnv() {
	const storage = new Map();
	const loader = createVmLoader({
		root: ROOT,
		globals: {
			localStorage: {
				getItem: (key) => (storage.has(key) ? storage.get(key) : null),
				setItem: (key, value) => storage.set(key, String(value)),
				removeItem: (key) => storage.delete(key),
			},
		},
		stubs: {
			[resolve(ROOT, "terminal/paneHost.ts")]: { findPaneLeaf },
			[resolve(ROOT, "util/storageKeys.ts")]: { PANE_LAYOUT_KEY },
		},
	});
	return { paneLayout: await loader.api("terminal/paneLayout.ts"), storage };
}

const TREE = {
	kind: "split",
	dir: "h",
	ratio: 0.5,
	a: { kind: "leaf", id: "1a" },
	b: { kind: "leaf", id: "1b" },
};

function store(storage, value) {
	storage.set(PANE_LAYOUT_KEY, JSON.stringify(value));
}

test("loads a valid v1 layout and keeps the optional per-pane maps", async () => {
	const { paneLayout, storage } = await createEnv();
	store(storage, {
		v: 1,
		tree: TREE,
		focusedId: "1b",
		paneThemes: { "1a": { theme: "nord" } },
		paneCwds: { "1a": "C:\\work" },
		paneProfileIds: { "1a": "local-default" },
		paneSessionIds: { "1a": "sid-a" },
	});

	const loaded = paneLayout.loadPaneLayout();
	assert.equal(loaded.v, 1);
	assert.equal(loaded.focusedId, "1b");
	// Objects built inside the VM realm have a different Object.prototype, so
	// strict deep-equality on the whole record fails; compare the fields.
	assert.equal(loaded.paneSessionIds["1a"], "sid-a");
	assert.equal(loaded.paneCwds["1a"], "C:\\work");
});

test("rejects absent, malformed, wrong-version and structurally invalid layouts", async () => {
	const { paneLayout, storage } = await createEnv();
	assert.equal(paneLayout.loadPaneLayout(), null, "no stored layout");

	storage.set(PANE_LAYOUT_KEY, "{not json");
	assert.equal(paneLayout.loadPaneLayout(), null, "unparseable json");

	store(storage, { v: 2, tree: TREE, focusedId: "1a" });
	assert.equal(paneLayout.loadPaneLayout(), null, "unsupported version");

	store(storage, {
		v: 1,
		tree: {
			kind: "split",
			dir: "h",
			ratio: 0.5,
			a: { kind: "leaf", id: "" },
			b: { kind: "leaf", id: "1b" },
		},
		focusedId: "1a",
	});
	assert.equal(paneLayout.loadPaneLayout(), null, "empty leaf id");

	store(storage, {
		v: 1,
		tree: { ...TREE, dir: "x" },
		focusedId: "1a",
	});
	assert.equal(paneLayout.loadPaneLayout(), null, "illegal split direction");

	store(storage, {
		v: 1,
		tree: { ...TREE, ratio: 0.99 },
		focusedId: "1a",
	});
	assert.equal(paneLayout.loadPaneLayout(), null, "ratio out of range");
});

test("clear removes the stored layout", async () => {
	const { paneLayout, storage } = await createEnv();
	storage.set(PANE_LAYOUT_KEY, "anything");
	paneLayout.clearPaneLayout();
	assert.equal(storage.has(PANE_LAYOUT_KEY), false);
});

test("layout validity requires the root leaf to be present", async () => {
	const { paneLayout } = await createEnv();
	const layout = { v: 1, tree: TREE, focusedId: "1a" };
	assert.equal(paneLayout.isLayoutValidForRoot(layout, "1a"), true);
	assert.equal(paneLayout.isLayoutValidForRoot(layout, "missing"), false);
});
