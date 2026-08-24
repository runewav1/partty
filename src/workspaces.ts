import { invoke } from "@tauri-apps/api/core";

import type { FloatingPaneState, PaneNode } from "./paneHost";
import type { PaneThemePrefs } from "./uiTheme";

/** Mirrors the Rust `WorkspaceLayoutDto` (`src-tauri/src/workspaces.rs`). */
export type WorkspaceLayout = {
  tree: PaneNode;
  focusedId: string;
  floating: Record<string, FloatingPaneState>;
  paneThemes: Record<string, PaneThemePrefs>;
  paneCwds: Record<string, string>;
  paneProfileIds: Record<string, string>;
  startupCommands: Record<string, string>;
};

/** Mirrors the Rust `WorkspaceDto`. Pane ids are local to the file. */
export type Workspace = {
  version: 1;
  id: string;
  name: string;
  tabName: string | null;
  layout: WorkspaceLayout;
};

export function listWorkspaceIds(): Promise<string[]> {
  return invoke<string[]>("list_workspaces");
}

export function readWorkspace(id: string): Promise<Workspace> {
  return invoke<Workspace>("read_workspace", { id });
}
