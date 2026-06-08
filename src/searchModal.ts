import type { PaneHost } from "./paneHost";
import { findMatchingBufferLines, mergeHitsForNavigation, type SearchHit } from "./terminalSearch";

const POS_KEY = "partty.searchModal.pos";

export type SearchMinimap = {
  setSearchHighlights(lines: Iterable<number> | null): void;
};

export type TerminalSearchOptions = {
  root: HTMLElement;
  getPaneHost: () => PaneHost | null;
  getMinimapForPane: (paneId: string) => SearchMinimap | undefined;
  focusPane: (paneId: string) => void;
};

export type TerminalSearchApi = {
  openSinglePane(): void;
  openAllPanes(): void;
  close(): void;
  isOpen(): boolean;
};

export function createTerminalSearch(opts: TerminalSearchOptions): TerminalSearchApi {
  let open = false;
  let allPanesMode = false;
  let query = "";
  let hits: SearchHit[] = [];
  let hitIndex = 0;

  const wrap = document.createElement("div");
  wrap.className = "term-search term-search--hidden";
  wrap.setAttribute("role", "search");
  wrap.setAttribute("aria-hidden", "true");

  const head = document.createElement("div");
  head.className = "term-search-head";

  const title = document.createElement("span");
  title.className = "term-search-title";
  title.textContent = "Find";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "term-search-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";

  head.appendChild(title);
  head.appendChild(closeBtn);

  const row = document.createElement("div");
  row.className = "term-search-row";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "term-search-input";
  input.placeholder = "Search buffer…";
  input.autocomplete = "off";
  input.spellcheck = false;

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "term-search-nav";
  prevBtn.title = "Previous (Shift+Enter)";
  prevBtn.textContent = "Prev";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "term-search-nav";
  nextBtn.title = "Next (Enter)";
  nextBtn.textContent = "Next";

  const meta = document.createElement("div");
  meta.className = "term-search-meta";
  meta.textContent = "";

  row.appendChild(input);
  row.appendChild(prevBtn);
  row.appendChild(nextBtn);

  wrap.appendChild(head);
  wrap.appendChild(row);
  wrap.appendChild(meta);
  opts.root.appendChild(wrap);

  function loadPos(): void {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as { left: number; top: number };
      if (typeof j.left === "number" && typeof j.top === "number") {
        wrap.style.left = `${j.left}px`;
        wrap.style.top = `${j.top}px`;
        wrap.style.transform = "none";
      }
    } catch {
      /* ignore */
    }
  }

  function savePos(): void {
    const r = wrap.getBoundingClientRect();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
  }

  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag = { x: e.clientX, y: e.clientY, ox: wrap.offsetLeft, oy: wrap.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    wrap.style.left = `${drag.ox + dx}px`;
    wrap.style.top = `${drag.oy + dy}px`;
    wrap.style.transform = "none";
  });
  head.addEventListener("pointerup", (e) => {
    if (drag) savePos();
    drag = null;
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  function clearMinimapHighlights(): void {
    const ph = opts.getPaneHost();
    if (!ph) return;
    ph.forEachPane((id) => {
      opts.getMinimapForPane(id)?.setSearchHighlights(null);
    });
  }

  function rebuildHits(): void {
    const ph = opts.getPaneHost();
    if (!ph) {
      hits = [];
      hitIndex = 0;
      updateMeta();
      return;
    }
    const q = input.value;
    query = q;
    const matches = new Map<string, number[]>();

    if (!allPanesMode) {
      const id = ph.getFocusedPaneId();
      const pt = ph.getPaneTerminal(id);
      if (pt) {
        const lines = findMatchingBufferLines(pt.term, q).sort((a, b) => a - b);
        matches.set(id, lines);
        hits = lines.map((line) => ({ paneId: id, line }));
      } else {
        hits = [];
      }
    } else {
      ph.forEachPane((id, pt) => {
        matches.set(id, findMatchingBufferLines(pt.term, q));
      });
      hits = mergeHitsForNavigation(ph.getTree(), matches);
    }

    hitIndex = 0;
    applyMinimapHighlights(matches);
    updateMeta();
    if (hits.length > 0) showCurrentHit();
  }

  function applyMinimapHighlights(matches: Map<string, number[]>): void {
    const ph = opts.getPaneHost();
    if (!ph) return;
    ph.forEachPane((id) => {
      const lines = matches.get(id);
      opts.getMinimapForPane(id)?.setSearchHighlights(lines?.length ? lines : null);
    });
  }

  function showCurrentHit(): void {
    if (hits.length === 0) return;
    const h = hits[hitIndex]!;
    const ph = opts.getPaneHost();
    if (!ph) return;
    const selStart = input.selectionStart ?? query.length;
    const selEnd = input.selectionEnd ?? selStart;
    opts.focusPane(h.paneId);
    const pt = ph.getPaneTerminal(h.paneId);
    if (!pt) return;
    try {
      pt.term.scrollToLine(h.line);
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
      try {
        input.setSelectionRange(selStart, selEnd);
      } catch {
        /* ignore */
      }
    });
    updateMeta();
  }

  function updateMeta(): void {
    const mode = allPanesMode ? "workspace" : "pane";
    if (!query.trim()) {
      meta.textContent = `${mode} — type to search`;
      return;
    }
    if (hits.length === 0) {
      meta.textContent = `${mode} — no matches`;
      return;
    }
    meta.textContent = `${mode} — ${hitIndex + 1} / ${hits.length}`;
  }

  function nextHit(): void {
    if (hits.length === 0) return;
    hitIndex = (hitIndex + 1) % hits.length;
    showCurrentHit();
  }

  function prevHit(): void {
    if (hits.length === 0) return;
    hitIndex = (hitIndex - 1 + hits.length) % hits.length;
    showCurrentHit();
  }

  input.addEventListener("input", () => rebuildHits());
  wrap.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prevHit();
      else nextHit();
    }
  });

  prevBtn.addEventListener("click", () => prevHit());
  nextBtn.addEventListener("click", () => nextHit());
  closeBtn.addEventListener("click", () => close());

  function close(): void {
    if (!open) return;
    open = false;
    wrap.classList.add("term-search--hidden");
    wrap.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("term-search-open");
    clearMinimapHighlights();
    query = "";
    hits = [];
  }

  return {
    openSinglePane: () => {
      allPanesMode = false;
      title.textContent = "Find in pane";
      openUi();
    },
    openAllPanes: () => {
      allPanesMode = true;
      title.textContent = "Find in workspace";
      openUi();
    },
    close,
    isOpen: () => open,
  };

  function openUi(): void {
    open = true;
    loadPos();
    wrap.classList.remove("term-search--hidden");
    wrap.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("term-search-open");
    rebuildHits();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }
}
