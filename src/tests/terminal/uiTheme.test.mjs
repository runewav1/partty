/**
 * Regression tests for optional theme files and src/terminal/uiTheme.ts.
 *
 * Guards the canonical background/foreground/cursor/accent anchors and the
 * per-theme terminal ANSI palettes against drift. The real module loads the
 * resource files through a stubbed IPC boundary; no themes remain embedded
 * except Partty. A golden checksum pins the full pre-extraction palette data.
 *
 * Authoritative sources:
 * - Catppuccin palette.json (catppuccin/palette) — latte text/mauve/rosewater + ansiColors
 * - Solarized (altercation/solarized) — base00 #657b83, base01 #586e75, blue #268bd2
 * - Ayu (ayu-theme/ayu-colors / alacritty-theme) — bg #0A0E14, fg #B3B1AD
 * - Gruvbox (morhetz/gruvbox gruvbox.vim) — dark1 #3c3836, faded_orange #af3a03, faded_red #9d0006
 * - Flexoki (kepano/flexoki) — light accent blue-600 #205EA6
 * - SynthWave '84 (robb0wen/synthwave-vscode) — bg #262335, fg #ffffff, accent #ff7edb
 * - Tokyo Night (folke/tokyonight.nvim) — selection #283457, cyan #7dcfff
 *
 * Run: node --experimental-vm-modules --experimental-strip-types --test src/tests/terminal/uiTheme.test.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createVmLoader } from "../support/vm.mjs";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const resources = new URL("../../../resources/themes/", import.meta.url);
const presets = {};
const resourceFiles = await readdir(resources);
for (const file of resourceFiles.filter((name) => name.endsWith(".toml"))) {
	// biome-ignore lint/performance/noAwaitInLoops: Small, fixed resource fixtures loaded once for the suite.
	const text = await readFile(new URL(file, resources), "utf8");
	// Generated presets use only quoted string pairs in [colors]. Rust tests
	// independently parse these same files with the production TOML parser.
	assert.equal(text.includes("[prefs"), false);
	presets[file.slice(0, -5)] = Object.fromEntries(
		text
			.split("[colors]\n")[1]
			.trim()
			.split("\n")
			.map((line) => line.split(" = ").map(JSON.parse)),
	);
}
const css = new Map();
const root = {
	dataset: {},
	style: {
		setProperty: (key, value) => css.set(key, value),
		removeProperty: (key) => css.delete(key),
		getPropertyValue: (key) => css.get(key) ?? "",
	},
};
const loader = createVmLoader({
	root: new URL("../../", import.meta.url),
	globals: {
		document: { documentElement: root },
		getComputedStyle: () => root.style,
	},
	stubs: {
		"@tauri-apps/api/core": {
			invoke: async (command, args) => {
				if (command === "list_themes") return Object.keys(presets);
				if (command === "read_theme")
					return { colors: presets[args.name], prefs: null };
			},
		},
	},
});
const api = await loader.api("terminal/uiTheme.ts");
await api.ensureCustomThemesLoaded();
const { buildXtermThemeFromPrefs, terminalFindColors, themeCssVarsForPrefs } =
	api;
const deriveFindHighlightColors = (...args) =>
	JSON.parse(JSON.stringify(api.deriveFindHighlightColors(...args)));

test("all 31 extracted UI/ANSI palettes match the original built-ins exactly", () => {
	const stable = Object.keys(presets)
		.sort()
		.map((slug) => [
			slug,
			Object.entries(presets[slug]).sort(([a], [b]) => a.localeCompare(b)),
		]);
	assert.equal(stable.length, 31);
	assert.equal(
		createHash("sha256").update(JSON.stringify(stable)).digest("hex"),
		// biome-ignore lint/security/noSecrets: Golden checksum of the original palette data.
		"b8f9aafd8b1dabdee58965f22a542b044ae3b7597169db26b07c5edd4b4ed9fe",
	);
});

function presetPrefs(theme, variant) {
	const id =
		theme === "partty" || theme.startsWith("custom:")
			? theme
			: `custom:${theme}${variant === "default" ? "" : `-${variant.replaceAll("_", "-")}`}`;
	return { ui_theme: id, ui_theme_variant: "default" };
}

function vars(theme, variant) {
	return themeCssVarsForPrefs(presetPrefs(theme, variant));
}

function ansi(theme, variant) {
	return buildXtermThemeFromPrefs(presetPrefs(theme, variant));
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

test("missing files fall back to Partty; Matrix retains its original generic ANSI", () => {
	assert.equal(ansi("custom:does-not-exist", "default").red, "#fa4d56");
	for (const themeId of ["matrix"]) {
		const theme = ansi(themeId, "default");
		assert.equal(
			theme.black,
			"#000000",
			`${themeId} should use fallback black`,
		);
		assert.equal(theme.red, "#cd3131", `${themeId} should use fallback red`);
	}
});

test("unknown and retired IDs fall back to Partty without resolving installed presets", () => {
	const fallback = vars("partty", "default");
	for (const id of [
		"system",
		"tokyonight",
		"github-dark",
		"vscode-light",
		"missing",
		"custom:missing",
	]) {
		const prefs = { ui_theme: id, ui_theme_variant: "light" };
		assert.equal(api.normalizePaneThemePrefs(prefs).ui_theme, id);
		assert.deepEqual({ ...themeCssVarsForPrefs(prefs) }, { ...fallback });
	}
	assert.notDeepEqual(
		{ ...vars("github-dark", "default") },
		{ ...fallback },
		"only an explicit custom ID resolves the installed file",
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
		ui_theme: "custom:tokyonight",
		ui_theme_variant: "default",
	});
	const latte = terminalFindColors({
		ui_theme: "custom:catppuccin-latte",
		ui_theme_variant: "default",
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

test("Partty is Carbonfox; explicit file colors survive app/pane rendering and switching", () => {
	assert.deepEqual({ ...vars("partty", "default") }, presets.carbonfox);
	assert.equal(api.pickUiPrefs({}).ui_theme, "partty");
	assert.equal(api.pickUiPrefs({ ui_theme: "system" }).ui_theme, "system");
	css.set("--term-pad-x", "23px");
	for (const theme of ["solarized-light", "catppuccin-latte", "partty"]) {
		const prefs = {
			...api.parseProfileThemeRef(theme),
			font_terminal: "",
			font_ui: "",
		};
		api.applyUiTheme(prefs);
		assert.deepEqual(
			{ ...api.buildXtermThemeFromDocument() },
			{ ...buildXtermThemeFromPrefs(prefs) },
		);
		assert.equal(css.get("--term-pad-x"), "23px");
	}
});
