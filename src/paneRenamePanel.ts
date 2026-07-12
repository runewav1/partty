import { mouseCursorForceVisible } from "./mouseCursor";
import { pushOverlay, type OverlayHandle } from "./overlayStack";
import { attachDraggablePanel } from "./draggablePanel";

const POS_KEY = "partty.paneRename.pos";

export type PaneRenamePanelApi = {
  open(paneId: string, currentName?: string): void;
  setPane(paneId: string, currentName?: string): void;
  close(): void;
  isOpen(): boolean;
};

export function createPaneRenamePanel(opts: {
  root: HTMLElement;
  onCommit: (paneId: string, name: string) => void;
}): PaneRenamePanelApi {
  const { root, onCommit } = opts;
  let open = false;
  let overlay: OverlayHandle | null = null;
  let activePaneId = "";

  root.className = "pane-rename pane-rename--hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <section class="pane-rename-panel" role="dialog" aria-label="Rename pane">
      <form class="pane-rename-form">
        <input class="pane-rename-input" type="text" spellcheck="false" autocomplete="off" placeholder="Pane name" />
        <button class="pane-rename-save" type="submit">Save</button>
      </form>
    </section>
  `;
  const panel = root.querySelector(".pane-rename-panel") as HTMLElement;
  const input = root.querySelector(".pane-rename-input") as HTMLInputElement;
  const form = root.querySelector(".pane-rename-form") as HTMLFormElement;

  attachDraggablePanel(panel, form, POS_KEY);

  function positionForFirstOpen(): void {
    if (panel.style.left && panel.style.top) return;
    const w = 300;
    const h = 52;
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
    panel.style.left = `${Math.max(12, (window.innerWidth - w) / 2)}px`;
    panel.style.top = `${Math.max(12, (window.innerHeight - h) / 2)}px`;
  }

  function close(): void {
    if (!open) return;
    open = false;
    overlay?.release();
    overlay = null;
    mouseCursorForceVisible(false);
    root.classList.add("pane-rename--hidden");
    root.setAttribute("aria-hidden", "true");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    onCommit(activePaneId, input.value);
    close();
  });

  function setPane(paneId: string, currentName = ""): void {
    activePaneId = paneId;
    input.value = currentName;
    input.placeholder = currentName || paneId || "Pane name";
  }

  return {
    open: (paneId, currentName = "") => {
      setPane(paneId, currentName);
      if (!open) {
        open = true;
        overlay = pushOverlay(close);
      }
      mouseCursorForceVisible(true);
      positionForFirstOpen();
      root.classList.remove("pane-rename--hidden");
      root.setAttribute("aria-hidden", "false");
      input.focus();
      input.select();
    },
    setPane,
    close,
    isOpen: () => open,
  };
}
