import type { Terminal } from "@xterm/xterm";

import type { PaneNode } from "./paneHost";

export type SearchHit = { paneId: string; line: number };

/** Case-insensitive substring match on buffer lines. */
export function findMatchingBufferLines(term: Terminal, query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const buf = term.buffer.active;
  const out: number[] = [];
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const s = line.translateToString(true).toLowerCase();
    if (s.includes(q)) out.push(i);
  }
  return out;
}

/**
 * Order hits for multi-pane search: older split (`a`) before newer (`b`), except when both
 * children are leaf panes with matches — then shuffle sibling order once per build.
 */
export function mergeHitsForNavigation(
  tree: PaneNode,
  matches: Map<string, number[]>,
): SearchHit[] {
  return collectHits(tree, matches);
}

function collectHits(node: PaneNode, matches: Map<string, number[]>): SearchHit[] {
  if (node.kind === "leaf") {
    const lines = matches.get(node.id);
    if (!lines?.length) return [];
    return [...lines].sort((a, b) => a - b).map((line) => ({ paneId: node.id, line }));
  }
  const left = collectHits(node.a, matches);
  const right = collectHits(node.b, matches);
  const aLeaf = node.a.kind === "leaf";
  const bLeaf = node.b.kind === "leaf";
  if (aLeaf && bLeaf && left.length > 0 && right.length > 0) {
    return Math.random() < 0.5 ? [...left, ...right] : [...right, ...left];
  }
  return [...left, ...right];
}
