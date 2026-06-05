/** Stable root leaf id per workspace tab so PTYs/xterm buffers never cross tabs. */
export function workspaceRootPaneId(tabId: string): string {
  const safe = tabId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `wsroot_${safe}`;
}
