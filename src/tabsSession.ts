import type { PaneNode } from "./paneHost";
import { loadPaneLayout, type PersistedPaneLayout } from "./paneLayout";
import { workspaceRootPaneId } from "./workspacePaneIds";

/** Deep-copy layout with new tab root id and fresh UUIDs for split panes (duplicate tab). */
export function duplicateTabLayout(layout: PersistedPaneLayout, fromTabId: string, newTabId: string): PersistedPaneLayout {
  const oldRoot = workspaceRootPaneId(fromTabId);
  const newRoot = workspaceRootPaneId(newTabId);
  const ids: string[] = [];
  function collect(n: PaneNode): void {
    if (n.kind === "leaf") {
      ids.push(n.id);
      return;
    }
    collect(n.a);
    collect(n.b);
  }
  collect(layout.tree);
  const m = new Map<string, string>();
  for (const id of ids) {
    m.set(id, id === oldRoot ? newRoot : crypto.randomUUID());
  }
  function mapNode(n: PaneNode): PaneNode {
    if (n.kind === "leaf") {
      const nid = m.get(n.id);
      return { kind: "leaf", id: nid ?? newRoot };
    }
    return { ...n, a: mapNode(n.a), b: mapNode(n.b) };
  }
  const focused = m.get(layout.focusedId) ?? newRoot;
  return { v: 1, tree: mapNode(layout.tree), focusedId: focused };
}

const TABS_STATE_KEY = "termie.tabs.v1";
const TAB_LAYOUT_PREFIX = "termie.tab.layout.v1.";

export type TabGroup = {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
  order: number;
};

export type TabRecord = {
  id: string;
  name: string;
  groupId: string | null;
  color: string | null;
  order: number;
};

export type TabsStateV1 = {
  v: 1;
  tabs: TabRecord[];
  activeTabId: string;
  groups: TabGroup[];
};

export const emptyWorkspaceLayout = (tabId: string): PersistedPaneLayout => {
  const r = workspaceRootPaneId(tabId);
  return { v: 1, tree: { kind: "leaf", id: r }, focusedId: r };
};

/** Remap legacy `main` ids to this tab's root so PTYs never alias across tabs. */
export function migrateLayoutFromLegacyMain(layout: PersistedPaneLayout, tabId: string): PersistedPaneLayout {
  const rid = workspaceRootPaneId(tabId);
  function mapNode(n: PaneNode): PaneNode {
    if (n.kind === "leaf") {
      const id = n.id === "main" ? rid : n.id;
      return { kind: "leaf", id };
    }
    return { ...n, a: mapNode(n.a), b: mapNode(n.b) };
  }
  const focusedId = layout.focusedId === "main" ? rid : layout.focusedId;
  return { v: 1, tree: mapNode(layout.tree), focusedId };
}

function loadRawTabs(): TabsStateV1 {
  try {
    const raw = localStorage.getItem(TABS_STATE_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<TabsStateV1>;
    if (p.v !== 1 || !Array.isArray(p.tabs) || typeof p.activeTabId !== "string") throw new Error("bad");
    if (p.tabs.length === 0) throw new Error("no tabs");
    // Migrate old state without order field
    const tabs = p.tabs.map((t, i) => typeof t.order === "number" ? t : { ...t, order: i });
    const groups = (p.groups ?? []).map((g, i) => typeof g.order === "number" ? g : { ...g, order: i });
    return { v: 1, tabs, activeTabId: p.activeTabId, groups };
  } catch {
    return {
      v: 1,
      tabs: [{ id: "tab-1", name: "1", groupId: null, color: null, order: 0 }],
      activeTabId: "tab-1",
      groups: [],
    };
  }
}

export function loadTabsState(): TabsStateV1 {
  return loadRawTabs();
}

export function saveTabsState(s: TabsStateV1): void {
  try {
    localStorage.setItem(TABS_STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function tabLayoutKey(tabId: string): string {
  return `${TAB_LAYOUT_PREFIX}${tabId}`;
}

export function loadLayoutForTab(tabId: string): PersistedPaneLayout | null {
  try {
    const raw = localStorage.getItem(tabLayoutKey(tabId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedPaneLayout>;
    if (p.v !== 1 || !p.tree || typeof p.focusedId !== "string") return null;
    return { v: 1, tree: p.tree as PaneNode, focusedId: p.focusedId };
  } catch {
    return null;
  }
}

/** First layout for a tab: migrate global pane layout once, else per-tab or fresh root. */
export function initialLayoutForTab(tabId: string, isFirstTab: boolean): PersistedPaneLayout {
  if (isFirstTab) {
    const g = loadPaneLayout();
    if (g) return migrateLayoutFromLegacyMain(g, tabId);
  }
  const d = loadLayoutForTab(tabId);
  if (d) return migrateLayoutFromLegacyMain(d, tabId);
  return emptyWorkspaceLayout(tabId);
}

export function persistLayoutForTab(tabId: string, layout: PersistedPaneLayout): void {
  try {
    localStorage.setItem(tabLayoutKey(tabId), JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

export function nextTabName(tabs: TabRecord[]): string {
  let max = 0;
  for (const t of tabs) {
    const n = parseInt(t.name, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}
