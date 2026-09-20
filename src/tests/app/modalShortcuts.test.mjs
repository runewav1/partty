/**
 * Regression tests for the cross-modal app-shortcut policy
 * (src/app/modalShortcuts.ts).
 *
 * The command island shows one surface at a time, and users switch between
 * surfaces with the existing keybinds. A surface-summoning shortcut (Settings,
 * Help, palette) must therefore run while another surface's search field owns
 * focus, while pane/tab mutations stay suppressed behind an open surface.
 * Blocking dialogs suppress settings/help switching. These rules are pure, so they are
 * exercised directly with minimal fake targets.
 *
 * Run: node --experimental-strip-types --test src/tests/app/modalShortcuts.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const { isInBlockingDialog, isInCommandSurface, shortcutRuns } = await import(
	"../../app/modalShortcuts.ts"
);

/** Minimal keyboard-event target with selector-matching `closest`. */
function target(selectors = []) {
	return {
		closest(selector) {
			return selectors.includes(selector) ? {} : null;
		},
	};
}

const PALETTE_INPUT = target(["#command-palette"]);
const SETTINGS_SEARCH = target(["#settings-panel"]);
const TERMINAL = target();
const DIALOG_INPUT = target([".partty-dialog-panel"]);

test("surface shortcuts run from inside a command surface so surfaces switch", () => {
	assert.equal(shortcutRuns("surface", PALETTE_INPUT), true);
	assert.equal(shortcutRuns("surface", SETTINGS_SEARCH), true);
	assert.equal(shortcutRuns("surface", TERMINAL), true);
});

test("mutation shortcuts stay suppressed while a command surface owns focus", () => {
	assert.equal(shortcutRuns("mutation", PALETTE_INPUT), false);
	assert.equal(shortcutRuns("mutation", SETTINGS_SEARCH), false);
	assert.equal(shortcutRuns("mutation", TERMINAL), true);
});

test("blocking dialogs suppress surface switching without changing mutation policy", () => {
	assert.equal(shortcutRuns("surface", DIALOG_INPUT), false);
	assert.equal(shortcutRuns("mutation", DIALOG_INPUT), true);
});

test("surface/dialog classification is selector-driven", () => {
	assert.equal(isInCommandSurface(PALETTE_INPUT), true);
	assert.equal(isInCommandSurface(SETTINGS_SEARCH), true);
	assert.equal(isInCommandSurface(TERMINAL), false);
	assert.equal(isInBlockingDialog(DIALOG_INPUT), true);
	assert.equal(isInBlockingDialog(PALETTE_INPUT), false);
});

test("a missing target is treated as outside every modal", () => {
	assert.equal(isInCommandSurface(null), false);
	assert.equal(isInBlockingDialog(undefined), false);
	assert.equal(shortcutRuns("surface", null), true);
	assert.equal(shortcutRuns("mutation", null), true);
});
