import { invoke } from "@tauri-apps/api/core";
import { isNativeAbsoluteFsPath, normalizeFsPathKey } from "./oscCwd";
import { showAlert, showConfirm } from "./dialog";
import { FileTreeBackend } from "./fileTreeBackend";
import { glyphForFile } from "./fileTreeGlyphs";

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

type NodeState = {
  loaded: boolean;
  expanded: boolean;
  children: FsEntry[] | null;
  loading?: boolean;
  operationInProgress?: boolean;
};

type DragState = {
  draggedPaths: string[] | null;
  dragOverPath: string | null;
  dropPosition: "before" | "after" | "inside" | null;
};

type FileTreeSide = "left" | "right";

type FlatEntry = { kind: "entry"; entry: FsEntry; depth: number };
type FlatInline = {
  kind: "inline";
  depth: number;
  mode: "newfile" | "newfolder";
  parent: string;
  initial: string;
};
type FlatItem = FlatEntry | FlatInline;

type PaneTreeState = {
  viewRoot: string | null;
  selected: string[];
  scrollTop: number;
  cacheEntries: Array<[string, NodeState]>;
};

export type FileTreePanelOptions = {
  getConfirmDeletePrompt?: () => boolean;
  setConfirmDeletePrompt?: (enabled: boolean) => void;
  getPanelSide?: () => FileTreeSide;
  setPanelSide?: (side: FileTreeSide) => void;
};

function joinWin(base: string, name: string): string {
  const b = base.replace(/[/\\]+$/, "");
  return `${b}\\${name}`;
}

function basename(path: string): string {
  const s = path.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function dirnamePath(path: string): string {
  const s = path.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (i <= 0) return s;
  return s.slice(0, i);
}

class TreeView {
  readonly cache = new Map<string, NodeState>();
  viewRoot: string | null = null;
  readonly selected = new Set<string>();
  readonly pendingFsPaths = new Set<string>();
  inlineRenamePath: string | null = null;
  inlineNew: { parent: string; mode: "newfile" | "newfolder"; initial: string } | null = null;
  keyboardNavIndex = -1;
  selectionAnchorPath: string | null = null;
  flatItems: FlatItem[] = [];
  visibleRange = { start: 0, end: 0 };
  renderedElements = new Map<string, HTMLLIElement>();
  virtualContainer: HTMLElement | null = null;
  fsRefreshTimer = 0;
  fsSyncInFlight = false;

  readonly itemHeight = 22;
  readonly overscan = 10;

  prefetchToken = 0;
  readonly prefetchDepth = 2;
  readonly prefetchDirBudget = 96;
  readonly prefetchMaxEntriesPerDir = 300;
  readonly prefetchMaxSubdirsPerDir = 140;
}

export class FileTreePanel {
  private readonly tree = new TreeView();
  private readonly ownerCtx: { getConfirmDeletePrompt: () => boolean; setConfirmDeletePrompt: (enabled: boolean) => void; getPanelSide: () => FileTreeSide; setPanelSide: (side: FileTreeSide) => void };
  private ctxEl: HTMLElement | null = null;
  private dragState: DragState = { draggedPaths: null, dragOverPath: null, dropPosition: null };
  private dragGhost: HTMLElement | null = null;
  private activePaneId: string | null = null;
  private readonly paneStates = new Map<string, PaneTreeState>();
  private recoverTimer = 0;

  constructor(
    private readonly scrollEl: HTMLElement,
    private readonly backend: FileTreeBackend,
    options?: FileTreePanelOptions,
  ) {
    this.ownerCtx = {
      getConfirmDeletePrompt: options?.getConfirmDeletePrompt ?? (() => true),
      setConfirmDeletePrompt: options?.setConfirmDeletePrompt ?? (() => {}),
      getPanelSide: options?.getPanelSide ?? (() => "left" as const),
      setPanelSide: options?.setPanelSide ?? (() => {}),
    };
    this.setupKeyboardNav();
    this.setupVirtualScroll();
    this.scrollEl.addEventListener("contextmenu", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".file-tree-row")) return;
      e.preventDefault();
      const root = this.tree.viewRoot;
      if (!root) return;
      this.showCtxEmptyArea(e.clientX, e.clientY, root);
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.ctxEl && !this.ctxEl.contains(e.target as Node)) this.hideCtx();
    });
  }

  // ── Public API (kept for main.ts compat) ──

  setSearchEnabled(_enabled: boolean): void {}
  focusFilter(): void {}
  isFilterFocused(): boolean {
    return false;
  }

  dispose(): void {
    this.persistActivePaneState();
    this.tree.cache.clear();
    this.tree.selected.clear();
    this.tree.renderedElements.clear();
    this.hideCtx();
    if (this.recoverTimer) {
      window.clearTimeout(this.recoverTimer);
      this.recoverTimer = 0;
    }
    if (this.tree.fsRefreshTimer) {
      window.clearTimeout(this.tree.fsRefreshTimer);
      this.tree.fsRefreshTimer = 0;
    }
  }

  async forceReload(): Promise<void> {
    this.tree.cache.clear();
    this.tree.selected.clear();
    this.tree.renderedElements.clear();
    this.tree.prefetchToken += 1;
    await this.refresh();
  }

  setActivePane(paneId: string): void {
    if (!paneId || paneId === this.activePaneId) return;
    this.persistActivePaneState();
    this.activePaneId = paneId;
    this.restorePaneState(paneId);
  }

  clearPaneState(paneId: string): void {
    if (!paneId) return;
    this.paneStates.delete(paneId);
    if (this.activePaneId !== paneId) return;
    this.activePaneId = null;
    this.tree.viewRoot = null;
    this.tree.cache.clear();
    this.tree.selected.clear();
    this.render();
  }

  handleFileSystemChange(paths: string[]): void {
    const root = this.tree.viewRoot;
    if (!root) return;
    if (!paths.length) {
      this.tree.pendingFsPaths.add(root);
    } else {
      const rootKey = normalizeFsPathKey(root);
      const prefix = `${rootKey}/`;
      for (const path of paths) {
        const key = normalizeFsPathKey(path);
        if (key === rootKey || key.startsWith(prefix)) {
          this.tree.pendingFsPaths.add(path);
        }
      }
      if (this.tree.pendingFsPaths.size === 0) return;
    }
    if (this.tree.fsRefreshTimer) return;
    this.tree.fsRefreshTimer = window.setTimeout(() => {
      this.tree.fsRefreshTimer = 0;
      const changed = [...this.tree.pendingFsPaths];
      this.tree.pendingFsPaths.clear();
      void this.applyFsChanges(this.tree, changed);
    }, 120);
  }

  async setRoot(root: string | null): Promise<void> {
    if (!root?.trim()) {
      this.tree.viewRoot = null;
      this.tree.cache.clear();
      this.tree.selected.clear();
      this.showEmptyMessage("No working directory yet (cd into a directory).");
      return;
    }
    if (!isNativeAbsoluteFsPath(root)) {
      this.tree.viewRoot = null;
      this.tree.cache.clear();
      this.tree.selected.clear();
      this.tree.prefetchToken += 1;
      this.showEmptyMessage("File panel needs a native absolute directory.");
      this.persistActivePaneState();
      return;
    }
    const normalizedRoot = normalizeFsPathKey(root);
    const normalizedCurrent = normalizeFsPathKey(this.tree.viewRoot ?? "");
    if (normalizedRoot !== normalizedCurrent) {
      this.tree.viewRoot = root;
      this.tree.cache.clear();
      this.tree.selected.clear();
      this.tree.prefetchToken += 1;
      await this.loadRoot();
    }
    this.persistActivePaneState();
  }

  async refresh(): Promise<void> {
    const root = this.tree.viewRoot;
    if (!isNativeAbsoluteFsPath(root)) return;
    const st = this.tree.cache.get(root);
    if (st?.loaded) return;
    await this.loadRoot();
  }

  // ── Internal: setup ──

  private setupVirtualScroll(): void {
    this.scrollEl.addEventListener("scroll", () => {
      this.updateVisibleRange(this.tree);
    }, { passive: true });
    this.scrollEl.addEventListener("dragover", (e) => {
      const dragged = this.dragState.draggedPaths;
      if (!dragged?.length) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    this.scrollEl.addEventListener("drop", (e) => {
      const dragged = this.dragState.draggedPaths;
      if (!dragged?.length) return;
      e.preventDefault();
      const root = this.tree.viewRoot;
      if (root) {
        void this.executeMove(dragged, root, "inside", true);
      }
    });
  }

  private setupKeyboardNav(): void {
    this.scrollEl.setAttribute("tabindex", "0");
    this.scrollEl.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); this.navigateKeyboard(1); break;
        case "ArrowUp": e.preventDefault(); this.navigateKeyboard(-1); break;
        case "ArrowRight": e.preventDefault(); this.expandSelected(); break;
        case "ArrowLeft": e.preventDefault(); this.collapseSelected(); break;
        case "Enter": e.preventDefault(); void this.activateSelected(); break;
        case "Delete": e.preventDefault(); void this.deleteSelected(); break;
        case "F2": e.preventDefault(); void this.renameSelected(); break;
        case "Escape":
          if (this.tree.inlineNew || this.tree.inlineRenamePath) {
            e.preventDefault();
            this.tree.inlineNew = null;
            this.tree.inlineRenamePath = null;
            this.render();
          }
          break;
      }
    });
  }

  private navigateKeyboard(direction: 1 | -1): void {
    const t = this.tree;
    if (t.flatItems.length === 0) return;
    t.keyboardNavIndex = Math.max(0, Math.min(t.flatItems.length - 1, t.keyboardNavIndex + direction));
    const flatItem = t.flatItems[t.keyboardNavIndex];
    if (flatItem?.kind === "entry") {
      this.select(t, flatItem.entry.path);
      const itemTop = t.keyboardNavIndex * t.itemHeight;
      const itemBottom = itemTop + t.itemHeight;
      const scrollTop = this.scrollEl.scrollTop;
      const scrollBottom = scrollTop + this.scrollEl.clientHeight;
      if (itemTop < scrollTop) this.scrollEl.scrollTop = itemTop;
      else if (itemBottom > scrollBottom) this.scrollEl.scrollTop = itemBottom - this.scrollEl.clientHeight;
    }
  }

  // ── Internal: tree operations ──

  private expandSelected(): void {
    const path = this.getSelectedPath();
    if (!path) return;
    const st = this.ensureState(path);
    if (st && !st.expanded) this.toggleDir(path);
  }

  private collapseSelected(): void {
    const path = this.getSelectedPath();
    if (!path) return;
    const st = this.ensureState(path);
    if (st && st.expanded) this.toggleDir(path);
  }

  private activateSelected(): void {
    const path = this.getSelectedPath();
    if (!path) return;
    const entry = this.findEntry(path);
    if (entry?.isDir) {
      this.toggleDir(path);
    } else if (entry) {
      void this.doOpenInEditor(path);
    }
  }

  private async deleteSelected(): Promise<void> {
    const path = this.getSelectedPath();
    if (!path) return;
    const entry = this.findEntry(path);
    await this.doDelete([path], entry?.isDir ?? false);
  }

  private renameSelected(): void {
    const path = this.getSelectedPath();
    if (!path) return;
    this.doRename(path);
  }

  private getSelectedPath(): string | null {
    return this.tree.selected.size > 0 ? [...this.tree.selected][0]! : null;
  }

  private findEntry(path: string): FsEntry | null {
    for (const [, state] of this.tree.cache) {
      if (state.children) {
        const entry = state.children.find((e) => e.path === path);
        if (entry) return entry;
      }
    }
    return null;
  }

  private select(t: TreeView, path: string): void {
    t.selected.clear();
    t.selected.add(path);
    this.syncVisibleSelectionDecorations(t);
  }

  // ── Internal: context menu ──

  private hideCtx(): void {
    this.ctxEl?.remove();
    this.ctxEl = null;
  }

  private showEmptyMessage(message: string): void {
    this.scrollEl.replaceChildren();
    const p = document.createElement("p");
    p.className = "file-tree-empty";
    p.textContent = message;
    this.scrollEl.appendChild(p);
  }

  private async loadRoot(): Promise<void> {
    const root = this.tree.viewRoot;
    if (!isNativeAbsoluteFsPath(root)) return;
    await this.backend.setRoot(root);
    const st = this.ensureState(root);
    st.expanded = true;
    if (!st.loaded) {
      try {
        st.children = await this.backend.readDirectory(root);
        st.loaded = true;
      } catch (e) {
        this.scheduleRecover();
        this.scrollEl.replaceChildren();
        const p = document.createElement("p");
        p.className = "file-tree-error";
        p.textContent = String(e);
        this.scrollEl.appendChild(p);
        return;
      }
    }
    this.queuePrefetch(root, this.prefetchDepth);
    this.persistActivePaneState();
    this.render();
  }

  private scheduleRecover(): void {
    if (this.recoverTimer) return;
    this.recoverTimer = window.setTimeout(() => {
      this.recoverTimer = 0;
      void this.forceReload();
    }, 900);
  }

  private ensureState(path: string): NodeState {
    let s = this.tree.cache.get(path);
    if (!s) {
      s = { loaded: false, expanded: false, children: null };
      this.tree.cache.set(path, s);
    }
    return s;
  }

  private toggleDir(path: string): void {
    const st = this.ensureState(path);
    if (!st.expanded && !st.loaded) {
      st.expanded = true;
      st.loading = true;
      this.render();
      this.backend.readDirectory(path)
        .then((children) => {
          st.children = children;
          st.loaded = true;
          st.loading = false;
          this.queuePrefetch(path, this.prefetchDepth - 1);
          this.render();
        })
        .catch((e) => {
          st.expanded = false;
          st.loading = false;
          this.render();
          void showAlert(`Failed to read directory: ${String(e)}`, "Error");
        });
      return;
    }
    st.expanded = !st.expanded;
    this.render();
  }

  private toggleSelect(path: string, ev: PointerEvent): void {
    const t = this.tree;
    if (ev.shiftKey && (t.selectionAnchorPath || t.selected.size > 0)) {
      const anchor = t.selectionAnchorPath ?? [...t.selected][0] ?? null;
      if (anchor) {
        const range = this.getRangeBetweenPaths(anchor, path);
        t.selected.clear();
        range.forEach((p) => t.selected.add(p));
      }
    } else if (!ev.ctrlKey && !ev.metaKey) {
      t.selected.clear();
      t.selected.add(path);
      t.selectionAnchorPath = path;
    } else {
      if (t.selected.has(path)) t.selected.delete(path);
      else t.selected.add(path);
      t.selectionAnchorPath = path;
    }
    this.syncVisibleSelectionDecorations(t);
  }

  private getRangeBetweenPaths(from: string, to: string): string[] {
    const t = this.tree;
    const fromIndex = t.flatItems.findIndex(item => item.kind === "entry" && item.entry.path === from);
    const toIndex = t.flatItems.findIndex(item => item.kind === "entry" && item.entry.path === to);
    if (fromIndex === -1 || toIndex === -1) return [to];
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const result: string[] = [];
    for (let i = start; i <= end; i++) {
      const item = t.flatItems[i];
      if (item.kind === "entry") result.push(item.entry.path);
    }
    return result;
  }

  // ── Internal: operations (rename, delete, duplicate, new file/folder) ──

  private doRename(path: string): void {
    const state = this.ensureState(path);
    if (state.operationInProgress) return;
    this.tree.inlineRenamePath = path;
    this.render();
  }

  private async finishInlineRename(path: string, nextRaw: string): Promise<void> {
    if (this.tree.inlineRenamePath !== path) return;
    this.tree.inlineRenamePath = null;
    const next = nextRaw.trim();
    const name = basename(path);
    if (!next || next === name) { this.render(); return; }
    const parent = (await this.backend.getParentDirectory(path).catch(() => null))?.trim() ?? "";
    if (!parent) { void showAlert("Could not resolve parent folder.", "Rename"); this.render(); return; }
    const to = joinWin(parent, next);
    try {
      await this.backend.rename(path, to);
      this.invalidatePath(parent);
      await this.refresh();
      this.select(this.tree, to);
    } catch (e) {
      void showAlert(String(e), "Rename failed");
      await this.refresh();
    }
  }

  private invalidatePath(dir: string): void {
    this.tree.cache.delete(dir);
    for (const k of [...this.tree.cache.keys()]) {
      if (k.startsWith(dir + "\\") || k.startsWith(dir + "/")) this.tree.cache.delete(k);
    }
  }

  private async doDelete(paths: string[], isDir?: boolean): Promise<void> {
    if (!paths.length) return;
    for (const p of paths) {
      const state = this.ensureState(p);
      if (state.operationInProgress) return;
    }
    if (this.ownerCtx.getConfirmDeletePrompt()) {
      const message = paths.length === 1
        ? isDir
          ? `Permanently delete folder "${basename(paths[0]!)}" and all its contents?`
          : `Permanently delete "${basename(paths[0]!)}"?`
        : `Permanently delete ${paths.length} items?`;
      const ok = await showConfirm(message, "Delete", "Delete", true);
      if (!ok) return;
      if (paths.length === 1) {
        const dontAskAgain = await showConfirm("Stop showing delete confirmation dialogs?", "Delete", "Don't ask again", false);
        if (dontAskAgain) this.ownerCtx.setConfirmDeletePrompt(false);
      }
    }
    for (const p of paths) {
      const state = this.ensureState(p);
      state.operationInProgress = true;
    }
    try {
      for (const p of paths) {
        try { await this.backend.remove(p, true); } catch (e) { void showAlert(String(e), "Delete failed"); break; }
      }
      this.tree.selected.clear();
      if (this.tree.viewRoot) this.invalidatePath(this.tree.viewRoot);
      await this.refresh();
    } finally {
      for (const p of paths) {
        const state = this.tree.cache.get(p);
        if (state) state.operationInProgress = false;
      }
    }
  }

  private async doDuplicate(path: string): Promise<void> {
    const name = basename(path);
    const parent = (await this.backend.getParentDirectory(path).catch(() => null))?.trim() ?? "";
    if (!parent) { void showAlert("Could not resolve parent folder.", "Duplicate"); return; }
    const nameWithoutExt = name.replace(/\.[^.]+$/, "");
    const ext = name.match(/\.[^.]+$/)?.[0] || "";
    let duplicateName = `${nameWithoutExt} (Copy)${ext}`;
    let counter = 2;
    const parentState = this.tree.cache.get(parent);
    if (parentState?.children) {
      const existingNames = new Set(parentState.children.map((c) => c.name));
      while (existingNames.has(duplicateName)) { duplicateName = `${nameWithoutExt} (Copy${counter})${ext}`; counter++; }
    }
    const to = joinWin(parent, duplicateName);
    try {
      await this.backend.move(path, to);
      this.invalidatePath(parent);
      await this.refresh();
      this.select(this.tree, to);
    } catch (e) { void showAlert(String(e), "Duplicate failed"); }
  }

  private async doOpenInEditor(path: string): Promise<void> {
    try {
      await invoke("open_in_editor", { path });
    } catch {
      const event = new CustomEvent("file-tree-open", { detail: { path, isDir: !!this.findEntry(path)?.isDir } });
      document.dispatchEvent(event);
    }
  }

  private doNewFile(intoDir?: string): void {
    const base = intoDir?.trim() || this.tree.viewRoot;
    if (!base) return;
    const st = this.ensureState(base);
    if (!st.expanded) st.expanded = true;
    this.tree.inlineNew = { parent: base, mode: "newfile", initial: "untitled.txt" };
    this.render();
  }

  private doNewFolder(intoDir?: string): void {
    const base = intoDir?.trim() || this.tree.viewRoot;
    if (!base) return;
    const st = this.ensureState(base);
    if (!st.expanded) st.expanded = true;
    this.tree.inlineNew = { parent: base, mode: "newfolder", initial: "new-folder" };
    this.render();
  }

  // ── Internal: context menu rendering ──

  private showCtxEmptyArea(x: number, y: number, rootPath: string): void {
    this.hideCtx();
    const menu = document.createElement("div");
    menu.className = "file-tree-ctx";
    const add = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "file-tree-ctx-item";
      b.textContent = label;
      b.addEventListener("click", () => { this.hideCtx(); void fn(); });
      menu.appendChild(b);
    };
    add("New file\u2026", () => this.doNewFile(rootPath));
    add("New folder\u2026", () => this.doNewFolder(rootPath));
    add("Open folder in external terminal", () => {
      void invoke("open_external_terminal", { cwd: rootPath, terminal: "wt" }).catch((e) => void showAlert(String(e), "Terminal"));
    });
    add("Move panel " + (this.ownerCtx.getPanelSide() === "right" ? "left" : "right"), () => {
      this.ownerCtx.setPanelSide(this.ownerCtx.getPanelSide() === "right" ? "left" : "right");
    });
    document.body.appendChild(menu);
    this.ctxEl = menu;
    this.positionCtxMenu(menu, x, y);
  }

  private showCtx(x: number, y: number, path: string, isDir: boolean): void {
    this.hideCtx();
    const menu = document.createElement("div");
    menu.className = "file-tree-ctx";
    const parentForNew = isDir ? path : dirnamePath(path);
    const add = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "file-tree-ctx-item";
      b.textContent = label;
      b.addEventListener("click", () => { this.hideCtx(); void fn(); });
      menu.appendChild(b);
    };
    const addSeparator = () => {
      const sep = document.createElement("div");
      sep.className = "file-tree-ctx-separator";
      menu.appendChild(sep);
    };
    add("New file\u2026", () => this.doNewFile(parentForNew));
    add("New folder\u2026", () => this.doNewFolder(parentForNew));
    addSeparator();
    add("Open (system)", () => void this.doOpenInEditor(path));
    add("Reveal in Explorer", () => void invoke("reveal_in_explorer", { path }).catch((e) => void showAlert(String(e), "Explorer")));
    add("Open folder in external terminal", () => {
      const cwd = isDir ? path : dirnamePath(path);
      void invoke("open_external_terminal", { cwd, terminal: "wt" }).catch((e) => void showAlert(String(e), "Terminal"));
    });
    if (!isDir && /\.(exe|bat|cmd|ps1|msi|vbs|com|scr)$/i.test(path)) {
      add("Run", () => void invoke("run_file", { path }).catch((e) => void showAlert(String(e), "Run")));
    }
    addSeparator();
    add("Move panel " + (this.ownerCtx.getPanelSide() === "right" ? "left" : "right"), () => {
      this.ownerCtx.setPanelSide(this.ownerCtx.getPanelSide() === "right" ? "left" : "right");
    });
    addSeparator();
    add("Copy name", () => void this.copyText(basename(path), "Name"));
    add("Copy path", () => void this.copyText(path, "Path"));
    add("Copy relative path", () => void this.copyText(this.localPathFromRoot(path, isDir), "Relative path"));
    addSeparator();
    add("Rename", () => { void this.renameSelected(); });
    add("Duplicate", () => void this.doDuplicate(path));
    add("Delete", () => void this.doDelete(this.tree.selected.size ? [...this.tree.selected] : [path], isDir));
    document.body.appendChild(menu);
    this.ctxEl = menu;
    this.positionCtxMenu(menu, x, y);
  }

  private positionCtxMenu(menu: HTMLElement, x: number, y: number): void {
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = x;
      let top = y;
      if (left + rect.width > vw) left = Math.max(0, vw - rect.width - 4);
      if (top + rect.height > vh) top = Math.max(0, y - rect.height);
      if (top < 0) top = 4;
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    });
  }

  // ── Internal: drag and drop ──

  private createDragGhost(_sourceRow: HTMLElement, ent: FsEntry): void {
    this.removeDragGhost();
    const ghost = document.createElement("div");
    ghost.className = "file-tree-drag-ghost";
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;pointer-events:none;z-index:9999;background:#3a3a40;border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:4px 10px;font-size:12px;color:#f4f4f5;display:flex;align-items:center;gap:6px;max-width:240px;white-space:nowrap;";
    const label = document.createElement("span");
    label.textContent = ent.name;
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    ghost.appendChild(label);
    const count = this.tree.selected.size > 1 ? this.tree.selected.size : 1;
    if (count > 1) {
      const badge = document.createElement("span");
      badge.textContent = String(count);
      badge.style.cssText = "background:#6366f1;color:#fff;border-radius:8px;padding:1px 5px;font-size:10px;font-weight:600;";
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    this.dragGhost = ghost;
  }

  private removeDragGhost(): void {
    if (this.dragGhost && this.dragGhost.parentElement) {
      this.dragGhost.parentElement.removeChild(this.dragGhost);
    }
    this.dragGhost = null;
  }

  private async executeMove(fromPaths: string | string[], toPath: string, position: "before" | "after" | "inside", targetIsDir: boolean): Promise<void> {
    const raw = Array.isArray(fromPaths) ? fromPaths : [fromPaths];
    const norm = (p: string) => normalizeFsPathKey(p).replace(/[/\\]+$/, "");
    const unique = Array.from(new Set(raw));
    const list = unique.filter((candidate) =>
      !unique.some((other) => {
        if (candidate === other) return false;
        const a = norm(candidate);
        const b = norm(other);
        return a.startsWith(`${b}\/`) || a.startsWith(`${b}\\`);
      })
    );
    if (list.some((fromPath) => {
      const a = norm(toPath);
      const b = norm(fromPath);
      return a === b || a.startsWith(`${b}\/`) || a.startsWith(`${b}\\`);
    })) {
      void showAlert("Cannot move a folder into itself or its own child.", "Move failed");
      return;
    }
    const outDest: string[] = [];
    for (const fromPath of list) {
      let destPath: string;
      if (position === "inside" && targetIsDir) {
        const fromName = basename(fromPath);
        destPath = joinWin(toPath, fromName);
      } else {
        const parentPath = toPath.substring(0, Math.max(toPath.lastIndexOf("/"), toPath.lastIndexOf("\\")));
        const fromName = basename(fromPath);
        destPath = joinWin(parentPath || toPath, fromName);
      }
      if (normalizeFsPathKey(fromPath) === normalizeFsPathKey(destPath)) continue;
      try {
        await invoke("fs_move_path", { from: fromPath, to: destPath });
        outDest.push(destPath);
      } catch (e) {
        console.error("Failed to move file/folder:", e);
        void showAlert(String(e), "Move failed");
        break;
      }
    }
    if (outDest.length === 0) return;
    if (this.tree.viewRoot) this.invalidatePath(this.tree.viewRoot);
    await this.refresh();
    this.select(this.tree, outDest[outDest.length - 1]!);
  }

  // ── Internal: flat list building ──

  private buildFlatList(t: TreeView): void {
    const cwd = t.viewRoot;
    if (!cwd || !t.cache.get(cwd)?.children) { t.flatItems = []; return; }
    t.flatItems = [];
    const visit = (entries: FsEntry[], depth: number, parentPath: string): void => {
      if (t.inlineNew && normalizeFsPathKey(t.inlineNew.parent) === normalizeFsPathKey(parentPath)) {
        t.flatItems.push({ kind: "inline", depth, mode: t.inlineNew.mode, parent: t.inlineNew.parent, initial: t.inlineNew.initial });
      }
      for (const ent of entries) {
        t.flatItems.push({ kind: "entry", entry: ent, depth });
        if (ent.isDir) {
          const st = t.cache.get(ent.path);
          if (st?.expanded && st.children) visit(st.children, depth + 1, ent.path);
        }
      }
    };
    visit(t.cache.get(cwd)!.children!, 0, cwd);
  }

  // ── Internal: pane state persistence ──

  private cloneNodeState(st: NodeState): NodeState {
    return {
      loaded: st.loaded,
      expanded: st.expanded,
      children: st.children ? [...st.children] : null,
      loading: st.loading,
      operationInProgress: st.operationInProgress,
    };
  }

  private persistActivePaneState(): void {
    if (!this.activePaneId) return;
    const t = this.tree;
    const cacheEntries: Array<[string, NodeState]> = [];
    for (const [path, state] of t.cache.entries()) {
      cacheEntries.push([path, this.cloneNodeState(state)]);
    }
    this.paneStates.set(this.activePaneId, {
      viewRoot: t.viewRoot,
      selected: [...t.selected],
      scrollTop: this.scrollEl.scrollTop,
      cacheEntries,
    });
  }

  private restorePaneState(paneId: string): void {
    const snap = this.paneStates.get(paneId);
    const t = this.tree;
    t.cache.clear();
    t.selected.clear();
    if (!snap) {
      t.viewRoot = null;
      this.render();
      return;
    }
    t.viewRoot = snap.viewRoot;
    for (const [path, state] of snap.cacheEntries) {
      t.cache.set(path, this.cloneNodeState(state));
    }
    for (const path of snap.selected) t.selected.add(path);
    this.render();
    this.scrollEl.scrollTop = snap.scrollTop;
  }

  // ── Internal: FS watcher changes ──

  private async applyFsChanges(t: TreeView, paths: string[]): Promise<void> {
    if (t.fsSyncInFlight) {
      for (const path of paths) t.pendingFsPaths.add(path);
      return;
    }
    t.fsSyncInFlight = true;
    try {
      const dirs = this.collectDirsForReload(t, paths);
      let updated = false;
      for (const dir of dirs) {
        const st = t.cache.get(dir);
        if (!st?.loaded) continue;
        try {
          st.children = await this.backend.readDirectory(dir);
          st.loaded = true;
          st.loading = false;
          updated = true;
        } catch { st.loaded = false; st.children = null; }
      }
      if (updated) this.render();
      if (t.viewRoot) this.queuePrefetch(t.viewRoot, this.prefetchDepth);
    } finally {
      t.fsSyncInFlight = false;
      if (t.pendingFsPaths.size > 0 && !t.fsRefreshTimer) {
        t.fsRefreshTimer = window.setTimeout(() => {
          t.fsRefreshTimer = 0;
          const changed = [...t.pendingFsPaths];
          t.pendingFsPaths.clear();
          void this.applyFsChanges(t, changed);
        }, 140);
      }
    }
  }

  private collectDirsForReload(t: TreeView, paths: string[]): string[] {
    const root = t.viewRoot;
    if (!root) return [];
    const rootKey = normalizeFsPathKey(root);
    const rootPrefix = `${rootKey}/`;
    const out = new Set<string>();
    if (!paths.length && t.cache.get(root)?.loaded) out.add(root);
    for (const rawPath of paths) {
      const key = normalizeFsPathKey(rawPath);
      if (key !== rootKey && !key.startsWith(rootPrefix)) continue;
      const parent = dirnamePath(rawPath);
      if (t.cache.get(parent)?.loaded) out.add(parent);
      if (t.cache.get(rawPath)?.loaded) out.add(rawPath);
      let current = parent;
      while (current && normalizeFsPathKey(current).startsWith(rootKey)) {
        const state = t.cache.get(current);
        if (state?.loaded) out.add(current);
        const next = dirnamePath(current);
        if (normalizeFsPathKey(next) === normalizeFsPathKey(current)) break;
        current = next;
      }
    }
    if (out.size === 0 && t.cache.get(root)?.loaded) out.add(root);
    return [...out];
  }

  // ── Internal: prefetch ──

  private queuePrefetch(path: string, depth: number): void {
    if (depth <= 0) return;
    const token = this.tree.prefetchToken;
    const budget = { dirs: 0 };
    void this.prefetchDirectoryChildren(path, depth, token, budget);
  }

  private async prefetchDirectoryChildren(path: string, depth: number, token: number, budget: { dirs: number }): Promise<void> {
    if (depth <= 0 || token !== this.tree.prefetchToken) return;
    if (budget.dirs >= this.tree.prefetchDirBudget) return;
    const state = this.tree.cache.get(path);
    if (!state?.children) return;
    for (const ent of state.children) {
      if (!ent.isDir) continue;
      if (token !== this.tree.prefetchToken || budget.dirs >= this.tree.prefetchDirBudget) return;
      const childState = this.tree.cache.get(ent.path);
      if (childState?.loaded || childState?.loading || childState?.operationInProgress) {
        await this.prefetchDirectoryChildren(ent.path, depth - 1, token, budget);
        continue;
      }
      let summary: { entries: number; dirs: number } | null = null;
      try { summary = await this.backend.readDirectorySummary(ent.path); } catch { continue; }
      if (!summary) continue;
      if (summary.entries > this.tree.prefetchMaxEntriesPerDir || summary.dirs > this.tree.prefetchMaxSubdirsPerDir) continue;
      const ns = this.ensureState(ent.path);
      try {
        ns.loading = true;
        ns.children = await this.backend.readDirectory(ent.path);
        ns.loaded = true;
        ns.loading = false;
        budget.dirs += 1;
      } catch { ns.loading = false; continue; }
      await this.prefetchDirectoryChildren(ent.path, depth - 1, token, budget);
    }
  }

  // ── Internal: rendering ──

  private localPathFromRoot(path: string, isDir: boolean): string {
    const root = this.tree.viewRoot;
    if (!root) return isDir ? `${basename(path)}/` : basename(path);
    const rootKey = normalizeFsPathKey(root);
    const pathKey = normalizeFsPathKey(path);
    if (pathKey === rootKey) return ".";
    if (!pathKey.startsWith(`${rootKey}/`)) return isDir ? `${basename(path)}/` : basename(path);
    const rel = path.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
    if (!rel) return ".";
    if (isDir && !rel.endsWith("/")) return `${rel}/`;
    return rel;
  }

  private async copyText(text: string, label: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); } catch (e) { void showAlert(`Failed to copy ${label.toLowerCase()}: ${String(e)}`, "Copy"); }
  }

  private syncVisibleSelectionDecorations(t: TreeView): void {
    for (const [path, li] of t.renderedElements.entries()) {
      if (path.startsWith("__inline__")) continue;
      const row = li.querySelector(".file-tree-row") as HTMLElement | null;
      if (!row) continue;
      row.classList.toggle("file-tree-row--selected", t.selected.has(path));
    }
  }

  private updateVisibleRange(t: TreeView): void {
    const scrollTop = this.scrollEl.scrollTop;
    const containerHeight = this.scrollEl.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / t.itemHeight) - t.overscan);
    const end = Math.min(t.flatItems.length, Math.ceil((scrollTop + containerHeight) / t.itemHeight) + t.overscan);
    if (t.visibleRange.start === start && t.visibleRange.end === end) return;
    t.visibleRange = { start, end };
    this.renderVisibleItems(t);
  }

  private render(): void {
    const t = this.tree;
    const cwd = t.viewRoot;
    if (!cwd || !t.cache.get(cwd)?.children) {
      this.scrollEl.replaceChildren();
      t.flatItems = [];
      t.renderedElements.clear();
      t.virtualContainer = null;
      return;
    }
    this.buildFlatList(t);
    if (!t.virtualContainer) {
      this.scrollEl.replaceChildren();
      t.virtualContainer = document.createElement("div");
      t.virtualContainer.className = "file-tree-virtual-container";
      t.virtualContainer.setAttribute("role", "tree");
      this.scrollEl.appendChild(t.virtualContainer);
    }
    const totalHeight = t.flatItems.length * t.itemHeight;
    t.virtualContainer.style.height = `${totalHeight}px`;
    t.virtualContainer.style.position = "relative";
    t.visibleRange = { start: -1, end: -1 };
    this.updateVisibleRange(t);
  }

  private renderVisibleItems(t: TreeView): void {
    if (!t.virtualContainer) return;
    const { start, end } = t.visibleRange;
    const currentKeys = new Set<string>();
    for (let i = start; i < end; i++) {
      const flatItem = t.flatItems[i];
      if (!flatItem) continue;
      let key: string;
      let li: HTMLLIElement;
      if (flatItem.kind === "inline") {
        key = `__inline__${normalizeFsPathKey(flatItem.parent)}`;
        currentKeys.add(key);
        li = t.renderedElements.get(key) ?? this.renderInlineNew(t, flatItem);
        t.renderedElements.set(key, li);
        if (!li.parentElement && t.virtualContainer) t.virtualContainer.appendChild(li);
      } else {
        const { entry, depth } = flatItem;
        key = entry.path;
        currentKeys.add(key);
        let el = t.renderedElements.get(key);
        if (!el) {
          el = this.renderEntry(t, entry, depth);
          t.renderedElements.set(key, el);
          if (t.virtualContainer) t.virtualContainer.appendChild(el);
        } else {
          const row = el.querySelector(".file-tree-row") as HTMLElement | null;
          if (row) {
            row.style.setProperty("--ft-depth", String(depth));
            row.classList.toggle("file-tree-row--selected", t.selected.has(entry.path));
          }
        }
        li = el;
      }
      li.style.position = "absolute";
      li.style.top = `${i * t.itemHeight}px`;
      li.style.left = "0";
      li.style.right = "0";
      li.style.height = `${t.itemHeight}px`;
    }
    for (const [path, element] of t.renderedElements.entries()) {
      if (!currentKeys.has(path)) { element.remove(); t.renderedElements.delete(path); }
    }
  }

  private renderInlineNew(t: TreeView, item: FlatInline): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "file-tree-item";
    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.style.setProperty("--ft-depth", String(item.depth));
    const glyph = document.createElement("span");
    glyph.className = "file-tree-glyph";
    glyph.textContent = item.mode === "newfolder" ? "\uD83D\uDCC1" : "\uD83D\uDCC4";
    row.appendChild(glyph);
    const wrap = document.createElement("div");
    wrap.className = "file-tree-name-wrap";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "file-tree-inline-input";
    input.value = item.initial;
    input.dataset.inlineInput = "true";
    input.placeholder = item.mode === "newfolder" ? "Folder name" : "File name";
    const commit = async (): Promise<void> => {
      const name = input.value.trim();
      if (!name) { t.inlineNew = null; this.render(); return; }
      const base = item.parent;
      const path = joinWin(base, name);
      t.inlineNew = null;
      try {
        if (item.mode === "newfolder") await this.backend.createDirectory(path);
        else await this.backend.createFile(path);
        this.invalidatePath(base);
        await this.refresh();
        this.select(t, path);
      } catch (e) { void showAlert(String(e), "Create failed"); await this.refresh(); }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void commit(); }
      else if (e.key === "Escape") { e.preventDefault(); t.inlineNew = null; this.render(); }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!t.inlineNew) return;
        if (!input.value.trim()) { t.inlineNew = null; this.render(); }
      }, 120);
    });
    wrap.appendChild(input);
    row.appendChild(wrap);
    li.appendChild(row);
    requestAnimationFrame(() => { input.focus(); input.select(); });
    return li;
  }

  private renderEntry(t: TreeView, ent: FsEntry, depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "file-tree-item";
    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.style.setProperty("--ft-depth", String(depth));
    if (t.selected.has(ent.path)) row.classList.add("file-tree-row--selected");

    // Drag & drop
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      const paths = t.selected.has(ent.path) && t.selected.size > 0 ? [...t.selected] : [ent.path];
      this.dragState.draggedPaths = paths;
      if (e.dataTransfer) {
        e.dataTransfer.setData("termie/path", ent.path);
        e.dataTransfer.setData("termie/paths", JSON.stringify(paths));
        e.dataTransfer.effectAllowed = "move";
        this.createDragGhost(row, ent);
        if (this.dragGhost) e.dataTransfer.setDragImage(this.dragGhost, 12, 12);
      }
      row.classList.add("file-tree-row--dragging");
    });
    row.addEventListener("dragend", () => {
      this.dragState.draggedPaths = null;
      this.dragState.dragOverPath = null;
      this.dragState.dropPosition = null;
      row.classList.remove("file-tree-row--dragging");
      this.removeDragGhost();
      document.querySelectorAll(".file-tree-row--drop-target").forEach((el) => {
        el.classList.remove("file-tree-row--drop-target");
        (el as HTMLElement).removeAttribute("data-drop-position");
      });
    });
    row.addEventListener("dragover", (e) => {
      const dragged = this.dragState.draggedPaths;
      if (!dragged?.length || dragged.includes(ent.path)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const fraction = (e.clientY - rect.top) / rect.height;
      const position: "before" | "after" | "inside" = fraction < 0.3 ? "before" : fraction > 0.7 || !ent.isDir ? "after" : "inside";
      this.dragState.dragOverPath = ent.path;
      this.dragState.dropPosition = position;
      row.classList.add("file-tree-row--drop-target");
      row.setAttribute("data-drop-position", position);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("file-tree-row--drop-target");
      row.removeAttribute("data-drop-position");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("file-tree-row--drop-target");
      row.removeAttribute("data-drop-position");
      const dragged = this.dragState.draggedPaths;
      if (!dragged?.length || dragged.includes(ent.path)) return;
      const position = this.dragState.dropPosition || "inside";
      void this.executeMove(dragged, ent.path, position, ent.isDir);
    });

    row.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const t2 = e.target as HTMLElement;
      if (t2.closest("input.file-tree-inline-input")) return;
      if (!e.ctrlKey && !e.metaKey && t.selected.has(ent.path) && t.selected.size > 1) return;
      this.toggleSelect(ent.path, e);
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!t.selected.has(ent.path)) { t.selected.clear(); t.selected.add(ent.path); this.syncVisibleSelectionDecorations(t); }
      this.showCtx(e.clientX, e.clientY, ent.path, ent.isDir);
    });

    // Glyph + name
    if (ent.isDir) {
      const glyph = document.createElement("span");
      glyph.className = "file-tree-glyph file-tree-glyph--dir";
      glyph.textContent = "";
      row.appendChild(glyph);
      const nameWrap = document.createElement("div");
      nameWrap.className = "file-tree-name-wrap";
      if (t.inlineRenamePath === ent.path) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "file-tree-inline-input";
        input.value = basename(ent.path);
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); void this.finishInlineRename(ent.path, input.value); }
          else if (e.key === "Escape") { e.preventDefault(); t.inlineRenamePath = null; this.render(); }
        });
        input.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (t.inlineRenamePath !== ent.path) return;
            if (document.activeElement === input) return;
            t.inlineRenamePath = null; this.render();
          }, 120);
        });
        nameWrap.appendChild(input);
        requestAnimationFrame(() => { input.focus(); input.select(); });
      } else {
        const label = document.createElement("span");
        label.className = "file-tree-label file-tree-label--dir";
        label.textContent = `${ent.name}/`;
        label.title = ent.path;
        nameWrap.appendChild(label);
      }
      row.appendChild(nameWrap);
    } else {
      const glyph = glyphForFile(ent.name);
      const glyphEl = document.createElement("span");
      glyphEl.className = "file-tree-glyph file-tree-glyph--file";
      glyphEl.textContent = glyph.glyph;
      glyphEl.style.color = glyph.color;
      row.appendChild(glyphEl);
      const nameWrap = document.createElement("div");
      nameWrap.className = "file-tree-name-wrap";
      if (t.inlineRenamePath === ent.path) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "file-tree-inline-input";
        input.value = basename(ent.path);
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); void this.finishInlineRename(ent.path, input.value); }
          else if (e.key === "Escape") { e.preventDefault(); t.inlineRenamePath = null; this.render(); }
        });
        input.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (t.inlineRenamePath !== ent.path) return;
            if (document.activeElement === input) return;
            t.inlineRenamePath = null; this.render();
          }, 120);
        });
        nameWrap.appendChild(input);
        requestAnimationFrame(() => { input.focus(); input.select(); });
      } else {
        const label = document.createElement("span");
        label.className = "file-tree-label file-tree-label--file";
        label.textContent = ent.name;
        label.title = ent.path;
        nameWrap.appendChild(label);
      }
      row.appendChild(nameWrap);
    }
    li.appendChild(row);
    li.dataset.path = ent.path;
    return li;
  }

  get prefetchDepth(): number {
    return this.tree.prefetchDepth;
  }
}
