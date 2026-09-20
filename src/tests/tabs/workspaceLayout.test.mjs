/**
 * Deterministic tests for workspace-layout seeding and remapping
 * (src/tabs/workspaceLayout.ts).
 *
 * The real pure peers run (`connectionProfiles`, `uiTheme`, `paneIds`); only
 * the heavy `paneHost` module and the Tauri IPC boundary are stubbed. That way
 * the tests exercise the actual theme normalization, profile lookup and id
 * remapping contracts instead of hiding them behind stubs.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { createVmLoader } from "../support/vm.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const LOCAL_DEFAULT_PROFILE_ID = "local-default";

function collectLeafIds(tree, out) {
	if (tree.kind === "leaf") {
		out.push(tree.id);
		return;
	}
	collectLeafIds(tree.a, out);
	collectLeafIds(tree.b, out);
}

function makeLoader() {
	return createVmLoader({
		root: ROOT,
		stubs: {
			// External boundary: uiTheme/connectionProfiles import `invoke` but the
			// code under test never calls it.
			"@tauri-apps/api/core": { invoke: async () => {} },
			// Heavy module (xterm/perf/DOM); only the leaf walker is needed.
			[resolve(ROOT, "terminal/paneHost.ts")]: { collectLeafIds },
		},
	});
}

const THREE_LEAF_TREE = {
	kind: "split",
	dir: "h",
	ratio: 0.5,
	a: {
		kind: "split",
		dir: "v",
		ratio: 0.5,
		a: { kind: "leaf", id: "1a" },
		b: { kind: "leaf", id: "1b" },
	},
	b: { kind: "leaf", id: "1c" },
};

function layout(overrides = {}) {
	return { v: 1, tree: THREE_LEAF_TREE, focusedId: "1a", ...overrides };
}

function emptyMaps() {
	return {
		paneThemes: new Map(),
		paneProfileIds: new Map(),
		paneCwdHints: new Map(),
	};
}

test("seeds normalized pane themes and raw profile ids, skipping cwds when disabled", async () => {
	const { seedPaneMapsFromLayout } = await makeLoader().api(
		"tabs/workspaceLayout.ts",
	);
	const maps = emptyMaps();
	seedPaneMapsFromLayout(
		layout({
			paneThemes: { "1a": { ui_theme: "github-dark" } },
			paneProfileIds: { "1b": "ssh-prod" },
			paneCwds: { "1a": "C:\\explicit" },
		}),
		maps,
		{ seedCwds: false },
	);

	// Real normalizePaneThemePrefs migrates the deprecated id.
	assert.deepEqual(
		{ ...maps.paneThemes.get("1a") },
		{ ui_theme: "github", ui_theme_variant: "dark" },
	);
	assert.equal(maps.paneProfileIds.get("1b"), "ssh-prod");
	assert.equal(maps.paneCwdHints.size, 0);
});

test("with fallback disabled, only explicit cwds are seeded", async () => {
	const { seedPaneMapsFromLayout } = await makeLoader().api(
		"tabs/workspaceLayout.ts",
	);
	const maps = emptyMaps();
	seedPaneMapsFromLayout(layout({ paneCwds: { "1a": "C:\\explicit" } }), maps, {
		seedCwds: true,
		resolveCwdFallbacks: false,
	});
	assert.deepEqual([...maps.paneCwdHints.entries()], [["1a", "C:\\explicit"]]);
});

test("cwd fallback precedence is explicit → profile → global", async () => {
	const { seedPaneMapsFromLayout } = await makeLoader().api(
		"tabs/workspaceLayout.ts",
	);
	const maps = emptyMaps();
	seedPaneMapsFromLayout(
		layout({
			paneCwds: { "1a": "C:\\explicit" },
			paneProfileIds: { "1b": "prof" },
		}),
		maps,
		{
			seedCwds: true,
			resolveCwdFallbacks: true,
			profiles: [
				{ id: LOCAL_DEFAULT_PROFILE_ID, kind: "local" },
				{ id: "prof", kind: "local", initialCwd: "C:\\fromProfile" },
			],
			defaultProfileId: LOCAL_DEFAULT_PROFILE_ID,
			globalInitialCwd: "C:\\global",
		},
	);

	assert.equal(maps.paneCwdHints.get("1a"), "C:\\explicit");
	assert.equal(maps.paneCwdHints.get("1b"), "C:\\fromProfile");
	assert.equal(maps.paneCwdHints.get("1c"), "C:\\global");
});

test("missing optional maps seed nothing and do not throw", async () => {
	const { seedPaneMapsFromLayout } = await makeLoader().api(
		"tabs/workspaceLayout.ts",
	);
	const maps = emptyMaps();
	seedPaneMapsFromLayout(layout(), maps, {
		seedCwds: true,
		resolveCwdFallbacks: true,
		profiles: [],
		defaultProfileId: LOCAL_DEFAULT_PROFILE_ID,
		globalInitialCwd: null,
	});
	assert.equal(maps.paneThemes.size, 0);
	assert.equal(maps.paneProfileIds.size, 0);
	assert.equal(maps.paneCwdHints.size, 0);
});

test("remaps file-local ids to tab ids and follows the per-pane maps (real paneIds)", async () => {
	const { remapWorkspaceLayoutForTab } = await makeLoader().api(
		"tabs/workspaceLayout.ts",
	);
	const source = {
		tree: {
			kind: "split",
			dir: "h",
			ratio: 0.5,
			a: { kind: "leaf", id: "root" },
			b: { kind: "leaf", id: "p2" },
		},
		focusedId: "p2",
		paneThemes: { root: { ui_theme: "nord" } },
		paneCwds: { root: "C:\\a" },
		paneProfileIds: { p2: "ssh-prod" },
	};

	const { layout: mapped, idMap } = remapWorkspaceLayoutForTab(source, "3");
	assert.equal(idMap.get("root"), "3a");
	assert.equal(idMap.get("p2"), "3b");
	assert.equal(mapped.focusedId, "3b");
	assert.equal(mapped.tree.a.id, "3a");
	assert.equal(mapped.paneThemes["3a"].ui_theme, "nord");
	assert.equal(mapped.paneCwds["3a"], "C:\\a");
	assert.equal(mapped.paneProfileIds["3b"], "ssh-prod");
	assert.equal(mapped.paneThemes["3b"], undefined);
});

test("queueWorkspaceStartupCommands remaps, trims and drops unknown/empty commands", async () => {
	const { queueWorkspaceStartupCommands } = await makeLoader().api(
		"tabs/workspaceLayout.ts",
	);
	const idMap = new Map([["1a", "tab-1a"]]);
	const pending = new Map();
	queueWorkspaceStartupCommands(
		{ "1a": "  git status  ", "1b": "ls", "1c": "   " },
		idMap,
		pending,
	);
	assert.deepEqual([...pending.entries()], [["tab-1a", "git status"]]);

	queueWorkspaceStartupCommands(undefined, idMap, pending);
	assert.equal(pending.size, 1, "no startup map is a no-op");
});
