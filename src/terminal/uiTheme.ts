/** App-wide UI + terminal colors. Only Partty is embedded; other themes are files. */
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
export type ThemeCssVars = Record<string, string>;

export const DEFAULT_TERMINAL_FONT_STACK =
	'"Cascadia Code",Consolas,"Courier New",monospace';
export const DEFAULT_THEME_ID = "partty";

// Former Carbonfox colors, unchanged. No behavioral/configuration overrides.
const PARTTY_COLORS: ThemeCssVars = {
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
	"--term-ansi-black": "#161616",
	"--term-ansi-red": "#fa4d56",
	"--term-ansi-green": "#42be65",
	"--term-ansi-yellow": "#f1c21b",
	"--term-ansi-blue": "#78a9ff",
	"--term-ansi-magenta": "#be95ff",
	"--term-ansi-cyan": "#33b1ff",
	"--term-ansi-white": "#f2f4f8",
	"--term-ansi-bright-black": "#525252",
	"--term-ansi-bright-red": "#fa4d56",
	"--term-ansi-bright-green": "#42be65",
	"--term-ansi-bright-yellow": "#f1c21b",
	"--term-ansi-bright-blue": "#78a9ff",
	"--term-ansi-bright-magenta": "#be95ff",
	"--term-ansi-bright-cyan": "#33b1ff",
	"--term-ansi-bright-white": "#ffffff",
};

export function normalizePaneThemePrefs(prefs: PaneThemePrefs): PaneThemePrefs {
	return {
		ui_theme: prefs.ui_theme || DEFAULT_THEME_ID,
		ui_theme_variant: prefs.ui_theme_variant || "default",
	};
}

type ThemeInfo = {
	name: string;
	family: string;
	colors: ThemeCssVars;
	prefs: Record<string, unknown> | null;
	variants?: {
		id: string;
		name: string;
		colors: ThemeCssVars;
		prefs: Record<string, unknown> | null;
	}[];
};
export type ThemeOption = {
	themeId: string;
	variantId: string;
	family: string;
	label: string;
	colors: ThemeCssVars;
	prefs: Record<string, unknown> | null;
};
let customThemes: ThemeOption[] = [];
const PARTTY_OPTION: ThemeOption = {
	themeId: DEFAULT_THEME_ID,
	variantId: "default",
	family: DEFAULT_THEME_ID,
	label: "Partty",
	colors: PARTTY_COLORS,
	prefs: null,
};
let customThemesReady: Promise<void> | null = null;
let customThemesLoading: Promise<void> | null = null;

export function prefsNeedCustomThemes(
	uiPrefs: UiThemePrefs,
	paneThemes?: Iterable<PaneThemePrefs | null | undefined>,
): boolean {
	const custom = (prefs: PaneThemePrefs) =>
		normalizePaneThemePrefs(prefs).ui_theme.startsWith("custom:");
	if (custom(uiPrefs)) return true;
	if (paneThemes)
		for (const prefs of paneThemes) if (prefs && custom(prefs)) return true;
	return false;
}

export function ensureCustomThemesLoaded(): Promise<void> {
	return customThemesReady ?? loadCustomThemesIntoCache();
}

export function loadCustomThemesIntoCache(): Promise<void> {
	if (customThemesLoading !== null) return customThemesLoading;
	customThemesLoading = readCustomThemes().finally(() => {
		customThemesLoading = null;
	});
	customThemesReady = customThemesLoading;
	return customThemesLoading;
}

async function readCustomThemes(): Promise<void> {
	try {
		const names = await invoke<string[]>("list_themes");
		const files = await Promise.all(
			names.map(async (name) => {
				try {
					const info = await invoke<ThemeInfo>("read_theme", { name });
					const variants = info.variants?.length
						? info.variants
						: [
								{
									id: "default",
									name: "",
									colors: info.colors,
									prefs: info.prefs,
								},
							];
					return variants.map(
						(variant): ThemeOption => ({
							themeId: `custom:${name}`,
							variantId: variant.id,
							family: info.family || name,
							label: variant.name
								? `${info.name || name} — ${variant.name}`
								: info.name || name,
							colors: variant.colors,
							prefs: variant.prefs,
						}),
					);
				} catch {
					// One malformed file must not hide other installed themes.
					return [];
				}
			}),
		);
		customThemes = files.flat();
	} catch {
		customThemes = [];
		/* No readable theme directory: Partty remains available. */
	}
}

export function getThemeOptions(): ThemeOption[] {
	return customThemes.length ? [PARTTY_OPTION, ...customThemes] : [];
}

export function resolveThemeOption(prefs: PaneThemePrefs): ThemeOption {
	const normalized = normalizePaneThemePrefs(prefs);
	return (
		customThemes.find(
			(theme) =>
				theme.themeId === normalized.ui_theme &&
				(normalized.ui_theme_variant === "default" ||
					theme.variantId === normalized.ui_theme_variant),
		) ?? PARTTY_OPTION
	);
}

export function themeFamilyOptions(prefs: PaneThemePrefs): ThemeOption[] {
	const family = resolveThemeOption(prefs).family;
	return getThemeOptions().filter((theme) => theme.family === family);
}

export function pickUiPrefs(prefs: Record<string, unknown>): UiThemePrefs {
	return {
		...normalizePaneThemePrefs({
			ui_theme:
				typeof prefs.ui_theme === "string" ? prefs.ui_theme : DEFAULT_THEME_ID,
			ui_theme_variant:
				typeof prefs.ui_theme_variant === "string"
					? prefs.ui_theme_variant
					: "default",
		}),
		font_terminal:
			typeof prefs.font_terminal === "string" ? prefs.font_terminal : "",
		font_ui: typeof prefs.font_ui === "string" ? prefs.font_ui : "",
	};
}

export function uiPrefsChanged(a: UiThemePrefs, b: UiThemePrefs): boolean {
	return (
		a.ui_theme !== b.ui_theme ||
		a.ui_theme_variant !== b.ui_theme_variant ||
		a.font_terminal !== b.font_terminal ||
		a.font_ui !== b.font_ui
	);
}

export function themeCssVarsForPrefs(prefs: PaneThemePrefs): ThemeCssVars {
	return { ...resolveThemeOption(prefs).colors };
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;
const RGB_COLOR_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;
function parseCssColorToRgb(s: string): [number, number, number] | null {
	const t = s.trim();
	const hex = t.match(HEX_COLOR_RE);
	if (hex) {
		const n = Number.parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const rgb = t.match(RGB_COLOR_RE);
	return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;
}
function relLuminance(rgb: [number, number, number]): number {
	const lin = rgb.map((c) => {
		const x = c / 255;
		return x <= 0.039_28 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
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

const ANSI_KEYS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;
const ANSI_DARK = [
	"#000000",
	"#cd3131",
	"#0dbc79",
	"#e5e510",
	"#2472c8",
	"#bc3fbc",
	"#11a8cd",
	"#e5e5e5",
	"#666666",
	"#f14c4c",
	"#23d18b",
	"#f5f543",
	"#3b8eea",
	"#d670d6",
	"#29b8db",
	"#e5e5e5",
];
const ANSI_LIGHT = [
	"#383a42",
	"#c01c28",
	"#2a7f3e",
	"#8a5b00",
	"#1f5fd0",
	"#8b2fa6",
	"#0b6e8a",
	"#4a4a4a",
	"#5c5c5c",
	"#b91c1c",
	"#166534",
	"#854d0e",
	"#1d4ed8",
	"#7e22ce",
	"#0e7490",
	"#18181b",
];
const ANSI_VARS = ANSI_KEYS.map(
	(key) => `--term-ansi-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
);

function xtermThemeFromVars(vars: ThemeCssVars): ITheme {
	const background = vars["--term-bg"] || PARTTY_COLORS["--term-bg"];
	const rgb = parseCssColorToRgb(background);
	const fallback = rgb && relLuminance(rgb) > 0.45 ? ANSI_LIGHT : ANSI_DARK;
	const ansi = Object.fromEntries(
		ANSI_KEYS.map((key, i) => [key, vars[ANSI_VARS[i]] || fallback[i]]),
	);
	return {
		background,
		foreground: vars["--term-fg"] || PARTTY_COLORS["--term-fg"],
		cursor: vars["--term-cursor"] || PARTTY_COLORS["--term-cursor"],
		cursorAccent: background,
		selectionBackground:
			vars["--term-selection-bg"] || PARTTY_COLORS["--term-selection-bg"],
		...ansi,
	};
}

export function buildXtermThemeFromDocument(): ITheme {
	const cs = getComputedStyle(document.documentElement);
	const keys = [
		"--term-bg",
		"--term-fg",
		"--term-cursor",
		"--term-selection-bg",
		...ANSI_VARS,
	];
	return xtermThemeFromVars(
		Object.fromEntries(
			keys.map((key) => [key, cs.getPropertyValue(key).trim()]),
		),
	);
}
export function buildXtermThemeFromPrefs(prefs: PaneThemePrefs): ITheme {
	return xtermThemeFromVars(themeCssVarsForPrefs(prefs));
}

export type FindHighlight = { background: string; foreground: string };
export type FindHighlightColors = {
	match: FindHighlight;
	active: FindHighlight;
};
export type FindHighlightOverrides = {
	matchBg?: string;
	matchFg?: string;
	activeBg?: string;
	activeFg?: string;
};
const FIND_MATCH_MIX = 0.32;
const FIND_ACTIVE_MIX = 0.7;
const FIND_FALLBACK: FindHighlightColors = {
	match: { background: "#5b4a1f", foreground: "#fde68a" },
	active: { background: "#f59e0b", foreground: "#1a1206" },
};
function mixRgb(
	a: [number, number, number],
	b: [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}
function asColor(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed && parseCssColorToRgb(trimmed) ? trimmed : undefined;
}
function readableOn(
	bgRgb: [number, number, number],
	preferred: (string | undefined)[],
): string {
	for (const candidate of preferred) {
		const rgb = candidate ? parseCssColorToRgb(candidate) : null;
		if (rgb && luminanceContrast(bgRgb, rgb) >= 4.5) return candidate as string;
	}
	return luminanceContrast(bgRgb, [255, 255, 255]) >=
		luminanceContrast(bgRgb, [0, 0, 0])
		? "#ffffff"
		: "#000000";
}
export function deriveFindHighlightColors(
	bg: string | undefined,
	fg: string | undefined,
	accent: string | undefined,
	overrides: FindHighlightOverrides = {},
): FindHighlightColors | null {
	const bgRgb = bg ? parseCssColorToRgb(bg) : null;
	const accentRgb = accent ? parseCssColorToRgb(accent) : null;
	const matchBg =
		asColor(overrides.matchBg) ??
		(bgRgb && accentRgb
			? toHex(mixRgb(bgRgb, accentRgb, FIND_MATCH_MIX))
			: undefined);
	const activeBg =
		asColor(overrides.activeBg) ??
		(bgRgb && accentRgb
			? toHex(mixRgb(bgRgb, accentRgb, FIND_ACTIVE_MIX))
			: undefined);
	if (!matchBg || !activeBg) return null;
	const matchRgb = parseCssColorToRgb(matchBg);
	const activeRgb = parseCssColorToRgb(activeBg);
	if (!matchRgb || !activeRgb) return null;
	return {
		match: {
			background: matchBg,
			foreground: asColor(overrides.matchFg) ?? readableOn(matchRgb, [fg, bg]),
		},
		active: {
			background: activeBg,
			foreground:
				asColor(overrides.activeFg) ?? readableOn(activeRgb, [bg, fg]),
		},
	};
}
export function terminalFindColors(
	prefs?: PaneThemePrefs | null,
): FindHighlightColors {
	const cs = prefs ? null : getComputedStyle(document.documentElement);
	const vars = prefs ? themeCssVarsForPrefs(prefs) : null;
	const get = (key: string) => vars?.[key] ?? cs?.getPropertyValue(key).trim();
	return (
		deriveFindHighlightColors(
			get("--term-bg"),
			get("--term-fg"),
			get("--accent-primary") || get("--accent-primary-light"),
			{
				matchBg: get("--term-find-match-bg"),
				matchFg: get("--term-find-match-fg"),
				activeBg: get("--term-find-match-active-bg"),
				activeFg: get("--term-find-match-active-fg"),
			},
		) ?? FIND_FALLBACK
	);
}

/** Match the existing light/dark chrome mapping independently of terminal colors. */
function syncUiGrayScale(): void {
	const root = document.documentElement;
	const rgb = parseCssColorToRgb(
		getComputedStyle(root).getPropertyValue("--term-bg"),
	);
	if (!rgb) return;
	const light = relLuminance(rgb) > 0.45;
	root.dataset.luminance = light ? "light" : "dark";
	const keys = [
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
	];
	if (!light) {
		for (const n of keys) root.style.removeProperty(`--ui-gray-${n}`);
		root.style.removeProperty("--hover-overlay");
		root.style.removeProperty("--hover-overlay-light");
		return;
	}
	const colors = [
		"#f8fafc",
		"#0f172a",
		"#1e293b",
		"#334155",
		"#475569",
		"#64748b",
		"#94a3b8",
		"#cbd5e1",
		"#e2e8f0",
		"#f1f5f9",
	];
	keys.forEach((key, i) => {
		root.style.setProperty(`--ui-gray-${key}`, colors[i]);
	});
	root.style.setProperty("--hover-overlay", "rgba(0, 0, 0, 0.06)");
	root.style.setProperty("--hover-overlay-light", "rgba(0, 0, 0, 0.04)");
}
function syncUiChromeTextColors(): void {
	const root = document.documentElement;
	const cs = getComputedStyle(root);
	const rgb =
		parseCssColorToRgb(cs.getPropertyValue("--panel-bg")) ??
		parseCssColorToRgb(cs.getPropertyValue("--term-bg"));
	if (!rgb) return;
	const light = relLuminance(rgb) > 0.42;
	let fg: [number, number, number] = light ? [17, 24, 39] : [249, 250, 251];
	let muted: [number, number, number] = light ? [55, 65, 81] : [209, 213, 219];
	let faint: [number, number, number] = light ? [75, 85, 99] : [156, 163, 175];
	if (light) {
		if (relLuminance(fg) > 0.28 || luminanceContrast(rgb, fg) < 7)
			fg = [15, 23, 42];
		if (relLuminance(muted) > 0.35 || luminanceContrast(rgb, muted) < 4.5)
			muted = [31, 41, 55];
		if (relLuminance(faint) > 0.42 || luminanceContrast(rgb, faint) < 3.2)
			faint = [55, 65, 81];
	} else if (luminanceContrast(rgb, fg) < 5) {
		fg = [254, 254, 255];
		muted = [229, 231, 235];
		faint = [163, 163, 163];
	}
	root.style.setProperty("--ui-chrome-fg", toHex(fg));
	root.style.setProperty("--ui-chrome-muted", toHex(muted));
	root.style.setProperty("--ui-chrome-fainter", toHex(faint));
}
function syncInputTextColor(): void {
	const root = document.documentElement;
	const cs = getComputedStyle(root);
	const rgb =
		parseCssColorToRgb(cs.getPropertyValue("--input-bg")) ??
		parseCssColorToRgb(cs.getPropertyValue("--term-bg"));
	if (!rgb) return;
	const light = relLuminance(rgb) > 0.42;
	let fg: [number, number, number] = light ? [17, 24, 39] : [249, 250, 251];
	if (light) {
		if (relLuminance(fg) > 0.28 || luminanceContrast(rgb, fg) < 7)
			fg = [15, 23, 42];
	} else if (luminanceContrast(rgb, fg) < 5) fg = [254, 254, 255];
	root.style.setProperty("--input-text", toHex(fg));
}

let appliedThemeKeys: string[] = [];
export function applyUiTheme(prefs: UiThemePrefs): void {
	const root = document.documentElement;
	const normalized = normalizePaneThemePrefs(prefs);
	root.dataset.theme = normalized.ui_theme;
	root.dataset.themeVariant = normalized.ui_theme_variant;
	for (const [key, value] of [
		["--font-terminal", prefs.font_terminal],
		["--font-ui", prefs.font_ui],
	]) {
		if (value.trim()) root.style.setProperty(key, value.trim());
		else root.style.removeProperty(key);
	}
	// Clear precisely the properties owned by the previous theme, not layout
	// variables such as --term-pad-x or user font/animation configuration.
	for (const key of appliedThemeKeys) root.style.removeProperty(key);
	const colors = themeCssVarsForPrefs(normalized);
	appliedThemeKeys = Object.keys(colors);
	for (const [key, value] of Object.entries(colors))
		root.style.setProperty(key, value);
	syncUiGrayScale();
	syncUiChromeTextColors();
	syncInputTextColor();
	// Explicit file foregrounds/cursors are authoritative, just like the old
	// named palettes. Never contrast-rewrite an extracted preset's colors.
}

/** Profile themes are colors-only; theme file preference overlays are ignored. */
export function parseProfileThemeRef(ref: string): PaneThemePrefs | null {
	const raw = ref.trim();
	if (!raw) return null;
	const slash = raw.lastIndexOf("/");
	const id = slash > 0 ? raw.slice(0, slash).trim() : raw;
	return normalizePaneThemePrefs({
		ui_theme:
			id === DEFAULT_THEME_ID || id.startsWith("custom:") ? id : `custom:${id}`,
		ui_theme_variant: slash > 0 ? raw.slice(slash + 1).trim() : "default",
	});
}
