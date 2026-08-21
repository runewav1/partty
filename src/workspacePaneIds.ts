import { formatPaneId } from "./paneIds";

/** Default root leaf for an empty tab (`1a`, `2a`, …). */
export function workspaceRootPaneId(tabKey = "1"): string {
  return formatPaneId(tabKey, "a");
}
