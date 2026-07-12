import type { PaneNode } from "./paneHost";
import { findPaneLeaf } from "./paneHost";
import {
  setSplitRatioAtPath,
  swapLeafNodesInTree,
} from "./workspaceTreeOps";

export type WorkspaceEditorPaneView = {
  id: string;
  name: string;
  profileLabel: string;
  cwdHint: string;
  accentColor: string;
};

export type WorkspaceEditorViewportOptions = {
  getPaneView: (id: string) => WorkspaceEditorPaneView;
  onSelect: (id: string) => void;
  onTreeChange: (tree: PaneNode, focusedId: string) => void;
};

type CornerEdge = "left" | "right" | "top" | "bottom";
type SplitAxis = "h" | "v";

type AncestorSplitInfo = {
  splitEl: HTMLElement;
  sign: number;
  span: number;
  startRatio: number;
};

export class WorkspaceEditorViewport {
  private tree: PaneNode;
  private focusedId: string;
  private readonly host: HTMLElement;
  private layoutDragDepth = 0;

  constructor(
    container: HTMLElement,
    private readonly opts: WorkspaceEditorViewportOptions,
  ) {
    container.replaceChildren();
    const viewport = document.createElement("div");
    viewport.className = "workspace-editor-viewport";
    this.host = document.createElement("div");
    this.host.className = "pane-host workspace-editor-host";
    viewport.appendChild(this.host);
    container.appendChild(viewport);
    this.tree = { kind: "leaf", id: "root" };
    this.focusedId = "root";
  }

  setTree(tree: PaneNode, focusedId: string): void {
    this.tree = tree;
    this.focusedId = findPaneLeaf(tree, focusedId) ? focusedId : this.firstLeafId(tree);
    this.mountTree();
  }

  getTree(): PaneNode {
    this.syncRatiosFromDom();
    return this.tree;
  }

  getFocusedId(): string {
    return this.focusedId;
  }

  selectPane(id: string): void {
    if (!findPaneLeaf(this.tree, id)) return;
    this.focusedId = id;
    this.updateFocusClass();
    this.opts.onSelect(id);
  }

  private firstLeafId(tree: PaneNode): string {
    if (tree.kind === "leaf") return tree.id;
    return this.firstLeafId(tree.a);
  }

  private mountTree(): void {
    this.host.replaceChildren();
    const el = this.renderNode(this.tree, "");
    this.host.appendChild(el);
    this.wireInteractions();
    this.updateFocusClass();
  }

  private updateFocusClass(): void {
    this.host.querySelectorAll(".pane-leaf").forEach((leaf) => {
      const el = leaf as HTMLElement;
      el.classList.toggle(
        "pane-leaf--focused",
        el.dataset.paneId === this.focusedId,
      );
    });
  }

  private wireInteractions(): void {
    this.host.querySelectorAll<HTMLElement>(".pane-leaf").forEach((leaf) => {
      const id = leaf.dataset.paneId;
      if (!id) return;
      leaf.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).closest(".pane-gutter")) return;
        this.selectPane(id);
      });
      this.wirePaneSwapDrag(leaf, id);
    });

    this.host.querySelectorAll<HTMLElement>(".pane-gutter").forEach((gutter) => {
      gutter.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const splitEl = gutter.closest(".pane-split") as HTMLElement | null;
        if (!splitEl) return;
        const dir = splitEl.dataset.splitDir as SplitAxis | undefined;
        if (!dir) return;
        this.beginGutterResize(e, splitEl, dir);
      });
    });

    this.host.querySelectorAll<HTMLElement>(".pane-corner-handle").forEach((corner) => {
      corner.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const leaf = corner.closest(".pane-leaf") as HTMLElement | null;
        if (!leaf) return;
        this.beginCornerResize(
          e,
          leaf,
          corner.dataset.edgeX as CornerEdge | undefined,
          corner.dataset.edgeY as CornerEdge | undefined,
        );
      });
    });
  }

  private wirePaneSwapDrag(leaf: HTMLElement, paneId: string): void {
    const DRAG_THRESHOLD = 6;
    const startDrag = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".pane-corner-handle")) return;
      const ids: string[] = [];
      this.collectIds(this.tree, ids);
      if (ids.length < 2) return;

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
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!active) {
          active = true;
          leaf.classList.add("pane-leaf--drag-source");
          preview = leaf.cloneNode(true) as HTMLElement;
          preview.classList.add("workspace-editor-drag-preview");
          preview.style.width = `${rect0.width}px`;
          preview.style.height = `${rect0.height}px`;
          preview.style.left = `${ev.clientX - offsetX}px`;
          preview.style.top = `${ev.clientY - offsetY}px`;
          document.body.appendChild(preview);
        }
        if (preview) {
          preview.style.left = `${ev.clientX - offsetX}px`;
          preview.style.top = `${ev.clientY - offsetY}px`;
        }
        clearDropHighlight();
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetLeaf = under?.closest?.(".pane-leaf") as HTMLElement | null;
        if (
          targetLeaf &&
          this.host.contains(targetLeaf) &&
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
        preview?.remove();
        leaf.classList.remove("pane-leaf--drag-source");
        clearDropHighlight();
        if (!active) return;
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetLeaf = under?.closest?.(".pane-leaf") as HTMLElement | null;
        const tid = targetLeaf?.dataset.paneId;
        if (tid && tid !== paneId && targetLeaf && this.host.contains(targetLeaf)) {
          const next = swapLeafNodesInTree(this.tree, paneId, tid);
          if (next) {
            this.tree = next;
            this.mountTree();
            this.emitTreeChange();
          }
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    };

    leaf.addEventListener("pointerdown", startDrag);
  }

  private collectIds(node: PaneNode, out: string[]): void {
    if (node.kind === "leaf") {
      out.push(node.id);
      return;
    }
    this.collectIds(node.a, out);
    this.collectIds(node.b, out);
  }

  private beginGutterResize(
    e: PointerEvent,
    splitEl: HTMLElement,
    dir: SplitAxis,
  ): void {
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
        this.applySplitRatio(
          hInfo.splitEl,
          hInfo.startRatio + (deltaX * hInfo.sign) / hInfo.span,
          false,
        );
      }
      if (vInfo) {
        const deltaY = ev.clientY - startY;
        this.applySplitRatio(
          vInfo.splitEl,
          vInfo.startRatio + (deltaY * vInfo.sign) / vInfo.span,
          false,
        );
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
    dir: SplitAxis,
    edge: CornerEdge,
  ): AncestorSplitInfo | null {
    let child: HTMLElement = leaf;
    let cur = leaf.parentElement as HTMLElement | null;
    while (cur && cur !== this.host) {
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

  private applySplitRatio(
    splitEl: HTMLElement,
    nextRatio: number,
    notify = true,
  ): void {
    const next = Math.max(0.05, Math.min(0.95, nextRatio));
    splitEl.dataset.ratio = String(next);
    const cells = splitEl.querySelectorAll(":scope > :not(.pane-gutter)");
    if (cells.length >= 2) {
      (cells[0] as HTMLElement).style.flex = String(next);
      (cells[1] as HTMLElement).style.flex = String(1 - next);
    }
    const path = splitEl.dataset.splitPath;
    if (path !== undefined) {
      this.tree = setSplitRatioAtPath(this.tree, path, next);
    }
    if (notify) this.emitTreeChange();
  }

  private syncRatiosFromDom(): void {
    const rootEl = this.host.firstElementChild as HTMLElement | null;
    if (!rootEl) return;
    this.tree = this.syncRatiosWalk(this.tree, rootEl, this.tree);
  }

  private syncRatiosWalk(
    pruned: PaneNode,
    el: HTMLElement,
    orig: PaneNode,
  ): PaneNode {
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
      this.host.classList.add("pane-host--layout-dragging");
    }
  }

  private endLayoutDrag(commitLayout: boolean): void {
    this.layoutDragDepth = Math.max(0, this.layoutDragDepth - 1);
    if (this.layoutDragDepth > 0) return;
    this.host.classList.remove("pane-host--layout-dragging");
    if (commitLayout) this.emitTreeChange();
  }

  private emitTreeChange(): void {
    this.syncRatiosFromDom();
    this.opts.onTreeChange(this.tree, this.focusedId);
  }

  refresh(): void {
    this.mountTree();
  }

  private renderNode(node: PaneNode, path: string): HTMLElement {
    if (node.kind === "leaf") {
      const wrap = document.createElement("div");
      wrap.className = "pane-leaf workspace-editor-leaf";
      wrap.dataset.paneId = node.id;
      if (node.id === this.focusedId) wrap.classList.add("pane-leaf--focused");

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

      const view = this.opts.getPaneView(node.id);
      const inner = document.createElement("div");
      inner.className = "workspace-editor-leaf-inner";
      inner.style.setProperty("--ws-pane-accent", view.accentColor);

      const nameEl = document.createElement("span");
      nameEl.className = "workspace-editor-leaf-name";
      nameEl.textContent = view.name || "pane";

      const profileEl = document.createElement("span");
      profileEl.className = "workspace-editor-leaf-profile";
      profileEl.textContent = view.profileLabel;

      const cwdEl = document.createElement("span");
      cwdEl.className = "workspace-editor-leaf-cwd";
      cwdEl.textContent = view.cwdHint;

      const accent = document.createElement("div");
      accent.className = "workspace-editor-leaf-accent";
      accent.style.background = view.accentColor;

      inner.appendChild(nameEl);
      inner.appendChild(profileEl);
      if (view.cwdHint) inner.appendChild(cwdEl);
      inner.appendChild(accent);
      wrap.appendChild(inner);
      return wrap;
    }

    const split = document.createElement("div");
    split.className = "pane-split";
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
