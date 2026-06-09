import {
  deleteCommandHistory,
  deleteCommandHistoryRecord,
  loadCommandHistory,
  stripAnsi,
  type CommandHistoryRecord,
} from "./commandHistory";

export type TerminalHistoryModalApi = {
  open(paneId: string, label?: string): void;
  setPane(paneId: string, label?: string): void;
  refresh(paneId?: string): void;
  close(): void;
  isOpen(): boolean;
};

type RankedRecord = {
  rec: CommandHistoryRecord;
  score: number;
};

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function exitLabel(code: number | null): string {
  if (code == null) return "running/unknown";
  return code === 0 ? "exit 0" : `exit ${code}`;
}

function searchable(value: string): string {
  return stripAnsi(value).toLowerCase();
}

function rankRecord(rec: CommandHistoryRecord, query: string): number {
  const q = searchable(query.trim());
  if (!q) return 1;
  const terms = q.split(/\s+/).filter(Boolean);
  const cmd = searchable(rec.command);
  const out = searchable(rec.output);
  const cwd = searchable(rec.cwd ?? "");
  let score = 0;
  if (cmd === q) score += 500;
  if (cmd.startsWith(q)) score += 300;
  if (cmd.includes(q)) score += 220;
  if (cwd.includes(q)) score += 40;
  if (out.includes(q)) score += 30;
  for (const term of terms) {
    if (cmd.includes(term)) score += 80;
    else if (cwd.includes(term)) score += 15;
    else if (out.includes(term)) score += 8;
    else return 0;
  }
  return score;
}

function filterAndRank(records: CommandHistoryRecord[], query: string): CommandHistoryRecord[] {
  const ranked: RankedRecord[] = [];
  for (const rec of records) {
    const score = rankRecord(rec, query);
    if (score > 0) ranked.push({ rec, score });
  }
  ranked.sort((a, b) => b.score - a.score || b.rec.started_at - a.rec.started_at);
  return ranked.map((x) => x.rec);
}

function commandAndOutput(rec: CommandHistoryRecord): string {
  return rec.output ? `$ ${rec.command}\n${stripAnsi(rec.output)}` : `$ ${rec.command}`;
}

export function createTerminalHistoryModal(opts: {
  root: HTMLElement;
  getHistoryPaneId?: (paneId: string) => string;
  onRerun: (command: string) => void;
  onCopy: (text: string) => void;
}): TerminalHistoryModalApi {
  const { root, getHistoryPaneId, onRerun, onCopy } = opts;
  let open = false;
  let activePaneId = "";
  let activeLabel = "";
  let records: CommandHistoryRecord[] = [];

  root.className = "terminal-history terminal-history--hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <section class="terminal-history-panel" role="dialog" aria-label="Terminal history">
      <header class="terminal-history-head">
        <div class="terminal-history-heading">
          <h2 class="terminal-history-title"></h2>
        </div>
      </header>
      <div class="terminal-history-search-row">
        <input class="terminal-history-search" type="search" placeholder="Search commands and output…" aria-label="Search command history" spellcheck="false" />
        <span class="terminal-history-count"></span>
        <button type="button" class="terminal-history-clear" title="Clear this pane's in-memory history">Clear</button>
      </div>
      <div class="terminal-history-list termie-scroll-fade"></div>
      <div class="terminal-history-resize terminal-history-resize--left" data-edge-x="left" data-edge-y="none"></div>
      <div class="terminal-history-resize terminal-history-resize--right" data-edge-x="right" data-edge-y="none"></div>
      <div class="terminal-history-resize terminal-history-resize--top" data-edge-x="none" data-edge-y="top"></div>
      <div class="terminal-history-resize terminal-history-resize--bottom" data-edge-x="none" data-edge-y="bottom"></div>
      <div class="terminal-history-resize terminal-history-resize--nw" data-edge-x="left" data-edge-y="top"></div>
      <div class="terminal-history-resize terminal-history-resize--ne" data-edge-x="right" data-edge-y="top"></div>
      <div class="terminal-history-resize terminal-history-resize--sw" data-edge-x="left" data-edge-y="bottom"></div>
      <div class="terminal-history-resize terminal-history-resize--se" data-edge-x="right" data-edge-y="bottom"></div>
    </section>
  `;
  const panel = root.querySelector(".terminal-history-panel") as HTMLElement;
  const head = root.querySelector(".terminal-history-head") as HTMLElement;
  const list = root.querySelector(".terminal-history-list") as HTMLElement;
  const title = root.querySelector(".terminal-history-title") as HTMLElement;
  const count = root.querySelector(".terminal-history-count") as HTMLElement;
  const search = root.querySelector(".terminal-history-search") as HTMLInputElement;

  function setTitle(): void {
    title.textContent = activePaneId;
    title.title = activeLabel ? `${activeLabel} · ${activePaneId}` : activePaneId;
  }

  function button(label: string, titleText: string, action: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "terminal-history-action";
    btn.textContent = label;
    btn.title = titleText;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      action();
    });
    return btn;
  }

  function render(): void {
    const openIds = new Set(
      [...list.querySelectorAll<HTMLDetailsElement>(".terminal-history-item[open]")]
        .map((el) => el.dataset.recordId)
        .filter((id): id is string => Boolean(id)),
    );
    const visible = filterAndRank(records.slice().reverse(), search.value);
    list.replaceChildren();
    count.textContent = records.length ? `${visible.length}/${records.length}` : "";
    if (!records.length) {
      list.textContent = "No command history for this pane yet.";
      return;
    }
    if (!visible.length) {
      list.textContent = "No matching commands.";
      return;
    }
    for (const rec of visible) {
      const item = document.createElement("details");
      item.className = "terminal-history-item";
      item.dataset.recordId = rec.id;
      item.open = openIds.has(rec.id);
      const summary = document.createElement("summary");
      summary.className = "terminal-history-summary";
      const command = document.createElement("span");
      command.className = "terminal-history-command";
      command.textContent = rec.command || "<unknown>";
      const meta = document.createElement("span");
      meta.className = "terminal-history-meta";
      meta.textContent = `${fmtTime(rec.started_at)} · ${exitLabel(rec.exit_code)} · ${fmtDuration(rec.duration_ms)}`;

      const actions = document.createElement("div");
      actions.className = "terminal-history-actions";
      actions.append(
        button("Run", "Run this command again in the focused pane", () => onRerun(rec.command)),
        button("Copy cmd", "Copy command", () => onCopy(rec.command)),
        button("Copy all", "Copy command and output", () => onCopy(commandAndOutput(rec))),
        button("Copy out", "Copy output", () => onCopy(stripAnsi(rec.output))),
        button("Delete", "Remove this history entry", () => void removeRecord(rec.id)),
      );
      summary.append(command, actions, meta);

      const pre = document.createElement("pre");
      pre.className = "terminal-history-output";
      pre.textContent = rec.output ? stripAnsi(rec.output) : "<no captured output>";
      item.append(summary, pre);
      list.appendChild(item);
    }
  }

  async function reload(): Promise<void> {
    if (!open || !activePaneId) return;
    const priorQuery = search.value;
    if (!records.length) list.textContent = "Loading…";
    try {
      records = await loadCommandHistory(getHistoryPaneId?.(activePaneId) ?? activePaneId, 1000);
    } catch (e) {
      list.textContent = `Failed to load history: ${String(e)}`;
      return;
    }
    search.value = priorQuery;
    render();
  }

  async function removeRecord(recordId: string): Promise<void> {
    const historyPaneId = getHistoryPaneId?.(activePaneId) ?? activePaneId;
    await deleteCommandHistoryRecord(historyPaneId, recordId).catch((e) => console.warn("delete_command_history_record", e));
    records = records.filter((rec) => rec.id !== recordId);
    render();
  }

  async function clearHistory(): Promise<void> {
    const historyPaneId = getHistoryPaneId?.(activePaneId) ?? activePaneId;
    await deleteCommandHistory(historyPaneId).catch((e) => console.warn("delete_command_history", e));
    records = [];
    render();
  }

  function close(): void {
    if (!open) return;
    open = false;
    root.classList.add("terminal-history--hidden");
    root.setAttribute("aria-hidden", "true");
  }

  function setPane(paneId: string, label?: string): void {
    if (!paneId) return;
    const changed = paneId !== activePaneId;
    activePaneId = paneId;
    activeLabel = label?.trim() || "";
    setTitle();
    if (open && changed) {
      records = [];
      void reload();
    }
  }

  function positionForFirstOpen(): void {
    if (panel.style.left && panel.style.top) return;
    const w = Math.min(980, window.innerWidth - 40);
    const h = Math.min(680, window.innerHeight - 48);
    panel.style.width = `${Math.max(420, w)}px`;
    panel.style.height = `${Math.max(260, h)}px`;
    panel.style.left = `${Math.max(12, (window.innerWidth - w) / 2)}px`;
    panel.style.top = `${Math.max(12, (window.innerHeight - h) / 2)}px`;
  }

  function beginDrag(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button,input")) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent): void => {
      const left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx));
      const top = Math.max(0, Math.min(window.innerHeight - 48, ev.clientY - dy));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    const done = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done, { once: true });
  }

  function beginResize(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    const edgeX = target.dataset.edgeX as "left" | "right" | "none";
    const edgeY = target.dataset.edgeY as "top" | "bottom" | "none";
    const rect = panel.getBoundingClientRect();
    const minW = 420;
    const minH = 260;
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent): void => {
      let left = rect.left;
      let top = rect.top;
      let width = rect.width;
      let height = rect.height;
      if (edgeX === "left") {
        const nextLeft = Math.max(0, Math.min(rect.right - minW, ev.clientX));
        width = rect.right - nextLeft;
        left = nextLeft;
      } else if (edgeX === "right") {
        width = Math.max(minW, Math.min(window.innerWidth - rect.left, ev.clientX - rect.left));
      }
      if (edgeY === "top") {
        const nextTop = Math.max(0, Math.min(rect.bottom - minH, ev.clientY));
        height = rect.bottom - nextTop;
        top = nextTop;
      } else if (edgeY === "bottom") {
        height = Math.max(minH, Math.min(window.innerHeight - rect.top, ev.clientY - rect.top));
      }
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
    };
    const done = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done, { once: true });
  }

  search.addEventListener("input", render);
  root.querySelector(".terminal-history-clear")?.addEventListener("click", () => void clearHistory());
  root.querySelectorAll<HTMLElement>(".terminal-history-resize").forEach((el) => {
    el.addEventListener("pointerdown", beginResize);
  });
  head.addEventListener("pointerdown", beginDrag);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return {
    open: (paneId: string, label?: string) => {
      setPane(paneId, label);
      open = true;
      positionForFirstOpen();
      root.classList.remove("terminal-history--hidden");
      root.setAttribute("aria-hidden", "false");
      void reload();
    },
    setPane,
    refresh: (paneId?: string) => {
      if (!open) return;
      if (paneId && paneId !== activePaneId) return;
      void reload();
    },
    close,
    isOpen: () => open,
  };
}
