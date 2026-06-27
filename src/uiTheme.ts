/**
 * App-wide UI + terminal theming. Presets set CSS variables on `document.documentElement`.
 * File-tree git status colors stay semantic (not overridden by theme ink).
 */

import type { ITheme } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";

export type UiThemePrefs = {
  ui_theme: string;
  ui_theme_variant: string;
  font_terminal: string;
  font_ui: string;
  font_file_tree: string;
};

export type PaneThemePrefs = Pick<UiThemePrefs, "ui_theme" | "ui_theme_variant">;

/** Windows-default monospace stack; Consolas is guaranteed on all Win10+ machines. */
export const DEFAULT_TERMINAL_FONT_STACK = String.raw`Consolas,"Cascadia Code","Courier New",monospace`;

export const DEFAULT_UI_FONT = String.raw`"Segoe UI",system-ui,sans-serif`;

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
      "--input-border": "#3b4261",      "--pane-divider": "rgba(122,162,247,0.25)",
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
      "--input-border": "#4f585e",      "--pane-divider": "rgba(167,192,128,0.22)",
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
      "--input-border": "#242936",      "--pane-divider": "rgba(89,194,255,0.22)",
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
      "--input-border": "#45475a",      "--pane-divider": "rgba(203,166,247,0.25)",
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
      "--input-border": "#494d64",      "--pane-divider": "rgba(198,160,246,0.24)",
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
      "--input-border": "#51576d",      "--pane-divider": "rgba(202,158,230,0.22)",
      "--pane-divider-hover": "rgba(202,158,230,0.4)",
    },
    latte: {
      "--term-bg": "#eff1f5",
      "--term-fg": "#25273a",
      "--term-cursor": "#5c2e1f",
      "--term-selection-bg": "#acb0be88",
      "--ui-gray-900": "#dce0e8",
      "--ui-gray-800": "#e6e9ef",
      "--ui-gray-700": "#ccd0da",
      "--ui-gray-400": "#3f4257",
      "--accent-primary": "#6b21c9",
      "--panel-bg": "#dce0e8",
      "--panel-border": "#bcc0cc",
      "--backdrop-darkest": "rgba(76, 79, 105, 0.35)",
      "--input-bg": "#eff1f5",
      "--input-border": "#acb0be",      "--pane-divider": "rgba(136,57,239,0.2)",
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
      "--input-border": "#494d64",      "--pane-divider": "rgba(198,160,246,0.24)",
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
      "--input-border": "#504945",      "--pane-divider": "rgba(254,128,25,0.22)",
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
      "--input-border": "#3c3836",      "--pane-divider": "rgba(254,128,25,0.25)",
      "--pane-divider-hover": "rgba(254,128,25,0.42)",
    },
    soft_light: {
      "--term-bg": "#f2e5bc",
      "--term-fg": "#3c271d",
      "--term-cursor": "#7c2d12",
      "--term-selection-bg": "#d5c4a188",
      "--ui-gray-900": "#ebdbb2",
      "--ui-gray-800": "#f2e5bc",
      "--ui-gray-700": "#ebdbb2",
      "--ui-gray-400": "#3c3836",
      "--accent-primary": "#8f2f00",
      "--panel-bg": "#ebdbb2",
      "--panel-border": "#d5c4a1",
      "--backdrop-darkest": "rgba(80, 60, 40, 0.25)",
      "--input-bg": "#f2e5bc",
      "--input-border": "#d5c4a1",      "--pane-divider": "rgba(175,58,3,0.2)",
      "--pane-divider-hover": "rgba(175,58,3,0.35)",
    },
    hard_light: {
      "--term-bg": "#f9f5d7",
      "--term-fg": "#3c271d",
      "--term-cursor": "#7c4a03",
      "--term-selection-bg": "#bdae9388",
      "--ui-gray-800": "#f2e5bc",
      "--ui-gray-700": "#ebdbb2",
      "--accent-primary": "#7f0005",
      "--panel-bg": "#ebdbb2",
      "--panel-border": "#d5c4a1",
      "--backdrop-darkest": "rgba(60, 45, 30, 0.22)",
      "--input-bg": "#f9f5d7",
      "--input-border": "#bdae93",      "--pane-divider": "rgba(181,118,20,0.22)",
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
      "--input-border": "#363646",      "--pane-divider": "rgba(126,156,216,0.22)",
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
      "--input-border": "#4c566a",      "--pane-divider": "rgba(136,192,208,0.24)",
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
      "--input-border": "#14532d",      "--pane-divider": "rgba(57,255,20,0.25)",
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
      "--input-border": "#3e4451",      "--pane-divider": "rgba(97,175,239,0.22)",
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
      "--input-border": "#44475a",      "--pane-divider": "rgba(189,147,249,0.24)",
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
      "--input-border": "#0c4a5c",      "--pane-divider": "rgba(38,139,210,0.22)",
      "--pane-divider-hover": "rgba(38,139,210,0.4)",
    },
    light: {
      "--term-bg": "#fdf6e3",
      "--term-fg": "#25363b",
      "--term-cursor": "#35484e",
      "--term-selection-bg": "#eee8d588",
      "--ui-gray-800": "#eee8d5",
      "--ui-gray-700": "#e8e2d0",
      "--accent-primary": "#1269a3",
      "--panel-bg": "#eee8d5",
      "--panel-border": "#d5cdc0",
      "--backdrop-darkest": "rgba(60, 55, 40, 0.22)",
      "--input-bg": "#fdf6e3",
      "--input-border": "#93a1a1",      "--pane-divider": "rgba(38,139,210,0.2)",
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
      "--input-border": "#403d52",      "--pane-divider": "rgba(196,167,231,0.22)",
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
      "--input-border": "#4e5577",      "--pane-divider": "rgba(130,170,255,0.24)",
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
      "--input-border": "#525349",      "--pane-divider": "rgba(166,226,46,0.22)",
      "--pane-divider-hover": "rgba(166,226,46,0.4)",
    },
  },
  "github-dark": {
    default: {
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
      "--input-border": "#30363d",      "--pane-divider": "rgba(88,166,255,0.22)",
      "--pane-divider-hover": "rgba(88,166,255,0.4)",
    },
  },
  "github-light": {
    default: {
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
      "--input-border": "#d0d7de",      "--pane-divider": "rgba(9,105,218,0.18)",
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
      "--input-border": "#214862",      "--pane-divider": "rgba(127,219,202,0.22)",
      "--pane-divider-hover": "rgba(127,219,202,0.4)",
    },
  },
  "synthwave-84": {
    default: {
      "--term-bg": "#2b213a",
      "--term-fg": "#f8f7ff",
      "--term-cursor": "#f92aad",
      "--term-selection-bg": "#6d3f8f88",
      "--ui-gray-800": "#241b31",
      "--ui-gray-700": "#3b2b52",
      "--accent-primary": "#f92aad",
      "--accent-primary-light": "#00e5ff",
      "--accent-primary-lighter": "#fff951",
      "--panel-bg": "#3b2b52",
      "--panel-border": "#6d3f8f",
      "--backdrop-darkest": "rgba(18, 10, 28, 0.58)",
      "--input-bg": "#2b213a",
      "--input-border": "#6d3f8f",      "--pane-divider": "rgba(0,229,255,0.24)",
      "--pane-divider-hover": "rgba(249,42,173,0.42)",
    },
  },
  "carbonfox": {
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
      "--input-border": "#393939",      "--pane-divider": "rgba(120,169,255,0.22)",
      "--pane-divider-hover": "rgba(120,169,255,0.4)",
    },
  },
};

type ThemeInfo = { name: string; colors: Record<string, string>; prefs: Record<string, unknown> | null };

const customThemeVarsCache: Record<string, ThemeCssVars> = {};
const themePrefsCache: Record<string, Record<string, unknown>> = {};

export async function loadCustomThemesIntoCache(): Promise<void> {
  for (const k of Object.keys(customThemeVarsCache)) {
    delete customThemeVarsCache[k];
  }
  for (const k of Object.keys(themePrefsCache)) {
    delete themePrefsCache[k];
  }
  try {
    const names = await invoke<string[]>("list_themes");
    for (const name of names) {
      const info = await invoke<ThemeInfo>("read_theme", { name });
      if (info.colors && Object.keys(info.colors).length) {
        customThemeVarsCache[name] = info.colors;
      }
      if (info.prefs) {
        themePrefsCache[name] = info.prefs;
      }
    }
  } catch {
    /* ignore */
  }
}

export function registerCustomThemeInCache(slug: string, vars: ThemeCssVars): void {
  customThemeVarsCache[slug] = vars;
}

export function getThemePrefsCache(): Record<string, Record<string, unknown>> {
  return themePrefsCache;
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

function toHex(c: [number, number, number]): string {
  return `#${c.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
}

function termBackgroundRgb(): [number, number, number] | null {
  const bgStr = getComputedStyle(document.documentElement).getPropertyValue("--term-bg").trim();
  return parseCssColorToRgb(bgStr);
}

function isLightBackground(rgb: [number, number, number]): boolean {
  return relLuminance(rgb) > 0.45;
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
  const cursor = cs.getPropertyValue("--term-cursor").trim() || TERM_CURSOR_FALLBACK;
  const sel = cs.getPropertyValue("--term-selection-bg").trim() || TERM_SELECTION_BG_FALLBACK;
  const bgRgb = parseCssColorToRgb(bg);
  const ansi = bgRgb && isLightBackground(bgRgb) ? XTERM_ANSI_LIGHT : XTERM_ANSI_DARK;
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
  if (!prefs.ui_theme || prefs.ui_theme === "system") return buildXtermThemeFromDocument();
  const vars = resolvePreset(prefs.ui_theme, prefs.ui_theme_variant);
  const bg = vars["--term-bg"] || TERM_BG_FALLBACK;
  const fg = vars["--term-fg"] || TERM_FG_FALLBACK;
  const cursor = vars["--term-cursor"] || TERM_CURSOR_FALLBACK;
  const sel = vars["--term-selection-bg"] || TERM_SELECTION_BG_FALLBACK;
  const bgRgb = parseCssColorToRgb(bg);
  const ansi = bgRgb && isLightBackground(bgRgb) ? XTERM_ANSI_LIGHT : XTERM_ANSI_DARK;
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
export function syncUiGrayScale(): void {
  const root = document.documentElement;
  const bgRgb = termBackgroundRgb();
  if (!bgRgb) return;
  const light = isLightBackground(bgRgb);
  root.dataset.luminance = light ? "light" : "dark";

  const grayKeys = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;
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
  if (lightPanel) {
    if (relLuminance(fg) > 0.28 || luminanceContrast(rgb, fg) < 7) fg = [15, 23, 42];
    if (relLuminance(muted) > 0.35 || luminanceContrast(rgb, muted) < 4.5) muted = [31, 41, 55];
    if (relLuminance(faint) > 0.42 || luminanceContrast(rgb, faint) < 3.2) faint = [55, 65, 81];
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
export function syncInputTextColor(): void {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bgStr = cs.getPropertyValue("--input-bg").trim() || cs.getPropertyValue("--term-bg").trim();
  const rgb = parseCssColorToRgb(bgStr);
  if (!rgb) return;
  const lum = relLuminance(rgb);
  const lightIn = lum > 0.42;
  let fg: [number, number, number] = lightIn ? [17, 24, 39] : [249, 250, 251];
  if (lightIn) {
    if (relLuminance(fg) > 0.28 || luminanceContrast(rgb, fg) < 7) fg = [15, 23, 42];
  } else if (luminanceContrast(rgb, fg) < 5.0) {
    fg = [254, 254, 255];
  }
  root.style.setProperty("--input-text", toHex(fg));
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
  const lumBg = relLuminance(bg);
  const lumFg = relLuminance(fg);
  const lightBg = lumBg > 0.45;
  const needsFix = lightBg
    ? lumFg > 0.28 || luminanceContrast(bg, fg) < 7
    : lumFg < 0.65 || luminanceContrast(bg, fg) < 7;
  if (!needsFix) return;

  const next = toHex(lightBg ? [24, 24, 27] : [248, 250, 252]);
  root.style.setProperty("--term-fg", next);
  const cursorRgb = parseCssColorToRgb(cs.getPropertyValue("--term-cursor").trim());
  const cursorOk =
    cursorRgb &&
    (lightBg
      ? relLuminance(cursorRgb) <= 0.35 && luminanceContrast(bg, cursorRgb) >= 4.5
      : relLuminance(cursorRgb) >= 0.6 && luminanceContrast(bg, cursorRgb) >= 4.5);
  if (!cursorOk) root.style.setProperty("--term-cursor", next);
}

/** Live-preview CSS vars (theme builder) without changing font prefs. */
export function previewThemeCssVars(vars: ThemeCssVars): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    if (k.startsWith("--")) root.style.setProperty(k, v);
  }
  syncUiGrayScale();
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
  { id: "palenight", label: "Palenight", description: "Material-inspired dusk palette", variants: [{ id: "default", label: "Default" }] },
  { id: "monokai", label: "Monokai", description: "Classic high-contrast coding palette", variants: [{ id: "default", label: "Default" }] },
  { id: "github-dark", label: "GitHub Dark", description: "GitHub dark developer palette", variants: [{ id: "default", label: "Default" }] },
  { id: "github-light", label: "GitHub Light", description: "GitHub light developer palette", variants: [{ id: "default", label: "Default" }] },
  { id: "night-owl", label: "Night Owl", description: "Blue night coding palette", variants: [{ id: "default", label: "Default" }] },
  { id: "synthwave-84", label: "Synthwave '84", description: "Neon retro terminal palette", variants: [{ id: "default", label: "Default" }] },
  { id: "carbonfox", label: "Carbonfox", description: "Low-glare IBM Carbon-inspired palette", variants: [{ id: "default", label: "Default" }] },
];

export function defaultVariantForTheme(themeId: string): string {
  const t = THEME_OPTIONS.find((x) => x.id === themeId);
  return t?.variants[0]?.id ?? "default";
}
