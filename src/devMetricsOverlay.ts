import { parttyPerf } from "./perf";
import { attachDraggablePanel } from "./draggablePanel";

export type DevMetricsOverlayApi = {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
};

export type DevMetricsOverlayOptions = {
  root: HTMLElement;
  getFocusedPaneId: () => string | null | undefined;
};

export function createDevMetricsOverlay(opts: DevMetricsOverlayOptions): DevMetricsOverlayApi {
  const { root, getFocusedPaneId } = opts;
  let visible = false;
  let raf = 0;

  const el = document.createElement("div");
  el.id = "dev-metrics-overlay";
  el.className = "dev-overlay dev-overlay--hidden";
  el.setAttribute("aria-hidden", "true");

  const handle = document.createElement("div");
  handle.className = "dev-overlay-handle";
  handle.textContent = "Developer Metrics";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "dev-overlay-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";

  const body = document.createElement("div");
  body.className = "dev-overlay-body";

  const globalSection = document.createElement("div");
  globalSection.className = "dev-overlay-section";
  globalSection.innerHTML = `
    <div class="dev-overlay-section-title">Global</div>
    <div class="dev-overlay-metrics" data-metrics="global"></div>
  `;

  const paneSection = document.createElement("div");
  paneSection.className = "dev-overlay-section dev-overlay-section--panes";
  paneSection.innerHTML = `
    <div class="dev-overlay-section-title">Per-Pane</div>
    <div class="dev-overlay-metrics" data-metrics="panes"></div>
  `;

  handle.appendChild(closeBtn);
  body.appendChild(globalSection);
  body.appendChild(paneSection);
  el.appendChild(handle);
  el.appendChild(body);
  root.appendChild(el);

  attachDraggablePanel(el, handle, "partty.dev-overlay.pos");

  function fmtBytes(n: number): string {
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GiB`;
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${n.toFixed(0)} B`;
  }

  function fmtRate(bytesPerSec: number): string {
    if (bytesPerSec >= 1073741824) return `${(bytesPerSec / 1073741824).toFixed(1)} GiB/s`;
    if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MiB/s`;
    if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KiB/s`;
    return `${bytesPerSec.toFixed(0)} B/s`;
  }

  function updateGlobal(container: HTMLElement): void {
    const snap = parttyPerf.snapshot();
    let html = "";

    const fps = snap.gauges["frame.fps"];
    if (fps !== undefined) {
      const cls = fps < 30 ? "ov-metric--warn" : fps < 55 ? "ov-metric--mid" : "";
      html += `<span class="ov-metric ${cls}">FPS: <strong>${fps.toFixed(1)}</strong></span>`;
    }

    const inputRate = parttyPerf.getInputRate();
    html += `<span class="ov-metric">Input: <strong>${inputRate}</strong> ev/s</span>`;

    const inputLatency = snap.timings["input.keydown.to.onData.ms"];
    if (inputLatency) {
      html += `<span class="ov-metric">Latency: <strong>${(inputLatency.totalMs / inputLatency.count).toFixed(1)}ms</strong> avg</span>`;
    }

    const long50 = snap.counters["frame.long_50ms"] ?? 0;
    const long100 = snap.counters["frame.long_100ms"] ?? 0;
    html += `<span class="ov-metric">Long: <strong>${long50}</strong> (&gt;50ms) <strong>${long100}</strong> (&gt;100ms)</span>`;

    const paintEntries = snap.counters["paint.entries"] ?? 0;
    html += `<span class="ov-metric">Paint: <strong>${paintEntries}</strong></span>`;

    const layoutShifts = snap.counters["layout.shift.count"] ?? 0;
    const lastShift = snap.gauges["layout.shift.last"];
    let shiftLabel = `${layoutShifts}`;
    if (lastShift !== undefined) shiftLabel += ` (last ${lastShift.toFixed(3)})`;
    html += `<span class="ov-metric">Layout Shift: <strong>${shiftLabel}</strong></span>`;

    const longTasks = snap.counters["main.longtask.count"] ?? 0;
    const taskTiming = snap.timings["main.longtask.ms"];
    let taskLabel = `${longTasks}`;
    if (taskTiming) taskLabel += ` (avg ${(taskTiming.totalMs / taskTiming.count).toFixed(0)}ms)`;
    html += `<span class="ov-metric">Long Tasks: <strong>${taskLabel}</strong></span>`;

    container.innerHTML = html;
  }

  function updatePanes(container: HTMLElement): void {
    const paneIds = parttyPerf.getAllPaneIds();
    if (paneIds.length === 0) {
      container.innerHTML = `<span class="ov-metric ov-metric--dim">(no panes tracked)</span>`;
      return;
    }

    const focusedId = getFocusedPaneId();
    let html = "";
    for (const paneId of paneIds) {
      const snap = parttyPerf.getPaneSnapshot(paneId);
      const inputRate = parttyPerf.getPtyInputRate(paneId);
      const outputRate = parttyPerf.getPtyOutputRate(paneId);
      const isFocused = paneId === focusedId;

      const paneCls = `ov-pane${isFocused ? " ov-pane--focused" : ""}`;
      html += `<div class="${paneCls}">`;
      html += `<div class="ov-pane-id">${isFocused ? "\u25b6 " : ""}${paneId}</div>`;
      html += `<div class="ov-pane-metrics">`;

      if (inputRate) {
        html += `<span class="ov-metric">PTY in: <strong>${fmtRate(inputRate.bytesPerSec)}</strong> (total ${fmtBytes(inputRate.totalBytes)})</span>`;
      }
      if (outputRate) {
        html += `<span class="ov-metric">PTY out: <strong>${fmtRate(outputRate.bytesPerSec)}</strong> (total ${fmtBytes(outputRate.totalBytes)})</span>`;
      }

      if (snap) {
        const renderTiming = snap.timings["xterm.render.ms"];
        if (renderTiming) {
          html += `<span class="ov-metric">Render: <strong>${renderTiming.lastMs.toFixed(2)}ms</strong> (avg ${(renderTiming.totalMs / renderTiming.count).toFixed(2)}ms)</span>`;
        }
        const resizeTiming = snap.timings["xterm.resize.ms"];
        if (resizeTiming) {
          html += `<span class="ov-metric">Resize: <strong>${resizeTiming.lastMs.toFixed(2)}ms</strong></span>`;
        }
      }

      html += `</div></div>`;
    }
    container.innerHTML = html;
  }

  function update(): void {
    if (!visible) return;
    if (!parttyPerf.enabled) {
      hide();
      return;
    }
    raf = requestAnimationFrame(update);

    const globalContainer = el.querySelector<HTMLElement>('[data-metrics="global"]');
    const paneContainer = el.querySelector<HTMLElement>('[data-metrics="panes"]');
    if (globalContainer) updateGlobal(globalContainer);
    if (paneContainer) updatePanes(paneContainer);
  }

  function show(): void {
    visible = true;
    el.classList.remove("dev-overlay--hidden");
    el.setAttribute("aria-hidden", "false");
    if (!raf) raf = requestAnimationFrame(update);
  }

  function hide(): void {
    visible = false;
    el.classList.add("dev-overlay--hidden");
    el.setAttribute("aria-hidden", "true");
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function toggle(): void {
    if (visible) hide();
    else show();
  }

  function isVisible(): boolean {
    return visible;
  }

  closeBtn.addEventListener("click", hide);

  return { show, hide, toggle, isVisible };
}
