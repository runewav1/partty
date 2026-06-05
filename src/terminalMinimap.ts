import type { Terminal } from "@xterm/xterm";

import { cellInkRgb } from "./minimapColors";

/**
 * IDE-style minimap: colored buffer preview + viewport thumb.
 * Visibility: #terminal-stage:hover #terminal-minimap.
 */
export class TerminalMinimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scrollVp: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private pending = false;
  private dragging = false;
  private readonly unsubs: Array<() => void> = [];

  private readonly theme: {
    track: string;
    thumb: string;
    thumbBorder: string;
    defaultFg: [number, number, number];
    defaultBg: [number, number, number];
    emptyLineRgb: [number, number, number];
    searchHighlight: string;
  };
  /** Buffer line indices (0-based) to draw as search markers; null = clear. */
  private searchLines: Set<number> | null = null;

  constructor(
    private readonly term: Terminal,
    private readonly host: HTMLElement,
    canvas: HTMLCanvasElement,
    opts: {
      theme: {
        track: string;
        thumb: string;
        thumbBorder: string;
        defaultFg: [number, number, number];
        defaultBg: [number, number, number];
        emptyLineRgb: [number, number, number];
        searchHighlight: string;
      };
    },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("minimap 2d context required");
    this.canvas = canvas;
    this.ctx = ctx;
    this.theme = opts.theme;
  }

  attach(): void {
    const writeDisp = this.term.onWriteParsed(() => this.requestDraw());
    this.unsubs.push(() => writeDisp.dispose());

    this.term.onResize(() => {
      this.bindScrollTarget();
      this.requestDraw();
    });

    this.bindScrollTarget();

    this.onScroll = () => this.requestDraw();

    this.ro = new ResizeObserver(() => this.resizeToHost());
    this.ro.observe(this.host);
    this.resizeToHost();

    this.canvas.addEventListener("mousedown", this.onPointerDown);
    window.addEventListener("mousemove", this.onPointerMove);
    window.addEventListener("mouseup", this.onPointerUp);

    this.requestDraw();
  }

  /** Highlight buffer lines in the minimap (bright markers). Pass null to clear. */
  setSearchHighlights(lines: Iterable<number> | null): void {
    if (lines == null) {
      this.searchLines = null;
    } else {
      this.searchLines = new Set(lines);
    }
    this.requestDraw();
  }

  dispose(): void {
    this.unbindScrollTarget();
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
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
    this.requestDraw();
  }

  private onScroll = (): void => {
    this.requestDraw();
  };

  private bindScrollTarget(): void {
    const vp = this.term.element?.querySelector(".xterm-viewport") as HTMLElement | null;
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

  private requestDraw(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  private draw(): void {
    const vp =
      this.scrollVp ??
      (this.term.element?.querySelector(".xterm-viewport") as HTMLElement | null);
    if (!vp) return;

    const ctx = this.ctx;
    const cw = this.canvas.width / (window.devicePixelRatio || 1);
    const ch = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, cw, ch);

    ctx.fillStyle = this.theme.track;
    ctx.fillRect(0, 0, cw, ch);

    const buf = this.term.buffer.active;
    const totalLines = Math.max(1, buf.length);
    const maxSample = Math.min(totalLines, 12000);
    const cols = Math.max(1, this.term.cols);
    const cell = buf.getNullCell();
    const { defaultFg, defaultBg, emptyLineRgb } = this.theme;
    const [er, eg, eb] = emptyLineRgb;

    for (let py = 0; py < ch; py++) {
      const y0 = (py / ch) * maxSample;
      const y1 = ((py + 1) / ch) * maxSample;
      const i0 = Math.floor(y0);
      const i1 = Math.min(Math.ceil(y1), maxSample);

      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sc = 0;
      let density = 0;

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
          density += Math.min(chars.length, 3);
        }
      }

      if (sc > 0) {
        const ar = sr / sc;
        const ag = sg / sc;
        const ab = sb / sc;
        const a = Math.min(0.9, 0.12 + Math.min(density / 120, 0.55));
        ctx.fillStyle = `rgba(${ar | 0},${ag | 0},${ab | 0},${a})`;
        ctx.fillRect(0, py, cw, 1);
      } else {
        const a = 0.04;
        ctx.fillStyle = `rgba(${er},${eg},${eb},${a})`;
        ctx.fillRect(0, py, cw, 1);
      }
    }

    const sl = this.searchLines;
    if (sl && sl.size > 0) {
      ctx.fillStyle = this.theme.searchHighlight;
      for (const line of sl) {
        if (line < 0 || line >= maxSample) continue;
        const py = (line / maxSample) * ch;
        ctx.fillRect(0, py, cw, Math.max(2, ch / maxSample));
      }
    }

    const sh = vp.scrollHeight;
    const vh = vp.clientHeight;
    const st = vp.scrollTop;
    const maxScroll = Math.max(1, sh - vh);
    const thumbH = Math.max((vh / sh) * ch, 10);
    const thumbY = (st / maxScroll) * Math.max(0, ch - thumbH);

    ctx.strokeStyle = this.theme.thumbBorder;
    ctx.lineWidth = 1;
    ctx.fillStyle = this.theme.thumb;
    const r = 2;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(0.5, thumbY + 0.5, cw - 1, thumbH - 1, r);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(0, thumbY, cw, thumbH);
    }
  }

  private scrollFromClientY(clientY: number): void {
    const vp =
      this.scrollVp ??
      (this.term.element?.querySelector(".xterm-viewport") as HTMLElement | null);
    if (!vp) return;
    const rect = this.canvas.getBoundingClientRect();
    const ch = rect.height;
    const y = Math.min(Math.max(0, clientY - rect.top), ch);
    const sh = vp.scrollHeight;
    const vh = vp.clientHeight;
    const maxScroll = Math.max(0, sh - vh);
    const thumbH = Math.max((vh / sh) * ch, 10);
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
