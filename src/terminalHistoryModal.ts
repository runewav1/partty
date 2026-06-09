import { loadCommandHistory, type CommandHistoryRecord } from "./commandHistory";

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
  return value.toLowerCase();
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
  return rec.output ? `$ ${rec.command}\n${rec.output}` : `$ ${rec.command}`;
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
          <h2 class="terminal-history-title">Pane History</h2>
        </div>
      </header>
      <div class="terminal-history-search-row">
        <input class="terminal-history-search" type="search" placeholder="Search commands and output…" aria-label="Search command history" spellcheck="false" />
        <span class="terminal-history-count"></span>
      </div>
      <div class="terminal-history-list termie-scroll-fade"></div>
    </section>
  `;
  const panel = root.querySelector(".terminal-history-panel") as HTMLElement;
  const head = root.querySelector(".terminal-history-head") as HTMLElement;
  const list = root.querySelector(".terminal-history-list") as HTMLElement;
  const title = root.querySelector(".terminal-history-title") as HTMLElement;
  const count = root.querySelector(".terminal-history-count") as HTMLElement;
  const search = root.querySelector(".terminal-history-search") as HTMLInputElement;

  function setTitle(): void {
    title.textContent = `History · ${activeLabel || activePaneId}`;
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
        button("Copy out", "Copy output", () => onCopy(rec.output)),
      );
      summary.append(command, actions, meta);

      const pre = document.createElement("pre");
      pre.className = "terminal-history-output";
      pre.textContent = rec.output || "<no captured output>";
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

  search.addEventListener("input", render);
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
