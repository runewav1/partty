import { clearPaneLayout } from "./paneLayout";

export const SESSION_SHED_ON_EXIT_KEY = "partty.runtime.session_shed_on_exit";

const TABS_STATE_KEY = "partty.tabs.v1";
const TAB_LAYOUT_PREFIX = "partty.tab.layout.v1.";
const ZEN_MODE_STORAGE_KEY = "partty.zen.enabled";
const DEFER_PTY_REINIT_KEY = "partty.defer_pty_reinit";
const THEME_MODAL_POS = "partty.themeModal.pos";
const SETTINGS_PANEL_POS = "partty.settingsPanel.pos";
const HELP_PANEL_POS = "partty.helpPanel.pos";
const COMMAND_PALETTE_POS = "partty.commandPalette.pos";

export type SessionShedOnExitMode = "keep" | "shed" | "ask";

export function syncRuntimeShedFromPrefs(prefs: {
  session_shed_on_exit?: string;
}): void {
  try {
    const v = normalizeShedMode(prefs.session_shed_on_exit);
    localStorage.setItem(SESSION_SHED_ON_EXIT_KEY, v);
  } catch {
    /* ignore */
  }
}

function normalizeShedMode(raw: string | undefined): SessionShedOnExitMode {
  const s = (raw ?? "keep").toLowerCase().trim();
  if (s === "shed" || s === "always" || s === "on" || s === "true") return "shed";
  if (s === "ask") return "ask";
  return "keep";
}

export function getSessionShedOnExitMode(): SessionShedOnExitMode {
  try {
    return normalizeShedMode(localStorage.getItem(SESSION_SHED_ON_EXIT_KEY) ?? undefined);
  } catch {
    return "keep";
  }
}

export function shouldShedSessionOnExitSilent(): boolean {
  return getSessionShedOnExitMode() === "shed";
}

export function shedSessionLocalState(): void {
  try {
    localStorage.removeItem(TABS_STATE_KEY);
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith(TAB_LAYOUT_PREFIX)) localStorage.removeItem(k);
    }
    clearPaneLayout();
    localStorage.removeItem(ZEN_MODE_STORAGE_KEY);
    localStorage.removeItem(DEFER_PTY_REINIT_KEY);
    localStorage.removeItem(THEME_MODAL_POS);
    localStorage.removeItem(SETTINGS_PANEL_POS);
    localStorage.removeItem(HELP_PANEL_POS);
    localStorage.removeItem(COMMAND_PALETTE_POS);
  } catch {
    /* ignore */
  }
}
