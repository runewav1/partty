/**
 * Sample Partty runtime extension.
 *
 * Installation:
 *   %LOCALAPPDATA%/partty/extensions/my-extension/index.js
 *
 * The app executes this file as the body of function(api) { ... }.
 * `api` is the ExtensionApi object (see api.d.ts for types).
 * No imports or build step needed — just plain JS.
 */

// ── Metadata
console.log("[ext] App version:", api.getAppVersion());

// ── PTY observation
const unsub = api.onPtyOutput((paneId, data) => {
  if (data.includes("NEEDS PERMISSION")) {
    api.showNotification("Agent waiting", "Respond in the pane", paneId);
  }
});

// ── Process lifecycle — track which pane is running what
api.onProcessStart((proc) => {
  console.debug("[ext] Process started:", proc.command, "in pane", proc.paneId);
});

api.onProcessEnd((proc) => {
  console.debug("[ext] Process ended:", proc.command,
    `(${(proc.durationMs / 1000).toFixed(1)}s)`);
});

// ── Tab lifecycle
api.onTabSwitch((tabId) => {
  console.debug("[ext] Switched to tab:", tabId);
});

// ── Window lifecycle
api.onWindowShow(() => {
  console.debug("[ext] Window shown");
});

api.onWindowHide(() => {
  console.debug("[ext] Window hidden");
});

// ── Query active process in any pane
const focused = api.getFocusedPaneId();
if (focused) {
  const active = api.getPaneActiveProcess(focused);
  if (active) {
    console.debug("[ext] Active in focused pane:", active.command);
  }
}

// ── Read the current app theme
const appTheme = api.getAppTheme();
console.debug("[ext] Theme:", appTheme.ui.ui_theme, appTheme.ui.ui_theme_variant);

// ── Extension-scoped preference (survives restarts)
const count = (api.getPref("launchCount", 0) || 0) + 1;
api.setPref("launchCount", count);

api.showNotification(
  "Extension loaded",
  `Launched ${count} time${count === 1 ? "" : "s"}`
);
