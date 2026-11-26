import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BINDS } from "../../terminal/keybindCore.ts";
import { createVmLoader } from "../support/vm.mjs";

async function bindings(snapshot) {
	const writes = [];
	const loader = createVmLoader({
		root: new URL("../../", import.meta.url),
		stubs: {
			"@tauri-apps/api/core": {
				invoke: async (command, args) => {
					if (command === "get_keybinds") {
						if (snapshot instanceof Error) throw snapshot;
						return { bind: snapshot };
					}
					writes.push([command, args && { ...args }]);
				},
			},
		},
	});
	const { createKeybinds } = await loader.api("terminal/keybinds.ts");
	const api = createKeybinds();
	await api.ready;
	return { api, writes };
}

function key(value, overrides = {}) {
	return {
		key: value,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		get repeat() {
			throw new Error("matching must leave repeat policy to the caller");
		},
		preventDefault: () => assert.fail("matching must not consume input"),
		stopPropagation: () => assert.fail("matching must not consume input"),
		...overrides,
	};
}

const defaultPaletteKey = key("P", { ctrlKey: true, shiftKey: true });

test("loading, remapping, clearing, and resetting a shortcut keep labels and input in sync", async () => {
	const action = "palette_open";
	const altK = key("k", { altKey: true });
	const metaJ = key("j", { metaKey: true });
	const { api, writes } = await bindings({
		...DEFAULT_BINDS,
		[action]: "Alt+K",
	});
	assert.equal(api.label(action), "Alt+K");
	assert.equal(api.match(altK, action), action);
	assert.equal(api.match(defaultPaletteKey, action), null);

	await api.set(action, "Meta+J");
	assert.equal(api.label(action), "Meta+J");
	assert.equal(api.match(altK, action), null);
	assert.equal(api.match(metaJ, action), action);

	await api.set(action, "");
	assert.equal(api.label(action), "");
	assert.equal(api.match(metaJ, action), null);

	await api.reset();
	assert.equal(api.label(action), DEFAULT_BINDS[action]);
	assert.equal(api.match(defaultPaletteKey, action), action);
	assert.deepEqual(writes, [
		["set_keybind", { action, binding: "Meta+J" }],
		["set_keybind", { action, binding: "" }],
		["reset_keybinds", undefined],
	]);
});

test("native unbinds leave actions missing rather than restoring their defaults", async () => {
	const { api } = await bindings({ settings_open: "Ctrl+," });
	assert.equal(api.all().palette_open, undefined);
	assert.equal(api.match(defaultPaletteKey, "palette_open"), null);
	assert.equal(
		api.match(key(",", { ctrlKey: true }), "settings_open"),
		"settings_open",
	);
});

test("missing, malformed, or unavailable native snapshots keep the default bindings", {
	timeout: 2000,
}, async () => {
	const snapshots = [
		new Error("IPC unavailable"),
		null,
		{ palette_open: "Alt+K", pane_split_right: 42 },
	];
	const results = await Promise.all(snapshots.map(bindings));
	for (const { api } of results) {
		assert.deepEqual({ ...api.all() }, DEFAULT_BINDS);
		assert.equal(api.label("palette_open"), DEFAULT_BINDS.palette_open);
		assert.equal(api.match(defaultPaletteKey, "palette_open"), "palette_open");
		assert.equal(api.match(key("k", { altKey: true }), "palette_open"), null);
	}
});

test("default matching stays exact and leaves keyboard and wheel event handling to callers", async () => {
	const { api } = await bindings(DEFAULT_BINDS);
	const action = "palette_open";
	assert.equal(api.match(defaultPaletteKey, action), action);
	for (let mask = 0; mask < 16; mask++) {
		const modifiers = {
			ctrlKey: Boolean(mask & 1),
			altKey: Boolean(mask & 2),
			shiftKey: Boolean(mask & 4),
			metaKey: Boolean(mask & 8),
		};
		assert.equal(
			api.match(key("p", modifiers), action),
			mask === 5 ? action : null,
		);
		assert.equal(api.match(key("ArrowLeft", modifiers), action), null);
	}
	assert.equal(
		api.match(key("?", { ctrlKey: true, shiftKey: true }), "help_toggle"),
		"help_toggle",
	);
	assert.equal(
		api.match(key("n", { ctrlKey: true }), "notification_focus"),
		"notification_focus",
	);
	assert.equal(
		api.matchWheel({ ctrlKey: true, deltaY: -1 }, "terminal_zoom_in"),
		"terminal_zoom_in",
	);
});

test("tab shortcuts distinguish a fixed digit from a configurable digit range", async () => {
	const action = "tab_switch";
	const { api } = await bindings({ [action]: "Ctrl+Alt+2" });
	const two = key("2", { ctrlKey: true, altKey: true, code: "Digit2" });
	assert.deepEqual({ ...api.matchParam(two, action) }, { action, param: 2 });
	assert.equal(
		api.matchParam(
			key("3", { ctrlKey: true, altKey: true, code: "Digit3" }),
			action,
		),
		null,
	);
	assert.equal(
		api.matchParam(
			key("2", { ctrlKey: true, altKey: true, shiftKey: true, code: "Digit2" }),
			action,
		),
		null,
	);

	await api.set(action, "Alt+{n}");
	assert.equal(
		api.matchParam(key("2", { altKey: true, code: "Digit2" }), action).param,
		2,
	);
	assert.equal(
		api.matchParam(key("0", { altKey: true, code: "Numpad0" }), action).param,
		0,
	);
});
