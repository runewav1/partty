import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { FakeElement } from "../support/dom.mjs";
import { createVmLoader } from "../support/vm.mjs";

test("theme choices require installed files, refresh on open, and never cascade preset preferences", async () => {
	const rootPath = resolve(import.meta.dirname, "../..");
	const installed = new Map();
	const previews = [];
	const saved = [];
	let stateReads = 0;
	let shown;
	let closed;
	const prefs = {
		ui_theme: "partty",
		ui_theme_variant: "default",
		font_terminal: "",
		font_ui: "",
		font_size: 17,
		pane_gap: 9,
	};
	const loader = createVmLoader({
		root: rootPath,
		globals: {
			console,
			HTMLElement: FakeElement,
			document: {
				createElement: (tag) => {
					const el = new FakeElement(tag);
					if (tag === "input") el.value = "";
					return el;
				},
				documentElement: new FakeElement(),
				activeElement: null,
			},
			window: { addEventListener() {}, removeEventListener() {} },
		},
		stubs: {
			"@tauri-apps/api/core": {
				invoke: async (command, args) => {
					if (command === "list_themes") return [...installed.keys()];
					if (command === "read_theme") return installed.get(args.name);
					if (command === "get_persisted_state") {
						stateReads++;
						return { prefs };
					}
					if (command === "set_prefs") {
						saved.push(args.prefs);
						Object.assign(prefs, args.prefs);
					}
				},
			},
			[resolve(rootPath, "util/motion.ts")]: {
				showSurface: () => shown(),
				hideSurface() {},
			},
			[resolve(rootPath, "app/mouseCursor.ts")]: {
				mouseCursorForceVisible() {},
			},
			[resolve(rootPath, "app/overlayStack.ts")]: {
				pushOverlay: () => ({ release() {} }),
			},
		},
	});
	const { createThemeModal } = await loader.api("app/themeModal.ts");
	const root = new FakeElement();
	const modal = createThemeModal(
		root,
		(preview) => previews.push(preview),
		() => closed?.(),
	);
	const open = async (options = {}) => {
		const ready = new Promise((resolve) => {
			shown = resolve;
		});
		modal.open({ initialPrefs: { ...prefs }, ...options });
		await ready;
	};
	await open();
	assert.equal(root.querySelectorAll(".theme-modal-item").length, 0);
	assert.equal(root.querySelectorAll(".theme-modal-empty")[0].hidden, false);
	assert.equal(previews.length, 0, "empty picker cannot preview a theme");
	modal.close();
	installed.set("example", {
		colors: { "--term-bg": "#161616", "--term-fg": "#f2f4f8" },
		prefs: null,
	});
	await open();
	const rows = root.querySelectorAll(".theme-modal-item");
	assert.equal(
		rows.length,
		2,
		"only Partty and the installed theme are offered",
	);
	assert.equal(root.querySelectorAll(".theme-modal-empty")[0].hidden, true);
	const committed = new Promise((resolve) => {
		closed = resolve;
	});
	rows.find((row) => row.textContent.includes("example")).dispatch("click", {});
	await committed;
	assert.equal(saved[0].ui_theme, "custom:example");
	assert.equal(saved[0].font_size, 17);
	assert.equal(saved[0].pane_gap, 9);
	installed.set("example", {
		name: "Example",
		family: "favorites",
		colors: {},
		prefs: null,
		variants: ["warm", "cool"].map((id) => ({
			id,
			name: id,
			colors: { "--term-bg": "#161616" },
			prefs: null,
		})),
	});
	installed.set("extra", {
		name: "Extra",
		family: "favorites",
		colors: {},
		prefs: null,
	});
	installed.set("other", {
		name: "Other",
		family: "other",
		colors: {},
		prefs: null,
	});
	await open();
	assert.deepEqual(
		root
			.querySelectorAll(".theme-modal-item-label")
			.map((row) => row.textContent),
		["Partty", "Example — warm", "Example — cool", "Extra", "Other"],
	);
	modal.close();
	const beforeCycle = stateReads;
	await modal.cycleFamily();
	assert.equal(stateReads, beforeCycle + 1, "one state snapshot per cycle");
	assert.equal(prefs.ui_theme_variant, "cool");
	await Promise.all([modal.cycleFamily(), modal.cycleFamily()]);
	assert.equal(prefs.ui_theme, "custom:example");
	assert.equal(
		prefs.ui_theme_variant,
		"warm",
		"cycles across files and wraps, in order",
	);
	await open({ family: "favorites" });
	assert.equal(root.querySelectorAll(".theme-modal-item").length, 3);
	assert.equal(
		root
			.querySelectorAll(".theme-modal-item-label")
			.some((row) => row.textContent === "Other"),
		false,
	);
	modal.close();
	installed.clear();
	await open();
	assert.equal(root.querySelectorAll(".theme-modal-item").length, 0);
	modal.close();
});
