import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createVmLoader } from "../support/vm.mjs";

test("terminal presentation reapplies focus settings and respects zero values", async () => {
	const classes = new Map();
	const css = new Map();
	const root = new URL("../../", import.meta.url);
	const loader = createVmLoader({
		root,
		globals: {
			document: {
				documentElement: {
					classList: { toggle: (name, enabled) => classes.set(name, enabled) },
					style: { setProperty: (name, value) => css.set(name, value) },
				},
			},
		},
		stubs: {
			[fileURLToPath(new URL("util/motion.ts", root))]: {
				applyMotionPreferences: () => {},
			},
			[fileURLToPath(new URL("terminal/uiTheme.ts", root))]: {
				DEFAULT_TERMINAL_FONT_STACK: "monospace",
			},
		},
	});
	const { applyPaneFocusPresentation, applyTerminalDisplayPrefs } =
		await loader.api("./app/terminalPresentation.ts");

	applyPaneFocusPresentation({});
	assert.equal(classes.get("pane-focus-scale"), true);
	assert.equal(css.get("--pane-blur-radius"), "1.6");

	applyPaneFocusPresentation({
		pane_focus_scale_intensity: 0,
		blur_unfocused_panes: true,
		pane_blur_radius: 0,
		pane_variable_opacity: true,
		pane_opacity_unfocused: 0,
	});
	assert.equal(classes.get("pane-focus-scale"), false);
	assert.equal(classes.get("pane-blur-unfocused"), true);
	assert.equal(classes.get("pane-variable-opacity"), true);
	assert.equal(css.get("--pane-focus-scale-delta"), "0");
	assert.equal(css.get("--pane-blur-radius"), "0");
	assert.equal(css.get("--pane-opacity-unfocused"), "0");

	const acrylic = { window_effect_mode: "acrylic", window_effect_opacity: 0.4 };
	applyTerminalDisplayPrefs(acrylic, true);
	assert.equal(css.get("--partty-app-bg-alpha"), "0");
	applyTerminalDisplayPrefs(acrylic, false);
	assert.equal(css.get("--partty-app-bg-alpha"), "0.4");
});
