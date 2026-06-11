import { invoke } from "@tauri-apps/api/core";
import type { PaneNode, FloatingPaneState } from "./paneHost";
import type { PaneThemePrefs } from "./uiTheme";

export type Preset = {
  v: 1;
  name: string;
  tabName: string;
  tree: PaneNode;
  focusedId: string;
  floating: Record<string, FloatingPaneState>;
  paneThemes: Record<string, PaneThemePrefs>;
  paneNames: Record<string, string>;
  paneCwds: Record<string, string>;
  paneFontSizes: Record<string, number>;
  startupCommands: Record<string, string>;
};

export function listPresetNames(): Promise<string[]> {
  return invoke<string[]>("list_preset_names");
}

export function readPresetJson(name: string): Promise<string> {
  return invoke<string>("read_preset_json", { name });
}

export function writePresetJson(name: string, json: string): Promise<void> {
  return invoke("write_preset_json", { name, json });
}

export function deletePresetJson(name: string): Promise<void> {
  return invoke("delete_preset_json", { name });
}
