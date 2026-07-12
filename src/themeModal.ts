import { invoke } from "@tauri-apps/api/core";

import { mouseCursorForceVisible } from "./mouseCursor";
import {
  filterAndRankLexical,
  normalizeQuery,
  type LexicalSearchItem,
} from "./lexicalSearch";
import type { ParttyPrefs } from "./settingsPanel";
import { ensureCustomThemesLoaded, normalizePaneThemePrefs, pickUiPrefs, themeCssVarsForPrefs, THEME_OPTIONS, getThemePrefsCache, type ThemeCssVars, type UiThemePrefs } from "./uiTheme";

const POS_KEY = "partty.themeModal.pos";

type Persisted = { prefs: Record<string, unknown> };

export type ThemeModalApi = {
  open(options?: ThemeModalOpenOptions): void;
  close(): void;
  isOpen(): boolean;
};

export type ThemeModalOpenOptions = {
  title?: string;
  initialPrefs?: UiThemePrefs;
  onCommit?: (prefs: UiThemePrefs) => void | Promise<void>;
};

export type ThemeModalCloneRequest = {
  vars: ThemeCssVars;
  suggestedName: string;
};

type FlatThemeRow = LexicalSearchItem & {
  themeId: string;
  variantId: string;
  builtin: boolean;
};

export function createThemeModal(
  root: HTMLElement,
  onPreview: (prefs: UiThemePrefs) => void,
  onCloneTheme?: (request: ThemeModalCloneRequest) => void,
  onClosed?: () => void,
): ThemeModalApi {
  let open = false;
  let initial: UiThemePrefs | null = null;
  let commitOverride: ThemeModalOpenOptions["onCommit"] | null = null;
  let fontBase = { font_terminal: "", font_ui: "" };
  let selectedFlat = 0;
  const builtinFlat: FlatThemeRow[] = [];
  for (const t of THEME_OPTIONS) {
    for (const v of t.variants) {
      builtinFlat.push({
        themeId: t.id,
        variantId: v.id,
        label: `${t.label} — ${v.label}`,
        id: `${t.id} ${v.id}`,
        keywords: `${t.label} ${t.description} ${v.label} ${t.id} ${v.id}`,
        builtin: true,
      });
    }
  }
  let allFlat: FlatThemeRow[] = [...builtinFlat];
  let flat: FlatThemeRow[] = [...builtinFlat];

  function slugForRow(row: FlatThemeRow): string {
    return `${row.themeId}-${row.variantId}`.replace(/^custom:/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  }

  function applyFilter(): void {
    flat = filterAndRankLexical(allFlat, normalizeQuery(searchInput.value));
    selectedFlat = Math.min(selectedFlat, Math.max(0, flat.length - 1));
    rebuildListDom();
    updateSelection();
  }

  function rebuildListDom(): void {
    list.replaceChildren();
    for (let i = 0; i < flat.length; i++) {
      const row = flat[i]!;
      const li = document.createElement("li");
      li.className = "theme-modal-item";
      li.dataset.index = String(i);

      const vars = themeCssVarsForPrefs({ ui_theme: row.themeId, ui_theme_variant: row.variantId });
      const paletteColors = [
        vars["--term-bg"] ?? "",
        vars["--term-fg"] ?? "",
        vars["--accent-primary"] ?? "",
        vars["--term-cursor"] ?? "",
        vars["--term-selection-bg"] ?? "",
      ].filter(Boolean);

      const label = document.createElement("span");
      label.className = "theme-modal-item-label";
      label.textContent = row.label;
      li.appendChild(label);

      if (paletteColors.length > 0) {
        const palette = document.createElement("span");
        palette.className = "theme-modal-palette";
        for (const color of paletteColors) {
          const swatch = document.createElement("span");
          swatch.className = "theme-modal-swatch";
          swatch.style.backgroundColor = color;
          palette.appendChild(swatch);
        }
        li.appendChild(palette);
      }

      if (row.builtin && row.themeId !== "system" && onCloneTheme) {
        const clone = document.createElement("button");
        clone.type = "button";
        clone.className = "theme-modal-clone";
        clone.textContent = "Clone";
        clone.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cvars = themeCssVarsForPrefs({ ui_theme: row.themeId, ui_theme_variant: row.variantId });
          const suggestedName = slugForRow(row);
          close();
          onCloneTheme({ vars: cvars, suggestedName });
        });
        li.appendChild(clone);
      }
      li.addEventListener("mouseenter", () => {
        selectedFlat = i;
        updateSelection();
        previewAt(i);
      });
      li.addEventListener("click", () => {
        void commitAt(i);
      });
      list.appendChild(li);
    }
  }

  async function refreshFlatAndList(): Promise<void> {
    await ensureCustomThemesLoaded();
    let names: string[] = [];
    try {
      names = await invoke<string[]>("list_themes");
    } catch {
      names = [];
    }
    allFlat = [...builtinFlat];
    for (const name of names) {
      allFlat.push({
        themeId: `custom:${name}`,
        variantId: "default",
        label: `Custom — ${name}`,
        id: `custom ${name}`,
        keywords: `custom ${name}`,
        builtin: false,
      });
    }
    applyFilter();
  }

  const backdrop = document.createElement("div");
  backdrop.className = "theme-modal-backdrop";

  const panel = document.createElement("div");
  panel.className = "theme-modal-panel";
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Choose theme");

  const head = document.createElement("div");
  head.className = "theme-modal-head";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "theme-modal-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  head.appendChild(closeBtn);

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "theme-modal-search";
  searchInput.placeholder = "Search themes";
  searchInput.spellcheck = false;

  const list = document.createElement("ul");
  list.className = "theme-modal-list";

  rebuildListDom();

  panel.appendChild(head);
  panel.appendChild(searchInput);
  panel.appendChild(list);

  root.appendChild(backdrop);
  root.appendChild(panel);

  function loadPos(): void {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as { left: number; top: number };
      if (typeof j.left === "number" && typeof j.top === "number") {
        panel.style.left = `${j.left}px`;
        panel.style.top = `${j.top}px`;
        panel.style.transform = "none";
      }
    } catch {
      /* ignore */
    }
  }

  function savePos(): void {
    const r = panel.getBoundingClientRect();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
  }

  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag = { x: e.clientX, y: e.clientY, ox: panel.offsetLeft, oy: panel.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    panel.style.left = `${drag.ox + dx}px`;
    panel.style.top = `${drag.oy + dy}px`;
    panel.style.transform = "none";
  });
  head.addEventListener("pointerup", (e) => {
    if (drag) savePos();
    drag = null;
    head.releasePointerCapture(e.pointerId);
  });

  function indexForPrefs(p: UiThemePrefs): number {
    const n = normalizePaneThemePrefs(p);
    const idx = flat.findIndex(
      (r) => r.themeId === n.ui_theme && r.variantId === n.ui_theme_variant,
    );
    return idx >= 0 ? idx : 0;
  }

  function previewAt(i: number): void {
    const row = flat[i];
    if (!row) return;
    onPreview({
      ui_theme: row.themeId,
      ui_theme_variant: row.variantId,
      font_terminal: fontBase.font_terminal,
      font_ui: fontBase.font_ui,
    });
  }

  function updateSelection(): void {
    list.querySelectorAll(".theme-modal-item").forEach((el, i) => {
      el.classList.toggle("theme-modal-item--active", i === selectedFlat);
    });
    const active = list.children[selectedFlat] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }

  async function commitAt(i: number): Promise<void> {
    const row = flat[i];
    if (!row) return;
    const picked: UiThemePrefs = {
      ui_theme: row.themeId,
      ui_theme_variant: row.variantId,
      font_terminal: fontBase.font_terminal,
      font_ui: fontBase.font_ui,
    };
    try {
      if (commitOverride) {
        await commitOverride(picked);
        initial = null;
        onPreview(picked);
        close();
        return;
      }
      const data = await invoke<Persisted>("get_persisted_state");
      const prev = data.prefs as ParttyPrefs;
      let next: ParttyPrefs = {
        ...prev,
        ui_theme: row.themeId,
        ui_theme_variant: row.variantId,
      };
      if (row.themeId.startsWith("custom:")) {
        const slug = row.themeId.slice(7);
        const tprefs = getThemePrefsCache()[slug];
        if (tprefs) {
          next = { ...next, ...tprefs } as ParttyPrefs;
        }
      }
      await invoke("set_prefs", { prefs: next });
      initial = null;
      onPreview(picked);
      close();
    } catch (e) {
      console.error("theme commit", e);
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!open) return;
    if (e.target === searchInput && e.key !== "Escape" && e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectedFlat = Math.min(flat.length - 1, selectedFlat + 1);
      updateSelection();
      previewAt(selectedFlat);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectedFlat = Math.max(0, selectedFlat - 1);
      updateSelection();
      previewAt(selectedFlat);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      void commitAt(selectedFlat);
      return;
    }
    e.stopImmediatePropagation();
  };

  closeBtn.addEventListener("click", () => close());
  backdrop.addEventListener("click", () => close());
  searchInput.addEventListener("input", () => {
    selectedFlat = 0;
    applyFilter();
    previewAt(selectedFlat);
  });

  function close(): void {
    if (!open) return;
    open = false;
    mouseCursorForceVisible(false);
    root.classList.add("theme-modal--hidden");
    root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("theme-modal-open");
    window.removeEventListener("keydown", onKey, true);
    if (initial) {
      onPreview(initial);
    }
    initial = null;
    commitOverride = null;
    searchInput.value = "";
    onClosed?.();
  }

  return {
    open: (options?: ThemeModalOpenOptions) => {
      if (open) return;
      open = true;
      mouseCursorForceVisible(true);
      commitOverride = options?.onCommit ?? null;
      window.addEventListener("keydown", onKey, true);
      void (async () => {
        try {
          if (options?.initialPrefs) {
            initial = options.initialPrefs;
          } else {
            const data = await invoke<Persisted>("get_persisted_state");
            initial = pickUiPrefs(data.prefs as Record<string, unknown>);
          }
          fontBase = {
            font_terminal: initial.font_terminal,
            font_ui: initial.font_ui,
          };
        } catch {
          initial = {
            ui_theme: "system",
            ui_theme_variant: "default",
            font_terminal: "",
            font_ui: "",
          };
          fontBase = {
            font_terminal: initial.font_terminal,
            font_ui: initial.font_ui,
          };
        }
        if (!open) return;
        await refreshFlatAndList();
        if (!open) return;
        selectedFlat = indexForPrefs(initial);
        updateSelection();
        loadPos();
        root.classList.remove("theme-modal--hidden");
        root.setAttribute("aria-hidden", "false");
        document.documentElement.classList.add("theme-modal-open");
        previewAt(selectedFlat);
        const ae = document.activeElement;
        if (ae instanceof HTMLElement && ae.closest(".xterm")) ae.blur();
        searchInput.focus();
      })();
    },
    close,
    isOpen: () => open,
  };
}
