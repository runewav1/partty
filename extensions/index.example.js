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
		api.showNotification("Agent waiting", "Respond in the pane", {
			paneId,
			buttons: [
				{ label: "Approve", run: () => api.writeToPane(paneId, "yes\n") },
			],
		});
	}
});

// ── Process lifecycle — track which pane is running what
api.onProcessStart((proc) => {
	console.debug("[ext] Process started:", proc.command, "in pane", proc.paneId);
});

api.onProcessEnd((proc) => {
	console.debug(
		"[ext] Process ended:",
		proc.command,
		`(${(proc.durationMs / 1000).toFixed(1)}s)`,
	);
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
console.debug(
	"[ext] Theme:",
	appTheme.ui.ui_theme,
	appTheme.ui.ui_theme_variant,
);

// ── Extension-scoped preference (survives restarts)
const count = (api.getPref("launchCount", 0) || 0) + 1;
api.setPref("launchCount", count);

api.showNotification(
	"Extension loaded",
	`Launched ${count} time${count === 1 ? "" : "s"}`,
);

// ── Tab bar (optional)
// Center the strip; keep extra widgets visible while tabs shrink/scroll.
//
// api.setTabBarLayout({ tabJustify: "start", grow: false });
//
// api.registerTabRenderer((tab, el) => {
//   const dot = document.createElement("span");
//   dot.style.cssText =
//     "width:8px;height:8px;border-radius:50%;display:inline-block;" +
//     `background:${tab.active ? "#fff" : tab.color || "#888"}`;
//   el.replaceChildren(dot);
// });
//
// api.registerTabBarItem({
//   id: "clock",
//   slot: "leading",
//   order: 2,
//   mount(el) {
//     const n = document.createElement("span");
//     const tick = () => {
//       n.textContent = new Date().toLocaleTimeString();
//     };
//     tick();
//     const t = setInterval(tick, 1000);
//     el.append(n);
//     return () => clearInterval(t);
//   },
// });
//
// api.registerTabBarItem({
//   id: "pane-id",
//   slot: "leading",
//   order: 1,
//   mount(el) {
//     el.style.opacity = "0.7";
//     el.style.fontSize = "11px";
//   },
//   update(el) {
//     const tab = api.getTabs().find((t) => t.active);
//     el.textContent = tab?.focusedPaneId ?? "";
//   },
// });
