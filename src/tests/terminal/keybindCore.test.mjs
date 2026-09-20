/**
 * Deterministic unit tests for the split wheel-zoom keybinding core
 * (keybindCore.ts). No browser, no Tauri: the module is pure, so
 * node --experimental-strip-types can import it directly.
 *
 * Asserts exact-modifier matching (so a `Ctrl+WheelUp` hovered binding never
 * fires for `Ctrl+Shift+WheelUp` and vice-versa), wheel-direction handling
 * (up/down plus the generic `Wheel` token), custom alternate bindings, and the
 * action → direction / scope helpers. Combos are built from token parts so the
 * tests exercise parsing rather than echoing config literals.
 *
 * Run: node --experimental-strip-types --test src/tests/terminal/keybindCore.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const {
	DEFAULT_BINDS,
	WHEEL_ZOOM_ACTIONS,
	bindingMatchesWheel,
	firstMatchingWheelAction,
	keyMatches,
	parseBinding,
	wheelDirectionForDelta,
	zoomAppliesToAllVisible,
	zoomDirectionForAction,
} = await import("../../terminal/keybindCore.ts");

const MOD = {
	ctrl: "Ctrl",
	alt: "Alt",
	shift: "Shift",
};
const WHEEL_KEY = {
	up: "WheelUp",
	down: "WheelDown",
	either: "Wheel",
};

/** Build a binding string from parts, e.g. combo(["Ctrl"], "WheelUp"). */
function combo(mods, key) {
	return [...mods, key].join("+");
}

function parsedMap(binds = DEFAULT_BINDS) {
	const parsed = {};
	for (const [action, raw] of Object.entries(binds)) {
		parsed[action] = parseBinding(raw);
	}
	return parsed;
}

/** First zoom action matched for a wheel chord, or null. */
function zoomMatch(chord, binds = DEFAULT_BINDS) {
	return firstMatchingWheelAction(parsedMap(binds), WHEEL_ZOOM_ACTIONS, chord);
}

function chord(overrides = {}) {
	return {
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		deltaY: 0,
		...overrides,
	};
}

test("defaults define both hovered and all-visible wheel zoom actions", () => {
	assert.equal(DEFAULT_BINDS.terminal_zoom_in, combo([MOD.ctrl], WHEEL_KEY.up));
	assert.equal(
		DEFAULT_BINDS.terminal_zoom_out,
		combo([MOD.ctrl], WHEEL_KEY.down),
	);
	assert.equal(
		DEFAULT_BINDS.terminal_zoom_all_in,
		combo([MOD.ctrl, MOD.shift], WHEEL_KEY.up),
	);
	assert.equal(
		DEFAULT_BINDS.terminal_zoom_all_out,
		combo([MOD.ctrl, MOD.shift], WHEEL_KEY.down),
	);
	assert.deepEqual(WHEEL_ZOOM_ACTIONS, [
		"terminal_zoom_in",
		"terminal_zoom_out",
		"terminal_zoom_all_in",
		"terminal_zoom_all_out",
	]);
});

test("wheel tokens parse as wheel kind with correct direction", () => {
	const up = parseBinding(DEFAULT_BINDS.terminal_zoom_in);
	assert.equal(up.kind, "wheel");
	assert.equal(up.ctrl, true);
	assert.equal(up.shift, false);
	const down = parseBinding(DEFAULT_BINDS.terminal_zoom_out);
	assert.equal(down.kind, "wheel");
	const both = parseBinding(combo([MOD.ctrl], WHEEL_KEY.either));
	assert.equal(both.kind, "wheel");
	// A plain keyboard binding stays a key binding.
	const key = parseBinding(combo([MOD.ctrl], "="));
	assert.equal(key.kind, "key");
	assert.equal(parseBinding(""), null);
	assert.equal(parseBinding("Ctrl+"), null);
});

test("exact modifiers: Ctrl+WheelUp fires hovered zoom only", () => {
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, deltaY: -100 })),
		"terminal_zoom_in",
	);
	// Shift held must NOT fire the hovered binding…
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, shiftKey: true, deltaY: -100 })),
		"terminal_zoom_all_in",
	);
	// …and plain Ctrl+wheel must NOT fire the all-visible binding.
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, deltaY: 100 })),
		"terminal_zoom_out",
	);
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, shiftKey: true, deltaY: 100 })),
		"terminal_zoom_all_out",
	);
});

test("exact modifiers: extra or missing modifiers match nothing", () => {
	// Missing Ctrl entirely (plain wheel) never zooms.
	assert.equal(zoomMatch(chord({ deltaY: -100 })), null);
	// Extra modifiers do not satisfy a Ctrl-only binding.
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, altKey: true, deltaY: -100 })),
		null,
	);
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, metaKey: true, deltaY: -100 })),
		null,
	);
	assert.equal(
		zoomMatch(
			chord({ ctrlKey: true, altKey: true, shiftKey: true, deltaY: -100 }),
		),
		null,
	);
});

test("wheel direction: up grows, down shrinks, deltaY 0 is inert", () => {
	assert.equal(wheelDirectionForDelta(-1), "wheelup");
	assert.equal(wheelDirectionForDelta(1), "wheeldown");
	assert.equal(wheelDirectionForDelta(0), null);
	// Horizontal-only wheel (deltaY 0) must not be consumed as zoom.
	assert.equal(zoomMatch(chord({ ctrlKey: true, deltaY: 0 })), null);
});

test("generic Wheel token matches either direction", () => {
	const binds = {
		terminal_zoom_in: combo([MOD.ctrl], WHEEL_KEY.either),
		terminal_zoom_out: combo([MOD.ctrl], WHEEL_KEY.either),
		terminal_zoom_all_in: combo([MOD.ctrl, MOD.shift], WHEEL_KEY.either),
		terminal_zoom_all_out: combo([MOD.ctrl, MOD.shift], WHEEL_KEY.either),
	};
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, deltaY: -10 }), binds),
		"terminal_zoom_in",
	);
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, deltaY: 10 }), binds),
		"terminal_zoom_in",
	);
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, shiftKey: true, deltaY: 10 }), binds),
		"terminal_zoom_all_in",
	);
});

test("custom alternate bindings drive matching (direction can be swapped)", () => {
	const binds = {
		terminal_zoom_in: combo([MOD.alt], WHEEL_KEY.down),
		terminal_zoom_out: combo([MOD.alt], WHEEL_KEY.up),
		terminal_zoom_all_in: combo([MOD.alt, MOD.shift], WHEEL_KEY.down),
		terminal_zoom_all_out: combo([MOD.alt, MOD.shift], WHEEL_KEY.up),
	};
	assert.equal(
		zoomMatch(chord({ altKey: true, deltaY: 100 }), binds),
		"terminal_zoom_in",
	);
	assert.equal(
		zoomMatch(chord({ altKey: true, deltaY: -100 }), binds),
		"terminal_zoom_out",
	);
	assert.equal(
		zoomMatch(chord({ altKey: true, shiftKey: true, deltaY: 100 }), binds),
		"terminal_zoom_all_in",
	);
	assert.equal(
		zoomMatch(chord({ altKey: true, shiftKey: true, deltaY: -100 }), binds),
		"terminal_zoom_all_out",
	);
	// Shift alone must not fall back to the Alt hovered binding.
	assert.equal(
		zoomMatch(chord({ altKey: true, shiftKey: true, deltaY: -100 }), binds),
		"terminal_zoom_all_out",
	);
	// And a different modifier set (Ctrl) matches nothing.
	assert.equal(zoomMatch(chord({ ctrlKey: true, deltaY: 100 }), binds), null);
});

test("missing/unbound actions match nothing (normal wheel is not consumed)", () => {
	const binds = {
		terminal_zoom_in: DEFAULT_BINDS.terminal_zoom_in,
		terminal_zoom_out: DEFAULT_BINDS.terminal_zoom_out,
	};
	// Ctrl+Shift+wheel has no all-visible binding: hovered binding must not fire.
	assert.equal(
		zoomMatch(chord({ ctrlKey: true, shiftKey: true, deltaY: -100 }), binds),
		null,
	);
	// No bindings at all: nothing matches, even with Ctrl.
	assert.equal(zoomMatch(chord({ ctrlKey: true, deltaY: -100 }), {}), null);
});

test("bindingMatchesWheel is case-insensitive and rejects non-wheel bindings", () => {
	const p = parseBinding(combo([MOD.ctrl], WHEEL_KEY.up).toLowerCase());
	assert.equal(bindingMatchesWheel(p, { ctrlKey: true, deltaY: -1 }), true);
	assert.equal(bindingMatchesWheel(p, { ctrlKey: true, deltaY: 1 }), false);
	const key = parseBinding(combo([MOD.ctrl], "="));
	assert.equal(bindingMatchesWheel(key, { ctrlKey: true, deltaY: -1 }), false);
	assert.equal(
		bindingMatchesWheel(undefined, { ctrlKey: true, deltaY: -1 }),
		false,
	);
});

test("shifted symbols fold to their base key (Ctrl+Shift+/ reports '?')", () => {
	// Ctrl+Shift+/ produces `?` as `KeyboardEvent.key` on US layouts; it must
	// still match the `help_toggle` binding whose key is `/`.
	assert.equal(keyMatches("?", "/"), true);
	assert.equal(keyMatches("/", "?"), true);
	assert.equal(keyMatches("?", "?"), true);
	const help = parseBinding(DEFAULT_BINDS.help_toggle);
	assert.equal(help.key, "/");
	assert.equal(keyMatches("?", help.key), true);
	// Unrelated shifted characters don't collapse.
	assert.equal(keyMatches("?", ","), false);
});

test("notification_focus binds to a plain Ctrl+N key chord", () => {
	const p = parseBinding(DEFAULT_BINDS.notification_focus);
	assert.equal(p.kind, "key");
	assert.equal(p.ctrl, true);
	assert.equal(p.alt, false);
	assert.equal(p.shift, false);
	assert.equal(p.meta, false);
	assert.equal(keyMatches("n", p.key), true);
});

test("action helpers map names to direction and scope", () => {
	assert.equal(zoomDirectionForAction("terminal_zoom_in"), 1);
	assert.equal(zoomDirectionForAction("terminal_zoom_out"), -1);
	assert.equal(zoomDirectionForAction("terminal_zoom_all_in"), 1);
	assert.equal(zoomDirectionForAction("terminal_zoom_all_out"), -1);
	assert.equal(zoomAppliesToAllVisible("terminal_zoom_all_in"), true);
	assert.equal(zoomAppliesToAllVisible("terminal_zoom_all_out"), true);
	assert.equal(zoomAppliesToAllVisible("terminal_zoom_in"), false);
	assert.equal(zoomAppliesToAllVisible("terminal_zoom_out"), false);
});
