import type { PaneNode } from "./paneHost";
import type { PersistedPaneLayout } from "./paneLayout";
import type { PaneThemePrefs } from "./uiTheme";
import { workspaceRootPaneId } from "./workspacePaneIds";
import type { WorkspaceLayout } from "./workspaces";

function collectLeafIds(node: PaneNode, out: string[]): void {
  if (node.kind === "leaf") {
    out.push(node.id);
    return;
  }
  collectLeafIds(node.a, out);
  collectLeafIds(node.b, out);
}

function portableRootId(ids: string[]): string {
  const wsroot = ids.find((id) => id.startsWith("wsroot_"));
  if (wsroot) return wsroot;
  return ids[0] ?? "root";
}

function buildIdNormalization(ids: string[]): Map<string, string> {
  const rootId = portableRootId(ids);
  const norm = new Map<string, string>();
  norm.set(rootId, "root");
  let i = 1;
  for (const id of ids) {
    if (id === rootId) continue;
    norm.set(id, `p${i}`);
    i += 1;
  }
  return norm;
}

function mapTreeIds(node: PaneNode, idMap: Map<string, string>): PaneNode {
  if (node.kind === "leaf") {
    return { kind: "leaf", id: idMap.get(node.id) ?? node.id };
  }
  return { ...node, a: mapTreeIds(node.a, idMap), b: mapTreeIds(node.b, idMap) };
}

function mapRecord<T>(src: Record<string, T> | undefined, idMap: Map<string, string>): Record<string, T> | undefined {
  if (!src) return undefined;
  const out: Record<string, T> = {};
  for (const [id, val] of Object.entries(src)) {
    out[idMap.get(id) ?? id] = val;
  }
  return out;
}

export type LayoutSnapshotInput = {
  layout: PersistedPaneLayout;
  paneThemes: Map<string, PaneThemePrefs>;
  paneNames: Map<string, string>;
  paneCwdHints: Map<string, string>;
  paneProfileIds: Map<string, string>;
  startupCommands?: Map<string, string>;
};

export function normalizeLayoutForWorkspace(input: LayoutSnapshotInput): WorkspaceLayout {
  const {
    layout,
    paneThemes,
    paneNames,
    paneCwdHints,
    paneProfileIds,
    startupCommands,
  } = input;
  const ids: string[] = [];
  collectLeafIds(layout.tree, ids);
  const idNorm = buildIdNormalization(ids);

  return {
    v: 1,
    tree: mapTreeIds(layout.tree, idNorm),
    focusedId: idNorm.get(layout.focusedId) ?? layout.focusedId,
    floating: mapRecord(layout.floating, idNorm),
    paneThemes: mapRecord(
      Object.fromEntries(
        ids.filter((id) => paneThemes.has(id)).map((id) => [id, paneThemes.get(id)!]),
      ),
      idNorm,
    ),
    paneNames: mapRecord(
      Object.fromEntries(
        ids.filter((id) => paneNames.has(id)).map((id) => [id, paneNames.get(id)!]),
      ),
      idNorm,
    ),
    paneCwds: mapRecord(
      Object.fromEntries(
        ids.filter((id) => paneCwdHints.has(id)).map((id) => [id, paneCwdHints.get(id)!]),
      ),
      idNorm,
    ),
    paneProfileIds: mapRecord(
      Object.fromEntries(
        ids.filter((id) => paneProfileIds.has(id)).map((id) => [id, paneProfileIds.get(id)!]),
      ),
      idNorm,
    ),
    startupCommands:
      mapRecord(
        Object.fromEntries(
          ids
            .filter((id) => startupCommands?.has(id))
            .map((id) => [id, startupCommands!.get(id)!]),
        ),
        idNorm,
      ) ?? {},
  };
}

export function remapWorkspaceLayoutForTab(
  layout: WorkspaceLayout,
  tabId: string,
): { layout: PersistedPaneLayout; idMap: Map<string, string> } {
  const ids: string[] = [];
  collectLeafIds(layout.tree, ids);
  const savedRoot = ids.find((id) => id === "root" || id.startsWith("wsroot_")) ?? ids[0];
  const newRoot = workspaceRootPaneId(tabId);
  const idMap = new Map<string, string>();
  if (savedRoot) idMap.set(savedRoot, newRoot);
  for (const id of ids) {
    if (!idMap.has(id)) idMap.set(id, crypto.randomUUID());
  }

  return {
    layout: {
      v: 1,
      tree: mapTreeIds(layout.tree, idMap),
      focusedId: idMap.get(layout.focusedId) ?? newRoot,
      floating: mapRecord(layout.floating, idMap),
      paneThemes: mapRecord(layout.paneThemes, idMap),
      paneNames: mapRecord(layout.paneNames, idMap),
      paneCwds: mapRecord(layout.paneCwds, idMap),
      paneProfileIds: mapRecord(layout.paneProfileIds, idMap),
    },
    idMap,
  };
}
