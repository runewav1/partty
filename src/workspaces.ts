import { invoke } from "@tauri-apps/api/core";

import type { FloatingPaneState, PaneNode } from "./paneHost";
import type { PaneThemePrefs } from "./uiTheme";

export type WorkspaceLayout = {
  v: 1;
  tree: PaneNode;
  focusedId: string;
  floating?: Record<string, FloatingPaneState>;
  paneThemes?: Record<string, PaneThemePrefs>;
  paneNames?: Record<string, string>;
  paneCwds?: Record<string, string>;
  paneProfileIds?: Record<string, string>;
  startupCommands?: Record<string, string>;
};

export type Workspace = {
  version: number;
  name: string;
  layout: WorkspaceLayout;
};

type WorkspaceIpc = {
  version: number;
  id: string;
  name: string;
  tabName: string;
  layout: WorkspaceLayout;
};

export function workspaceIdFromName(name: string): string {
  const slug = name
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "workspace";
  if (/^\d+$/.test(slug)) return `tab-${slug}`;
  return slug;
}

function packWorkspace(workspace: Workspace): WorkspaceIpc {
  const trimmed = workspace.name.trim();
  const id = workspaceIdFromName(trimmed);
  return {
    version: workspace.version,
    id,
    name: trimmed,
    tabName: trimmed,
    layout: workspace.layout,
  };
}

function unpackWorkspace(raw: WorkspaceIpc): Workspace {
  return {
    version: raw.version,
    name: raw.name.trim() || raw.id,
    layout: raw.layout,
  };
}

export function listWorkspaceNames(): Promise<string[]> {
  return invoke<string[]>("list_workspaces");
}

export function readWorkspace(name: string): Promise<Workspace> {
  return invoke<WorkspaceIpc>("read_workspace", { name }).then(unpackWorkspace);
}

export function writeWorkspace(workspace: Workspace): Promise<void> {
  return invoke("write_workspace", { workspace: packWorkspace(workspace) });
}

export function deleteWorkspace(name: string): Promise<void> {
  return invoke("delete_workspace", { name: workspaceIdFromName(name) });
}
