/**
 * VSCode-parity file tree with git tracking, drag/drop, context menu, and Material icons.
 * Features: expandable folders, drag-drop animations, right-click operations, keyboard nav.
 */

import { invoke } from "@tauri-apps/api/core";
import { isNativeAbsoluteFsPath, normalizeFsPathKey } from "./oscCwd";
import { showAlert, showConfirm } from "./dialog";
import { FileTreeBackend, type GitRepoInfo, type DetectedApp } from "./fileTreeBackend";
import { EXTENSION_TO_ICON, FILENAME_TO_ICON, FOLDER_NAME_TO_ICON } from "./iconMappings";
import { createLucideIcon } from "./lucideIcons";

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  gitStatus?: string | null;
  iconKey?: string | null;
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


const GIT_STATUS_LETTER: Map<string, string> = new Map([
  ["untracked", "U"],
  ["modified", "M"],
  ["added", "A"],
  ["deleted", "D"],
  ["renamed", "R"],
  ["conflict", "C"],
  ["changed", "~"],
]);

const ICON_ALIASES: Record<string, string> = {
  folder: "folder-base",
  "folder-open": "folder-base-open",
  file: "document",
};

const iconUrlByFile = import.meta.glob<string>("./assets/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function iconUrlForKey(iconName: string): string {
  const base = ICON_ALIASES[iconName] ?? iconName;
  const rel = `./assets/icons/${base}.svg`;
  const fallback = `./assets/icons/document.svg`;
  return iconUrlByFile[rel] ?? iconUrlByFile[fallback] ?? "";
}

function hasIconAsset(iconName: string): boolean {
  const base = ICON_ALIASES[iconName] ?? iconName;
  const rel = `./assets/icons/${base}.svg`;
  return Boolean(iconUrlByFile[rel]);
}

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

function isRunnableFile(path: string): boolean {
  return /\.(exe|bat|cmd|ps1|msi|vbs|com|scr)$/i.test(path);
}

function getIconForEntry(entry: FsEntry): string {
  if (entry.isDir) {
    const folderName = entry.name.toLowerCase();
    const specialIcon = FOLDER_NAME_TO_ICON.get(folderName);
    if (specialIcon) return specialIcon;
    if (folderName.startsWith(".")) return "folder-config";
    return "folder";
  }
  
  const filename = entry.name.toLowerCase();
  const specialIcon = FILENAME_TO_ICON.get(filename);
  if (specialIcon) return specialIcon;
  
  const ext = filename.split(".").pop() || "";
  const extIcon = EXTENSION_TO_ICON.get(ext);
  if (extIcon) return extIcon;
  
  return "file";
}

function createIconElement(iconName: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "file-tree-icon";

  const img = document.createElement("img");
  img.src = iconUrlForKey(iconName);
  img.alt = "";
  img.loading = "lazy";
  img.draggable = false;

  img.onerror = () => {
    // Try Lucide icon as fallback
    const lucideIcon = createLucideIcon(iconName);
    if (lucideIcon) {
      img.replaceWith(lucideIcon);
      return;
    }
    
    // Fall back to folder/file icons
    if (iconName === "folder-open" || iconName.includes("open")) {
      img.src = iconUrlForKey("folder");
    } else if (iconName !== "file" && iconName !== "folder") {
      img.src = iconUrlForKey("file");
    }
  };

  span.appendChild(img);
  return span;
}

type FlatEntry = { kind: "entry"; entry: FsEntry; depth: number };
type FlatInline = {
  kind: "inline";
  depth: number;
  mode: "newfile" | "newfolder";
  parent: string;
  initial: string;
};
type FlatItem = FlatEntry | FlatInline;

type SearchKind = "all" | "file" | "folder" | "content";
type SearchMode = "name" | "content";
type SearchSpec = {
  mode: SearchMode;
  kind: SearchKind;
  pattern: string;
};
type SearchEntry = {
  entry: FsEntry;
  relPath: string;
  depth: number;
};

type PaneTreeState = {
  viewRoot: string | null;
  selected: string[];
  scrollTop: number;
  cacheEntries: Array<[string, NodeState]>;
};

export class FileTreePanel {
  private readonly cache = new Map<string, NodeState>();
  private viewRoot: string | null = null;
  private readonly selected = new Set<string>();
  private ctxEl: HTMLElement | null = null;
  private dragState: DragState = {
    draggedPaths: null,
    dragOverPath: null,
    dropPosition: null,
  };
  private dragGhost: HTMLElement | null = null;
  private keyboardNavIndex = -1;
  private selectionAnchorPath: string | null = null;

  /** Normalized absolute path → git status and diff counts (from backend). */
  private gitPathMap = new Map<string, { status: string; added: number; removed: number }>();
  private repoInfo: GitRepoInfo | null = null;
  private activePaneId: string | null = null;
  private readonly paneStates = new Map<string, PaneTreeState>();
  private inlineRenamePath: string | null = null;
  private inlineNew: { parent: string; mode: "newfile" | "newfolder"; initial: string } | null =
    null;
  
  /** Cache for detected editors and terminals. */
  private detectedApps: DetectedApp[] | null = null;

  private recoverTimer = 0;

  // ── Search / filter state ──
  private filterQuery = "";
  private filterMode: "name" | "content" = "name";
  private filterMatchCount = 0;
  private searchInputEl: HTMLInputElement | null = null;
  private searchCountEl: HTMLElement | null = null;
  private searchClearEl: HTMLElement | null = null;
  private searchFilterBtnEl: HTMLButtonElement | null = null;
  private searchModeMenuEl: HTMLElement | null = null;
  private searchWrapEl: HTMLElement | null = null;
  private searchEnabled = true;
  private searchKind: SearchKind = "all";
  private readonly contentSearchMetaByPath = new Map<string, { matches: number; label: string }>();

  // Virtual scrolling state
  private flatItems: FlatItem[] = [];
  private visibleRange = { start: 0, end: 0 };
  private readonly itemHeight = 22;
  private readonly overscan = 10;
  private renderedElements = new Map<string, HTMLLIElement>();
  private virtualContainer: HTMLElement | null = null;
  private summaryFooterEl: HTMLElement | null = null;
  private fsRefreshTimer = 0;
  private readonly pendingFsPaths = new Set<string>();
  private fsSyncInFlight = false;
  private prefetchToken = 0;
  private readonly prefetchDepth = 2;
  private readonly prefetchDirBudget = 96;
  private readonly prefetchMaxEntriesPerDir = 300;
  private readonly prefetchMaxSubdirsPerDir = 140;

  constructor(
    private readonly scrollEl: HTMLElement,
    private readonly backend: FileTreeBackend,
    private readonly getShowDiffCounts: () => boolean,
    private readonly getShowGitInfo: () => boolean = () => true,
    private readonly getConfirmDeletePrompt: () => boolean = () => true,
    private readonly setConfirmDeletePrompt: (enabled: boolean) => void = () => {},
  ) {
    this.setupKeyboardNav();
    this.setupVirtualScroll();
    this.setupSummaryFooter();
    this.setupSearchToolbar();

    // Set up git status change callback
    this.backend.onGitStatusChange = (statuses) => {
      this.gitPathMap = statuses;
      this.updateSummaryFooter();
      this.syncVisibleGitDecorations();
    };
    this.backend.onGitRepoInfoChange = (info) => {
      this.repoInfo = info;
      this.updateSummaryFooter();
    };

    this.scrollEl.addEventListener("contextmenu", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".file-tree-row")) return;
      e.preventDefault();
      const root = this.viewRoot;
      if (!root) return;
      this.showCtxEmptyArea(e.clientX, e.clientY, root);
    });
    document.addEventListener("pointerdown", (e) => {
      if (this.ctxEl && !this.ctxEl.contains(e.target as Node)) this.hideCtx();
    });
  }

  // ── Search / filter ────────────────────────────────────────────────

  /** Show or hide the search toolbar. */
  setSearchEnabled(enabled: boolean): void {
    this.searchEnabled = enabled;
    if (this.searchWrapEl) {
      this.searchWrapEl.style.display = enabled ? "" : "none";
    }
    if (!enabled && this.filterQuery) {
      this.clearFilter();
    }
  }

  /** Focus the filter input for keyboard shortcut support. */
  focusFilter(): void {
    if (!this.searchEnabled) return;
    this.searchInputEl?.focus();
  }

  /** Whether the filter input currently has focus. */
  isFilterFocused(): boolean {
    return this.searchInputEl === document.activeElement;
  }

  /** Get the current filter query. */
  getFilterQuery(): string {
    return this.filterQuery;
  }

  private clearFilter(): void {
    if (this.searchInputEl) {
      this.searchInputEl.value = "";
    }
    this.contentSearchMetaByPath.clear();
    this.applyFilter("", "name");
  }

  private setupSearchToolbar(): void {
    const dock = this.scrollEl.parentElement;
    if (!dock) return;

    const wrap = document.createElement("div");
    wrap.className = "file-tree-search-wrap";
    this.searchWrapEl = wrap;

    const filterBtn = document.createElement("button");
    filterBtn.type = "button";
    filterBtn.className = "file-tree-search-filter";
    filterBtn.title = "Filter mode";
    filterBtn.setAttribute("aria-label", "Choose file search filter mode");
    const funnel = createLucideIcon("filter");
    if (funnel) filterBtn.appendChild(funnel);
    else filterBtn.textContent = "F";
    this.searchFilterBtnEl = filterBtn;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "file-tree-search-input";
    input.setAttribute("aria-label", "Filter files by name, path, or extension; press Enter to grep");
    input.spellcheck = false;
    this.searchInputEl = input;

    const count = document.createElement("span");
    count.className = "file-tree-search-count";
    count.setAttribute("aria-live", "polite");
    this.searchCountEl = count;

    const clear = document.createElement("button");
    clear.className = "file-tree-search-clear";
    clear.textContent = "\u2715"; // ✕
    clear.setAttribute("aria-label", "Clear filter");
    clear.title = "Clear filter (Escape)";
    this.searchClearEl = clear;

    wrap.appendChild(filterBtn);
    wrap.appendChild(input);
    wrap.appendChild(count);
    wrap.appendChild(clear);
    dock.insertBefore(wrap, this.scrollEl);

    if (!this.searchEnabled) {
      wrap.style.display = "none";
    }

    // Input handler
    input.addEventListener("input", () => {
      this.applyFilter(input.value.trim(), "name");
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (input.value) {
          this.clearFilter();
        } else {
          input.blur();
          const term = document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
          term?.focus();
        }
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Enter") {
        const q = input.value.trim();
        if (q) {
          this.applyFilter(q, "content");
        }
        e.preventDefault();
      }
    });

    filterBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSearchModeMenu(filterBtn);
    });

    // Clear button
    clear.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.clearFilter();
      input.focus();
    });
  }

  private toggleSearchModeMenu(anchor: HTMLElement): void {
    if (this.searchModeMenuEl) {
      this.searchModeMenuEl.remove();
      this.searchModeMenuEl = null;
      return;
    }

    const menu = document.createElement("div");
    menu.className = "file-tree-search-menu";
    const opts: Array<{ kind: SearchKind; label: string }> = [
      { kind: "all", label: "All" },
      { kind: "file", label: "Files" },
      { kind: "folder", label: "Folders" },
      { kind: "content", label: "Content" },
    ];
    for (const opt of opts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "file-tree-search-menu-item";
      if (opt.kind === this.searchKind) btn.classList.add("file-tree-search-menu-item--active");
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        this.searchKind = opt.kind;
        this.updateSearchFilterButton();
        const value = this.searchInputEl?.value.trim() ?? "";
        this.applyFilter(value, opt.kind === "content" ? "content" : "name");
        menu.remove();
        this.searchModeMenuEl = null;
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(4, rect.left)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    this.searchModeMenuEl = menu;
    window.setTimeout(() => {
      const close = (e: PointerEvent): void => {
        if (menu.contains(e.target as Node)) return;
        menu.remove();
        this.searchModeMenuEl = null;
        document.removeEventListener("pointerdown", close, true);
      };
      document.addEventListener("pointerdown", close, true);
    }, 0);
  }

  private updateSearchFilterButton(): void {
    this.searchFilterBtnEl?.classList.toggle("file-tree-search-filter--active", this.searchKind !== "all");
    this.searchFilterBtnEl?.setAttribute("data-mode", this.searchKind);
  }

  private parseSearchQuery(raw: string, forcedMode: SearchMode): SearchSpec {
    let q = raw.trim();
    let mode = forcedMode;
    let kind = this.searchKind;
    const lower = q.toLowerCase();
    const prefixes: Array<[string, SearchKind | "content"]> = [
      ["rg:", "content"],
      ["grep:", "content"],
      ["content:", "content"],
      ["file:", "file"],
      ["files:", "file"],
      ["dir:", "folder"],
      ["folder:", "folder"],
      ["path:", "all"],
    ];
    for (const [prefix, parsed] of prefixes) {
      if (!lower.startsWith(prefix)) continue;
      q = q.slice(prefix.length).trim();
      if (parsed === "content") mode = "content";
      else kind = parsed;
      break;
    }
    return { mode, kind, pattern: q };
  }

  private relativePathFor(absPath: string): string {
    const root = this.viewRoot;
    if (!root) return basename(absPath);
    const absKey = normalizeFsPathKey(absPath);
    const rootKey = normalizeFsPathKey(root);
    if (absKey === rootKey) return "";
    const prefix = `${rootKey}/`;
    if (!absKey.startsWith(prefix)) return basename(absPath);
    return absKey.slice(prefix.length);
  }

  private collectVisibleEntries(): SearchEntry[] {
    const out: SearchEntry[] = [];
    const root = this.viewRoot;
    const children = root ? this.ensureState(root).children : null;
    if (!root || !children) return out;

    const visit = (entries: FsEntry[], depth: number): void => {
      for (const entry of entries) {
        out.push({ entry, depth, relPath: this.relativePathFor(entry.path) });
        if (!entry.isDir) continue;
        const state = this.cache.get(normalizeFsPathKey(entry.path));
        if (state?.children) visit(state.children, depth + 1);
      }
    };
    visit(children, 0);
    return out;
  }

  private entryMatchesSpec(item: SearchEntry, spec: SearchSpec): boolean {
    if (!spec.pattern) return true;
    if (spec.kind === "file" && item.entry.isDir) return false;
    if (spec.kind === "folder" && !item.entry.isDir) return false;
    const pattern = spec.pattern.replace(/\\/g, "/");
    if (pattern.includes("/")) return this.matchesPattern(item.relPath, pattern, false);
    return this.matchesPattern(item.entry.name, pattern, true);
  }

  private matchesPattern(value: string, pattern: string, substringWhenPlain: boolean): boolean {
    const v = value.replace(/\\/g, "/").toLowerCase();
    const p = pattern.toLowerCase();
    if (!/[?*]/.test(p)) return substringWhenPlain ? v.includes(p) : v.startsWith(p);
    const source = p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    try {
      return new RegExp(`^${source}$`, "i").test(value.replace(/\\/g, "/"));
    } catch {
      return substringWhenPlain ? v.includes(p) : v.startsWith(p);
    }
  }

  /**
   * Apply a filter query to the file tree.
   * @param query The filter text (glob, extension, path prefix, or plain substring).
   * @param mode  "name" = recursive name filter; "content" = backend grep search.
   */
  private applyFilter(query: string, mode: "name" | "content"): void {
    const spec = this.parseSearchQuery(query, mode);
    this.filterQuery = query;
    this.filterMode = spec.mode;
    if (spec.kind !== this.searchKind) {
      this.searchKind = spec.kind;
      this.updateSearchFilterButton();
    }

    // Update clear button visibility
    if (this.searchClearEl) {
      this.searchClearEl.classList.toggle("file-tree-search-clear--visible", query.length > 0);
    }

    if (spec.mode === "content" && spec.pattern) {
      void this.runContentSearch(spec.pattern);
      return;
    }

    this.contentSearchMetaByPath.clear();
    this.renderedElements.forEach((el) => el.remove());
    this.renderedElements.clear();
    this.rebuildFilteredView(spec);
  }

  /**
   * Rebuild the flat list using recursive cached entries + current filter.
   */
  private rebuildFilteredView(spec = this.parseSearchQuery(this.filterQuery, "name")): void {
    const cwd = this.viewRoot;
    if (!cwd || !this.ensureState(cwd).children) {
      if (this.virtualContainer) {
        this.virtualContainer.remove();
        this.virtualContainer = null;
      }
      this.flatItems = [];
      this.renderedElements.clear();
      this.filterMatchCount = 0;
      this.updateSearchCount();
      return;
    }

    if (spec.pattern) this.buildSearchFlatList(spec);
    else this.buildFlatList();

    this.presentFlatItems();
  }

  private presentFlatItems(): void {
    const cwd = this.viewRoot;
    if (!cwd) return;

    if (!this.virtualContainer) {
      this.virtualContainer = document.createElement("div");
      this.virtualContainer.className = "file-tree-virtual-container";
      this.virtualContainer.setAttribute("role", "tree");
      this.scrollEl.appendChild(this.virtualContainer);
    }

    const totalHeight = this.flatItems.length * this.itemHeight;
    this.virtualContainer.style.height = `${totalHeight}px`;
    this.virtualContainer.style.position = "relative";

    this.visibleRange = { start: -1, end: -1 };
    this.updateVisibleRange();
    this.updateSearchCount();
  }

  /** Run a backend content search (grep/rg) and display results with match counts. */
  private async runContentSearch(query: string): Promise<void> {
    if (!this.viewRoot || !query) return;

    // Show searching state
    this.flatItems = [];
    if (this.searchCountEl) {
      this.searchCountEl.textContent = "\u2026"; // …
    }
    this.renderedElements.forEach((el) => el.remove());
    this.renderedElements.clear();
    this.presentFlatItems();
    if (this.searchCountEl) {
      this.searchCountEl.textContent = "\u2026";
    }

    try {
      const results = await this.backend.searchFileContents(this.viewRoot, query);
      this.contentSearchMetaByPath.clear();
      this.flatItems = [];
      this.filterMatchCount = 0;
      this.renderedElements.forEach((el) => el.remove());
      this.renderedElements.clear();

      for (const result of results) {
        const absPath = result.path;
        const relDisplay = this.viewRoot
          ? absPath.startsWith(this.viewRoot)
            ? absPath.slice(this.viewRoot.length).replace(/^[/\\]+/, "")
            : basename(absPath)
          : basename(absPath);
        const entry: FsEntry = {
          name: basename(absPath),
          path: absPath,
          isDir: false,
          gitStatus: null,
          iconKey: null,
        };
        this.contentSearchMetaByPath.set(normalizeFsPathKey(absPath), {
          matches: result.matches,
          label: relDisplay,
        });
        this.flatItems.push({
          kind: "entry",
          entry,
          depth: 0,
        });
        this.filterMatchCount++;
      }
      this.presentFlatItems();
      this.updateSearchCount();
    } catch (e) {
      console.warn("Content search failed:", e);
      this.filterMatchCount = 0;
      this.updateSearchCount();
      // Fall back to name filter
      this.filterMode = "name";
      this.rebuildFilteredView();
    }
  }

  private updateSearchCount(): void {
    if (!this.searchCountEl) return;
    if (!this.filterQuery) {
      this.searchCountEl.textContent = "";
      return;
    }
    if (this.filterMode === "content") {
      this.searchCountEl.textContent = `${this.filterMatchCount}`;
      return;
    }
    this.searchCountEl.textContent = this.filterMatchCount > 0 ? `${this.filterMatchCount}` : "0";
  }

  // ── End search / filter ────────────────────────────────────────────
  private setupVirtualScroll(): void {
    this.scrollEl.addEventListener("scroll", () => {
      this.updateVisibleRange();
    }, { passive: true });
    
    // Add dragover to container to handle drops over empty space
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
      // Drop at root - append to viewRoot
      const root = this.viewRoot;
      if (root) {
        void this.executeMove(dragged, root, "inside", true);
      }
    });
  }
  
  private setupKeyboardNav(): void {
    this.scrollEl.setAttribute("tabindex", "0");
    this.scrollEl.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          this.navigateKeyboard(1);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          this.navigateKeyboard(-1);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          this.expandSelected();
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          this.collapseSelected();
          break;
        }
        case "Enter": {
          e.preventDefault();
          void this.activateSelected();
          break;
        }
        case "Delete": {
          e.preventDefault();
          void this.deleteSelected();
          break;
        }
        case "F2": {
          e.preventDefault();
          void this.renameSelected();
          break;
        }
        case "Escape": {
          if (this.inlineNew || this.inlineRenamePath) {
            e.preventDefault();
            this.inlineNew = null;
            this.inlineRenamePath = null;
            this.render();
          }
          break;
        }
      }
    });
  }
  
  private navigateKeyboard(direction: 1 | -1): void {
    if (this.flatItems.length === 0) return;

    this.keyboardNavIndex = Math.max(0, Math.min(this.flatItems.length - 1, this.keyboardNavIndex + direction));
    const flatItem = this.flatItems[this.keyboardNavIndex];
    if (flatItem && flatItem.kind === "entry") {
      this.select(flatItem.entry.path);
      // Scroll into view if needed
      const itemTop = this.keyboardNavIndex * this.itemHeight;
      const itemBottom = itemTop + this.itemHeight;
      const scrollTop = this.scrollEl.scrollTop;
      const scrollBottom = scrollTop + this.scrollEl.clientHeight;
      
      if (itemTop < scrollTop) {
        this.scrollEl.scrollTop = itemTop;
      } else if (itemBottom > scrollBottom) {
        this.scrollEl.scrollTop = itemBottom - this.scrollEl.clientHeight;
      }
    }
  }
  
  private expandSelected(): void {
    const path = this.getSelectedPath();
    if (!path) return;
    const st = this.ensureState(path);
    if (st && !st.expanded) {
      this.toggleDir(path);
    }
  }
  
  private collapseSelected(): void {
    const path = this.getSelectedPath();
    if (!path) return;
    const st = this.ensureState(path);
    if (st && st.expanded) {
      this.toggleDir(path);
    }
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
    return this.selected.size > 0 ? [...this.selected][0]! : null;
  }
  
  private findEntry(path: string): FsEntry | null {
    for (const [, state] of this.cache) {
      if (state.children) {
        const entry = state.children.find((e) => e.path === path);
        if (entry) return entry;
      }
    }
    return null;
  }
  
  private select(path: string): void {
    this.selected.clear();
    this.selected.add(path);
    this.syncVisibleSelectionDecorations();
  }

  dispose(): void {
    this.persistActivePaneState();
    this.cache.clear();
    this.selected.clear();
    this.renderedElements.clear();
    this.hideCtx();
    if (this.recoverTimer) {
      window.clearTimeout(this.recoverTimer);
      this.recoverTimer = 0;
    }
    if (this.fsRefreshTimer) {
      window.clearTimeout(this.fsRefreshTimer);
      this.fsRefreshTimer = 0;
    }
    this.summaryFooterEl?.remove();
    this.summaryFooterEl = null;
  }

  async forceReload(): Promise<void> {
    this.cache.clear();
    this.selected.clear();
    this.renderedElements.clear();
    this.gitPathMap.clear();
    this.repoInfo = null;
    this.prefetchToken += 1;
    this.updateSummaryFooter();
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
    this.viewRoot = null;
    this.cache.clear();
    this.selected.clear();
    this.render();
  }

  updateRepoInfo(repoInfo: GitRepoInfo | null): void {
    this.repoInfo = repoInfo;
    this.updateSummaryFooter();
  }

  handleFileSystemChange(paths: string[]): void {
    const root = this.viewRoot;
    if (!root) return;
    if (!paths.length) {
      this.pendingFsPaths.add(root);
    } else {
      const rootKey = normalizeFsPathKey(root);
      const prefix = `${rootKey}/`;
      for (const path of paths) {
        const key = normalizeFsPathKey(path);
        if (key === rootKey || key.startsWith(prefix)) {
          this.pendingFsPaths.add(path);
        }
      }
      if (this.pendingFsPaths.size === 0) {
        return;
      }
    }
    if (this.fsRefreshTimer) return;
    this.fsRefreshTimer = window.setTimeout(() => {
      this.fsRefreshTimer = 0;
      const changed = [...this.pendingFsPaths];
      this.pendingFsPaths.clear();
      void this.applyFsChanges(changed);
    }, 120);
  }

  private async applyFsChanges(paths: string[]): Promise<void> {
    if (this.fsSyncInFlight) {
      for (const path of paths) this.pendingFsPaths.add(path);
      return;
    }
    this.fsSyncInFlight = true;
    try {
      const dirs = this.collectDirsForReload(paths);
      let updated = false;
      for (const dir of dirs) {
        const st = this.cache.get(dir);
        if (!st?.loaded) continue;
        try {
          st.children = await this.backend.readDirectory(dir);
          st.loaded = true;
          st.loading = false;
          updated = true;
        } catch {
          st.loaded = false;
          st.children = null;
        }
      }
      if (updated) {
        this.render();
      }
      if (this.viewRoot) {
        this.queuePrefetch(this.viewRoot, this.prefetchDepth);
      }
    } finally {
      this.fsSyncInFlight = false;
      if (this.pendingFsPaths.size > 0 && !this.fsRefreshTimer) {
        this.fsRefreshTimer = window.setTimeout(() => {
          this.fsRefreshTimer = 0;
          const changed = [...this.pendingFsPaths];
          this.pendingFsPaths.clear();
          void this.applyFsChanges(changed);
        }, 140);
      }
    }
  }

  private collectDirsForReload(paths: string[]): string[] {
    const root = this.viewRoot;
    if (!root) return [];
    const rootKey = normalizeFsPathKey(root);
    const rootPrefix = `${rootKey}/`;
    const out = new Set<string>();
    if (!paths.length && this.cache.get(root)?.loaded) {
      out.add(root);
    }
    for (const rawPath of paths) {
      const key = normalizeFsPathKey(rawPath);
      if (key !== rootKey && !key.startsWith(rootPrefix)) continue;
      const parent = dirnamePath(rawPath);
      if (this.cache.get(parent)?.loaded) out.add(parent);
      if (this.cache.get(rawPath)?.loaded) out.add(rawPath);
      let current = parent;
      while (current && normalizeFsPathKey(current).startsWith(rootKey)) {
        const state = this.cache.get(current);
        if (state?.loaded) out.add(current);
        const next = dirnamePath(current);
        if (normalizeFsPathKey(next) === normalizeFsPathKey(current)) break;
        current = next;
      }
    }
    if (out.size === 0 && this.cache.get(root)?.loaded) {
      out.add(root);
    }
    return [...out];
  }

  private scheduleRecover(): void {
    if (this.recoverTimer) return;
    this.recoverTimer = window.setTimeout(() => {
      this.recoverTimer = 0;
      void this.forceReload();
    }, 900);
  }

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

  /**
   * Set the root directory for the file tree.
   * Called by the coordinator when cwd changes.
   */
  async setRoot(root: string | null): Promise<void> {
    if (!root?.trim()) {
      this.viewRoot = null;
      this.cache.clear();
      this.selected.clear();
      this.showEmptyMessage("No working directory yet (cd into a directory).");
      this.repoInfo = null;
      this.updateSummaryFooter();
      return;
    }

    if (!isNativeAbsoluteFsPath(root)) {
      this.viewRoot = null;
      this.cache.clear();
      this.selected.clear();
      this.gitPathMap.clear();
      this.repoInfo = null;
      this.prefetchToken += 1;
      this.showEmptyMessage("File panel needs a native absolute directory.");
      this.persistActivePaneState();
      this.updateSummaryFooter();
      return;
    }

    const normalizedRoot = normalizeFsPathKey(root);
    const normalizedCurrent = normalizeFsPathKey(this.viewRoot ?? "");

    if (normalizedRoot !== normalizedCurrent) {
      this.viewRoot = root;
      this.cache.clear();
      this.selected.clear();
      this.prefetchToken += 1;
      await this.loadRoot();
    }
    this.persistActivePaneState();
    this.updateSummaryFooter();
  }

  /**
   * Update git statuses from the backend.
   * Called by the backend when git status changes.
   */
  updateGitStatuses(statuses: Map<string, { status: string; added: number; removed: number }>): void {
    this.gitPathMap = statuses;
    this.updateSummaryFooter();
    this.syncVisibleGitDecorations();
  }

  /**
   * Load the root directory.
   */
  private async loadRoot(): Promise<void> {
    const root = this.viewRoot;
    if (!isNativeAbsoluteFsPath(root)) return;

    // Update backend root
    await this.backend.setRoot(root);

    // Get git statuses from backend
    const statuses = this.backend.getAllGitStatuses();
    this.gitPathMap = statuses;
    this.repoInfo = this.backend.getGitRepoInfo();
    this.updateSummaryFooter();

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

  async refresh(): Promise<void> {
    const root = this.viewRoot;
    if (!isNativeAbsoluteFsPath(root)) return;
    const st = this.cache.get(root);
    if (st?.loaded) {
      this.gitPathMap = this.backend.getAllGitStatuses();
      this.repoInfo = this.backend.getGitRepoInfo();
      this.updateSummaryFooter();
      this.syncVisibleGitDecorations();
      return;
    }
    await this.loadRoot();
  }

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
    const cacheEntries: Array<[string, NodeState]> = [];
    for (const [path, state] of this.cache.entries()) {
      cacheEntries.push([path, this.cloneNodeState(state)]);
    }
    this.paneStates.set(this.activePaneId, {
      viewRoot: this.viewRoot,
      selected: [...this.selected],
      scrollTop: this.scrollEl.scrollTop,
      cacheEntries,
    });
  }

  private restorePaneState(paneId: string): void {
    const snap = this.paneStates.get(paneId);
    this.cache.clear();
    this.selected.clear();
    if (!snap) {
      this.viewRoot = null;
      this.render();
      return;
    }
    this.viewRoot = snap.viewRoot;
    for (const [path, state] of snap.cacheEntries) {
      this.cache.set(path, this.cloneNodeState(state));
    }
    for (const path of snap.selected) {
      this.selected.add(path);
    }
    this.render();
    this.scrollEl.scrollTop = snap.scrollTop;
  }

  private ensureState(path: string): NodeState {
    let s = this.cache.get(path);
    if (!s) {
      s = { loaded: false, expanded: false, children: null };
      this.cache.set(path, s);
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
    if (ev.shiftKey && (this.selectionAnchorPath || this.selected.size > 0)) {
      const anchor = this.selectionAnchorPath ?? [...this.selected][0] ?? null;
      if (anchor) {
        const range = this.getRangeBetweenPaths(anchor, path);
        this.selected.clear();
        range.forEach((p) => this.selected.add(p));
      }
    } else if (!ev.ctrlKey && !ev.metaKey) {
      this.selected.clear();
      this.selected.add(path);
      this.selectionAnchorPath = path;
    } else {
      if (this.selected.has(path)) this.selected.delete(path);
      else this.selected.add(path);
      this.selectionAnchorPath = path;
    }
    this.syncVisibleSelectionDecorations();
  }

  private getRangeBetweenPaths(from: string, to: string): string[] {
    const fromIndex = this.flatItems.findIndex(item => item.kind === "entry" && item.entry.path === from);
    const toIndex = this.flatItems.findIndex(item => item.kind === "entry" && item.entry.path === to);
    if (fromIndex === -1 || toIndex === -1) return [to];
    
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const result: string[] = [];
    for (let i = start; i <= end; i++) {
      const item = this.flatItems[i];
      if (item.kind === "entry") {
        result.push(item.entry.path);
      }
    }
    return result;
  }

  private doRename(path: string): void {
    const state = this.ensureState(path);
    if (state.operationInProgress) return;
    this.inlineRenamePath = path;
    this.render();
  }

  private async finishInlineRename(path: string, nextRaw: string): Promise<void> {
    if (this.inlineRenamePath !== path) return;
    this.inlineRenamePath = null;
    const next = nextRaw.trim();
    const name = basename(path);
    if (!next || next === name) {
      this.render();
      return;
    }
    const parent =
      (await this.backend.getParentDirectory(path).catch(() => null))?.trim() ?? "";
    if (!parent) {
      void showAlert("Could not resolve parent folder.", "Rename");
      this.render();
      return;
    }
    const to = joinWin(parent, next);
    try {
      await this.backend.rename(path, to);
      this.invalidatePath(parent);
      await this.refresh();
      this.select(to);
    } catch (e) {
      void showAlert(String(e), "Rename failed");
      await this.refresh();
    }
  }

  private invalidatePath(dir: string): void {
    this.cache.delete(dir);
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(dir + "\\") || k.startsWith(dir + "/")) this.cache.delete(k);
    }
  }

  private async doDelete(paths: string[], isDir?: boolean): Promise<void> {
    if (!paths.length) return;
    
    // Check if any operation is in progress
    for (const p of paths) {
      const state = this.ensureState(p);
      if (state.operationInProgress) return;
    }
    
    if (this.getConfirmDeletePrompt()) {
      const message = paths.length === 1
        ? isDir
          ? `Permanently delete folder "${basename(paths[0]!)}" and all its contents?`
          : `Permanently delete "${basename(paths[0]!)}"?`
        : `Permanently delete ${paths.length} items?`;
      const ok = await showConfirm(message, "Delete", "Delete", true);
      if (!ok) return;

      if (paths.length === 1) {
        const dontAskAgain = await showConfirm(
          "Stop showing delete confirmation dialogs?",
          "Delete",
          "Don't ask again",
          false,
        );
        if (dontAskAgain) {
          this.setConfirmDeletePrompt(false);
        }
      }
    }
    
    // Mark operations in progress
    for (const p of paths) {
      const state = this.ensureState(p);
      state.operationInProgress = true;
    }
    
    try {
      for (const p of paths) {
        try {
          await this.backend.remove(p, true);
        } catch (e) {
          void showAlert(String(e), "Delete failed");
          break;
        }
      }
      this.selected.clear();
      if (this.viewRoot) this.invalidatePath(this.viewRoot);
      await this.refresh();
    } finally {
      // Clear operations in progress
      for (const p of paths) {
        const state = this.cache.get(p);
        if (state) {
          state.operationInProgress = false;
        }
      }
    }
  }
  
  private async doDuplicate(path: string): Promise<void> {
    const name = basename(path);
    const parent =
      (await this.backend.getParentDirectory(path).catch(() => null))?.trim() ?? "";
    if (!parent) {
      void showAlert("Could not resolve parent folder.", "Duplicate");
      return;
    }

    // Generate duplicate name with (Copy), (Copy2), etc. format
    const nameWithoutExt = name.replace(/\.[^.]+$/, "");
    const ext = name.match(/\.[^.]+$/)?.[0] || "";
    let duplicateName = `${nameWithoutExt} (Copy)${ext}`;
    let counter = 2;

    // Check if name exists and find unique name by checking the cache
    const parentState = this.cache.get(parent);
    if (parentState?.children) {
      const existingNames = new Set(parentState.children.map((c) => c.name));
      while (existingNames.has(duplicateName)) {
        duplicateName = `${nameWithoutExt} (Copy${counter})${ext}`;
        counter++;
      }
    }

    const to = joinWin(parent, duplicateName);
    try {
      await this.backend.move(path, to);
      this.invalidatePath(parent);
      await this.refresh();
      this.select(to);
    } catch (e) {
      void showAlert(String(e), "Duplicate failed");
    }
  }
  
  private async doOpenInEditor(path: string): Promise<void> {
    try {
      await invoke("open_in_editor", { path });
    } catch {
      // Fallback: emit event for main.ts to handle
      const entry = this.findEntry(path);
      if (!entry) return;
      const event = new CustomEvent("file-tree-open", { detail: { path, isDir: entry.isDir } });
      document.dispatchEvent(event);
    }
  }

  private async getDetectedApps(): Promise<DetectedApp[]> {
    if (this.detectedApps && this.detectedApps.length > 0) return this.detectedApps;
    try {
      const apps = await this.backend.detectInstalledApps();
      this.detectedApps = apps;
      return apps;
    } catch {
      return [];
    }
  }

  private doNewFile(intoDir?: string): void {
    const base = intoDir?.trim() || this.viewRoot;
    if (!base) return;
    const st = this.ensureState(base);
    if (!st.expanded) {
      st.expanded = true;
    }
    this.inlineNew = { parent: base, mode: "newfile", initial: "untitled.txt" };
    this.render();
  }

  private doNewFolder(intoDir?: string): void {
    const base = intoDir?.trim() || this.viewRoot;
    if (!base) return;
    const st = this.ensureState(base);
    if (!st.expanded) {
      st.expanded = true;
    }
    this.inlineNew = { parent: base, mode: "newfolder", initial: "new-folder" };
    this.render();
  }

  private showCtxEmptyArea(x: number, y: number, rootPath: string): void {
    this.hideCtx();
    const menu = document.createElement("div");
    menu.className = "file-tree-ctx";
    const add = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "file-tree-ctx-item";
      b.textContent = label;
      b.addEventListener("click", () => {
        this.hideCtx();
        void fn();
      });
      menu.appendChild(b);
    };
    add("New file…", () => this.doNewFile(rootPath));
    add("New folder…", () => this.doNewFolder(rootPath));
    add("Open folder in external terminal", () => {
      void invoke("open_external_terminal", { cwd: rootPath, terminal: "wt" }).catch((e) =>
        void showAlert(String(e), "Terminal"),
      );
    });
    document.body.appendChild(menu);
    this.ctxEl = menu;
    this.positionCtxMenu(menu, x, y);
  }

  private async showCtx(x: number, y: number, path: string, isDir: boolean): Promise<void> {
    this.hideCtx();
    const menu = document.createElement("div");
    menu.className = "file-tree-ctx";
    const parentForNew = isDir ? path : dirnamePath(path);

    const add = (
      label: string,
      fn: () => void,
      iconData?: string | null,
      iconMime?: string | null,
      fallbackIconName?: string,
    ) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "file-tree-ctx-item";
      
      if (iconData) {
        const icon = document.createElement("img");
        const mime = iconMime && iconMime.trim() ? iconMime : "image/png";
        icon.src = `data:${mime};base64,${iconData}`;
        icon.className = "file-tree-ctx-item-icon";
        icon.alt = "";
        icon.width = 16;
        icon.height = 16;
        icon.onerror = () => {
          const fallback = fallbackIconName ? createLucideIcon(fallbackIconName) : null;
          if (fallback) icon.replaceWith(fallback);
        };
        b.appendChild(icon);
      } else if (fallbackIconName) {
        const fallback = createLucideIcon(fallbackIconName);
        if (fallback) b.appendChild(fallback);
      }
      
      const text = document.createElement("span");
      text.textContent = label;
      b.appendChild(text);
      
      b.addEventListener("click", () => {
        this.hideCtx();
        void fn();
      });
      menu.appendChild(b);
    };

    const addSeparator = () => {
      const sep = document.createElement("div");
      sep.className = "file-tree-ctx-separator";
      menu.appendChild(sep);
    };

    add("New file…", () => this.doNewFile(parentForNew));
    add("New folder…", () => this.doNewFolder(parentForNew));
    addSeparator();

    add("Open (system)", () => void this.doOpenInEditor(path));
    add("Reveal in Explorer", () => void invoke("reveal_in_explorer", { path }).catch((e) => void showAlert(String(e), "Explorer")));
    
    // Dynamically add detected editors and terminals
    const apps = await this.getDetectedApps();
    const editors = apps.filter(app => app.app_type === "editor");
    const terminals = apps.filter(app => app.app_type === "terminal");
    
    if (editors.length > 0) {
      addSeparator();
      for (const editor of editors) {
        add(`Open in ${editor.name}`, () => 
          void invoke("open_with_editor", { path, editor: editor.command }).catch((e) => void showAlert(String(e), "Editor")),
          editor.icon_data,
          editor.icon_mime,
          "code2"
        );
      }
    }
    
    if (isDir && terminals.length > 0) {
      addSeparator();
      add("Open folder in external terminal", () => {
        const cwd = isDir ? path : dirnamePath(path);
        void invoke("open_external_terminal", { cwd, terminal: "wt" }).catch((e) => void showAlert(String(e), "Terminal"));
      });
      for (const terminal of terminals) {
        add(`Open in ${terminal.name}`, () => {
          const cwd = isDir ? path : dirnamePath(path);
          void invoke("open_external_terminal", { cwd, terminal: terminal.command }).catch((e) => void showAlert(String(e), "Terminal"));
        }, terminal.icon_data, terminal.icon_mime, "terminal");
      }
    } else if (isDir) {
      // Fallback to default terminal option if none detected
      add("Open folder in external terminal", () => {
        const cwd = isDir ? path : dirnamePath(path);
        void invoke("open_external_terminal", { cwd, terminal: "wt" }).catch((e) => void showAlert(String(e), "Terminal"));
      });
    }
    
    if (!isDir && isRunnableFile(path)) {
      add("Run", () => void invoke("run_file", { path }).catch((e) => void showAlert(String(e), "Run")));
    }
    addSeparator();

    add("Copy name", () => void this.copyText(basename(path), "Name"));
    add("Copy path", () => void this.copyText(path, "Path"));
    add("Copy relative path", () => void this.copyText(this.localPathFromRoot(path, isDir), "Relative path"));
    addSeparator();

    add("Rename", () => {
      void this.renameSelected();
    });
    add("Duplicate", () => void this.doDuplicate(path));
    add("Delete", () =>
      void this.doDelete(this.selected.size ? [...this.selected] : [path], isDir),
    );

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

  private createDragGhost(_sourceRow: HTMLElement, ent: FsEntry): void {
    this.removeDragGhost();
    const ghost = document.createElement("div");
    ghost.className = "file-tree-drag-ghost";
    ghost.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;pointer-events:none;z-index:9999;" +
      "background:#3a3a40;border:1px solid rgba(255,255,255,0.2);border-radius:6px;" +
      "padding:4px 10px;font-size:12px;color:#f4f4f5;display:flex;align-items:center;" +
      "gap:6px;max-width:240px;white-space:nowrap;";
    const icon = createIconElement(ent.isDir ? "folder" : getIconForEntry(ent));
    ghost.appendChild(icon);
    const label = document.createElement("span");
    label.textContent = ent.name;
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    ghost.appendChild(label);
    const count = this.selected.size > 1 ? this.selected.size : 1;
    if (count > 1) {
      const badge = document.createElement("span");
      badge.textContent = String(count);
      badge.style.cssText =
        "background:#6366f1;color:#fff;border-radius:8px;padding:1px 5px;font-size:10px;font-weight:600;";
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
  
  private async executeMove(
    fromPaths: string | string[],
    toPath: string,
    position: "before" | "after" | "inside",
    targetIsDir: boolean,
  ): Promise<void> {
    const raw = Array.isArray(fromPaths) ? fromPaths : [fromPaths];
    const norm = (p: string) => normalizeFsPathKey(p).replace(/[/\\]+$/, "");
    const unique = Array.from(new Set(raw));
    const list = unique.filter((candidate) =>
      !unique.some((other) => {
        if (candidate === other) return false;
        const a = norm(candidate);
        const b = norm(other);
        return a.startsWith(`${b}/`) || a.startsWith(`${b}\\`);
      }),
    );

    if (list.some((fromPath) => {
      const a = norm(toPath);
      const b = norm(fromPath);
      return a === b || a.startsWith(`${b}/`) || a.startsWith(`${b}\\`);
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

      if (normalizeFsPathKey(fromPath) === normalizeFsPathKey(destPath)) {
        continue;
      }

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

    if (this.viewRoot) {
      this.invalidatePath(this.viewRoot);
    }
    await this.refresh();
    this.select(outDest[outDest.length - 1]!);
  }

  private buildFlatList(): void {
    const cwd = this.viewRoot;
    if (!cwd || !this.ensureState(cwd).children) {
      this.flatItems = [];
      return;
    }

    this.flatItems = [];
    this.filterMatchCount = 0;

    const visit = (entries: FsEntry[], depth: number, parentPath: string): void => {
      if (
        this.inlineNew &&
        normalizeFsPathKey(this.inlineNew.parent) === normalizeFsPathKey(parentPath)
      ) {
        this.flatItems.push({
          kind: "inline",
          depth,
          mode: this.inlineNew.mode,
          parent: this.inlineNew.parent,
          initial: this.inlineNew.initial,
        });
      }
      for (const ent of entries) {
        this.flatItems.push({ kind: "entry", entry: ent, depth });
        if (ent.isDir) {
          const st = this.ensureState(ent.path);
          if (st.expanded && st.children) {
            visit(st.children, depth + 1, ent.path);
          }
        }
      }
    };

    const rootChildren = this.ensureState(cwd).children;
    if (rootChildren) {
      visit(rootChildren, 0, cwd);
    }
  }

  private buildSearchFlatList(spec: SearchSpec): void {
    this.flatItems = [];
    this.filterMatchCount = 0;
    const entries = this.collectVisibleEntries()
      .filter((item) => this.entryMatchesSpec(item, spec))
      .sort((a, b) => {
        if (a.entry.isDir !== b.entry.isDir) return a.entry.isDir ? -1 : 1;
        return a.relPath.localeCompare(b.relPath);
      });

    if (this.inlineNew) {
      this.flatItems.push({
        kind: "inline",
        depth: 0,
        mode: this.inlineNew.mode,
        parent: this.inlineNew.parent,
        initial: this.inlineNew.initial,
      });
    }

    for (const { entry } of entries) {
      this.flatItems.push({ kind: "entry", entry, depth: 0 });
      this.filterMatchCount++;
    }
  }

  private dirPrefixKey(dirAbs: string): string {
    return `${normalizeFsPathKey(dirAbs)}/`;
  }

  private setupSummaryFooter(): void {
    const dock = this.scrollEl.parentElement;
    if (!dock) return;
    const footer = document.createElement("div");
    footer.className = "file-tree-summary-footer file-tree-summary-footer--hidden";
    footer.setAttribute("aria-hidden", "true");
    footer.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("a")) return;
      e.preventDefault();
      e.stopPropagation();
    });
    footer.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    dock.appendChild(footer);
    this.summaryFooterEl = footer;
  }

  private computeRepoDiffSummary(): { changedFiles: number; totalFiles: number; added: number; removed: number } | null {
    if (this.repoInfo) {
      const totalFiles = Math.max(0, this.repoInfo.totalFiles ?? 0);
      const changedFiles = Math.max(0, this.repoInfo.changedFiles ?? 0);
      const added = Math.max(0, this.repoInfo.addedLines ?? 0);
      const removed = Math.max(0, this.repoInfo.removedLines ?? 0);
      if (totalFiles === 0 && changedFiles === 0 && added === 0 && removed === 0) return null;
      return { changedFiles, totalFiles, added, removed };
    }

    const root = this.viewRoot;
    if (!root) return null;
    const rootKey = normalizeFsPathKey(root);
    const prefix = `${rootKey}/`;
    let changedFiles = 0;
    let added = 0;
    let removed = 0;
    for (const [path, meta] of this.gitPathMap) {
      if (path !== rootKey && !path.startsWith(prefix)) continue;
      const a = Math.max(0, meta.added ?? 0);
      const r = Math.max(0, meta.removed ?? 0);
      if (a > 0 || r > 0) changedFiles += 1;
      added += a;
      removed += r;
    }
    const totalFiles = -1;
    if (changedFiles === 0 && added === 0 && removed === 0) return null;
    return { changedFiles, totalFiles, added, removed };
  }

  private updateSummaryFooter(): void {
    const footer = this.summaryFooterEl;
    if (!footer) return;
    
    // Check if git info panel should be shown
    if (!this.getShowGitInfo()) {
      footer.classList.add("file-tree-summary-footer--hidden");
      footer.setAttribute("aria-hidden", "true");
      footer.replaceChildren();
      return;
    }
    
    const showCounts = this.getShowDiffCounts();
    const summary = showCounts ? this.computeRepoDiffSummary() : null;
    if (!summary) {
      footer.classList.add("file-tree-summary-footer--hidden");
      footer.setAttribute("aria-hidden", "true");
      footer.replaceChildren();
      return;
    }

    footer.classList.remove("file-tree-summary-footer--hidden");
    footer.setAttribute("aria-hidden", "false");
    footer.replaceChildren();

    const root = this.viewRoot ?? this.repoInfo?.root ?? "";
    const repoName = this.repoInfo?.name || basename(root || "repo");
    const title = document.createElement("div");
    title.className = "file-tree-summary-title";
    title.textContent = repoName;

    const top = document.createElement("div");
    top.className = "file-tree-summary-top";

    const metrics = document.createElement("div");
    metrics.className = "file-tree-summary-metrics";

    const add = document.createElement("span");
    add.className = "file-tree-summary-metric file-tree-summary-metric--add";
    add.textContent = `+${summary.added}`;

    const remove = document.createElement("span");
    remove.className = "file-tree-summary-metric file-tree-summary-metric--remove";
    remove.textContent = `-${summary.removed}`;

    const changedMetric = document.createElement("span");
    changedMetric.className = "file-tree-summary-metric file-tree-summary-metric--changed";
    changedMetric.textContent = `${summary.changedFiles} changed`;

    metrics.append(add, remove, changedMetric);
    top.append(title, metrics);

    const remoteRow = document.createElement("div");
    remoteRow.className = "file-tree-summary-bottom";
    const remoteUrl = this.repoInfo?.remoteUrl?.trim();
    if (remoteUrl) {
      const link = document.createElement("a");
      link.className = "file-tree-summary-link";
      link.href = remoteUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "go to remote";
      remoteRow.appendChild(link);
    }

    footer.append(top, remoteRow);
  }

  private queuePrefetch(path: string, depth: number): void {
    if (depth <= 0) return;
    const token = this.prefetchToken;
    const budget = { dirs: 0 };
    void this.prefetchDirectoryChildren(path, depth, token, budget);
  }

  private async prefetchDirectoryChildren(
    path: string,
    depth: number,
    token: number,
    budget: { dirs: number },
  ): Promise<void> {
    if (depth <= 0 || token !== this.prefetchToken) return;
    if (budget.dirs >= this.prefetchDirBudget) return;
    const state = this.cache.get(path);
    if (!state?.children) return;

    for (const ent of state.children) {
      if (!ent.isDir) continue;
      if (token !== this.prefetchToken || budget.dirs >= this.prefetchDirBudget) return;

      const childState = this.ensureState(ent.path);
      if (childState.loaded || childState.loading || childState.operationInProgress) {
        await this.prefetchDirectoryChildren(ent.path, depth - 1, token, budget);
        continue;
      }

      let summary: { entries: number; dirs: number } | null = null;
      try {
        summary = await this.backend.readDirectorySummary(ent.path);
      } catch {
        continue;
      }

      if (!summary) continue;
      if (
        summary.entries > this.prefetchMaxEntriesPerDir ||
        summary.dirs > this.prefetchMaxSubdirsPerDir
      ) {
        continue;
      }

      try {
        childState.loading = true;
        childState.children = await this.backend.readDirectory(ent.path);
        childState.loaded = true;
        childState.loading = false;
        budget.dirs += 1;
      } catch {
        childState.loading = false;
        continue;
      }

      await this.prefetchDirectoryChildren(ent.path, depth - 1, token, budget);
    }
  }

  private applyGitDecorationToRow(row: HTMLElement, ent: FsEntry): void {
    const key = normalizeFsPathKey(ent.path);
    const gitMeta = this.gitPathMap.get(key);
    const gitForEntry = ent.gitStatus ?? gitMeta?.status ?? null;
    const showCounts = this.getShowDiffCounts();

    const label = row.querySelector(".file-tree-label") as HTMLElement | null;
    if (label) {
      label.className =
        `file-tree-label ${ent.isDir ? "file-tree-label--dir" : "file-tree-label--file"}` +
        this.gitClass(gitForEntry);
    }

    row.querySelectorAll(".file-tree-git-badge").forEach((el) => el.remove());
    if (ent.isDir) {
      const rollup = this.rollupForDir(ent.path);
      if (rollup) {
        row.appendChild(this.makeGitBadge(rollup.status, { isDir: true, rollupCount: rollup.count, showCounts }));
      } else if (gitForEntry) {
        row.appendChild(this.makeGitBadge(gitForEntry, { isDir: true, showCounts }));
      }
      return;
    }

    if (gitForEntry) {
      row.appendChild(this.makeGitBadge(gitForEntry, {
        isDir: false,
        added: gitMeta?.added,
        removed: gitMeta?.removed,
        showCounts,
      }));
    }
  }

  private syncVisibleGitDecorations(): void {
    for (const [path, li] of this.renderedElements.entries()) {
      if (path.startsWith("__inline__")) continue;
      const ent = this.findEntry(path);
      if (!ent) continue;
      const row = li.querySelector(".file-tree-row") as HTMLElement | null;
      if (!row) continue;
      this.applyGitDecorationToRow(row, ent);
    }
  }

  private syncVisibleSelectionDecorations(): void {
    for (const [path, li] of this.renderedElements.entries()) {
      if (path.startsWith("__inline__")) continue;
      const row = li.querySelector(".file-tree-row") as HTMLElement | null;
      if (!row) continue;
      row.classList.toggle("file-tree-row--selected", this.selected.has(path));
    }
  }

  private localPathFromRoot(path: string, isDir: boolean): string {
    const root = this.viewRoot;
    if (!root) return isDir ? `${basename(path)}/` : basename(path);
    const rootKey = normalizeFsPathKey(root);
    const pathKey = normalizeFsPathKey(path);
    if (pathKey === rootKey) return ".";
    if (!pathKey.startsWith(`${rootKey}/`)) {
      return isDir ? `${basename(path)}/` : basename(path);
    }
    const rel = path.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
    if (!rel) return ".";
    if (isDir && !rel.endsWith("/")) return `${rel}/`;
    return rel;
  }

  private async copyText(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      void showAlert(`Failed to copy ${label.toLowerCase()}: ${String(e)}`, "Copy");
    }
  }

  /** Dominant git status among all tracked files under this directory. */
  private rollupForDir(dirAbs: string): { status: string; count: number } | null {
    const prefix = this.dirPrefixKey(dirAbs);
    const counts = new Map<string, number>();
    for (const [p, meta] of this.gitPathMap) {
      if (!p.startsWith(prefix)) continue;
      counts.set(meta.status, (counts.get(meta.status) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    const priority = ["conflict", "deleted", "modified", "added", "untracked", "renamed", "changed"];
    let bestStatus = "";
    let bestCount = -1;
    let bestPri = 999;
    for (const [st, c] of counts) {
      const pri = priority.indexOf(st);
      const p = pri === -1 ? 50 : pri;
      if (c > bestCount || (c === bestCount && p < bestPri)) {
        bestCount = c;
        bestStatus = st;
        bestPri = p;
      }
    }
    return { status: bestStatus, count: bestCount };
  }

  private gitLetter(status: string): string {
    return GIT_STATUS_LETTER.get(status) ?? "?";
  }

  private makeGitBadge(
    status: string,
    opts: { isDir: boolean; rollupCount?: number; added?: number; removed?: number; showCounts?: boolean },
  ): HTMLElement {
    const el = document.createElement("span");
    el.className = "file-tree-git-badge";
    if (opts.isDir) el.classList.add("file-tree-git-badge--folder");
    el.classList.add(`file-tree-git--${status}`);
    const letter = this.gitLetter(status);
    const showCounts = opts.showCounts ?? false;
    const added = opts.added ?? 0;
    const removed = opts.removed ?? 0;

    if (opts.isDir && opts.rollupCount != null && opts.rollupCount > 0) {
      el.textContent =
        opts.rollupCount > 1 ? `${opts.rollupCount}${letter}` : letter;
      el.title = `${opts.rollupCount} ${status} (in subtree)`;
    } else if (showCounts && (added > 0 || removed > 0)) {
      const wrap = document.createElement("span");
      wrap.className = "file-tree-git-badge-wrap";
      const base = document.createElement("span");
      base.className = "file-tree-git-badge-letter";
      base.textContent = letter;
      wrap.appendChild(base);
      if (added > 0) {
        const a = document.createElement("span");
        a.className = "file-tree-git-badge-count file-tree-git-badge-count--add";
        a.textContent = `+${added}`;
        wrap.appendChild(a);
      }
      if (removed > 0) {
        const r = document.createElement("span");
        r.className = "file-tree-git-badge-count file-tree-git-badge-count--remove";
        r.textContent = `-${removed}`;
        wrap.appendChild(r);
      }
      el.appendChild(wrap);
      el.title = `${status}${added > 0 || removed > 0 ? ` (+${added}|-${removed})` : ""}`;
    } else {
      el.textContent = letter;
      el.title = status;
    }
    return el;
  }

  private updateVisibleRange(): void {
    const scrollTop = this.scrollEl.scrollTop;
    const containerHeight = this.scrollEl.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.overscan);
    const end = Math.min(
      this.flatItems.length,
      Math.ceil((scrollTop + containerHeight) / this.itemHeight) + this.overscan
    );
    
    if (this.visibleRange.start === start && this.visibleRange.end === end) return;
    
    this.visibleRange = { start, end };
    this.renderVisibleItems();
  }

  private render(): void {
    const cwd = this.viewRoot;
    if (!cwd || !this.ensureState(cwd).children) {
      this.scrollEl.replaceChildren();
      this.flatItems = [];
      this.renderedElements.clear();
      this.virtualContainer = null;
      this.updateSummaryFooter();
      return;
    }

    this.buildFlatList();

    if (!this.virtualContainer) {
      this.scrollEl.replaceChildren();
      this.virtualContainer = document.createElement("div");
      this.virtualContainer.className = "file-tree-virtual-container";
      this.virtualContainer.setAttribute("role", "tree");
      this.scrollEl.appendChild(this.virtualContainer);
    }

    const totalHeight = this.flatItems.length * this.itemHeight;
    this.virtualContainer.style.height = `${totalHeight}px`;
    this.virtualContainer.style.position = "relative";

    this.visibleRange = { start: -1, end: -1 };
    this.updateVisibleRange();
    this.updateSummaryFooter();
  }

  private renderVisibleItems(): void {
    if (!this.virtualContainer) return;

    const { start, end } = this.visibleRange;
    const currentKeys = new Set<string>();

    for (let i = start; i < end; i++) {
      const flatItem = this.flatItems[i];
      if (!flatItem) continue;

      let key: string;
      let li: HTMLLIElement;

      if (flatItem.kind === "inline") {
        key = `__inline__${normalizeFsPathKey(flatItem.parent)}`;
        currentKeys.add(key);
        li = this.renderedElements.get(key) ?? this.renderInlineNew(flatItem, i);
        this.renderedElements.set(key, li);
        if (!li.parentElement && this.virtualContainer) {
          this.virtualContainer.appendChild(li);
        }
      } else {
        const { entry, depth } = flatItem;
        key = entry.path;
        currentKeys.add(key);
        let el = this.renderedElements.get(key);
        if (!el) {
          el = this.renderEntry(entry, depth);
          this.renderedElements.set(key, el);
          if (this.virtualContainer) {
            this.virtualContainer.appendChild(el);
          }
        } else {
          const row = el.querySelector(".file-tree-row") as HTMLElement | null;
          if (row) {
            row.style.setProperty("--ft-depth", String(depth));
            row.classList.toggle("file-tree-row--selected", this.selected.has(entry.path));
          }
        }
        li = el;
      }

      li.style.position = "absolute";
      li.style.top = `${i * this.itemHeight}px`;
      li.style.left = "0";
      li.style.right = "0";
      li.style.height = `${this.itemHeight}px`;
    }

    for (const [path, element] of this.renderedElements.entries()) {
      if (!currentKeys.has(path)) {
        element.remove();
        this.renderedElements.delete(path);
      }
    }
  }

  private renderInlineNew(item: FlatInline, _index: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "file-tree-item";
    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.style.setProperty("--ft-depth", String(item.depth));

    const spacer = document.createElement("span");
    spacer.className = "file-tree-chevron file-tree-chevron--spacer";
    row.appendChild(spacer);

    const icon = createIconElement(item.mode === "newfolder" ? "folder" : "document");
    row.appendChild(icon);

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
      if (!name) {
        this.inlineNew = null;
        this.render();
        return;
      }
      const base = item.parent;
      const path = joinWin(base, name);
      this.inlineNew = null;
      try {
        if (item.mode === "newfolder") {
          await this.backend.createDirectory(path);
        } else {
          await this.backend.createFile(path);
        }
        this.invalidatePath(base);
        await this.refresh();
        // Select the newly created item but don't open it
        this.select(path);
      } catch (e) {
        void showAlert(String(e), "Create failed");
        await this.refresh();
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.inlineNew = null;
        this.render();
      }
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!this.inlineNew) return;
        if (!input.value.trim()) {
          this.inlineNew = null;
          this.render();
        }
      }, 120);
    });

    wrap.appendChild(input);
    row.appendChild(wrap);
    li.appendChild(row);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });

    return li;
  }

  private gitClass(status: string | null | undefined): string {
    if (!status) return "";
    return ` file-tree-git--${status}`;
  }

  private renderEntry(ent: FsEntry, depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "file-tree-item";

    const row = document.createElement("div");
    row.className = "file-tree-row";
    if (this.selected.has(ent.path)) row.classList.add("file-tree-row--selected");
    row.style.setProperty("--ft-depth", String(depth));
    if (ent.iconKey) row.dataset.iconKey = ent.iconKey;

    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      const paths =
        this.selected.has(ent.path) && this.selected.size > 0
          ? [...this.selected]
          : [ent.path];
      this.dragState.draggedPaths = paths;
      if (e.dataTransfer) {
        e.dataTransfer.setData("termie/path", ent.path);
        e.dataTransfer.setData("termie/paths", JSON.stringify(paths));
        e.dataTransfer.effectAllowed = "move";
        this.createDragGhost(row, ent);
        if (this.dragGhost) {
          e.dataTransfer.setDragImage(this.dragGhost, 12, 12);
        }
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
      const position: "before" | "after" | "inside" =
        fraction < 0.3 ? "before" : fraction > 0.7 || !ent.isDir ? "after" : "inside";
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
      const t = e.target as HTMLElement;
      if (t.closest("input.file-tree-inline-input, .file-tree-chevron")) return;
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        this.selected.has(ent.path) &&
        this.selected.size > 1
      ) {
        return;
      }
      this.toggleSelect(ent.path, e);
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!this.selected.has(ent.path)) {
        this.selected.clear();
        this.selected.add(ent.path);
        this.syncVisibleSelectionDecorations();
      }
      void this.showCtx(e.clientX, e.clientY, ent.path, ent.isDir);
    });

    if (ent.isDir) {
      const st = this.ensureState(ent.path);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "file-tree-chevron";
      toggle.setAttribute("aria-expanded", st.expanded ? "true" : "false");
      toggle.textContent = st.expanded ? "▾" : "▸";
      if (st.loading) {
        toggle.classList.add("file-tree-chevron--loading");
        toggle.textContent = "…";
      }
      toggle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        void this.toggleDir(ent.path);
      });
      row.appendChild(toggle);

      const closedIcon = getIconForEntry(ent);
      const openCandidate = `${closedIcon}-open`;
      const iconName = st.expanded
        ? hasIconAsset(openCandidate)
          ? openCandidate
          : hasIconAsset("folder-open")
            ? "folder-open"
            : closedIcon
        : closedIcon;
      const iconSpan = createIconElement(iconName);
      iconSpan.classList.add("file-tree-icon--folder");
      row.appendChild(iconSpan);

      const nameWrap = document.createElement("div");
      nameWrap.className = "file-tree-name-wrap";

      if (this.inlineRenamePath === ent.path) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "file-tree-inline-input";
        input.value = basename(ent.path);
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void this.finishInlineRename(ent.path, input.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            this.inlineRenamePath = null;
            this.render();
          }
        });
        input.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (this.inlineRenamePath !== ent.path) return;
            if (document.activeElement === input) return;
            this.inlineRenamePath = null;
            this.render();
          }, 120);
        });
        nameWrap.appendChild(input);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } else {
        const label = document.createElement("span");
        label.className = "file-tree-label file-tree-label--dir";
        label.textContent = ent.name;
        label.title = ent.path;
        nameWrap.appendChild(label);
      }
      row.appendChild(nameWrap);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "file-tree-chevron file-tree-chevron--spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);

      const iconKey = getIconForEntry(ent);
      const iconSpan = createIconElement(iconKey);
      iconSpan.classList.add("file-tree-icon--file");
      row.appendChild(iconSpan);

      const nameWrap = document.createElement("div");
      nameWrap.className = "file-tree-name-wrap";

      if (this.inlineRenamePath === ent.path) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "file-tree-inline-input";
        input.value = basename(ent.path);
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void this.finishInlineRename(ent.path, input.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            this.inlineRenamePath = null;
            this.render();
          }
        });
        input.addEventListener("blur", () => {
          window.setTimeout(() => {
            if (this.inlineRenamePath !== ent.path) return;
            if (document.activeElement === input) return;
            this.inlineRenamePath = null;
            this.render();
          }, 120);
        });
        nameWrap.appendChild(input);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } else {
        const label = document.createElement("span");
        label.className = "file-tree-label file-tree-label--file";
        const searchMeta = this.contentSearchMetaByPath.get(normalizeFsPathKey(ent.path));
        label.textContent = searchMeta?.label ?? ent.name;
        label.title = ent.path;
        nameWrap.appendChild(label);
        if (searchMeta) {
          const badge = document.createElement("span");
          badge.className = "file-tree-search-match-badge";
          badge.textContent = String(searchMeta.matches);
          badge.title = `${searchMeta.matches} string match${searchMeta.matches === 1 ? "" : "es"}`;
          nameWrap.appendChild(badge);
        }
      }
      row.appendChild(nameWrap);
    }

    this.applyGitDecorationToRow(row, ent);

    li.appendChild(row);
    li.dataset.path = ent.path;

    return li;
  }
}
