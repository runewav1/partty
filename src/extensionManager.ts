import { invoke } from "@tauri-apps/api/core";

import { mouseCursorForceVisible } from "./mouseCursor";

export type ExtensionMeta = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
};

export type ExtensionManagerApi = {
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
};

export function createExtensionManager(el: HTMLElement): ExtensionManagerApi {
  let open = false;
  const list = el.querySelector(".extension-manager-list") as HTMLElement | null;

  async function loadExtensions(): Promise<ExtensionMeta[]> {
    try {
      return await invoke<ExtensionMeta[]>("list_extensions");
    } catch {
      return [];
    }
  }

  async function render(): Promise<void> {
    if (!list) return;
    const exts = await loadExtensions();
    if (exts.length === 0) {
      list.innerHTML = `<div class="extension-manager-empty">No extensions installed.<br><small>Place folders in %LOCALAPPDATA%\\partty\\extensions\\</small></div>`;
      return;
    }
    list.innerHTML = exts.map((ext) => `
      <div class="extension-manager-item">
        <div class="extension-manager-item-info">
          <span class="extension-manager-item-name">${esc(ext.name)}</span>
          <span class="extension-manager-item-version">v${esc(ext.version)}</span>
          ${ext.description ? `<span class="extension-manager-item-desc">${esc(ext.description)}</span>` : ""}
        </div>
        <label class="settings-checkbox-label" style="flex-shrink:0;min-height:0;padding:0;gap:0">
          <input class="settings-checkbox-input" type="checkbox" data-ext-id="${esc(ext.id)}" ${ext.enabled ? "checked" : ""}>
        </label>
      </div>
    `).join("");

    list.querySelectorAll<HTMLInputElement>(".settings-checkbox-input[data-ext-id]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.extId!;
        const enabled = input.checked;
        await invoke("set_extension_enabled", { id, enabled }).catch(() => {});
        setTimeout(() => render(), 100);
      });
    });
  }

  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const closeImpl = () => {
    open = false;
    mouseCursorForceVisible(false);
    el.classList.add("extension-manager--hidden");
    el.setAttribute("aria-hidden", "true");
  };

  el.querySelector(".extension-manager-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeImpl();
  });

  return {
    open: async () => {
      if (open) return;
      open = true;
      mouseCursorForceVisible(true);
      el.classList.remove("extension-manager--hidden");
      el.setAttribute("aria-hidden", "false");
      await render();
    },
    close: closeImpl,
    isOpen: () => open,
    dispose: () => {},
  };
}
