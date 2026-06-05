import { invoke } from "@tauri-apps/api/core";

import type { TermiePrefs } from "./settingsPanel";
import { loadCustomThemesIntoCache, pickUiPrefs, THEME_OPTIONS, type UiThemePrefs } from "./uiTheme";

const POS_KEY = "termie.themeModal.pos";

type Persisted = { prefs: Record<string, unknown> };

export type ThemeModalApi = {
  open(): void;
  close(): void;
  isOpen(): boolean;
};

export function createThemeModal(
  root: HTMLElement,
  onPreview: (prefs: UiThemePrefs) => void,
): ThemeModalApi {
  let open = false;
  let initial: UiThemePrefs | null = null;
  let fontBase = { font_terminal: "", font_ui: "", font_file_tree: "" };
  let selectedFlat = 0;
  const builtinFlat: { themeId: string; variantId: string; label: string }[] = [];
  for (const t of THEME_OPTIONS) {
    for (const v of t.variants) {
      builtinFlat.push({
        themeId: t.id,
        variantId: v.id,
        label: `${t.label} — ${v.label}`,
      });
    }
  }
  let flat: { themeId: string; variantId: string; label: string }[] = [...builtinFlat];

  function rebuildListDom(): void {
    list.replaceChildren();
    for (let i = 0; i < flat.length; i++) {
      const row = flat[i]!;
      const li = document.createElement("li");
      li.className = "theme-modal-item";
      li.dataset.index = String(i);
      li.textContent = row.label;
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
    await loadCustomThemesIntoCache();
    let names: string[] = [];
    try {
      names = await invoke<string[]>("list_custom_theme_names");
    } catch {
      names = [];
    }
    flat = [...builtinFlat];
    for (const name of names) {
      flat.push({
        themeId: `custom:${name}`,
        variantId: "default",
        label: `Custom — ${name}`,
      });
    }
    rebuildListDom();
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
  const title = document.createElement("h2");
  title.className = "theme-modal-title";
  title.textContent = "Themes";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "theme-modal-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  head.appendChild(title);
  head.appendChild(closeBtn);

  const hint = document.createElement("p");
  hint.className = "theme-modal-hint";
  hint.textContent = "↑↓ preview · Enter save · Esc";

  const list = document.createElement("ul");
  list.className = "theme-modal-list termie-scroll-fade";

  rebuildListDom();

  panel.appendChild(head);
  panel.appendChild(hint);
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
    const idx = flat.findIndex(
      (r) => r.themeId === p.ui_theme && r.variantId === p.ui_theme_variant,
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
      font_file_tree: fontBase.font_file_tree,
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
    try {
      const data = await invoke<Persisted>("get_persisted_state");
      const prev = data.prefs as TermiePrefs;
      const next: TermiePrefs = {
        ...prev,
        ui_theme: row.themeId,
        ui_theme_variant: row.variantId,
      };
      await invoke("set_prefs", { prefs: next });
      initial = null;
      onPreview({
        ui_theme: row.themeId,
        ui_theme_variant: row.variantId,
        font_terminal: fontBase.font_terminal,
        font_ui: fontBase.font_ui,
        font_file_tree: fontBase.font_file_tree,
      });
      close();
    } catch (e) {
      console.error("theme commit", e);
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!open) return;
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

  function close(): void {
    if (!open) return;
    open = false;
    root.classList.add("theme-modal--hidden");
    root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("theme-modal-open");
    window.removeEventListener("keydown", onKey, true);
    if (initial) {
      onPreview(initial);
    }
    initial = null;
  }

  return {
    open: () => {
      if (open) return;
      open = true;
      window.addEventListener("keydown", onKey, true);
      void (async () => {
        try {
          const data = await invoke<Persisted>("get_persisted_state");
          initial = pickUiPrefs(data.prefs as Record<string, unknown>);
          fontBase = {
            font_terminal: initial.font_terminal,
            font_ui: initial.font_ui,
            font_file_tree: initial.font_file_tree,
          };
        } catch {
          initial = {
            ui_theme: "system",
            ui_theme_variant: "default",
            font_terminal: "",
            font_ui: "",
            font_file_tree: "",
          };
          fontBase = {
            font_terminal: initial.font_terminal,
            font_ui: initial.font_ui,
            font_file_tree: initial.font_file_tree,
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
        panel.focus();
      })();
    },
    close,
    isOpen: () => open,
  };
}
