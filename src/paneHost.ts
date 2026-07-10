import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { Terminal, type ITheme } from "@xterm/xterm";
import { parttyPerf } from "./perf";

export const MAIN_PANE_ID = "main";

export type PaneLeaf = { kind: "leaf"; id: string };
export type PaneSplit = {
  kind: "split";
  dir: "h" | "v";
  /** 0–1 fraction allocated to `a` */
  ratio: number;
  a: PaneNode;
  b: PaneNode;
};
export type PaneNode = PaneLeaf | PaneSplit;

export type PaneTerminal = {
  term: Terminal;
  fit: FitAddon;
  image: ImageAddon;
  ligatures: LigaturesAddon;
  serialize: SerializeAddon;
  host: HTMLElement;
  /** Row wrapping the terminal host element. */
  row: HTMLElement;
};

export type FloatingPaneState = {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
};

export type PaneDescriptor = {
  id: string;
  name?: string;
  type: "terminal";
  focused: boolean;
  floating: boolean;
  cols?: number;
  rows?: number;
  cellWidth?: number;
  cellHeight?: number;
  fontSize?: number;
};

/** Hyprland-inspired tiled insert styles (see `insertPaneNearFocused`). */
export type SplitLayoutStyle = "balanced" | "dwindle" | "master";

/** Default master-area fraction (Hyprland-style mfact). */
const MASTER_SPLIT_RATIO = 0.68;

export type PaneHostOptions = {
  scrollbackLines: number;
  fontStack: string;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  cursorInactiveStyle?: "outline" | "block" | "bar" | "underline" | "none";
  cursorWidth?: number;
  altClickMovesCursor: boolean;
  fontSize: number;
  fontWeight?: string;
  fontWeightBold?: string;
  lineHeight?: number;
  letterSpacing?: number;
  drawBoldTextInBrightColors: boolean;
  customGlyphs: boolean;
  smoothScrollDuration: number;
  scrollSensitivity?: number;
  fastScrollSensitivity?: number;
  minimumContrastRatio?: number;
  getTheme: (paneId: string) => ITheme;
  getPaneName?: (paneId: string) => string | undefined;
  getPaneCssVars?: (paneId: string) => Record<string, string> | null;
  getSplitLayoutStyle?: () => SplitLayoutStyle;
  focusFollowsCursor: () => boolean;
  onPaneFocus: (paneId: string) => void;
  onPaneSwapAdjacent?: (paneId: string, dir: "h" | "v") => boolean;
  onPaneCreated: (paneId: string, pt: PaneTerminal) => void;
  onPaneDisposed: (paneId: string) => void;
  /** Called after internal layout changes (split, gutter drag, mount) so PTY cols/rows stay in sync. */
  onPaneLayout?: () => void;
  /** Called while resize interactions preview DOM geometry so terminal fitting can be deferred. */
  onPaneLayoutDrag?: (dragging: boolean) => void;
  /** Called after pane positions change (e.g. drag-drop swap) so layout can be persisted. */
  onPaneReorder?: () => void;
  /** Root leaf id (per workspace tab). Defaults to `"main"`. */
  rootPaneId?: string;
  /** Handler for OSC 8 semantic hyperlinks. */
  linkHandler?: {
    activate: (event: MouseEvent, uri: string) => void;
    hover?: (event: MouseEvent, uri: string) => void;
    leave?: () => void;
  };
};

type SplitResizeAxis = "h" | "v";
type CornerEdge = "left" | "right" | "top" | "bottom";
type ResizeEdgeX = "left" | "right" | "none";
type ResizeEdgeY = "top" | "bottom" | "none";

type AncestorSplitInfo = {
  splitEl: HTMLElement;
  dir: SplitResizeAxis;
  sign: number;
  span: number;
  startRatio: number;
};

type LeafGeometry = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
};

export function findPaneLeaf(tree: PaneNode, id: string): PaneLeaf | null {
  if (tree.kind === "leaf") return tree.id === id ? tree : null;
  return findPaneLeaf(tree.a, id) ?? findPaneLeaf(tree.b, id);
}

function replaceLeaf(
  tree: PaneNode,
  leafId: string,
  replacement: PaneNode,
): PaneNode | null {
  if (tree.kind === "leaf") {
    return tree.id === leafId ? replacement : null;
  }
  const na = replaceLeaf(tree.a, leafId, replacement);
  if (na) return { ...tree, a: na };
  const nb = replaceLeaf(tree.b, leafId, replacement);
  if (nb) return { ...tree, b: nb };
  return null;
}

export function collectLeafIds(tree: PaneNode, out: string[]): void {
  if (tree.kind === "leaf") {
    out.push(tree.id);
    return;
  }
  collectLeafIds(tree.a, out);
  collectLeafIds(tree.b, out);
}

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** DFS path as "a"/"b" string (e.g. `"aa"` → root.a.a). Empty string = root node. */
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

/** Swap two leaf positions in the split tree (leaf ids / PTY bindings unchanged). */
function swapLeafNodesInTree(tree: PaneNode, idA: string, idB: string): PaneNode | null {
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

export type PaneHostInit = {
  initialTree?: PaneNode;
  initialFocusedId?: string;
  initialFloating?: Record<string, FloatingPaneState>;
  /** Terminals moved from another tab/host — mounted without calling `onPaneCreated`. */
  preloadedPanes?: Record<string, PaneTerminal>;
};

export class PaneHost {
  private tree: PaneNode;
  private focusedId: string;
  private rootPaneId: string;
  private readonly terminals = new Map<string, PaneTerminal>();
  private readonly root: HTMLElement;
  private readonly floating = new Map<string, FloatingPaneState>();
  private readonly justFloated = new Set<string>();
  private readonly justTiled = new Set<string>();
  private paneMoveRollback: {
    tree: PaneNode;
    focusedId: string;
    rootPaneId: string;
    floating: Map<string, FloatingPaneState>;
  } | null = null;
  private floatingZ = 50;
  private resizeObs: ResizeObserver | null = null;
  private layoutDragDepth = 0;
  private focusFollowPointer: ((ev: PointerEvent) => void) | null = null;
  private focusFollowRaf = 0;
  private pendingFocusFollowId: string | null = null;
  private paneDragActive = false;

  private readonly onPaneAltDragPointerDown = (e: PointerEvent): void => {
    if (!e.altKey || !e.ctrlKey || e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest(".pane-gutter") || t.closest(".pane-corner-handle")) return;
    const leaf = t.closest(".pane-leaf") as HTMLElement | null;
    if (!leaf || !this.root.contains(leaf)) return;
    const paneId = leaf.dataset.paneId;
    if (!paneId) return;
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    if (ids.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.floating.has(paneId)) this.beginFloatingPaneMove(leaf, paneId, e);
    else this.beginPaneSwapDrag(leaf, paneId, e);
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: PaneHostOptions,
    init?: PaneHostInit,
  ) {
    this.rootPaneId = opts.rootPaneId ?? MAIN_PANE_ID;
    this.tree = { kind: "leaf", id: this.rootPaneId };
    this.focusedId = this.rootPaneId;
    if (init?.initialTree && findPaneLeaf(init.initialTree, this.rootPaneId)) {
      this.tree = init.initialTree;
      const fid = init.initialFocusedId;
      if (fid && findPaneLeaf(this.tree, fid)) this.focusedId = fid;
    }
    for (const [id, state] of Object.entries(init?.initialFloating ?? {})) {
      if (!findPaneLeaf(this.tree, id)) continue;
      this.floating.set(id, { ...state });
      this.floatingZ = Math.max(this.floatingZ, state.z + 1);
    }
    for (const [id, pt] of Object.entries(init?.preloadedPanes ?? {})) {
      if (!findPaneLeaf(this.tree, id)) continue;
      this.terminals.set(id, pt);
    }
    this.root = document.createElement("div");
    this.root.className = "pane-host";
    this.container.appendChild(this.root);
    this.root.addEventListener("pointerdown", this.onPaneAltDragPointerDown, true);
    this.mountTree();
    this.resizeObs = new ResizeObserver(() => {
      if (this.layoutDragDepth > 0) return;
      this.opts.onPaneLayout?.();
    });
    this.resizeObs.observe(this.root);
  }

  getTree(): PaneNode {
    return this.tree;
  }

  getFloatingState(): Record<string, FloatingPaneState> {
    for (const [id, state] of this.floating) {
      const el = this.root.querySelector(`.pane-leaf--floating[data-pane-id="${CSS.escape(id)}"]`) as HTMLElement | null;
      if (!el) continue;
      state.width = el.offsetWidth || state.width;
      state.height = el.offsetHeight || state.height;
      state.x = el.offsetLeft;
      state.y = el.offsetTop;
    }
    return Object.fromEntries([...this.floating.entries()].map(([id, state]) => [id, { ...state }]));
  }

  getPaneDescriptors(): PaneDescriptor[] {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    return ids.map((id) => ({
      id,
      name: this.opts.getPaneName?.(id),
      type: "terminal" as const,
      focused: id === this.focusedId,
      floating: this.floating.has(id),
    }));
  }

  getFocusedPaneDescriptor(): PaneDescriptor | null {
    return this.getPaneDescriptor(this.focusedId);
  }

  private getLeafGeometries(): LeafGeometry[] {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    const geometries: LeafGeometry[] = [];
    for (const id of ids) {
      const el = this.root.querySelector(`.pane-leaf[data-pane-id="${CSS.escape(id)}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      geometries.push({
        id,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      });
    }
    return geometries;
  }

  getDirectionalAdjacentLeafId(fromId: string, dir: "h" | "v" | "left" | "right" | "up" | "down" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): string | null {
    if (!findPaneLeaf(this.tree, fromId)) return null;
    const current = this.getLeafGeometries().find((leaf) => leaf.id === fromId);
    if (!current) return null;
    const normalized =
      dir === "ArrowLeft" ? "left" :
      dir === "ArrowRight" ? "right" :
      dir === "ArrowUp" ? "up" :
      dir === "ArrowDown" ? "down" :
      dir;
    const horizontal = normalized === "left" || normalized === "right";
    const neg = normalized === "left" || normalized === "up";

    let best: { id: string; score: number } | null = null;
    for (const leaf of this.getLeafGeometries()) {
      if (leaf.id === fromId) continue;
      const dx = leaf.cx - current.cx;
      const dy = leaf.cy - current.cy;
      const directional = horizontal ? (neg ? dx < -6 : dx > 6) : (neg ? dy < -6 : dy > 6);
      if (!directional) continue;

      const overlap = horizontal
        ? overlapLen(current.top, current.bottom, leaf.top, leaf.bottom)
        : overlapLen(current.left, current.right, leaf.left, leaf.right);
      const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
      const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 0.75 - overlap * 0.2;

      if (!best || score < best.score) best = { id: leaf.id, score };
    }
    return best?.id ?? null;
  }

  swapPaneWithAdjacent(paneId: string, dir: "h" | "v" | "left" | "right" | "up" | "down" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): boolean {
    if (this.floating.has(paneId)) return false;
    const targetId = this.getDirectionalAdjacentLeafId(paneId, dir);
    if (!targetId) return false;
    return this.swapPanes(paneId, targetId);
  }

  getPaneDescriptor(paneId: string, includeMetrics = false): PaneDescriptor | null {
    if (!findPaneLeaf(this.tree, paneId)) return null;
    const base: PaneDescriptor = {
      id: paneId,
      name: this.opts.getPaneName?.(paneId),
      type: "terminal",
      focused: paneId === this.focusedId,
      floating: this.floating.has(paneId),
    };
    if (!includeMetrics) return base;
    const pt = this.terminals.get(paneId);
    if (!pt) return { ...base, cols: 0, rows: 0, cellWidth: 0, cellHeight: 0, fontSize: 12 };
    const rect = pt.host.getBoundingClientRect();
    const cols = pt.term.cols;
    const rows = pt.term.rows;
    return {
      ...base,
      cols,
      rows,
      cellWidth: cols > 0 ? rect.width / cols : 0,
      cellHeight: rows > 0 ? rect.height / rows : 0,
      fontSize: Number(pt.term.options.fontSize ?? 12),
    };
  }

  setPaneFontSize(paneId: string, fontSize: number): boolean {
    const pt = this.terminals.get(paneId);
    if (!pt) return false;
    pt.term.options.fontSize = Math.max(6, Math.min(32, fontSize));
    pt.fit.fit();
    this.opts.onPaneLayout?.();
    return true;
  }

  setScrollbackLines(lines: number): void {
    const scrollback = Math.max(0, Math.min(50_000, Math.floor(lines)));
    this.opts.scrollbackLines = scrollback;
    for (const pt of this.terminals.values()) {
      pt.term.options.scrollback = scrollback;
    }
  }

  setCursorStyle(style: "block" | "underline" | "bar"): void {
    this.opts.cursorStyle = style;
    for (const pt of this.terminals.values()) {
      pt.term.options.cursorStyle = style;
    }
  }

  /** Root `.pane-host` element (for layout snapshot before webview teardown). */
  getHostRoot(): HTMLElement {
    return this.root;
  }

  getFocusedPaneId(): string {
    return this.focusedId;
  }

  /** Root leaf id for this tab; advances to the next tree-order leaf when the current root is removed. */
  getRootPaneId(): string {
    return this.rootPaneId;
  }

  setFocusedPaneId(id: string): void {
    if (!findPaneLeaf(this.tree, id)) return;
    this.focusedId = id;
    this.updateFocusClass();
    this.opts.onPaneFocus(id);
    if (this.floating.has(id)) this.bringFloatingPaneToFront(id);
  }

  private updateFocusClass(): void {
    this.root.querySelectorAll(".pane-leaf").forEach((el) => {
      const pid = (el as HTMLElement).dataset.paneId;
      el.classList.toggle("pane-leaf--focused", pid === this.focusedId);
    });
  }

  /**
   * Split the focused pane. `dir` is honored for **balanced**; dwindle/master
   * choose direction from layout rules (Hyprland-inspired). Explicit hotkeys
   * still call this with h/v — those act as hints only outside balanced.
   */
  splitFocused(dir: "h" | "v"): string | null {
    if (this.floating.has(this.focusedId)) return null;
    const newId = crypto.randomUUID();
    return this.insertPaneNearFocused(newId, dir, true);
  }

  takePane(paneId: string, opts?: { saveRollback?: boolean }): PaneTerminal | null {
    const pt = this.terminals.get(paneId);
    if (!pt) return null;
    if (opts?.saveRollback) {
      this.paneMoveRollback = {
        tree: structuredClone(this.tree),
        focusedId: this.focusedId,
        rootPaneId: this.rootPaneId,
        floating: new Map([...this.floating.entries()].map(([id, state]) => [id, { ...state }])),
      };
    }
    if (!this.detachLeafFromTree(paneId)) {
      if (opts?.saveRollback) this.paneMoveRollback = null;
      return null;
    }
    this.terminals.delete(paneId);
    this.floating.delete(paneId);
    this.mountTree();
    this.opts.onPaneLayout?.();
    if (this.focusedId === paneId) {
      const rest: string[] = [];
      collectLeafIds(this.tree, rest);
      this.setFocusedPaneId(rest[0] ?? this.rootPaneId);
    } else {
      this.updateFocusClass();
    }
    return pt;
  }

  /**
   * Detach the only leaf in this tab (PTY preserved). The tab shell is closed by the caller.
   */
  takeSolePane(paneId: string, opts?: { saveRollback?: boolean }): PaneTerminal | null {
    if (!this.isPristineRootTab()) return null;
    if (!findPaneLeaf(this.tree, paneId)) return null;
    const pt = this.terminals.get(paneId);
    if (!pt) return null;
    if (opts?.saveRollback) {
      this.paneMoveRollback = {
        tree: structuredClone(this.tree),
        focusedId: this.focusedId,
        rootPaneId: this.rootPaneId,
        floating: new Map([...this.floating.entries()].map(([id, state]) => [id, { ...state }])),
      };
    }
    try {
      pt.row.remove();
    } catch {
      /* ignore */
    }
    this.terminals.delete(paneId);
    this.floating.delete(paneId);
    return pt;
  }

  clearPaneMoveRollback(): void {
    this.paneMoveRollback = null;
  }

  restoreTakenPane(paneId: string, pt: PaneTerminal): boolean {
    const snap = this.paneMoveRollback;
    if (!snap) return false;
    if (this.rootPaneId !== snap.rootPaneId) {
      const placeholderPt = this.terminals.get(this.rootPaneId);
      if (placeholderPt && placeholderPt !== pt) {
        try {
          placeholderPt.fit.dispose();
          placeholderPt.term.dispose();
        } catch {
          /* ignore */
        }
        this.terminals.delete(this.rootPaneId);
        this.opts.onPaneDisposed(this.rootPaneId);
      }
    }
    this.tree = snap.tree;
    this.focusedId = snap.focusedId;
    this.rootPaneId = snap.rootPaneId;
    this.floating.clear();
    for (const [id, state] of snap.floating) this.floating.set(id, state);
    this.terminals.set(paneId, pt);
    this.paneMoveRollback = null;
    this.mountTree();
    this.opts.onPaneLayout?.();
    if (this.focusedId === paneId) {
      this.setFocusedPaneId(paneId);
    } else {
      this.updateFocusClass();
    }
    return true;
  }

  receivePane(paneId: string, pt: PaneTerminal, dir: "h" | "v" = "h"): boolean {
    if (findPaneLeaf(this.tree, paneId)) return false;
    this.terminals.set(paneId, pt);
    const inserted = this.insertPaneNearFocused(paneId, dir, false);
    if (!inserted) {
      this.terminals.delete(paneId);
      return false;
    }
    this.setFocusedPaneId(paneId);
    return true;
  }

  /** True when this tab is a lone root leaf (single-pane tab shell). */
  isPristineRootTab(): boolean {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    return ids.length === 1 && ids[0] === this.rootPaneId;
  }

  /**
   * Replace a placeholder root tab with a transferred pane (PTY id unchanged).
   * Disposes the empty root terminal if one was created on tab open.
   */
  rebindAsTransferredRoot(paneId: string, pt: PaneTerminal): boolean {
    if (!this.isPristineRootTab()) return false;
    const placeholderId = this.rootPaneId;
    const placeholderPt = this.terminals.get(placeholderId);
    if (placeholderPt && placeholderPt !== pt) {
      try {
        placeholderPt.fit.dispose();
        placeholderPt.term.dispose();
      } catch {
        /* ignore */
      }
      this.terminals.delete(placeholderId);
      this.opts.onPaneDisposed(placeholderId);
    }
    this.rootPaneId = paneId;
    this.tree = { kind: "leaf", id: paneId };
    this.terminals.set(paneId, pt);
    this.focusedId = paneId;
    this.floating.delete(paneId);
    this.mountTree();
    this.opts.onPaneLayout?.();
    this.setFocusedPaneId(paneId);
    return true;
  }

  /** Insert a transferred pane by splitting the tab root leaf (preserves target tab structure). */
  receivePaneAtRoot(paneId: string, pt: PaneTerminal, dir: "h" | "v" = "h"): boolean {
    if (findPaneLeaf(this.tree, paneId)) return false;
    if (this.floating.has(this.rootPaneId)) return false;
    this.terminals.set(paneId, pt);
    const inserted = this.insertPaneAtRoot(paneId, dir);
    if (!inserted) {
      this.terminals.delete(paneId);
      return false;
    }
    this.setFocusedPaneId(paneId);
    return true;
  }

  private layoutStyle(): SplitLayoutStyle {
    return this.opts.getSplitLayoutStyle?.() ?? "balanced";
  }

  /** Host content box for a leaf; used by dwindle aspect picking. */
  private leafHostSize(paneId: string): { w: number; h: number } | null {
    const pt = this.terminals.get(paneId);
    if (pt) {
      const w = pt.host.clientWidth;
      const h = pt.host.clientHeight;
      if (w >= 2 && h >= 2) return { w, h };
    }
    const leaf = this.root.querySelector(
      `.pane-leaf[data-pane-id="${CSS.escape(paneId)}"]`,
    ) as HTMLElement | null;
    if (!leaf) return null;
    const r = leaf.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { w: r.width, h: r.height };
  }

  /**
   * Hyprland dwindle: split along the longer axis of the target pane
   * (W > H → side-by-side `h`, else stacked `v`). Falls back to `hint`.
   */
  private dwindleDirForPane(paneId: string, hint: "h" | "v"): "h" | "v" {
    const size = this.leafHostSize(paneId);
    if (!size) return hint;
    return size.w >= size.h ? "h" : "v";
  }

  /**
   * Find the master/stack root split: horizontal split whose `a` subtree
   * contains `rootPaneId` (master on the left).
   */
  private findMasterRootSplit(node: PaneNode): PaneSplit | null {
    if (node.kind !== "split") return null;
    if (node.dir === "h" && findPaneLeaf(node.a, this.rootPaneId)) {
      return node;
    }
    return this.findMasterRootSplit(node.a) ?? this.findMasterRootSplit(node.b);
  }

  /**
   * Append `paneId` into the master layout's stack (right of master), splitting
   * the deepest stack leaf vertically. Creates the master/stack root if the
   * tab is still a single leaf. Returns false if master structure can't be
   * applied (caller should fall back to a normal focused split).
   */
  private insertIntoMasterStack(paneId: string): boolean {
    const found = this.findMasterRootSplit(this.tree);
    if (!found) {
      if (this.tree.kind !== "leaf" || this.tree.id !== this.rootPaneId) {
        return false;
      }
      // First split: master (root) | new stack leaf
      this.tree = {
        kind: "split",
        dir: "h",
        ratio: MASTER_SPLIT_RATIO,
        a: { kind: "leaf", id: this.rootPaneId },
        b: { kind: "leaf", id: paneId },
      };
      return true;
    }

    // Deepest leaf in stack (prefer `b` recursively — newest at bottom)
    const deepestLeaf = (n: PaneNode): PaneLeaf => {
      if (n.kind === "leaf") return n;
      return deepestLeaf(n.b);
    };
    const targetId = deepestLeaf(found.b).id;
    const rep: PaneSplit = {
      kind: "split",
      dir: "v",
      ratio: 0.5,
      a: { kind: "leaf", id: targetId },
      b: { kind: "leaf", id: paneId },
    };
    const next = replaceLeaf(this.tree, targetId, rep);
    if (!next) return false;
    this.tree = next;
    return true;
  }

  private insertPaneAtRoot(paneId: string, dir: "h" | "v"): boolean {
    const style = this.layoutStyle();
    if (style === "master") {
      if (this.insertIntoMasterStack(paneId)) {
        this.mountTree();
        this.opts.onPaneLayout?.();
        return true;
      }
      // Existing non-master tree: fall through to a normal root split.
    }

    const from = this.rootPaneId;
    const resolvedDir =
      style === "dwindle" ? this.dwindleDirForPane(from, dir) : dir;
    const rep: PaneSplit = {
      kind: "split",
      dir: resolvedDir,
      ratio: 0.5,
      a: { kind: "leaf", id: from },
      b: { kind: "leaf", id: paneId },
    };
    const next = replaceLeaf(this.tree, from, rep);
    if (!next) return false;
    this.tree = next;
    this.mountTree();
    this.opts.onPaneLayout?.();
    return true;
  }

  private insertPaneNearFocused(
    paneId: string,
    dir: "h" | "v",
    createTerminal: boolean,
  ): string | null {
    if (this.floating.has(this.focusedId)) return null;
    const style = this.layoutStyle();
    const from = this.focusedId;

    if (style === "master" && this.insertIntoMasterStack(paneId)) {
      // New windows join the stack (Hyprland master default).
      this.mountTree();
      this.opts.onPaneLayout?.();
      this.setFocusedPaneId(paneId);
      return createTerminal || this.terminals.has(paneId) ? paneId : null;
    }

    const resolvedDir =
      style === "dwindle" ? this.dwindleDirForPane(from, dir) : dir;
    const rep: PaneSplit = {
      kind: "split",
      dir: resolvedDir,
      ratio: 0.5,
      a: { kind: "leaf", id: from },
      b: { kind: "leaf", id: paneId },
    };
    const next = replaceLeaf(this.tree, from, rep);
    if (!next) return null;
    this.tree = next;
    this.mountTree();
    this.opts.onPaneLayout?.();
    this.setFocusedPaneId(paneId);
    return createTerminal || this.terminals.has(paneId) ? paneId : null;
  }

  private successorRootId(removingId: string): string | null {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    for (const id of ids) {
      if (id !== removingId) return id;
    }
    return null;
  }

  /** Remove a leaf from the tree; promote the next tree-order leaf when the root is removed. */
  private detachLeafFromTree(paneId: string): boolean {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    if (ids.length <= 1) return false;
    if (!findPaneLeaf(this.tree, paneId)) return false;

    let promotedRoot: string | null = null;
    if (paneId === this.rootPaneId) {
      promotedRoot = this.successorRootId(paneId);
      if (!promotedRoot) return false;
    }

    const disposeBranch = (node: PaneNode): PaneNode | null => {
      if (node.kind === "leaf") return node.id === paneId ? null : node;
      const a = disposeBranch(node.a);
      const b = disposeBranch(node.b);
      if (a == null) return b;
      if (b == null) return a;
      return { ...node, a, b };
    };
    const next = disposeBranch(this.tree);
    if (!next) return false;
    this.tree = next;
    if (promotedRoot) this.rootPaneId = promotedRoot;
    return true;
  }

  removePane(paneId: string, opts?: { notifyDisposed?: boolean }): boolean {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    if (ids.length <= 1) return false;
    if (!findPaneLeaf(this.tree, paneId)) return false;

    const leafEl = this.root.querySelector(
      `.pane-leaf[data-pane-id="${CSS.escape(paneId)}"]`,
    ) as HTMLElement | null;

    const notifyDisposed = opts?.notifyDisposed !== false;
    const run = (): void => {
      if (!this.detachLeafFromTree(paneId)) return;
      this.floating.delete(paneId);
      const pt = this.terminals.get(paneId);
      if (pt) {
        try {
          pt.fit.dispose();
          pt.term.dispose();
        } catch {
          /* ignore */
        }
        this.terminals.delete(paneId);
        if (notifyDisposed) this.opts.onPaneDisposed(paneId);
      }
      this.mountTree();
      this.opts.onPaneLayout?.();
      if (this.focusedId === paneId) {
        const rest: string[] = [];
        collectLeafIds(this.tree, rest);
        this.setFocusedPaneId(rest[0] ?? this.rootPaneId);
      } else {
        this.updateFocusClass();
      }
    };

    if (leafEl) {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        window.clearTimeout(safety);
        leafEl.removeEventListener("animationend", onAnimEnd);
        run();
      };
      const onAnimEnd = (ev: AnimationEvent): void => {
        if (!ev.animationName.includes("pane-leave")) return;
        finish();
      };
      const safety = window.setTimeout(finish, 420);
      leafEl.addEventListener("animationend", onAnimEnd);
      leafEl.classList.add("pane-leaf--leaving");
      leafEl.style.pointerEvents = "none";
      return true;
    }

    run();
    return true;
  }

  closeAllChildPanes(): string[] {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    const removed = ids.filter((id) => id !== this.rootPaneId);
    if (removed.length === 0) {
      this.setFocusedPaneId(this.rootPaneId);
      return removed;
    }
    for (const paneId of removed) {
      const pt = this.terminals.get(paneId);
      if (pt) {
        try {
          pt.fit.dispose();
          pt.term.dispose();
        } catch {
          /* ignore */
        }
        this.terminals.delete(paneId);
        this.opts.onPaneDisposed(paneId);
      }
    }
    this.tree = { kind: "leaf", id: this.rootPaneId };
    this.floating.clear();
    this.focusedId = this.rootPaneId;
    this.mountTree();
    this.opts.onPaneLayout?.();
    this.updateFocusClass();
    this.opts.onPaneFocus(this.rootPaneId);
    return removed;
  }

  /**
   * Replace the split tree (e.g. tab switch). Drops terminals for leaf ids not in `tree`,
   * keeps existing `Terminal` instances when the same leaf id appears in the new tree.
   */
  applyWorkspaceLayout(tree: PaneNode, focusedId: string, rootPaneId: string): void {
    if (!findPaneLeaf(tree, rootPaneId)) return;
    if (!findPaneLeaf(tree, focusedId)) return;
    const nextIds: string[] = [];
    collectLeafIds(tree, nextIds);
    const keep = new Set(nextIds);
    for (const id of [...this.terminals.keys()]) {
      if (keep.has(id)) continue;
      const pt = this.terminals.get(id);
      if (pt) {
        try {
          pt.fit.dispose();
          pt.term.dispose();
        } catch {
          /* ignore */
        }
        this.terminals.delete(id);
        this.opts.onPaneDisposed(id);
      }
    }
    for (const id of [...this.floating.keys()]) {
      if (!keep.has(id)) this.floating.delete(id);
    }
    this.rootPaneId = rootPaneId;
    this.tree = tree;
    this.focusedId = focusedId;
    this.mountTree();
    this.setFocusedPaneId(focusedId);
    this.opts.onPaneLayout?.();
  }

  /**
   * Swap positions of two leaf panes in the split tree. PTY/xterm instances stay bound to pane ids.
   * @returns false if either id is missing or there is only one pane.
   */
  swapPanes(idA: string, idB: string): boolean {
    if (idA === idB) return false;
    if (this.floating.has(idA) || this.floating.has(idB)) return false;
    if (!findPaneLeaf(this.tree, idA) || !findPaneLeaf(this.tree, idB)) return false;
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    if (ids.length < 2) return false;
    const before = this.captureLeafRects([idA, idB]);
    const next = swapLeafNodesInTree(this.tree, idA, idB);
    if (!next) return false;
    this.tree = next;
    this.mountTree();
    this.playPaneSwapFlip(before);
    this.opts.onPaneLayout?.();
    this.opts.onPaneReorder?.();
    this.setFocusedPaneId(idA);
    return true;
  }

  private captureLeafRects(ids: string[]): Map<string, DOMRect> {
    const out = new Map<string, DOMRect>();
    for (const id of ids) {
      const leaf = this.root.querySelector(
        `.pane-leaf[data-pane-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      if (leaf) out.set(id, leaf.getBoundingClientRect());
    }
    return out;
  }

  private shouldAnimatePaneMotion(): boolean {
    if (document.documentElement.classList.contains("terminal-motion-off")) return false;
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private playPaneSwapFlip(before: Map<string, DOMRect>): void {
    if (!this.shouldAnimatePaneMotion() || before.size === 0) return;
    for (const [id, rect] of before) {
      const leaf = this.root.querySelector(
        `.pane-leaf[data-pane-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      if (!leaf) continue;
      const after = leaf.getBoundingClientRect();
      const dx = rect.left - after.left;
      const dy = rect.top - after.top;
      const sx = rect.width / Math.max(1, after.width);
      const sy = rect.height / Math.max(1, after.height);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
        continue;
      }
      leaf.classList.add("pane-leaf--swapping");
      leaf.style.transformOrigin = "0 0";
      leaf.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const cleanup = (): void => {
            leaf.style.transition = "";
            leaf.style.transform = "";
            leaf.style.transformOrigin = "";
            leaf.classList.remove("pane-leaf--swapping");
            leaf.removeEventListener("transitionend", cleanup);
          };
          leaf.style.transition = "transform var(--motion-medium) var(--motion-ease-emphasized)";
          leaf.style.transform = "";
          leaf.addEventListener("transitionend", cleanup);
          window.setTimeout(cleanup, 480);
        });
      });
    }
  }

  toggleFocusedFloating(): boolean {
    return this.togglePaneFloating(this.focusedId);
  }

  togglePaneFloating(paneId: string): boolean {
    if (!findPaneLeaf(this.tree, paneId)) return false;
    if (this.floating.has(paneId)) {
      this.floating.delete(paneId);
      this.justTiled.add(paneId);
      this.mountTree();
      this.setFocusedPaneId(paneId);
      this.opts.onPaneLayout?.();
      this.opts.onPaneReorder?.();
      return true;
    }

    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    if (ids.length - this.floating.size <= 1) return false;
    const leaf = this.root.querySelector(`.pane-leaf[data-pane-id="${CSS.escape(paneId)}"]`) as HTMLElement | null;
    const hostRect = this.root.getBoundingClientRect();
    const rect = leaf?.getBoundingClientRect();
    const fallbackW = Math.max(320, Math.floor(hostRect.width * 0.48));
    const fallbackH = Math.max(220, Math.floor(hostRect.height * 0.48));
    const width = Math.max(220, Math.min(rect?.width ?? fallbackW, hostRect.width));
    const height = Math.max(160, Math.min(rect?.height ?? fallbackH, hostRect.height));
    const x = Math.max(-hostRect.left, Math.min((rect?.left ?? hostRect.left + 24) - hostRect.left, window.innerWidth - hostRect.left - width));
    const y = Math.max(-hostRect.top, Math.min((rect?.top ?? hostRect.top + 24) - hostRect.top, window.innerHeight - hostRect.top - height));
    this.floating.set(paneId, { x, y, width, height, z: this.floatingZ++ });
    this.justFloated.add(paneId);
    this.mountTree();
    this.setFocusedPaneId(paneId);
    this.opts.onPaneLayout?.();
    this.opts.onPaneReorder?.();
    return true;
  }

  getPaneTerminal(paneId: string): PaneTerminal | undefined {
    return this.terminals.get(paneId);
  }

  /** Leaf pane ids in tree order (split `a` before `b`). */
  getLeafIdsInOrder(): string[] {
    const out: string[] = [];
    collectLeafIds(this.tree, out);
    return out;
  }

  forEachPane(cb: (id: string, pt: PaneTerminal) => void): void {
    for (const [id, pt] of this.terminals) cb(id, pt);
  }

  layoutAll(): void {
    for (const [, pt] of this.terminals) {
      pt.fit.fit();
    }
  }

  remountPaneSurfaces(): void {
    this.mountTree();
  }

  dispose(): void {
    this.root.removeEventListener("pointerdown", this.onPaneAltDragPointerDown, true);
    if (this.focusFollowPointer) {
      this.root.removeEventListener("pointermove", this.focusFollowPointer, true);
      this.focusFollowPointer = null;
    }
    if (this.focusFollowRaf) {
      cancelAnimationFrame(this.focusFollowRaf);
      this.focusFollowRaf = 0;
    }
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    for (const [id, pt] of this.terminals) {
      try {
        pt.fit.dispose();
        pt.term.dispose();
      } catch {
        /* ignore */
      }
      this.opts.onPaneDisposed(id);
    }
    this.terminals.clear();
    this.root.remove();
  }

  private mountTree(): void {
    this.syncRatiosFromDom();
    this.root.replaceChildren();
    const tiledTree = this.pruneFloatingLeaves(this.tree);
    if (tiledTree) {
      const el = this.renderNode(tiledTree);
      this.root.appendChild(el);
    }
    for (const paneId of this.getFloatingIdsInTreeOrder()) {
      const el = this.renderNode({ kind: "leaf", id: paneId });
      const state = this.floating.get(paneId);
      if (!state) continue;
      el.classList.add("pane-leaf--floating");
      if (this.justFloated.delete(paneId)) el.classList.add("pane-leaf--floating-enter");
      el.style.left = `${state.x}px`;
      el.style.top = `${state.y}px`;
      el.style.width = `${state.width}px`;
      el.style.height = `${state.height}px`;
      el.style.zIndex = String(state.z);
      this.root.appendChild(el);
    }
    this.wireFocus();
    this.updateFocusClass();
    this.opts.onPaneLayout?.();
  }

  private pruneFloatingLeaves(node: PaneNode): PaneNode | null {
    if (node.kind === "leaf") return this.floating.has(node.id) ? null : node;
    const a = this.pruneFloatingLeaves(node.a);
    const b = this.pruneFloatingLeaves(node.b);
    if (!a) return b;
    if (!b) return a;
    return { ...node, a, b };
  }

  private getFloatingIdsInTreeOrder(): string[] {
    const ids: string[] = [];
    collectLeafIds(this.tree, ids);
    return ids.filter((id) => this.floating.has(id));
  }

  private bringFloatingPaneToFront(paneId: string): void {
    const state = this.floating.get(paneId);
    if (!state) return;
    state.z = this.floatingZ++;
    const leaf = this.root.querySelector(`.pane-leaf[data-pane-id="${CSS.escape(paneId)}"]`) as HTMLElement | null;
    if (leaf) leaf.style.zIndex = String(state.z);
    this.opts.onPaneReorder?.();
  }

  private wireFocus(): void {
    if (this.focusFollowPointer) {
      this.root.removeEventListener("pointermove", this.focusFollowPointer, true);
      this.focusFollowPointer = null;
    }
    this.focusFollowPointer = (ev: PointerEvent) => {
      if (this.paneDragActive) return;
      if (!this.opts.focusFollowsCursor()) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const leaf = el?.closest?.(".pane-leaf") as HTMLElement | null;
      const id = leaf?.dataset.paneId;
      if (!id || id === this.focusedId) return;
      this.pendingFocusFollowId = id;
      if (this.focusFollowRaf) return;
      this.focusFollowRaf = requestAnimationFrame(() => {
        this.focusFollowRaf = 0;
        const nextId = this.pendingFocusFollowId;
        this.pendingFocusFollowId = null;
        if (nextId && nextId !== this.focusedId) this.setFocusedPaneId(nextId);
      });
    };
    this.root.addEventListener("pointermove", this.focusFollowPointer, true);

    this.root.addEventListener("pointerdown", (e) => {
      const leaf = (e.target as HTMLElement).closest(".pane-leaf") as HTMLElement | null;
      if (!leaf || !this.root.contains(leaf)) return;
      const id = leaf.dataset.paneId;
      if (id) this.setFocusedPaneId(id);
    });

    this.root.querySelectorAll<HTMLElement>(".pane-gutter").forEach((gutter) => {
      gutter.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const splitEl = gutter.closest(".pane-split") as HTMLElement | null;
        if (!splitEl) return;
        const dir = splitEl.dataset.splitDir as "h" | "v" | undefined;
        if (!dir) return;
        this.beginSingleSplitResize(e, splitEl, dir);
      });
    });

    this.root.querySelectorAll<HTMLElement>(".pane-corner-handle").forEach((corner) => {
      corner.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const leaf = corner.closest(".pane-leaf") as HTMLElement | null;
        if (!leaf) return;
        const paneId = leaf.dataset.paneId;
        if (paneId && this.floating.has(paneId)) {
          this.beginFloatingPaneResize(
            leaf,
            paneId,
            e,
            corner.dataset.edgeX as ResizeEdgeX | undefined,
            corner.dataset.edgeY as ResizeEdgeY | undefined,
          );
          return;
        }
        this.beginCornerResize(
          e,
          leaf,
          corner.dataset.edgeX as CornerEdge | undefined,
          corner.dataset.edgeY as CornerEdge | undefined,
        );
      });
    });

    this.root.querySelectorAll<HTMLElement>(".pane-floating-resize").forEach((edge) => {
      edge.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const leaf = edge.closest(".pane-leaf") as HTMLElement | null;
        const paneId = leaf?.dataset.paneId;
        if (!leaf || !paneId || !this.floating.has(paneId)) return;
        this.beginFloatingPaneResize(
          leaf,
          paneId,
          e,
          edge.dataset.edgeX as ResizeEdgeX | undefined,
          edge.dataset.edgeY as ResizeEdgeY | undefined,
        );
      });
    });
  }

  /** Ctrl+Alt+primary-button drag from a pane leaf to swap with another pane. */
  private beginPaneSwapDrag(leaf: HTMLElement, paneId: string, e: PointerEvent): void {
    const DRAG_THRESHOLD = 6;
    const startX = e.clientX;
    const startY = e.clientY;
    let preview: HTMLElement | null = null;
    let dropTargetEl: HTMLElement | null = null;
    let active = false;
    const rect0 = leaf.getBoundingClientRect();
    const offsetX = e.clientX - rect0.left;
    const offsetY = e.clientY - rect0.top;

    const clearDropHighlight = (): void => {
      if (dropTargetEl) {
        dropTargetEl.classList.remove("pane-leaf--drop-target");
        dropTargetEl = null;
      }
    };

    const onMove = (ev: PointerEvent): void => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        this.paneDragActive = true;
        preview = document.createElement("div");
        preview.className = "pane-drag-preview";
        preview.style.width = `${rect0.width}px`;
        preview.style.height = `${rect0.height}px`;
        preview.style.left = `${rect0.left}px`;
        preview.style.top = `${rect0.top}px`;
        document.body.appendChild(preview);
        leaf.classList.add("pane-leaf--drag-source");
      }
      if (!preview) return;
      preview.style.left = `${ev.clientX - offsetX}px`;
      preview.style.top = `${ev.clientY - offsetY}px`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetLeaf = under?.closest?.(".pane-leaf") as HTMLElement | null;
      if (targetLeaf === dropTargetEl) return;
      clearDropHighlight();
      if (
        targetLeaf &&
        targetLeaf !== leaf &&
        this.root.contains(targetLeaf) &&
        targetLeaf.dataset.paneId &&
        targetLeaf.dataset.paneId !== paneId
      ) {
        targetLeaf.classList.add("pane-leaf--drop-target");
        dropTargetEl = targetLeaf;
      }
    };

    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (preview) preview.remove();
      leaf.classList.remove("pane-leaf--drag-source");
      clearDropHighlight();
      this.paneDragActive = false;
      if (!active) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetLeaf = under?.closest?.(".pane-leaf") as HTMLElement | null;
      const tid = targetLeaf?.dataset.paneId;
      if (tid && tid !== paneId && targetLeaf && this.root.contains(targetLeaf)) {
        this.swapPanes(paneId, tid);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private beginFloatingPaneMove(leaf: HTMLElement, paneId: string, e: PointerEvent): void {
    const state = this.floating.get(paneId);
    if (!state) return;
    this.paneDragActive = true;
    this.beginLayoutDrag();
    this.bringFloatingPaneToFront(paneId);
    state.width = leaf.offsetWidth || state.width;
    state.height = leaf.offsetHeight || state.height;
    leaf.classList.add("pane-leaf--floating-moving");
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = state.x;
    const startTop = state.y;
    const onMove = (ev: PointerEvent): void => {
      const hostRect = this.root.getBoundingClientRect();
      state.x = Math.max(-hostRect.left, Math.min(startLeft + ev.clientX - startX, window.innerWidth - hostRect.left - state.width));
      state.y = Math.max(-hostRect.top, Math.min(startTop + ev.clientY - startY, window.innerHeight - hostRect.top - state.height));
      leaf.style.left = `${state.x}px`;
      leaf.style.top = `${state.y}px`;
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      leaf.classList.remove("pane-leaf--floating-moving");
      this.paneDragActive = false;
      this.opts.onPaneReorder?.();
      this.endLayoutDrag(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private beginFloatingPaneResize(
    leaf: HTMLElement,
    paneId: string,
    e: PointerEvent,
    edgeX: ResizeEdgeX = "none",
    edgeY: ResizeEdgeY = "none",
  ): void {
    const state = this.floating.get(paneId);
    if (!state) return;
    const minW = 220;
    const minH = 160;
    this.paneDragActive = true;
    this.beginLayoutDrag();
    this.bringFloatingPaneToFront(paneId);
    leaf.classList.add("pane-leaf--floating-resizing");

    const hostRect = this.root.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = leaf.offsetLeft;
    const startTop = leaf.offsetTop;
    const startWidth = leaf.offsetWidth || state.width;
    const startHeight = leaf.offsetHeight || state.height;
    const minLeft = -hostRect.left;
    const minTop = -hostRect.top;
    const maxRight = window.innerWidth - hostRect.left;
    const maxBottom = window.innerHeight - hostRect.top;

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let left = startLeft;
      let top = startTop;
      let width = startWidth;
      let height = startHeight;

      if (edgeX === "left") {
        left = Math.max(minLeft, Math.min(startLeft + dx, startLeft + startWidth - minW));
        width = startWidth + startLeft - left;
      } else if (edgeX === "right") {
        width = Math.max(minW, Math.min(startWidth + dx, maxRight - startLeft));
      }

      if (edgeY === "top") {
        top = Math.max(minTop, Math.min(startTop + dy, startTop + startHeight - minH));
        height = startHeight + startTop - top;
      } else if (edgeY === "bottom") {
        height = Math.max(minH, Math.min(startHeight + dy, maxBottom - startTop));
      }

      state.x = left;
      state.y = top;
      state.width = width;
      state.height = height;
      leaf.style.left = `${left}px`;
      leaf.style.top = `${top}px`;
      leaf.style.width = `${width}px`;
      leaf.style.height = `${height}px`;
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      leaf.classList.remove("pane-leaf--floating-resizing");
      this.paneDragActive = false;
      this.opts.onPaneReorder?.();
      this.endLayoutDrag(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private beginSingleSplitResize(e: PointerEvent, splitEl: HTMLElement, dir: SplitResizeAxis): void {
    this.beginLayoutDrag();
    const start = dir === "h" ? e.clientX : e.clientY;
    const rect = splitEl.getBoundingClientRect();
    const startRatio = Number(splitEl.dataset.ratio ?? "0.5");
    const onMove = (ev: PointerEvent): void => {
      const cur = dir === "h" ? ev.clientX : ev.clientY;
      const delta = cur - start;
      const span = dir === "h" ? rect.width : rect.height;
      this.applySplitRatio(splitEl, startRatio + delta / Math.max(1, span), false);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.endLayoutDrag(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private beginCornerResize(
    e: PointerEvent,
    leaf: HTMLElement,
    edgeX?: CornerEdge,
    edgeY?: CornerEdge,
  ): void {
    const hInfo = edgeX ? this.findAncestorSplitForLeaf(leaf, "h", edgeX) : null;
    const vInfo = edgeY ? this.findAncestorSplitForLeaf(leaf, "v", edgeY) : null;
    if (!hInfo && !vInfo) return;
    this.beginLayoutDrag();
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent): void => {
      if (hInfo) {
        const deltaX = ev.clientX - startX;
        this.applySplitRatio(hInfo.splitEl, hInfo.startRatio + (deltaX * hInfo.sign) / hInfo.span, false);
      }
      if (vInfo) {
        const deltaY = ev.clientY - startY;
        this.applySplitRatio(vInfo.splitEl, vInfo.startRatio + (deltaY * vInfo.sign) / vInfo.span, false);
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      this.endLayoutDrag(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private findAncestorSplitForLeaf(
    leaf: HTMLElement,
    dir: SplitResizeAxis,
    edge: CornerEdge,
  ): AncestorSplitInfo | null {
    let child: HTMLElement = leaf;
    let cur = leaf.parentElement as HTMLElement | null;
    while (cur && cur !== this.root) {
      if (cur.classList.contains("pane-split") && cur.dataset.splitDir === dir) {
        const cells = cur.querySelectorAll(":scope > :not(.pane-gutter)");
        if (cells.length >= 2) {
          const firstCell = cells[0] as HTMLElement;
          const isFirst = firstCell.contains(child);
          const rect = cur.getBoundingClientRect();
          const span = Math.max(1, dir === "h" ? rect.width : rect.height);
          const growSign = isFirst ? 1 : -1;
          const edgeSign = edge === "right" || edge === "bottom" ? 1 : -1;
          return {
            splitEl: cur,
            dir,
            sign: growSign * edgeSign,
            span,
            startRatio: Number(cur.dataset.ratio ?? "0.5"),
          };
        }
      }
      child = cur;
      cur = cur.parentElement as HTMLElement | null;
    }
    return null;
  }

  private applySplitRatio(splitEl: HTMLElement, nextRatio: number, notify = true): void {
    const next = Math.max(0.15, Math.min(0.85, nextRatio));
    splitEl.dataset.ratio = String(next);
    const cells = splitEl.querySelectorAll(":scope > :not(.pane-gutter)");
    if (cells.length >= 2) {
      (cells[0] as HTMLElement).style.flex = String(next);
      (cells[1] as HTMLElement).style.flex = String(1 - next);
    }
    const path = splitEl.dataset.splitPath;
    if (path !== undefined) {
      this.persistSingleRatio(path, next);
    }
    if (notify) this.opts.onPaneLayout?.();
  }

  private persistSingleRatio(path: string, ratio: number): void {
    if (this.floating.size > 0) return;
    const node = getNodeByPath(this.tree, path);
    if (node.kind !== "split") return;
    this.tree = setNodeByPath(this.tree, path, { ...node, ratio });
  }

  private syncRatiosFromDom(): void {
    const tiled = this.pruneFloatingLeaves(this.tree);
    if (!tiled) return;
    const rootEl = this.root.firstElementChild as HTMLElement | null;
    if (!rootEl) return;
    this.tree = this.syncRatiosWalk(tiled, rootEl, this.tree);
  }

  private syncRatiosWalk(pruned: PaneNode, el: HTMLElement, orig: PaneNode): PaneNode {
    if (pruned.kind !== "split" || orig.kind !== "split") return orig;
    if (!el.classList.contains("pane-split")) return orig;
    const ratio = Number(el.dataset.ratio ?? "0.5");
    const cells = el.querySelectorAll<HTMLElement>(":scope > :not(.pane-gutter)");
    const cellA = cells[0];
    const cellB = cells[1];
    return {
      ...orig,
      ratio,
      a: cellA ? this.syncRatiosWalk(pruned.a, cellA, orig.a) : orig.a,
      b: cellB ? this.syncRatiosWalk(pruned.b, cellB, orig.b) : orig.b,
    };
  }

  private beginLayoutDrag(): void {
    this.layoutDragDepth += 1;
    if (this.layoutDragDepth === 1) {
      this.root.classList.add("pane-host--layout-dragging");
      this.opts.onPaneLayoutDrag?.(true);
    }
  }

  private endLayoutDrag(commitLayout: boolean): void {
    this.layoutDragDepth = Math.max(0, this.layoutDragDepth - 1);
    if (this.layoutDragDepth > 0) return;
    this.root.classList.remove("pane-host--layout-dragging");
    this.opts.onPaneLayoutDrag?.(false);
    if (commitLayout) this.opts.onPaneLayout?.();
  }

  private renderNode(node: PaneNode, path = ""): HTMLElement {
    if (node.kind === "leaf") {
      const wrap = document.createElement("div");
      wrap.className = "pane-leaf";
      wrap.dataset.paneId = node.id;
      if (node.id === this.focusedId) {
        wrap.classList.add("pane-leaf--focused");
      }
      const cssVars = this.opts.getPaneCssVars?.(node.id);
      if (cssVars) {
        for (const [key, value] of Object.entries(cssVars)) {
          if (key.startsWith("--")) wrap.style.setProperty(key, value);
        }
      }
      for (const [cls, edgeX, edgeY] of [
        ["pane-corner-handle--nw", "left", "top"],
        ["pane-corner-handle--ne", "right", "top"],
        ["pane-corner-handle--sw", "left", "bottom"],
        ["pane-corner-handle--se", "right", "bottom"],
      ] as const) {
        const corner = document.createElement("div");
        corner.className = `pane-corner-handle ${cls}`;
        corner.dataset.edgeX = edgeX;
        corner.dataset.edgeY = edgeY;
        corner.setAttribute("aria-hidden", "true");
        wrap.appendChild(corner);
      }
      for (const [cls, edgeX, edgeY] of [
        ["pane-floating-resize--left", "left", "none"],
        ["pane-floating-resize--right", "right", "none"],
        ["pane-floating-resize--top", "none", "top"],
        ["pane-floating-resize--bottom", "none", "bottom"],
      ] as const) {
        const edge = document.createElement("div");
        edge.className = `pane-floating-resize ${cls}`;
        edge.dataset.edgeX = edgeX;
        edge.dataset.edgeY = edgeY;
        edge.setAttribute("aria-hidden", "true");
        wrap.appendChild(edge);
      }

      let pt = this.terminals.get(node.id);
      let isNew = false;
      if (!pt) {
        isNew = true;
        const row = document.createElement("div");
        row.className = "pane-terminal-row";
        const host = document.createElement("div");
        host.className = "pane-terminal-host";
        row.appendChild(host);
        const createStarted = performance.now();
        const term = new Terminal({
          allowProposedApi: true,
          allowTransparency: false,
          altClickMovesCursor: this.opts.altClickMovesCursor,
          cursorBlink: this.opts.cursorBlink,
          cursorInactiveStyle: this.opts.cursorInactiveStyle ?? "outline",
          cursorStyle: this.opts.cursorStyle,
          cursorWidth: this.opts.cursorWidth ?? 1,
          customGlyphs: this.opts.customGlyphs,
          drawBoldTextInBrightColors: this.opts.drawBoldTextInBrightColors,
          fastScrollSensitivity: this.opts.fastScrollSensitivity ?? 5,
          fontFamily: this.opts.fontStack,
          fontSize: this.opts.fontSize,
          fontWeight: (this.opts.fontWeight ?? "normal") as any,
          fontWeightBold: (this.opts.fontWeightBold ?? "bold") as any,
          letterSpacing: this.opts.letterSpacing ?? 0,
          lineHeight: this.opts.lineHeight ?? 1,
          logLevel: "off",
          minimumContrastRatio: this.opts.minimumContrastRatio ?? 1,
          rescaleOverlappingGlyphs: false,
          scrollOnEraseInDisplay: false,
          scrollSensitivity: this.opts.scrollSensitivity ?? 1,
          smoothScrollDuration: this.opts.smoothScrollDuration,
          theme: this.opts.getTheme(node.id),
          scrollback: this.opts.scrollbackLines,
          linkHandler: this.opts.linkHandler ?? undefined,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        const imageAddon = new ImageAddon();
        term.loadAddon(imageAddon);
        const unicode11 = new Unicode11Addon();
        term.loadAddon(unicode11);
        // Addon only registers the version; activate it explicitly.
        term.unicode.activeVersion = "11";
        const graphemes = new UnicodeGraphemesAddon();
        term.loadAddon(graphemes);
        const serializeAddon = new SerializeAddon();
        term.loadAddon(serializeAddon);
        // LigaturesAddon must be loaded after open(); before open it does nothing.
        // WebGL mounts later in ensureWebglOnPane — character joiners stay active across remounts.
        term.open(host);
        const ligaturesAddon = new LigaturesAddon();
        term.loadAddon(ligaturesAddon);
        parttyPerf.mark("pane.terminal.create");
        parttyPerf.time("pane.terminal.create.ms", performance.now() - createStarted);
        pt = {
          term,
          fit,
          image: imageAddon,
          ligatures: ligaturesAddon,
          serialize: serializeAddon,
          host,
          row,
        };
        this.terminals.set(node.id, pt);
        this.opts.onPaneCreated(node.id, pt);
      }
      wrap.appendChild(pt.row);
      if (this.justTiled.delete(node.id)) {
        wrap.classList.add("pane-leaf--floating-return");
        wrap.addEventListener("animationend", () => {
          wrap.classList.remove("pane-leaf--floating-return");
        }, { once: true });
      }
      if (isNew) {
        wrap.classList.add("pane-leaf--entering");
        wrap.addEventListener("animationend", () => {
          wrap.classList.remove("pane-leaf--entering");
        }, { once: true });
      }
      return wrap;
    }

    const split = document.createElement("div");
    split.className = `pane-split pane-split--${node.dir}`;
    split.dataset.splitDir = node.dir;
    split.dataset.ratio = String(node.ratio);
    split.dataset.splitPath = path;
    split.style.display = "flex";
    split.style.flex = "1";
    split.style.minHeight = "0";
    split.style.minWidth = "0";
    split.style.flexDirection = node.dir === "h" ? "row" : "column";

    const a = this.renderNode(node.a, `${path}a`);
    a.style.flex = String(node.ratio);
    a.style.minWidth = "0";
    a.style.minHeight = "0";
    const gutter = document.createElement("div");
    gutter.className = `pane-gutter pane-gutter--${node.dir}`;
    gutter.title = "Resize";
    const b = this.renderNode(node.b, `${path}b`);
    b.style.flex = String(1 - node.ratio);
    b.style.minWidth = "0";
    b.style.minHeight = "0";

    split.appendChild(a);
    split.appendChild(gutter);
    split.appendChild(b);
    return split;
  }
}
