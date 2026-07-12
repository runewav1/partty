import type { PaneNode, PaneSplit } from "./paneHost";
import { collectLeafIds } from "./paneHost";

export function replaceLeafInTree(
  tree: PaneNode,
  leafId: string,
  replacement: PaneNode,
): PaneNode | null {
  if (tree.kind === "leaf") {
    return tree.id === leafId ? replacement : null;
  }
  const na = replaceLeafInTree(tree.a, leafId, replacement);
  if (na) return { ...tree, a: na };
  const nb = replaceLeafInTree(tree.b, leafId, replacement);
  if (nb) return { ...tree, b: nb };
  return null;
}

export function removeLeafFromTree(tree: PaneNode, leafId: string): PaneNode | null {
  if (tree.kind === "leaf") return tree.id === leafId ? null : tree;
  const a = removeLeafFromTree(tree.a, leafId);
  const b = removeLeafFromTree(tree.b, leafId);
  if (a == null) return b;
  if (b == null) return a;
  return { ...tree, a, b };
}

function getPathToLeaf(tree: PaneNode, id: string): string | null {
  if (tree.kind === "leaf") return tree.id === id ? "" : null;
  const l = getPathToLeaf(tree.a, id);
  if (l !== null) return `a${l}`;
  const r = getPathToLeaf(tree.b, id);
  if (r !== null) return `b${r}`;
  return null;
}

function getNodeByPath(tree: PaneNode, path: string): PaneNode {
  let cur: PaneNode = tree;
  for (const ch of path) {
    if (cur.kind !== "split") throw new Error("getNodeByPath: path too deep");
    cur = ch === "a" ? cur.a : cur.b;
  }
  return cur;
}

function setNodeByPath(tree: PaneNode, path: string, newNode: PaneNode): PaneNode {
  if (path === "") return newNode;
  const ch = path[0];
  const rest = path.slice(1);
  if (tree.kind !== "split") {
    throw new Error("setNodeByPath: path into leaf");
  }
  if (ch === "a") return { ...tree, a: setNodeByPath(tree.a, rest, newNode) };
  return { ...tree, b: setNodeByPath(tree.b, rest, newNode) };
}

export function swapLeafNodesInTree(
  tree: PaneNode,
  idA: string,
  idB: string,
): PaneNode | null {
  if (idA === idB) return tree;
  const pA = getPathToLeaf(tree, idA);
  const pB = getPathToLeaf(tree, idB);
  if (pA === null || pB === null) return null;
  const nodeA = getNodeByPath(tree, pA);
  const nodeB = getNodeByPath(tree, pB);
  if (nodeA.kind !== "leaf" || nodeB.kind !== "leaf") return null;
  let next = setNodeByPath(tree, pA, nodeB);
  next = setNodeByPath(next, pB, nodeA);
  return next;
}

export function splitLeafInTree(
  tree: PaneNode,
  leafId: string,
  dir: "h" | "v",
): { tree: PaneNode; newLeafId: string } | null {
  const newId = crypto.randomUUID();
  const rep: PaneSplit = {
    kind: "split",
    dir,
    ratio: 0.5,
    a: { kind: "leaf", id: leafId },
    b: { kind: "leaf", id: newId },
  };
  const next = replaceLeafInTree(tree, leafId, rep);
  if (!next) return null;
  return { tree: next, newLeafId: newId };
}

export function setSplitRatioAtPath(
  tree: PaneNode,
  path: string,
  ratio: number,
): PaneNode {
  const node = getNodeByPath(tree, path);
  if (node.kind !== "split") return tree;
  const clamped = Math.max(0.05, Math.min(0.95, ratio));
  return setNodeByPath(tree, path, { ...node, ratio: clamped });
}

export function listLeafIds(tree: PaneNode): string[] {
  const out: string[] = [];
  collectLeafIds(tree, out);
  return out;
}

export { collectLeafIds };
