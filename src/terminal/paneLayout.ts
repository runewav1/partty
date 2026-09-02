import type { FloatingPaneState, PaneNode } from "./paneHost";
import type { PaneThemePrefs } from "./uiTheme";
import { findPaneLeaf } from "./paneHost";
import { PANE_LAYOUT_KEY } from "./../util/storageKeys";

export type PersistedPaneLayout = {
  v: 1;
  tree: PaneNode;
  focusedId: string;
  floating?: Record<string, FloatingPaneState>;
  paneThemes?: Record<string, PaneThemePrefs>;
  paneCwds?: Record<string, string>;
  /** Per-pane connection profile ids (local / future WSL·SSH). */
  paneProfileIds?: Record<string, string>;
};

/** True when the tree contains at least one leaf pane. */
function hasLeafNodes(tree: PaneNode): boolean {
  if (tree.kind === "leaf") return true;
  return hasLeafNodes(tree.a) || hasLeafNodes(tree.b);
}

function validatePaneTree(node: unknown): node is PaneNode {
  if (!node || typeof node !== "object") return false;
  const o = node as Record<string, unknown>;
  if (o.kind === "leaf") {
    return typeof o.id === "string" && o.id.length > 0;
  }
  if (o.kind === "split") {
    const dir = o.dir;
    const ratio = o.ratio;
    if (dir !== "h" && dir !== "v") return false;
    if (typeof ratio !== "number" || ratio < 0.05 || ratio > 0.95) return false;
    if (!validatePaneTree(o.a) || !validatePaneTree(o.b)) return false;
    return true;
  }
  return false;
}

export function loadPaneLayout(): PersistedPaneLayout | null {
  try {
    const raw = localStorage.getItem(PANE_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPaneLayout>;
    if (parsed.v !== 1 || !parsed.tree || typeof parsed.focusedId !== "string") return null;
    if (!validatePaneTree(parsed.tree)) return null;
    if (!hasLeafNodes(parsed.tree)) return null;
    return {
      v: 1,
      tree: parsed.tree,
      focusedId: parsed.focusedId,
      floating: parsed.floating,
      paneThemes: parsed.paneThemes,
      paneCwds: parsed.paneCwds,
      paneProfileIds: parsed.paneProfileIds,
    };
  } catch {
    return null;
  }
}

export function clearPaneLayout(): void {
  try {
    localStorage.removeItem(PANE_LAYOUT_KEY);
  } catch {
    /* ignore */
  }
}

export function isLayoutValidForRoot(layout: PersistedPaneLayout, rootId: string): boolean {
  return validatePaneTree(layout.tree) && findPaneLeaf(layout.tree, rootId) != null;
}
