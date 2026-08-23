import { clearPaneLayout } from "./paneLayout";
import {
  COMMAND_PALETTE_POS_KEY,
  DEFER_PTY_REINIT_KEY,
  HELP_PANEL_POS_KEY,
  SESSION_SHED_ON_EXIT_KEY,
  SETTINGS_PANEL_POS_KEY,
  TAB_LAYOUT_PREFIX,
  TABS_STATE_KEY,
  THEME_MODAL_POS_KEY,
  ZEN_MODE_KEY,
} from "./storageKeys";

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
    localStorage.removeItem(ZEN_MODE_KEY);
    localStorage.removeItem(DEFER_PTY_REINIT_KEY);
    localStorage.removeItem(THEME_MODAL_POS_KEY);
    localStorage.removeItem(SETTINGS_PANEL_POS_KEY);
    localStorage.removeItem(HELP_PANEL_POS_KEY);
    localStorage.removeItem(COMMAND_PALETTE_POS_KEY);
  } catch {
    /* ignore */
  }
}
