import {
  deleteWorkspace,
  listWorkspaceNames,
  readWorkspace,
  type Workspace,
} from "./workspaces";
import { mouseCursorForceVisible } from "./mouseCursor";
import { pushOverlay, type OverlayHandle } from "./overlayStack";
import { filterAndRankLexical, normalizeQuery } from "./lexicalSearch";
import type { WorkspaceLoadTarget } from "./workspaceEditorModal";

export type WorkspacesModalApi = {
  open(): void;
  close(): void;
  isOpen(): boolean;
};

export type WorkspacesModalOptions = {
  root: HTMLElement;
  onSave: (name: string) => Promise<string | null>;
  onLoad: (workspace: Workspace, target: WorkspaceLoadTarget) => Promise<void>;
  onEdit: (workspace: Workspace) => void;
  onCapture: () => void;
};

export function createWorkspacesModal(opts: WorkspacesModalOptions): WorkspacesModalApi {
  const { root, onSave, onLoad, onEdit, onCapture } = opts;
  let open = false;
  let overlay: OverlayHandle | null = null;
  let selected = 0;
  let names: string[] = [];
  let filteredNames: string[] = [];

  root.className = "theme-modal workspaces-modal theme-modal--hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "theme-modal-backdrop";

  const panel = document.createElement("div");
  panel.className = "theme-modal-panel workspaces-modal-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Workspaces");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "theme-builder-close workspaces-modal-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "theme-modal-search";
  searchInput.placeholder = "Search, name to save, or edit current\u2026";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;

  const captureBtn = document.createElement("button");
  captureBtn.type = "button";
  captureBtn.className = "theme-modal-clone workspaces-capture-btn";
  captureBtn.textContent = "Edit current tab";

  const list = document.createElement("ul");
  list.className = "theme-modal-list workspaces-modal-list";
  list.setAttribute("role", "listbox");

  panel.append(closeBtn, searchInput, captureBtn, list);
  root.append(backdrop, panel);

  function applyFilter(): void {
    const ranked = filterAndRankLexical(
      names.map((name) => ({ label: name, id: name, keywords: name })),
      normalizeQuery(searchInput.value),
    );
    filteredNames = ranked.map((r) => r.label);
    selected = Math.min(selected, Math.max(0, filteredNames.length - 1));
    renderList();
  }

  function renderList(): void {
    list.replaceChildren();
    if (filteredNames.length === 0 && !searchInput.value.trim()) {
      const li = document.createElement("li");
      li.className = "theme-modal-item";
      li.style.opacity = "0.45";
      li.style.cursor = "default";
      li.style.pointerEvents = "none";
      li.textContent = "No workspaces saved";
      list.appendChild(li);
      return;
    }
    for (let i = 0; i < filteredNames.length; i++) {
      const name = filteredNames[i]!;
      const li = document.createElement("li");
      li.className = "theme-modal-item";
      li.dataset.index = String(i);
      if (i === selected) li.classList.add("theme-modal-item--active");

      const label = document.createElement("span");
      label.className = "theme-modal-item-label";
      label.textContent = name;
      li.appendChild(label);

      const actions = document.createElement("span");
      actions.className = "workspaces-item-actions";

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "theme-modal-clone";
      loadBtn.textContent = "Tab";
      loadBtn.title = "Apply to current tab";
      loadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void loadNamed(name, "current");
      });

      const newTabBtn = document.createElement("button");
      newTabBtn.type = "button";
      newTabBtn.className = "theme-modal-clone";
      newTabBtn.textContent = "New";
      newTabBtn.title = "Open in new tab";
      newTabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void loadNamed(name, "new");
      });

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "theme-modal-clone";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const workspace = await readWorkspace(name);
          close();
          onEdit(workspace);
        } catch (err) {
          console.error("edit workspace", err);
        }
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "theme-modal-clone";
      delBtn.textContent = "Del";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await deleteWorkspace(name);
          await refreshNames();
        } catch (err) {
          console.error("delete workspace", err);
        }
      });

      actions.append(loadBtn, newTabBtn, editBtn, delBtn);
      li.appendChild(actions);

      li.addEventListener("mouseenter", () => {
        selected = i;
        updateSelectionClasses();
      });
      li.addEventListener("click", () => void loadNamed(name, "current"));
      list.appendChild(li);
    }
  }

  async function loadNamed(name: string, target: WorkspaceLoadTarget): Promise<void> {
    try {
      const workspace = await readWorkspace(name);
      close();
      await onLoad(workspace, target);
    } catch (e) {
      console.error("load workspace", e);
    }
  }

  function updateSelectionClasses(): void {
    list.querySelectorAll(".theme-modal-item").forEach((el, i) => {
      el.classList.toggle("theme-modal-item--active", i === selected);
    });
  }

  async function refreshNames(): Promise<void> {
    try {
      names = await listWorkspaceNames();
    } catch {
      names = [];
    }
    applyFilter();
  }

  captureBtn.addEventListener("click", () => {
    close();
    onCapture();
  });

  searchInput.addEventListener("input", () => {
    selected = 0;
    applyFilter();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = filteredNames[selected];
      if (name) {
        void loadNamed(name, e.shiftKey ? "new" : "current");
        return;
      }
      const saveName = searchInput.value.trim();
      if (saveName) {
        void onSave(saveName).then((result) => {
          if (result) {
            searchInput.value = "";
            void refreshNames();
          }
        });
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, Math.max(0, filteredNames.length - 1));
      updateSelectionClasses();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      updateSelectionClasses();
      return;
    }
    // Escape is handled by the shared overlay stack.
  });

  closeBtn.addEventListener("click", () => close());
  backdrop.addEventListener("click", () => close());

  function show(): void {
    open = true;
    overlay = pushOverlay(close);
    root.classList.remove("theme-modal--hidden");
    root.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("theme-modal-open");
    mouseCursorForceVisible(true);
    void refreshNames().then(() => {
      searchInput.value = "";
      selected = 0;
      applyFilter();
      searchInput.focus();
    });
  }

  function close(): void {
    if (!open) return;
    open = false;
    overlay?.release();
    overlay = null;
    root.classList.add("theme-modal--hidden");
    root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("theme-modal-open");
    mouseCursorForceVisible(false);
  }

  return {
    open: show,
    close,
    isOpen: () => open,
  };
}
