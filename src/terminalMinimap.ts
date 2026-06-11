import type { Terminal } from "@xterm/xterm";

import { cellInkRgb } from "./minimapColors";
import { parttyPerf } from "./perf";

export type MinimapGranularity = "cell" | "row";

/**
 * Minimap overlay — renders a scaled-down view of the terminal buffer into a
 * narrow column on the right side of the pane. Uses row-averaged colors
 * by default (fast); switch to cell-level rendering for column detail.
 */
export class TerminalMinimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scrollVp: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private pending = false;
  private pendingTimer = 0;
  private lastDrawAt = 0;
  private dragging = false;
  private readonly unsubs: Array<() => void> = [];

  private readonly thumbColor: string;
  private readonly defaultFg: [number, number, number];
  private readonly defaultBg: [number, number, number];
  private readonly searchHighlight: string;
  private searchLines: Set<number> | null = null;
  private granularity: MinimapGranularity;

  constructor(
    private readonly term: Terminal,
    private readonly host: HTMLElement,
    canvas: HTMLCanvasElement,
    opts: {
      granularity: MinimapGranularity;
      theme: {
        thumb: string;
        defaultFg: [number, number, number];
        defaultBg: [number, number, number];
        searchHighlight: string;
      };
    },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("minimap 2d context required");
    this.canvas = canvas;
    this.ctx = ctx;
    this.granularity = opts.granularity;
    this.thumbColor = opts.theme.thumb;
    this.defaultFg = opts.theme.defaultFg;
    this.defaultBg = opts.theme.defaultBg;
    this.searchHighlight = opts.theme.searchHighlight;
  }

  attach(): void {
    const writeDisp = this.term.onWriteParsed(() => this.requestDraw());
    this.unsubs.push(() => writeDisp.dispose());

    this.term.onResize(() => {
      this.bindScrollTarget();
      this.requestDraw(true);
    });

    this.bindScrollTarget();

    this.onScroll = () => this.requestDraw();

    this.ro = new ResizeObserver(() => this.resizeToHost());
    this.ro.observe(this.host);
    this.resizeToHost();

    this.canvas.addEventListener("mousedown", this.onPointerDown);
    window.addEventListener("mousemove", this.onPointerMove);
    window.addEventListener("mouseup", this.onPointerUp);

    this.requestDraw(true);
  }

  setGranularity(g: MinimapGranularity): void {
    if (g === this.granularity) return;
    this.granularity = g;
    this.requestDraw(true);
  }

  setSearchHighlights(lines: Iterable<number> | null): void {
    if (lines == null) {
      this.searchLines = null;
    } else {
      this.searchLines = new Set(lines);
    }
    this.requestDraw(true);
  }

  dispose(): void {
    this.unbindScrollTarget();
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }
    if (this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = 0;
    }
    this.canvas.removeEventListener("mousedown", this.onPointerDown);
    window.removeEventListener("mousemove", this.onPointerMove);
    window.removeEventListener("mouseup", this.onPointerUp);
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }

  resizeToHost(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.requestDraw(true);
  }

  private onScroll = (): void => {
    this.requestDraw(true);
  };

  private findScrollElement(): HTMLElement | null {
    const el = this.term.element;
    if (!el) return null;
    return (el.querySelector(".xterm-scrollable-element") as HTMLElement | null)
      ?? (el.querySelector(".xterm-viewport") as HTMLElement | null);
  }

  private bindScrollTarget(): void {
    const vp = this.findScrollElement();
    if (vp === this.scrollVp) return;
    this.unbindScrollTarget();
    this.scrollVp = vp;
    if (vp) {
      vp.addEventListener("scroll", this.onScroll, { passive: true });
    }
  }

  private unbindScrollTarget(): void {
    if (this.scrollVp) {
      this.scrollVp.removeEventListener("scroll", this.onScroll);
      this.scrollVp = null;
    }
  }

  private requestDraw(force = false): void {
    if (force && this.pendingTimer) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = 0;
    }
    if (this.pending) return;
    const now = performance.now();
    const waitMs = force ? 0 : Math.max(0, 50 - (now - this.lastDrawAt));
    if (waitMs > 0) {
      if (!this.pendingTimer) {
        this.pendingTimer = window.setTimeout(() => {
          this.pendingTimer = 0;
          this.requestDraw(true);
        }, waitMs);
      }
      return;
    }
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.lastDrawAt = performance.now();
      const started = performance.now();
      this.draw();
      parttyPerf.mark("minimap.draw");
      parttyPerf.time("minimap.draw.ms", performance.now() - started);
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width / (window.devicePixelRatio || 1);
    const ch = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, cw, ch);

    if (this.granularity === "cell") {
      this.drawCell(ctx, cw, ch);
    } else {
      this.drawRow(ctx, cw, ch);
    }

    this.drawOverlays(ctx, cw, ch);
  }

  private drawCell(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
  ): void {
    const buf = this.term.buffer.active;
    const totalLines = Math.max(1, buf.length);
    const cols = Math.max(1, this.term.cols);
    const cell = buf.getNullCell();
    const { defaultFg, defaultBg } = this;

    const pxPerLine = ch / totalLines;
    const lineStep = pxPerLine < 0.6 ? Math.ceil(1 / pxPerLine) : 1;
    const colStep = Math.max(1, Math.round(cols / Math.max(cw, 40)));

    for (let li = 0; li < totalLines; li += lineStep) {
      const py = Math.round(li * pxPerLine);
      const h = Math.max(1, Math.ceil(pxPerLine * lineStep));
      if (py + h <= 0 || py >= ch) continue;

      const line = buf.getLine(li);
      if (!line) continue;
      const lineLen = Math.min(line.length, cols);
      if (lineLen < 1) continue;

      const pxPerCol = cw / cols;

      for (let ci = 0; ci < lineLen; ci += colStep) {
        const c = line.getCell(ci, cell);
        if (!c || c.getWidth() === 0) continue;

        const chars = c.getChars();
        if ((chars === "" || chars === " ") && c.isAttributeDefault()) continue;

        const [r, g, b] = cellInkRgb(c, defaultFg, defaultBg);
        const px = Math.round(ci * pxPerCol);
        const pw = Math.max(1, Math.round(colStep * pxPerCol));

        ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
        ctx.fillRect(px, py, pw, h);
      }
    }
  }

  private drawRow(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
  ): void {
    const buf = this.term.buffer.active;
    const totalLines = Math.max(1, buf.length);
    const cols = Math.max(1, this.term.cols);
    const cell = buf.getNullCell();
    const { defaultFg, defaultBg } = this;

    for (let py = 0; py < ch; py++) {
      const y0 = (py / ch) * totalLines;
      const y1 = ((py + 1) / ch) * totalLines;
      const i0 = Math.floor(y0);
      const i1 = Math.min(Math.ceil(y1), totalLines);

      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sc = 0;

      for (let i = i0; i < i1; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        const len = Math.min(line.length, cols);
        if (len < 1) continue;
        const step = Math.max(1, Math.ceil(len / 20));
        for (let x = 0; x < len; x += step) {
          const c = line.getCell(x, cell);
          if (!c || c.getWidth() === 0) continue;
          const chars = c.getChars();
          if (chars === "" && c.isAttributeDefault()) continue;
          const [r, g, b] = cellInkRgb(c, defaultFg, defaultBg);
          sr += r;
          sg += g;
          sb += b;
          sc++;
        }
      }

      if (sc > 0) {
        const ar = sr / sc;
        const ag = sg / sc;
        const ab = sb / sc;
        ctx.fillStyle = `rgba(${ar | 0},${ag | 0},${ab | 0},0.72)`;
        ctx.fillRect(0, py, cw, 1);
      }
    }
  }

  private drawOverlays(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
  ): void {
    const vp = this.scrollVp ?? this.findScrollElement();
    if (!vp) return;

    const buf = this.term.buffer.active;
    const totalLines = Math.max(1, buf.length);
    const pxPerLine = ch / totalLines;

    const sl = this.searchLines;
    if (sl && sl.size > 0) {
      const sH = Math.max(2, Math.ceil(pxPerLine));
      for (const sLine of sl) {
        if (sLine < 0 || sLine >= totalLines) continue;
        const sy = Math.round(sLine * pxPerLine);
        ctx.fillStyle = this.searchHighlight;
        ctx.fillRect(0, sy, cw, sH);
      }
    }

    const sh = vp.scrollHeight;
    const vh = vp.clientHeight;
    const st = vp.scrollTop;
    const maxScroll = Math.max(1, sh - vh);
    let thumbH = Math.max(12, (vh / sh) * ch);

    // When there's no scrollback the thumb fills the whole strip — skip it.
    if (thumbH >= ch * 0.98) return;

    const thumbY = (st / maxScroll) * Math.max(0, ch - thumbH);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 3;
    ctx.fillStyle = this.thumbColor;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(1, thumbY, cw - 2, thumbH, 3);
      ctx.fill();
    } else {
      ctx.fillRect(0, thumbY, cw, thumbH);
    }
    ctx.restore();
  }

  private scrollFromClientY(clientY: number): void {
    const vp = this.scrollVp ?? this.findScrollElement();
    if (!vp) return;
    const rect = this.canvas.getBoundingClientRect();
    const ch = rect.height;
    const y = Math.min(Math.max(0, clientY - rect.top), ch);
    const sh = vp.scrollHeight;
    const vh = vp.clientHeight;
    const maxScroll = Math.max(0, sh - vh);
    const thumbH = Math.max((vh / sh) * ch, 12);
    const track = Math.max(0, ch - thumbH);
    const thumbY = Math.min(Math.max(0, y - thumbH / 2), track);
    vp.scrollTop = track > 0 ? (thumbY / track) * maxScroll : 0;
  }

  private onPointerDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.dragging = true;
    this.scrollFromClientY(e.clientY);
  };

  private onPointerMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.scrollFromClientY(e.clientY);
    this.requestDraw();
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };
}
