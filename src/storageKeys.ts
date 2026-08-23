export const TABS_STATE_KEY = "partty.tabs.v1";
export const TAB_LAYOUT_PREFIX = "partty.tab.layout.v1.";
export const PANE_LAYOUT_KEY = "partty.pane_layout.v1";
export const ZEN_MODE_KEY = "partty.zen.enabled";
/** Set when shell / initial cwd change; next `partty-prepare-show` runs a full PTY reinit. */
export const DEFER_PTY_REINIT_KEY = "partty.defer_pty_reinit";
export const SESSION_SHED_ON_EXIT_KEY = "partty.runtime.session_shed_on_exit";
export const THEME_MODAL_POS_KEY = "partty.themeModal.pos";
export const SETTINGS_PANEL_POS_KEY = "partty.settingsPanel.pos";
export const HELP_PANEL_POS_KEY = "partty.helpPanel.pos";
export const COMMAND_PALETTE_POS_KEY = "partty.commandPalette.pos";
export const DEV_OVERLAY_POS_KEY = "partty.dev-overlay.pos";
export const PERF_KEY = "partty.perf";
export const PERF_CONSOLE_KEY = "partty.perf.console";
export const PERF_INTERVAL_MS_KEY = "partty.perf.intervalMs";

export function tabLayoutKey(tabId: string): string {
  return `${TAB_LAYOUT_PREFIX}${tabId}`;
}