import { clearPaneLayout } from "./paneLayout";

/** Mirrors `prefs.shed_workspace_exit` (`keep` | `shed` | `ask`). */
export const RUNTIME_SHED_WORKSPACE_EXIT_KEY = "termie.runtime.shed_workspace_exit";

const TABS_STATE_KEY = "termie.tabs.v1";
const TAB_LAYOUT_PREFIX = "termie.tab.layout.v1.";
const MINIMAP_STORAGE_KEY = "termie.minimap.enabled";
const MINIMAP_HIDDEN_PANES_KEY = "termie.minimap.hiddenPanes";
const ZEN_MODE_STORAGE_KEY = "termie.zen.enabled";
const DEFER_PTY_REINIT_KEY = "termie.defer_pty_reinit";
const THEME_MODAL_POS = "termie.themeModal.pos";
const SEARCH_MODAL_POS = "termie.searchModal.pos";
const SETTINGS_PANEL_POS = "termie.settingsPanel.pos";
const HELP_PANEL_POS = "termie.helpPanel.pos";
const COMMAND_PALETTE_POS = "termie.commandPalette.pos";

export type ShedWorkspaceExitMode = "keep" | "shed" | "ask";

export function syncRuntimeShedFromPrefs(prefs: { shed_workspace_exit?: string }): void {
  try {
    const v = normalizeShedMode(prefs.shed_workspace_exit);
    localStorage.setItem(RUNTIME_SHED_WORKSPACE_EXIT_KEY, v);
  } catch {
    /* ignore */
  }
}

function normalizeShedMode(raw: string | undefined): ShedWorkspaceExitMode {
  const s = (raw ?? "keep").toLowerCase().trim();
  if (s === "shed" || s === "always" || s === "on" || s === "true") return "shed";
  if (s === "ask") return "ask";
  return "keep";
}

export function getShedWorkspaceExitMode(): ShedWorkspaceExitMode {
  try {
    return normalizeShedMode(localStorage.getItem(RUNTIME_SHED_WORKSPACE_EXIT_KEY) ?? undefined);
  } catch {
    return "keep";
  }
}

/** Silent shed on exit (no dialog). */
export function shouldShedWorkspaceOnExitSilent(): boolean {
  return getShedWorkspaceExitMode() === "shed";
}

/** @deprecated use shouldShedWorkspaceOnExitSilent */
export function shouldShedWorkspaceOnExit(): boolean {
  return shouldShedWorkspaceOnExitSilent();
}

/** Clear workspace/session localStorage; keeps prefs (Rust), palette commands, file tree width, etc. */
export function shedWorkspaceLocalState(): void {
  try {
    localStorage.removeItem(TABS_STATE_KEY);
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith(TAB_LAYOUT_PREFIX)) localStorage.removeItem(k);
    }
    clearPaneLayout();
    localStorage.removeItem(MINIMAP_STORAGE_KEY);
    localStorage.removeItem(MINIMAP_HIDDEN_PANES_KEY);
    localStorage.removeItem(ZEN_MODE_STORAGE_KEY);
    localStorage.removeItem(DEFER_PTY_REINIT_KEY);
    localStorage.removeItem(THEME_MODAL_POS);
    localStorage.removeItem(SEARCH_MODAL_POS);
    localStorage.removeItem(SETTINGS_PANEL_POS);
    localStorage.removeItem(HELP_PANEL_POS);
    localStorage.removeItem(COMMAND_PALETTE_POS);
  } catch {
    /* ignore */
  }
}
