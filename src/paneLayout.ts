import type { FloatingPaneState, PaneNode } from "./paneHost";
import type { PaneThemePrefs } from "./uiTheme";
import { findPaneLeaf, MAIN_PANE_ID } from "./paneHost";

export const PANE_LAYOUT_STORAGE_KEY = "partty.pane_layout.v1";

export type PersistedPaneLayout = {
  v: 1;
  tree: PaneNode;
  focusedId: string;
  floating?: Record<string, FloatingPaneState>;
  paneThemes?: Record<string, PaneThemePrefs>;
};

function collectLeafIdsArr(node: PaneNode, out: string[]): void {
  if (node.kind === "leaf") {
    out.push(node.id);
    return;
  }
  collectLeafIdsArr(node.a, out);
  collectLeafIdsArr(node.b, out);
}

/** Layout is valid if it includes legacy `main` or a per-tab `wsroot_*` root leaf. */
export function layoutContainsWorkspaceRoot(tree: PaneNode): boolean {
  const ids: string[] = [];
  collectLeafIdsArr(tree, ids);
  return ids.some((id) => id === MAIN_PANE_ID || id.startsWith("wsroot_"));
}

export function validatePaneTree(node: unknown): node is PaneNode {
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
    const raw = localStorage.getItem(PANE_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPaneLayout>;
    if (parsed.v !== 1 || !parsed.tree || typeof parsed.focusedId !== "string") return null;
    if (!validatePaneTree(parsed.tree)) return null;
    if (!layoutContainsWorkspaceRoot(parsed.tree)) return null;
    return { v: 1, tree: parsed.tree, focusedId: parsed.focusedId, floating: parsed.floating, paneThemes: parsed.paneThemes };
  } catch {
    return null;
  }
}

/** Walk the live pane DOM under `.pane-host` and build a tree (ratios reflect current drag state). */
export function snapshotTreeFromPaneHost(root: HTMLElement): PaneNode | null {
  const top = root.firstElementChild;
  if (!top) return null;
  return walkEl(top);
}

function walkEl(el: Element): PaneNode {
  if (el.classList.contains("pane-leaf")) {
    const id = el.getAttribute("data-pane-id");
    if (!id) throw new Error("pane-leaf missing data-pane-id");
    return { kind: "leaf", id };
  }
  if (el.classList.contains("pane-split")) {
    const dir = el.getAttribute("data-split-dir") as "h" | "v" | null;
    if (dir !== "h" && dir !== "v") throw new Error("pane-split missing dir");
    const r = parseFloat(el.getAttribute("data-ratio") ?? "0.5");
    const ratio = Number.isFinite(r) ? Math.max(0.05, Math.min(0.95, r)) : 0.5;
    const cells = el.querySelectorAll(":scope > :not(.pane-gutter)");
    if (cells.length < 2) throw new Error("pane-split missing children");
    return {
      kind: "split",
      dir,
      ratio,
      a: walkEl(cells[0]),
      b: walkEl(cells[1]),
    };
  }
  throw new Error(`unexpected pane node: ${el.className}`);
}

export function savePaneLayout(root: HTMLElement, focusedId: string): void {
  try {
    const tree = snapshotTreeFromPaneHost(root);
    if (!tree || !layoutContainsWorkspaceRoot(tree)) return;
    const payload: PersistedPaneLayout = { v: 1, tree, focusedId };
    localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function clearPaneLayout(): void {
  try {
    localStorage.removeItem(PANE_LAYOUT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isLayoutValidForRoot(layout: PersistedPaneLayout, rootId: string): boolean {
  return validatePaneTree(layout.tree) && findPaneLeaf(layout.tree, rootId) != null;
}
