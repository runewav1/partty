/**
 * Regression tests for bundled theme palettes (src/terminal/uiTheme.ts).
 *
 * Guards the canonical background/foreground/cursor/accent anchors and the
 * per-theme terminal ANSI palettes against drift. The module is pure at the
 * surfaces under test (themeCssVarsForPrefs / buildXtermThemeFromPrefs), so
 * node --experimental-strip-types can import it directly.
 *
 * Authoritative sources (see PR/commit notes for the audit):
 * - Catppuccin palette.json (catppuccin/palette) — latte text/mauve/rosewater + ansiColors
 * - Solarized (altercation/solarized) — base00 #657b83, base01 #586e75, blue #268bd2
 * - Ayu (ayu-theme/ayu-colors / alacritty-theme) — bg #0A0E14, fg #B3B1AD
 * - Gruvbox (morhetz/gruvbox gruvbox.vim) — dark1 #3c3836, faded_orange #af3a03, faded_red #9d0006
 * - Flexoki (kepano/flexoki) — light accent blue-600 #205EA6
 * - SynthWave '84 (robb0wen/synthwave-vscode) — bg #262335, fg #ffffff, accent #ff7edb
 * - Tokyo Night (folke/tokyonight.nvim) — selection #283457, cyan #7dcfff
 *
 * Run: node --experimental-strip-types --test src/tests/themePalettes.test.mjs
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");

const MODULE_URL = pathToFileURL(resolve(REPO, "src/terminal/uiTheme.ts")).href;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const {
	buildXtermThemeFromPrefs,
	deriveFindHighlightColors,
	terminalFindColors,
	themeCssVarsForPrefs,
	themeUsesCanonicalTerminalColors,
} = await import(MODULE_URL);

function vars(theme, variant) {
	return themeCssVarsForPrefs({ ui_theme: theme, ui_theme_variant: variant });
}

function ansi(theme, variant) {
	return buildXtermThemeFromPrefs({
		ui_theme: theme,
		ui_theme_variant: variant,
	});
}

test("every preset variant exposes readable term/foreground and accent anchors", () => {
	const cases = [
		// [theme, variant, expected subset of CSS vars]
		[
			"tokyonight",
			"default",
			{ "--term-bg": "#1a1b26", "--term-fg": "#c0caf5" },
		],
		[
			"everforest",
			"default",
			{ "--term-bg": "#2d353b", "--term-fg": "#d3c6aa" },
		],
		["ayu", "default", { "--term-bg": "#0A0E14", "--term-fg": "#B3B1AD" }],
		["catppuccin", "mocha", { "--term-bg": "#1e1e2e", "--term-fg": "#cdd6f4" }],
		[
			"catppuccin",
			"latte",
			{
				"--term-bg": "#eff1f5",
				"--term-fg": "#4c4f69",
				"--term-cursor": "#dc8a78",
				"--ui-gray-400": "#6c6f85",
				"--accent-primary": "#8839ef",
			},
		],
		[
			"gruvbox",
			"soft_light",
			{
				"--term-bg": "#f2e5bc",
				"--term-fg": "#3c3836",
				"--term-cursor": "#af3a03",
				"--accent-primary": "#af3a03",
			},
		],
		[
			"gruvbox",
			"hard_light",
			{
				"--term-bg": "#f9f5d7",
				"--term-fg": "#3c3836",
				"--term-cursor": "#af3a03",
				"--accent-primary": "#9d0006",
			},
		],
		[
			"solarized",
			"light",
			{
				"--term-bg": "#fdf6e3",
				"--term-fg": "#657b83",
				"--term-cursor": "#586e75",
				"--accent-primary": "#268bd2",
			},
		],
		[
			"synthwave-84",
			"default",
			{
				"--term-bg": "#262335",
				"--term-fg": "#ffffff",
				"--term-cursor": "#03edf9",
				"--accent-primary": "#ff7edb",
				"--accent-primary-light": "#03edf9",
				"--accent-primary-lighter": "#fede5d",
			},
		],
		[
			"flexoki",
			"light",
			{ "--accent-primary": "#205EA6", "--accent-primary-lighter": "#4385BE" },
		],
		[
			"tokyonight",
			"default",
			{
				"--term-selection-bg": "#28345788",
				"--accent-primary-light": "#7dcfff",
			},
		],
		[
			"nord",
			"default",
			{ "--term-bg": "#2e3440", "--accent-primary": "#88c0d0" },
		],
		[
			"dracula",
			"default",
			{ "--term-bg": "#282a36", "--accent-primary": "#bd93f9" },
		],
		[
			"kanagawa",
			"default",
			{ "--term-bg": "#1f1f28", "--accent-primary": "#7e9cd8" },
		],
	];
	for (const [theme, variant, expected] of cases) {
		const actual = vars(theme, variant);
		for (const [key, value] of Object.entries(expected)) {
			assert.equal(
				actual[key],
				value,
				`${theme}/${variant} ${key} expected ${value}, got ${actual[key]}`,
			);
		}
	}
});

test("Light/dark named variants resolve to their own ANSI, not the generic remap", () => {
	const genericDark = { black: "#000000", red: "#cd3131" };

	const tokyo = ansi("tokyonight", "default");
	assert.equal(tokyo.red, "#f7768e");
	assert.equal(tokyo.cyan, "#7dcfff");
	assert.equal(tokyo.brightBlack, "#414868");

	const dracula = ansi("dracula", "default");
	assert.equal(dracula.green, "#50fa7b");
	assert.equal(dracula.magenta, "#ff79c6");
	assert.equal(dracula.brightBlack, "#6272a4");

	const latte = ansi("catppuccin", "latte");
	assert.equal(latte.red, "#d20f39");
	assert.equal(latte.blue, "#1e66f5");
	assert.equal(latte.white, "#acb0be");
	assert.equal(latte.brightBlack, "#6c6f85");

	const mocha = ansi("catppuccin", "mocha");
	assert.equal(mocha.red, "#f38ba8");
	assert.equal(mocha.brightBlack, "#585b70");

	const gruvboxLight = ansi("gruvbox", "soft_light");
	assert.equal(gruvboxLight.black, "#f2e5bc");
	assert.equal(gruvboxLight.brightRed, "#9d0006");
	assert.equal(gruvboxLight.brightWhite, "#3c3836");

	const synth = ansi("synthwave-84", "default");
	assert.equal(synth.magenta, "#ff7edb");
	assert.equal(synth.blue, "#03edf9");
	assert.equal(synth.yellow, "#f97e72");

	const ayu = ansi("ayu", "default");
	assert.equal(ayu.blue, "#53BDFA");
	assert.equal(ayu.brightBlue, "#59C2FF");

	const flexokiLight = ansi("flexoki", "light");
	assert.equal(flexokiLight.red, "#D14D41");
	assert.equal(flexokiLight.blue, "#4385BE");

	const githubLight = ansi("github", "light");
	assert.equal(githubLight.blue, "#0969da");
	assert.equal(githubLight.black, "#24292f");

	// The generic fallback must no longer leak onto a named theme.
	assert.notDeepEqual(
		{ black: tokyo.black, red: tokyo.red },
		genericDark,
		"tokyonight ANSI must not equal the generic Windows palette",
	);
});

test("system/custom/matrix fall back to the generic dark/light ANSI remap", () => {
	for (const themeId of ["custom:does-not-exist", "matrix"]) {
		const theme = ansi(themeId, "default");
		assert.equal(
			theme.black,
			"#000000",
			`${themeId} should use fallback black`,
		);
		assert.equal(theme.red, "#cd3131", `${themeId} should use fallback red`);
	}
});

test("normalizePaneThemePrefs keeps deprecated ids resolving to canonical variants", () => {
	assert.deepEqual(
		{ ...vars("github-dark", "default") },
		{ ...vars("github", "dark") },
	);
	assert.deepEqual(
		{ ...vars("vscode-light", "default") },
		{ ...vars("vscode", "light") },
	);
});

function contrastRatio(a, b) {
	const lum = (hex) => {
		const n = Number.parseInt(hex.slice(1), 16);
		const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
			const x = v / 255;
			return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
	};
	const la = lum(a) + 0.05;
	const lb = lum(b) + 0.05;
	return la > lb ? la / lb : lb / la;
}

test("find highlights derive from bg + accent and honor explicit overrides", () => {
	const derived = deriveFindHighlightColors("#1a1b26", "#c0caf5", "#7aa2f7");
	assert.ok(derived, "bg + accent must derive a pair");
	for (const highlight of [derived.match, derived.active]) {
		assert.ok(HEX_COLOR.test(highlight.background), "concrete hex background");
		assert.ok(HEX_COLOR.test(highlight.foreground), "concrete hex foreground");
		assert.ok(
			contrastRatio(highlight.background, highlight.foreground) >= 4.5,
			`text must stay legible on the highlight, got ${JSON.stringify(highlight)}`,
		);
	}
	// Plain text keeps the theme foreground, so the tint does not recolor it.
	assert.equal(derived.match.foreground, "#c0caf5");
	assert.notEqual(derived.match.background, derived.active.background);

	// Explicit per-theme values win, so custom colors can be set independently.
	assert.deepEqual(
		deriveFindHighlightColors("#1a1b26", "#c0caf5", "#7aa2f7", {
			matchBg: "#123456",
			matchFg: "#abcdef",
			activeBg: "#654321",
			activeFg: "#fedcba",
		}),
		{
			match: { background: "#123456", foreground: "#abcdef" },
			active: { background: "#654321", foreground: "#fedcba" },
		},
	);

	// Non-concrete colors (color-mix, var) cannot feed xterm; fall back.
	const bad = deriveFindHighlightColors("#1a1b26", "#c0caf5", "#7aa2f7", {
		matchBg: "color-mix(in srgb, red, blue)",
	});
	assert.notEqual(bad.match.background, "color-mix(in srgb, red, blue)");

	// No background/accent means nothing to blend toward.
	assert.equal(
		deriveFindHighlightColors("#1a1b26", "#c0caf5", undefined),
		null,
	);
});

test("terminal find colors are theme-aware per pane", () => {
	const tokyo = terminalFindColors({
		ui_theme: "tokyonight",
		ui_theme_variant: "default",
	});
	const latte = terminalFindColors({
		ui_theme: "catppuccin",
		ui_theme_variant: "latte",
	});
	assert.notDeepEqual(
		tokyo,
		latte,
		"different themes must yield different tints",
	);
	for (const colors of [tokyo, latte]) {
		for (const highlight of [colors.match, colors.active]) {
			assert.ok(HEX_COLOR.test(highlight.background));
			assert.ok(HEX_COLOR.test(highlight.foreground));
			assert.ok(
				contrastRatio(highlight.background, highlight.foreground) >= 4.5,
				"every theme must yield a legible highlight pair",
			);
		}
	}
});

test("named themes keep canonical terminal colors; system/custom get contrast fallback", () => {
	// Regression: syncTerminalFgContrast used to rewrite canonical foregrounds
	// (e.g. Solarized light #657b83) at a 7:1 threshold, making the document
	// chrome diverge from the pane's xterm theme. Named themes must opt out.
	for (const id of [
		"tokyonight",
		"ayu",
		"catppuccin",
		"gruvbox",
		"solarized",
		"synthwave-84",
		"matrix",
		"github-dark",
	]) {
		assert.equal(
			themeUsesCanonicalTerminalColors(id),
			true,
			`${id} must keep canonical terminal colors`,
		);
	}
	for (const id of ["system", "custom:my-theme", ""]) {
		assert.equal(
			themeUsesCanonicalTerminalColors(id),
			false,
			`${id} must use the contrast fallback`,
		);
	}
});
