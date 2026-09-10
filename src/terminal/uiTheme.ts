/**
 * App-wide UI + terminal theming. Presets set CSS variables on `document.documentElement`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ITheme } from "@xterm/xterm";

export type UiThemePrefs = {
	ui_theme: string;
	ui_theme_variant: string;
	font_terminal: string;
	font_ui: string;
};

export type PaneThemePrefs = Pick<
	UiThemePrefs,
	"ui_theme" | "ui_theme_variant"
>;

/** Cascadia Code (ligatures) ships with Windows 11 / modern Terminal; Consolas is the Win10+ fallback. */
export const DEFAULT_TERMINAL_FONT_STACK =
	'"Cascadia Code",Consolas,"Courier New",monospace';

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;
const RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;

export type ThemeCssVars = Record<string, string>;

/** themeId -> variant -> CSS custom properties */
const PRESETS: Record<string, Record<string, ThemeCssVars>> = {
	system: {
		default: {},
	},
	tokyonight: {
		default: {
			"--term-bg": "#1a1b26",
			"--term-fg": "#c0caf5",
			"--term-cursor": "#c0caf5",
			"--term-selection-bg": "#28345788",
			"--ui-gray-900": "#16161e",
			"--ui-gray-800": "#1f2335",
			"--ui-gray-700": "#292e42",
			"--ui-gray-400": "#565f89",
			"--ui-gray-300": "#a9b1d6",
			"--accent-primary": "#7aa2f7",
			"--accent-primary-light": "#7dcfff",
			"--accent-primary-lighter": "#bb9af7",
			"--panel-bg": "#1f2335",
			"--panel-border": "#3b4261",
			"--backdrop-darkest": "rgba(13, 16, 33, 0.52)",
			"--input-bg": "#1a1b26",
			"--input-border": "#3b4261",
			"--pane-divider": "rgba(122,162,247,0.25)",
			"--pane-divider-hover": "rgba(122,162,247,0.42)",
		},
	},
	everforest: {
		default: {
			"--term-bg": "#2d353b",
			"--term-fg": "#d3c6aa",
			"--term-cursor": "#d3c6aa",
			"--term-selection-bg": "#47525888",
			"--ui-gray-900": "#232a2e",
			"--ui-gray-800": "#2d353b",
			"--ui-gray-700": "#3d484d",
			"--ui-gray-400": "#859289",
			"--accent-primary": "#a7c080",
			"--accent-primary-light": "#b8d0a8",
			"--panel-bg": "#343f44",
			"--panel-border": "#4f585e",
			"--backdrop-darkest": "rgba(20, 26, 28, 0.5)",
			"--input-bg": "#2d353b",
			"--input-border": "#4f585e",
			"--pane-divider": "rgba(167,192,128,0.22)",
			"--pane-divider-hover": "rgba(167,192,128,0.38)",
		},
	},
	ayu: {
		default: {
			"--term-bg": "#0A0E14",
			"--term-fg": "#B3B1AD",
			"--term-cursor": "#e6e1cf",
			"--term-selection-bg": "#30445788",
			"--ui-gray-900": "#06080c",
			"--ui-gray-800": "#0A0E14",
			"--ui-gray-700": "#151a1e",
			"--ui-gray-400": "#6c7380",
			"--accent-primary": "#59c2ff",
			"--accent-primary-light": "#73d0ff",
			"--panel-bg": "#0f131a",
			"--panel-border": "#242936",
			"--backdrop-darkest": "rgba(5, 8, 12, 0.55)",
			"--input-bg": "#0A0E14",
			"--input-border": "#242936",
			"--pane-divider": "rgba(89,194,255,0.22)",
			"--pane-divider-hover": "rgba(89,194,255,0.4)",
		},
	},
	catppuccin: {
		mocha: {
			"--term-bg": "#1e1e2e",
			"--term-fg": "#cdd6f4",
			"--term-cursor": "#f5e0dc",
			"--term-selection-bg": "#585b7088",
			"--ui-gray-800": "#181825",
			"--ui-gray-700": "#313244",
			"--ui-gray-400": "#a6adc8",
			"--accent-primary": "#cba6f7",
			"--accent-primary-light": "#f5c2e7",
			"--panel-bg": "#313244",
			"--panel-border": "#45475a",
			"--backdrop-darkest": "rgba(17, 17, 27, 0.55)",
			"--input-bg": "#1e1e2e",
			"--input-border": "#45475a",
			"--pane-divider": "rgba(203,166,247,0.25)",
			"--pane-divider-hover": "rgba(203,166,247,0.42)",
		},
		macchiato: {
			"--term-bg": "#24273a",
			"--term-fg": "#cad3f5",
			"--term-cursor": "#f4dbd6",
			"--term-selection-bg": "#5b607888",
			"--ui-gray-800": "#1e2030",
			"--ui-gray-700": "#363a4f",
			"--ui-gray-400": "#a5adcb",
			"--accent-primary": "#c6a0f6",
			"--panel-bg": "#363a4f",
			"--panel-border": "#494d64",
			"--backdrop-darkest": "rgba(20, 22, 36, 0.52)",
			"--input-bg": "#24273a",
			"--input-border": "#494d64",
			"--pane-divider": "rgba(198,160,246,0.24)",
			"--pane-divider-hover": "rgba(198,160,246,0.4)",
		},
		frappe: {
			"--term-bg": "#303446",
			"--term-fg": "#c6d0f5",
			"--term-cursor": "#f2d5cf",
			"--term-selection-bg": "#62688088",
			"--ui-gray-800": "#292c3c",
			"--ui-gray-700": "#414559",
			"--accent-primary": "#ca9ee6",
			"--panel-bg": "#414559",
			"--panel-border": "#51576d",
			"--backdrop-darkest": "rgba(24, 26, 36, 0.5)",
			"--input-bg": "#303446",
			"--input-border": "#51576d",
			"--pane-divider": "rgba(202,158,230,0.22)",
			"--pane-divider-hover": "rgba(202,158,230,0.4)",
		},
		latte: {
			"--term-bg": "#eff1f5",
			"--term-fg": "#4c4f69",
			"--term-cursor": "#dc8a78",
			"--term-selection-bg": "#acb0be88",
			"--ui-gray-900": "#dce0e8",
			"--ui-gray-800": "#e6e9ef",
			"--ui-gray-700": "#ccd0da",
			"--ui-gray-400": "#6c6f85",
			"--accent-primary": "#8839ef",
			"--panel-bg": "#dce0e8",
			"--panel-border": "#bcc0cc",
			"--backdrop-darkest": "rgba(76, 79, 105, 0.35)",
			"--input-bg": "#eff1f5",
			"--input-border": "#acb0be",
			"--pane-divider": "rgba(136,57,239,0.2)",
			"--pane-divider-hover": "rgba(136,57,239,0.35)",
		},
	},
	gruvbox: {
		soft_dark: {
			"--term-bg": "#32302f",
			"--term-fg": "#ebdbb2",
			"--term-cursor": "#fe8019",
			"--term-selection-bg": "#665c5488",
			"--ui-gray-800": "#282828",
			"--ui-gray-700": "#3c3836",
			"--accent-primary": "#fe8019",
			"--accent-primary-light": "#fabd2f",
			"--panel-bg": "#3c3836",
			"--panel-border": "#504945",
			"--backdrop-darkest": "rgba(20, 18, 16, 0.55)",
			"--input-bg": "#32302f",
			"--input-border": "#504945",
			"--pane-divider": "rgba(254,128,25,0.22)",
			"--pane-divider-hover": "rgba(254,128,25,0.4)",
		},
		hard_dark: {
			"--term-bg": "#1d2021",
			"--term-fg": "#ebdbb2",
			"--term-cursor": "#fe8019",
			"--term-selection-bg": "#50494588",
			"--ui-gray-800": "#161819",
			"--ui-gray-700": "#282828",
			"--accent-primary": "#fe8019",
			"--panel-bg": "#282828",
			"--panel-border": "#3c3836",
			"--backdrop-darkest": "rgba(10, 10, 10, 0.58)",
			"--input-bg": "#1d2021",
			"--input-border": "#3c3836",
			"--pane-divider": "rgba(254,128,25,0.25)",
			"--pane-divider-hover": "rgba(254,128,25,0.42)",
		},
		soft_light: {
			"--term-bg": "#f2e5bc",
			"--term-fg": "#3c3836",
			"--term-cursor": "#af3a03",
			"--term-selection-bg": "#d5c4a188",
			"--ui-gray-900": "#ebdbb2",
			"--ui-gray-800": "#f2e5bc",
			"--ui-gray-700": "#ebdbb2",
			"--ui-gray-400": "#3c3836",
			"--accent-primary": "#af3a03",
			"--panel-bg": "#ebdbb2",
			"--panel-border": "#d5c4a1",
			"--backdrop-darkest": "rgba(80, 60, 40, 0.25)",
			"--input-bg": "#f2e5bc",
			"--input-border": "#d5c4a1",
			"--pane-divider": "rgba(175,58,3,0.2)",
			"--pane-divider-hover": "rgba(175,58,3,0.35)",
		},
		hard_light: {
			"--term-bg": "#f9f5d7",
			"--term-fg": "#3c3836",
			"--term-cursor": "#af3a03",
			"--term-selection-bg": "#bdae9388",
			"--ui-gray-800": "#f2e5bc",
			"--ui-gray-700": "#ebdbb2",
			"--accent-primary": "#9d0006",
			"--panel-bg": "#ebdbb2",
			"--panel-border": "#d5c4a1",
			"--backdrop-darkest": "rgba(60, 45, 30, 0.22)",
			"--input-bg": "#f9f5d7",
			"--input-border": "#bdae93",
			"--pane-divider": "rgba(181,118,20,0.22)",
			"--pane-divider-hover": "rgba(181,118,20,0.38)",
		},
	},
	kanagawa: {
		default: {
			"--term-bg": "#1f1f28",
			"--term-fg": "#dcd7ba",
			"--term-cursor": "#c8c093",
			"--term-selection-bg": "#2d4f6788",
			"--ui-gray-800": "#16161d",
			"--ui-gray-700": "#2a2a37",
			"--accent-primary": "#7e9cd8",
			"--accent-primary-light": "#957fb8",
			"--panel-bg": "#2a2a37",
			"--panel-border": "#363646",
			"--backdrop-darkest": "rgba(15, 15, 22, 0.55)",
			"--input-bg": "#1f1f28",
			"--input-border": "#363646",
			"--pane-divider": "rgba(126,156,216,0.22)",
			"--pane-divider-hover": "rgba(126,156,216,0.4)",
		},
	},
	nord: {
		default: {
			"--term-bg": "#2e3440",
			"--term-fg": "#eceff4",
			"--term-cursor": "#88c0d0",
			"--term-selection-bg": "#434c5e88",
			"--ui-gray-800": "#242831",
			"--ui-gray-700": "#3b4252",
			"--accent-primary": "#88c0d0",
			"--accent-primary-light": "#81a1c1",
			"--panel-bg": "#3b4252",
			"--panel-border": "#4c566a",
			"--backdrop-darkest": "rgba(20, 24, 32, 0.52)",
			"--input-bg": "#2e3440",
			"--input-border": "#4c566a",
			"--pane-divider": "rgba(136,192,208,0.24)",
			"--pane-divider-hover": "rgba(136,192,208,0.4)",
		},
	},
	matrix: {
		default: {
			"--term-bg": "#020805",
			"--term-fg": "#33ff66",
			"--term-cursor": "#39ff14",
			"--term-selection-bg": "#0d3d2088",
			"--ui-gray-800": "#010402",
			"--ui-gray-700": "#0a1f0f",
			"--accent-primary": "#22c55e",
			"--panel-bg": "#0a1f0f",
			"--panel-border": "#14532d",
			"--backdrop-darkest": "rgba(0, 10, 2, 0.65)",
			"--input-bg": "#020805",
			"--input-border": "#14532d",
			"--pane-divider": "rgba(57,255,20,0.25)",
			"--pane-divider-hover": "rgba(57,255,20,0.45)",
		},
	},
	"one-dark": {
		default: {
			"--term-bg": "#282c34",
			"--term-fg": "#abb2bf",
			"--term-cursor": "#528bff",
			"--term-selection-bg": "#4b526388",
			"--ui-gray-800": "#21252b",
			"--ui-gray-700": "#323842",
			"--accent-primary": "#61afef",
			"--accent-primary-light": "#c678dd",
			"--panel-bg": "#323842",
			"--panel-border": "#3e4451",
			"--backdrop-darkest": "rgba(20, 22, 28, 0.52)",
			"--input-bg": "#282c34",
			"--input-border": "#3e4451",
			"--pane-divider": "rgba(97,175,239,0.22)",
			"--pane-divider-hover": "rgba(97,175,239,0.4)",
		},
	},
	dracula: {
		default: {
			"--term-bg": "#282a36",
			"--term-fg": "#f8f8f2",
			"--term-cursor": "#ff79c6",
			"--term-selection-bg": "#44475a88",
			"--ui-gray-800": "#1e1f29",
			"--ui-gray-700": "#343746",
			"--accent-primary": "#bd93f9",
			"--accent-primary-light": "#ff79c6",
			"--panel-bg": "#343746",
			"--panel-border": "#44475a",
			"--backdrop-darkest": "rgba(20, 21, 28, 0.55)",
			"--input-bg": "#282a36",
			"--input-border": "#44475a",
			"--pane-divider": "rgba(189,147,249,0.24)",
			"--pane-divider-hover": "rgba(189,147,249,0.42)",
		},
	},
	solarized: {
		dark: {
			"--term-bg": "#002b36",
			"--term-fg": "#839496",
			"--term-cursor": "#93a1a1",
			"--term-selection-bg": "#07364288",
			"--ui-gray-800": "#00212b",
			"--ui-gray-700": "#073642",
			"--accent-primary": "#268bd2",
			"--accent-primary-light": "#2aa198",
			"--panel-bg": "#073642",
			"--panel-border": "#0c4a5c",
			"--backdrop-darkest": "rgba(0, 20, 28, 0.55)",
			"--input-bg": "#002b36",
			"--input-border": "#0c4a5c",
			"--pane-divider": "rgba(38,139,210,0.22)",
			"--pane-divider-hover": "rgba(38,139,210,0.4)",
		},
		light: {
			"--term-bg": "#fdf6e3",
			"--term-fg": "#657b83",
			"--term-cursor": "#586e75",
			"--term-selection-bg": "#eee8d588",
			"--ui-gray-800": "#eee8d5",
			"--ui-gray-700": "#e8e2d0",
			"--accent-primary": "#268bd2",
			"--panel-bg": "#eee8d5",
			"--panel-border": "#d5cdc0",
			"--backdrop-darkest": "rgba(60, 55, 40, 0.22)",
			"--input-bg": "#fdf6e3",
			"--input-border": "#93a1a1",
			"--pane-divider": "rgba(38,139,210,0.2)",
			"--pane-divider-hover": "rgba(38,139,210,0.35)",
		},
	},
	"rose-pine": {
		default: {
			"--term-bg": "#191724",
			"--term-fg": "#e0def4",
			"--term-cursor": "#ebbcba",
			"--term-selection-bg": "#403d5288",
			"--ui-gray-800": "#13111a",
			"--ui-gray-700": "#26233a",
			"--accent-primary": "#c4a7e7",
			"--accent-primary-light": "#ebbcba",
			"--panel-bg": "#26233a",
			"--panel-border": "#403d52",
			"--backdrop-darkest": "rgba(12, 10, 18, 0.55)",
			"--input-bg": "#191724",
			"--input-border": "#403d52",
			"--pane-divider": "rgba(196,167,231,0.22)",
			"--pane-divider-hover": "rgba(196,167,231,0.4)",
		},
	},
	palenight: {
		default: {
			"--term-bg": "#292d3e",
			"--term-fg": "#a6accd",
			"--term-cursor": "#ffcc00",
			"--term-selection-bg": "#717cb488",
			"--ui-gray-800": "#222636",
			"--ui-gray-700": "#34394f",
			"--accent-primary": "#82aaff",
			"--accent-primary-light": "#c792ea",
			"--panel-bg": "#34394f",
			"--panel-border": "#4e5577",
			"--backdrop-darkest": "rgba(18, 21, 32, 0.55)",
			"--input-bg": "#292d3e",
			"--input-border": "#4e5577",
			"--pane-divider": "rgba(130,170,255,0.24)",
			"--pane-divider-hover": "rgba(130,170,255,0.42)",
		},
	},
	monokai: {
		default: {
			"--term-bg": "#272822",
			"--term-fg": "#f8f8f2",
			"--term-cursor": "#f8f8f0",
			"--term-selection-bg": "#49483e88",
			"--ui-gray-800": "#1f201b",
			"--ui-gray-700": "#3a3b32",
			"--accent-primary": "#a6e22e",
			"--accent-primary-light": "#fd971f",
			"--panel-bg": "#3a3b32",
			"--panel-border": "#525349",
			"--backdrop-darkest": "rgba(14, 15, 12, 0.58)",
			"--input-bg": "#272822",
			"--input-border": "#525349",
			"--pane-divider": "rgba(166,226,46,0.22)",
			"--pane-divider-hover": "rgba(166,226,46,0.4)",
		},
	},
	github: {
		dark: {
			"--term-bg": "#0d1117",
			"--term-fg": "#c9d1d9",
			"--term-cursor": "#58a6ff",
			"--term-selection-bg": "#1f6feb55",
			"--ui-gray-900": "#010409",
			"--ui-gray-800": "#0d1117",
			"--ui-gray-700": "#21262d",
			"--ui-gray-400": "#8b949e",
			"--accent-primary": "#58a6ff",
			"--accent-primary-light": "#79c0ff",
			"--panel-bg": "#161b22",
			"--panel-border": "#30363d",
			"--backdrop-darkest": "rgba(1, 4, 9, 0.6)",
			"--input-bg": "#0d1117",
			"--input-border": "#30363d",
			"--pane-divider": "rgba(88,166,255,0.22)",
			"--pane-divider-hover": "rgba(88,166,255,0.4)",
		},
		light: {
			"--term-bg": "#ffffff",
			"--term-fg": "#24292f",
			"--term-cursor": "#0969da",
			"--term-selection-bg": "#0969da22",
			"--ui-gray-900": "#f6f8fa",
			"--ui-gray-800": "#ffffff",
			"--ui-gray-700": "#d0d7de",
			"--ui-gray-400": "#57606a",
			"--accent-primary": "#0969da",
			"--accent-primary-light": "#1a7f37",
			"--panel-bg": "#f6f8fa",
			"--panel-border": "#d0d7de",
			"--backdrop-darkest": "rgba(36, 41, 47, 0.22)",
			"--input-bg": "#ffffff",
			"--input-border": "#d0d7de",
			"--pane-divider": "rgba(9,105,218,0.18)",
			"--pane-divider-hover": "rgba(9,105,218,0.34)",
		},
	},
	"night-owl": {
		default: {
			"--term-bg": "#011627",
			"--term-fg": "#d6deeb",
			"--term-cursor": "#80a4c2",
			"--term-selection-bg": "#1d3b5388",
			"--ui-gray-800": "#01111f",
			"--ui-gray-700": "#0b2942",
			"--accent-primary": "#82aaff",
			"--accent-primary-light": "#7fdbca",
			"--panel-bg": "#0b2942",
			"--panel-border": "#214862",
			"--backdrop-darkest": "rgba(0, 8, 18, 0.62)",
			"--input-bg": "#011627",
			"--input-border": "#214862",
			"--pane-divider": "rgba(127,219,202,0.22)",
			"--pane-divider-hover": "rgba(127,219,202,0.4)",
		},
	},
	"synthwave-84": {
		default: {
			"--term-bg": "#262335",
			"--term-fg": "#ffffff",
			"--term-cursor": "#03edf9",
			"--term-selection-bg": "#ffffff20",
			"--ui-gray-800": "#241b2f",
			"--ui-gray-700": "#3b2b52",
			"--accent-primary": "#ff7edb",
			"--accent-primary-light": "#03edf9",
			"--accent-primary-lighter": "#fede5d",
			"--panel-bg": "#3b2b52",
			"--panel-border": "#6d3f8f",
			"--backdrop-darkest": "rgba(18, 10, 28, 0.58)",
			"--input-bg": "#262335",
			"--input-border": "#6d3f8f",
			"--pane-divider": "rgba(3,237,249,0.24)",
			"--pane-divider-hover": "rgba(255,126,219,0.42)",
		},
	},
	carbonfox: {
		default: {
			"--term-bg": "#161616",
			"--term-fg": "#f2f4f8",
			"--term-cursor": "#f2f4f8",
			"--term-selection-bg": "#2a2a2a88",
			"--ui-gray-900": "#0f0f0f",
			"--ui-gray-800": "#161616",
			"--ui-gray-700": "#262626",
			"--ui-gray-400": "#8d8d8d",
			"--accent-primary": "#78a9ff",
			"--accent-primary-light": "#be95ff",
			"--panel-bg": "#262626",
			"--panel-border": "#393939",
			"--backdrop-darkest": "rgba(0, 0, 0, 0.6)",
			"--input-bg": "#161616",
			"--input-border": "#393939",
			"--pane-divider": "rgba(120,169,255,0.22)",
			"--pane-divider-hover": "rgba(120,169,255,0.4)",
		},
	},
	flexoki: {
		dark: {
			"--term-bg": "#1C1B1A",
			"--term-fg": "#CECDC3",
			"--term-cursor": "#CECDC3",
			"--term-selection-bg": "#4385BE44",
			"--ui-gray-900": "#100F0F",
			"--ui-gray-800": "#1C1B1A",
			"--ui-gray-700": "#282726",
			"--ui-gray-400": "#878580",
			"--ui-gray-300": "#B7B5AC",
			"--accent-primary": "#4385BE",
			"--accent-primary-light": "#5B9BD5",
			"--accent-primary-lighter": "#7AB0E6",
			"--panel-bg": "#282726",
			"--panel-border": "#403E3C",
			"--backdrop-darkest": "rgba(16,15,15,0.52)",
			"--input-bg": "#1C1B1A",
			"--input-border": "#403E3C",
			"--pane-divider": "rgba(67,133,190,0.22)",
			"--pane-divider-hover": "rgba(67,133,190,0.4)",
		},
		light: {
			"--term-bg": "#FFFCF0",
			"--term-fg": "#100F0F",
			"--term-cursor": "#100F0F",
			"--term-selection-bg": "#4385BE33",
			"--ui-gray-900": "#100F0F",
			"--ui-gray-800": "#575653",
			"--ui-gray-700": "#878580",
			"--ui-gray-400": "#B7B5AC",
			"--ui-gray-300": "#DAD8CE",
			"--accent-primary": "#205EA6",
			"--accent-primary-light": "#3171B2",
			"--accent-primary-lighter": "#4385BE",
			"--panel-bg": "#F2F0E5",
			"--panel-border": "#DAD8CE",
			"--backdrop-darkest": "rgba(16,15,15,0.08)",
			"--input-bg": "#FFFCF0",
			"--input-border": "#DAD8CE",
			"--pane-divider": "rgba(67,133,190,0.22)",
			"--pane-divider-hover": "rgba(67,133,190,0.4)",
		},
	},
	miasma: {
		default: {
			"--term-bg": "#222222",
			"--term-fg": "#c2c2b0",
			"--term-cursor": "#c2c2b0",
			"--term-selection-bg": "#5f875f44",
			"--ui-gray-900": "#1a1a1a",
			"--ui-gray-800": "#222222",
			"--ui-gray-700": "#333333",
			"--ui-gray-400": "#666666",
			"--ui-gray-300": "#999999",
			"--accent-primary": "#5f875f",
			"--accent-primary-light": "#7ea17e",
			"--accent-primary-lighter": "#9dbb9d",
			"--panel-bg": "#2a2a2a",
			"--panel-border": "#444444",
			"--backdrop-darkest": "rgba(34,34,34,0.52)",
			"--input-bg": "#222222",
			"--input-border": "#444444",
			"--pane-divider": "rgba(95,135,95,0.22)",
			"--pane-divider-hover": "rgba(95,135,95,0.4)",
		},
	},
	vscode: {
		dark: {
			"--term-bg": "#1E1E1E",
			"--term-fg": "#D4D4D4",
			"--term-cursor": "#D4D4D4",
			"--term-selection-bg": "#007ACC44",
			"--ui-gray-900": "#141414",
			"--ui-gray-800": "#1E1E1E",
			"--ui-gray-700": "#252526",
			"--ui-gray-400": "#5A5A5A",
			"--ui-gray-300": "#CCCCCC",
			"--accent-primary": "#007ACC",
			"--accent-primary-light": "#1A8ADB",
			"--accent-primary-lighter": "#4DA6E8",
			"--panel-bg": "#252526",
			"--panel-border": "#3C3C3C",
			"--backdrop-darkest": "rgba(30,30,30,0.52)",
			"--input-bg": "#2D2D2D",
			"--input-border": "#3C3C3C",
			"--pane-divider": "rgba(0,122,204,0.22)",
			"--pane-divider-hover": "rgba(0,122,204,0.4)",
		},
		light: {
			"--term-bg": "#FFFFFF",
			"--term-fg": "#000000",
			"--term-cursor": "#000000",
			"--term-selection-bg": "#007ACC33",
			"--ui-gray-900": "#000000",
			"--ui-gray-800": "#6F6F6F",
			"--ui-gray-700": "#999999",
			"--ui-gray-400": "#CCCCCC",
			"--ui-gray-300": "#E8E8E8",
			"--accent-primary": "#007ACC",
			"--accent-primary-light": "#005A9E",
			"--accent-primary-lighter": "#004578",
			"--panel-bg": "#F3F3F3",
			"--panel-border": "#DDDDDD",
			"--backdrop-darkest": "rgba(0,0,0,0.08)",
			"--input-bg": "#FFFFFF",
			"--input-border": "#DDDDDD",
			"--pane-divider": "rgba(0,122,204,0.22)",
			"--pane-divider-hover": "rgba(0,122,204,0.4)",
		},
	},
};

/**
 * Deprecated `{name}-{variant}` ids (e.g. github-dark). One-way read migration only.
 */
const DEPRECATED_THEME_IDS: Record<string, { theme: string; variant: string }> =
	{
		"github-dark": { theme: "github", variant: "dark" },
		"github-light": { theme: "github", variant: "light" },
		"vscode-dark": { theme: "vscode", variant: "dark" },
		"vscode-light": { theme: "vscode", variant: "light" },
	};

/** Map deprecated theme ids to `{ theme, variant }`. */
export function normalizePaneThemePrefs(prefs: PaneThemePrefs): PaneThemePrefs {
	const legacy = DEPRECATED_THEME_IDS[prefs.ui_theme];
	if (!legacy) {
		return {
			ui_theme: prefs.ui_theme,
			ui_theme_variant: prefs.ui_theme_variant || "default",
		};
	}
	const variant =
		!prefs.ui_theme_variant || prefs.ui_theme_variant === "default"
			? legacy.variant
			: prefs.ui_theme_variant;
	return { ui_theme: legacy.theme, ui_theme_variant: variant };
}

type ThemeInfo = {
	name: string;
	colors: Record<string, string>;
	prefs: Record<string, unknown> | null;
};

const customThemeVarsCache: Record<string, ThemeCssVars> = {};
const themePrefsCache: Record<string, Record<string, unknown>> = {};
let customThemesReady: Promise<void> | null = null;

function usesCustomThemeId(themeId: string | null | undefined): boolean {
	return (themeId ?? "").startsWith("custom:");
}

export function prefsNeedCustomThemes(
	uiPrefs: UiThemePrefs,
	paneThemes?: Iterable<PaneThemePrefs | null | undefined>,
): boolean {
	if (usesCustomThemeId(uiPrefs.ui_theme)) return true;
	if (!paneThemes) return false;
	for (const prefs of paneThemes) {
		if (prefs && usesCustomThemeId(prefs.ui_theme)) return true;
	}
	return false;
}

export function ensureCustomThemesLoaded(): Promise<void> {
	if (!customThemesReady) {
		customThemesReady = loadCustomThemesIntoCache();
	}
	return customThemesReady;
}

/** Reload disk themes (after save/delete); updates the lazy-load cache. */
export async function reloadCustomThemesIntoCache(): Promise<void> {
	customThemesReady = loadCustomThemesIntoCache();
	await customThemesReady;
}

export async function loadCustomThemesIntoCache(): Promise<void> {
	for (const k of Object.keys(customThemeVarsCache)) {
		delete customThemeVarsCache[k];
	}
	for (const k of Object.keys(themePrefsCache)) {
		delete themePrefsCache[k];
	}
	try {
		const names = await invoke<string[]>("list_themes");
		const themes = await Promise.all(
			names.map((name) => invoke<ThemeInfo>("read_theme", { name })),
		);
		for (let i = 0; i < names.length; i++) {
			const info = themes[i];
			if (info.colors && Object.keys(info.colors).length) {
				customThemeVarsCache[names[i]] = info.colors;
			}
			if (info.prefs) {
				themePrefsCache[names[i]] = info.prefs;
			}
		}
	} catch {
		/* ignore */
	}
}

export function getThemePrefsCache(): Record<string, Record<string, unknown>> {
	return themePrefsCache;
}

const INHERITED_THEME_KEYS = new Set([
	"ui_theme",
	"ui_theme_variant",
	"font_terminal",
	"font_ui",
]);

export function pickUiPrefs(prefs: Record<string, unknown>): UiThemePrefs {
	const normalized = normalizePaneThemePrefs({
		ui_theme: typeof prefs.ui_theme === "string" ? prefs.ui_theme : "system",
		ui_theme_variant:
			typeof prefs.ui_theme_variant === "string"
				? prefs.ui_theme_variant
				: "default",
	});
	return {
		ui_theme: normalized.ui_theme,
		ui_theme_variant: normalized.ui_theme_variant,
		font_terminal:
			typeof prefs.font_terminal === "string" ? prefs.font_terminal : "",
		font_ui: typeof prefs.font_ui === "string" ? prefs.font_ui : "",
	};
}

export function uiPrefsChanged(a: UiThemePrefs, b: UiThemePrefs): boolean {
	for (const k of INHERITED_THEME_KEYS) {
		if (a[k as keyof UiThemePrefs] !== b[k as keyof UiThemePrefs]) return true;
	}
	return false;
}

function resolvePreset(themeId: string, variant: string): ThemeCssVars {
	const { ui_theme: id, ui_theme_variant: variantId } = normalizePaneThemePrefs(
		{
			ui_theme: themeId,
			ui_theme_variant: variant,
		},
	);
	if (id.startsWith("custom:")) {
		const slug = id.slice(7);
		const c = customThemeVarsCache[slug];
		if (c && Object.keys(c).length > 0) return { ...c };
		return PRESETS.tokyonight.default;
	}
	const t = PRESETS[id];
	if (!t) return PRESETS.tokyonight.default;
	const preferred = variantId || "default";
	const v = t[preferred] ? preferred : defaultVariantForTheme(id);
	return t[v] ?? t.default ?? PRESETS.tokyonight.default;
}

function parseCssColorToRgb(s: string): [number, number, number] | null {
	const t = s.trim();
	const hex = t.match(HEX_COLOR_RE);
	if (hex) {
		const n = Number.parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const rgb = t.match(RGB_COLOR_RE);
	if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
	return null;
}

/** sRGB relative luminance 0–1 */
function relLuminance(rgb: [number, number, number]): number {
	const lin = rgb.map((c) => {
		const x = c / 255;
		return x <= 0.039_28 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG relative luminance contrast ratio (≥4.5 is readable body text). */
function luminanceContrast(
	a: [number, number, number],
	b: [number, number, number],
): number {
	const la = relLuminance(a) + 0.05;
	const lb = relLuminance(b) + 0.05;
	return la > lb ? la / lb : lb / la;
}

function toHex(c: [number, number, number]): string {
	return `#${c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
}

function termBackgroundRgb(): [number, number, number] | null {
	const bgStr = getComputedStyle(document.documentElement)
		.getPropertyValue("--term-bg")
		.trim();
	return parseCssColorToRgb(bgStr);
}

function isLightBackground(rgb: [number, number, number]): boolean {
	return relLuminance(rgb) > 0.45;
}

type AnsiPalette = Pick<
	ITheme,
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "brightBlack"
	| "brightRed"
	| "brightGreen"
	| "brightYellow"
	| "brightBlue"
	| "brightMagenta"
	| "brightCyan"
	| "brightWhite"
>;

/**
 * Canonical terminal ANSI palettes for named themes. Sources are the official
 * theme repositories / their published terminal ports (see test for citations).
 * `system`, `custom:*`, and `matrix` fall back to the generic dark/light remap.
 */
const ANSI_PRESETS: Record<string, Record<string, AnsiPalette>> = {
	tokyonight: {
		default: {
			black: "#15161e",
			red: "#f7768e",
			green: "#9ece6a",
			yellow: "#e0af68",
			blue: "#7aa2f7",
			magenta: "#bb9af7",
			cyan: "#7dcfff",
			white: "#a9b1d6",
			brightBlack: "#414868",
			brightRed: "#ff7a93",
			brightGreen: "#b9f27c",
			brightYellow: "#ff9e64",
			brightBlue: "#7da6ff",
			brightMagenta: "#bb9af7",
			brightCyan: "#0db9d7",
			brightWhite: "#c0caf5",
		},
	},
	everforest: {
		default: {
			black: "#475258",
			red: "#e67e80",
			green: "#a7c080",
			yellow: "#dbbc7f",
			blue: "#7fbbb3",
			magenta: "#d699b6",
			cyan: "#83c092",
			white: "#d3c6aa",
			brightBlack: "#475258",
			brightRed: "#e67e80",
			brightGreen: "#a7c080",
			brightYellow: "#dbbc7f",
			brightBlue: "#7fbbb3",
			brightMagenta: "#d699b6",
			brightCyan: "#83c092",
			brightWhite: "#d3c6aa",
		},
	},
	ayu: {
		default: {
			black: "#01060E",
			red: "#EA6C73",
			green: "#91B362",
			yellow: "#F9AF4F",
			blue: "#53BDFA",
			magenta: "#FAE994",
			cyan: "#90E1C6",
			white: "#C7C7C7",
			brightBlack: "#686868",
			brightRed: "#F07178",
			brightGreen: "#C2D94C",
			brightYellow: "#FFB454",
			brightBlue: "#59C2FF",
			brightMagenta: "#FFEE99",
			brightCyan: "#95E6CB",
			brightWhite: "#FFFFFF",
		},
	},
	catppuccin: {
		mocha: {
			black: "#45475a",
			red: "#f38ba8",
			green: "#a6e3a1",
			yellow: "#f9e2af",
			blue: "#89b4fa",
			magenta: "#f5c2e7",
			cyan: "#94e2d5",
			white: "#a6adc8",
			brightBlack: "#585b70",
			brightRed: "#f37799",
			brightGreen: "#89d88b",
			brightYellow: "#ebd391",
			brightBlue: "#74a8fc",
			brightMagenta: "#f2aede",
			brightCyan: "#6bd7ca",
			brightWhite: "#bac2de",
		},
		macchiato: {
			black: "#494d64",
			red: "#ed8796",
			green: "#a6da95",
			yellow: "#eed49f",
			blue: "#8aadf4",
			magenta: "#f5bde6",
			cyan: "#8bd5ca",
			white: "#a5adcb",
			brightBlack: "#5b6078",
			brightRed: "#ec7486",
			brightGreen: "#8ccf7f",
			brightYellow: "#e1c682",
			brightBlue: "#78a1f6",
			brightMagenta: "#f2a9dd",
			brightCyan: "#63cbc0",
			brightWhite: "#b8c0e0",
		},
		frappe: {
			black: "#51576d",
			red: "#e78284",
			green: "#a6d189",
			yellow: "#e5c890",
			blue: "#8caaee",
			magenta: "#f4b8e4",
			cyan: "#81c8be",
			white: "#a5adce",
			brightBlack: "#626880",
			brightRed: "#e67172",
			brightGreen: "#8ec772",
			brightYellow: "#d9ba73",
			brightBlue: "#7b9ef0",
			brightMagenta: "#f2a4db",
			brightCyan: "#5abfb5",
			brightWhite: "#b5bfe2",
		},
		latte: {
			black: "#5c5f77",
			red: "#d20f39",
			green: "#40a02b",
			yellow: "#df8e1d",
			blue: "#1e66f5",
			magenta: "#ea76cb",
			cyan: "#179299",
			white: "#acb0be",
			brightBlack: "#6c6f85",
			brightRed: "#de293e",
			brightGreen: "#49af3d",
			brightYellow: "#eea02d",
			brightBlue: "#456eff",
			brightMagenta: "#fe85d8",
			brightCyan: "#2d9fa8",
			brightWhite: "#bcc0cc",
		},
	},
	gruvbox: {
		soft_dark: {
			black: "#32302f",
			red: "#cc241d",
			green: "#98971a",
			yellow: "#d79921",
			blue: "#458588",
			magenta: "#b16286",
			cyan: "#689d6a",
			white: "#a89984",
			brightBlack: "#928374",
			brightRed: "#fb4934",
			brightGreen: "#b8bb26",
			brightYellow: "#fabd2f",
			brightBlue: "#83a598",
			brightMagenta: "#d3869b",
			brightCyan: "#8ec07c",
			brightWhite: "#ebdbb2",
		},
		hard_dark: {
			black: "#1d2021",
			red: "#cc241d",
			green: "#98971a",
			yellow: "#d79921",
			blue: "#458588",
			magenta: "#b16286",
			cyan: "#689d6a",
			white: "#a89984",
			brightBlack: "#928374",
			brightRed: "#fb4934",
			brightGreen: "#b8bb26",
			brightYellow: "#fabd2f",
			brightBlue: "#83a598",
			brightMagenta: "#d3869b",
			brightCyan: "#8ec07c",
			brightWhite: "#ebdbb2",
		},
		soft_light: {
			black: "#f2e5bc",
			red: "#cc241d",
			green: "#98971a",
			yellow: "#d79921",
			blue: "#458588",
			magenta: "#b16286",
			cyan: "#689d6a",
			white: "#7c6f64",
			brightBlack: "#928374",
			brightRed: "#9d0006",
			brightGreen: "#79740e",
			brightYellow: "#b57614",
			brightBlue: "#076678",
			brightMagenta: "#8f3f71",
			brightCyan: "#427b58",
			brightWhite: "#3c3836",
		},
		hard_light: {
			black: "#f9f5d7",
			red: "#cc241d",
			green: "#98971a",
			yellow: "#d79921",
			blue: "#458588",
			magenta: "#b16286",
			cyan: "#689d6a",
			white: "#7c6f64",
			brightBlack: "#928374",
			brightRed: "#9d0006",
			brightGreen: "#79740e",
			brightYellow: "#b57614",
			brightBlue: "#076678",
			brightMagenta: "#8f3f71",
			brightCyan: "#427b58",
			brightWhite: "#3c3836",
		},
	},
	kanagawa: {
		default: {
			black: "#090618",
			red: "#c34043",
			green: "#76946a",
			yellow: "#c0a36e",
			blue: "#7e9cd8",
			magenta: "#957fb8",
			cyan: "#6a9589",
			white: "#c8c093",
			brightBlack: "#727169",
			brightRed: "#e82424",
			brightGreen: "#98bb6c",
			brightYellow: "#e6c384",
			brightBlue: "#7fb4ca",
			brightMagenta: "#938aa9",
			brightCyan: "#7aa89f",
			brightWhite: "#dcd7ba",
		},
	},
	nord: {
		default: {
			black: "#3b4252",
			red: "#bf616a",
			green: "#a3be8c",
			yellow: "#ebcb8b",
			blue: "#81a1c1",
			magenta: "#b48ead",
			cyan: "#88c0d0",
			white: "#e5e9f0",
			brightBlack: "#4c566a",
			brightRed: "#bf616a",
			brightGreen: "#a3be8c",
			brightYellow: "#ebcb8b",
			brightBlue: "#81a1c1",
			brightMagenta: "#b48ead",
			brightCyan: "#8fbcbb",
			brightWhite: "#eceff4",
		},
	},
	"one-dark": {
		default: {
			black: "#000000",
			red: "#e06c75",
			green: "#98c379",
			yellow: "#e5c07b",
			blue: "#61afef",
			magenta: "#c678dd",
			cyan: "#56b6c2",
			white: "#abb2bf",
			brightBlack: "#5c6370",
			brightRed: "#e06c75",
			brightGreen: "#98c379",
			brightYellow: "#e5c07b",
			brightBlue: "#61afef",
			brightMagenta: "#c678dd",
			brightCyan: "#56b6c2",
			brightWhite: "#ffffff",
		},
	},
	dracula: {
		default: {
			black: "#21222c",
			red: "#ff5555",
			green: "#50fa7b",
			yellow: "#f1fa8c",
			blue: "#bd93f9",
			magenta: "#ff79c6",
			cyan: "#8be9fd",
			white: "#f8f8f2",
			brightBlack: "#6272a4",
			brightRed: "#ff6e6e",
			brightGreen: "#69ff94",
			brightYellow: "#ffffa5",
			brightBlue: "#d6acff",
			brightMagenta: "#ff92df",
			brightCyan: "#a4ffff",
			brightWhite: "#ffffff",
		},
	},
	solarized: {
		dark: {
			black: "#073642",
			red: "#dc322f",
			green: "#859900",
			yellow: "#b58900",
			blue: "#268bd2",
			magenta: "#d33682",
			cyan: "#2aa198",
			white: "#eee8d5",
			brightBlack: "#002b36",
			brightRed: "#cb4b16",
			brightGreen: "#586e75",
			brightYellow: "#657b83",
			brightBlue: "#839496",
			brightMagenta: "#6c71c4",
			brightCyan: "#93a1a1",
			brightWhite: "#fdf6e3",
		},
		light: {
			black: "#073642",
			red: "#dc322f",
			green: "#859900",
			yellow: "#b58900",
			blue: "#268bd2",
			magenta: "#d33682",
			cyan: "#2aa198",
			white: "#eee8d5",
			brightBlack: "#002b36",
			brightRed: "#cb4b16",
			brightGreen: "#586e75",
			brightYellow: "#657b83",
			brightBlue: "#839496",
			brightMagenta: "#6c71c4",
			brightCyan: "#93a1a1",
			brightWhite: "#fdf6e3",
		},
	},
	"rose-pine": {
		default: {
			black: "#26233a",
			red: "#eb6f92",
			green: "#31748f",
			yellow: "#f6c177",
			blue: "#9ccfd8",
			magenta: "#c4a7e7",
			cyan: "#ebbcba",
			white: "#e0def4",
			brightBlack: "#6e6a86",
			brightRed: "#eb6f92",
			brightGreen: "#31748f",
			brightYellow: "#f6c177",
			brightBlue: "#9ccfd8",
			brightMagenta: "#c4a7e7",
			brightCyan: "#ebbcba",
			brightWhite: "#e0def4",
		},
	},
	palenight: {
		default: {
			black: "#292d3e",
			red: "#f07178",
			green: "#c3e88d",
			yellow: "#ffcb6b",
			blue: "#82aaff",
			magenta: "#c792ea",
			cyan: "#89ddff",
			white: "#d0d0d0",
			brightBlack: "#676e95",
			brightRed: "#f07178",
			brightGreen: "#c3e88d",
			brightYellow: "#ffcb6b",
			brightBlue: "#82aaff",
			brightMagenta: "#c792ea",
			brightCyan: "#89ddff",
			brightWhite: "#ffffff",
		},
	},
	monokai: {
		default: {
			black: "#272822",
			red: "#f92672",
			green: "#a6e22e",
			yellow: "#f4bf75",
			blue: "#66d9ef",
			magenta: "#ae81ff",
			cyan: "#a1efe4",
			white: "#f8f8f2",
			brightBlack: "#75715e",
			brightRed: "#f92672",
			brightGreen: "#a6e22e",
			brightYellow: "#f4bf75",
			brightBlue: "#66d9ef",
			brightMagenta: "#ae81ff",
			brightCyan: "#a1efe4",
			brightWhite: "#f9f8f5",
		},
	},
	github: {
		dark: {
			black: "#484f58",
			red: "#ff7b72",
			green: "#3fb950",
			yellow: "#d29922",
			blue: "#58a6ff",
			magenta: "#bc8cff",
			cyan: "#39c5cf",
			white: "#b1bac4",
			brightBlack: "#6e7681",
			brightRed: "#ffa198",
			brightGreen: "#56d364",
			brightYellow: "#e3b341",
			brightBlue: "#79c0ff",
			brightMagenta: "#d2a8ff",
			brightCyan: "#56d4dd",
			brightWhite: "#f0f6fc",
		},
		light: {
			black: "#24292f",
			red: "#cf222e",
			green: "#116329",
			yellow: "#4d2d00",
			blue: "#0969da",
			magenta: "#8250df",
			cyan: "#1b7c83",
			white: "#6e7781",
			brightBlack: "#57606a",
			brightRed: "#a40e26",
			brightGreen: "#1a7f37",
			brightYellow: "#633c01",
			brightBlue: "#218bff",
			brightMagenta: "#a475f9",
			brightCyan: "#3192aa",
			brightWhite: "#8c959f",
		},
	},
	"night-owl": {
		default: {
			black: "#011627",
			red: "#ef5350",
			green: "#22da6e",
			yellow: "#addb67",
			blue: "#82aaff",
			magenta: "#c792ea",
			cyan: "#21c7a8",
			white: "#ffffff",
			brightBlack: "#575656",
			brightRed: "#ef5350",
			brightGreen: "#22da6e",
			brightYellow: "#ffeb95",
			brightBlue: "#82aaff",
			brightMagenta: "#c792ea",
			brightCyan: "#7fdbca",
			brightWhite: "#ffffff",
		},
	},
	"synthwave-84": {
		default: {
			black: "#000000",
			red: "#fe4450",
			green: "#72f1b8",
			yellow: "#f97e72",
			blue: "#03edf9",
			magenta: "#ff7edb",
			cyan: "#03edf9",
			white: "#ffffff",
			brightBlack: "#888888",
			brightRed: "#fe4450",
			brightGreen: "#72f1b8",
			brightYellow: "#fede5d",
			brightBlue: "#03edf9",
			brightMagenta: "#ff7edb",
			brightCyan: "#03edf9",
			brightWhite: "#ffffff",
		},
	},
	carbonfox: {
		default: {
			black: "#161616",
			red: "#fa4d56",
			green: "#42be65",
			yellow: "#f1c21b",
			blue: "#78a9ff",
			magenta: "#be95ff",
			cyan: "#33b1ff",
			white: "#f2f4f8",
			brightBlack: "#525252",
			brightRed: "#fa4d56",
			brightGreen: "#42be65",
			brightYellow: "#f1c21b",
			brightBlue: "#78a9ff",
			brightMagenta: "#be95ff",
			brightCyan: "#33b1ff",
			brightWhite: "#ffffff",
		},
	},
	flexoki: {
		dark: {
			black: "#100F0F",
			red: "#AF3029",
			green: "#66800B",
			yellow: "#AD8301",
			blue: "#205EA6",
			magenta: "#A02F6F",
			cyan: "#24837B",
			white: "#FFFCF0",
			brightBlack: "#100F0F",
			brightRed: "#D14D41",
			brightGreen: "#879A39",
			brightYellow: "#D0A215",
			brightBlue: "#4385BE",
			brightMagenta: "#CE5D97",
			brightCyan: "#3AA99F",
			brightWhite: "#FFFCF0",
		},
		light: {
			black: "#100F0F",
			red: "#D14D41",
			green: "#879A39",
			yellow: "#D0A215",
			blue: "#4385BE",
			magenta: "#CE5D97",
			cyan: "#3AA99F",
			white: "#FFFCF0",
			brightBlack: "#100F0F",
			brightRed: "#D14D41",
			brightGreen: "#879A39",
			brightYellow: "#D0A215",
			brightBlue: "#4385BE",
			brightMagenta: "#CE5D97",
			brightCyan: "#3AA99F",
			brightWhite: "#FFFCF0",
		},
	},
	miasma: {
		default: {
			black: "#222222",
			red: "#685742",
			green: "#5f875f",
			yellow: "#b36d43",
			blue: "#78824b",
			magenta: "#bb7744",
			cyan: "#c9a554",
			white: "#d7c483",
			brightBlack: "#666666",
			brightRed: "#685742",
			brightGreen: "#5f875f",
			brightYellow: "#b36d43",
			brightBlue: "#78824b",
			brightMagenta: "#bb7744",
			brightCyan: "#c9a554",
			brightWhite: "#d7c483",
		},
	},
	vscode: {
		dark: {
			black: "#000000",
			red: "#cd3131",
			green: "#0dbc79",
			yellow: "#e5e510",
			blue: "#2472c8",
			magenta: "#bc3fbc",
			cyan: "#11a8cd",
			white: "#e5e5e5",
			brightBlack: "#666666",
			brightRed: "#f14c4c",
			brightGreen: "#23d18b",
			brightYellow: "#f5f543",
			brightBlue: "#3b8eea",
			brightMagenta: "#d670d6",
			brightCyan: "#29b8db",
			brightWhite: "#e5e5e5",
		},
		light: {
			black: "#000000",
			red: "#cd3131",
			green: "#107c10",
			yellow: "#949800",
			blue: "#0451a5",
			magenta: "#bc05bc",
			cyan: "#0598bc",
			white: "#555555",
			brightBlack: "#666666",
			brightRed: "#cd3131",
			brightGreen: "#14ce14",
			brightYellow: "#b5ba00",
			brightBlue: "#0451a5",
			brightMagenta: "#bc05bc",
			brightCyan: "#0598bc",
			brightWhite: "#a5a5a5",
		},
	},
};

/** Canonical ANSI palette for a named theme variant, or null to use the fallback. */
function resolveAnsi(themeId: string, variant: string): AnsiPalette | null {
	const { ui_theme: id, ui_theme_variant: variantId } = normalizePaneThemePrefs(
		{
			ui_theme: themeId,
			ui_theme_variant: variant,
		},
	);
	const t = ANSI_PRESETS[id];
	if (!t) return null;
	const preferred = variantId || "default";
	const v = t[preferred] ? preferred : defaultVariantForTheme(id);
	return t[v] ?? t.default ?? null;
}

/** xterm defaults assume a dark canvas; light themes need a full ANSI remap. */
const XTERM_ANSI_DARK: Pick<
	ITheme,
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "brightBlack"
	| "brightRed"
	| "brightGreen"
	| "brightYellow"
	| "brightBlue"
	| "brightMagenta"
	| "brightCyan"
	| "brightWhite"
> = {
	black: "#000000",
	red: "#cd3131",
	green: "#0dbc79",
	yellow: "#e5e510",
	blue: "#2472c8",
	magenta: "#bc3fbc",
	cyan: "#11a8cd",
	white: "#e5e5e5",
	brightBlack: "#666666",
	brightRed: "#f14c4c",
	brightGreen: "#23d18b",
	brightYellow: "#f5f543",
	brightBlue: "#3b8eea",
	brightMagenta: "#d670d6",
	brightCyan: "#29b8db",
	brightWhite: "#e5e5e5",
};

const XTERM_ANSI_LIGHT: typeof XTERM_ANSI_DARK = {
	black: "#383a42",
	red: "#c01c28",
	green: "#2a7f3e",
	yellow: "#8a5b00",
	blue: "#1f5fd0",
	magenta: "#8b2fa6",
	cyan: "#0b6e8a",
	white: "#4a4a4a",
	brightBlack: "#5c5c5c",
	brightRed: "#b91c1c",
	brightGreen: "#166534",
	brightYellow: "#854d0e",
	brightBlue: "#1d4ed8",
	brightMagenta: "#7e22ce",
	brightCyan: "#0e7490",
	brightWhite: "#18181b",
};

const TERM_BG_FALLBACK = "#2e2e32";
const TERM_FG_FALLBACK = "#d4d4d8";
const TERM_CURSOR_FALLBACK = "#e8e8ec";
const TERM_SELECTION_BG_FALLBACK = "#6b6b7866";

/** Build a complete xterm theme (incl. ANSI) from current CSS variables. */
export function buildXtermThemeFromDocument(): ITheme {
	const cs = getComputedStyle(document.documentElement);
	const bg = cs.getPropertyValue("--term-bg").trim() || TERM_BG_FALLBACK;
	const fg = cs.getPropertyValue("--term-fg").trim() || TERM_FG_FALLBACK;
	const cursor =
		cs.getPropertyValue("--term-cursor").trim() || TERM_CURSOR_FALLBACK;
	const sel =
		cs.getPropertyValue("--term-selection-bg").trim() ||
		TERM_SELECTION_BG_FALLBACK;
	const bgRgb = parseCssColorToRgb(bg);
	const { theme: themeId, themeVariant } = document.documentElement.dataset;
	const ansi =
		(themeId ? resolveAnsi(themeId, themeVariant ?? "default") : null) ??
		(bgRgb && isLightBackground(bgRgb) ? XTERM_ANSI_LIGHT : XTERM_ANSI_DARK);
	return {
		background: bg,
		foreground: fg,
		cursor,
		cursorAccent: bg,
		selectionBackground: sel,
		...ansi,
	};
}

export function buildXtermThemeFromPrefs(prefs: PaneThemePrefs): ITheme {
	if (!prefs.ui_theme || prefs.ui_theme === "system")
		return buildXtermThemeFromDocument();
	const vars = resolvePreset(prefs.ui_theme, prefs.ui_theme_variant);
	const bg = vars["--term-bg"] || TERM_BG_FALLBACK;
	const fg = vars["--term-fg"] || TERM_FG_FALLBACK;
	const cursor = vars["--term-cursor"] || TERM_CURSOR_FALLBACK;
	const sel = vars["--term-selection-bg"] || TERM_SELECTION_BG_FALLBACK;
	const bgRgb = parseCssColorToRgb(bg);
	const ansi =
		resolveAnsi(prefs.ui_theme, prefs.ui_theme_variant) ??
		(bgRgb && isLightBackground(bgRgb) ? XTERM_ANSI_LIGHT : XTERM_ANSI_DARK);
	return {
		background: bg,
		foreground: fg,
		cursor,
		cursorAccent: bg,
		selectionBackground: sel,
		...ansi,
	};
}

export function themeCssVarsForPrefs(prefs: PaneThemePrefs): ThemeCssVars {
	if (!prefs.ui_theme || prefs.ui_theme === "system") return {};
	return resolvePreset(prefs.ui_theme, prefs.ui_theme_variant);
}

/** Remap neutral grays + hover overlays for light vs dark chrome. */
function syncUiGrayScale(): void {
	const root = document.documentElement;
	const bgRgb = termBackgroundRgb();
	if (!bgRgb) return;
	const light = isLightBackground(bgRgb);
	root.dataset.luminance = light ? "light" : "dark";

	const grayKeys = [
		"50",
		"100",
		"200",
		"300",
		"400",
		"500",
		"600",
		"700",
		"800",
		"900",
	] as const;
	if (!light) {
		for (const n of grayKeys) root.style.removeProperty(`--ui-gray-${n}`);
		root.style.removeProperty("--hover-overlay");
		root.style.removeProperty("--hover-overlay-light");
		return;
	}

	root.style.setProperty("--ui-gray-50", "#f8fafc");
	root.style.setProperty("--ui-gray-100", "#0f172a");
	root.style.setProperty("--ui-gray-200", "#1e293b");
	root.style.setProperty("--ui-gray-300", "#334155");
	root.style.setProperty("--ui-gray-400", "#475569");
	root.style.setProperty("--ui-gray-500", "#64748b");
	root.style.setProperty("--ui-gray-600", "#94a3b8");
	root.style.setProperty("--ui-gray-700", "#cbd5e1");
	root.style.setProperty("--ui-gray-800", "#e2e8f0");
	root.style.setProperty("--ui-gray-900", "#f1f5f9");
	root.style.setProperty("--hover-overlay", "rgba(0, 0, 0, 0.06)");
	root.style.setProperty("--hover-overlay-light", "rgba(0, 0, 0, 0.04)");
}

/**
 * Panel / modal label text: derive from `--panel-bg` when set (theme presets), else `--term-bg`.
 */
function syncUiChromeTextColors(): void {
	const root = document.documentElement;
	const cs = getComputedStyle(root);
	const panelBg = cs.getPropertyValue("--panel-bg").trim();
	const termBg = cs.getPropertyValue("--term-bg").trim();
	const rgb = parseCssColorToRgb(panelBg) ?? parseCssColorToRgb(termBg);
	if (!rgb) return;
	const lum = relLuminance(rgb);
	const lightPanel = lum > 0.42;
	const fgLight: [number, number, number] = [249, 250, 251];
	const fgDark: [number, number, number] = [17, 24, 39];
	const pickFg = lightPanel ? fgDark : fgLight;
	const mutedLight: [number, number, number] = [209, 213, 219];
	const mutedDark: [number, number, number] = [55, 65, 81];
	const faintLight: [number, number, number] = [156, 163, 175];
	const faintDark: [number, number, number] = [75, 85, 99];
	let fg = pickFg;
	let muted = lightPanel ? mutedDark : mutedLight;
	let faint = lightPanel ? faintDark : faintLight;
	if (lightPanel) {
		if (relLuminance(fg) > 0.28 || luminanceContrast(rgb, fg) < 7)
			fg = [15, 23, 42];
		if (relLuminance(muted) > 0.35 || luminanceContrast(rgb, muted) < 4.5)
			muted = [31, 41, 55];
		if (relLuminance(faint) > 0.42 || luminanceContrast(rgb, faint) < 3.2)
			faint = [55, 65, 81];
	} else if (luminanceContrast(rgb, fg) < 5.0) {
		fg = [254, 254, 255];
		muted = [229, 231, 235];
		faint = [163, 163, 163];
	}
	root.style.setProperty("--ui-chrome-fg", toHex(fg));
	root.style.setProperty("--ui-chrome-muted", toHex(muted));
	root.style.setProperty("--ui-chrome-fainter", toHex(faint));
}

/** Input / select text: readable on `--input-bg` (fixes light presets leaving `--input-text` from dark defaults). */
function syncInputTextColor(): void {
	const root = document.documentElement;
	const cs = getComputedStyle(root);
	const bgStr =
		cs.getPropertyValue("--input-bg").trim() ||
		cs.getPropertyValue("--term-bg").trim();
	const rgb = parseCssColorToRgb(bgStr);
	if (!rgb) return;
	const lum = relLuminance(rgb);
	const lightIn = lum > 0.42;
	let fg: [number, number, number] = lightIn ? [17, 24, 39] : [249, 250, 251];
	if (lightIn) {
		if (relLuminance(fg) > 0.28 || luminanceContrast(rgb, fg) < 7)
			fg = [15, 23, 42];
	} else if (luminanceContrast(rgb, fg) < 5.0) {
		fg = [254, 254, 255];
	}
	root.style.setProperty("--input-text", toHex(fg));
}

/**
 * Named/built-in themes ship canonical terminal foreground/cursor colors that
 * must match between the document (app chrome) and per-pane xterm themes. Only
 * `system` and user `custom:` themes derive contrast-safe terminal colors.
 */
export function themeUsesCanonicalTerminalColors(themeId: string): boolean {
	const { ui_theme: id } = normalizePaneThemePrefs({
		ui_theme: themeId,
		ui_theme_variant: "default",
	});
	return id !== "system" && !id.startsWith("custom:") && Boolean(PRESETS[id]);
}

/** Ensures `--term-fg` / `--term-cursor` read clearly on `--term-bg` (fixes washed-out pairs). */
function syncTerminalFgContrast(): void {
	const root = document.documentElement;
	const cs = getComputedStyle(root);
	const bgStr = cs.getPropertyValue("--term-bg").trim();
	const fgStr = cs.getPropertyValue("--term-fg").trim();
	const bg = parseCssColorToRgb(bgStr);
	const fg = parseCssColorToRgb(fgStr);
	if (!(bg && fg)) return;
	const lumBg = relLuminance(bg);
	const lumFg = relLuminance(fg);
	const lightBg = lumBg > 0.45;
	const needsFix = lightBg
		? lumFg > 0.28 || luminanceContrast(bg, fg) < 7
		: lumFg < 0.65 || luminanceContrast(bg, fg) < 7;
	if (!needsFix) return;

	const next = toHex(lightBg ? [24, 24, 27] : [248, 250, 252]);
	root.style.setProperty("--term-fg", next);
	const cursorRgb = parseCssColorToRgb(
		cs.getPropertyValue("--term-cursor").trim(),
	);
	const cursorOk =
		cursorRgb &&
		(lightBg
			? relLuminance(cursorRgb) <= 0.35 &&
				luminanceContrast(bg, cursorRgb) >= 4.5
			: relLuminance(cursorRgb) >= 0.6 &&
				luminanceContrast(bg, cursorRgb) >= 4.5);
	if (!cursorOk) root.style.setProperty("--term-cursor", next);
}

/** Apply theme + fonts. Call after DOM ready; safe to call again when prefs change. */
export function applyUiTheme(prefs: UiThemePrefs): void {
	const root = document.documentElement;
	root.dataset.theme = prefs.ui_theme || "system";
	root.dataset.themeVariant = prefs.ui_theme_variant || "default";

	const terminalFont = prefs.font_terminal.trim();
	if (terminalFont) root.style.setProperty("--font-terminal", terminalFont);
	else root.style.removeProperty("--font-terminal");

	const uiFont = prefs.font_ui.trim();
	if (uiFont) root.style.setProperty("--font-ui", uiFont);
	else root.style.removeProperty("--font-ui");

	const clearThemeVars = (): void => {
		const toClear: string[] = [];
		for (let i = root.style.length - 1; i >= 0; i--) {
			const name = root.style.item(i);
			if (
				name.startsWith("--term-") ||
				name.startsWith("--ui-gray") ||
				name.startsWith("--ui-chrome") ||
				name.startsWith("--accent-") ||
				name.startsWith("--panel-") ||
				name.startsWith("--backdrop-") ||
				name.startsWith("--input-") ||
				name.startsWith("--pane-divider")
			) {
				toClear.push(name);
			}
		}
		for (const n of toClear) root.style.removeProperty(n);
	};

	clearThemeVars();

	if (prefs.ui_theme === "system") {
		syncUiGrayScale();
		syncUiChromeTextColors();
		syncInputTextColor();
		syncTerminalFgContrast();
		return;
	}

	const preset = resolvePreset(prefs.ui_theme, prefs.ui_theme_variant);
	for (const [k, v] of Object.entries(preset)) {
		root.style.setProperty(k, v);
	}
	syncUiGrayScale();
	syncUiChromeTextColors();
	syncInputTextColor();
	// Built-in themes keep their canonical terminal foreground/cursor so the
	// document chrome and per-pane xterm themes never diverge; only fallback
	// (system/custom) palettes get the readability correction.
	if (!themeUsesCanonicalTerminalColors(prefs.ui_theme))
		syncTerminalFgContrast();
}

/** Theme metadata for settings UI */
export const THEME_OPTIONS: {
	id: string;
	label: string;
	description: string;
	variants: { id: string; label: string }[];
}[] = [
	{
		id: "system",
		label: "System",
		description: "Chrome follows terminal background colors",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "tokyonight",
		label: "Tokyo Night",
		description: "Popular dark Neovim theme",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "everforest",
		label: "Everforest",
		description: "Forest-inspired palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "ayu",
		label: "Ayu",
		description: "Ayu dark",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "catppuccin",
		label: "Catppuccin",
		description: "Soothing pastel theme",
		variants: [
			{ id: "mocha", label: "Mocha" },
			{ id: "macchiato", label: "Macchiato" },
			{ id: "frappe", label: "Frappé" },
			{ id: "latte", label: "Latte" },
		],
	},
	{
		id: "gruvbox",
		label: "Gruvbox",
		description: "Retro contrast",
		variants: [
			{ id: "soft_dark", label: "Soft dark" },
			{ id: "hard_dark", label: "Hard dark" },
			{ id: "soft_light", label: "Soft light" },
			{ id: "hard_light", label: "Hard light" },
		],
	},
	{
		id: "kanagawa",
		label: "Kanagawa",
		description: "Ink-inspired dark",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "nord",
		label: "Nord",
		description: "Arctic palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "matrix",
		label: "Matrix",
		description: "Green-on-black terminal aesthetic",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "one-dark",
		label: "One Dark",
		description: "Atom One Dark",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "dracula",
		label: "Dracula",
		description: "Dracula palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "solarized",
		label: "Solarized",
		description: "Classic precision palette",
		variants: [
			{ id: "dark", label: "Dark" },
			{ id: "light", label: "Light" },
		],
	},
	{
		id: "rose-pine",
		label: "Rosé Pine",
		description: "Rosé Pine base",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "palenight",
		label: "Palenight",
		description: "Material-inspired dusk palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "monokai",
		label: "Monokai",
		description: "Classic high-contrast coding palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "github",
		label: "GitHub",
		description: "GitHub developer palette",
		variants: [
			{ id: "dark", label: "Dark" },
			{ id: "light", label: "Light" },
		],
	},
	{
		id: "night-owl",
		label: "Night Owl",
		description: "Blue night coding palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "synthwave-84",
		label: "Synthwave '84",
		description: "Neon retro terminal palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "carbonfox",
		label: "Carbonfox",
		description: "Low-glare IBM Carbon-inspired palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "flexoki",
		label: "Flexoki",
		description: "Inky prose & code palette",
		variants: [
			{ id: "dark", label: "Dark" },
			{ id: "light", label: "Light" },
		],
	},
	{
		id: "miasma",
		label: "Miasma",
		description: "Foggy woods-inspired dark palette",
		variants: [{ id: "default", label: "Default" }],
	},
	{
		id: "vscode",
		label: "VS Code",
		description: "Visual Studio Code palette",
		variants: [
			{ id: "dark", label: "Dark" },
			{ id: "light", label: "Light" },
		],
	},
];

function defaultVariantForTheme(themeId: string): string {
	const t = THEME_OPTIONS.find((x) => x.id === themeId);
	return t?.variants[0]?.id ?? "default";
}

/**
 * Profile `theme` field: `id`, `id/variant`, or custom theme slug (no `custom:`).
 * Colors only — never applies theme.toml `[prefs]`.
 */
export function parseProfileThemeRef(ref: string): PaneThemePrefs | null {
	const raw = ref.trim();
	if (!raw) return null;
	const slash = raw.lastIndexOf("/");
	const themePart = (slash > 0 ? raw.slice(0, slash) : raw).trim();
	const variantPart =
		slash > 0 ? raw.slice(slash + 1).trim() || undefined : undefined;
	if (!themePart) return null;

	const isBuiltin =
		themePart === "system" ||
		Boolean(PRESETS[themePart]) ||
		Boolean(DEPRECATED_THEME_IDS[themePart]) ||
		THEME_OPTIONS.some((t) => t.id === themePart);

	if (isBuiltin) {
		return normalizePaneThemePrefs({
			ui_theme: themePart,
			ui_theme_variant:
				variantPart ??
				(DEPRECATED_THEME_IDS[themePart]
					? "default"
					: defaultVariantForTheme(themePart)),
		});
	}

	const slug = themePart.startsWith("custom:") ? themePart.slice(7) : themePart;
	if (!slug) return null;
	return {
		ui_theme: `custom:${slug}`,
		ui_theme_variant: variantPart ?? "default",
	};
}
