/**
 * Lightweight command palette: filter + list render batched in rAF, small static command set.
 */

import { mouseCursorForceVisible } from "./mouseCursor";

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
  /**
   * Single-key quick select (profile aliases). Return a command to run, or null.
   */
  onQuickSelectKey?: (
    key: string,
    currentInput: string,
  ) => PaletteCommand | null;
  /** If set, re‑renders the list every N ms while open (for live-updating labels). */
  refreshMs?: number;
};

export type CommandPaletteOpenOptions = {
  query?: string;
  placeholder?: string;
};

function normalizeQuery(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Rank matches so shorter / label-primary hits win hierarchies
 * (e.g. query "theme" → "Theme" before "Pane theme").
 * Returns null when the command does not match.
 */
function scoreCommand(cmd: PaletteCommand, parts: string[]): number | null {
  if (parts.length === 0) return 0;
  const label = cmd.label.toLowerCase();
  const keywords = (cmd.keywords ?? "").toLowerCase();
  const idTokens = tokenize(cmd.id);
  const idHay = idTokens.join(" ");
  const hay = `${label} ${keywords} ${idHay}`;
  if (!parts.every((p) => hay.includes(p))) return null;

  const q = parts.join(" ");
  const labelTokens = tokenize(label);
  let score = 0;

  if (label === q) score += 10_000;
  else if (label.startsWith(q)) score += 5_000;

  const allInLabel = parts.every((p) => label.includes(p));
  if (allInLabel) {
    score += 2_000;
    // Tighter labels rank higher: "Theme" beats "Pane theme" for "theme".
    score += Math.max(0, 400 - labelTokens.length * 80);
    const covered = labelTokens.filter((w) =>
      parts.some((p) => w === p || w.startsWith(p)),
    ).length;
    score += Math.round((covered / Math.max(labelTokens.length, 1)) * 400);
  } else {
    score += 150;
  }

  for (const p of parts) {
    if (labelTokens.some((w) => w === p)) score += 100;
    else if (labelTokens.some((w) => w.startsWith(p))) score += 60;
    else if (label.includes(p)) score += 25;
    else if (idTokens.some((w) => w === p || w.startsWith(p))) score += 15;
    else score += 5;
  }

  score -= Math.min(label.length, 40);
  return score;
}

function filterAndRankCommands(
  all: readonly PaletteCommand[],
  parts: string[],
): PaletteCommand[] {
  if (parts.length === 0) return [...all];
  return all
    .map((cmd) => ({ cmd, score: scoreCommand(cmd, parts) }))
    .filter((row): row is { cmd: PaletteCommand; score: number } => row.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.cmd.label.length - b.cmd.label.length ||
        a.cmd.label.localeCompare(b.cmd.label),
    )
    .map((row) => row.cmd);
}

export function createCommandPalette(mount: CommandPaletteMount): {
  open(opts?: CommandPaletteOpenOptions): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
} {
  const {
    root,
    input,
    list,
    getCommands,
    onBeforeOpen,
    onClosed,
    onTabComplete,
    onQuickSelectKey,
    refreshMs,
  } = mount;
  let open = false;
  let opening = false;
  let selected = 0;
  let filtered: readonly PaletteCommand[] = [];
  let filterRaf = 0;
  let refreshTimer = 0;
  let pendingOpen: CommandPaletteOpenOptions | null = null;
  const defaultPlaceholder = input.placeholder || "Command or > …";

  function applyFilter(): void {
    const parts = normalizeQuery(input.value);
    const all = getCommands();
    filtered = filterAndRankCommands(all, parts);
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

  async function runCommand(cmd: PaletteCommand): Promise<void> {
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

  async function runSelected(): Promise<void> {
    const cmd = filtered[selected];
    if (!cmd) return;
    await runCommand(cmd);
  }

  function openPalette(opts?: CommandPaletteOpenOptions): void {
    if (open || opening) return;
    opening = true;
    pendingOpen = opts ?? null;
    void (async () => {
      try {
        await onBeforeOpen?.();
        if (open) return;
        open = true;
        mouseCursorForceVisible(true);
        root.classList.remove("command-palette--hidden");
        root.setAttribute("aria-hidden", "false");
        const q = pendingOpen?.query ?? "";
        const ph = pendingOpen?.placeholder;
        pendingOpen = null;
        input.value = q;
        input.placeholder = ph?.trim() ? ph : defaultPlaceholder;
        selected = 0;
        applyFilter();
        if (refreshMs) {
          refreshTimer = window.setInterval(() => applyFilter(), refreshMs);
        }
        requestAnimationFrame(() => {
          input.focus();
          const len = input.value.length;
          input.setSelectionRange(len, len);
        });
      } finally {
        opening = false;
      }
    })();
  }

  function closePalette(skipFocus = false): void {
    if (!open) return;
    open = false;
    mouseCursorForceVisible(false);
    root.classList.add("command-palette--hidden");
    root.setAttribute("aria-hidden", "true");
    list.replaceChildren();
    input.placeholder = defaultPlaceholder;
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
      if (next !== null) {
        if (next !== input.value) input.value = next;
        selected = 0;
        scheduleFilter();
      }
      return;
    }
    if (
      onQuickSelectKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.length === 1 &&
      !e.isComposing
    ) {
      const cmd = onQuickSelectKey(e.key, input.value);
      if (cmd) {
        e.preventDefault();
        e.stopPropagation();
        void runCommand(cmd);
      }
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
      if (refreshTimer) window.clearInterval(refreshTimer);
      closePalette(true);
    },
  };
}
