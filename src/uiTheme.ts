/**
 * App-wide UI + terminal theming. Presets set CSS variables on `document.documentElement`.
 * File-tree git status colors stay semantic (not overridden by theme ink).
 */

import { invoke } from "@tauri-apps/api/core";

export type UiThemePrefs = {
  ui_theme: string;
  ui_theme_variant: string;
  font_terminal: string;
  font_ui: string;
  font_file_tree: string;
};

/** Nerd-font-friendly default; no single font hard-required. */
export const DEFAULT_TERMINAL_FONT_STACK = String.raw`"JetBrains Mono","Cascadia Code","Sarasa Term SC","Symbols Nerd Font Mono",Consolas,"Liberation Mono",monospace`;

export const DEFAULT_UI_FONT = String.raw`system-ui,"Segoe UI",sans-serif`;

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
      "--term-selection-bg": "#33467c88",
      "--ui-gray-900": "#16161e",
      "--ui-gray-800": "#1f2335",
      "--ui-gray-700": "#292e42",
      "--ui-gray-400": "#565f89",
      "--ui-gray-300": "#a9b1d6",
      "--accent-primary": "#7aa2f7",
      "--accent-primary-light": "#89b4fa",
      "--accent-primary-lighter": "#bb9af7",
      "--panel-bg": "#1f2335",
      "--panel-border": "#3b4261",
      "--backdrop-darkest": "rgba(13, 16, 33, 0.52)",
      "--input-bg": "#1a1b26",
      "--input-border": "#3b4261",
      "--minimap-track": "rgba(0,0,0,0.35)",
      "--minimap-thumb": "rgba(122,162,247,0.35)",
      "--minimap-thumb-border": "rgba(192,202,245,0.45)",
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
      "--minimap-track": "rgba(0,0,0,0.32)",
      "--minimap-thumb": "rgba(167,192,128,0.35)",
      "--minimap-thumb-border": "rgba(211,198,170,0.4)",
      "--pane-divider": "rgba(167,192,128,0.22)",
      "--pane-divider-hover": "rgba(167,192,128,0.38)",
    },
  },
  ayu: {
    default: {
      "--term-bg": "#0b0e14",
      "--term-fg": "#bfbdb6",
      "--term-cursor": "#e6e1cf",
      "--term-selection-bg": "#30445788",
      "--ui-gray-900": "#06080c",
      "--ui-gray-800": "#0b0e14",
      "--ui-gray-700": "#151a1e",
      "--ui-gray-400": "#6c7380",
      "--accent-primary": "#59c2ff",
      "--accent-primary-light": "#73d0ff",
      "--panel-bg": "#0f131a",
      "--panel-border": "#242936",
      "--backdrop-darkest": "rgba(5, 8, 12, 0.55)",
      "--input-bg": "#0b0e14",
      "--input-border": "#242936",
      "--minimap-thumb": "rgba(89,194,255,0.35)",
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
      "--minimap-thumb": "rgba(203,166,247,0.38)",
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
      "--minimap-thumb": "rgba(198,160,246,0.35)",
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
      "--minimap-thumb": "rgba(202,158,230,0.35)",
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
      "--panel-bg": "#ccd0da",
      "--panel-border": "#bcc0cc",
      "--backdrop-darkest": "rgba(76, 79, 105, 0.35)",
      "--input-bg": "#eff1f5",
      "--input-border": "#acb0be",
      "--minimap-track": "rgba(0,0,0,0.08)",
      "--minimap-thumb": "rgba(136,57,239,0.25)",
      "--pane-divider": "rgba(136,57,239,0.2)",
      "--pane-divider-hover": "rgba(136,57,239,0.35)",
    },
  },
  "catppuccin-macchiato": {
    default: {
      "--term-bg": "#24273a",
      "--term-fg": "#cad3f5",
      "--term-cursor": "#f4dbd6",
      "--term-selection-bg": "#5b607888",
      "--ui-gray-800": "#1e2030",
      "--ui-gray-700": "#363a4f",
      "--accent-primary": "#c6a0f6",
      "--panel-bg": "#363a4f",
      "--panel-border": "#494d64",
      "--backdrop-darkest": "rgba(20, 22, 36, 0.52)",
      "--input-bg": "#24273a",
      "--input-border": "#494d64",
      "--minimap-thumb": "rgba(198,160,246,0.35)",
      "--pane-divider": "rgba(198,160,246,0.24)",
      "--pane-divider-hover": "rgba(198,160,246,0.4)",
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
      "--minimap-thumb": "rgba(254,128,25,0.35)",
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
      "--minimap-thumb": "rgba(254,128,25,0.38)",
      "--pane-divider": "rgba(254,128,25,0.25)",
      "--pane-divider-hover": "rgba(254,128,25,0.42)",
    },
    soft_light: {
      "--term-bg": "#f2e5bc",
      "--term-fg": "#654735",
      "--term-cursor": "#c2410d",
      "--term-selection-bg": "#d5c4a188",
      "--ui-gray-900": "#ebdbb2",
      "--ui-gray-800": "#f2e5bc",
      "--ui-gray-700": "#ebdbb2",
      "--ui-gray-400": "#665c54",
      "--accent-primary": "#af3a03",
      "--panel-bg": "#ebdbb2",
      "--panel-border": "#d5c4a1",
      "--backdrop-darkest": "rgba(80, 60, 40, 0.25)",
      "--input-bg": "#f2e5bc",
      "--input-border": "#d5c4a1",
      "--minimap-track": "rgba(0,0,0,0.06)",
      "--minimap-thumb": "rgba(175,58,3,0.28)",
      "--pane-divider": "rgba(175,58,3,0.2)",
      "--pane-divider-hover": "rgba(175,58,3,0.35)",
    },
    hard_light: {
      "--term-bg": "#f9f5d7",
      "--term-fg": "#654735",
      "--term-cursor": "#b57614",
      "--term-selection-bg": "#bdae9388",
      "--ui-gray-800": "#f2e5bc",
      "--ui-gray-700": "#ebdbb2",
      "--accent-primary": "#9d0006",
      "--panel-bg": "#ebdbb2",
      "--panel-border": "#d5c4a1",
      "--backdrop-darkest": "rgba(60, 45, 30, 0.22)",
      "--input-bg": "#f9f5d7",
      "--input-border": "#bdae93",
      "--minimap-track": "rgba(0,0,0,0.07)",
      "--minimap-thumb": "rgba(157,0,6,0.22)",
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
      "--minimap-thumb": "rgba(126,156,216,0.35)",
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
      "--minimap-thumb": "rgba(136,192,208,0.35)",
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
      "--minimap-thumb": "rgba(57,255,20,0.35)",
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
      "--minimap-thumb": "rgba(97,175,239,0.35)",
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
      "--minimap-thumb": "rgba(189,147,249,0.35)",
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
      "--minimap-thumb": "rgba(38,139,210,0.35)",
      "--pane-divider": "rgba(38,139,210,0.22)",
      "--pane-divider-hover": "rgba(38,139,210,0.4)",
    },
    light: {
      "--term-bg": "#fdf6e3",
      "--term-fg": "#586e75",
      "--term-cursor": "#657b83",
      "--term-selection-bg": "#eee8d588",
      "--ui-gray-800": "#eee8d5",
      "--ui-gray-700": "#e8e2d0",
      "--accent-primary": "#268bd2",
      "--panel-bg": "#eee8d5",
      "--panel-border": "#d5cdc0",
      "--backdrop-darkest": "rgba(60, 55, 40, 0.22)",
      "--input-bg": "#fdf6e3",
      "--input-border": "#93a1a1",
      "--minimap-track": "rgba(0,0,0,0.06)",
      "--minimap-thumb": "rgba(38,139,210,0.25)",
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
      "--minimap-thumb": "rgba(196,167,231,0.35)",
      "--pane-divider": "rgba(196,167,231,0.22)",
      "--pane-divider-hover": "rgba(196,167,231,0.4)",
    },
  },
};

/** Loaded from `%LOCALAPPDATA%/termie/custom_themes/*.json` (see Rust `custom_themes_dir`). */
const customThemeVarsCache: Record<string, ThemeCssVars> = {};

export async function loadCustomThemesIntoCache(): Promise<void> {
  for (const k of Object.keys(customThemeVarsCache)) {
    delete customThemeVarsCache[k];
  }
  try {
    const names = await invoke<string[]>("list_custom_theme_names");
    for (const name of names) {
      const raw = await invoke<string>("read_custom_theme_json", { name });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const vars: ThemeCssVars = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k.startsWith("--") && typeof v === "string") vars[k] = v;
      }
      if (Object.keys(vars).length) customThemeVarsCache[name] = vars;
    }
  } catch {
    /* ignore */
  }
}

export function registerCustomThemeInCache(slug: string, vars: ThemeCssVars): void {
  customThemeVarsCache[slug] = vars;
}

/** Keys written when saving the current appearance as a custom theme file. */
export const THEME_EXPORT_CSS_KEYS: readonly string[] = [
  "--term-bg",
  "--term-fg",
  "--term-cursor",
  "--term-selection-bg",
  "--ui-gray-900",
  "--ui-gray-800",
  "--ui-gray-700",
  "--ui-gray-400",
  "--ui-gray-300",
  "--accent-primary",
  "--accent-primary-light",
  "--accent-primary-lighter",
  "--panel-bg",
  "--panel-border",
  "--backdrop-darkest",
  "--input-bg",
  "--input-border",
  "--minimap-track",
  "--minimap-thumb",
  "--minimap-thumb-border",
  "--pane-divider",
  "--pane-divider-hover",
];

export function collectCurrentThemeCssVars(): ThemeCssVars {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const out: ThemeCssVars = {};
  for (const key of THEME_EXPORT_CSS_KEYS) {
    const v = cs.getPropertyValue(key).trim();
    if (v) out[key] = v;
  }
  return out;
}

const INHERITED_THEME_KEYS = new Set([
  "ui_theme",
  "ui_theme_variant",
  "font_terminal",
  "font_ui",
  "font_file_tree",
]);

export function pickUiPrefs(prefs: Record<string, unknown>): UiThemePrefs {
  return {
    ui_theme: typeof prefs.ui_theme === "string" ? prefs.ui_theme : "system",
    ui_theme_variant:
      typeof prefs.ui_theme_variant === "string" ? prefs.ui_theme_variant : "default",
    font_terminal: typeof prefs.font_terminal === "string" ? prefs.font_terminal : "",
    font_ui: typeof prefs.font_ui === "string" ? prefs.font_ui : "",
    font_file_tree: typeof prefs.font_file_tree === "string" ? prefs.font_file_tree : "",
  };
}

export function uiPrefsChanged(a: UiThemePrefs, b: UiThemePrefs): boolean {
  for (const k of INHERITED_THEME_KEYS) {
    if (a[k as keyof UiThemePrefs] !== b[k as keyof UiThemePrefs]) return true;
  }
  return false;
}

function resolvePreset(themeId: string, variant: string): ThemeCssVars {
  if (themeId.startsWith("custom:")) {
    const slug = themeId.slice(7);
    const c = customThemeVarsCache[slug];
    if (c && Object.keys(c).length > 0) return { ...c };
    return PRESETS.tokyonight.default;
  }
  const t = PRESETS[themeId];
  if (!t) return PRESETS.tokyonight.default;
  let v = variant || "default";
  if (themeId === "catppuccin" && (v === "default" || !t[v])) {
    v = "mocha";
  }
  if (themeId === "gruvbox" && (v === "default" || !t[v])) {
    v = "soft_dark";
  }
  if (themeId === "solarized" && (v === "default" || !t[v])) {
    v = "dark";
  }
  return t[v] ?? t.default ?? PRESETS.tokyonight.default;
}

function parseCssColorToRgb(s: string): [number, number, number] | null {
  const t = s.trim();
  const hex = t.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}

/** sRGB relative luminance 0–1 */
function relLuminance(rgb: [number, number, number]): number {
  const lin = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG relative luminance contrast ratio (≥4.5 is readable body text). */
function luminanceContrast(a: [number, number, number], b: [number, number, number]): number {
  const la = relLuminance(a) + 0.05;
  const lb = relLuminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

/**
 * Panel / modal label text: derive from `--panel-bg` when set (theme presets), else `--term-bg`.
 */
export function syncUiChromeTextColors(): void {
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
  if (luminanceContrast(rgb, fg) < 4.2) {
    fg = lightPanel ? [15, 23, 42] : [254, 254, 255];
    muted = lightPanel ? [31, 41, 55] : [229, 231, 235];
    faint = lightPanel ? [55, 65, 81] : [163, 163, 163];
  }
  const hex = (c: [number, number, number]) =>
    `#${c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
  root.style.setProperty("--ui-chrome-fg", hex(fg));
  root.style.setProperty("--ui-chrome-muted", hex(muted));
  root.style.setProperty("--ui-chrome-fainter", hex(faint));
}

/** Input / select text: readable on `--input-bg` (fixes light presets leaving `--input-text` from dark defaults). */
export function syncInputTextColor(): void {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bgStr = cs.getPropertyValue("--input-bg").trim() || cs.getPropertyValue("--term-bg").trim();
  const rgb = parseCssColorToRgb(bgStr);
  if (!rgb) return;
  const lum = relLuminance(rgb);
  const lightIn = lum > 0.42;
  let fg: [number, number, number] = lightIn ? [17, 24, 39] : [249, 250, 251];
  if (luminanceContrast(rgb, fg) < 4.2) {
    fg = lightIn ? [15, 23, 42] : [254, 254, 255];
  }
  const hex = (c: [number, number, number]) =>
    `#${c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
  root.style.setProperty("--input-text", hex(fg));
}

/** Ensures `--term-fg` / `--term-cursor` read clearly on `--term-bg` (fixes washed-out pairs). */
export function syncTerminalFgContrast(): void {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bgStr = cs.getPropertyValue("--term-bg").trim();
  const fgStr = cs.getPropertyValue("--term-fg").trim();
  const bg = parseCssColorToRgb(bgStr);
  const fg = parseCssColorToRgb(fgStr);
  if (!bg || !fg) return;
  if (luminanceContrast(bg, fg) >= 4.2) return;
  const lumBg = relLuminance(bg);
  const darkText: [number, number, number] = [17, 24, 39];
  const lightText: [number, number, number] = [248, 250, 252];
  const pick = lumBg > 0.45 ? darkText : lightText;
  const hex = (c: [number, number, number]) =>
    `#${c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
  const next = hex(pick);
  root.style.setProperty("--term-fg", next);
  root.style.setProperty("--term-cursor", next);
}

/** Live-preview CSS vars (theme builder) without changing font prefs. */
export function previewThemeCssVars(vars: ThemeCssVars): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    if (k.startsWith("--")) root.style.setProperty(k, v);
  }
  syncUiChromeTextColors();
  syncInputTextColor();
  syncTerminalFgContrast();
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

  const ftFont = prefs.font_file_tree.trim();
  if (ftFont) root.style.setProperty("--font-file-tree", ftFont);
  else root.style.removeProperty("--font-file-tree");

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
        name.startsWith("--minimap-") ||
        name.startsWith("--pane-divider")
      ) {
        toClear.push(name);
      }
    }
    for (const n of toClear) root.style.removeProperty(n);
  };

  clearThemeVars();

  if (prefs.ui_theme === "system") {
    syncUiChromeTextColors();
    syncInputTextColor();
    syncTerminalFgContrast();
    return;
  }

  const preset = resolvePreset(prefs.ui_theme, prefs.ui_theme_variant);
  for (const [k, v] of Object.entries(preset)) {
    root.style.setProperty(k, v);
  }
  syncUiChromeTextColors();
  syncInputTextColor();
  syncTerminalFgContrast();
}

/** Theme metadata for settings UI */
export const THEME_OPTIONS: {
  id: string;
  label: string;
  description: string;
  variants: { id: string; label: string }[];
}[] = [
  { id: "system", label: "System", description: "Chrome follows terminal background colors", variants: [{ id: "default", label: "Default" }] },
  { id: "tokyonight", label: "Tokyo Night", description: "Popular dark Neovim theme", variants: [{ id: "default", label: "Default" }] },
  { id: "everforest", label: "Everforest", description: "Forest-inspired palette", variants: [{ id: "default", label: "Default" }] },
  { id: "ayu", label: "Ayu", description: "Ayu dark", variants: [{ id: "default", label: "Default" }] },
  { id: "catppuccin", label: "Catppuccin", description: "Soothing pastel theme", variants: [
    { id: "mocha", label: "Mocha" }, { id: "macchiato", label: "Macchiato" }, { id: "frappe", label: "Frappé" }, { id: "latte", label: "Latte" },
  ]},
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato", description: "Catppuccin Macchiato preset", variants: [{ id: "default", label: "Default" }] },
  { id: "gruvbox", label: "Gruvbox", description: "Retro contrast", variants: [
    { id: "soft_dark", label: "Soft dark" }, { id: "hard_dark", label: "Hard dark" }, { id: "soft_light", label: "Soft light" }, { id: "hard_light", label: "Hard light" },
  ]},
  { id: "kanagawa", label: "Kanagawa", description: "Ink-inspired dark", variants: [{ id: "default", label: "Default" }] },
  { id: "nord", label: "Nord", description: "Arctic palette", variants: [{ id: "default", label: "Default" }] },
  { id: "matrix", label: "Matrix", description: "Green-on-black terminal aesthetic", variants: [{ id: "default", label: "Default" }] },
  { id: "one-dark", label: "One Dark", description: "Atom One Dark", variants: [{ id: "default", label: "Default" }] },
  { id: "dracula", label: "Dracula", description: "Dracula palette", variants: [{ id: "default", label: "Default" }] },
  { id: "solarized", label: "Solarized", description: "Classic precision palette", variants: [{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }] },
  { id: "rose-pine", label: "Rosé Pine", description: "Rosé Pine base", variants: [{ id: "default", label: "Default" }] },
];

export function defaultVariantForTheme(themeId: string): string {
  const t = THEME_OPTIONS.find((x) => x.id === themeId);
  return t?.variants[0]?.id ?? "default";
}
