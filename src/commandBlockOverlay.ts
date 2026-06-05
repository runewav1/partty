import type { IDecoration, Terminal } from "@xterm/xterm";
import type { ShellIntegrationState, CommandBlock } from "./shellIntegration";

export type CopyHandler = (text: string) => void;
export type RerunHandler = (command: string) => void;
export type SendToBuilderHandler = (command: string) => void;

function extractBufferText(
  term: Terminal,
  startRow: number,
  endRow: number,
): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  const clampStart = Math.max(0, startRow);
  const clampEnd = Math.min(buf.length - 1, endRow);
  for (let i = clampStart; i <= clampEnd; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n");
}

function findBlockEndRow(
  state: ShellIntegrationState,
  block: CommandBlock,
): number | null {
  const idx = state.blocks.indexOf(block);
  if (idx < 0) return null;
  const next = state.blocks[idx + 1];
  if (next?.promptStartMarker?.line != null) return next.promptStartMarker.line - 1;
  if (block.endMarker?.line != null) return block.endMarker.line;
  return null;
}

export function copyCommandFromBlock(
  term: Terminal,
  block: CommandBlock,
): string {
  if (block.commandLine) return block.commandLine;
  const startRow = block.commandStartMarker?.line ?? block.promptStartMarker?.line;
  const endRow = block.executedMarker?.line;
  if (startRow == null || endRow == null) return "";
  return extractBufferText(term, startRow, endRow).trim();
}

export function copyOutputFromBlock(
  term: Terminal,
  block: CommandBlock,
  state: ShellIntegrationState,
): string {
  const startRow = block.executedMarker?.line;
  if (startRow == null) return "";
  const endRow = findBlockEndRow(state, block);
  if (endRow == null) {
    const cursorRow = term.buffer.active.cursorY + term.buffer.active.baseY;
    return extractBufferText(term, startRow, cursorRow).trim();
  }
  return extractBufferText(term, startRow, endRow).trim();
}

export function copyAllFromBlock(
  term: Terminal,
  block: CommandBlock,
  state: ShellIntegrationState,
): string {
  const startRow = block.promptStartMarker?.line ?? block.commandStartMarker?.line;
  if (startRow == null) return "";
  const endRow = findBlockEndRow(state, block);
  if (endRow == null) {
    const cursorRow = term.buffer.active.cursorY + term.buffer.active.baseY;
    return extractBufferText(term, startRow, cursorRow).trim();
  }
  return extractBufferText(term, startRow, endRow).trim();
}

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export type BlockOverlayHandle = {
  refresh(): void;
  dispose(): void;
};

export function createBlockOverlay(
  term: Terminal,
  state: ShellIntegrationState,
  paneId: string,
  onCopy: CopyHandler,
  onRerun?: RerunHandler,
  onSendToBuilder?: SendToBuilderHandler,
): BlockOverlayHandle {
  let disposed = false;
  let activeCtx: HTMLElement | null = null;
  const decorations = new Map<number, { block: CommandBlock; decoration: IDecoration; cleanup: (() => void)[] }>();

  function closeCtx(): void {
    activeCtx?.remove();
    activeCtx = null;
  }

  const closeCtxOnClick = (e: MouseEvent): void => {
    if (activeCtx && !activeCtx.contains(e.target as Node)) closeCtx();
  };

  function disposeDecoration(id: number): void {
    const existing = decorations.get(id);
    if (!existing) return;
    for (const fn of existing.cleanup) fn();
    existing.decoration.dispose();
    decorations.delete(id);
  }

  function setTooltipPosition(anchor: HTMLElement, tooltip: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(8, rect.top - 6);
    const left = Math.min(window.innerWidth - 330, rect.right + 10);
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${Math.max(8, left)}px`;
  }

  function showCtxMenu(e: MouseEvent, block: CommandBlock): void {
    e.preventDefault();
    e.stopPropagation();
    closeCtx();

    const menu = document.createElement("div");
    menu.className = "cmd-block-ctx";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const items: { label: string; action: () => void }[] = [];

    const cmdText = copyCommandFromBlock(term, block);
    if (cmdText) {
      items.push({ label: "Copy Command", action: () => onCopy(cmdText) });
    }

    if (block.executedMarker?.line != null) {
      const outText = copyOutputFromBlock(term, block, state);
      if (outText) {
        items.push({ label: "Copy Output", action: () => onCopy(outText) });
      }
    }

    const allText = copyAllFromBlock(term, block, state);
    if (allText) {
      items.push({ label: "Copy Command + Output", action: () => onCopy(allText) });
    }

    if (cmdText && onRerun) {
      items.push({ label: "Rerun", action: () => onRerun(cmdText) });
    }

    if (cmdText && onSendToBuilder) {
      items.push({ label: "Send to Command Builder", action: () => onSendToBuilder(cmdText) });
    }

    for (let i = 0; i < items.length; i++) {
      if (i > 0 && items[i].label === "Rerun") {
        const sep = document.createElement("div");
        sep.className = "cmd-block-ctx-separator";
        menu.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cmd-block-ctx-item";
      btn.textContent = items[i].label;
      btn.addEventListener("click", () => {
        items[i].action();
        closeCtx();
      });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    activeCtx = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 4}px`;
    }

    requestAnimationFrame(() => {
      document.addEventListener("click", closeCtxOnClick, { once: true });
    });
  }

  return {
    refresh(): void {
      if (disposed) return;
      closeCtx();

      const liveIds = new Set<number>();
      for (const block of state.blocks) {
        if (!block.commandStartMarker) continue;
        liveIds.add(block.id);
        if (decorations.has(block.id)) continue;
        const decoration = term.registerDecoration({
          marker: block.commandStartMarker,
          x: 0,
          width: 1,
          height: 1,
        });
        if (!decoration) continue;

        const entry = { block, decoration, cleanup: [] as (() => void)[] };
        decorations.set(block.id, entry);

        decoration.onRender((element) => {
          element.className = "xterm-decoration termie-cmd-decoration";
          element.classList.toggle("termie-cmd-decoration--success", block.exitCode === 0);
          element.classList.toggle("termie-cmd-decoration--error", block.exitCode != null && block.exitCode !== 0);
          element.setAttribute("data-pane-id", paneId);
          element.style.pointerEvents = "auto";

          const dot = document.createElement("div");
          dot.className = "termie-cmd-decoration__dot";
          element.replaceChildren(dot);

          const tooltip = document.createElement("div");
          tooltip.className = "cmd-block-tooltip";
          tooltip.hidden = true;
          document.body.appendChild(tooltip);

          const showTooltip = (): void => {
            const now = Date.now();
            const blockTime = block.timestamp ?? now;
            const pieces: string[] = [
              `<span class="cmd-block-tooltip-time">${timeAgo(now - blockTime)}</span>`,
              `<span class="cmd-block-tooltip-time">${formatTime(new Date(blockTime))}</span>`,
            ];
            if (block.commandLine) pieces.push(block.commandLine);
            if (block.exitCode != null) pieces.push(`Exit: ${block.exitCode}`);
            tooltip.innerHTML = pieces.join("<br>");
            tooltip.hidden = false;
            setTooltipPosition(element, tooltip);
          };

          const hideTooltip = (): void => {
            tooltip.hidden = true;
          };

          const stopMouseDown = (e: MouseEvent): void => {
            if (e.button === 2) {
              e.preventDefault();
              e.stopPropagation();
            }
          };

          const onContext = (e: MouseEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            showCtxMenu(e, block);
          };

          element.addEventListener("mouseenter", showTooltip);
          element.addEventListener("mouseleave", hideTooltip);
          element.addEventListener("mousedown", stopMouseDown, true);
          element.addEventListener("contextmenu", onContext, true);
          entry.cleanup.push(() => {
            tooltip.remove();
            element.removeEventListener("mouseenter", showTooltip);
            element.removeEventListener("mouseleave", hideTooltip);
            element.removeEventListener("mousedown", stopMouseDown, true);
            element.removeEventListener("contextmenu", onContext, true);
          });
        });
      }

      for (const id of [...decorations.keys()]) {
        if (!liveIds.has(id)) disposeDecoration(id);
      }
    },
    dispose(): void {
      disposed = true;
      closeCtx();
      document.removeEventListener("click", closeCtxOnClick);
      for (const id of [...decorations.keys()]) disposeDecoration(id);
    },
  };
}
