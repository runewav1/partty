import { listPresetNames, readPresetJson, deletePresetJson, type Preset } from "./presets";
import { mouseCursorForceVisible } from "./mouseCursor";
import { filterAndRankLexical, normalizeQuery } from "./lexicalSearch";

export type PresetsModalApi = {
  open(): void;
  close(): void;
  isOpen(): boolean;
};

export type PresetsModalOptions = {
  root: HTMLElement;
  onSave: (name: string) => Promise<string | null>;
  onLoad: (preset: Preset) => Promise<void>;
  onEdit: (preset: Preset) => void;
};

export function createPresetsModal(opts: PresetsModalOptions): PresetsModalApi {
  const { root, onSave, onLoad, onEdit } = opts;
  let open = false;
  let selected = 0;
  let names: string[] = [];
  let filteredNames: string[] = [];

  root.className = "theme-modal theme-modal--hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "theme-modal-backdrop";

  const panel = document.createElement("div");
  panel.className = "theme-modal-panel";
  panel.style.maxHeight = "min(72vh, 460px)";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Workspace presets");

  const head = document.createElement("div");
  head.className = "theme-modal-head";
  const heading = document.createElement("h2");
  heading.className = "theme-modal-title";
  heading.textContent = "Presets";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "theme-builder-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";
  head.appendChild(heading);
  head.appendChild(closeBtn);

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "theme-modal-search";
  searchInput.placeholder = "Search or name to save\u2026";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;

  const list = document.createElement("ul");
  list.className = "theme-modal-list";
  list.setAttribute("role", "listbox");

  panel.appendChild(head);
  panel.appendChild(searchInput);
  panel.appendChild(list);
  root.appendChild(backdrop);
  root.appendChild(panel);

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
      li.textContent = "No presets saved";
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
      actions.className = "presets-item-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "theme-modal-clone";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const raw = await readPresetJson(name);
          onEdit(JSON.parse(raw) as Preset);
        } catch (err) { console.error("edit preset", err); }
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "theme-modal-clone";
      delBtn.textContent = "Del";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await deletePresetJson(name); await refreshNames(); }
        catch (err) { console.error("delete preset", err); }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);

      li.addEventListener("mouseenter", () => { selected = i; updateSelectionClasses(); });
      li.addEventListener("click", async () => {
        try {
          const raw = await readPresetJson(name);
          const preset = JSON.parse(raw) as Preset;
          close();
          await onLoad(preset);
        } catch (e) { console.error("load preset", e); }
      });
      list.appendChild(li);
    }
  }

  function updateSelectionClasses(): void {
    list.querySelectorAll(".theme-modal-item").forEach((el, i) => {
      el.classList.toggle("theme-modal-item--active", i === selected);
    });
  }

  function scrollSelectedIntoView(): void {
    const el = list.querySelector(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  async function refreshNames(): Promise<void> {
    try { names = await listPresetNames(); }
    catch { names = []; }
    applyFilter();
  }

  searchInput.addEventListener("input", () => { selected = 0; applyFilter(); });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const name = filteredNames[selected];
      if (name) {
        void (async () => {
          try {
            const raw = await readPresetJson(name);
            const preset = JSON.parse(raw) as Preset;
            close();
            await onLoad(preset);
          } catch (err) { console.error("load preset", err); }
        })();
        return;
      }
      // No match — treat as save
      const saveName = searchInput.value.trim();
      if (saveName) {
        void onSave(saveName).then((result) => {
          if (result) { searchInput.value = ""; void refreshNames(); }
        });
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredNames.length) selected = (selected + 1) % filteredNames.length;
      updateSelectionClasses();
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredNames.length) selected = (selected - 1 + filteredNames.length) % filteredNames.length;
      updateSelectionClasses();
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "Escape") { close(); }
  });

  backdrop.addEventListener("click", () => close());
  closeBtn.addEventListener("click", () => close());
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function close(): void {
    if (!open) return;
    open = false;
    mouseCursorForceVisible(false);
    root.classList.add("theme-modal--hidden");
    root.setAttribute("aria-hidden", "true");
  }

  return {
    open: () => {
      if (open) return;
      open = true;
      mouseCursorForceVisible(true);
      selected = 0;
      root.classList.remove("theme-modal--hidden");
      root.setAttribute("aria-hidden", "false");
      void refreshNames();
      requestAnimationFrame(() => { searchInput.value = ""; searchInput.focus(); });
    },
    close,
    isOpen: () => open,
  };
}
