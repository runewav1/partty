import assert from "node:assert/strict";
import { test } from "node:test";
import {
	consumeSinglePress,
	DEFAULT_BINDS,
	firstMatchingWheelAction,
	keyMatches,
	parseBinding,
	WHEEL_ZOOM_ACTIONS,
	zoomAppliesToAllVisible,
	zoomDirectionForAction,
} from "../../terminal/keybindCore.ts";

function wheelMatcher(binds = DEFAULT_BINDS) {
	const parsed = Object.fromEntries(
		Object.entries(binds).map(([action, raw]) => [action, parseBinding(raw)]),
	);
	return (deltaY, modifiers = {}) =>
		firstMatchingWheelAction(parsed, WHEEL_ZOOM_ACTIONS, {
			deltaY,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			metaKey: false,
			...modifiers,
		});
}

test("default wheel gestures select zoom direction and scope without consuming normal scroll", () => {
	const match = wheelMatcher();
	for (const [delta, shiftKey, action, direction] of [
		[-1, false, "terminal_zoom_in", 1],
		[1, false, "terminal_zoom_out", -1],
		[-1, true, "terminal_zoom_all_in", 1],
		[1, true, "terminal_zoom_all_out", -1],
	]) {
		assert.equal(match(delta, { ctrlKey: true, shiftKey }), action);
		assert.equal(zoomDirectionForAction(action), direction);
		assert.equal(zoomAppliesToAllVisible(action), shiftKey);
	}
	assert.equal(match(-1), null);
	assert.equal(match(0, { ctrlKey: true }), null);
	for (const extra of ["altKey", "metaKey"]) {
		assert.equal(match(-1, { ctrlKey: true, [extra]: true }), null);
		assert.equal(
			match(-1, { ctrlKey: true, shiftKey: true, [extra]: true }),
			null,
		);
	}
});

test("custom wheel chords can swap directions or match either direction", () => {
	const match = wheelMatcher({
		terminal_zoom_in: "alt+wheeldown",
		terminal_zoom_out: "Alt+WheelUp",
		terminal_zoom_all_in: ["Alt", "Shift", "Wheel"].join("+"),
		terminal_zoom_all_out: "Alt+Shift+=",
	});
	assert.equal(match(1, { altKey: true }), "terminal_zoom_in");
	assert.equal(match(-1, { altKey: true }), "terminal_zoom_out");
	for (const delta of [-1, 1]) {
		assert.equal(
			match(delta, { altKey: true, shiftKey: true }),
			"terminal_zoom_all_in",
		);
	}
	assert.equal(match(1, { ctrlKey: true }), null);
	assert.equal(wheelMatcher({})(-1, { altKey: true }), null);
	const withoutAll = wheelMatcher({
		terminal_zoom_in: "Alt+WheelUp",
		terminal_zoom_all_in: "",
		terminal_zoom_all_out: "Alt+Shift+=",
	});
	assert.equal(withoutAll(-1, { altKey: true, shiftKey: true }), null);
});

test("shortcut tokens distinguish keyboard and wheel input and reject incomplete chords", () => {
	for (const token of ["WheelUp", "WheelDown", "Wheel"]) {
		assert.equal(parseBinding(`Ctrl+${token}`).kind, "wheel");
	}
	assert.equal(parseBinding("Ctrl+=").kind, "key");
	assert.equal(parseBinding(""), null);
	assert.equal(parseBinding("Ctrl+"), null);

	// Ctrl+Shift+/ can report '?' as KeyboardEvent.key.
	assert.equal(keyMatches("?", "/"), true);
	assert.equal(keyMatches("/", "?"), true);
	assert.equal(keyMatches("?", "?"), true);
	assert.equal(keyMatches("?", ","), false);
});

test("an owned single-press shortcut consumes held keys without repeating the action", () => {
	for (const repeat of [false, true]) {
		const calls = [];
		const event = {
			repeat,
			preventDefault: () => calls.push("prevent"),
			stopPropagation: () => calls.push("stop"),
		};
		assert.equal(consumeSinglePress(event), !repeat);
		assert.deepEqual(calls.sort(), ["prevent", "stop"]);
	}
});
