export function workspaceRootPaneId(tabId: string): string {
  const safe = tabId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `wsroot_${safe}`;
}
