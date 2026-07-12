import { invoke } from "@tauri-apps/api/core";

import { mouseCursorForceVisible } from "./mouseCursor";
import type { ParttyPrefs } from "./settingsPanel";
import {
  applyUiTheme,
  collectCurrentThemeCssVars,
  reloadCustomThemesIntoCache,
  pickUiPrefs,
  previewThemeCssVars,
  registerCustomThemeInCache,
  THEME_EXPORT_CSS_KEYS,
  type ThemeCssVars,
  type UiThemePrefs,
} from "./uiTheme";

export type ThemeBuilderApi = {
  open(options?: ThemeBuilderOpenOptions): void;
  close(): void;
  isOpen(): boolean;
};

export type ThemeBuilderOpenOptions = {
  initialVars?: ThemeCssVars;
  suggestedName?: string;
};

const LABELS: Record<string, string> = {
  "--term-bg": "Terminal background",
  "--term-fg": "Terminal text",
  "--term-cursor": "Cursor",
  "--term-selection-bg": "Selection",
  "--panel-bg": "Panel background",
  "--panel-border": "Panel border",
  "--input-bg": "Input background",
  "--input-border": "Input border",
  "--accent-primary": "Accent color",
  "--accent-primary-light": "Accent (hover)",
  "--accent-primary-lighter": "Accent (subtle)",
  "--backdrop-darkest": "Overlay backdrop",
  "--ui-gray-900": "Deep surface",
  "--ui-gray-800": "Sidebar / chrome bg",
  "--ui-gray-700": "Modal / panel surface",
  "--ui-gray-400": "Muted text / icons",
  "--ui-gray-300": "Bright chrome text",
  "--pane-divider": "Pane divider",
  "--pane-divider-hover": "Pane divider (hover)",
};

function normalizeHex(raw: string): string | null {
  const t = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const h = t.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return null;
}

export function createThemeBuilderModal(
  root: HTMLElement,
  onApplied: (prefs: UiThemePrefs) => void,
): ThemeBuilderApi {
  let open = false;
  let vars: ThemeCssVars = {};
  let initialPrefs: UiThemePrefs | null = null;

  const backdrop = document.createElement("div");
  backdrop.className = "theme-builder-backdrop";

  const panel = document.createElement("div");
  panel.className = "theme-builder-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Theme builder");

  const head = document.createElement("div");
  head.className = "theme-builder-head";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "theme-builder-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  head.appendChild(closeBtn);

  const nameRow = document.createElement("div");
  nameRow.className = "theme-builder-name-row";
  const nameInput = document.createElement("input");
  nameInput.id = "theme-builder-name";
  nameInput.className = "theme-builder-input";
  nameInput.type = "text";
  nameInput.placeholder = "Theme name";
  nameRow.appendChild(nameInput);

  const scroll = document.createElement("div");
  scroll.className = "theme-builder-scroll";

  const customList = document.createElement("div");
  customList.className = "theme-builder-custom-list";

  const foot = document.createElement("div");
  foot.className = "theme-builder-foot";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "theme-builder-save";
  saveBtn.textContent = "Save theme";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "theme-builder-cancel";
  cancelBtn.textContent = "Cancel";
  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);

  panel.appendChild(head);
  panel.appendChild(nameRow);
  panel.appendChild(scroll);
  panel.appendChild(customList);
  panel.appendChild(foot);
  root.appendChild(backdrop);
  root.appendChild(panel);

  function renderVarRows(): void {
    scroll.replaceChildren();
    for (const key of THEME_EXPORT_CSS_KEYS) {
      const row = document.createElement("div");
      row.className = "theme-builder-row";
      const lab = document.createElement("label");
      lab.className = "theme-builder-row-label";
      lab.textContent = LABELS[key] ?? key;
      const color = document.createElement("input");
      color.type = "color";
      color.className = "theme-builder-color";
      const hexIn = document.createElement("input");
      hexIn.type = "text";
      hexIn.className = "theme-builder-hex";
      hexIn.spellcheck = false;
      const v = vars[key] ?? "#000000";
      const hx = /^#/.test(v) ? v : "#1a1b26";
      color.value = hx.length === 7 ? hx : "#1a1b26";
      hexIn.value = vars[key] ?? color.value;

      const applyKey = (next: string) => {
        vars[key] = next;
        previewThemeCssVars(vars);
      };

      color.addEventListener("input", () => {
        hexIn.value = color.value;
        applyKey(color.value);
      });
      hexIn.addEventListener("change", () => {
        const n = normalizeHex(hexIn.value);
        if (n) {
          color.value = n;
          applyKey(n);
        } else {
          hexIn.value = vars[key] ?? color.value;
        }
      });

      row.appendChild(lab);
      row.appendChild(color);
      row.appendChild(hexIn);
      scroll.appendChild(row);
    }
  }

  async function refreshCustomList(): Promise<void> {
    customList.replaceChildren();
    const h3 = document.createElement("h3");
    h3.className = "theme-builder-custom-title";
    h3.textContent = "Custom themes";
    customList.appendChild(h3);
    let names: string[] = [];
    try {
      names = await invoke<string[]>("list_themes");
    } catch {
      names = [];
    }
    if (names.length === 0) {
      const p = document.createElement("p");
      p.className = "theme-builder-custom-empty";
      p.textContent = "No custom themes yet.";
      customList.appendChild(p);
      return;
    }
    for (const name of names) {
      const row = document.createElement("div");
      row.className = "theme-builder-custom-row";
      const span = document.createElement("span");
      span.textContent = name;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "theme-builder-custom-del";
      del.setAttribute("aria-label", `Delete ${name}`);
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        void (async () => {
          if (!window.confirm(`Remove custom theme “${name}”?`)) return;
          try {
            await invoke("delete_theme", { name });
            await reloadCustomThemesIntoCache();
            await refreshCustomList();
          } catch (e) {
            console.error(e);
          }
        })();
      });
      row.appendChild(span);
      row.appendChild(del);
      customList.appendChild(row);
    }
  }

  function close(): void {
    if (!open) return;
    open = false;
    mouseCursorForceVisible(false);
    root.classList.add("theme-builder-root--hidden");
    root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("theme-builder-open");
    if (initialPrefs) {
      applyUiTheme(initialPrefs);
    }
    initialPrefs = null;
  }

  closeBtn.addEventListener("click", () => close());
  backdrop.addEventListener("click", () => close());
  cancelBtn.addEventListener("click", () => close());
  saveBtn.addEventListener("click", () => {
    void (async () => {
      const slug = nameInput.value.trim().toLowerCase().replace(/\s+/g, "-");
      if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
        window.alert("Enter a valid theme name (letters, numbers, dashes, underscores).");
        return;
      }
      try {
        await invoke("write_theme", {
          name: slug,
          colors: vars,
        });
        registerCustomThemeInCache(slug, vars);
        await reloadCustomThemesIntoCache();
        const data = await invoke<{ prefs: Record<string, unknown> }>("get_persisted_state");
        const prev = data.prefs as ParttyPrefs;
        const nextPrefs: ParttyPrefs = {
          ...prev,
          ui_theme: `custom:${slug}`,
          ui_theme_variant: "default",
        };
        await invoke("set_prefs", { prefs: nextPrefs });
        const ui = pickUiPrefs(nextPrefs as unknown as Record<string, unknown>);
        onApplied(ui);
        close();
      } catch (e) {
        console.error("save theme", e);
        window.alert("Could not save theme.");
      }
    })();
  });

  return {
    open: (options?: ThemeBuilderOpenOptions) => {
      if (open) return;
      open = true;
      mouseCursorForceVisible(true);
      void (async () => {
        try {
          const data = await invoke<{ prefs: Record<string, unknown> }>("get_persisted_state");
          initialPrefs = pickUiPrefs(data.prefs);
        } catch {
          initialPrefs = {
            ui_theme: "system",
            ui_theme_variant: "default",
            font_terminal: "",
            font_ui: "",
          };
        }
        vars = options?.initialVars ? { ...options.initialVars } : collectCurrentThemeCssVars();
        nameInput.value = options?.suggestedName ?? "";
        renderVarRows();
        previewThemeCssVars(vars);
        await refreshCustomList();
        root.classList.remove("theme-builder-root--hidden");
        root.setAttribute("aria-hidden", "false");
        document.documentElement.classList.add("theme-builder-open");
      })();
    },
    close,
    isOpen: () => open,
  };
}
