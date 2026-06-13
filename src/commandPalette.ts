/**
 * Lightweight command palette: filter + list render batched in rAF, small static command set.
 */

export type PaletteCommand = {
  id: string;
  label: string;
  /** Extra searchable text (not shown), space-separated keywords ok */
  keywords?: string;
  /** Shown dimmed on the right when set (e.g. Ctrl+Shift+E) */
  hotkey?: string;
  /** Rich HTML label (optional). When set, innerHTML is used instead of textContent. */
  labelHtml?: string;
  run: () => void | Promise<void>;
  remove?: () => void | Promise<void>;
  removeLabel?: string;
};

export type CommandPaletteMount = {
  root: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  getCommands: () => readonly PaletteCommand[];
  /** Load persisted / refresh before showing (e.g. custom commands). */
  onBeforeOpen?: () => Promise<void>;
  /** Called after close (success or cancel) so host can refocus terminal */
  onClosed?: () => void;
  /** If set, Tab triggers pane-name autocomplete for @pane: syntax.
   *  Receives the current input value and the currently selected command;
   *  returns the new input value or null to do nothing. */
  onTabComplete?: (currentInput: string, selectedCommand: PaletteCommand | null) => string | null;
  /** If set, re‑renders the list every N ms while open (for live-updating labels). */
  refreshMs?: number;
};

function normalizeQuery(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesFilter(cmd: PaletteCommand, parts: string[]): boolean {
  if (parts.length === 0) return true;
  const hay = `${cmd.label} ${cmd.keywords ?? ""}`.toLowerCase();
  return parts.every((p) => hay.includes(p));
}

export function createCommandPalette(mount: CommandPaletteMount): {
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
} {
  const { root, input, list, getCommands, onBeforeOpen, onClosed, onTabComplete, refreshMs } = mount;
  let open = false;
  let opening = false;
  let selected = 0;
  let filtered: readonly PaletteCommand[] = [];
  let filterRaf = 0;
  let refreshTimer = 0;

  function applyFilter(): void {
    const parts = normalizeQuery(input.value);
    const all = getCommands();
    filtered = parts.length === 0 ? all : all.filter((c) => matchesFilter(c, parts));
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    renderList();
  }

  function scheduleFilter(): void {
    if (filterRaf) cancelAnimationFrame(filterRaf);
    filterRaf = requestAnimationFrame(() => {
      filterRaf = 0;
      applyFilter();
    });
  }

  function renderList(): void {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < filtered.length; i++) {
      const cmd = filtered[i]!;
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `palette-opt-${cmd.id}`;
      li.className = "command-palette-item";
      if (i === selected) li.classList.add("command-palette-item--active");
      li.dataset.index = String(i);
      const row = document.createElement("div");
      row.className = "command-palette-item-row";
      const lab = document.createElement("span");
      lab.className = "command-palette-item-label";
      if (cmd.labelHtml) {
        lab.innerHTML = cmd.labelHtml;
      } else {
        lab.textContent = cmd.label;
      }
      row.appendChild(lab);
      if (cmd.remove) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "command-palette-item-remove";
        del.title = cmd.removeLabel ?? "Remove command";
        del.setAttribute("aria-label", cmd.removeLabel ?? "Remove command");
        del.textContent = "Remove";
        del.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void Promise.resolve(cmd.remove?.()).then(() => {
            applyFilter();
          });
        });
        row.appendChild(del);
      }
      if (cmd.hotkey?.trim()) {
        const hk = document.createElement("kbd");
        hk.className = "command-palette-item-hk";
        hk.textContent = cmd.hotkey.trim();
        row.appendChild(hk);
      }
      li.appendChild(row);
      frag.appendChild(li);
    }
    list.replaceChildren(frag);
    const cur = filtered[selected];
    if (cur) list.setAttribute("aria-activedescendant", `palette-opt-${cur.id}`);
    else list.removeAttribute("aria-activedescendant");
  }

  function updateSelectionClassesOnly(): void {
    const items = list.querySelectorAll(".command-palette-item");
    items.forEach((el, i) => {
      el.classList.toggle("command-palette-item--active", i === selected);
    });
    const cur = filtered[selected];
    if (cur) list.setAttribute("aria-activedescendant", `palette-opt-${cur.id}`);
    else list.removeAttribute("aria-activedescendant");
  }

  function scrollSelectedIntoView(): void {
    const el = list.querySelector(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  async function runSelected(): Promise<void> {
    const cmd = filtered[selected];
    if (!cmd) return;
    // Keep palette shell open; host switches to builder UI.
    if (cmd.id === "new-custom") {
      await Promise.resolve(cmd.run());
      return;
    }
    closePalette(true);
    try {
      await Promise.resolve(cmd.run());
    } finally {
      onClosed?.();
    }
  }

  function openPalette(): void {
    if (open || opening) return;
    opening = true;
    void (async () => {
      try {
        await onBeforeOpen?.();
        if (open) return;
        open = true;
        root.classList.remove("command-palette--hidden");
        root.setAttribute("aria-hidden", "false");
        input.value = "";
        selected = 0;
        applyFilter();
        if (refreshMs) {
          refreshTimer = window.setInterval(() => applyFilter(), refreshMs);
        }
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } finally {
        opening = false;
      }
    })();
  }

  function closePalette(skipFocus = false): void {
    if (!open) return;
    open = false;
    root.classList.add("command-palette--hidden");
    root.setAttribute("aria-hidden", "true");
    list.replaceChildren();
    if (refreshTimer) { window.clearInterval(refreshTimer); refreshTimer = 0; }
    if (!skipFocus) onClosed?.();
  }

  function onInput(): void {
    selected = 0;
    scheduleFilter();
  }

  function onRootPointerDown(e: PointerEvent): void {
    if (e.target === root) closePalette(false);
  }

  function onListClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest("[data-index]");
    if (!t) return;
    const idx = Number((t as HTMLElement).dataset.index);
    if (Number.isFinite(idx) && idx >= 0 && idx < filtered.length) {
      selected = idx;
      void runSelected();
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePalette(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (filtered.length) selected = (selected + 1) % filtered.length;
      updateSelectionClassesOnly();
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (filtered.length) selected = (selected - 1 + filtered.length) % filtered.length;
      updateSelectionClassesOnly();
      scrollSelectedIntoView();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void runSelected();
      return;
    }
    if (e.key === "Tab" && onTabComplete) {
      e.preventDefault();
      e.stopPropagation();
      const sel = filtered[selected] ?? null;
      const next = onTabComplete(input.value, sel);
      if (next !== null && next !== input.value) {
        input.value = next;
        selected = 0;
        scheduleFilter();
      }
      return;
    }
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", onRootPointerDown);
  list.addEventListener("click", onListClick);

  return {
    open: openPalette,
    close: closePalette,
    isOpen: () => open,
    dispose: () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("pointerdown", onRootPointerDown);
      list.removeEventListener("click", onListClick);
      if (filterRaf) cancelAnimationFrame(filterRaf);
      if (refreshTimer) { window.clearInterval(refreshTimer); refreshTimer = 0; }
    },
  };
}

export function isCommandPaletteChord(e: KeyboardEvent): boolean {
  return (
    e.type === "keydown" &&
    e.ctrlKey &&
    e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.key === "p" || e.key === "P")
  );
}

/** Ctrl+Shift+/ (physical) — same chord as Ctrl+? when / requires Shift. */
export function isHelpHotkeysChord(e: KeyboardEvent): boolean {
  if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return false;
  return e.key === "?" || (e.code === "Slash" && e.shiftKey);
}
