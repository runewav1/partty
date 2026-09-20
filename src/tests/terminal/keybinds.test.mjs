import assert from "node:assert/strict";
import { test } from "node:test";
import {
	consumeSinglePress,
	DEFAULT_BINDS,
	parseBinding,
} from "../../terminal/keybindCore.ts";
import { createVmLoader } from "../support/vm.mjs";

async function bindings(snapshot = DEFAULT_BINDS) {
	const loader = createVmLoader({
		root: new URL("../../", import.meta.url),
		stubs: {
			"@tauri-apps/api/core": {
				invoke: async (command) => {
					if (command !== "get_keybinds") return;
					if (snapshot instanceof Error) throw snapshot;
					return { bind: snapshot };
				},
			},
		},
	});
	const { createKeybinds } = await loader.api("terminal/keybinds.ts");
	const api = createKeybinds();
	await api.ready;
	return api;
}

function event(binding, repeat = false) {
	const p = parseBinding(binding);
	const calls = { prevent: 0, stop: 0, repeatReads: 0 };
	return {
		type: "keydown",
		key: p.key,
		code: p.key.length === 1 ? `Key${p.key.toUpperCase()}` : p.key,
		ctrlKey: p.ctrl,
		altKey: p.alt,
		shiftKey: p.shift,
		metaKey: p.meta,
		get repeat() {
			calls.repeatReads++;
			return repeat;
		},
		preventDefault: () => calls.prevent++,
		stopPropagation: () => calls.stop++,
		calls,
	};
}

// Same dispatch contract as the window handlers: existing match/context first,
// consumeSinglePress only once the shortcut is eligible to own the event.
function dispatch(api, e, action, run, eligible = true) {
	if (!api.match(e, action) || !eligible) return;
	if (consumeSinglePress(e)) run();
}

test("default UI shortcuts run on each press, never on held repeats", async () => {
	const api = await bindings();
	for (const action of [
		"palette_open",
		"help_toggle",
		"settings_open",
		"terminal_find",
		"window_toggle",
		"window_move_next_monitor",
		"window_move_prev_monitor",
		"window_maximize",
		"window_restore",
		"pane_float_toggle",
		"pane_float_new",
		"pane_float_follow",
		"profile_split_right",
		"profile_split_down",
		"profile_float_new",
		"dev_toggle",
	]) {
		let runs = 0;
		for (const repeat of [false, true, true, true, false]) {
			const e = event(api.label(action), repeat);
			dispatch(api, e, action, () => runs++);
			assert.deepEqual(e.calls, { prevent: 1, stop: 1, repeatReads: 1 });
		}
		assert.equal(runs, 2, action);
	}
});

test("configured shortcuts replace defaults and remain single-press", async () => {
	const api = await bindings({ ...DEFAULT_BINDS, palette_open: "Alt+K" });
	let runs = 0;
	const old = event(DEFAULT_BINDS.palette_open, true);
	dispatch(api, old, "palette_open", () => runs++);
	assert.deepEqual(old.calls, { prevent: 0, stop: 0, repeatReads: 0 });
	for (const repeat of [false, true, false]) {
		dispatch(api, event("Alt+K", repeat), "palette_open", () => runs++);
	}
	assert.equal(runs, 2);
	await api.set("palette_open", "Meta+J");
	assert.equal(api.match(event("Alt+K"), "palette_open"), null);
	assert.equal(api.match(event("Meta+J"), "palette_open"), "palette_open");
	await api.reset();
	assert.equal(
		api.match(event(DEFAULT_BINDS.palette_open), "palette_open"),
		"palette_open",
	);
});

test("ordinary keys and every nonmatching modifier combination are untouched", async () => {
	const api = await bindings();
	for (let mask = 0; mask < 16; mask++) {
		for (const key of ["a", "p", "ArrowLeft", "Backspace", "Enter", "Tab"]) {
			const e = event(key, true);
			e.ctrlKey = Boolean(mask & 1);
			e.altKey = Boolean(mask & 2);
			e.shiftKey = Boolean(mask & 4);
			e.metaKey = Boolean(mask & 8);
			if (key === "p" && mask === 5) continue; // the actual palette binding
			dispatch(api, e, "palette_open", () =>
				assert.fail("unexpected dispatch"),
			);
			assert.deepEqual(e.calls, { prevent: 0, stop: 0, repeatReads: 0 });
		}
	}
});

test("context-excluded shortcuts do not consume or inspect repeats", async () => {
	const api = await bindings();
	const e = event(DEFAULT_BINDS.settings_open, true);
	dispatch(
		api,
		e,
		"settings_open",
		() => assert.fail("excluded context"),
		false,
	);
	assert.deepEqual(e.calls, { prevent: 0, stop: 0, repeatReads: 0 });
});

test("matching itself never suppresses repeats, including terminal input bindings", async () => {
	const api = await bindings();
	for (const action of [
		"terminal_copy",
		"terminal_paste",
		"terminal_newline",
		"pane_split_right",
		"pane_close",
	]) {
		const e = event(api.label(action), true);
		assert.equal(api.match(e, action), action);
		assert.deepEqual(e.calls, { prevent: 0, stop: 0, repeatReads: 0 });
	}
	assert.equal(
		api.matchWheel({ ctrlKey: true, deltaY: -1 }, "terminal_zoom_in"),
		"terminal_zoom_in",
	);
});

test("native snapshot unbinds are authoritative; IPC failure retains defaults", async () => {
	const configured = Object.fromEntries(
		Object.entries(DEFAULT_BINDS).filter(
			([action]) => action !== "palette_open",
		),
	);
	const api = await bindings(configured);
	assert.equal(
		api.match(event(DEFAULT_BINDS.palette_open, true), "palette_open"),
		null,
	);
	await api.set("pane_split_right", "");
	assert.equal(
		api.match(event(DEFAULT_BINDS.pane_split_right, true), "pane_split_right"),
		null,
	);
	const fallback = await bindings(new Error("IPC unavailable"));
	assert.equal(
		fallback.match(event(DEFAULT_BINDS.palette_open), "palette_open"),
		"palette_open",
	);
});

test("parameter bindings respect configured digits and exact modifiers", async () => {
	const api = await bindings({ ...DEFAULT_BINDS, tab_switch: "Ctrl+Alt+2" });
	const two = { ...event("Ctrl+Alt+2", true), code: "Digit2" };
	const three = { ...event("Ctrl+Alt+3", true), code: "Digit3" };
	assert.deepEqual(
		{ ...api.matchParam(two, "tab_switch") },
		{ action: "tab_switch", param: 2 },
	);
	assert.equal(api.matchParam(three, "tab_switch"), null);
	assert.equal(api.matchParam({ ...two, shiftKey: true }, "tab_switch"), null);
	await api.set("tab_switch", "Alt+{n}");
	const digit = { ...event("Alt+2", true), code: "Digit2" };
	const matched = api.matchParam(digit, "tab_switch");
	assert.equal(matched.param, 2);
	assert.equal(consumeSinglePress(digit), false);
	assert.equal(
		api.matchParam({ ...digit, code: "Numpad0", key: "0" }, "tab_switch").param,
		0,
	);
});
